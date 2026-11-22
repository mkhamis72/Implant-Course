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

describe('site details: parts on the implant', () => {
  const product = (over: Record<string, unknown>) => ({
    id: 'p', type: 'multi_unit', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: null, length_mm: null, ref_code: 'R1', description: '',
    connection: '', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '', driver_ref: '', torque_ncm: null,
    ...over,
  });
  const part = (over: Record<string, unknown>) => ({
    id: 'x', component_type: 'multi_unit', fitted_on: '2026-11-03', removed_on: null, notes: '', product: null, lot: null,
    fitted_by_delegate: null, fitted_by_organizer: null, course_id: null, voided_at: null, voided_reason: '', stock_lot_id: null,
    torque_ncm: null, holds_component_id: null, holds_restoration_id: null, replaced_by: null,
    ...over,
  });
  const arch = { id: 'r1', stage: 'final', type: 'full_arch', teeth: [15, 14, 13, 12, 11, 21, 22, 23, 24, 25], ended_on: null, site_ids: ['s1'] };
  const withParts = {
    ...site,
    components: [
      part({ id: 'mua', component_type: 'multi_unit', torque_ncm: 30, product: product({ driver_interface: 'Hex', driver_size: '1.25 mm' }) }),
      part({ id: 'as', component_type: 'abutment_screw', torque_ncm: 25, holds_component_id: 'mua' }),
      part({ id: 'old', component_type: 'prosthetic_screw', torque_ncm: 15, holds_restoration_id: 'r1', removed_on: '2026-11-10', replaced_by: 'ps' }),
      part({ id: 'ps', component_type: 'prosthetic_screw', fitted_on: '2026-11-10', torque_ncm: 15, holds_restoration_id: 'r1' }),
      part({ id: 'sb', component_type: 'scan_body', fitted_on: '2026-11-04', removed_on: '2026-11-04' }),
    ],
  } as unknown as ImplantSite;
  const data = { ...chart(true), restorations: [arch] } as unknown as ChartData;

  it('lists the multi-unit, the abutment screw and the prosthetic screw under Current parts, with torque and holder', () => {
    render(<ImplantFacts site={withParts} patientId="pt" data={data} />);
    const items = screen.getAllByTestId('current-part').map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Multi-unit abutment');
    expect(items[0]).toContain('Screwdriver: Hex 1.25 mm');
    expect(items[0]).toContain('Torque: 30 Ncm');
    expect(items[1]).toContain('Abutment screw');
    expect(items[1]).toContain('Torque: 25 Ncm');
    expect(items[1]).toContain('holds Multi-unit abutment');
    expect(items[2]).toContain('Prosthetic screw');
    expect(items[2]).toContain('holds Full arch 15–25 (final)');
  });

  it('shows the replaced screw and the scan body only in the history', () => {
    render(<ImplantFacts site={withParts} patientId="pt" data={data} />);
    const history = screen.getByTestId('component-history');
    expect(history).toHaveTextContent('Prosthetic screw — 03 Nov 2026 — replaced on 10 Nov 2026');
    expect(history).toHaveTextContent('Scan body — used 04 Nov 2026');
    expect(screen.getAllByTestId('current-part').map((li) => li.textContent).join(' ')).not.toContain('Scan body');
  });
});
