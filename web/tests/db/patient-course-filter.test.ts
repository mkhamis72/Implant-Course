import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

// Patients list: filter by course and by supervisor (0098). A patient matches through a placed implant or a
// booking that is not cancelled.
async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await asPostgres(c);
  const prof = (await c.query("insert into public.supervisors (full_name) values ('Zz Filter Prof') returning id")).rows[0].id as string;
  await actAs(c, users.organizer);
  const courseA = await makeCourse(c, '2030-03-01', '2030-03-05');
  const courseB = await makeCourse(c, '2030-04-01', '2030-04-05');
  const sessionB = await makeSession(c, courseB, 'surgery', '2030-04-02');
  const delegate = await makeDelegate(c, 'Zz Filter Delegate');
  await enroll(c, courseB, delegate);
  const product = await makeProduct(c);
  const lot = await receive(c, product, 10, 'ZZFLT');
  // Implant in course A, supervised by the organizer.
  const viaImplant = await makePatient(c, 'Zz Filter Implant');
  await place(c, { patient: viaImplant, tooth: 36, product, lot, delegate, supervisor: users.organizer, course: courseA });
  // Booking only, in course B, supervised by the professor.
  const viaBooking = await makePatient(c, 'Zz Filter Booking');
  await book(c, { session: sessionB, chair, patient: viaBooking, supervisor: prof, placing: [delegate], implants: [{ tooth: 46 }] });
  // A cancelled booking in course B counts for nothing.
  const cancelled = await makePatient(c, 'Zz Filter Cancelled');
  const slot = await book(c, { session: sessionB, chair, patient: cancelled, supervisor: prof, placing: [delegate], start: '11:00', end: '12:00' });
  await asPostgres(c);
  await c.query("update public.surgery_slots set status = 'cancelled' where id = $1", [slot]);
  await actAs(c, users.organizer);
  const neither = await makePatient(c, 'Zz Filter Neither');
  return { courseA, courseB, prof, viaImplant, viaBooking, cancelled, neither };
}

async function search(c: Client, args: { q?: string; stages?: string[]; course?: string | null; supervisor?: string | null }) {
  const { rows } = await c.query(
    'select full_name from public.patient_list_matches(q => $1, include_archived => false, stages => $2, course => $3, supervisor => $4) order by full_name',
    [args.q ?? 'Zz Filter', args.stages ?? [], args.course ?? null, args.supervisor ?? null],
  );
  return rows.map((r) => r.full_name as string);
}

describe('patient list: course and supervisor filters', () => {
  it('matches a course through a placed implant or a booking that is not cancelled', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await search(c, { course: w.courseA })).toEqual(['Zz Filter Implant']);
      expect(await search(c, { course: w.courseB })).toEqual(['Zz Filter Booking']);
      expect(await search(c, {})).toEqual(['Zz Filter Booking', 'Zz Filter Cancelled', 'Zz Filter Implant', 'Zz Filter Neither']);
    });
  });

  it('matches a supervisor through a placed implant or a booking that is not cancelled', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await search(c, { supervisor: w.prof })).toEqual(['Zz Filter Booking']);
      expect(await search(c, { supervisor: users.organizer })).toEqual(['Zz Filter Implant']);
    });
  });

  it('combines with the text search, the stages and each other', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await search(c, { q: 'Booking', course: w.courseA })).toEqual([]);
      expect(await search(c, { course: w.courseB, supervisor: w.prof })).toEqual(['Zz Filter Booking']);
      expect(await search(c, { course: w.courseA, supervisor: w.prof })).toEqual([]);
      expect(await search(c, { course: w.courseA, stages: ['missing'] })).toEqual([]);
    });
  });

  it('the old list searches are gone (0152): only the paged ones and the booking picker remain', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'search_patients%' order by proname");
      expect(rows.map((r) => r.proname)).toEqual(['search_patients_count_v2', 'search_patients_v2', 'search_patients_v3']);
    });
  });
});
