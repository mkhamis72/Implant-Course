import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./chart-actions', () => ({ setToothStatus: vi.fn() }));
vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn() }));
vi.mock('./restoration-actions', () => ({
  addRestoration: vi.fn(), updateRestoration: vi.fn(), voidRestoration: vi.fn(),
  recordRestorationProblem: vi.fn(), updateRestorationProblem: vi.fn(), voidRestorationProblem: vi.fn(),
}));
vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));
vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./xrays/actions', () => ({ saveRadiograph: vi.fn(), voidRadiograph: vi.fn() }));
vi.mock('./implant-actions', () => ({
  planImplant: vi.fn(), placeImplant: vi.fn(), cancelPlan: vi.fn(), setTechnique: vi.fn(), recordImpression: vi.fn(), fitComponent: vi.fn(),
  correctBatch: vi.fn(), voidFollowup: vi.fn(), voidComponent: vi.fn(),
}));
import { ChartPanel } from './chart-panel';

const data = (editable: boolean) =>
  ({
    statuses: {}, sites: [], visits: [], implants: [], componentProducts: [], lots: [], delegates: [], organizers: [], supervisors: [], restorations: [], courses: [], radiographs: [],
    today: '2030-06-10', me: 'u1', editable,
  }) as unknown as ChartData;

describe('ChartPanel', () => {
  it('offers tooth states and the next implant step to editors', () => {
    render(<ChartPanel patientId="pt" data={data(true)} initialTooth={36} />);
    expect(screen.getByRole('group', { name: 'Tooth status' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(3);
  });

  it('shows the chart read-only to viewers', () => {
    render(<ChartPanel patientId="pt" data={data(false)} initialTooth={36} />);
    expect(screen.queryByRole('group', { name: 'Tooth status' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Implant record' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan|Place/ })).toBeNull();
  });

  it('a placed implant shows its record in tabs; Record visit and Add component show the tab they add to', () => {
    const site = {
      id: 's1', tooth: 36, state: 'placed', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      components: [], followups: [], complications: [], surgery: null, grafts: [],
    };
    const placed = { ...data(true), statuses: { 36: 'implant_placed' }, sites: [site] } as unknown as ChartData;
    render(<ChartPanel patientId="pt" data={placed} initialTooth={36} />);
    expect(screen.getByRole('tab', { name: 'Implant' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Record visit' }));
    expect(screen.getByRole('tab', { name: 'Visits' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByRole('tab', { name: 'Implant' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a failed implant still offers the scan / impression control', () => {
    const site = {
      id: 's2', tooth: 36, state: 'failed', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      components: [], followups: [], complications: [], surgery: null, grafts: [], impression_type: null, impression_taken_on: null,
    };
    const failed = { ...data(true), statuses: { 36: 'implant_placed' }, sites: [site] } as unknown as ChartData;
    render(<ChartPanel patientId="pt" data={failed} initialTooth={36} />);
    expect(screen.getByRole('combobox', { name: 'Scan / impression' })).toBeInTheDocument();
  });

  it('draws a bridge as one bar; clicking its pontic opens the first implant on the Restoration tab', () => {
    const site = (id: string, tooth: number) => ({
      id, tooth, state: 'restored', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      components: [], followups: [], complications: [], surgery: null, grafts: [],
    });
    const bridge = {
      id: 'r1', stage: 'final', type: 'bridge', teeth: [34, 35, 36], fitted_on: '2030-05-01', retention: 'screw', material: 'zirconia',
      delegate_id: null, supervisor_id: null, course_id: null, notes: '', ended_on: null, end_kind: null, end_reason: null,
      updated_at: '2030-05-01T10:00:00+00:00', site_ids: ['s36', 's34'], problems: [],
    };
    const ended = { ...bridge, id: 'r0', stage: 'temporary', ended_on: '2030-05-01', end_kind: 'replaced' };
    const restored = {
      ...data(true), statuses: { 34: 'restored', 36: 'restored' }, sites: [site('s34', 34), site('s36', 36)], restorations: [ended, bridge],
    } as unknown as ChartData;
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
    render(<ChartPanel patientId="pt" data={restored} initialTooth={null} />);
    expect(screen.getAllByRole('button', { name: /^Bridge / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 35, / }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('34');
    expect(screen.getByRole('tab', { name: /^Restoration/ })).toHaveAttribute('aria-selected', 'true');
    // A second tap on the pontic, with its restoration open, selects the tooth itself (touch has no Shift).
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 35, / }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('35');
    expect(screen.queryByRole('tab', { name: /^Restoration/ })).toBeNull();
  });

  it('shows the Date problem badge only for the implant whose site has an issue', () => {
    const site = {
      id: 's1', tooth: 36, state: 'placed', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      components: [], followups: [], complications: [], surgery: null, grafts: [],
    };
    const issue = (site_id: string | null) => ({
      patient_id: 'pt', patient_name: 'A', file_no: 'P1', site_id, tooth: 36, kind: 'before_placement', record_table: 'implant_followups',
      record_id: 'r', record_date: '2030-01-01', reference_date: '2030-03-10', message: 'm',
    });
    const withIssues = (issues: unknown[]) =>
      ({ ...data(true), statuses: { 36: 'implant_placed' }, sites: [site], issues }) as unknown as ChartData;
    const { unmount } = render(<ChartPanel patientId="pt" data={withIssues([issue('s1')])} initialTooth={36} />);
    expect(screen.getByText('Date problem')).toBeInTheDocument();
    unmount();
    render(<ChartPanel patientId="pt" data={withIssues([issue('other')])} initialTooth={36} />);
    expect(screen.queryByText('Date problem')).toBeNull();
  });
});
