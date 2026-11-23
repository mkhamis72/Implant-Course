import { describe, it, expect, vi } from 'vitest';
import type { ImplantSite } from '@/lib/inventory/types';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: vi.fn() }));
import { SITE_SELECT, withPlannedProducts } from './chart-data';

const site = (id: string, planned: string | null) => ({ id, planned_product_id: planned }) as unknown as ImplantSite;

function client(rows: { id: string }[]) {
  const inIds = vi.fn(async () => ({ data: rows, error: null }));
  const select = vi.fn(() => ({ in: inIds }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, inIds };
}

describe('chart data: planned products (0141, no embed)', () => {
  it('does not embed the planned product through a key (the previous app version needs one key to products)', () => {
    expect(SITE_SELECT).not.toMatch(/planned_product_id_fkey/);
    expect(SITE_SELECT).toMatch(/planned_product_id/);
  });

  it('reads each planned product once and attaches it to its sites', async () => {
    const p1 = { id: 'p1', brand: 'Oxy' };
    const db = client([p1]);
    const sites = await withPlannedProducts(db.client, [site('a', 'p1'), site('b', 'p1'), site('c', null)]);
    expect(db.from).toHaveBeenCalledWith('products');
    expect(db.select).toHaveBeenCalledWith('*');
    expect(db.inIds).toHaveBeenCalledWith('id', ['p1']);
    expect(sites.map((s) => s.planned_product)).toEqual([p1, p1, null]);
  });

  it('makes no query when nothing was planned', async () => {
    const db = client([]);
    const sites = await withPlannedProducts(db.client, [site('a', null)]);
    expect(db.from).not.toHaveBeenCalled();
    expect(sites[0].planned_product).toBeNull();
  });
});
