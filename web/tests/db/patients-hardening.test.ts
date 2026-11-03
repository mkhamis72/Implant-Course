import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');

async function newPatient(c: Client, name = 'Hardening Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

async function expectRefused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('I1: users cannot rewrite who/where columns', () => {
  it('a tooth status row cannot be moved to another patient or tooth', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const a = await newPatient(c, 'Patient A');
      const b = await newPatient(c, 'Patient B');
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'missing')", [a]);
      await expectRefused(c, 'update public.tooth_status set patient_id = $1 where patient_id = $2', [b, a], /cannot change|permission denied/);
      await expectRefused(c, 'update public.tooth_status set tooth = 37 where patient_id = $1', [a], /cannot change|permission denied/);
      // The normal upsert (same patient and tooth, new status) still works.
      await c.query(
        `insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'extracted')
         on conflict (patient_id, tooth) do update set patient_id = excluded.patient_id, tooth = excluded.tooth, status = excluded.status`,
        [a],
      );
    });
  });

  it('patients cannot be created with a forged creator or timestamps', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expectRefused(c, "insert into public.patients (full_name, created_by) values ('X Y', $1)", [users.admin], /permission denied/);
      await expectRefused(c, "insert into public.patients (full_name, created_at) values ('X Y', '2000-01-01')", [], /permission denied/);
      const id = await newPatient(c);
      await expectRefused(c, 'update public.patients set created_by = $1 where id = $2', [users.admin, id], /permission denied/);
    });
  });

  it('notes cannot be backdated by created_at or dated in the future', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await expectRefused(
        c,
        "insert into public.visit_notes (patient_id, text, created_at) values ($1, 'x', '1999-01-01')",
        [id],
        /permission denied/,
      );
      await expectRefused(
        c,
        "insert into public.visit_notes (patient_id, text, visit_date) values ($1, 'x', '2099-01-01')",
        [id],
        /visit_notes_visit_date_check/,
      );
    });
  });

  it('medical history cannot be re-pointed at another patient', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const a = await newPatient(c, 'Patient A');
      const b = await newPatient(c, 'Patient B');
      await expectRefused(c, 'update public.medical_history set patient_id = $1 where patient_id = $2', [b, a], /permission denied/);
    });
  });
});

describe('I2: file numbers', () => {
  it('automatic numbers continue after the highest number, typed ones included (0091)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const next = Number((await c.query('select public.next_file_no() as n')).rows[0].n.slice(1));
      for (const n of [next, next + 1, next + 2]) {
        await c.query("insert into public.patients (full_name, file_no) values ('Typed', $1)", [`p${String(n).padStart(5, '0')}`]);
      }
      const { rows: auto } = await c.query("insert into public.patients (full_name) values ('Auto') returning file_no");
      expect(auto[0].file_no).toBe(`P${String(next + 3).padStart(5, '0')}`);
    });
  });

  it('file numbers are unique regardless of case', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await c.query("insert into public.patients (full_name, file_no) values ('A A', 'zz-case-1')");
      await expectRefused(c, "insert into public.patients (full_name, file_no) values ('B B', 'ZZ-CASE-1')", [], /duplicate key/);
    });
  });
});
