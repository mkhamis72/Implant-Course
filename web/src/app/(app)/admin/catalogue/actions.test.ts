import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { saveCatalogue } from './actions';

const form = (o: Record<string, string[]>) => {
  const f = new FormData();
  for (const [k, vs] of Object.entries(o)) for (const v of vs) f.append(k, v);
  return f;
};

beforeEach(() => vi.clearAllMocks());

describe('saveCatalogue', () => {
  it('saves every change in one call (0132) and reports the counts', async () => {
    rpc.mockResolvedValue({ data: [{ switched_on: 2, switched_off: 1 }], error: null });
    const r = await saveCatalogue({}, form({ on_item: ['i1', 'i2'], off_item: ['i3'], off_product: ['p1'] }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('save_catalogue', {
      p_items_on: ['i1', 'i2'], p_items_off: ['i3'], p_products_on: [], p_products_off: ['p1'],
    });
    expect(r).toEqual({ ok: 'Saved: 2 switched on, 1 switched off.' });
  });

  it('shows a refused change and saves nothing else', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This product is no longer in the catalogue.', hint: 'user' } });
    const r = await saveCatalogue({}, form({ on_item: ['i1'] }));
    expect(r).toEqual({ error: 'This product is no longer in the catalogue.' });
  });
});
