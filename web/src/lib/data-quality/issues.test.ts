import { describe, it, expect } from 'vitest';
import { issueLink, issuesForTooth, sortIssues, type DataQualityIssue } from './issues';

const base: DataQualityIssue = {
  patient_id: 'p1', patient_name: 'A', file_no: 'P00001', site_id: 's1', tooth: 36, kind: 'before_placement',
  record_table: 'implant_followups', record_id: 'r1', record_date: '2026-01-02', reference_date: '2026-02-01', message: 'm',
};

describe('issueLink', () => {
  it('links visits, complications, restorations and restoration problems to the tooth', () => {
    for (const t of ['implant_followups', 'implant_complications', 'restorations', 'restoration_problems', 'implant_sites']) {
      expect(issueLink({ ...base, record_table: t })).toBe('/patients/p1?tooth=36');
    }
  });
  it('links an X-ray to the X-ray page', () => {
    expect(issueLink({ ...base, record_table: 'radiographs' })).toBe('/patients/p1/xrays');
  });
  it('falls back to the patient when there is no tooth', () => {
    expect(issueLink({ ...base, tooth: null })).toBe('/patients/p1');
  });
});

describe('issuesForTooth', () => {
  it('keeps issues of any implant on the tooth, and tooth issues without an implant', () => {
    const sites = [{ id: 's1', tooth: 36 }, { id: 's0', tooth: 36 }, { id: 's2', tooth: 46 }];
    const rows = [
      base,
      { ...base, site_id: 's0', record_id: 'failed' },
      { ...base, site_id: 's2', tooth: 46 },
      { ...base, site_id: null, record_id: 'xray' },
      { ...base, site_id: null, tooth: 46 },
    ];
    expect(issuesForTooth(rows, sites, 36).map((i) => i.record_id)).toEqual(['r1', 'failed', 'xray']);
    expect(issuesForTooth(undefined, sites, 36)).toEqual([]);
  });
});

describe('sortIssues', () => {
  it('orders by patient, then tooth with none last, then date', () => {
    const rows = [
      { ...base, patient_name: 'B', tooth: 11, record_id: 'a' },
      { ...base, patient_name: 'A', tooth: null, record_id: 'b' },
      { ...base, patient_name: 'A', tooth: 36, record_date: '2026-03-01', record_id: 'c' },
      { ...base, patient_name: 'A', tooth: 36, record_date: '2026-01-01', record_id: 'd' },
      { ...base, patient_name: 'A', tooth: 14, record_id: 'e' },
    ];
    expect(sortIssues(rows).map((r) => r.record_id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});
