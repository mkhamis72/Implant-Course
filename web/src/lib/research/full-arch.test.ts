import { describe, it, expect } from 'vitest';
import { caseOutcome, fullArchExportRows, summariseCases, type FullArchCaseRow } from './full-arch';
import type { GroupableRow } from './groups';
import type { RehabVars } from './rehab';

let n = 0;
const kase = (over: Partial<FullArchCaseRow> = {}): FullArchCaseRow => ({
  case_id: `c${++n}`, patient_id: 'p', file_no: '1', arch: 'upper', configuration: 'all_on_4', closed_at: null,
  first_placed_on: '2025-01-01', implants_placed: 4, implants_failed: 0, bridge_problems: 0,
  sites: [
    { id: 's1', tooth: 16, state: 'placed' }, { id: 's2', tooth: 14, state: 'placed' },
    { id: 's3', tooth: 24, state: 'placed' }, { id: 's4', tooth: 26, state: 'placed' },
  ],
  bridges: [], ...over,
});
const final = (over: Record<string, unknown> = {}) => ({
  id: 'b1', type: 'full_arch', stage: 'final', fitted_on: '2025-07-01', ended_on: null, site_ids: ['s1', 's2', 's3', 's4'], ...over,
});
const done = (over: Partial<FullArchCaseRow> = {}) => kase({ bridges: [final()] as FullArchCaseRow['bridges'], ...over });

describe('caseOutcome', () => {
  it('completed: months from the first placement to the delivered final bridge', () => {
    const o = caseOutcome(done());
    expect(o.status).toBe('completed');
    expect(o.finalBridgeOn).toBe('2025-07-01');
    expect(o.monthsToBridge).toBeCloseTo(181 / 30.4375, 6);
  });

  it('an ended final bridge does not complete the case', () => {
    const o = caseOutcome(kase({ bridges: [final({ ended_on: '2025-09-01' })] as FullArchCaseRow['bridges'] }));
    expect(o.status).toBe('in_treatment');
    expect(o.finalBridgeOn).toBeNull();
    expect(o.monthsToBridge).toBeNull();
  });

  it('a failed implant does not block completion', () => {
    const c = done({
      sites: [
        { id: 's1', tooth: 16, state: 'placed' }, { id: 's2', tooth: 14, state: 'failed' },
        { id: 's3', tooth: 24, state: 'placed' }, { id: 's4', tooth: 26, state: 'placed' },
      ],
      bridges: [final({ site_ids: ['s1', 's3', 's4'] })] as FullArchCaseRow['bridges'],
    });
    expect(caseOutcome(c).status).toBe('completed');
  });

  it('closed wins; planned without placed implants', () => {
    expect(caseOutcome(done({ closed_at: '2025-08-01T00:00:00Z' })).status).toBe('closed');
    expect(caseOutcome(kase({ sites: [{ id: 's1', tooth: 16, state: 'planned' }] })).status).toBe('planned');
  });
});

const impl = (site_id: string, over: Partial<GroupableRow> = {}): GroupableRow => ({
  site_id, patient_id: 'p', tooth: 11, placed_on: '2025-01-01', loaded_on: null, year_1: 'survived', year_2: 'survived',
  latest_grade: null, latest_grade_reason: null, biological_complications: 0, mechanical_complications: 0,
  follow_up_days: 800, event: false, event_time_unknown: false, product_id: 'x', brand: 'Oxy', system: null, ...over,
} as GroupableRow);
const rehab = (site_id: string, case_configuration: RehabVars['case_configuration']): RehabVars => ({
  site_id, implant_type: null, angulation_deg: null, angulation_direction: null, anchorage: null, case_id: 'x', case_configuration,
});

