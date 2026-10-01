import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

async function newPatient(c: Client, name = 'Test Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

describe('patients', () => {
  it('an active organizer creates a patient with an auto file number, creator and medical history', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const { rows } = await c.query('select file_no, created_by from public.patients where id = $1', [id]);
      expect(rows[0].file_no).toMatch(/^P\d{5,}$/);
      expect(rows[0].created_by).toBe(users.organizer);
      const mh = await c.query('select diabetes, allergies from public.medical_history where patient_id = $1', [id]);
      expect(mh.rows).toEqual([{ diabetes: false, allergies: '' }]);
    });
  });

  it('inactive users and anon cannot see or create patients', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await newPatient(c);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.patients')).rows).toHaveLength(0);
      await c.query('savepoint s');
      await expect(newPatient(c)).rejects.toThrow(/row-level security/);
      await c.query('rollback to savepoint s');
      await actAs(c, null);
      await expect(c.query('select id from public.patients')).rejects.toThrow(/permission denied/);
    });
  });

  it('patients cannot be deleted by users (archive instead)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await newPatient(c);
      await expect(c.query('delete from public.patients where id = $1', [id])).rejects.toThrow(/permission denied/);
    });
  });

  it('file numbers are unique', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await c.query("insert into public.patients (full_name, file_no) values ('A A', 'F-1')");
      await expect(c.query("insert into public.patients (full_name, file_no) values ('B B', 'F-1')")).rejects.toThrow(
        /duplicate key/,
      );
    });
  });

  it('tooth numbers must be FDI permanent teeth', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 48, 'missing')", [id]);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 19, 'missing')", [id]),
      ).rejects.toThrow(/fdi_tooth/);
      await c.query('rollback to savepoint s');
      await expect(
        c.query("insert into public.visit_notes (patient_id, text, teeth) values ($1, 'x', '{36,50}')", [id]),
      ).rejects.toThrow(/fdi_tooth/);
    });
  });

  it('one status row per tooth (upsert updates it)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const upsert = `insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, $2)
                      on conflict (patient_id, tooth) do update set status = excluded.status`;
      await c.query(upsert, [id, 'missing']);
      await c.query(upsert, [id, 'extracted']);
      const { rows } = await c.query('select status from public.tooth_status where patient_id = $1', [id]);
      expect(rows).toEqual([{ status: 'extracted' }]);
    });
  });

  it('manual writes cannot touch implant states', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'implant_placed')", [id]),
      ).rejects.toThrow(/row-level security/);
      await c.query('rollback to savepoint s');
      // Simulate a Plan 3 workflow writing an implant state (bypasses RLS as postgres).
      await asPostgres(c);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 46, 'implant_placed')", [id]);
      await actAs(c, users.organizer);
      const r = await c.query("update public.tooth_status set status = 'missing' where patient_id = $1 and tooth = 46", [id]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('notes are written as the signed-in author and cannot be edited or deleted', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const { rows } = await c.query(
        "insert into public.visit_notes (patient_id, text, teeth) values ($1, 'Healing well', '{36}') returning author_id, visit_date",
        [id],
      );
      expect(rows[0].author_id).toBe(users.organizer);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.visit_notes (patient_id, text, author_id) values ($1, 'forged', $2)", [id, users.admin]),
      ).rejects.toThrow(/permission denied|row-level security/);
      await c.query('rollback to savepoint s');
      await expect(c.query("update public.visit_notes set text = 'changed'")).rejects.toThrow(/permission denied/);
    });
  });

  it('changes are audited with the patient id', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query("update public.patients set phone = '0100' where id = $1", [id]);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'missing')", [id]);
      await asPostgres(c);
      const { rows } = await c.query(
        `select table_name, action, user_id from public.audit_log
         where row_id = $1 or after->>'patient_id' = $1 order by id`,
        [id],
      );
      expect(rows.map((r) => `${r.table_name}:${r.action}`)).toEqual([
        'patients:INSERT',
        'medical_history:INSERT',
        'patients:UPDATE',
        'tooth_status:INSERT',
      ]);
      expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([users.organizer]));
    });
  });

  it('a 2FA user with an aal1 token sees no patients (inherits Plan 1 rule)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await newPatient(c);
      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 't', 'totp', 'verified', now(), now(), 'x')`,
        [users.organizer],
      );
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect((await c.query('select id from public.patients')).rows).toHaveLength(0);
    });
  });
});
