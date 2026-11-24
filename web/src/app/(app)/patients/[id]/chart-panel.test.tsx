import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./chart-actions', () => ({ setToothStatus: vi.fn() }));
vi.mock('./case-actions', () => ({
  createCase: vi.fn(), updateCase: vi.fn(), setCaseSites: vi.fn(), setCaseRestoration: vi.fn(), recordCaseStage: vi.fn(),
  clearCaseStage: vi.fn(), closeCase: vi.fn(), reopenCase: vi.fn(),
}));
vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn(), saveImplantGeometry: vi.fn() }));
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
    today: '2030-06-10', me: 'u1', editable, inventoryOn: true, teachingOn: true, doctors: [], cases: [],
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

  it('shows no Date problem badge (impossible dates are refused at entry)', () => {
    const site = {
      id: 's1', tooth: 36, state: 'placed', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      components: [], followups: [], complications: [], surgery: null, grafts: [],
    };
    render(<ChartPanel patientId="pt" data={{ ...data(true), statuses: { 36: 'implant_placed' }, sites: [site] } as unknown as ChartData} initialTooth={36} />);
    expect(screen.queryByText('Date problem')).toBeNull();
  });

  it('labels a zygomatic implant on the chart and keeps its component badge', () => {
    const site = {
      id: 's1', tooth: 14, state: 'placed', placed_on: '2030-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null,
      graft: '', product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
      complications: [], followups: [], surgery: null, grafts: [], implant_type: 'zygomatic',
      components: [{ id: 'c1', component_type: 'healing_abutment', fitted_on: '2030-03-10', removed_on: null, voided_at: null, replaced_by: null }],
    };
    render(<ChartPanel patientId="pt" data={{ ...data(true), statuses: { 14: 'implant_placed' }, sites: [site] } as unknown as ChartData} initialTooth={null} />);
    const tooth = screen.getByRole('button', { name: /^Tooth 14, / });
    expect(tooth.querySelector('[data-type-label]')?.textContent).toBe('ZYG');
    expect(tooth.querySelector('[data-badge]')).not.toBeNull();
  });

  describe('Teeth | Full arch switch', () => {
    it('shows Teeth by default', () => {
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />);
      expect(screen.getByRole('button', { name: 'Teeth', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Full arch', pressed: false })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Tooth 36, / })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Full-arch chart' })).toBeNull();
    });

    it('Back and Forward move through the views, keeping other params', () => {
      window.history.replaceState(null, '', '/patients/pt?tooth=36');
      const push = vi.spyOn(window.history, 'pushState');
      const { unmount } = render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />);
      fireEvent.click(screen.getByRole('button', { name: 'Full arch' }));
      expect(push).toHaveBeenLastCalledWith(null, '', expect.stringMatching(/tooth=36.*view=arch|view=arch.*tooth=36/));
      fireEvent.click(screen.getByRole('button', { name: 'Teeth' }));
      expect(push).toHaveBeenLastCalledWith(null, '', '/patients/pt?tooth=36');
      // Back to Full arch, then to Teeth.
      window.history.replaceState(null, '', '/patients/pt?tooth=36&view=arch');
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
      expect(screen.getByRole('button', { name: 'Full arch', pressed: true })).toBeInTheDocument();
      window.history.replaceState(null, '', '/patients/pt?tooth=36');
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
      expect(screen.getByRole('button', { name: 'Teeth', pressed: true })).toBeInTheDocument();
      unmount();
      // The listener is gone after unmount.
      const add = vi.spyOn(window, 'addEventListener');
      const spy = vi.spyOn(window, 'removeEventListener');
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />).unmount();
      const added = add.mock.calls.find((c) => c[0] === 'popstate')![1];
      expect(spy).toHaveBeenCalledWith('popstate', added);
      add.mockRestore();
      spy.mockRestore();
      push.mockRestore();
      window.history.replaceState(null, '', '/');
    });

    it('clicking the active view adds no history entry', () => {
      const push = vi.spyOn(window.history, 'pushState');
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />);
      fireEvent.click(screen.getByRole('button', { name: 'Teeth' }));
      expect(push).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Full arch' }));
      fireEvent.click(screen.getByRole('button', { name: 'Full arch' }));
      expect(push).toHaveBeenCalledTimes(1);
      push.mockRestore();
    });

    it('switches to Full arch', () => {
      const replace = vi.spyOn(window.history, 'pushState');
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />);
      fireEvent.click(screen.getByRole('button', { name: 'Full arch' }));
      expect(screen.getByRole('button', { name: 'Full arch', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Full-arch chart' })).toBeInTheDocument();
      expect(screen.getByText(/Schematic drawing/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Tooth 36, / })).toBeNull();
      expect(replace).toHaveBeenLastCalledWith(null, '', expect.stringContaining('view=arch'));
      fireEvent.click(screen.getByRole('button', { name: 'Teeth' }));
      expect(replace).toHaveBeenLastCalledWith(null, '', expect.not.stringContaining('view='));
      replace.mockRestore();
    });

    it('initialView arch opens Full arch', () => {
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} initialView="arch" />);
      expect(screen.getByRole('button', { name: 'Full arch', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Full-arch chart' })).toBeInTheDocument();
    });

    it('Full arch offers full-arch cases to editors only; Teeth does not', () => {
      const { unmount } = render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} initialView="arch" />);
      expect(screen.getByRole('button', { name: 'Start upper case' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start lower case' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Teeth' }));
      expect(screen.queryByRole('button', { name: 'Start upper case' })).toBeNull();
      unmount();
      render(<ChartPanel patientId="pt" data={data(false)} initialTooth={null} initialView="arch" />);
      expect(screen.queryByRole('button', { name: 'Start upper case' })).toBeNull();
    });

    it('a case is captioned on the drawing', () => {
      const withCase = { ...data(true), cases: [{
        id: 'c1', arch: 'lower', configuration: 'all_on_6', name: '', notes: '', closed_at: null, close_reason: null,
        updated_at: 'x', stages: [],
      }] } as unknown as ChartData;
      render(<ChartPanel patientId="pt" data={withCase} initialTooth={null} initialView="arch" />);
      expect(screen.getByTestId('case-caption-lower')).toHaveTextContent('Lower arch · All-on-6 · Planned');
    });

    it('switch keeps selection', () => {
      window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
      render(<ChartPanel patientId="pt" data={data(true)} initialTooth={null} />);
      fireEvent.click(screen.getByRole('button', { name: /^Tooth 36, / }));
      fireEvent.click(screen.getByRole('button', { name: 'Full arch' }));
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('36');
    });
  });
});
