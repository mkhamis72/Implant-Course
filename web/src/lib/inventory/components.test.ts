import { describe, it, expect } from 'vitest';
import { acceptsProduct, activeSite, badgesFor, currentComponent } from './components';
import type { ImplantSite, SiteComponent } from './types';

const comp = (type: SiteComponent['component_type'], removed_on: string | null): SiteComponent => ({
  id: type, component_type: type, fitted_on: '2026-01-01', removed_on, notes: '', product: null, lot: null,
  fitted_by_delegate: null, fitted_by_organizer: null, voided_at: null, voided_reason: '',
});

const site = (tooth: number, state: ImplantSite['state'], components: SiteComponent[] = []): ImplantSite => ({
  id: `${tooth}-${state}`, tooth, state, placed_on: '2026-01-01', torque_ncm: null, graft: '', notes: '', product: null,
  lot: null, placing: null, assisting: null, supervisor: null, components, followups: [], slot: null, created_at: '2026-01-01T00:00:00Z',
});

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
