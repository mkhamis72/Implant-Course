import { describe, it, expect } from 'vitest';
import { describeChange, isHiddenFromHistory } from './history';
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
  it('labels scan / impression and stability changes', () => {
    const before = { tooth: 36, state: 'placed', impression_type: null, impression_taken_on: null, torque_ncm: null, isq: null, bone_type: null };
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, impression_type: 'digital_scan', impression_taken_on: '2026-03-10' } }))).toBe(
      'Implant on tooth 36: scan / impression recorded — Digital scan · 10 Mar 2026',
    );
    expect(describeChange(entry({ table_name: 'implant_sites', before: { ...before, impression_type: 'conventional' }, after: before }))).toBe(
      'Implant on tooth 36: scan / impression cleared',
    );
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, torque_ncm: 35, isq: 70 } }))).toBe(
      'Implant on tooth 36: stability recorded — torque, ISQ',
    );
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

describe('describeChange: complications and failure', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A' };
  it('describes complications', () => {
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'INSERT', before: null, after: { type: 'peri_implantitis', resolved_on: null } }))
      .toBe('Complication recorded: Peri-implantitis');
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'UPDATE',
      before: { type: 'peri_implantitis', resolved_on: null, voided_at: null }, after: { type: 'peri_implantitis', resolved_on: '2026-10-01', voided_at: null } }))
      .toBe('Complication resolved: Peri-implantitis');
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'UPDATE',
      before: { type: 'infection', voided_at: null }, after: { type: 'infection', voided_at: '2026-10-02', voided_reason: 'Wrong tooth' } }))
      .toBe('Complication removed from the record: Infection (Wrong tooth)');
  });
  it('describes failure details on the implant', () => {
    expect(describeChange({ ...base, table_name: 'implant_sites', action: 'UPDATE',
      before: { tooth: 46, state: 'placed', failure_type: null }, after: { tooth: 46, state: 'failed', failure_type: 'removed', failure_reason: 'peri_implantitis' } }))
      .toBe('Implant on tooth 46: failure recorded — Removed (Peri-implantitis)');
    expect(describeChange({ ...base, table_name: 'implant_sites', action: 'UPDATE',
      before: { tooth: 46, state: 'failed', failure_type: 'removed', failed_on: '2026-05-01', failure_reason: 'fracture' },
      after: { tooth: 46, state: 'failed', failure_type: 'lost', failed_on: '2026-05-01', failure_reason: 'fracture' } }))
      .toBe('Implant on tooth 46: failure details corrected: failure type');
  });
});

describe('describeChange: restorations', () => {
  const base = { id: 1, at: '2026-10-21T10:00:00Z', actor: 'A' };
  it('describes adding, updating and removing a restoration', () => {
    expect(describeChange({ ...base, table_name: 'restorations', action: 'INSERT', before: null, after: { stage: 'final', type: 'bridge', teeth: [34, 35, 36] } }))
      .toBe('Restoration added: Final bridge on 34–36');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'INSERT', before: null, after: { stage: 'temporary', type: 'single_crown', teeth: [36] } }))
      .toBe('Restoration added: Temporary single crown on 36');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE',
      before: { stage: 'final', type: 'bridge', teeth: [34, 35, 36], material: null, notes: '', voided_at: null },
      after: { stage: 'final', type: 'bridge', teeth: [34, 35, 36], material: 'zirconia', notes: '', voided_at: null } }))
      .toBe('Restoration updated: material');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE',
      before: { stage: 'final', voided_at: null }, after: { stage: 'final', voided_at: '2026-10-21', voided_reason: 'Wrong tooth' } }))
      .toBe('Restoration removed from the record (Wrong tooth)');
  });
  it('describes problems', () => {
    expect(describeChange({ ...base, table_name: 'restoration_problems', action: 'INSERT', before: null, after: { type: 'debonding', action: 'recemented' } }))
      .toBe('Restoration problem recorded: Debonding / loss of retention — Recemented');
    expect(describeChange({ ...base, table_name: 'restoration_problems', action: 'UPDATE',
      before: { type: 'chipping', action: 'none', voided_at: null }, after: { type: 'chipping', action: 'repaired', voided_at: null } }))
      .toBe('Restoration problem updated: Chipping — Repaired / polished');
    expect(describeChange({ ...base, table_name: 'restoration_problems', action: 'UPDATE',
      before: { type: 'wear', action: 'none', voided_at: null }, after: { type: 'wear', action: 'none', voided_at: '2026-10-21', voided_reason: 'Duplicate' } }))
      .toBe('Restoration problem removed from the record: Wear (Duplicate)');
  });
});

describe('restoration links', () => {
  it('hides restoration_sites rows and nothing else', () => {
    const base = { id: 1, at: '2026-10-21T10:00:00Z', actor: 'A', action: 'INSERT' as const, before: null, after: { site_id: 's1' } };
    expect(isHiddenFromHistory({ ...base, table_name: 'restoration_sites' })).toBe(true);
    expect(isHiddenFromHistory({ ...base, table_name: 'restorations' })).toBe(false);
  });
});
