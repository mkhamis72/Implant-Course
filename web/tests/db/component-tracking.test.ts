import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

describe('component tracking (0133–0135)', () => {
  it('has the new component and product types', async () => {
    await withTx(async (c) => {
      const comp = await c.query(`select unnest(enum_range(null::public.component_type))::text as v`);
      const prod = await c.query(`select unnest(enum_range(null::public.product_type))::text as v`);
      const compVals = comp.rows.map((r) => r.v);
      const prodVals = prod.rows.map((r) => r.v);
      expect(compVals).toEqual(
        expect.arrayContaining([
          'healing_cap', 'temporary_abutment', 'scan_body', 'impression_coping',
          'abutment_screw', 'prosthetic_screw', 'temporary_cylinder_screw',
        ]),
      );
      expect(prodVals).toEqual(expect.arrayContaining(['healing_cap', 'temporary_abutment', 'abutment_screw']));
    });
  });
});
