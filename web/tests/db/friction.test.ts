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
