import { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, asCompany, asPostgres } from './helpers';
import { makeChair, makeCourse, makePatient, makeSession } from './fixtures';

// Clinic workflow (0122): a clinic books by date (its hidden clinic day is found or made), with a setting.

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const CLINIC_ONLY = /Dates and settings are set on clinic bookings only\./;

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const asAdmin = (c: Client) => actAs(c, users.admin, { aal: 'aal2' });

async function setKind(c: Client, kind: 'clinic' | 'course_organizer') {
  await asPostgres(c);
  await c.query(`update public.companies set kind = $2 where id = $1`, [ACADEMY, kind]);
}

/** A date no other test or leftover uses: a random day in the 2080s. */
const freshDate = async (c: Client) =>
  (await one(c, `select to_char('2080-01-01'::date + floor(random() * 3650)::int, 'YYYY-MM-DD')`)) as string;

type Seed = { chair: string; patient: string; doctor: string };

/** A chair, a patient and a doctor, written as postgres bound to academy. */
async function seed(c: Client, name: string): Promise<Seed> {
  await asCompany(c);
  const chair = await makeChair(c);
  const patient = await makePatient(c, `Zz Clinic ${name} Patient`);
  const doctor = (await one(c, `insert into public.doctors (name) values ($1) returning id`, [`Zz Dr Clinic ${name}`])) as string;
  return { chair, patient, doctor };
}

type V3 = {
  session?: string | null; chair: string; patient: string; doctor: string; start?: string; end?: string;
  setting?: string | null; date?: string | null; override?: string; supervisor?: string | null;
};
const CREATE_SQL = `select public.create_surgery_slot_v3(
  p_session => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_patient => $5, p_supervisor => $6,
  p_placing => '{}'::uuid[], p_assisting => '{}'::uuid[], p_implants => '[]'::jsonb, p_override_reason => $7,
  p_notes => '', p_placing_doctor => $8, p_setting => $9, p_date => $10::date) as id`;
const createParams = (a: V3) => [a.session ?? null, a.chair, a.start ?? '09:00', a.end ?? '10:00', a.patient,
  a.supervisor ?? null, a.override ?? '', a.doctor, a.setting ?? null, a.date ?? null];
const create = async (c: Client, a: V3) => (await one(c, CREATE_SQL, createParams(a))) as string;

const UPDATE_SQL = `select public.update_surgery_slot_v3(
  p_slot => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_supervisor => null,
  p_placing => '{}'::uuid[], p_assisting => '{}'::uuid[], p_override_reason => '', p_notes => '',
  p_placing_doctor => $5, p_setting => $6, p_date => $7::date)`;

/** Course-less surgery sessions on a date (as postgres: every company's, so the count is honest). */
const clinicDays = async (c: Client, date: string) =>
  Number(await one(c, `select count(*)::int from public.sessions
    where company_id = $1 and date = $2 and course_id is null and type = 'surgery'`, [ACADEMY, date]));

