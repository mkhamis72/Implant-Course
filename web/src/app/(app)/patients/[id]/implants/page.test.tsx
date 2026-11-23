import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({ features: ['inventory', 'teaching'] })) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ from, rpc })) }));
import ImplantsPage from './page';

const site = (over: Record<string, unknown>) => ({
  id: 's', tooth: 14, state: 'placed', technique: 'guided', placed_on: '2026-11-01', torque_ncm: null, isq: null, bone_type: null,
  graft: null, product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, doctor: null,
  components: [], followups: [], complications: [], surgery: null, grafts: [], implant_type: 'conventional', ...over,
});

describe('Implants page', () => {
  it('has a Type column with the short label, none for a conventional implant', async () => {
    const rows = [site({ id: 'a', tooth: 14, implant_type: 'zygomatic' }), site({ id: 'b', tooth: 15, implant_type: 'tilted' }), site({ id: 'c', tooth: 16 })];
    const chain = { select: () => chain, eq: () => chain, neq: () => chain, order: async () => ({ data: rows, error: null }) };
    from.mockReturnValue(chain);
    rpc.mockResolvedValue({ data: [], error: null });
    render(await ImplantsPage({ params: Promise.resolve({ id: 'pt' }) }));
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    const cells = screen.getAllByTestId('implant-row').map((r) => within(r).getByTestId('implant-type').textContent);
    expect(cells).toEqual(['ZYG', 'TLT', '—']);
    expect(screen.getByTitle('Zygomatic')).toHaveTextContent('ZYG');
  });
});
