// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { implantRow } from '@/lib/analysis/test-rows';

const handler = vi.fn();
// PostgREST-like builder: order() chains, range() slices the handler's rows, awaiting gives the whole result.
const rpc = vi.fn((name: string, args?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = {
    order: () => b,
    range: async (from: number, to: number) => {
      const r = await handler(name, args);
      return r.error ? r : { data: (r.data as unknown[]).slice(from, to + 1), error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(handler(name, args)).then(res, rej),
  };
  return b;
});
const profile = vi.fn();
const loadExplore = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));
vi.mock('../data', () => ({ loadExplore: (...a: unknown[]) => loadExplore(...a) }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('@/lib/dates')>()), todayIso: () => '2026-10-25' }));
import { GET } from './route';

const SITE = '00000000-0000-4000-8000-0000000000aa';
const admin = { role: 'admin', active: true, mfa_setup_required: false, permissions: {} };
const req = (q: string) => new Request(`http://x/statistics/explore/export?${q}`) as never;

beforeEach(() => {
  handler.mockReset();
  handler.mockImplementation(async (name: string) => {
    if (name === 'analysis_codes') return { data: [{ site_id: SITE, implant_code: 'I-ABC234', patient_code: 'P-XYZ789' }], error: null };
    return { data: null, error: null };
  });
  profile.mockReset().mockReturnValue(admin);
  loadExplore.mockReset().mockResolvedValue({
    data: { implants: [implantRow({ site_id: SITE, smoking: 'current' })], visits: [], radiographs: [] }, labels: {},
  });
});

describe('GET /statistics/explore/export', () => {
  it('refuses without Research view or Patients view, and without an outcome', async () => {
    profile.mockReturnValue({ role: 'organizer', active: true, mfa_setup_required: false, permissions: { patients: 'view' } });
    expect((await GET(req('o=failed'))).status).toBe(403);
    profile.mockReturnValue({ role: 'organizer', active: true, mfa_setup_required: false, permissions: { research: 'view' } });
    expect((await GET(req('o=failed'))).status).toBe(403);
    profile.mockReturnValue(admin);
    expect((await GET(req('f=smoking'))).status).toBe(400);
  });

  it('assigns codes, writes the CSV and logs the export', async () => {
    const res = await GET(req('course=all&f=smoking&o=failed'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="explore-failed-2026-10-25.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = (await res.text()).replace(/^﻿/, '');
    expect(text.split('\r\n')[1]).toBe('I-ABC234,P-XYZ789,Current,no,,,');
    expect(handler.mock.calls.map((c) => c[0])).toEqual(['assign_research_codes', 'analysis_codes', 'log_research_export']);
    const log = handler.mock.calls.find((c) => c[0] === 'log_research_export')![1];
    expect(log).toMatchObject({ p_format: 'csv', p_filters: { course: 'all', explore: { f: 'smoking', o: 'failed' } }, p_row_counts: { points: 1 } });
  });

  it('still answers and logs when nothing matches', async () => {
    loadExplore.mockResolvedValue({ data: { implants: [], visits: [], radiographs: [] }, labels: {} });
    const res = await GET(req('o=failed'));
    expect(res.status).toBe(200);
    expect(handler.mock.calls.find((c) => c[0] === 'log_research_export')![1].p_row_counts).toEqual({ points: 0 });
  });

  it('fails with a 500 when a reader fails', async () => {
    handler.mockImplementation(async (name: string) => (name === 'assign_research_codes' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req('o=failed'));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Could not build the export');
  });
});
