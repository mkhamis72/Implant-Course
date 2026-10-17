import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({
  correctBatch: vi.fn(), correctPlacement: vi.fn(), voidComponent: vi.fn(), voidFollowup: vi.fn(),
}));
import { Corrections } from './corrections';

const site = {
  id: 's1', tooth: 36, state: 'placed', technique: 'guided', placed_on: '2026-05-02', stock_lot_id: 'l1',
  torque_ncm: 35, isq: 70, bone_type: 'D2', graft: 'Bio-Oss old note', notes: 'first', product: null, lot: null,
  placing_delegate_id: 'gone', assisting_delegate_id: null, supervisor_id: 'sup1',
  placing: { full_name: 'Dr Former' }, assisting: null, supervisor: { full_name: 'Prof A' },
  components: [], followups: [], slot: null, created_at: '2026-05-02T00:00:00Z',
} as unknown as ImplantSite;
const data = {
  lots: [], implants: [], componentProducts: [],
  delegates: [{ id: 'd1', label: 'Dr Right' }],
  supervisors: [{ id: 'sup1', label: 'Prof A' }, { id: 'sup2', label: 'Prof B' }],
} as unknown as ChartData;

describe('<Corrections> placement details', () => {
  it('is prefilled, keeps an inactive recorded delegate selectable, and sends the corrected values', async () => {
    const { correctPlacement } = await import('./implant-actions');
    vi.mocked(correctPlacement).mockResolvedValue({});
    render(<Corrections patientId="pt" site={site} data={data} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(within(box).getByLabelText('Placement date')).toHaveValue('2026-05-02');
    expect(within(box).getByRole('combobox', { name: 'Placed by' })).toHaveValue('gone');
    expect(within(within(box).getByRole('combobox', { name: 'Placed by' })).getByRole('option', { name: 'Dr Former (inactive)' })).toBeInTheDocument();
    expect(within(box).getByLabelText('Insertion torque (Ncm)')).toHaveValue('35');

    expect(within(box).queryByLabelText('Graft')).not.toBeInTheDocument();
    fireEvent.change(within(box).getByLabelText('Placement date'), { target: { value: '2026-05-01' } });
    fireEvent.change(within(box).getByRole('combobox', { name: 'Placed by' }), { target: { value: 'd1' } });
    fireEvent.change(within(box).getByRole('combobox', { name: 'Supervisor' }), { target: { value: 'sup2' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(correctPlacement)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', placedOn: '2026-05-01', placingDelegateId: 'd1', assistingDelegateId: '', supervisorId: 'sup2',
      torque: '35', isq: '70', boneType: 'D2', graft: 'Bio-Oss old note', notes: 'first',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Correction saved.');
  });
});
