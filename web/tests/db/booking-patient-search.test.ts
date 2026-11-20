import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { setPerms } from './fixtures';

const users = inject('testUsers');

// The booking form's patient picker searches with search_patients_v2 (0124). A Schedule editor with no Patients
// access must still find the patient to book (0032 lets schedule read patients).
describe('booking patient search', () => {
  it('schedule-only user can search', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query(
        `insert into public.patients (full_name, phone) values ('Zz Picker Patient', '0100 222 3333') returning id`,
      );
      const id = rows[0].id as string;
      await setPerms(c, users.target, { schedule: 'edit', patients: null });
      await actAs(c, users.target);
      const found = await c.query(
        `select id from public.search_patients_v2(q => $1, include_archived => false, stages => '{}', course => null,
           supervisor => null, p_offset => 0, p_limit => 10)`,
        ['Zz Picker Pat'],
      );
      expect(found.rows.map((r) => r.id)).toEqual([id]);

      // Not vacuous: with no Schedule either, the same search finds nothing.
      await setPerms(c, users.target, { schedule: null, patients: null });
      await actAs(c, users.target);
      const none = await c.query(
        `select id from public.search_patients_v2(q => $1, include_archived => false, stages => '{}', course => null,
           supervisor => null, p_offset => 0, p_limit => 10)`,
        ['Zz Picker Pat'],
      );
      expect(none.rows).toEqual([]);
    });
  });
});