describe('summariseCases', () => {
  it('returns one column per configuration in order; empty ones are zeros and nulls', () => {
    const cols = summariseCases([done()], [], []);
    expect(cols.map((c) => c.configuration)).toEqual(['all_on_4', 'all_on_6', 'all_on_x', 'other']);
    expect(cols[1]).toEqual({
      configuration: 'all_on_6', cases: 0, completed: 0, closedIncomplete: 0,
      monthsToBridge: { median: null, min: null, max: null }, withBridgeProblem: 0, bridgeProblems: 0, lostImplant: 0,
      implantsFailed: 0, implantsPlaced: 0, medianImplants: null, survival12: null, survival24: null,
    });
  });

  it('counts completed, closed-incomplete, lost implants and bridge problems', () => {
    const cases = [
      done({ implants_failed: 1, bridge_problems: 2 }),
      done({ first_placed_on: '2025-03-01', bridge_problems: 1 }),
      kase({ closed_at: '2025-05-01T00:00:00Z', implants_placed: 5 }),
      kase({ implants_placed: 6 }),
    ];
    const [a4] = summariseCases(cases, [], []);
    expect(a4.cases).toBe(4);
    expect(a4.completed).toBe(2);
    expect(a4.closedIncomplete).toBe(1);
    expect(a4.lostImplant).toBe(1);
    expect(a4.implantsFailed).toBe(1);
    expect(a4.withBridgeProblem).toBe(2);
    expect(a4.bridgeProblems).toBe(3);
    expect(a4.implantsPlaced).toBe(4 + 4 + 5 + 6);
    expect(a4.medianImplants).toBe(4.5); // 4, 4, 5, 6
    const months = [181 / 30.4375, 122 / 30.4375];
    expect(a4.monthsToBridge.min).toBeCloseTo(Math.min(...months), 6);
    expect(a4.monthsToBridge.max).toBeCloseTo(Math.max(...months), 6);
    expect(a4.monthsToBridge.median).toBeCloseTo((months[0] + months[1]) / 2, 6);
  });

  it('median of an odd count is the middle value', () => {
    const [a4] = summariseCases([kase({ implants_placed: 4 }), kase({ implants_placed: 6 }), kase({ implants_placed: 5 })], [], []);
    expect(a4.medianImplants).toBe(5);
  });

  it('12 and 24-month survival use only that configuration\'s implants', () => {
    const implants = [impl('a'), impl('b'), impl('c', { event: true, follow_up_days: 100 }), impl('d')];
    const links = [rehab('a', 'all_on_4'), rehab('b', 'all_on_4'), rehab('c', 'all_on_6'), rehab('d', null)];
    const cols = summariseCases([kase(), kase({ configuration: 'all_on_6' })], implants, links);
    expect(cols[0].survival12?.n).toBe(2);
    expect(cols[0].survival12?.surv).toBe(1);
    expect(cols[0].survival24?.n).toBe(2);
    expect(cols[1].survival12?.n).toBe(1);
    expect(cols[1].survival12?.surv).toBe(0);
    expect(cols[2].survival12).toBeNull();
  });
});

describe('fullArchExportRows', () => {
  const exported = (over: Record<string, unknown> = {}) => ({
    case_code: 'A-ABC234', patient_code: 'P-ABC234', arch: 'upper', configuration: 'all_on_4', first_placed_on: '2025-01-01',
    closed_on: null, scan_on: '2025-05-01', lab_design_on: null, try_in_on: null, implants_placed: 4, implants_failed: 0,
    bridge_problems: 1, sites: kase().sites, bridges: [final()], ...over,
  });

  it('adds status and final_bridge_on from the case rule and drops sites and bridges', () => {
    const [row] = fullArchExportRows([exported()]);
    expect(row).toEqual({
      case_code: 'A-ABC234', patient_code: 'P-ABC234', arch: 'upper', configuration: 'all_on_4', status: 'completed',
      first_placed_on: '2025-01-01', final_bridge_on: '2025-07-01', closed_on: null, scan_on: '2025-05-01',
      lab_design_on: null, try_in_on: null, implants_placed: 4, implants_failed: 0, bridge_problems: 1,
    });
    expect(row).not.toHaveProperty('sites');
    expect(row).not.toHaveProperty('bridges');
  });

  it('a closed case is closed; no bridge = in treatment, no final bridge date', () => {
    expect(fullArchExportRows([exported({ closed_on: '2025-08-01' })])[0].status).toBe('closed');
    const open = fullArchExportRows([exported({ bridges: [] })])[0];
    expect(open.status).toBe('in_treatment');
    expect(open.final_bridge_on).toBeNull();
  });

  it('reads jsonb that arrives as text or null', () => {
    const row = fullArchExportRows([exported({ sites: JSON.stringify(kase().sites), bridges: null })])[0];
    expect(row.status).toBe('in_treatment');
  });
});
