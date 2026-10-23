import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makePatient, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const LOCKED = "This form version has been signed by patients and can't be changed. Add a new version instead.";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n%test\n');

const today = async (c: Client) => (await c.query('select public.cairo_today()::text as d')).rows[0].d as string;
const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;
const v1 = async (c: Client) =>
  (await c.query(`select id from public.consent_form_versions where label = 'v1'`)).rows[0].id as string;

type Rec = {
  patient: string; version: string; language?: string; signedOn?: string;
  answers?: [boolean, boolean, boolean, boolean]; file?: Buffer; contentType?: string;
};
const record = async (c: Client, r: Rec) =>
  (await c.query(
    `select public.record_consent(p_patient => $1, p_version => $2, p_language => $3,
       p_signed_on => coalesce($4::date, public.cairo_today()), p_treatment => $5, p_research => $6,
       p_teaching_images => $7, p_follow_up => $8, p_file => $9, p_content_type => $10) as id`,
    [r.patient, r.version, r.language ?? 'en', r.signedOn ?? null, ...(r.answers ?? [true, true, false, true]),
     r.file ?? JPEG, r.contentType ?? 'image/jpeg'],
  )).rows[0].id as string;

const saveVersion = async (c: Client, id: string | null, label: string, effectiveOn: string, en = 'English text', ar = 'نص عربي') =>
  (await c.query(
    `select public.save_consent_version(p_id => $1, p_label => $2, p_effective_on => $3::date, p_text_en => $4, p_text_ar => $5) as id`,
    [id, label, effectiveOn, en, ar],
  )).rows[0].id as string;

const history = async (c: Client, patient: string) =>
  (await c.query(
    `select id, version_label, language, signed_on::text as signed_on, treatment, research, teaching_images, follow_up,
            file_id, is_current, voided_at, voided_reason
     from public.patient_consents_for($1)`,
    [patient],
  )).rows;

const voidIt = (c: Client, id: string, reason: string) => c.query('select public.void_consent($1, $2)', [id, reason]);

/** An admin-made version effective long ago, so records can be dated in the past. */
async function setup(c: Client, name = 'Zz Consent Patient') {
  await actAs(c, users.admin);
  const early = await saveVersion(c, null, 'Zz early', '2020-01-01');
  await actAs(c, users.organizer);
  const patient = await makePatient(c, name);
  return { early, patient };
}

describe('consent form versions', () => {
  it('v1 is seeded from the draft: both languages, placeholders kept, no draft note or footer', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query(
        `select label, effective_on::text as effective_on, text_en, text_ar from public.consent_versions() where label = 'v1'`,
      );
      expect(rows).toHaveLength(1);
      const v = rows[0];
      expect(v.effective_on).toBe('2026-10-23');
      expect(v.text_en.startsWith('**{company_name}**\n**Consent to treatment')).toBe(true);
      expect(v.text_en).toContain('Patient name: {patient_name}  File no.: {file_no}');
      expect(v.text_en.endsWith('Witness / clinic staff name: ____________________ Signature: ____________________')).toBe(true);
      expect(v.text_ar.startsWith('**{company_name}**\n**إقرار موافقة')).toBe(true);
      expect(v.text_ar).toContain('{patient_name}');
      expect(v.text_ar.endsWith('اسم الشاهد / موظف العيادة: ____________________ التوقيع: ____________________')).toBe(true);
      for (const t of [v.text_en, v.text_ar]) {
        expect(t).not.toMatch(/Draft|<small>|## English|## العربية|\r/);
      }
    });
  });

  it('the current version is the latest effective on or before today', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const now = await saveVersion(c, null, 'Zz now', await today(c));
      await saveVersion(c, null, 'Zz future', '2099-01-01');
      await saveVersion(c, null, 'Zz old', '2020-01-01');
      const cur = await c.query('select id, label from public.current_consent_version()');
      expect(cur.rows).toEqual([{ id: now, label: 'Zz now' }]);
    });
  });

  it('admin edits an unused version; once a record references it, it is locked, even after voiding', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const v = await v1(c);
      await c.query('delete from public.patient_consents where version_id = $1', [v]);
      await c.query('update public.consent_form_versions set first_signed_at = null where id = $1', [v]);
      const before = (await c.query('select text_en, text_ar from public.consent_form_versions where id = $1', [v])).rows[0];

      await actAs(c, users.admin);
      expect(await saveVersion(c, v, 'v1', '2026-10-23', before.text_en + '\n\nEdited.', before.text_ar)).toBe(v);
      const inUse = async () =>
        (await c.query('select in_use from public.consent_versions() where id = $1', [v])).rows[0].in_use as boolean;
      expect(await inUse()).toBe(false);

      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Consent Lock');
      const rec = await record(c, { patient, version: v });
      await actAs(c, users.admin);
      expect(await inUse()).toBe(true);
      await refused(c, () => saveVersion(c, v, 'v1', '2026-10-23', before.text_en, before.text_ar), new RegExp(LOCKED.replace(/[.']/g, '.')));

      await actAs(c, users.organizer);
      await voidIt(c, rec, 'Wrong patient');
      await actAs(c, users.admin);
      await refused(c, () => saveVersion(c, v, 'v1 changed', '2026-10-23'), /signed by patients and can't be changed/);
    });
  });

  it('only an admin saves a version; labels are unique and the fields required', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, () => saveVersion(c, null, 'Zz org', '2020-01-01'), /Only an admin/);
      await actAs(c, users.admin);
      await refused(c, () => saveVersion(c, null, 'v1', '2020-01-01'), /already exists/);
      await refused(c, () => saveVersion(c, null, '  ', '2020-01-01'), /label/);
      await refused(c, () => saveVersion(c, null, 'Zz blank', '2020-01-01', ' ', 'نص'), /English and Arabic/);
      await refused(c, () => c.query(`insert into public.consent_form_versions (label, effective_on, text_en, text_ar)
                                      values ('Zz direct', '2020-01-01', 'a', 'b')`), /permission denied/);
      await refused(c, () => c.query(`update public.consent_form_versions set text_en = 'changed' where label = 'v1'`), /permission denied/);
    });
  });

  it('a version stays locked after the only patient who signed it is deleted', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await record(c, { patient, version: early });
      await c.query('select public.delete_patient($1)', [patient]);
      await actAs(c, users.admin);
      const v = await c.query('select in_use from public.consent_versions() where id = $1', [early]);
      expect(v.rows[0].in_use).toBe(true);
      await refused(c, () => saveVersion(c, early, 'Zz early', '2020-01-01', 'Changed'), /signed by patients and can't be changed/);
    });
  });
});

