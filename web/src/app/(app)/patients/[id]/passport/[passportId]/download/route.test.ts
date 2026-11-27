// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { profile, rpc, passport, patient } = vi.hoisted(() => ({
  profile: vi.fn(), rpc: vi.fn(), passport: vi.fn(), patient: vi.fn(),
}));
const from = vi.fn((table: string) => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => (table === 'patients' ? patient() : passport()) };
  return chain;
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
import { GET, runtime } from './route';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const PASSPORT = '00000000-0000-4000-8000-000000000002';
const staff = (patients: 'view' | 'edit' | null) => ({ active: true, role: 'organizer', permissions: { patients } });
const get = (id = PATIENT, passportId = PASSPORT) =>
  GET(new Request(`http://localhost:3000/patients/${id}/passport/${passportId}/download`), { params: Promise.resolve({ id, passportId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  profile.mockResolvedValue(staff('view'));
  passport.mockResolvedValue({ data: { version: 3 }, error: null });
  patient.mockResolvedValue({ data: { file_no: 'P00123' }, error: null });
  rpc.mockResolvedValue({ data: '\\x255044462d312e37', error: null });
});

describe('passport download route', () => {
  it('runs on Node', () => expect(runtime).toBe('nodejs'));

  it('serves the stored bytes as an attachment named after the passport number, never cached', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('patient_passport_file', { p_passport: PASSPORT });
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition'))
      .toBe(`attachment; filename="Implant passport P00123-3.pdf"; filename*=UTF-8''Implant%20passport%20P00123-3.pdf`);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-1.7');
  });

  it('View on Patients is enough; none is 404 and nothing is read or logged', async () => {
    profile.mockResolvedValue(staff(null));
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a passport that isn't this patient's (or malformed ids) is 404 and logs no download", async () => {
    passport.mockResolvedValue({ data: null, error: null });
    expect((await get()).status).toBe(404);
    expect((await get('nope')).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's business message; hides anything else", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Passport not found.', hint: 'user' } });
    let res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Passport not found.');
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for table secret', code: 'XX000' } });
    res = await get();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });
});
