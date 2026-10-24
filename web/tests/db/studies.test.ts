import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeCourse, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n%test\n');
const IN_USE = "This study is named on an export and can't be deleted.";

type Study = {
  id?: string | null; title?: string; committee?: string | null; approvalNumber?: string | null; approvalDate?: string | null;
  protocolName?: string | null; protocolVersion?: string | null; protocolDate?: string | null; notes?: string | null;
  courses?: string[] | null;
};
const save = async (c: Client, s: Study = {}) =>
  (await c.query(
    `select public.save_study(p_id => $1, p_title => $2, p_committee => $3, p_approval_number => $4,
       p_approval_date => $5::date, p_protocol_name => $6, p_protocol_version => $7, p_protocol_date => $8::date,
       p_notes => $9, p_courses => $10::uuid[]) as id`,
    [s.id ?? null, s.title ?? 'Zz Study', s.committee ?? null, s.approvalNumber ?? null, s.approvalDate ?? null,
     s.protocolName ?? null, s.protocolVersion ?? null, s.protocolDate ?? null, s.notes ?? null, s.courses ?? []],
  )).rows[0].id as string;

const setLetter = (c: Client, study: string, file: Buffer, type: string) =>
  c.query('select public.set_study_letter($1, $2, $3)', [study, file, type]);

const courseIds = async (c: Client, study: string) =>
  (await c.query('select course_id from public.study_courses where study_id = $1 order by course_id', [study])).rows
    .map((r) => r.course_id as string);

const listed = async (c: Client, id: string) =>
  (await c.query('select * from public.studies_list() where id = $1', [id])).rows;

const fileCount = async (c: Client) => {
  await asPostgres(c);
  return Number((await c.query('select count(*) as n from public.stored_files')).rows[0].n);
};

describe('research edit level', () => {
  it('Research Edit is grantable; Edit saves a study, View cannot', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query(`select public.set_user_permissions($1, '{"research": "edit", "patients": "view"}'::jsonb)`, [users.target]);
      await asPostgres(c);
      const saved = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [users.target]);
      expect(saved.rows).toEqual([{ area: 'patients', level: 'view' }, { area: 'research', level: 'edit' }]);

      await actAs(c, users.target);
      const id = await save(c, { title: 'Zz Edit Study' });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      await setPerms(c, users.target, { research: 'view', patients: 'edit' });
      await actAs(c, users.target);
      await refused(c, () => save(c, { title: 'Zz View Study' }), /You don't have permission to edit Research/);
      await refused(c, () => save(c, { id, title: 'Zz Renamed' }), /You don't have permission to edit Research/);
      await refused(c, () => setLetter(c, id, JPEG, 'image/jpeg'), /You don't have permission to edit Research/);
      await refused(c, () => c.query('select public.clear_study_letter($1)', [id]), /You don't have permission to edit Research/);
      await refused(c, () => c.query(`insert into public.studies (title) values ('Zz direct')`), /permission denied/);
      await refused(c, () => c.query('update public.studies set title = $2 where id = $1', [id, 'x']), /permission denied/);
    });
  });
});

describe('save_study', () => {
  it('inserts, edits and replaces the course set', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const [a, b, d] = [await makeCourse(c), await makeCourse(c), await makeCourse(c)];
      const id = await save(c, {
        title: '  Zz Bone Study  ', committee: 'Cairo REC', approvalNumber: 'REC-12', approvalDate: '2026-01-10',
        protocolName: 'Short implants', protocolVersion: '2.1', protocolDate: '2025-12-01', notes: 'note', courses: [a, b],
      });
      expect((await courseIds(c, id))).toEqual([a, b].sort());
      const row = (await c.query(
        `select title, committee, approval_number, approval_date::text, protocol_name, protocol_version, protocol_date::text,
                notes, letter_file_id from public.studies where id = $1`, [id])).rows[0];
      expect(row).toEqual({
        title: 'Zz Bone Study', committee: 'Cairo REC', approval_number: 'REC-12', approval_date: '2026-01-10',
        protocol_name: 'Short implants', protocol_version: '2.1', protocol_date: '2025-12-01', notes: 'note', letter_file_id: null,
      });

      expect(await save(c, { id, title: 'Zz Bone Study 2', committee: '  ', courses: [b, d, d] })).toBe(id);
      expect(await courseIds(c, id)).toEqual([b, d].sort());
      const edited = (await c.query('select title, committee from public.studies where id = $1', [id])).rows[0];
      expect(edited).toEqual({ title: 'Zz Bone Study 2', committee: null });

      await save(c, { id, title: 'Zz Bone Study 2', courses: null });
      expect(await courseIds(c, id)).toEqual([]);
    });
  });

  it('refuses a missing title, a future approval date, unknown courses and studies', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await refused(c, () => save(c, { title: '   ' }), /Enter the study title/);
      const tomorrow = (await c.query('select (public.cairo_today() + 1)::text as d')).rows[0].d as string;
      await refused(c, () => save(c, { approvalDate: tomorrow }), /The approval date can't be in the future/);
      const today = (await c.query('select public.cairo_today()::text as d')).rows[0].d as string;
      await save(c, { approvalDate: today });
      await refused(c, () => save(c, { courses: ['00000000-0000-0000-0000-000000000000'] }), /Course not found/);
      await refused(c, () => save(c, { id: '00000000-0000-0000-0000-000000000000' }), /Study not found/);
    });
  });
});

