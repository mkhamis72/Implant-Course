import { describe, it, expect } from 'vitest';
import { describeChange } from './history';
import type { HistoryEntry } from './types';

const entry = (e: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1, at: '2026-10-01T10:00:00Z', table_name: 'patients', action: 'UPDATE', actor: 'Dr A', before: null, after: null, ...e,
});

describe('describeChange', () => {
  it('describes patient creation, edits and archiving', () => {
    expect(describeChange(entry({ action: 'INSERT', after: { full_name: 'X' } }))).toBe('Patient created');
    expect(
      describeChange(entry({ before: { phone: '1', email: 'a', updated_at: 'x' }, after: { phone: '2', email: 'a', updated_at: 'y' } })),
    ).toBe('Patient details changed: phone');
    expect(describeChange(entry({ before: { archived: false }, after: { archived: true } }))).toBe('Patient archived');
    expect(describeChange(entry({ before: { archived: true }, after: { archived: false } }))).toBe('Patient restored');
  });
  it('describes medical history changes', () => {
    expect(
      describeChange(entry({ table_name: 'medical_history', before: { diabetes: false, smoker: false }, after: { diabetes: true, smoker: true } })),
    ).toBe('Medical history changed: diabetes, smoker');
    expect(describeChange(entry({ table_name: 'medical_history', action: 'INSERT', after: {} }))).toBe('Medical history started');
  });
  it('describes tooth status changes', () => {
    expect(describeChange(entry({ table_name: 'tooth_status', action: 'INSERT', after: { tooth: 36, status: 'missing' } }))).toBe(
      'Tooth 36: Present → Missing',
    );
    expect(
      describeChange(entry({ table_name: 'tooth_status', before: { tooth: 36, status: 'missing' }, after: { tooth: 36, status: 'extracted' } })),
    ).toBe('Tooth 36: Missing → To be extracted');
  });
  it('describes notes', () => {
    expect(describeChange(entry({ table_name: 'visit_notes', action: 'INSERT', after: { teeth: [36, 46] } }))).toBe(
      'Note added (teeth 36, 46)',
    );
    expect(describeChange(entry({ table_name: 'visit_notes', action: 'INSERT', after: { teeth: [] } }))).toBe('Note added');
  });
});

describe('describeChange — implants', () => {
  it('describes implant records', () => {
    expect(describeChange(entry({ table_name: 'implant_sites', action: 'INSERT', after: { tooth: 36, state: 'planned' } }))).toBe(
      'Implant on tooth 36: Planned',
    );
    expect(
      describeChange(entry({ table_name: 'implant_sites', before: { tooth: 36, state: 'planned' }, after: { tooth: 36, state: 'placed' } })),
    ).toBe('Implant on tooth 36: Planned → Placed');
  });
});

describe('describeChange for implant follow-up records', () => {
  it('describes fitted and voided components', () => {
    expect(describeChange(entry({ table_name: 'site_components', action: 'INSERT', after: { component_type: 'healing_abutment', voided_at: null } })))
      .toBe('Component fitted: Healing abutment');
    expect(describeChange(entry({
      table_name: 'site_components', before: { component_type: 'ti_base', voided_at: null },
      after: { component_type: 'ti_base', voided_at: '2026-10-01', voided_reason: 'Wrong entry' },
    }))).toBe('Component removed from the record: Ti-base (Wrong entry)');
  });
  it('describes recorded and voided follow-ups', () => {
    expect(describeChange(entry({ table_name: 'implant_followups', action: 'INSERT', after: { check_type: 'Review', outcome: 'integrated', voided_at: null } })))
      .toBe('Follow-up (Review): Integrated');
    expect(describeChange(entry({
      table_name: 'implant_followups', before: { check_type: 'Review', outcome: 'failed', voided_at: null },
      after: { check_type: 'Review', outcome: 'failed', voided_at: '2026-10-01', voided_reason: 'Typo' },
    }))).toBe('Follow-up removed from the record: Review (Typo)');
  });
});
