import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeSession } from './fixtures';

const users = inject('testUsers');

describe('booking override reason', () => {
  it('is not stored when the booking does not clash', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const d = await makeDelegate(c);
      await enroll(c, course, d);
      const patient = await makePatient(c);
      const slot = await book(c, { session, chair, patient, supervisor: users.organizer, placing: [d], override: 'Just in case' });
      const { rows } = await c.query('select override_reason from public.surgery_slots where id = $1', [slot]);
      expect(rows[0].override_reason).toBe('');
    });
  });
});

describe('patient search', () => {
  it('returns one row more than the 50 shown, so the page can say there are more', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      for (let i = 0; i < 55; i++) await makePatient(c, `Zz Limit Probe ${i}`);
      const { rows } = await c.query("select count(*)::int as n from public.search_patients('Zz Limit Probe', false)");
      expect(rows[0].n).toBe(51);
    });
  });
});
