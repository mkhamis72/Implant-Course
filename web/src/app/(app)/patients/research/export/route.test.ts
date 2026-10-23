// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const profile = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));

import { GET } from './route';

const staff = (patients: 'view' | null, research: 'view' | null = 'view') => ({
  active: true, role: 'organizer', permissions: { patients, research },
});
const req = (qs: string) => new Request(`http://localhost:3000/patients/research/export?${qs}`) as never;

beforeEach(() => {
  rpc.mockReset();
  profile.mockReset();
  profile.mockResolvedValue(staff('view'));
  rpc.mockImplementation(async (name: string) => (name === 'outcomes_version' ? { data: 'v1', error: null } : { data: name.startsWith('research_export_') ? [] : 'log-id', error: null }));
});

describe('GET /patients/research/export', () => {
  it('sends an xlsx with download headers and logs the export once with row counts', async () => {
    const res = await GET(req('format=xlsx&course=&brand=Oxy'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="research-export-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const logs = rpc.mock.calls.filter((c) => c[0] === 'log_research_export');
    expect(logs).toHaveLength(1);
    expect(logs[0][1].p_format).toBe('xlsx');
    expect(logs[0][1].p_filters.brand).toBe('Oxy');
    expect(logs[0][1].p_row_counts).toMatchObject({ implants: 0, grafts: 0 });
    // volatile readers: plain rpc calls, no options argument
    for (const c of rpc.mock.calls.filter((c) => c[0].startsWith('research_export_'))) expect(c[2]).toBeUndefined();
  });

  it('sends a zip for csv', async () => {
    const res = await GET(req('format=csv'));
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/\.zip"$/);
  });

  it('is 400 for a bad format and logs nothing', async () => {
    expect((await GET(req('format=pdf'))).status).toBe(400);
    expect((await GET(req(''))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is 403 without Patients view', async () => {
    profile.mockResolvedValue(staff(null));
    const res = await GET(req('format=xlsx'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Research export needs View on Patients');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is 403 without Research view or when signed out', async () => {
    profile.mockResolvedValue(staff('view', null));
    expect((await GET(req('format=xlsx'))).status).toBe(403);
    profile.mockResolvedValue(null);
    expect((await GET(req('format=xlsx'))).status).toBe(403);
  });

  it('does not log when a reader fails', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'research_export_visits' ? { data: null, error: { message: 'x' } } : { data: [], error: null }));
    expect((await GET(req('format=csv'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0] === 'log_research_export')).toBe(false);
  });
});
