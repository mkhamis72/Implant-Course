import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

/** Previous versions the app stopped calling once their replacements shipped (0131). */
const DROPPED = [
  'place_implant_v3', 'correct_placement_v2', 'create_surgery_slot', 'create_surgery_slot_v2', 'create_surgery_slot_v3',
  'update_surgery_slot', 'update_surgery_slot_v2', 'slot_conflicts', 'create_pending_login',
];
const KEPT = ['place_implant_v4', 'correct_placement_v3', 'create_surgery_slot_v4', 'update_surgery_slot_v3', 'slot_conflicts_v2',
  'create_pending_login_v2'];

describe('previous function versions are dropped (0131)', () => {
  it('leaves only the versions the app calls', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1)`, [[...DROPPED, ...KEPT]]);
      const names = rows.map((r) => r.proname).sort();
      expect(names).toEqual([...KEPT].sort());
    });
  });
});
