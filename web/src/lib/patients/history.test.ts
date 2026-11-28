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
  it('describes an implant removed as entered by mistake, and hides the step that stored the reason (0099)', () => {
    const before = { tooth: 36, state: 'placed', removal_reason: null };
    const marked = { ...before, removal_reason: 'Wrong tooth' };
    expect(describeChange(entry({ table_name: 'implant_sites', action: 'DELETE', before: marked, after: null }))).toBe(
      'Implant on tooth 36 removed (entered by mistake): Wrong tooth',
    );
    expect(describeChange(entry({ table_name: 'implant_sites', action: 'DELETE', before, after: null }))).toBe(
      'Implant on tooth 36 deleted',
    );
    expect(isHiddenFromHistory(entry({ table_name: 'implant_sites', before, after: marked }))).toBe(true);
    expect(isHiddenFromHistory(entry({ table_name: 'implant_sites', action: 'DELETE', before: marked, after: null }))).toBe(false);
  });
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
  it('labels type and angle changes (set_implant_geometry, 0140)', () => {
    const before = {
      tooth: 14, state: 'placed', implant_type: 'zygomatic', angulation_deg: null, angulation_direction: null, anchorage: null,
      entry_point: '', trajectory: '', planned_product_id: 'p1',
    };
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, angulation_deg: 45 } }))).toBe(
      'Implant on tooth 14: type and angle recorded — angle',
    );
    expect(describeChange(entry({
      table_name: 'implant_sites', before,
      after: { ...before, implant_type: 'pterygoid', angulation_direction: 'distal', anchorage: 'zygoma', entry_point: 'a', trajectory: 'b' },
    }))).toBe('Implant on tooth 14: type and angle recorded — implant type, direction, anchorage, entry point, trajectory');
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, planned_product_id: 'p2' } }))).toBe(
      'Implant on tooth 14 corrected: planned product',
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
  it('names a torque or holder change on a component, and a replaced part', () => {
    expect(describeChange(entry({
      table_name: 'site_components', before: { component_type: 'prosthetic_screw', torque_ncm: 15, voided_at: null },
      after: { component_type: 'prosthetic_screw', torque_ncm: 20, voided_at: null },
    }))).toBe('Component updated: Prosthetic screw (torque)');
    expect(describeChange(entry({
      table_name: 'site_components', before: { component_type: 'abutment_screw', holds_component_id: 'a', torque_ncm: 25, voided_at: null },
      after: { component_type: 'abutment_screw', holds_component_id: 'b', torque_ncm: 25, voided_at: null },
    }))).toBe('Component updated: Abutment screw (holds)');
    expect(describeChange(entry({
      table_name: 'site_components', before: { component_type: 'multi_unit', removed_on: null, replaced_by: null, voided_at: null },
      after: { component_type: 'multi_unit', removed_on: '2026-11-03', replaced_by: 'x', voided_at: null },
    }))).toBe('Component replaced: Multi-unit abutment');
    expect(describeChange(entry({
      table_name: 'site_components', before: { component_type: 'multi_unit', removed_on: '2026-11-03', replaced_by: 'x', voided_at: null },
      after: { component_type: 'multi_unit', removed_on: null, replaced_by: null, voided_at: null },
    }))).toBe('Component back in place: Multi-unit abutment');
    expect(describeChange(entry({ table_name: 'site_components', action: 'INSERT', after: { component_type: 'scan_body', voided_at: null } })))
      .toBe('Component fitted: Scan body');
  });
  it('shows one entry per replacement: the closing update is hidden, the replaced_by update describes it', () => {
    const open = { id: 'c', component_type: 'multi_unit', removed_on: null, replaced_by: null, voided_at: null, torque_ncm: 30 };
    const closed = { ...open, removed_on: '2026-11-03' };
    expect(isHiddenFromHistory(entry({ table_name: 'site_components', before: open, after: closed }))).toBe(true);
    expect(isHiddenFromHistory(entry({ table_name: 'site_components', before: closed, after: { ...closed, replaced_by: 'x' } }))).toBe(false);
    expect(isHiddenFromHistory(entry({ table_name: 'site_components', before: open, after: { ...closed, torque_ncm: 20 } }))).toBe(false);
    expect(isHiddenFromHistory(entry({ table_name: 'site_components', action: 'INSERT', before: null, after: closed }))).toBe(false);
    expect(isHiddenFromHistory(entry({ table_name: 'site_components', before: closed, after: open }))).toBe(false);
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
  it('describes ending and reopening a restoration', () => {
    const open = { stage: 'temporary', ended_on: null, end_kind: null, end_reason: null, ended_by: null, voided_at: null };
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE',
      before: open, after: { ...open, ended_on: '2026-10-20', end_kind: 'replaced', ended_by: 'r2' } }))
      .toBe('Restoration replaced on 20 Oct 2026');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE',
      before: { ...open, stage: 'final' }, after: { ...open, stage: 'final', ended_on: '2026-10-20', end_kind: 'remade', end_reason: 'Chipped', ended_by: 'r2' } }))
      .toBe('Restoration remade on 20 Oct 2026 (Chipped)');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE',
      before: { ...open, ended_on: '2026-10-20', end_kind: 'replaced', ended_by: 'r2' }, after: open }))
      .toBe('Restoration reopened');
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

