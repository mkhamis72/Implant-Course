// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const { fetchAll } = vi.hoisted(() => ({ fetchAll: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async () => ({ data: 0, error: null }) }) }));
vi.mock('@/lib/research/export/fetch-all', () => ({ fetchAll }));

import { loadFullArch } from './data';

const kase = (case_id: string, first_placed_on: string | null) => ({
  case_id, patient_id: 'p', file_no: '1', arch: 'upper', configuration: 'all_on_4', closed_at: null, first_placed_on,
  implants_placed: 0, implants_failed: 0, bridge_problems: 0, sites: [], bridges: [],
});

describe('loadFullArch', () => {
  it('lists the cases by first placement (none last), then case id, whatever order the pages came in', async () => {
    // fetchAll orders by case_id, which replaces the reader's own order.
    const cases = [kase('a', null), kase('b', '2025-03-01'), kase('c', '2025-01-01'), kase('d', '2025-03-01'), kase('e', null)];
    fetchAll.mockImplementation(async (_s: unknown, name: string) =>
      ({ data: name === 'analysis_full_arch_cases' ? cases : [], error: null }));
    const { cases: listed } = await loadFullArch({} as never);
    expect(listed.map((c) => c.case_id)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });
});
