import { describe, it, expect } from 'vitest';
import { drilldownHref, effectiveSystem, rpcArgs, selectImplants, isDrilldownList, type DetailRow } from './view';

const row = (over: Partial<DetailRow> = {}): DetailRow => ({
  site_id: 's', patient_id: 'p', tooth: 11, placed_on: '2025-01-01', year_1: 'survived', year_2: 'not_reached',
  latest_grade: 'I', latest_grade_reason: null, biological_complications: 0, mechanical_complications: 0,
  follow_up_days: 400, event: false, event_time_unknown: false, product_id: 'x', brand: 'Oxy', system: 'PSK',
  patient_name: 'A', file_no: '1', ...over,
});

describe('rpcArgs', () => {
  it('turns empty or malformed filters into null', () => {
    expect(rpcArgs({ course: '', from: 'nope', to: '2026-01-31', delegate: 'x', brand: '', system: 'PSK' })).toEqual({
      p_course: null, p_from: null, p_to: '2026-01-31', p_delegate: null, p_brand: null, p_system: 'PSK',
    });
  });
  it('keeps uuids', () => {
    const id = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
    expect(rpcArgs({ course: id, from: '', to: '', delegate: id, brand: 'Oxy', system: '' })).toMatchObject({ p_course: id, p_delegate: id, p_brand: 'Oxy' });
  });
});

describe('drilldownHref', () => {
  it('carries the non-empty filters', () => {
    expect(drilldownHref('year_1_failed', { course: 'c1', from: '2025-01-01', to: '', delegate: '', brand: 'Oxy', system: '' }))
      .toBe('/patients/research/drilldown?list=year_1_failed&course=c1&from=2025-01-01&brand=Oxy');
  });
});

describe('selectImplants', () => {
  const rows = [
    row({ site_id: 'a', year_1: 'failed', latest_grade: 'IV' }),
    row({ site_id: 'b', latest_grade: null, biological_complications: 1, product_id: null }),
    row({ site_id: 'c', latest_grade: 'not_assessable', event_time_unknown: true, mechanical_complications: 2 }),
  ];
  const ids = (list: Parameters<typeof selectImplants>[0]) => selectImplants(list, rows).map((r) => r.site_id);
  it('selects by milestone, grade, complication and the excluded / no-product groups', () => {
    expect(ids('implants')).toEqual(['a', 'b', 'c']);
    expect(ids('year_1_failed')).toEqual(['a']);
    expect(ids('year_1_survived')).toEqual(['b', 'c']);
    expect(ids('icoi_IV')).toEqual(['a']);
    expect(ids('icoi_not_graded')).toEqual(['b']);
    expect(ids('icoi_not_assessable')).toEqual(['c']);
    expect(ids('biological')).toEqual(['b']);
    expect(ids('mechanical')).toEqual(['c']);
    expect(ids('km_excluded')).toEqual(['c']);
    expect(ids('no_product')).toEqual(['b']);
  });
  it('knows its lists', () => {
    expect(isDrilldownList('crowns_remade')).toBe(true);
    expect(isDrilldownList('drop table')).toBe(false);
  });
});

describe('calendar dates and effectiveSystem', () => {
  it('treats an impossible date as no filter', () => {
    expect(rpcArgs({ course: '', from: '2026-02-31', to: '2026-13-01', delegate: '', brand: '', system: '' })).toMatchObject({ p_from: null, p_to: null });
  });
  it('drops a system that does not belong to the brand', () => {
    const rows = [row({ brand: 'Oxy', system: 'PSK' }), row({ brand: 'Other', system: 'ZZ' })];
    expect(effectiveSystem('Oxy', 'ZZ', rows)).toBe('');
    expect(effectiveSystem('Oxy', 'PSK', rows)).toBe('PSK');
    expect(effectiveSystem('', 'ZZ', rows)).toBe('ZZ');
    expect(effectiveSystem('Oxy', '', rows)).toBe('');
  });
});
