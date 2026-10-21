import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./chart-actions', () => ({ setToothStatus: vi.fn() }));
vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn() }));
vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));
vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({
  planImplant: vi.fn(), placeImplant: vi.fn(), cancelPlan: vi.fn(), setTechnique: vi.fn(), recordImpression: vi.fn(), fitComponent: vi.fn(),
  correctBatch: vi.fn(), voidFollowup: vi.fn(), voidComponent: vi.fn(),
}));
import { ChartPanel } from './chart-panel';

const data = (editable: boolean) =>
  ({
    statuses: {}, sites: [], visits: [], implants: [], componentProducts: [], lots: [], delegates: [], organizers: [], supervisors: [],
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
});
