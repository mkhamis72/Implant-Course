import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import {
  addTalk, book, enroll, makeChair, makeCourse, makeDelegate, makeLecturer, makePatient, makeSession,
} from './fixtures';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const TEACHING = ['courses', 'delegates', 'enrollments', 'lecturers', 'supervisors', 'talks', 'slot_delegates', 'study_courses'];
const OFF = /Courses, delegates and supervisors are not used in your plan\./;
const NO_DELEGATE_LOGINS = /Delegate logins are not used in your plan\./;

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const count = async (c: Client, table: string) => Number(await one(c, `select count(*)::int from public.${table}`));

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const asAdmin = (c: Client) => actAs(c, users.admin, { aal: 'aal2' });

async function clinic(c: Client) {
  await asPostgres(c);
  await c.query(`update public.companies set kind = 'clinic' where id = $1`, [ACADEMY]);
}

async function courseOrganizer(c: Client) {
  await asPostgres(c);
  await c.query(`update public.companies set kind = 'course_organizer' where id = $1`, [ACADEMY]);
}

/** One row in every teaching table, as the admin on Course organizer (Full). */
async function seedTeaching(c: Client) {
  await asAdmin(c);
  const course = await makeCourse(c);
  const surgery = await makeSession(c, course, 'surgery');
  const lecture = await makeSession(c, course, 'lecture');
  const lecturer = await makeLecturer(c);
  const talk = await addTalk(c, { session: lecture, lecturer });
  const delegate = await makeDelegate(c, 'Zz Teaching Delegate');
  await enroll(c, course, delegate);
  const supervisor = (await c.query(`insert into public.supervisors (full_name) values ('Zz Teaching Supervisor') returning id`)).rows[0].id;
  const patient = await makePatient(c, 'Zz Teaching Patient');
  const slot = await book(c, { session: surgery, chair: await makeChair(c), patient, supervisor, placing: [delegate] });
  const study = await one(c, `select public.save_study(null, 'Zz Teaching study', null, null, null, null, null, null, null, $1)`, [[course]]);
  return { course, surgery, lecture, lecturer, talk, delegate, supervisor, patient, slot, study: study as string };
}

describe('modules: teaching hidden in a clinic (0117)', () => {
  it('clinic reads no teaching rows', async () => {
    await withTx(async (c) => {
      const { surgery } = await seedTeaching(c);
      await asAdmin(c);
      for (const t of TEACHING) expect(await count(c, t), t).toBeGreaterThan(0);

      await clinic(c);
      await asAdmin(c);
      for (const t of TEACHING) expect(await count(c, t), t).toBe(0);
      // Sessions stay readable: a clinic keeps its clinic days.
      expect(await one(c, 'select count(*)::int from public.sessions where id = $1', [surgery])).toBe(1);
      expect(await count(c, 'course_options()')).toBe(0);
    });
  });

  it('teaching hidden and restored', async () => {
    await withTx(async (c) => {
      await seedTeaching(c);
      const fingerprint = async () => {
        await asAdmin(c);
        const out: Record<string, unknown> = {};
        for (const t of ['courses', 'delegates', 'enrollments', 'study_courses']) {
          out[t] = await one(c, `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.${t} x`);
        }
        return out;
      };
      const before = await fingerprint();

      await clinic(c);
      await asAdmin(c);
      // Saving a study in a clinic leaves its (hidden) courses alone, and refuses new ones.
      const study = await one(c, `select id from public.studies where title = 'Zz Teaching study'`);
      await c.query(`select public.save_study($1, 'Zz Teaching study', null, null, null, null, null, null, 'note', '{}')`, [study]);
      await refused(c, `select public.save_study(null, 'Zz Other', null, null, null, null, null, null, null, $1)`,
        [[crypto.randomUUID()]], OFF);
      await asPostgres(c);
      await c.query(`update public.studies set notes = null where id = $1`, [study]);

      await courseOrganizer(c);
      expect(await fingerprint()).toEqual(before);
    });
  });

  it('a delegate login in a clinic sees nothing', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await clinic(c);
      await actAs(c, users.delegate);
      expect(await count(c, `my_schedule('2000-01-01', '2100-01-01')`)).toBe(0);
      expect(await count(c, 'my_report()')).toBe(0);
      expect(await count(c, 'my_restorations()')).toBe(0);
    });
  });

  it('teaching writes are refused in a clinic', async () => {
    await withTx(async (c) => {
      const s = await seedTeaching(c);
      await clinic(c);
      await asAdmin(c);
      await refused(c, `select public.create_talk($1, '11:00', '12:00', $2, 'Zz topic')`, [s.lecture, s.lecturer], OFF);
      await refused(c, `select public.update_talk($1, '11:00', '12:00', $2, 'Zz topic')`, [s.talk, s.lecturer], OFF);
      await refused(c, 'select public.delete_talk($1)', [s.talk], OFF);
      await refused(c, 'select public.delete_course($1)', [s.course], OFF);
      await refused(c, 'select public.delete_delegate($1)', [s.delegate], OFF);
      await refused(c, `insert into public.lecturers (full_name) values ('Zz Clinic Lecturer')`, [], /row-level security/);
      await refused(c, `insert into public.supervisors (full_name) values ('Zz Clinic Supervisor')`, [], /row-level security/);
      expect(await count(c, `patient_course_options('${s.patient}')`)).toBe(0);
    });
  });

  it('delegate logins are refused in a clinic; staff logins are not', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const delegate = await one(c,
        `insert into public.delegates (company_id, full_name) values ($1, 'Zz Login Delegate') returning id`, [ACADEMY]);
      await clinic(c);
      await asAdmin(c);
      await refused(c, `select public.create_pending_login('zz-clinic-d@example.com', 'Zz', 'delegate', $1)`, [delegate], NO_DELEGATE_LOGINS);
      await refused(c, `select public.add_existing_member('zz-clinic-d@example.com', 'delegate', $1)`, [delegate], NO_DELEGATE_LOGINS);
      await refused(c, `select public.set_member_role($1, 'delegate')`, [users.organizer], NO_DELEGATE_LOGINS);
      await c.query(`select public.create_pending_login('zz-clinic-o@example.com', 'Zz', 'organizer', null)`);
    });
  });

  it('the console can choose Clinic', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('set local role service_role');
      const plan = await one(c, `select public.console_save_plan(null, 'Zz Clinic', 'clinic', '{}', 'x')`);
      await c.query(`select public.console_set_company_plan('academy', 'clinic', $1, '{}', 'x')`, [plan]);
      await refused(c, `select public.console_set_company_plan('academy', 'course_organizer', $1, '{}', 'x')`, [plan],
        /Choose a plan for this type of company\./);
      await asAdmin(c);
      expect(await one(c, `select public.module_on('teaching')`)).toBe(false);
    });
  });
});