describe('describeChange: implant passports', () => {
  const base = { id: 1, at: '2026-11-24T10:00:00Z', actor: 'A' };
  it('names the generated version', () => {
    const p = { version: 2, medical_level: 'none', size_bytes: 1000 };
    expect(describeChange({ ...base, table_name: 'patient_passports', action: 'INSERT', before: null, after: p }))
      .toBe('Implant passport generated (version 2)');
    expect(describeChange({ ...base, table_name: 'patient_passports', action: 'DELETE', before: p, after: null }))
      .toBe('Implant passport deleted (version 2)');
  });
  it('a browser-built passport (0150): its medical content', () => {
    expect(describeChange({ ...base, table_name: 'passport_generations', action: 'INSERT', before: null, after: { medical_level: 'full' } }))
      .toBe('Implant passport generated (Full medical summary)');
  });
});

describe('describeChange: full-arch cases', () => {
  const base = { id: 1, at: '2026-11-24T10:00:00Z', actor: 'A' };
  const c = { arch: 'upper', configuration: 'all_on_4', name: '', notes: '', closed_at: null, close_reason: null };
  it('describes a case', () => {
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'INSERT', before: null, after: c }))
      .toBe('Full-arch case started: Upper arch, All-on-4');
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'UPDATE', before: c, after: { ...c, configuration: 'all_on_6', name: 'Plan B' } }))
      .toBe('Full-arch case updated: configuration, name');
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'UPDATE', before: c, after: { ...c, notes: 'x' } }))
      .toBe('Full-arch case updated: notes');
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'UPDATE', before: c, after: { ...c, closed_at: '2026-11-24T10:00:00Z', close_reason: 'Moved' } }))
      .toBe('Full-arch case closed (Moved)');
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'UPDATE', before: { ...c, closed_at: '2026-11-24T10:00:00Z', close_reason: 'Moved' }, after: c }))
      .toBe('Full-arch case reopened');
    expect(describeChange({ ...base, table_name: 'full_arch_cases', action: 'DELETE', before: c, after: null }))
      .toBe('Full-arch case deleted: Upper arch, All-on-4');
  });
  it('describes stages with their fields', () => {
    const s = { stage: 'lab_design', done_on: '2026-11-10', lab: 'Lab A', passive_fit: null, occlusion: null, notes: '' };
    expect(describeChange({ ...base, table_name: 'full_arch_stages', action: 'INSERT', before: null, after: s }))
      .toBe('Full-arch stage recorded: Lab and design approved on 10 Nov 2026 (lab Lab A)');
    expect(describeChange({ ...base, table_name: 'full_arch_stages', action: 'INSERT', before: null,
      after: { ...s, stage: 'try_in', lab: null, passive_fit: true, occlusion: 'Even' } }))
      .toBe('Full-arch stage recorded: Try-in on 10 Nov 2026 (passive fit yes, occlusion Even)');
    expect(describeChange({ ...base, table_name: 'full_arch_stages', action: 'UPDATE', before: s, after: { ...s, done_on: '2026-11-12', lab: 'Lab B' } }))
      .toBe('Full-arch stage updated: Lab and design approved (date, lab)');
    expect(describeChange({ ...base, table_name: 'full_arch_stages', action: 'DELETE', before: { ...s, stage: 'scan', lab: null }, after: null }))
      .toBe('Full-arch stage cleared: Scan / impression');
  });
  it('labels a restoration update that changes only its case link', () => {
    const r = { stage: 'final', teeth: [15, 25], material: 'zirconia', case_id: null, voided_at: null };
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE', before: r, after: { ...r, case_id: 'c1' } }))
      .toBe('Linked to full-arch case');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE', before: { ...r, case_id: 'c1' }, after: r }))
      .toBe('Removed from full-arch case');
    expect(describeChange({ ...base, table_name: 'restorations', action: 'UPDATE', before: r, after: { ...r, case_id: 'c1', material: 'pmma_acrylic' } }))
      .toBe('Restoration updated: material');
  });
});

describe('describeChange: implant case membership', () => {
  const base = { id: 1, at: '2026-11-24T10:00:00Z', actor: 'A', table_name: 'implant_sites', action: 'UPDATE' as const };
  const s = { tooth: 15, state: 'placed', case_id: null };
  it('labels an update that changes only the case link', () => {
    expect(describeChange({ ...base, before: s, after: { ...s, case_id: 'c1' } })).toBe('Added to full-arch case: implant on tooth 15');
    expect(describeChange({ ...base, before: { ...s, case_id: 'c1' }, after: s })).toBe('Removed from full-arch case: implant on tooth 15');
  });
  it('keeps other changes on their own label', () => {
    expect(describeChange({ ...base, before: s, after: { ...s, case_id: 'c1', state: 'restored' } })).not.toMatch(/full-arch case/);
  });
});

