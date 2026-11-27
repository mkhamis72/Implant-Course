// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handler = vi.fn();
// PostgREST-like builder: order() chains, range() slices the handler's rows, awaiting directly gives the whole result.
const rpc = vi.fn((name: string, args?: any, ...rest: unknown[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = {
    order: () => b,
    range: async (from: number, to: number) => {
      const r = await handler(name, args, ...rest);
      return r.error ? r : { data: (r.data as unknown[]).slice(from, to + 1), error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(handler(name, args, ...rest)).then(res, rej),
  };
  return b;
});
const profile = vi.fn();
// studies: .from('studies').select(cols).eq('id', id).maybeSingle() resolves to studyRow().
const studyRow = vi.fn();
const from = vi.fn((table: string) => {
  const q = { select: (cols: string) => { q.cols = cols; return q; }, eq: () => q, maybeSingle: async () => studyRow(table, q.cols), cols: '' };
  return q;
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile: () => profile() }));

import { GET } from './route';
import { DICTIONARY } from '@/lib/research/export/dictionary';
import { strFromU8, unzipSync } from 'fflate';
import ExcelJS from 'exceljs';

const COURSE = '11111111-2222-4333-8444-555555555555';
const DELEGATE = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const staff = (patients: 'view' | null, research: 'view' | null = 'view') => ({
  active: true, role: 'organizer', permissions: { patients, research }, features: ['teaching', 'statistics'],
});
const req = (qs: string) => new Request(`http://localhost:3000/statistics/export?${qs}`) as never;

beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
  studyRow.mockReset();
  studyRow.mockResolvedValue({ data: null, error: null });
  handler.mockReset();
  profile.mockReset();
  profile.mockResolvedValue(staff('view'));
  handler.mockImplementation(async (name: string) => (name === 'outcomes_version' ? { data: 'v1', error: null } : { data: name.startsWith('research_export_') ? [] : 'log-id', error: null }));
});

