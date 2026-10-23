// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const rpc = vi.fn(() => ({ maybeSingle }));
const profile = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
import { GET } from './route';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const FILE = '00000000-0000-4000-8000-000000000002';
const staff = (patients: 'view' | 'edit' | null) => ({ active: true, role: 'organizer', permissions: { patients } });
const get = (patient = PATIENT, file = FILE) =>
  GET(new Request(`http://localhost:3000/patients/${patient}/consent/file/${file}`), { params: Promise.resolve({ id: patient, fileId: file }) });

beforeEach(() => {
  rpc.mockClear();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: { bytes: '\\x255044462d312e37', content_type: 'application/pdf' }, error: null });
  profile.mockReset();
  profile.mockResolvedValue(staff('view'));
});

describe('consent file route', () => {
  it('serves the file inline, never cached, never sniffed', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('consent_file', { p_patient: PATIENT, p_file: FILE });
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-1.7');
  });

  it('is 404 when the file is not on that patient\'s consent (no row)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await get('00000000-0000-4000-8000-000000000009');
    expect(res.status).toBe(404);
  });

  it('is 404 without View on Patients, without asking the database', async () => {
    profile.mockResolvedValue(staff(null));
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue({ active: true, role: 'delegate', permissions: {} });
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is 404 for ids that are not uuids, and on a database error', async () => {
    expect((await get('nope')).status).toBe(404);
    expect((await get(PATIENT, 'nope')).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await get()).status).toBe(404);
  });
});
