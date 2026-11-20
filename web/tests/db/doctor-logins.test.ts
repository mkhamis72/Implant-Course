import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asCompany, asPostgres } from './helpers';
import { makePatient, makeProduct, pendingLogin, insertSelfAuthUser } from './fixtures';

// Clinic workflow (0123): a doctor's login is linked to the Doctors list; a clinic's new organizers get Edit.

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const invite = (c: Client, email: string, name: string, role: string, doctor: string | null, isNew: boolean) =>
  c.query('select public.create_pending_login_v2($1, $2, $3, null, $4, $5)', [email, name, role, doctor, isNew]);

/** A doctor of academy (as postgres), unlinked. */
async function makeDoctor(c: Client, name: string): Promise<string> {
  await asCompany(c);
  return (await one(c, 'insert into public.doctors (name) values ($1) returning id', [name])) as string;
}

const doctorOf = async (c: Client, user: string) => {
  await asPostgres(c);
  return (await c.query('select id, name from public.doctors where user_id = $1', [user])).rows;
};

async function setKind(c: Client, kind: 'clinic' | 'course_organizer') {
  await asPostgres(c);
  await c.query('update public.companies set kind = $2 where id = $1', [ACADEMY, kind]);
}

const permsOf = async (c: Client, user: string) => {
  await asPostgres(c);
  return (await c.query(
    `select area, level from public.user_permissions where company_id = $1 and user_id = $2 order by area`,
    [ACADEMY, user])).rows.map((r) => `${r.area}:${r.level}`);
};

