import { describe, it, expect } from 'vitest';
import { issueLink, issuesForSite, type DataQualityIssue } from './issues';

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

describe('issuesForSite', () => {
  it('keeps only the matching site', () => {
    expect(issuesForSite([base, { ...base, site_id: 's2' }, { ...base, site_id: null }], 's1')).toHaveLength(1);
    expect(issuesForSite(undefined, 's1')).toEqual([]);
  });
});
