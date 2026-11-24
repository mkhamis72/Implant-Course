import { createHash } from 'node:crypto';
import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { insertSelfAuthUser, makePatient, pendingLogin } from './fixtures';

// Implant passport (0145): stored PDF versions per patient, the closed file table, the download log and the
// company's medical-content setting.

const users = inject('testUsers');
const MAX = 5 * 1024 * 1024;

const pdf = (text = 'Zz passport') => Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const save = async (c: Client, patient: string, file: Buffer = pdf(), level = 'allergies_medications') =>
  (await c.query('select public.save_patient_passport(p_patient => $1, p_file => $2, p_medical_level => $3) as id',
    [patient, file, level])).rows[0].id as string;

const download = async (c: Client, passport: string) =>
  (await c.query('select public.patient_passport_file(p_passport => $1) as bytes', [passport])).rows[0].bytes as Buffer;

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(`select count(*)::int as n from (${sql}) x`, params)).rows[0].n as number;

/** Company B with an admin, bound; returns the admin's id. Leaves the caller acting as B's admin. */
async function companyB(c: Client): Promise<{ company: string; admin: string }> {
  await asPostgres(c);
  await c.query("select set_config('request.jwt.claims', '', true)");
  const tag = Math.random().toString(36).slice(2, 8);
  const company = (await c.query('insert into public.companies (slug, name) values ($1, $2) returning id',
    [`zz-pass-${tag}`, 'Zz Passport B'])).rows[0].id as string;
  const email = `zz-pass-${tag}-admin@example.com`;
  await pendingLogin(c, email, { company, role: 'admin', fullName: 'Zz Passport admin' });
  const admin = await insertSelfAuthUser(c, { email, companyId: company });
  await actAsBound(c, admin, company);
  return { company, admin };
}

describe('implant passport: saving', () => {
  it('numbers versions 1, 2, … per patient and stores size and sha256', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Versions');
      const other = await makePatient(c, 'Zz Passport Other');
      const file = pdf('first');
      const first = await save(c, patient, file);
      const second = await save(c, patient, pdf('second'), 'full');
      const otherFirst = await save(c, other);

      const { rows } = await c.query(
        `select id, version, size_bytes, sha256, medical_level, generated_by from public.patient_passports
         where patient_id = any($1::uuid[]) order by patient_id = $2 desc, version`, [[patient, other], patient]);
      expect(rows.map((r) => [r.id, r.version, r.medical_level])).toEqual([
        [first, 1, 'allergies_medications'], [second, 2, 'full'], [otherFirst, 1, 'allergies_medications'],
      ]);
      expect(rows[0].size_bytes).toBe(file.length);
      expect(rows[0].sha256).toBe(createHash('sha256').update(file).digest('hex'));
      expect(rows[0].generated_by).toBe(users.organizer);
    });
  });

  it('concurrent saves get distinct versions', async () => {
    const setup = new Client(pgConfig());
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await Promise.all([setup.connect(), a.connect(), b.connect()]);
    let patient: string | undefined;
    try {
      // Committed so the other connections see it; deleted in finally (the passports cascade).
      await setup.query('begin');
      await actAs(setup, users.organizer);
      patient = await makePatient(setup, `Zz Passport Race ${Math.random().toString(36).slice(2, 8)}`);
      await setup.query('commit');

      await a.query('begin');
      await actAs(a, users.organizer);
      await b.query('begin');
      await actAs(b, users.organizer);
      await save(a, patient); // holds the patient's lock until it commits
      const second = save(b, patient); // waits for it
      await new Promise((r) => setTimeout(r, 300));
      await a.query('commit');
      await second;
      await b.query('commit');

      const { rows } = await setup.query(
        'select version from public.patient_passports where patient_id = $1 order by version', [patient]);
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
    } finally {
      await a.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      await setup.query('rollback').catch(() => {});
      await setup.query('reset role');
      if (patient) await setup.query('delete from public.patients where id = $1', [patient]);
      await Promise.all([setup.end(), a.end(), b.end()]);
    }
  });

  it('refuses a file that is not a PDF, an oversized one and an unknown medical level', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Refusals');
      await refused(c, () => save(c, patient, Buffer.from('<html>not a pdf</html>')), /^That is not a PDF file\.$/);
      await refused(c, () => save(c, patient, Buffer.alloc(0)), /^That is not a PDF file\.$/);
      const big = Buffer.alloc(MAX + 1, 0x20);
      big.write('%PDF-1.7\n');
      await refused(c, () => save(c, patient, big), /^The passport is too large to store\.$/);
      await refused(c, () => save(c, patient, pdf(), 'everything'), /medical/i);
      await refused(c, () => save(c, patient, pdf(), null as unknown as string), /medical/i);
      await refused(c, () => save(c, crypto.randomUUID()), /^Patient not found\.$/);

      // Exactly 5 MB is allowed.
      const limit = Buffer.alloc(MAX, 0x20);
      limit.write('%PDF-1.7\n');
      await save(c, patient, limit);
      expect(await count(c, 'select 1 from public.patient_passports where patient_id = $1', [patient])).toBe(1);
    });
  });
});