describe('record_consent / void_consent', () => {
  it('records a consent and reads it back as current, with the scan', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const id = await record(c, { patient, version: early, language: 'ar', signedOn: await daysAgo(c, 3), file: PDF, contentType: 'application/pdf' });
      const rows = await history(c, patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id, version_label: 'Zz early', language: 'ar', signed_on: await daysAgo(c, 3),
        treatment: true, research: true, teaching_images: false, follow_up: true, is_current: true, voided_at: null,
      });
      const file = await c.query('select bytes, content_type from public.consent_file($1, $2)', [patient, rows[0].file_id]);
      expect(file.rows).toHaveLength(1);
      expect(Buffer.compare(file.rows[0].bytes, PDF)).toBe(0);
      expect(file.rows[0].content_type).toBe('application/pdf');
    });
  });

  it('a newer record becomes current; voiding it restores the earlier one', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const first = await record(c, { patient, version: early, signedOn: await daysAgo(c, 10) });
      const second = await record(c, { patient, version: early, signedOn: await daysAgo(c, 2), answers: [true, false, false, true] });
      let rows = await history(c, patient);
      expect(rows.map((r) => [r.id, r.is_current])).toEqual([[second, true], [first, false]]);

      await refused(c, () => voidIt(c, second, '   '), /Say why/);
      await voidIt(c, second, 'Unreadable scan');
      rows = await history(c, patient);
      expect(rows.map((r) => [r.id, r.is_current])).toEqual([[first, true], [second, false]]);
      expect(rows[1].voided_reason).toBe('Unreadable scan');
      expect(rows[1].voided_at).not.toBeNull();
      await refused(c, () => voidIt(c, second, 'Again'), /not found/);

      // Same date signed as the first: the one recorded later wins.
      const third = await record(c, { patient, version: early, signedOn: await daysAgo(c, 10) });
      rows = await history(c, patient);
      expect(rows[0]).toMatchObject({ id: third, is_current: true });
    });
  });

  it('refuses a future date, a date before the version took effect, and missing answers', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const tomorrow = (await c.query(`select (public.cairo_today() + 1)::text as d`)).rows[0].d;
      await refused(c, () => record(c, { patient, version: early, signedOn: tomorrow }), /future/);
      const first = await v1(c);
      await refused(c, () => record(c, { patient, version: first, signedOn: '2026-10-22' }), /before this form version took effect/);
      await refused(
        c,
        () => c.query(`select public.record_consent($1, $2, 'en', public.cairo_today(), true, null, true, true, $3, 'image/jpeg')`, [patient, early, JPEG]),
        /Answer all four/,
      );
    });
  });

  it('refuses a bad language, a bad content type, a mismatched file and a file over 2 MB', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await refused(c, () => record(c, { patient, version: early, language: 'fr' }), /language/);
      await refused(c, () => record(c, { patient, version: early, contentType: 'image/png' }), /JPEG image or a PDF/);
      await refused(c, () => record(c, { patient, version: early, file: PDF, contentType: 'image/jpeg' }), /JPEG image or a PDF/);
      await refused(c, () => record(c, { patient, version: early, file: Buffer.alloc(0) }), /Upload the signed form/);
      const big = Buffer.alloc(2_097_153);
      JPEG.copy(big);
      await refused(c, () => record(c, { patient, version: early, file: big }), /2 MB/);
      await record(c, { patient, version: early, file: big.subarray(0, 2_097_152) });
    });
  });

  it('needs Edit on Patients to record or void; nobody writes the tables directly', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const id = await record(c, { patient, version: early });
      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      await refused(c, () => record(c, { patient, version: early }), /permission to edit Patients/);
      await refused(c, () => voidIt(c, id, 'Reason'), /permission to edit Patients/);
      await refused(c, () => c.query('update public.patient_consents set research = false where id = $1', [id]), /permission denied/);
      await refused(c, () => c.query(`insert into public.stored_files (bytes, content_type) values ('\\xffd8ff', 'image/jpeg')`), /permission denied/);
    });
  });
});

