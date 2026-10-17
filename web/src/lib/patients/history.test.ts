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
    ).toBe('Medical history changed: diabetes, smoking');
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
  it('names the corrected placement details', () => {
    const before = { tooth: 36, state: 'placed', placed_on: '2026-05-02', placing_delegate_id: 'a', supervisor_id: 's', torque_ncm: 35 };
    const after = { ...before, placed_on: '2026-05-01', placing_delegate_id: 'b' };
    expect(describeChange(entry({ table_name: 'implant_sites', before, after }))).toBe(
      'Implant on tooth 36 corrected: placement date, placed by',
    );
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before } }))).toBe('Implant on tooth 36 updated');
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

describe('describeChange: tri-state medical history', () => {
  it('names the new risk-factor fields once, even when the old boolean changed with them', () => {
    expect(describeChange({
      id: 1, at: '2026-10-17T10:00:00Z', table_name: 'medical_history', action: 'UPDATE', actor: 'A',
      before: { smoker: false, smoking: null, bruxism: null, hba1c: null },
      after: { smoker: true, smoking: 'current', bruxism: 'no', hba1c: 6.5 },
    })).toBe('Medical history changed: smoking, HbA1c, bruxism');
  });
});

describe('describeChange: surgical details and grafts', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A' };
  it('describes surgical details', () => {
    expect(describeChange({ ...base, table_name: 'implant_surgery', action: 'INSERT', before: null, after: { flap: 'crestal' } }))
      .toBe('Surgical details recorded');
    expect(describeChange({
      ...base, table_name: 'implant_surgery', action: 'UPDATE',
      before: { flap: 'crestal', healing: null, updated_at: 'a' }, after: { flap: 'flapless', healing: 'submerged', updated_at: 'b' },
    })).toBe('Surgical details changed: flap, healing');
  });
  it('describes grafts', () => {
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'INSERT', before: null, after: { procedure: 'gbr' } }))
      .toBe('Graft added: GBR');
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'UPDATE', before: { procedure: 'gbr' }, after: { procedure: 'sinus_lateral' } }))
      .toBe('Graft changed: Sinus lift, lateral window');
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'DELETE', before: { procedure: 'ridge_split' }, after: null }))
      .toBe('Graft deleted: Ridge split');
  });
});

describe('describeChange: visits', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A', before: null };
  it('names the result of a scheduled visit, or the attendance when there is no outcome', () => {
    expect(describeChange({ ...base, table_name: 'implant_followups', action: 'INSERT',
      after: { check_type: '6-month review', outcome: null, attendance: 'did_not_attend' } }))
      .toBe('Follow-up (6-month review): Did not attend');
    expect(describeChange({ ...base, table_name: 'implant_followups', action: 'INSERT',
      after: { check_type: 'Early review (suture removal)', outcome: 'ok', attendance: 'attended' } }))
      .toBe('Follow-up (Early review (suture removal)): OK');
  });
});