describe('study letter', () => {
  it('takes a JPEG or PDF up to 2 MB, replaces and clears the stored file', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await save(c);
      const before = await fileCount(c);

      await actAs(c, users.admin);
      await refused(c, () => setLetter(c, id, Buffer.from('GIF89a'), 'image/jpeg'), /Upload a JPEG image or a PDF/);
      await refused(c, () => setLetter(c, id, PDF, 'image/jpeg'), /Upload a JPEG image or a PDF/);
      await refused(c, () => setLetter(c, id, JPEG, 'image/png'), /Upload a JPEG image or a PDF/);
      await refused(c, () => setLetter(c, id, Buffer.alloc(0), 'application/pdf'), /Upload the approval letter/);
      const big = Buffer.concat([PDF, Buffer.alloc(2097152)]);
      await refused(c, () => setLetter(c, id, big, 'application/pdf'), /2 MB at most/);
      await refused(c, () => setLetter(c, '00000000-0000-0000-0000-000000000000', PDF, 'application/pdf'), /Study not found/);

      await setLetter(c, id, JPEG, 'image/jpeg');
      expect(await fileCount(c)).toBe(before + 1);
      await actAs(c, users.admin);
      expect((await c.query('select * from public.study_letter($1)', [id])).rows).toEqual([{ bytes: JPEG, content_type: 'image/jpeg' }]);
      expect((await listed(c, id))[0].has_letter).toBe(true);

      await setLetter(c, id, PDF, 'application/pdf');
      expect(await fileCount(c)).toBe(before + 1);
      await actAs(c, users.admin);
      expect((await c.query('select * from public.study_letter($1)', [id])).rows).toEqual([{ bytes: PDF, content_type: 'application/pdf' }]);

      await c.query('select public.clear_study_letter($1)', [id]);
      expect(await fileCount(c)).toBe(before);
      await actAs(c, users.admin);
      expect((await c.query('select * from public.study_letter($1)', [id])).rows).toEqual([]);
      expect((await listed(c, id))[0].has_letter).toBe(false);
    });
  });
});

describe('delete_study', () => {
  it('is admin only, refused once an export names the study, and removes the letter', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const course = await makeCourse(c);
      const used = await save(c, { title: 'Zz Used Study' });
      const free = await save(c, { title: 'Zz Free Study', courses: [course] });
      await setLetter(c, free, PDF, 'application/pdf');
      const before = await fileCount(c);

      await actAs(c, users.admin);
      await c.query(`select public.log_research_export('csv', jsonb_build_object('study', $1::text), '{}'::jsonb)`, [used]);

      await setPerms(c, users.target, { research: 'edit', patients: 'edit' });
      await actAs(c, users.target);
      await refused(c, () => c.query('select public.delete_study($1)', [free]), /Only an admin can delete a study/);

      await actAs(c, users.admin);
      await refused(c, () => c.query('select public.delete_study($1)', [used]), new RegExp(IN_USE.replace(/[.']/g, '.')));
      await refused(c, () => c.query('select public.delete_study($1)', ['00000000-0000-0000-0000-000000000000']), /Study not found/);
      await c.query('select public.delete_study($1)', [free]);
      expect(await fileCount(c)).toBe(before - 1);
      expect((await c.query('select count(*)::int as n from public.study_courses where study_id = $1', [free])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.studies where id = $1', [free])).rows[0].n).toBe(0);
    });
  });

  it('deleting a course drops it from the study', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const course = await makeCourse(c);
      const id = await save(c, { courses: [course] });
      await c.query('select public.delete_course($1)', [course]);
      expect(await courseIds(c, id)).toEqual([]);
    });
  });
});