describe('GET /statistics/export', () => {
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

  it('in a clinic ignores the course and delegate filters and leaves their codes out of the files', async () => {
    profile.mockResolvedValue({ ...staff('view'), features: ['statistics'] });
    const c = '11111111-1111-4111-8111-111111111111';
    const res = await GET(req(`format=csv&course=${c}&delegate=${c}`));
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(files['analysis.R']).toBeUndefined();
    expect(strFromU8(files['README.txt'])).not.toMatch(/Filter: (course|delegate)/);
    expect(rpc.mock.calls.some((c) => c[0] === 'research_code')).toBe(false);
    for (const call of rpc.mock.calls.filter((c) => c[0].startsWith('research_export_'))) expect(call[1]).toMatchObject({ p_course: null, p_delegate: null });
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

  it('pages past the 1000-row cap: 1000 + 5 rows are all built and logged', async () => {
    const rows = Array.from({ length: 1005 }, (_, i) => ({ [Object.keys(DICTIONARY.visits)[0]]: `I-${i}` }));
    handler.mockImplementation(async (name: string) =>
      name === 'outcomes_version' ? { data: 'v1', error: null } : name === 'research_export_visits' ? { data: rows, error: null } : { data: name.startsWith('research_export_') ? [] : 'id', error: null });
    const res = await GET(req('format=csv'));
    expect(res.status).toBe(200);
    expect(rpc.mock.calls.filter((c) => c[0] === 'research_export_visits')).toHaveLength(2);
    const log = rpc.mock.calls.find((c) => c[0] === 'log_research_export');
    expect(log?.[1].p_row_counts.visits).toBe(1005);
  });

  it('stores the study codes first, then runs the readers one at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    handler.mockImplementation(async (name: string) => {
      order.push(name);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return name === 'outcomes_version' ? { data: 'v1', error: null } : { data: name.startsWith('research_export_') ? [] : null, error: null };
    });
    expect((await GET(req('format=csv&brand=Oxy'))).status).toBe(200);
    expect(order[0]).toBe('assign_research_codes');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_brand: 'Oxy', p_course: null });
    expect(order.filter((n) => n.startsWith('research_export_'))).toHaveLength(11);
    expect(order.indexOf('research_export_consent')).toBeGreaterThan(order.indexOf('assign_research_codes'));
    expect(most).toBe(1);
  });

  it('is 500 and logs nothing when the codes cannot be stored', async () => {
    handler.mockImplementation(async (name: string) => (name === 'assign_research_codes' ? { data: null, error: { message: 'x' } } : { data: [], error: null }));
    expect((await GET(req('format=csv'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0].startsWith('research_export_') || c[0] === 'log_research_export')).toBe(false);
  });

  it('names the course and delegate filters by study code in the files, and by id only in the log', async () => {
    handler.mockImplementation(async (name: string, args: { p_entity?: string }) =>
      name === 'outcomes_version' ? { data: 'v1', error: null }
        : name === 'research_code' ? { data: args.p_entity === 'course' ? 'C-ABC234' : 'D-XYZ789', error: null }
          : { data: name.startsWith('research_export_') ? [] : null, error: null });
    const res = await GET(req(`format=csv&course=${COURSE}&delegate=${DELEGATE}&brand=Oxy`));
    expect(res.status).toBe(200);
    const readme = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['README.txt']);
    expect(readme).not.toMatch(UUID_ANY);
    expect(readme).toContain('C-ABC234');
    expect(readme).toContain('D-XYZ789');
    expect(readme).toContain('Oxy');
    const log = rpc.mock.calls.find((c) => c[0] === 'log_research_export');
    expect(log?.[1].p_filters).toMatchObject({ course: COURSE, delegate: DELEGATE, brand: 'Oxy' });
  });

  it('merges research_consent into the patients sheet and adds the Research consent line to the about sheet', async () => {
    const patients = [{ patient_code: 'P-AAA222', sex: 'female' }, { patient_code: 'P-BBB333', sex: 'male' }, { patient_code: 'P-CCC444', sex: null }];
    const consent = [{ patient_code: 'P-AAA222', research_consent: 'yes' }, { patient_code: 'P-BBB333', research_consent: 'no' }];
    handler.mockImplementation(async (name: string) =>
      name === 'outcomes_version' ? { data: 'v1', error: null }
        : name === 'research_export_patients' ? { data: patients, error: null }
          : name === 'research_export_consent' ? { data: consent, error: null }
            : { data: name.startsWith('research_export_') ? [] : null, error: null });
    const res = await GET(req('format=xlsx'));
    expect(res.status).toBe(200);
    const consentCall = rpc.mock.calls.find((c) => c[0] === 'research_export_consent');
    expect(consentCall?.[1]).toMatchObject({ p_course: null, p_brand: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet('patients')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toContain('research_consent');
    const col = header.indexOf('research_consent') + 1;
    expect([2, 3, 4].map((r) => ws.getRow(r).getCell(col).value)).toEqual(['yes', 'no', 'not_recorded']);
    const about = wb.getWorksheet('about')!;
    const lines = about.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1));
    expect(lines).toContainEqual(['Research consent', '1 yes, 1 no, 1 not recorded (of 3 patients)']);
    // Every header is a dictionary column; nothing like a file, its bytes or the form text is ever exported.
    for (const sheet of wb.worksheets.filter((w) => !['data_dictionary', 'about'].includes(w.name))) {
      const cols = (sheet.getRow(1).values as unknown[]).slice(1) as string[];
      for (const c of cols) {
        expect(Object.keys(DICTIONARY[sheet.name as keyof typeof DICTIONARY]), sheet.name).toContain(c);
        expect(c).not.toMatch(/file|bytes|text_en|text_ar/);
      }
    }
    const log = rpc.mock.calls.find((c) => c[0] === 'log_research_export');
    expect(log?.[1].p_row_counts.patients).toBe(3);
  });

  // A completed All-on-4 case: the reader's sites / bridges carry raw row ids that must never reach the files.
  const SITE = (n: number) => `aaaaaaa${n}-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const BRIDGE = 'ffffffff-1111-4222-8333-444444444444';
  const implants = [{ implant_code: 'I-AAA222', patient_code: 'P-AAA222', placed_on: '2025-01-01', tooth: 16 }, { implant_code: 'I-BBB333', patient_code: 'P-AAA222', placed_on: '2025-01-01', tooth: 13 }];
  const rehab = [{ implant_code: 'I-AAA222', implant_type: 'tilted', angulation_deg: 30, angulation_direction: 'distal', anchorage: null, case_code: 'A-CAS234', case_configuration: 'all_on_4' }];
  const fullArch = (over: Record<string, unknown> = {}) => [{
    case_code: 'A-CAS234', patient_code: 'P-AAA222', arch: 'upper', configuration: 'all_on_4', first_placed_on: '2025-01-01', closed_on: null,
    scan_on: '2025-05-01', lab_design_on: null, try_in_on: null, implants_placed: 4, implants_failed: 0, bridge_problems: 0,
    sites: [16, 14, 24, 26].map((tooth, i) => ({ id: SITE(i), tooth, state: 'placed' })),
    bridges: [{ id: BRIDGE, type: 'full_arch', stage: 'final', fitted_on: '2025-07-01', ended_on: null, site_ids: [0, 1, 2, 3].map(SITE) }],
    ...over,
  }];
  const rehabHandler = (cases = fullArch()) => async (name: string) =>
    name === 'outcomes_version' ? { data: 'v1', error: null }
      : name === 'research_export_implants' ? { data: implants, error: null }
        : name === 'research_export_implant_rehab' ? { data: rehab, error: null }
          : name === 'research_export_full_arch_cases' ? { data: cases, error: null }
            : { data: name.startsWith('research_export_') ? [] : null, error: null };

  it('merges implant type, geometry and case into implants and writes a full_arch_cases sheet without the raw ids', async () => {
    handler.mockImplementation(rehabHandler());
    const res = await GET(req('format=xlsx'));
    expect(res.status).toBe(200);
    const rehabCall = rpc.mock.calls.find((c) => c[0] === 'research_export_implant_rehab');
    expect(rehabCall?.[1]).toMatchObject({ p_course: null, p_brand: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const rows = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
      return ws.getSheetValues().slice(2).map((r) => Object.fromEntries(header.map((h, i) => [h, (r as unknown[])[i + 1] ?? null])));
    };
    expect(rows('implants')).toEqual([
      expect.objectContaining({ implant_code: 'I-AAA222', implant_type: 'tilted', angulation_deg: 30, angulation_direction: 'distal', anchorage: null, case_code: 'A-CAS234', case_configuration: 'all_on_4' }),
      expect.objectContaining({ implant_code: 'I-BBB333', implant_type: null, case_code: null }),
    ]);
    expect(rows('full_arch_cases')).toEqual([expect.objectContaining({
      case_code: 'A-CAS234', patient_code: 'P-AAA222', configuration: 'all_on_4', status: 'completed', final_bridge_on: '2025-07-01', scan_on: '2025-05-01', implants_placed: 4,
    })]);
    for (const ws of wb.worksheets.filter((w) => w.name !== 'data_dictionary')) {
      ws.eachRow((r) => {
        for (const v of (r.values as unknown[]).slice(1)) {
          expect(String(v ?? ''), ws.name).not.toMatch(UUID_ANY);
          if (ws.name !== 'about') expect(['sites', 'bridges'], ws.name).not.toContain(v);
        }
      });
    }
    expect(rpc.mock.calls.find((c) => c[0] === 'log_research_export')?.[1].p_row_counts).toMatchObject({ implants: 2, full_arch_cases: 1 });
  });

  it('writes full_arch_cases.csv without sites, bridges or any raw id', async () => {
    handler.mockImplementation(rehabHandler());
    const files = unzipSync(new Uint8Array(await (await GET(req('format=csv'))).arrayBuffer()));
    const csv = strFromU8(files['full_arch_cases.csv']);
    expect(csv.split('\r\n')[0].replace(/^﻿/, '')).toBe('case_code,patient_code,arch,configuration,status,first_placed_on,final_bridge_on,closed_on,scan_on,lab_design_on,try_in_on,implants_placed,implants_failed,bridge_problems');
    expect(csv).toContain('A-CAS234');
    for (const [name, bytes] of Object.entries(files)) {
      if (name === 'data_dictionary.csv' || name === 'analysis.R') continue;
      expect(strFromU8(bytes), name).not.toMatch(UUID_ANY);
      expect(strFromU8(bytes), name).not.toMatch(/\bsites\b|\bbridges\b|site_ids/);
    }
  });

  it('is 500 and logs nothing when the full-arch reader returns a column outside the dictionary', async () => {
    handler.mockImplementation(rehabHandler(fullArch({ notes: 'free text' })));
    expect((await GET(req('format=xlsx'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0] === 'log_research_export')).toBe(false);
  });

  it('is 500 and logs nothing when the implant rehab reader fails', async () => {
    handler.mockImplementation(async (name: string) => (name === 'research_export_implant_rehab' ? { data: null, error: { message: 'x' } } : { data: name === 'outcomes_version' ? 'v1' : [], error: null }));
    expect((await GET(req('format=csv'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0] === 'log_research_export')).toBe(false);
  });

  it('is 500 and logs nothing when the consent reader fails', async () => {
    handler.mockImplementation(async (name: string) => (name === 'research_export_consent' ? { data: null, error: { message: 'x' } } : { data: name === 'outcomes_version' ? 'v1' : [], error: null }));
    expect((await GET(req('format=csv'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0] === 'log_research_export')).toBe(false);
  });

  it('does not log when a reader fails', async () => {
    handler.mockImplementation(async (name: string) => (name === 'research_export_visits' ? { data: null, error: { message: 'x' } } : { data: [], error: null }));
    expect((await GET(req('format=csv'))).status).toBe(500);
    expect(rpc.mock.calls.some((c) => c[0] === 'log_research_export')).toBe(false);
  });

  const STUDY = '0f0f0f0f-1111-4222-8333-444444444444';
  it('names the study in the about sheet (title, committee, approval, protocol version; never notes) and logs its id', async () => {
    studyRow.mockImplementation(async (_t: string, cols: string) => ({
      data: { title: 'Short implants RCT', committee: 'Cairo University REC', approval_number: null, protocol_version: '2.1', ...(cols.includes('notes') ? { notes: 'secret note' } : {}) },
      error: null,
    }));
    const res = await GET(req(`format=csv&brand=Oxy&study=${STUDY}`));
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('studies');
    const readme = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['README.txt']);
    expect(readme).toContain('Study: Short implants RCT');
    expect(readme).toContain('Ethics committee: Cairo University REC');
    expect(readme).toContain('Approval number: —');
    expect(readme).toContain('Protocol version: 2.1');
    expect(readme).not.toContain('secret note');
    expect(readme).not.toMatch(UUID_ANY);
    const log = rpc.mock.calls.find((c) => c[0] === 'log_research_export');
    expect(log?.[1].p_filters).toMatchObject({ brand: 'Oxy', study: STUDY });
    // The study is a label only: the readers get the same arguments as without it.
    expect(rpc.mock.calls.find((c) => c[0] === 'assign_research_codes')?.[1]).not.toHaveProperty('p_study');
  });

  it('shows — for the study rows without a study, and logs none', async () => {
    const res = await GET(req('format=csv'));
    const readme = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['README.txt']);
    expect(readme).toContain('Study: —');
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.find((c) => c[0] === 'log_research_export')?.[1].p_filters.study).toBeNull();
  });

  it('is 400 for an unknown or malformed study and builds nothing', async () => {
    expect((await GET(req(`format=csv&study=${STUDY}`))).status).toBe(400);
    expect((await GET(req('format=csv&study=nope'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
