import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

/**
 * Every table that belongs to a switchable feature, and the permission area that guards it. A new table or
 * security-definer function touching one of them must check the feature (module_on) or the area (can /
 * require_perm), or be listed in ALLOWED with the reason it may skip the check.
 */
const MODULE_TABLES: Record<string, { area: string; tables: string[]; allowed: Record<string, string> }> = {
  statistics: {
    area: 'research',
    tables: ['research_exports', 'studies', 'saved_analyses', 'study_courses'],
    allowed: {},
  },
  inventory: {
    area: 'inventory',
    tables: ['stock_lots', 'stock_movements'],
    allowed: {
      delete_patient: 'ledger purge: deletes the movements of what it removes, whatever the module',
      remove_placement: 'ledger purge: deletes the movements of what it removes, whatever the module',
      correct_placement_v2: "reads the implant's own lot expiry only",
      correct_placement_v3: "reads the implant's own lot expiry only",
    },
  },
  // release 3
  teaching: { area: 'courses', tables: [], allowed: {} },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('module guards', () => {
  for (const [feature, { area, tables }] of Object.entries(MODULE_TABLES)) {
    for (const table of tables) {
      it(`${table} has a restrictive ${feature} read policy`, async () => {
        await withTx(async (c) => {
          const { rows } = await c.query(
            `select policyname, qual from pg_policies
             where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE' and cmd = 'SELECT'`,
            [table],
          );
          const guard = new RegExp(`module_on\\('${escape(feature)}'|can\\('${escape(area)}'`);
          expect(rows.filter((r) => guard.test(r.qual ?? '')).map((r) => r.policyname), table).not.toEqual([]);
        });
      });
    }
  }

  it('security definer functions that touch a feature table check the feature', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query<{ proname: string; src: string }>(
        `select p.proname, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      );
      const missing: string[] = [];
      for (const [feature, { area, tables, allowed }] of Object.entries(MODULE_TABLES)) {
        const guard = new RegExp(`module_on\\('${escape(feature)}'\\)|can\\('${escape(area)}'|require_perm\\('${escape(area)}'`);
        for (const { proname, src } of rows) {
          const touched = tables.filter((t) => new RegExp(`\\b${escape(t)}\\b`).test(src));
          if (touched.length && !guard.test(src) && !(proname in allowed)) missing.push(`${feature}: ${proname} (${touched.join(', ')})`);
        }
      }
      expect(missing).toEqual([]);
    });
  });

  it('every ALLOWED entry still touches one of its feature tables (no stale entries)', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query<{ proname: string; src: string }>(
        `select p.proname, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      );
      const stale: string[] = [];
      for (const [feature, { tables, allowed }] of Object.entries(MODULE_TABLES)) {
        for (const name of Object.keys(allowed)) {
          const touches = rows.some(({ proname, src }) =>
            proname === name && tables.some((t) => new RegExp(`\\b${escape(t)}\\b`).test(src)));
          if (!touches) stale.push(`${feature}: ${name}`);
        }
      }
      expect(stale).toEqual([]);
    });
  });
});