describe('clinic booking by date (0122)', () => {
  it('books without a day', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Day');
      const date = await freshDate(c);
      await setKind(c, 'clinic');
      await asAdmin(c);
      const slot = await create(c, { ...s, date, setting: 'hospital_ga' });

      await asPostgres(c);
      expect(await clinicDays(c, date)).toBe(1);
      const { rows } = await c.query(
        `select s.title, s.date::text as date, s.start_time::text as st, s.end_time::text as et, s.course_id, x.setting,
                to_char(x.starts_at at time zone 'Africa/Cairo', 'HH24:MI') as at
         from public.surgery_slots x join public.sessions s on s.id = x.session_id where x.id = $1`, [slot]);
      expect(rows[0]).toEqual({ title: 'Clinic day', date, st: '00:00:00', et: '23:59:00', course_id: null,
        setting: 'hospital_ga', at: '09:00' });
    });
  });

  it('second booking reuses the day', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Reuse');
      const date = await freshDate(c);
      await setKind(c, 'clinic');
      await asAdmin(c);
      const a = await create(c, { ...s, date, setting: 'clinic' });
      const b = await create(c, { ...s, date, start: '11:00', end: '12:00', setting: 'clinic' });

      await asPostgres(c);
      expect(await clinicDays(c, date)).toBe(1);
      expect(await one(c, `select count(distinct session_id)::int from public.surgery_slots where id = any($1)`, [[a, b]])).toBe(1);
    });
  });

  it('clinic refuses a surgery day and needs a date', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Refuse');
      const date = await freshDate(c);
      await setKind(c, 'clinic');
      await asAdmin(c);
      const slot = await create(c, { ...s, date });
      const day = await one(c, `select session_id from public.surgery_slots where id = $1`, [slot]);
      await refused(c, CREATE_SQL, createParams({ ...s, session: day as string, start: '11:00', end: '12:00' }),
        /Clinic bookings take a date, not a surgery day\./);
      await refused(c, CREATE_SQL, createParams({ ...s, start: '11:00', end: '12:00' }), /Choose a date\./);
    });
  });

  it('concurrent bookings share one day', async () => {
    const setup = new Client(pgConfig());
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await Promise.all([setup.connect(), a.connect(), b.connect()]);
    const before = (await setup.query(`select kind, plan_id from public.companies where id = $1`, [ACADEMY])).rows[0];
    let s: Seed | undefined;
    let date = '';
    try {
      // Committed so the other connections see them; deleted in finally.
      await setup.query('begin');
      s = await seed(setup, `Race ${Math.random().toString(36).slice(2, 8)}`);
      date = await freshDate(setup);
      await setKind(setup, 'clinic');
      await setup.query('commit');

      await a.query('begin');
      await asAdmin(a);
      await b.query('begin');
      await asAdmin(b);
      await create(a, { ...s, date }); // holds the day's lock until it commits
      const second = create(b, { ...s, date, start: '11:00', end: '12:00' }); // waits for it
      await new Promise((r) => setTimeout(r, 300));
      await a.query('commit');
      await second;
      await b.query('commit');

      expect(await clinicDays(setup, date)).toBe(1);
    } finally {
      await a.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      await setup.query('rollback').catch(() => {});
      await setup.query('reset role');
      await setup.query(`update public.companies set kind = $2, plan_id = $3 where id = $1`, [ACADEMY, before.kind, before.plan_id]);
      if (s) {
        await setup.query(`delete from public.surgery_slots where patient_id = $1`, [s.patient]);
        if (date) {
          await setup.query(`delete from public.sessions where company_id = $1 and date = $2 and course_id is null`, [ACADEMY, date]);
        }
        await setup.query(`delete from public.patients where id = $1`, [s.patient]);
        await setup.query(`delete from public.doctors where id = $1`, [s.doctor]);
        await setup.query(`delete from public.chairs where id = $1`, [s.chair]);
      }
      await Promise.all([setup.end(), a.end(), b.end()]);
    }
  });

  it('date move', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Move');
      const d1 = await freshDate(c);
      const d2 = (await one(c, `select to_char($1::date + 1, 'YYYY-MM-DD')`, [d1])) as string;
      await setKind(c, 'clinic');
      await asAdmin(c);
      const moving = await create(c, { ...s, date: d1, setting: 'clinic' });
      const staying = await create(c, { ...s, date: d1, start: '11:00', end: '12:00' });
      await c.query(UPDATE_SQL, [moving, s.chair, '14:00', '15:00', s.doctor, 'hospital_ga', d2]);

      await asPostgres(c);
      const row = async (slot: string) => (await c.query(
        `select s.date::text as date, s.title, x.setting, to_char(x.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as at
         from public.surgery_slots x join public.sessions s on s.id = x.session_id where x.id = $1`, [slot])).rows[0];
      expect(await row(moving)).toEqual({ date: d2, title: 'Clinic day', setting: 'hospital_ga', at: `${d2} 14:00` });
      expect((await row(staying)).date).toBe(d1);
      expect(await clinicDays(c, d1)).toBe(1);
      expect(await clinicDays(c, d2)).toBe(1);
    });
  });

  it('bad setting refused', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Garden');
      const date = await freshDate(c);
      await setKind(c, 'clinic');
      await asAdmin(c);
      await refused(c, CREATE_SQL, createParams({ ...s, date, setting: 'garden' }), /check constraint/);
    });
  });

  it('organizer unchanged', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Organizer');
      const date = await freshDate(c);
      await setKind(c, 'course_organizer');
      await asAdmin(c);
      const course = await makeCourse(c, date, date);
      const session = await makeSession(c, course, 'surgery', date);
      const slot = await create(c, { ...s, session });
      expect(await one(c, `select session_id from public.surgery_slots where id = $1`, [slot])).toBe(session);
      expect(await one(c, `select setting from public.surgery_slots where id = $1`, [slot])).toBeNull();

      await refused(c, CREATE_SQL, createParams({ ...s, session, start: '11:00', end: '12:00', date }), CLINIC_ONLY);
      await refused(c, CREATE_SQL, createParams({ ...s, session, start: '11:00', end: '12:00', setting: 'clinic' }), CLINIC_ONLY);
      await refused(c, CREATE_SQL, createParams({ ...s, start: '11:00', end: '12:00' }), /Choose a surgery day\./);
      await refused(c, UPDATE_SQL, [slot, s.chair, '09:00', '10:00', s.doctor, null, date], CLINIC_ONLY);
      await refused(c, UPDATE_SQL, [slot, s.chair, '09:00', '10:00', s.doctor, 'clinic', null], CLINIC_ONLY);
      await c.query(UPDATE_SQL, [slot, s.chair, '09:30', '10:30', s.doctor, null, null]);
      expect(await one(c, `select to_char(starts_at at time zone 'Africa/Cairo', 'HH24:MI') from public.surgery_slots where id = $1`,
        [slot])).toBe('09:30');
    });
  });

  it('clash still checked', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Clash');
      const other = await seed(c, 'Clash Other');
      const date = await freshDate(c);
      await setKind(c, 'clinic');
      await asAdmin(c);
      await create(c, { ...s, date });
      // Same doctor, same time, another chair and patient.
      const twice = { ...other, doctor: s.doctor, date };
      await refused(c, CREATE_SQL, createParams(twice), /clashes with another surgery/);
      await create(c, { ...twice, override: 'Two rooms' });
    });
  });
});