describe('consent readers', () => {
  it('Patients view reads records, versions and the file; without it the readers return nothing', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await record(c, { patient, version: early });
      const file = (await history(c, patient))[0].file_id as string;
      const read = async () => ({
        records: (await history(c, patient)).length,
        versions: (await c.query('select count(*)::int as n from public.consent_versions()')).rows[0].n > 0,
        current: (await c.query('select count(*)::int as n from public.current_consent_version()')).rows[0].n,
        file: (await c.query('select count(*)::int as n from public.consent_file($1, $2)', [patient, file])).rows[0].n,
      });

      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      expect(await read()).toEqual({ records: 1, versions: true, current: 1, file: 1 });

      await setPerms(c, users.target, { schedule: 'edit', research: 'view' });
      await actAs(c, users.target);
      expect(await read()).toEqual({ records: 0, versions: false, current: 0, file: 0 });
    });
  });

  it('stored files are never read directly, only through consent_file', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await record(c, { patient, version: early });
      for (const u of [users.admin, users.organizer]) {
        await actAs(c, u);
        await refused(c, () => c.query('select id from public.stored_files limit 1'), /permission denied/);
        await refused(c, () => c.query('select bytes from public.stored_files limit 1'), /permission denied/);
      }
    });
  });

  it('consent_file returns nothing to a delegate login or an inactive user', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await record(c, { patient, version: early });
      const file = (await history(c, patient))[0].file_id as string;
      for (const u of [users.delegate, users.inactive]) {
        await actAs(c, u);
        const r = await c.query('select count(*)::int as n from public.consent_file($1, $2)', [patient, file]);
        expect(r.rows[0].n).toBe(0);
      }
    });
  });

  it("consent_file returns nothing for another patient's id", async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const other = await makePatient(c, 'Zz Consent Other');
      await record(c, { patient, version: early });
      const file = (await history(c, patient))[0].file_id as string;
      const r = await c.query('select * from public.consent_file($1, $2)', [other, file]);
      expect(r.rows).toEqual([]);
    });
  });
});

describe('consent audit', () => {
  it('records are audited with the file id; file bytes never reach audit_log', async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      const id = await record(c, { patient, version: early });
      await voidIt(c, id, 'Wrong patient');
      await asPostgres(c);
      const file = (await c.query('select file_id from public.patient_consents where id = $1', [id])).rows[0].file_id;
      const a = await c.query(
        `select action, after ->> 'file_id' as file_id from public.audit_log
         where table_name = 'patient_consents' and row_id = $1 order by id`,
        [id],
      );
      expect(a.rows.map((r) => r.action)).toEqual(['INSERT', 'UPDATE']);
      expect(a.rows[0].file_id).toBe(file);
      const s = await c.query(`select count(*)::int as n from public.audit_log where table_name = 'stored_files'`);
      expect(s.rows[0].n).toBe(0);
    });
  });

  it("deleting a patient deletes their consent records and the stored scans", async () => {
    await withTx(async (c) => {
      const { early, patient } = await setup(c);
      await record(c, { patient, version: early });
      const file = (await history(c, patient))[0].file_id as string;
      await c.query('select public.delete_patient($1)', [patient]);
      await asPostgres(c);
      const n = await c.query('select count(*)::int as n from public.stored_files where id = $1', [file]);
      expect(n.rows[0].n).toBe(0);
    });
  });
});
