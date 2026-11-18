import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asCompany, asPostgres } from './helpers';
import { makeCourse, makePatient, makeProduct } from './fixtures';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

/** The error a statement raises (inside a savepoint, so the test's transaction goes on), or null. */
async function raised(c: Client, sql: string, params: unknown[] = []): Promise<{ message: string; constraint?: string } | null> {
  await c.query('savepoint s');
  try {
    await c.query(sql, params);
    await c.query('release savepoint s');
    return null;
  } catch (e) {
    await c.query('rollback to savepoint s');
    const err = e as { message: string; constraint?: string };
    return { message: err.message, constraint: err.constraint };
  }
}

describe('doctors and clinic days (0114)', () => {
  it('admin manages doctors', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { aal: 'aal2' });
      const id = await one(c, `insert into public.doctors (name) values ('Zz Dr Admin') returning id`);
      await c.query(`update public.doctors set name = 'Zz Dr Admin 2', active = false where id = $1`, [id]);
      expect((await c.query('select name, active, company_id from public.doctors where id = $1', [id])).rows[0])
        .toEqual({ name: 'Zz Dr Admin 2', active: false, company_id: ACADEMY });

      await actAs(c, users.organizer);
      expect((await raised(c, `insert into public.doctors (name) values ('Zz Dr Organizer')`))?.message)
        .toMatch(/row-level security/);
      expect(await one(c, 'select count(*)::int from public.doctors where id = $1', [id])).toBe(1);
      // The organizer's update reaches no row (update needs is_admin).
      const upd = await c.query(`update public.doctors set name = 'Zz Dr Hacked' where id = $1`, [id]);
      expect(upd.rowCount).toBe(0);
    });
  });

  it('a placed implant may have a doctor instead of a delegate', async () => {
    await withTx(async (c) => {
      await asCompany(c);
      const patient = await makePatient(c, 'Zz Doctor Patient');
      const product = await makeProduct(c, 'implant', 'Zz Doctor Brand');
      const doctor = await one(c, `insert into public.doctors (name) values ('Zz Dr Placing') returning id`);

      expect(await raised(c,
        `insert into public.implant_sites (patient_id, tooth, state, product_id, placed_on, placing_doctor_id)
         values ($1, 36, 'placed', $2, public.cairo_today(), $3)`, [patient, product, doctor])).toBeNull();

      const neither = await raised(c,
        `insert into public.implant_sites (patient_id, tooth, state, product_id, placed_on)
         values ($1, 46, 'placed', $2, public.cairo_today())`, [patient, product]);
      expect(neither?.constraint).toBe('implant_sites_placed_details');
    });
  });

  it('a booking may have a placing doctor and no supervisor', async () => {
    await withTx(async (c) => {
      await asCompany(c);
      const cols = (await c.query(
        `select column_name, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'surgery_slots' and column_name in ('supervisor_id', 'placing_doctor_id')
         order by 1`)).rows;
      expect(cols).toEqual([
        { column_name: 'placing_doctor_id', is_nullable: 'YES' },
        { column_name: 'supervisor_id', is_nullable: 'YES' },
      ]);
    });
  });

  it('clinic day needs no course only in a clinic', async () => {
    await withTx(async (c) => {
      const clinicDay = `insert into public.sessions (course_id, type, title, date, start_time, end_time)
                         values (null, 'surgery', 'Zz Clinic day', '2030-03-02', '08:00', '17:00') returning id`;

      // Course organizer (academy on Full): a session still needs its course.
      await asCompany(c);
      expect((await raised(c, clinicDay))?.message).toBe('Choose the course.');
      // And a course session is still checked against the course dates.
      const course = await makeCourse(c);
      expect((await raised(c,
        `insert into public.sessions (course_id, type, title, date, start_time, end_time)
         values ($1, 'surgery', 'Zz Outside', '2031-01-01', '08:00', '17:00')`, [course]))?.message)
        .toBe('The session date must fall within the course dates.');

      await asPostgres(c);
      await c.query(`update public.companies set kind = 'clinic' where id = $1`, [ACADEMY]);
      await asCompany(c);
      expect(await raised(c, clinicDay)).toBeNull();
    });
  });
});
