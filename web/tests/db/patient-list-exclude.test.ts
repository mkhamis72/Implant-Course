import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { legacyFit, makeCourse, makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

// Patients list "is not" filters (0147): search_patients_v3 / search_patients_count_v2 take stages_not,
// course_not and supervisor_not; a null or empty filter ignores its flag.
type Args = {
  stages?: string[]; course?: string | null; supervisor?: string | null;
  stagesNot?: boolean; courseNot?: boolean; supervisorNot?: boolean;
};

const params = (a: Args) => [
  'Zz Excl', false, a.stages ?? [], a.course ?? null, a.supervisor ?? null,
  a.stagesNot ?? false, a.courseNot ?? false, a.supervisorNot ?? false,
];

async function v3(c: Client, a: Args): Promise<string[]> {
  const { rows } = await c.query(
    `select full_name from public.search_patients_v3(q => $1, include_archived => $2, stages => $3, course => $4,
       supervisor => $5, stages_not => $6, course_not => $7, supervisor_not => $8, p_offset => 0, p_limit => 100)`,
    params(a),
  );
  return rows.map((r) => r.full_name as string);
}

async function count(c: Client, a: Args): Promise<number> {
  const { rows } = await c.query(
    `select public.search_patients_count_v2(q => $1, include_archived => $2, stages => $3, course => $4,
       supervisor => $5, stages_not => $6, course_not => $7, supervisor_not => $8)::int as n`,
    params(a),
  );
  return rows[0].n;
}

/** The names, and checks the count agrees. */
async function names(c: Client, a: Args): Promise<string[]> {
  const list = await v3(c, a);
  expect(await count(c, a)).toBe(list.length);
  return list;
}

async function world(c: Client) {
  await actAs(c, users.organizer);
  const course1 = await makeCourse(c, '2030-03-01', '2030-03-05');
  const course2 = await makeCourse(c, '2030-04-01', '2030-04-05');
  const delegate = await makeDelegate(c, 'Zz Excl Delegate');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 10, 'ZZEXCL');
  const a = await makePatient(c, 'Zz Excl A');
  const siteA = await place(c, { patient: a, tooth: 36, product, lot, delegate, supervisor: users.organizer, course: course1 });
  await legacyFit(c, siteA, 'final_restoration', { delegate });
  const b = await makePatient(c, 'Zz Excl B');
  const siteB = await place(c, { patient: b, tooth: 46, product, lot, delegate, supervisor: users.admin, course: course2 });
  await legacyFit(c, siteB, 'cover_screw', { delegate });
  await makePatient(c, 'Zz Excl N');
  return { course1, course2 };
}

describe('patient list exclude filters (0147)', () => {
  it('stage is not: patients matching none of the ticked stages, including those with no implants', async () => {
    await withTx(async (c) => {
      await world(c);
      expect(await names(c, { stages: ['restored'] })).toEqual(['Zz Excl A']);
      expect(await names(c, { stages: ['restored'], stagesNot: true })).toEqual(['Zz Excl B', 'Zz Excl N']);
      expect(await names(c, { stages: ['restored', 'cover_screw'], stagesNot: true })).toEqual(['Zz Excl N']);
    });
  });

  it('course is not: no implant and no live booking in the course, patients with no course included', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await names(c, { course: w.course1 })).toEqual(['Zz Excl A']);
      expect(await names(c, { course: w.course1, courseNot: true })).toEqual(['Zz Excl B', 'Zz Excl N']);
      expect((await v3(c, { course: w.course1 })).sort()).toEqual(
        (await c.query(
          `select full_name from public.search_patients_v2(q => 'Zz Excl', include_archived => false, stages => '{}',
             course => $1, supervisor => null, p_offset => 0, p_limit => 100)`, [w.course1])).rows.map((r) => r.full_name),
      );
    });
  });

  it('supervisor is not mirrors course', async () => {
    await withTx(async (c) => {
      await world(c);
      expect(await names(c, { supervisor: users.organizer })).toEqual(['Zz Excl A']);
      expect(await names(c, { supervisor: users.organizer, supervisorNot: true })).toEqual(['Zz Excl B', 'Zz Excl N']);
    });
  });

  it('ignores a flag whose filter is empty, and combines the three filters', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const all = ['Zz Excl A', 'Zz Excl B', 'Zz Excl N'];
      expect(await names(c, { stagesNot: true, courseNot: true, supervisorNot: true })).toEqual(all);
      expect(await names(c, { stages: ['restored'], stagesNot: true, course: w.course2, courseNot: true })).toEqual(['Zz Excl N']);
      expect(await names(c, { stages: ['cover_screw'], course: w.course1, courseNot: true })).toEqual(['Zz Excl B']);
    });
  });
});
