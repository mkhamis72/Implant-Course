import { describe, it, expect } from 'vitest';
import { acceptsProduct, activeSite, badgesFor, currentComponent, lastFollowup } from './components';
import type { ImplantSite, SiteComponent } from './types';

const comp = (type: SiteComponent['component_type'], removed_on: string | null): SiteComponent => ({
  id: type, component_type: type, fitted_on: '2026-01-01', removed_on, notes: '', product: null, lot: null,
  fitted_by_delegate: null, fitted_by_organizer: null, voided_at: null, voided_reason: '', stock_lot_id: null,
});

const site = (tooth: number, state: ImplantSite['state'], components: SiteComponent[] = []): ImplantSite => ({
  id: `${tooth}-${state}`, tooth, state, technique: null, placed_on: '2026-01-01', stock_lot_id: null, torque_ncm: null, isq: null, bone_type: null, graft: '', notes: '', product: null,
  lot: null, placing_delegate_id: null, assisting_delegate_id: null, supervisor_id: null,
  placing: null, assisting: null, supervisor: null, components, followups: [], surgery: null, grafts: [], complications: [], updated_at: '2026-01-01T00:00:00Z', failed_on: null, failure_type: null, failure_reason: null, failure_notes: '',
  slot: null, created_at: '2026-01-01T00:00:00Z',
});

const noFindings = {
  pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
  probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null,
  bop_mesial: null, bop_buccal: null, bop_distal: null, bop_lingual: null,
  isq: null, prosthesis_status: null, radiograph_taken: null, recommended_treatment: '',
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
        site(11, 'failed', [comp('healing_abutment', null)]),
        site(21, 'planned'),
      ]),
    ).toEqual({ 36: 'TB', 46: 'CR' });
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
