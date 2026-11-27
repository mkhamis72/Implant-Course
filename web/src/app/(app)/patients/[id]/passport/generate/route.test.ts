// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { profile, rpc, latest, stored, load, model, render } = vi.hoisted(() => ({
  profile: vi.fn(), rpc: vi.fn(), latest: vi.fn(), stored: vi.fn(), load: vi.fn(), model: vi.fn(), render: vi.fn(),
}));
/** from('patient_passports'): the latest version (before saving), then the saved row's version (after). */
const from = vi.fn(() => {
  const chain = {
    select: () => chain, eq: (col: string) => { chain.byId = col === 'id'; return chain; }, order: () => chain, limit: () => chain,
    byId: false,
    maybeSingle: () => (chain.byId ? stored() : latest()),
  };
  return chain;
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
vi.mock('@/lib/passport/load', () => ({ loadPassportData: load }));
vi.mock('@/lib/passport/model', () => ({ passportModel: model }));
vi.mock('@/lib/passport/render', () => ({ renderPassport: render }));
import { POST, runtime } from './route';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const SAVED = '00000000-0000-4000-8000-000000000002';
const staff = (patients: 'view' | 'edit' | null) => ({ active: true, role: 'organizer', permissions: { patients } });
const post = (headers: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }, id = PATIENT) =>
  POST(new Request(`http://localhost:3000/patients/${id}/passport/generate`, { method: 'POST', headers }), { params: Promise.resolve({ id }) });
const PDF = Buffer.from('%PDF-1.7 test');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  profile.mockResolvedValue(staff('edit'));
  latest.mockResolvedValue({ data: { version: 2 }, error: null });
  stored.mockResolvedValue({ data: { version: 3 }, error: null });
  load.mockResolvedValue({ medicalLevel: 'none' });
  model.mockReturnValue({ the: 'model' });
  render.mockResolvedValue(PDF);
  rpc.mockResolvedValue({ data: SAVED, error: null });
});

describe('generate passport route', () => {
  it('runs on Node (react-pdf, fonts from disk)', () => {
    expect(runtime).toBe('nodejs');
  });

  it('renders the next version and stores it with the medical level it printed', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 3 });
    expect(load).toHaveBeenCalledWith(PATIENT);
    expect(model).toHaveBeenCalledWith({ medicalLevel: 'none' }, expect.any(String), 3);
    expect(render).toHaveBeenCalledWith({ the: 'model' });
    expect(rpc).toHaveBeenCalledWith('save_patient_passport', {
      p_patient: PATIENT, p_file: `\\x${PDF.toString('hex')}`, p_medical_level: 'none',
    });
  });

  it('the first passport is version 1', async () => {
    latest.mockResolvedValue({ data: null, error: null });
    stored.mockResolvedValue({ data: { version: 1 }, error: null });
    await post();
    expect(model).toHaveBeenCalledWith(expect.anything(), expect.any(String), 1);
  });

  it('needs Edit on Patients: View is refused and nothing is built', async () => {
    profile.mockResolvedValue(staff('view'));
    const res = await post();
    expect(res.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a signed-out, deactivated or 2FA-setup user', async () => {
    for (const p of [null, { ...staff('edit'), active: false }, { ...staff('edit'), mfa_setup_required: true }]) {
      profile.mockResolvedValue(p);
      expect((await post()).status).toBe(403);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses a post from another site or company address (no CSRF)', async () => {
    for (const headers of <Record<string, string>[]>[
      { origin: 'https://other.example', host: 'localhost:3000' },
      { origin: 'http://tenant2.localhost:3000', host: 'localhost:3000' },
      { host: 'localhost:3000' },
    ]) expect((await post(headers)).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it('a malformed patient id is not found', async () => {
    expect((await post(undefined, 'nope')).status).toBe(404);
    expect(load).not.toHaveBeenCalled();
  });

  it("shows the database's business message (too large) as it is", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'The passport is too large to store.', hint: 'user' } });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The passport is too large to store.' });
  });

  it('hides anything else (a failed load or render never leaks its message)', async () => {
    load.mockRejectedValue(new Error('relation "secret" does not exist'));
    const res = await post();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Could not generate the passport. Please try again.');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('logs when a concurrent save took the version it printed', async () => {
    stored.mockResolvedValue({ data: { version: 4 }, error: null });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 4 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('version'), 3, 4);
  });
});
