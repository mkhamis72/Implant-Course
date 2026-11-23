import { describe, expect, it } from 'vitest';
import type { ImplantSite } from '@/lib/inventory/types';
import { fullArchModel, implantLine, IMPLANT_LENGTH } from './model';

function site(o: Partial<ImplantSite> & { tooth: number }): ImplantSite {
  return {
    id: `s${o.tooth}`, state: 'placed', implant_type: 'conventional', angulation_deg: null,
    angulation_direction: null, anchorage: null, planned_product: null, product: null, ...o,
  } as ImplantSite;
}
const run = (sites: ImplantSite[]) => fullArchModel({ sites, spans: [], badges: {}, types: {} }).implants;

describe('fullArchModel', () => {
  it('conventional placed is upright', () => {
    const [i] = run([site({ tooth: 36 })]);
    expect(i).toMatchObject({ angle: 0, lean: 0, kind: 'conventional', planned: false, jaw: 'lower' });
  });
  it("tilted distal on the patient's right leans left", () => {
    const t = (tooth: number, d: 'distal' | 'mesial') =>
      run([site({ tooth, implant_type: 'tilted', angulation_deg: 30, angulation_direction: d })])[0];
    expect(t(15, 'distal')).toMatchObject({ angle: 30, lean: -1 });
    expect(t(25, 'distal')).toMatchObject({ angle: 30, lean: 1 });
    expect(t(15, 'mesial')).toMatchObject({ lean: 1 });
  });
  it('tilted without angle is upright', () => {
    expect(run([site({ tooth: 15, implant_type: 'tilted' })])[0].angle).toBe(0);
  });
  it('buccal leans nowhere', () => {
    const [i] = run([site({ tooth: 15, implant_type: 'tilted', angulation_deg: 20, angulation_direction: 'buccal' })]);
    expect(i).toMatchObject({ angle: 0, lean: 0 });
    expect(i.description).toContain('20° buccal');
  });
  it('zygomatic defaults', () => {
    expect(run([site({ tooth: 14, implant_type: 'zygomatic' })])[0]).toMatchObject({ angle: 45, lean: -1 });
    expect(run([site({ tooth: 24, implant_type: 'zygomatic' })])[0]).toMatchObject({ angle: 45, lean: 1 });
    expect(run([site({ tooth: 17, implant_type: 'pterygoid' })])[0]).toMatchObject({ angle: 30, lean: -1 });
  });
  it('planned uses planned product kind and stays upright', () => {
    const [i] = run([site({ tooth: 14, state: 'planned', implant_type: null, product: { implant_kind: 'zygomatic' } as never })]);
    expect(i).toMatchObject({ kind: 'zygomatic', planned: true, angle: 0, lean: 0 });
  });
  it('failed is flagged; removed is not drawn', () => {
    expect(run([site({ tooth: 16, state: 'failed' })])[0].failed).toBe(true);
    expect(run([site({ tooth: 16, state: 'removed' })])).toHaveLength(0);
  });
  it('describes the implant', () => {
    const [i] = run([site({ tooth: 16, implant_type: 'zygomatic', angulation_deg: 45, angulation_direction: 'distal' })]);
    expect(i.description).toBe('Implant 16, Zygomatic, 45° distal, placed');
  });
  it('links only to implant teeth', () => {
    const spans = [{ id: 'a', teeth: [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26], implantTeeth: [15, 12, 22, 25], temporary: false, label: 'Bridge' }];
    const { bridges } = fullArchModel({ sites: [], spans, badges: {}, types: {} });
    expect(bridges[0]).toEqual(spans[0]);
  });
  it('lower jaw points down', () => {
    const base = { siteId: 'x', planned: false, failed: false, angle: 30, lean: 1 as const, label: undefined, badge: undefined, description: '' };
    const lo = implantLine({ ...base, tooth: 36, jaw: 'lower', kind: 'conventional' }, { x: 100, y: 100 });
    const up = implantLine({ ...base, tooth: 16, jaw: 'upper', kind: 'zygomatic' }, { x: 100, y: 100 });
    expect(lo.y2).toBeGreaterThan(lo.y1);
    expect(up.y2).toBeLessThan(up.y1);
    expect(Math.hypot(up.x2 - up.x1, up.y2 - up.y1)).toBeCloseTo(IMPLANT_LENGTH.zygomatic);
  });
});
