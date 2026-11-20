import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insert, update, selectAfterUpdate, rpc, linked } = vi.hoisted(() => ({
  insert: vi.fn(), update: vi.fn(), selectAfterUpdate: vi.fn(), rpc: vi.fn(), linked: { user_id: null as string | null },
}));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => ({
      insert: async (row: unknown) => insert(table, row),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: linked.user_id }, error: null }) }) }),
      update: (row: unknown) => {
        update(table, row);
        return { eq: () => ({ select: async () => selectAfterUpdate() }) };
      },
    }),
  }),
}));
import { addDoctor, setDoctorLogin, updateDoctor } from './actions';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
  selectAfterUpdate.mockResolvedValue({ data: [{ id: 'd1' }], error: null });
  linked.user_id = null;
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

describe('setDoctorLogin', () => {
  const doc = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const user = '9c1d6e2a-3b4f-4a5e-8d7c-1f2e3d4c5b6a';
  it('links a login through set_doctor_login', async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setDoctorLogin({}, form({ id: doc, user_id: user }));
    expect(rpc).toHaveBeenCalledWith('set_doctor_login', { p_doctor: doc, p_user: user });
    expect(r.ok).toBe('Login linked.');
  });
  it('unlinks with an empty login', async () => {
    rpc.mockResolvedValue({ error: null });
    linked.user_id = user;
    const r = await setDoctorLogin({}, form({ id: doc, user_id: '' }));
    expect(rpc).toHaveBeenCalledWith('set_doctor_login', { p_doctor: doc, p_user: null });
    expect(r.ok).toBe('Login unlinked.');
  });
  it('refuses an empty choice for a doctor with no login (nothing to unlink)', async () => {
    const r = await setDoctorLogin({}, form({ id: doc, user_id: '' }));
    expect(r.error).toBe('Choose a login.');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows the database message', async () => {
    rpc.mockResolvedValue({ error: { message: 'That login is already linked to a doctor.', code: 'P0001', hint: 'user' } });
    const r = await setDoctorLogin({}, form({ id: doc, user_id: user }));
    expect(r.error).toBe('That login is already linked to a doctor.');
  });
  it('refuses a malformed request', async () => {
    const r = await setDoctorLogin({}, form({ id: 'x', user_id: '' }));
    expect(r.error).toBe('Invalid request.');
    expect(rpc).not.toHaveBeenCalled();
  });
});
