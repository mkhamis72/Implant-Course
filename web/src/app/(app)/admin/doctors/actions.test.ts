import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insert, update, selectAfterUpdate } = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), selectAfterUpdate: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => insert(table, row),
      update: (row: unknown) => {
        update(table, row);
        return { eq: () => ({ select: async () => selectAfterUpdate() }) };
      },
    }),
  }),
}));
import { addDoctor, updateDoctor } from './actions';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
  selectAfterUpdate.mockResolvedValue({ data: [{ id: 'd1' }], error: null });
});

describe('addDoctor', () => {
  it('adds a doctor by name', async () => {
    const r = await addDoctor({}, form({ name: ' Dr Amr ' }));
    expect(insert).toHaveBeenCalledWith('doctors', { name: 'Dr Amr' });
    expect(r.ok).toBe('Doctor added.');
  });
  it('refuses a missing name', async () => {
    const r = await addDoctor({}, form({ name: '' }));
    expect(r.error).toBe('Enter the doctor’s name.');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('updateDoctor', () => {
  it('renames and toggles active', async () => {
    const r = await updateDoctor({}, form({ id: 'd1', name: 'Dr Amr S', active: 'on' }));
    expect(update).toHaveBeenCalledWith('doctors', { name: 'Dr Amr S', active: true });
    expect(r.ok).toBe('Saved.');
  });
  it('deactivates when the box is unticked', async () => {
    await updateDoctor({}, form({ id: 'd1', name: 'Dr Amr' }));
    expect(update).toHaveBeenCalledWith('doctors', { name: 'Dr Amr', active: false });
  });
  it('reports a doctor that is not found', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });
    const r = await updateDoctor({}, form({ id: 'x', name: 'Dr Amr' }));
    expect(r.error).toBe('Doctor not found.');
  });
});