describe('log_research_export study link', () => {
  it('works without a study, records a valid one and refuses an unknown one', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const study = await save(c);
      await setPerms(c, users.target, { patients: 'view', research: 'view' });
      await actAs(c, users.target);
      const plain = (await c.query(`select public.log_research_export('xlsx', '{"brand":"X"}'::jsonb, '{}'::jsonb) as id`)).rows[0].id;
      const nullStudy = (await c.query(`select public.log_research_export('csv', '{"study":null}'::jsonb, '{}'::jsonb) as id`)).rows[0].id;
      const linked = (await c.query(
        `select public.log_research_export('csv', jsonb_build_object('study', $1::text), '{}'::jsonb) as id`, [study])).rows[0].id;
      await refused(
        c, () => c.query(`select public.log_research_export('csv', '{"study":"00000000-0000-0000-0000-000000000000"}'::jsonb, '{}'::jsonb)`),
        /Study not found/,
      );
      await refused(c, () => c.query(`select public.log_research_export('csv', '{"study":"nope"}'::jsonb, '{}'::jsonb)`), /Study not found/);

      await actAs(c, users.admin);
      const rows = (await c.query('select id, study_id from public.research_exports where id = any($1::uuid[])', [[plain, nullStudy, linked]])).rows;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.study_id]));
      expect(byId).toEqual({ [plain]: null, [nullStudy]: null, [linked]: study });
    });
  });
});

describe('study readers', () => {
  it('need Research view and Patients view; admins read; delegates never', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const course = await makeCourse(c, '2030-04-01', '2030-04-05');
      await c.query(`update public.courses set name = 'Zz Study Course' where id = $1`, [course]);
      const id = await save(c, { title: 'Zz Reader Study', committee: 'REC', courses: [course] });
      await setLetter(c, id, JPEG, 'image/jpeg');

      await actAs(c, users.admin);
      const row = (await listed(c, id))[0];
      expect(row).toMatchObject({ title: 'Zz Reader Study', committee: 'REC', has_letter: true, on_export: false });
      expect(row.courses).toEqual([{ id: course, name: 'Zz Study Course', start_date: '2030-04-01' }]);

      const sees = async () => ({
        list: (await listed(c, id)).length,
        table: (await c.query('select count(*)::int as n from public.studies where id = $1', [id])).rows[0].n as number,
        links: (await c.query('select count(*)::int as n from public.study_courses where study_id = $1', [id])).rows[0].n as number,
        letter: (await c.query('select * from public.study_letter($1)', [id])).rows.length,
      });

      // Research view + Patients view (no Courses view): everything, course names included.
      await setPerms(c, users.target, { research: 'view', patients: 'view' });
      await actAs(c, users.target);
      expect(await sees()).toEqual({ list: 1, table: 1, links: 1, letter: 1 });
      expect((await listed(c, id))[0].courses).toEqual([{ id: course, name: 'Zz Study Course', start_date: '2030-04-01' }]);

      // Research view without Patients view: nothing.
      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      expect(await sees()).toEqual({ list: 0, table: 0, links: 0, letter: 0 });

      // Patients edit without Research: nothing.
      await setPerms(c, users.target, { patients: 'edit' });
      await actAs(c, users.target);
      expect(await sees()).toEqual({ list: 0, table: 0, links: 0, letter: 0 });

      await actAs(c, users.delegate);
      expect(await sees()).toEqual({ list: 0, table: 0, links: 0, letter: 0 });
    });
  });

  it('audits studies and study_courses', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const course = await makeCourse(c);
      const id = await save(c, { courses: [course] });
      await asPostgres(c);
      const tables = (await c.query('select distinct table_name from public.audit_log where row_id = $1 order by 1', [id])).rows
        .map((r) => r.table_name);
      expect(tables).toEqual(['studies', 'study_courses']);
    });
  });
});
