// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const rpc = vi.fn(() => ({ maybeSingle }));
const profile = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
import { GET } from './route';

const STUDY = '00000000-0000-4000-8000-000000000001';
const staff = (research: 'view' | 'edit' | null, patients: 'view' | null = 'view') => ({
  active: true, role: 'organizer', permissions: { research, patients },
});
const get = (id = STUDY) =>
  GET(new Request(`http://localhost:3000/patients/research/studies/${id}/letter`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rpc.mockClear();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: { bytes: '\\x255044462d312e37', content_type: 'application/pdf' }, error: null });
  profile.mockReset();
  profile.mockResolvedValue(staff('view'));
});

describe('study letter route', () => {
  it('serves the letter inline, never cached, never sniffed', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('study_letter', { p_study: STUDY });
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-1.7');
  });

  it('is 404 without Research view (or Patients view), without asking the database', async () => {
    profile.mockResolvedValue(staff(null));
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue(staff('view', null));
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue({ active: true, role: 'delegate', permissions: {} });
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue({ ...staff('view'), active: false });
    expect((await get()).status).toBe(404);
    profile.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is 404 when the study has no letter, for a bad id and on a database error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await get()).status).toBe(404);
    expect((await get('nope')).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await get()).status).toBe(404);
  });
});
