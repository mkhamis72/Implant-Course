// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { profile, rpc, counted, load, model } = vi.hoisted(() => ({
  profile: vi.fn(), rpc: vi.fn(), counted: vi.fn(), load: vi.fn(), model: vi.fn(),
}));
/** from('passport_generations').select(…, { count, head }).eq(…): the number of generations. */
const from = vi.fn(() => {
  const chain = { select: () => chain, eq: () => counted() };
  return chain;
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
vi.mock('@/lib/passport/load', () => ({ loadPassportData: load }));
vi.mock('@/lib/passport/model', () => ({ passportModel: model }));
vi.mock('@/lib/dates', () => ({ todayIso: () => '2026-11-28' }));
import { GET } from './route';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const staff = (patients: 'view' | 'edit' | null) => ({ active: true, role: 'organizer', permissions: { patients } });
const SAME = { 'sec-fetch-site': 'same-origin', host: 'localhost:3000' };
const get = (headers: Record<string, string> = SAME, id = PATIENT) =>
  GET(new Request(`http://localhost:3000/patients/${id}/passport/data`, { headers }), { params: Promise.resolve({ id }) });
const DATA = { patient: { file_no: 'P00123' }, medicalLevel: 'none' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  profile.mockResolvedValue(staff('view'));
  load.mockResolvedValue(DATA);
  model.mockReturnValue({ the: 'model' });
  rpc.mockResolvedValue({ data: 'gen-1', error: null });
  counted.mockResolvedValue({ count: 3, error: null });
});

describe('passport data route', () => {
  it('View on Patients: returns the model and the file name, logs the generation once, no-store', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ passport: { the: 'model' }, fileName: 'Implant passport P00123 2026-11-28.pdf' });
    expect(load).toHaveBeenCalledWith(PATIENT);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('log_passport_generation', { p_patient: PATIENT, p_medical_level: 'none' });
    // The printed number is the patient's generation count, this one included.
    expect(model).toHaveBeenCalledWith(DATA, expect.any(String), 3);
  });

  it('accepts a same-origin request that names its Origin', async () => {
    expect((await get({ origin: 'http://localhost:3000', host: 'localhost:3000' })).status).toBe(200);
  });

  it('refuses a cross-origin or unmarked request (403) and logs nothing', async () => {
    for (const headers of <Record<string, string>[]>[
      { 'sec-fetch-site': 'cross-site', host: 'localhost:3000' },
      { 'sec-fetch-site': 'same-site', origin: 'http://evil.localhost:3000', host: 'localhost:3000' },
      { origin: 'http://evil.example', host: 'localhost:3000' },
      { host: 'localhost:3000' },
    ]) {
      expect((await get(headers)).status).toBe(403);
    }
    expect(load).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('no Patients view, signed out, deactivated or 2FA setup pending: 404 and nothing read', async () => {
    for (const p of [staff(null), null, { ...staff('view'), active: false }, { ...staff('view'), mfa_setup_required: true },
      { active: true, role: 'delegate', permissions: {} }]) {
      profile.mockResolvedValue(p);
      expect((await get()).status).toBe(404);
    }
    expect(load).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a bad id or a patient not found: 404, nothing logged', async () => {
    expect((await get(SAME, 'not-a-uuid')).status).toBe(404);
    load.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the log's refusal is shown (400) and no model is handed out", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Patient not found.', hint: 'user', code: 'P0001' } });
    const res = await get();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Patient not found.' });
    expect(model).not.toHaveBeenCalled();
  });

  it('an unexpected failure is a generic 500', async () => {
    load.mockRejectedValue(new Error('db down'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not prepare the passport. Please try again.' });
  });
});
