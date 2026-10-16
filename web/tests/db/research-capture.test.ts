import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makePatient } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const history = async (c: Client, patient: string) =>
  (await c.query(
    `select smoking, cigarettes_per_day, diabetes_status, bisphosphonates_status, anticoagulants_status, radiotherapy_status,
            osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure, hba1c::float as hba1c, hba1c_date::text
     from public.medical_history where patient_id = $1`,
    [patient],
  )).rows[0];

describe('medical history: tri-state risk factors', () => {
  it('a new patient starts with every risk factor not assessed', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate New');
      expect(await history(c, p)).toEqual({
        smoking: null, cigarettes_per_day: null, diabetes_status: null, bisphosphonates_status: null, anticoagulants_status: null,
        radiotherapy_status: null, osteoporosis_status: null, periodontitis_history: null, bruxism: null,
        previous_implant_failure: null, hba1c: null, hba1c_date: null,
      });
    });
  });

  it('an organizer with Edit on Patients saves the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Save');
      await c.query(
        `update public.medical_history set smoking = 'current', cigarettes_per_day = 10, diabetes_status = 'yes',
           hba1c = 7.2, hba1c_date = '2026-01-10', bruxism = 'no' where patient_id = $1`,
        [p],
      );
      expect(await history(c, p)).toMatchObject({
        smoking: 'current', cigarettes_per_day: 10, diabetes_status: 'yes', hba1c: 7.2, hba1c_date: '2026-01-10', bruxism: 'no',
      });
    });
  });

  it('refuses unknown values, cigarettes without current smoking, an HbA1c without its date, and a future HbA1c date', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Checks');
      const set = (sql: string) => c.query(`update public.medical_history set ${sql} where patient_id = $1`, [p]);
      await refused(c, () => set(`diabetes_status = 'maybe'`), /check/);
      await refused(c, () => set(`smoking = 'sometimes'`), /check/);
      await refused(c, () => set(`smoking = 'former', cigarettes_per_day = 5`), /check/);
      await refused(c, () => set(`smoking = 'current', cigarettes_per_day = 0`), /check/);
      await refused(c, () => set(`hba1c = 6.5`), /check/);
      await refused(c, () => set(`hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 3.9, hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 6.5, hba1c_date = '2999-01-01'`), /HbA1c date/);
    });
  });

  it('a viewer (View on Patients) and a delegate cannot change the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Viewer');
      await actAs(c, users.viewer);
      const viewer = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(viewer.rowCount).toBe(0);
      await actAs(c, users.delegate);
      const delegate = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(delegate.rowCount).toBe(0);
      await asPostgres(c);
      expect((await history(c, p)).bruxism).toBeNull();
    });
  });

  it('release window: an old-version boolean write reaches the new column; other saves leave it alone', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Sync');
      const set = (sql: string) => c.query(`update public.medical_history set ${sql} where patient_id = $1`, [p]);
      await set('smoker = true, diabetes = true, bisphosphonates = true, anticoagulants = true, radiotherapy_head_neck = true, osteoporosis = true');
      expect(await history(c, p)).toMatchObject({
        smoking: 'current', diabetes_status: 'yes', bisphosphonates_status: 'yes', anticoagulants_status: 'yes',
        radiotherapy_status: 'yes', osteoporosis_status: 'yes',
      });
      await set('smoker = false, diabetes = false');
      expect(await history(c, p)).toMatchObject({ smoking: 'never', diabetes_status: 'no' });
      // The new app sets a value; an old-version save that doesn't change the boolean leaves it.
      await set(`smoking = 'former'`);
      await set(`smoker = false, notes = 'old version save'`);
      expect((await history(c, p)).smoking).toBe('former');
    });
  });

  it('restore safety: inserting a row with a stale boolean keeps its tri-state value', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Restore');
      await asPostgres(c);
      await c.query('delete from public.medical_history where patient_id = $1', [p]);
      await c.query(
        `insert into public.medical_history (patient_id, smoker, smoking, diabetes, diabetes_status) values ($1, true, 'never', true, null)`,
        [p],
      );
      expect(await history(c, p)).toMatchObject({ smoking: 'never', diabetes_status: 'yes' });
    });
  });
});
