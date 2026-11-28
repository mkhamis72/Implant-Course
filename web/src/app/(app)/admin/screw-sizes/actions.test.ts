import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, requireAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { saveScrewSize, setScrewSizeActive } from './actions';
import { systemKey } from '@/lib/admin/screw-sizes';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const valid = {
  id: '', system: systemKey('Oxy', 'PSK'), kind: 'abutment_screw', label: 'M1.6 x 5',
  driver_interface: 'Hex', driver_size: '1.25', driver_ref: 'SD-1', torque: '25',
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
});

describe('saveScrewSize', () => {
  it('requires an admin and adds a size with a null id', async () => {
    const r = await saveScrewSize({}, form(valid));
    expect(requireAdmin).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('save_screw_size', {
      p_id: null, p_brand: 'Oxy', p_system: 'PSK', p_kind: 'abutment_screw', p_label: 'M1.6 x 5',
      p_driver_interface: 'Hex', p_driver_size: '1.25', p_driver_ref: 'SD-1', p_torque: 25,
    });
    expect(r.ok).toBe('Screw size added.');
  });

  it('edits with the id and sends a null torque when empty', async () => {
    const id = '3f2b8f0e-6c1d-4a55-9d0e-0a1b2c3d4e5f';
    const r = await saveScrewSize({}, form({ ...valid, id, torque: '' }));
    expect(rpc).toHaveBeenCalledWith('save_screw_size', expect.objectContaining({ p_id: id, p_torque: null }));
    expect(r.ok).toBe('Saved.');
  });

  it('refuses invalid input without calling the database, keeping the values', async () => {
    const r = await saveScrewSize({}, form({ ...valid, torque: '151' }));
    expect(rpc).not.toHaveBeenCalled();
    expect(r.error).toBe('Torque must be between 0 and 150 Ncm.');
    expect(r.values?.label).toBe('M1.6 x 5');
  });

  it('shows a database user message and keeps the values', async () => {
    rpc.mockResolvedValue({ error: { message: 'dup', hint: 'user', code: 'P0001' } });
    const r = await saveScrewSize({}, form(valid));
    expect(r.error).toBeTruthy();
    expect(r.values?.label).toBe('M1.6 x 5');
  });
});

describe('setScrewSizeActive', () => {
  const id = '3f2b8f0e-6c1d-4a55-9d0e-0a1b2c3d4e5f';
  it('switches off and on', async () => {
    expect((await setScrewSizeActive({}, form({ id, active: 'false' }))).ok).toBe('Switched off.');
    expect(rpc).toHaveBeenLastCalledWith('set_screw_size_active', { p_id: id, p_active: false });
    expect((await setScrewSizeActive({}, form({ id, active: 'true' }))).ok).toBe('Switched on.');
    expect(rpc).toHaveBeenLastCalledWith('set_screw_size_active', { p_id: id, p_active: true });
  });
  it('refuses a bad id', async () => {
    expect((await setScrewSizeActive({}, form({ id: 'x', active: 'true' }))).error).toBe('Invalid request.');
    expect(rpc).not.toHaveBeenCalled();
  });
});