describe('doctor logins (0123)', () => {
  it('doctor invite links on sign-up', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-new@example.com', ' Zz Dr New ', 'organizer', null, true);
      await asPostgres(c);
      const pending = (await c.query(
        `select pl.doctor_id, pl.doctor_created, d.name, d.user_id from app_private.pending_logins pl
         join public.doctors d on d.id = pl.doctor_id where pl.email = 'zz-doc-new@example.com'`)).rows;
      expect(pending).toEqual([{ doctor_id: expect.any(String), doctor_created: true, name: 'Zz Dr New', user_id: null }]);
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-new@example.com' });
      expect(await doctorOf(c, id)).toEqual([{ id: pending[0].doctor_id, name: 'Zz Dr New' }]);
    });
  });

  it('existing doctor linked', async () => {
    await withTx(async (c) => {
      const d = await makeDoctor(c, 'Zz Dr Listed');
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-listed@example.com', 'Zz Listed', 'organizer', d, false);
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-listed@example.com' });
      expect(await doctorOf(c, id)).toEqual([{ id: d, name: 'Zz Dr Listed' }]);
    });
  });

  it('doctor rules: one doctor, an active unlinked one of this company', async () => {
    await withTx(async (c) => {
      const d = await makeDoctor(c, 'Zz Dr Rules');
      const inactive = await makeDoctor(c, 'Zz Dr Inactive');
      await c.query('update public.doctors set active = false where id = $1', [inactive]);
      await c.query('update public.doctors set user_id = $2 where id = $1', [d, users.organizer]);
      const free = await makeDoctor(c, 'Zz Dr Free');
      await actAsBound(c, users.admin);
      await refused(c, 'select public.create_pending_login_v2($1, $2, $3, null, $4, $5)',
        ['zz-doc-r@example.com', 'Zz R', 'organizer', free, true], /Choose one doctor\./);
      for (const x of [d, inactive, '00000000-0000-4000-8000-000000000000']) {
        await refused(c, 'select public.create_pending_login_v2($1, $2, $3, null, $4, $5)',
          ['zz-doc-r@example.com', 'Zz R', 'organizer', x, false], /Choose a doctor without a login\./);
      }
    });
  });

  it('admin also a doctor', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-admin@example.com', 'Zz Dr Admin', 'admin', null, true);
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-admin@example.com' });
      expect((await doctorOf(c, id)).map((r) => r.name)).toEqual(['Zz Dr Admin']);
      expect(await one(c, 'select role from public.company_members where company_id = $1 and user_id = $2', [ACADEMY, id]))
        .toBe('admin');
    });
  });

  it('add_existing_member_v2 links at once', async () => {
    await withTx(async (c) => {
      // Someone with an account in company B joins academy as a new doctor.
      await asPostgres(c);
      const b = (await one(c, `insert into public.companies (slug, name) values ('zz-doc-b', 'Zz Doc B') returning id`)) as string;
      await pendingLogin(c, 'zz-doc-existing@example.com', { company: b, fullName: 'Zz Dr Existing' });
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-existing@example.com', companyId: b });
      await actAsBound(c, users.admin);
      const got = await one(c, `select public.add_existing_member_v2('zz-doc-existing@example.com', 'organizer', null, null, true)`);
      expect(got).toBe(id);
      expect((await doctorOf(c, id)).map((r) => r.name)).toEqual(['Zz Dr Existing']);
    });
  });

  it('cancel removes the new doctor', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-cancel@example.com', 'Zz Dr Cancel', 'organizer', null, true);
      await asPostgres(c);
      const created = await one(c, `select doctor_id from app_private.pending_logins where email = 'zz-doc-cancel@example.com'`);
      await actAsBound(c, users.admin);
      await c.query(`select public.cancel_pending_login('zz-doc-cancel@example.com')`);
      await asPostgres(c);
      expect(await one(c, 'select count(*)::int from public.doctors where id = $1', [created])).toBe(0);

      // A doctor chosen from the list is kept.
      const listed = await makeDoctor(c, 'Zz Dr Kept');
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-kept@example.com', 'Zz Kept', 'organizer', listed, false);
      await c.query(`select public.cancel_pending_login('zz-doc-kept@example.com')`);
      await asPostgres(c);
      expect(await one(c, 'select count(*)::int from public.doctors where id = $1', [listed])).toBe(1);
    });
  });

  it('cancel keeps a new doctor that an implant names', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-used@example.com', 'Zz Dr Used', 'organizer', null, true);
      await asPostgres(c);
      const created = await one(c, `select doctor_id from app_private.pending_logins where email = 'zz-doc-used@example.com'`);
      await asCompany(c);
      const patient = await makePatient(c, 'Zz Doctor Login Patient');
      const product = await makeProduct(c, 'implant', 'Zz Doctor Login Brand');
      await c.query(
        `insert into public.implant_sites (patient_id, tooth, state, product_id, placed_on, placing_doctor_id)
         values ($1, 36, 'placed', $2, public.cairo_today(), $3)`, [patient, product, created]);
      await actAsBound(c, users.admin);
      await c.query(`select public.cancel_pending_login('zz-doc-used@example.com')`);
      await asPostgres(c);
      expect(await one(c, 'select count(*)::int from public.doctors where id = $1', [created])).toBe(1);
    });
  });

  it('set_doctor_login', async () => {
    await withTx(async (c) => {
      const d1 = await makeDoctor(c, 'Zz Dr One');
      const d2 = await makeDoctor(c, 'Zz Dr Two');
      // A member of company B only.
      await asPostgres(c);
      const b = (await one(c, `insert into public.companies (slug, name) values ('zz-doc-c', 'Zz Doc C') returning id`)) as string;
      await pendingLogin(c, 'zz-doc-other@example.com', { company: b });
      const other = await insertSelfAuthUser(c, { email: 'zz-doc-other@example.com', companyId: b });

      await actAsBound(c, users.admin);
      await c.query('select public.set_doctor_login($1, $2)', [d1, users.organizer]);
      expect(await doctorOf(c, users.organizer)).toEqual([{ id: d1, name: 'Zz Dr One' }]);
      await actAsBound(c, users.admin);
      await refused(c, 'select public.set_doctor_login($1, $2)', [d2, users.organizer],
        /That login is already linked to a doctor\./);
      await refused(c, 'select public.set_doctor_login($1, $2)', [d2, other], /not found|Choose/i);
      await c.query('select public.set_doctor_login($1, null)', [d1]);
      expect(await doctorOf(c, users.organizer)).toEqual([]);

      await actAsBound(c, users.organizer);
      await refused(c, 'select public.set_doctor_login($1, $2)', [d1, users.organizer], /Only an admin can do this\./);
    });
  });

  it('clinic doctor gets edit', async () => {
    await withTx(async (c) => {
      await setKind(c, 'clinic');
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-clinic@example.com', 'Zz Dr Clinic', 'organizer', null, true);
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-clinic@example.com' });
      expect(await permsOf(c, id)).toEqual(
        ['checklists:edit', 'inventory:edit', 'patients:edit', 'research:edit', 'schedule:edit']);
    });
  });

  it('a course organizer keeps the View defaults', async () => {
    await withTx(async (c) => {
      await setKind(c, 'course_organizer');
      await actAsBound(c, users.admin);
      await invite(c, 'zz-doc-course@example.com', 'Zz Course Organizer', 'organizer', null, false);
      const id = await insertSelfAuthUser(c, { email: 'zz-doc-course@example.com' });
      expect(await permsOf(c, id)).toEqual(
        ['checklists:view', 'courses:view', 'delegates:view', 'inventory:view', 'patients:view', 'schedule:view']);
    });
  });
});