describe('restoration links', () => {
  it('hides restoration_sites rows and nothing else', () => {
    const base = { id: 1, at: '2026-10-21T10:00:00Z', actor: 'A', action: 'INSERT' as const, before: null, after: { site_id: 's1' } };
    expect(isHiddenFromHistory({ ...base, table_name: 'restoration_sites' })).toBe(true);
    expect(isHiddenFromHistory({ ...base, table_name: 'restorations' })).toBe(false);
  });
});

describe('describeChange: radiographs', () => {
  const base = { id: 1, at: '2026-10-22T10:00:00Z', actor: 'A' };
  it('describes adding, updating and removing an X-ray', () => {
    expect(describeChange({ ...base, table_name: 'radiographs', action: 'INSERT', before: null, after: { type: 'periapical', purpose: 'baseline', teeth: [46, 47] } }))
      .toBe('X-ray added: Periapical, Baseline (after placement) (teeth 46, 47)');
    expect(describeChange({ ...base, table_name: 'radiographs', action: 'UPDATE',
      before: { type: 'cbct', purpose: 'planning', teeth: [46], link: null, notes: '' },
      after: { type: 'cbct', purpose: 'planning', teeth: [46, 47], link: 'https://x.test', notes: '' } }))
      .toBe('X-ray updated: teeth, link');
    expect(describeChange({ ...base, table_name: 'radiographs', action: 'UPDATE',
      before: { voided_at: null }, after: { voided_at: '2026-10-22T10:00:00Z', voided_reason: 'wrong patient' } }))
      .toBe('X-ray removed from the record (wrong patient)');
  });
  it('describes bone-level rows without a tooth (the row holds only the implant id)', () => {
    expect(describeChange({ ...base, table_name: 'radiograph_bone_levels', action: 'INSERT', before: null, after: { site_id: 's1', mesial_mm: 0.5 } }))
      .toBe('Bone level recorded: mesial 0.5 mm, distal —');
    expect(describeChange({ ...base, table_name: 'radiograph_bone_levels', action: 'UPDATE',
      before: { site_id: 's1', mesial_mm: 0.5, distal_mm: 2 }, after: { site_id: 's1', mesial_mm: 1, distal_mm: 2 } }))
      .toBe('Bone level updated: mesial 0.5 mm → 1 mm');
    expect(describeChange({ ...base, table_name: 'radiograph_bone_levels', action: 'UPDATE',
      before: { site_id: 's1', mesial_mm: null, distal_mm: 2 }, after: { site_id: 's1', mesial_mm: 1.5, distal_mm: null } }))
      .toBe('Bone level updated: mesial — → 1.5 mm, distal 2 mm → —');
    expect(describeChange({ ...base, table_name: 'radiograph_bone_levels', action: 'DELETE',
      before: { site_id: 's1', mesial_mm: null, distal_mm: -0.5 }, after: null }))
      .toBe('Bone level removed: mesial —, distal -0.5 mm');
  });
});

describe('describeChange: placed by a doctor, course, and clinic labels', () => {
  const before = { tooth: 36, state: 'placed', placed_on: '2026-05-02', placing_delegate_id: 'a', placing_doctor_id: null,
    assisting_delegate_id: 'x', supervisor_id: 's', course_id: 'c1' };
  it('names a change to a doctor or to the course', () => {
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, placing_delegate_id: null, placing_doctor_id: 'd' } })))
      .toBe('Implant on tooth 36 corrected: placed by');
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, course_id: 'c2' } })))
      .toBe('Implant on tooth 36 corrected: course');
  });
  it('leaves out teaching details in a clinic', () => {
    const after = { ...before, placed_on: '2026-05-01', assisting_delegate_id: null, supervisor_id: null, course_id: null };
    expect(describeChange(entry({ table_name: 'implant_sites', before, after }), { teaching: false }))
      .toBe('Implant on tooth 36 corrected: placement date');
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, supervisor_id: null } }), { teaching: false }))
      .toBe('Implant on tooth 36 updated');
    expect(describeChange(entry({ table_name: 'implant_sites', before, after: { ...before, placing_doctor_id: 'd' } }), { teaching: false }))
      .toBe('Implant on tooth 36 corrected: placed by');
    expect(describeChange(entry({ table_name: 'implant_sites', before, after }))).toBe(
      'Implant on tooth 36 corrected: placement date, assisted by, supervisor, course',
    );
  });
  it('leaves out teaching details of a restoration in a clinic', () => {
    const r = { stage: 'final', material: 'zirconia', delegate_id: 'a', supervisor_id: 's', course_id: 'c' };
    expect(describeChange(entry({ table_name: 'restorations', before: r, after: { ...r, material: 'emax', delegate_id: null } }), { teaching: false }))
      .toBe('Restoration updated: material');
    expect(describeChange(entry({ table_name: 'restorations', before: r, after: { ...r, course_id: null } }), { teaching: false }))
      .toBe('Restoration updated');
  });
});
