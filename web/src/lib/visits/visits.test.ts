import { describe, it, expect } from 'vitest';
import {
  nextVisit, prepickVisit, recordableVisits, summarizeFindings, toFindings, visitResult, visitSchema,
  type VisitFindings, type VisitRow,
} from './visits';

const row = (visit_key: string, status: VisitRow['status'], target_date: string, over: Partial<VisitRow> = {}): VisitRow => ({
  site_id: 's1', tooth: 36, visit_key, label: visit_key, target_date, window_start: target_date, window_end: target_date,
  status, followup_id: null, ...over,
});
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
const noFindings: VisitFindings = {
  pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
  probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null,
  bop_mesial: null, bop_buccal: null, bop_distal: null, bop_lingual: null, isq: null, prosthesis_status: null,
  radiograph_taken: null, recommended_treatment: '',
};

describe('visit helpers', () => {
  const rows = [
    row('early_review', 'missed', '2026-01-11'),
    row('osseointegration', 'overdue', '2026-03-31'),
    row('month_6', 'upcoming', '2026-07-01'),
    row('month_12', 'upcoming', '2026-12-31'),
    row('early_review', 'due', '2026-05-01', { site_id: 's2' }),
  ];
  it('the next visit is the earliest due or overdue one, else the earliest upcoming', () => {
    expect(nextVisit(rows, 's1')?.visit_key).toBe('osseointegration');
    expect(nextVisit([row('month_6', 'upcoming', '2026-07-01'), row('month_12', 'upcoming', '2026-12-31')], 's1')?.visit_key).toBe('month_6');
    expect(nextVisit([row('early_review', 'done', '2026-01-11')], 's1')).toBeNull();
  });
  it('pre-picks the earliest due or overdue visit, else the latest missed, else the earliest upcoming, else unscheduled', () => {
    expect(prepickVisit(rows, 's1')).toBe('osseointegration');
    expect(prepickVisit([
      row('early_review', 'missed', '2026-01-11'), row('osseointegration', 'missed', '2026-03-31'), row('month_6', 'missed', '2026-07-01'),
      row('month_12', 'upcoming', '2026-12-31'),
    ], 's1')).toBe('month_6');
    expect(prepickVisit([row('month_6', 'upcoming', '2026-07-01')], 's1')).toBe('month_6');
    expect(prepickVisit([row('early_review', 'done', '2026-01-11')], 's1')).toBe('');
  });
  it('offers only visits not yet recorded, for that implant', () => {
    expect(recordableVisits([...rows, row('x', 'done', '2026-01-01', { followup_id: 'f9' })], 's1').map((r) => r.visit_key))
      .toEqual(['early_review', 'osseointegration', 'month_6', 'month_12']);
  });
  it('labels a visit by its outcome, or by attendance when there is none', () => {
    expect(visitResult({ outcome: 'integrated', attendance: 'attended' })).toBe('Integrated');
    expect(visitResult({ outcome: null, attendance: 'did_not_attend' })).toBe('Did not attend');
    expect(visitResult({ outcome: 'ok', attendance: null })).toBe('OK');
    expect(visitResult({ outcome: null, attendance: null })).toBe('');
  });
  it('summarizes recorded findings only', () => {
    expect(summarizeFindings(noFindings)).toBe('');
    expect(summarizeFindings({
      ...noFindings, pain_score: 2, probing_mesial: 3, probing_buccal: 4.5, probing_distal: null, probing_lingual: 2,
      bop_buccal: 'yes', bop_mesial: 'no', isq: 72, mobility: 'no', suppuration: 'yes',
    })).toBe('Pain 2/10 · PD M 3 · B 4.5 · L 2 mm · BOP B · ISQ 72 · Suppuration · No mobility');
    expect(summarizeFindings({ ...noFindings, radiograph_taken: 'yes', patient_concerns: 'Sore', recommended_treatment: 'Crown' }))
      .toBe('X-ray · Concerns: Sore · Plan: Crown');
    expect(summarizeFindings({ ...noFindings, radiograph_taken: 'no' })).toBe('');
  });
});

describe('visitSchema', () => {
  const attended = { ...ids, date: '2026-05-01', visitKey: 'early_review', checkType: '', attendance: 'attended', outcome: 'ok' };
  it('parses an attended visit; blank = not assessed', () => {
    expect(visitSchema.parse({ ...attended, painScore: '2', swelling: '', probingMesial: '3', bopMesial: 'yes', isq: '' })).toMatchObject({
      ...attended, painScore: 2, swelling: null, probingMesial: 3, bopMesial: 'yes', isq: null,
    });
  });
  it('treats whitespace-only numbers as not assessed', () => {
    expect(visitSchema.parse({ ...attended, painScore: '  ', probingMesial: ' ' })).toMatchObject({ painScore: null, probingMesial: null });
  });
  it('stores bleeding as "no" for a probed site without a tick, and not assessed for an unprobed site', () => {
    const v = visitSchema.parse({ ...attended, probingMesial: '3', bopMesial: '', bopBuccal: '' });
    expect(v.bopMesial).toBe('no');
    expect(v.bopBuccal).toBeNull();
  });
  it('drops findings and outcome when the patient did not attend', () => {
    const v = visitSchema.parse({ ...attended, attendance: 'did_not_attend', painScore: '4', probingMesial: '5', bopMesial: 'yes', swelling: 'yes' });
    expect(v).toMatchObject({ outcome: null, painScore: null, probingMesial: null, bopMesial: null, swelling: null });
    expect(toFindings(v)).toEqual({});
  });
  it('refuses missing outcome, missing reason, missing check name, ranges and a future date', () => {
    expect(firstError(visitSchema.safeParse({ ...attended, outcome: '' }))).toBe('Choose the outcome.');
    expect(firstError(visitSchema.safeParse({ ...attended, attendance: 'not_needed', outcome: '' }))).toBe('Say why the visit was not needed.');
    expect(firstError(visitSchema.safeParse({ ...attended, visitKey: '', checkType: '' }))).toBe('Enter what the visit was for (e.g. pain review).');
    expect(firstError(visitSchema.safeParse({ ...attended, painScore: '11' }))).toBe('Enter a pain score from 0 to 10.');
    expect(firstError(visitSchema.safeParse({ ...attended, painScore: '2.5' }))).toBe('Enter a pain score from 0 to 10.');
    expect(firstError(visitSchema.safeParse({ ...attended, probingDistal: '16' }))).toBe('Enter probing depths from 0 to 15 mm.');
    expect(firstError(visitSchema.safeParse({ ...attended, isq: '101' }))).toBe('Enter an ISQ from 0 to 100.');
    expect(firstError(visitSchema.safeParse({ ...attended, date: '2999-01-01' }))).toBe('Enter the visit date (today or earlier).');
    expect(firstError(visitSchema.safeParse({ ...attended, attendance: '' }))).toBe('Choose whether the patient attended.');
  });
  it('turns the form into the database findings object, leaving out what was not assessed', () => {
    const v = visitSchema.parse({ ...attended, painScore: '0', patientConcerns: ' sore ', probingBuccal: '4', bopBuccal: 'yes', prosthesisStatus: 'stable' });
    expect(toFindings(v)).toEqual({ pain_score: 0, patient_concerns: 'sore', probing_buccal: 4, bop_buccal: 'yes', prosthesis_status: 'stable' });
  });
});
