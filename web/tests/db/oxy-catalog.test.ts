import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

describe('Oxy catalogue (0026)', () => {
  it('loads the approved Oxy PSK-MDK and MD EXT products, active and verified', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select type::text, count(*)::int as n from public.products
         where brand = 'Oxy Implant' and active and not is_sample group by type order by type`,
      );
      expect(rows).toEqual([
        { type: 'abutment_angled', n: 42 },
        { type: 'abutment_straight', n: 23 },
        { type: 'healing_abutment', n: 23 },
        { type: 'implant', n: 92 },
        { type: 'multi_unit', n: 14 },
        { type: 'ti_base', n: 26 },
      ]);
      const refs = await c.query(
        `select count(*)::int as n, count(distinct ref_code)::int as d from public.products where brand = 'Oxy Implant'`,
      );
      expect(refs.rows[0].n).toBe(refs.rows[0].d);
    });
  });

  it('spot-checks implant sizes against their reference codes', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select ref_code, system, platform, diameter_mm::float8 as d, length_mm::float8 as l from public.products
         where brand = 'Oxy Implant' and ref_code in ('PSKR35070', 'PSK40200NT', 'OMKR42100', 'OMKN30150', 'OMEX33130')
         order by ref_code`,
      );
      expect(rows).toEqual([
        { ref_code: 'OMEX33130', system: 'MD EXT · Mini', platform: 'External hex 3.3', d: 3.3, l: 13 },
        { ref_code: 'OMKN30150', system: 'PSK-MDK · MDK Medium Narrow', platform: 'Mini conical', d: 3, l: 15 },
        { ref_code: 'OMKR42100', system: 'PSK-MDK · MDK Medium', platform: 'Standard conical', d: 4.25, l: 10 },
        { ref_code: 'PSK40200NT', system: 'PSK-MDK · PSK Normo', platform: 'Standard conical', d: 4, l: 20 },
        { ref_code: 'PSKR35070', system: 'PSK-MDK · PSK Micro', platform: 'Standard conical', d: 3.5, l: 7 },
      ]);
    });
  });

  it('deactivates the sample products from 0008 but keeps them for reactivation', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select count(*) filter (where active)::int as active, count(*)::int as kept from public.products
         where is_sample and brand in ('Straumann', 'Nobel Biocare', 'Neodent', 'MIS', 'Osstem', 'Geistlich')`,
      );
      expect(rows[0].active).toBe(0);
      expect(rows[0].kept).toBeGreaterThan(0);
    });
  });
});
