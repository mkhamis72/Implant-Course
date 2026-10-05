import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./chart-actions', () => ({ setToothStatus: vi.fn() }));
vi.mock('./implant-actions', () => ({
  planImplant: vi.fn(), placeImplant: vi.fn(), cancelPlan: vi.fn(), setTechnique: vi.fn(), fitComponent: vi.fn(),
  recordFollowup: vi.fn(), correctBatch: vi.fn(), voidFollowup: vi.fn(), voidComponent: vi.fn(),
}));
import { ChartPanel } from './chart-panel';

const data = (editable: boolean) =>
  ({
    statuses: {}, sites: [], implants: [], componentProducts: [], lots: [], delegates: [], organizers: [], supervisors: [],
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
});
