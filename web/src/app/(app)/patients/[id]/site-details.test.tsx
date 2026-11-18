import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({ setTechnique: vi.fn() }));
vi.mock('./corrections', () => ({ Corrections: () => null }));
vi.mock('./surgical-details', () => ({ SurgicalDetails: () => null }));
vi.mock('./visits', () => ({ Visits: () => null }));
vi.mock('./complications', () => ({ Complications: () => null }));
vi.mock('./failure-box', () => ({ FailureBox: () => null }));
vi.mock('./impression-control', () => ({ ImpressionControl: () => null }));
import { ImplantFacts } from './site-details';

const site = {
  id: 's1', tooth: 36, state: 'placed', technique: 'guided', placed_on: '2026-05-02', stock_lot_id: 'l1',
  torque_ncm: null, isq: null, bone_type: null, graft: null, product: null, lot: null,
  placing: null, assisting: null, supervisor: null, components: [], followups: [],
} as unknown as ImplantSite;
const chart = (inventoryOn: boolean) => ({ inventoryOn, editable: false, courses: [], restorations: [] }) as unknown as ChartData;

describe('site details without a readable lot', () => {
  it('shows no lot line when Inventory is off, even with a stock_lot_id', () => {
    render(<ImplantFacts site={site} patientId="pt" data={chart(false)} />);
    expect(screen.queryByText(/Lot/)).not.toBeInTheDocument();
    expect(screen.queryByText('No stock batch recorded')).not.toBeInTheDocument();
  });

  it('says no stock batch is recorded when Inventory is on and there is none', () => {
    render(<ImplantFacts site={{ ...site, stock_lot_id: null } as ImplantSite} data={chart(true)} patientId="pt" />);
    expect(screen.getByText('No stock batch recorded')).toBeInTheDocument();
  });

  it('shows the lot as before when Inventory is on', () => {
    render(<ImplantFacts site={{ ...site, lot: { lot_no: 'A1' } } as ImplantSite} data={chart(true)} patientId="pt" />);
    expect(screen.getByText('Lot A1')).toBeInTheDocument();
  });
});

describe('site details: who placed it', () => {
  const placed = {
    ...site, placing: { full_name: 'Dr Delegate' }, supervisor: { full_name: 'Prof Sup' }, doctor: null,
  } as unknown as ImplantSite;
  const teaching = (on: boolean) => ({ ...chart(true), teachingOn: on }) as ChartData;

  it('names the doctor who placed it', () => {
    render(<ImplantFacts site={{ ...placed, placing: null, doctor: { name: 'Dr Nabil' } } as unknown as ImplantSite} patientId="pt" data={teaching(true)} />);
    expect(screen.getByText(/Placed by Dr Nabil/)).toBeInTheDocument();
  });

  it('a clinic shows no supervisor or delegate, even if recorded', () => {
    render(<ImplantFacts site={{ ...placed, doctor: { name: 'Dr Nabil' } } as unknown as ImplantSite} patientId="pt" data={teaching(false)} />);
    expect(screen.queryByText(/Supervis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dr Delegate|Prof Sup/)).not.toBeInTheDocument();
    expect(screen.getByText('Placed by Dr Nabil')).toBeInTheDocument();
  });
});
