import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { insertSelfAuthUser, makePatient, pendingLogin } from './fixtures';

// Passport generation log (0150): the passport is built in the browser; only a row per generation is kept.

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const log = async (c: Client, patient: string, level: string | null = 'allergies_medications') =>
  (await c.query('select public.log_passport_generation(p_patient => $1, p_medical_level => $2) as id',
    [patient, level])).rows[0].id as string;

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(`select count(*)::int as n from (${sql}) x`, params)).rows[0].n as number;

async function companyB(c: Client): Promise<void> {
  await asPostgres(c);
  await c.query("select set_config('request.jwt.claims', '', true)");
  const tag = Math.random().toString(36).slice(2, 8);
  const company = (await c.query('insert into public.companies (slug, name) values ($1, $2) returning id',
    [`zz-gen-${tag}`, 'Zz Generations B'])).rows[0].id as string;
  const email = `zz-gen-${tag}-admin@example.com`;
  await pendingLogin(c, email, { company, role: 'admin', fullName: 'Zz Generations admin' });
  const admin = await insertSelfAuthUser(c, { email, companyId: company });
  await actAsBound(c, admin, company);
}

describe('passport generations', () => {
  it('a Patients viewer logs a generation: who, when and the medical level', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen Viewer');
      await actAs(c, users.viewer);
      const id = await log(c, patient, 'full');
      const { rows } = await c.query(
        'select patient_id, generated_by, generated_at, medical_level from public.passport_generations where id = $1', [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].patient_id).toBe(patient);
      expect(rows[0].generated_by).toBe(users.viewer);
      expect(rows[0].medical_level).toBe('full');
      expect(rows[0].generated_at).toBeInstanceOf(Date);
    });
  });

  it('refuses an unknown patient and an unknown medical level', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen Checks');
      await refused(c, () => log(c, crypto.randomUUID()), /^Patient not found\.$/);
      await refused(c, () => log(c, patient, 'everything'), /medical/i);
      await refused(c, () => log(c, patient, null), /medical/i);
      await refused(c, () => c.query(`insert into public.passport_generations (patient_id, medical_level) values ($1, 'none')`, [patient]),
        /permission denied/);
    });
  });

  it('no Patients permission: refused and nothing to read', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen No Area');
      await log(c, patient);
      await asPostgres(c);
      await c.query(`delete from public.user_permissions where user_id = $1 and area = 'patients'`, [users.viewer]);
      await actAs(c, users.viewer);
      expect(await count(c, 'select 1 from public.passport_generations')).toBe(0);
      await refused(c, () => log(c, patient), /You don't have permission to view Patients\./);
    });
  });

  it('a delegate login is refused and reads nothing', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen Delegate');
      await log(c, patient);
      await actAs(c, users.delegate);
      expect(await count(c, 'select 1 from public.passport_generations')).toBe(0);
      await refused(c, () => log(c, patient), /permission|Not allowed/);
    });
  });

  it("company B can't log for or read company A's patient", async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen Company A');
      await log(c, patient);
      await companyB(c);
      expect(await count(c, 'select 1 from public.passport_generations')).toBe(0);
      await refused(c, () => log(c, patient), /^Patient not found\.$/);
      await asPostgres(c);
      expect(await count(c, 'select 1 from public.passport_generations where patient_id = $1', [patient])).toBe(1);
    });
  });

  it('patient_history lists the generation; delete_patient removes the rows', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Gen History');
      await actAs(c, users.viewer);
      const id = await log(c, patient, 'none');
      const { rows } = await c.query(
        `select table_name, action, actor from public.patient_history($1) where table_name = 'passport_generations'`, [patient]);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('INSERT');

      await actAs(c, users.admin);
      await c.query('select public.delete_patient($1)', [patient]);
      await asPostgres(c);
      expect(await count(c, 'select 1 from public.passport_generations where id = $1', [id])).toBe(0);
    });
  });
});