describe('implant passport: reading and downloads', () => {
  it('the file table is closed to every signed-in role, admins included', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Closed');
      await save(c, patient);
      for (const user of [users.admin, users.organizer, users.viewer]) {
        await actAs(c, user);
        await refused(c, () => c.query('select bytes from public.patient_passport_files'), /permission denied/);
        await refused(c, () => c.query('insert into public.patient_passports (patient_id, version, size_bytes, sha256, medical_level) values ($1, 9, 1, $2, \'none\')',
          [patient, 'a'.repeat(64)]), /permission denied/);
      }
    });
  });

  it('download returns the stored bytes and logs who downloaded it; View can download but not save', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Download');
      const file = pdf('download me');
      const passport = await save(c, patient, file);

      await actAs(c, users.viewer);
      expect(await count(c, 'select 1 from public.patient_passports where id = $1', [passport])).toBe(1);
      expect(Buffer.compare(await download(c, passport), file)).toBe(0);
      await refused(c, () => save(c, patient), /You don't have permission to edit Patients\./);
      await refused(c, () => download(c, crypto.randomUUID()), /^Passport not found\.$/);

      const { rows } = await c.query(
        'select passport_id, downloaded_by, downloaded_at from public.passport_downloads where passport_id = $1', [passport]);
      expect(rows).toHaveLength(1);
      expect(rows[0].downloaded_by).toBe(users.viewer);
      expect(rows[0].downloaded_at).toBeInstanceOf(Date);
    });
  });

  it('no Patients permission: nothing to read and no download', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport No Area');
      const passport = await save(c, patient);
      await actAs(c, users.viewer);
      await download(c, passport);

      await asPostgres(c);
      await c.query(`delete from public.user_permissions where user_id = $1 and area = 'patients'`, [users.viewer]);
      await actAs(c, users.viewer);
      expect(await count(c, 'select 1 from public.patient_passports')).toBe(0);
      expect(await count(c, 'select 1 from public.passport_downloads')).toBe(0);
      await refused(c, () => download(c, passport), /You don't have permission to view Patients\./);
    });
  });

  it('a delegate login sees nothing and can neither save nor download', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Delegate');
      const passport = await save(c, patient);
      await download(c, passport);

      await actAs(c, users.delegate);
      expect(await count(c, 'select 1 from public.patient_passports')).toBe(0);
      expect(await count(c, 'select 1 from public.passport_downloads')).toBe(0);
      expect(await count(c, 'select 1 from public.passport_settings')).toBe(0);
      await refused(c, () => download(c, passport), /permission|Not allowed/);
      await refused(c, () => save(c, patient), /permission|Not allowed/);
    });
  });

  it("company B can't read, download or add to company A's passports", async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Company A');
      const passport = await save(c, patient);
      await download(c, passport);

      await companyB(c);
      expect(await count(c, 'select 1 from public.patient_passports')).toBe(0);
      expect(await count(c, 'select 1 from public.passport_downloads')).toBe(0);
      expect(await count(c, 'select 1 from public.passport_settings')).toBe(0);
      await refused(c, () => download(c, passport), /^Passport not found\.$/);
      await refused(c, () => save(c, patient), /^Patient not found\.$/);

      await asPostgres(c);
      expect(await count(c, 'select 1 from public.passport_downloads where passport_id = $1', [passport])).toBe(1);
      expect(await count(c, 'select 1 from public.patient_passports where patient_id = $1', [patient])).toBe(1);
    });
  });
});

describe('implant passport: settings', () => {
  it('default allergies_medications; admins only change it; per company', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query(`delete from public.passport_settings where company_id = 'a7c0de00-0000-4000-8000-000000000001'`);
      await actAs(c, users.organizer);
      const current = async () => (await c.query('select public.passport_settings_current() as v')).rows[0].v as string;
      expect(await current()).toBe('allergies_medications');
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => 'full')`), /Only an admin/);
      await refused(c, () => c.query(`update public.passport_settings set medical = 'full'`), /permission denied/);

      await actAs(c, users.admin);
      await c.query(`select public.set_passport_settings(p_medical => 'full')`);
      expect(await current()).toBe('full');
      await c.query(`select public.set_passport_settings(p_medical => 'none')`);
      expect(await current()).toBe('none');
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => 'everything')`), /medical/i);
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => null)`), /medical/i);

      await actAs(c, users.viewer);
      expect(await current()).toBe('none');

      await companyB(c);
      expect(await current()).toBe('allergies_medications');
      await c.query(`select public.set_passport_settings(p_medical => 'full')`);
      expect(await current()).toBe('full');
      await actAs(c, users.admin);
      expect(await current()).toBe('none');

      await asPostgres(c);
      expect(await count(c, `select 1 from public.audit_log where table_name = 'passport_settings'
        and row_id = 'a7c0de00-0000-4000-8000-000000000001'`)).toBeGreaterThan(0);
    });
  });
});

describe('implant passport: history and deletion', () => {
  it('patient_history shows the generated version to a Patients viewer', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport History');
      await save(c, patient);
      await save(c, patient);
      await actAs(c, users.viewer);
      const { rows } = await c.query(
        `select action, after ->> 'version' as version from public.patient_history($1)
         where table_name = 'patient_passports' order by id`, [patient]);
      expect(rows).toEqual([{ action: 'INSERT', version: '1' }, { action: 'INSERT', version: '2' }]);
    });
  });

  it('delete_patient removes passports, files and downloads', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Passport Delete');
      const keep = await makePatient(c, 'Zz Passport Keep');
      const passport = await save(c, patient);
      const kept = await save(c, keep);
      await download(c, passport);
      await download(c, kept);

      await c.query('select public.delete_patient($1)', [patient]);
      await asPostgres(c);
      expect(await count(c, 'select 1 from public.patient_passports where id = $1', [passport])).toBe(0);
      expect(await count(c, 'select 1 from public.patient_passport_files where passport_id = $1', [passport])).toBe(0);
      expect(await count(c, 'select 1 from public.passport_downloads where passport_id = $1', [passport])).toBe(0);
      expect(await count(c, 'select 1 from public.patient_passport_files where passport_id = $1', [kept])).toBe(1);
      expect(await count(c, 'select 1 from public.passport_downloads where passport_id = $1', [kept])).toBe(1);
    });
  });
});
