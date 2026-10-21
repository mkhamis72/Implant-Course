import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';

vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn() }));
vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));
vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({
  planImplant: vi.fn(), placeImplant: vi.fn(), cancelPlan: vi.fn(), setTechnique: vi.fn(), recordImpression: vi.fn(), fitComponent: vi.fn(),
  correctBatch: vi.fn(), correctPlacement: vi.fn(), voidFollowup: vi.fn(), voidComponent: vi.fn(),
}));
import { ImplantTabs } from './implant-tabs';
import { initialTab, type ImplantTabKey } from '@/lib/patients/implant-tabs';

const site = {
  id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10', technique: 'guided', torque_ncm: null, isq: null, bone_type: null, graft: '',
  product: null, lot: null, stock_lot_id: null, placing: null, assisting: null, supervisor: null, slot: null,
  components: [], followups: [], surgery: null, grafts: [],
  complications: [
    { id: 'c1', category: 'biological', type: 'mucositis', noticed_on: '2026-09-01', resolved_on: null, voided_at: null },
  ],
} as unknown as ImplantSite;
const data = (editable: boolean) =>
  ({
    statuses: {}, sites: [site], visits: [], implants: [], componentProducts: [], lots: [], delegates: [], organizers: [], supervisors: [],
    today: '2026-10-18', me: 'u1', editable,
  }) as unknown as ChartData;

// The section owns the selected tab; this stands in for it.
function Tabs({ editable, justPlaced }: { editable: boolean; justPlaced: boolean }) {
  const [tab, setTab] = useState<ImplantTabKey>(initialTab(justPlaced));
  return <ImplantTabs site={site} patientId="pt" data={data(editable)} justPlaced={justPlaced} selected={tab} onSelect={setTab} />;
}

describe('<ImplantTabs>', () => {
  it('opens on Implant with counts on Surgical details and Complications; Corrections only for editors', () => {
    render(<Tabs editable={true} justPlaced={false} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Implant', 'Surgical details0/120 of 12 recorded', 'Visits', 'Complications11, 1 open', 'Corrections',
    ]);
    expect(screen.getByRole('tab', { name: 'Implant' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Implant' })).toBeVisible();
    expect(screen.getByRole('tab', { name: /Complications/ }).querySelector('.badge')).toHaveClass('badge-bad');
  });

  it('hides Corrections from viewers', () => {
    render(<Tabs editable={false} justPlaced={false} />);
    expect(screen.queryByRole('tab', { name: 'Corrections' })).toBeNull();
  });

  it('starts on Surgical details right after placement', () => {
    render(<Tabs editable={true} justPlaced />);
    expect(screen.getByRole('tab', { name: /Surgical details/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Add surgical details now or later.')).toBeVisible();
  });

  it('switches by click and by arrow keys, moving focus with the selection', () => {
    render(<Tabs editable={true} justPlaced={false} />);
    fireEvent.click(screen.getByRole('tab', { name: /Complications/ }));
    expect(screen.getByRole('button', { name: 'Add complication' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Complications/ }), { key: 'ArrowRight' });
    const corrections = screen.getByRole('tab', { name: 'Corrections' });
    expect(corrections).toHaveAttribute('aria-selected', 'true');
    expect(corrections).toHaveFocus();
    expect(corrections).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Implant' })).toHaveAttribute('tabindex', '-1');
  });
});
