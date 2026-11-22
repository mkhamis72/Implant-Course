import { describe, it, expect } from 'vitest';
import { acceptsProduct, activeSite, badgesFor, componentRole, currentComponent, currentComponents, lastFollowup, partLabel, transferComponents, undoableComponents } from './components';
import type { ImplantSite, SiteComponent } from './types';

const comp = (type: SiteComponent['component_type'], removed_on: string | null): SiteComponent => ({
  id: type, component_type: type, fitted_on: '2026-01-01', removed_on, notes: '', product: null, lot: null, course_id: null,
  fitted_by_delegate: null, fitted_by_organizer: null, voided_at: null, voided_reason: '', stock_lot_id: null,
  torque_ncm: null, holds_component_id: null, holds_restoration_id: null, replaced_by: null,
});

const site = (tooth: number, state: ImplantSite['state'], components: SiteComponent[] = []): ImplantSite => ({
  id: `${tooth}-${state}`, tooth, state, technique: null, impression_type: null, impression_taken_on: null, placed_on: '2026-01-01', stock_lot_id: null, torque_ncm: null, isq: null, bone_type: null, graft: '', notes: '', product: null,
  lot: null, placing_delegate_id: null, assisting_delegate_id: null, supervisor_id: null, course_id: null, placing_doctor_id: null, doctor: null,
  placing: null, assisting: null, supervisor: null, components, followups: [], surgery: null, grafts: [], complications: [], updated_at: '2026-01-01T00:00:00Z', failed_on: null, failure_type: null, failure_reason: null, failure_notes: '',
  slot: null, created_at: '2026-01-01T00:00:00Z',
});

const noFindings = {
  pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
  probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null,
  bop_mesial: null, bop_buccal: null, bop_distal: null, bop_lingual: null,
  isq: null, prosthesis_status: null, radiograph_taken: null, recommended_treatment: '',
  recession_facial_mm: null, recession_mesial_mm: null, recession_distal_mm: null,
};

describe('component rules', () => {
  it('matches products to component types', () => {
    expect(acceptsProduct('abutment', 'abutment_angled')).toBe(true);
    expect(acceptsProduct('healing_abutment', 'ti_base')).toBe(false);
    expect(acceptsProduct('final_restoration', 'other')).toBe(true);
  });
  it('finds the current component and active site', () => {
    const s = site(36, 'placed', [comp('healing_abutment', '2026-02-01'), comp('ti_base', null)]);
    expect(currentComponent(s)?.component_type).toBe('ti_base');
    expect(activeSite([site(36, 'failed'), s], 36)).toBe(s);
    expect(activeSite([site(36, 'failed')], 36)).toBeNull();
  });
  it('builds chart badges for active implants only', () => {
    expect(
      badgesFor([
        site(36, 'placed', [comp('ti_base', null)]),
        site(46, 'restored', [comp('final_restoration', null)]),
        site(26, 'restored', [comp('final_restoration', null), comp('abutment', null)]),
        site(11, 'failed', [comp('healing_abutment', null)]),
        site(21, 'planned'),
      ]),
    ).toEqual({ 36: 'TB', 26: 'AB' }); // old final_restoration components are drawn as restorations now
  });
});

describe('component roles', () => {
  it('maps every type like app_private.component_role', () => {
    const expected = {
      cover_screw: 'healing', healing_abutment: 'healing', healing_cap: 'healing',
      ti_base: 'abutment', multi_unit: 'abutment', abutment: 'abutment', temporary_abutment: 'abutment',
      abutment_screw: 'abutment_screw', prosthetic_screw: 'prosthetic_screw', temporary_cylinder_screw: 'prosthetic_screw',
      scan_body: 'transfer', impression_coping: 'transfer', final_restoration: 'legacy',
    };
    expect(Object.keys(expected)).toHaveLength(13);
    for (const [type, role] of Object.entries(expected)) expect(componentRole(type as never)).toBe(role);
  });
  it('matches the new products to the new component types', () => {
    expect(acceptsProduct('temporary_cylinder_screw', 'prosthetic_screw')).toBe(true);
    expect(acceptsProduct('healing_cap', 'healing_abutment')).toBe(false);
    expect(acceptsProduct('abutment_screw', 'abutment_screw')).toBe(true);
  });
  it('lists the current components by role, leaving out closed and voided rows', () => {
    const voided = { ...comp('multi_unit', null), voided_at: '2026-02-01T00:00:00Z' };
    const s = site(36, 'placed', [
      comp('prosthetic_screw', null), comp('healing_abutment', '2026-02-01'), voided,
      comp('abutment_screw', null), comp('ti_base', null), comp('scan_body', null),
    ]);
    expect(currentComponents(s).map((c) => c.component_type)).toEqual(['ti_base', 'abutment_screw', 'prosthetic_screw']);
    expect(currentComponent(s)?.component_type).toBe('ti_base');
    expect(currentComponent(site(36, 'placed', [comp('abutment_screw', null)]))).toBeNull();
  });
  it('shows MUA with an abutment screw also current', () => {
    expect(badgesFor([site(36, 'placed', [comp('abutment_screw', null), comp('multi_unit', null)])])).toEqual({ 36: 'MUA' });
    expect(badgesFor([site(36, 'placed', [comp('healing_cap', null)])])).toEqual({ 36: 'HC' });
  });
});

describe('lastFollowup (I5)', () => {
  it('ignores removed follow-ups', () => {
    const s = site(36, 'placed');
    s.followups = [
      { id: 'a', date: '2026-01-10', check_type: '2-week', outcome: 'ok', notes: '', voided_at: null, voided_reason: '', visit_key: null, attendance: null, ...noFindings },
      { id: 'b', date: '2026-03-10', check_type: '3-month', outcome: 'failed', notes: '', voided_at: '2026-03-11T00:00:00Z', voided_reason: 'wrong patient', visit_key: null, attendance: null, ...noFindings },
    ];
    expect(lastFollowup(s)?.id).toBe('a');
  });
});

describe('parts for the panel and corrections', () => {
  const at = (c: SiteComponent, over: Partial<SiteComponent>): SiteComponent => ({ ...c, ...over });
  const parts = [
    at(comp('healing_abutment', '2026-02-01'), { fitted_on: '2026-01-10', replaced_by: 'multi_unit' }),
    at(comp('multi_unit', null), { fitted_on: '2026-02-01' }),
    at(comp('scan_body', '2026-02-03'), { fitted_on: '2026-02-03' }),
    at(comp('impression_coping', '2026-02-04'), { fitted_on: '2026-02-04', voided_at: '2026-02-05' }),
    at(comp('abutment_screw', null), { fitted_on: '2026-02-05' }),
  ];
  it('names a part with its date, a transfer as used', () => {
    expect(partLabel(parts[1])).toBe('Multi-unit abutment — 01 Feb 2026');
    expect(partLabel(parts[2])).toBe('Scan body — used 03 Feb 2026');
  });
  it('lists transfers that are not voided', () => {
    expect(transferComponents(site(36, 'placed', parts)).map((c) => c.id)).toEqual(['scan_body']);
  });
  it('offers the current parts then the transfers for undo, the latest fitted first chosen', () => {
    const { options, latest } = undoableComponents(site(36, 'placed', parts));
    expect(options.map((c) => c.id)).toEqual(['multi_unit', 'abutment_screw', 'scan_body']);
    expect(latest?.id).toBe('abutment_screw');
  });
});
