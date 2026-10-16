import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';
import type { ImplantGraft, ImplantSurgery } from '@/lib/implants/surgery';

vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn() }));
vi.mock('./implant-actions', () => ({
  fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), recordFollowup: vi.fn(), receiveStockForPlacement: vi.fn(),
}));
import { SurgicalDetails } from './surgical-details';
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

const surgery: ImplantSurgery = {
  site_id: 's1', extraction_date: null, placement_timing: 'delayed', soft_tissue_phenotype: null, keratinized_mucosa_mm: null,
  flap: 'crestal', torque_type: null, healing: null, primary_closure: null, grafting_performed: 'yes', updated_at: '2026-10-17T10:00:00.5+00:00',
};
const graft: ImplantGraft = {
  id: 'g1', site_id: 's1', procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft', product: '',
  membrane: 'resorbable', notes: '', created_at: '2026-10-17T10:00:00Z',
};
const site = (over: Partial<ImplantSite> = {}) =>
  ({ id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10', surgery, grafts: [], ...over }) as unknown as ImplantSite;

beforeEach(() => {
  vi.mocked(saveSurgery).mockReset().mockResolvedValue({});
  vi.mocked(saveGraft).mockReset().mockResolvedValue({});
  vi.mocked(deleteGraft).mockReset().mockResolvedValue({});
});

describe('<SurgicalDetails>', () => {
  it('shows completeness, the recorded values and the missing-graft warning', () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    const box = screen.getByTestId('surgical-details');
    expect(within(box).getByText('3 of 9 recorded')).toHaveClass('badge-warn');
    expect(box).toHaveTextContent('Delayed · Crestal incision · Grafted');
    expect(box).toHaveTextContent('Grafting is marked as performed, but no graft is recorded.');
  });

  it('shows a complete record with an ok badge and nothing to edit for viewers', () => {
    const full = { ...surgery, extraction_date: '2025-10-01', soft_tissue_phenotype: 'thick', keratinized_mucosa_mm: 2, torque_type: 'peak',
      healing: 'submerged', primary_closure: 'yes' } as ImplantSurgery;
    render(<SurgicalDetails site={site({ surgery: full, grafts: [graft] })} patientId="pt" editable={false} />);
    expect(screen.getByText('9 of 9 recorded')).toHaveClass('badge-ok');
    expect(screen.getByText('GBR · Xenograft · Resorbable membrane · Simultaneous')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit surgical details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add graft' })).not.toBeInTheDocument();
  });

  it('opens with a prompt right after placement, and shows "Nothing recorded yet" with no record', () => {
    render(<SurgicalDetails site={site({ surgery: null })} patientId="pt" editable startOpen />);
    expect(screen.getByTestId('surgical-details')).toHaveAttribute('open');
    expect(screen.getByText('Add surgical details now or later.')).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('0 of 9 recorded')).toBeInTheDocument();
  });

  it('edits the details, warns about an unusual timing, and sends the version it was rendered from', async () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit surgical details' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Placement timing' }), { target: { value: 'early_soft_tissue' } });
    fireEvent.change(screen.getByLabelText('Extraction date'), { target: { value: '2025-08-20' } });
    expect(screen.getByText(/usually means 4–8 weeks after extraction; this is 29 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/Type 2: socket covered by soft tissue/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keratinized mucosa (mm)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save surgical details' }));
    expect(vi.mocked(saveSurgery)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', expectedUpdatedAt: '2026-10-17T10:00:00.5+00:00', extractionDate: '2025-08-20',
      placementTiming: 'early_soft_tissue', softTissuePhenotype: '', keratinizedMucosaMm: '3', flap: 'crestal', torqueType: '',
      healing: '', primaryClosure: '', graftingPerformed: 'yes',
    });
    expect(await screen.findByRole('button', { name: 'Edit surgical details' })).toBeInTheDocument();
  });

  it('keeps the form and shows the error when saving fails', async () => {
    vi.mocked(saveSurgery).mockResolvedValue({ error: 'These surgical details were changed by someone else. Reload to see them.' });
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit surgical details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save surgical details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else');
    expect(screen.getByRole('button', { name: 'Save surgical details' })).toBeInTheDocument();
  });

  it('adds a graft; the date only shows for a staged graft', async () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Add graft' }));
    expect(screen.queryByLabelText('Graft date')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Procedure' }), { target: { value: 'sinus_lateral' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Graft timing' }), { target: { value: 'staged' } });
    fireEvent.change(screen.getByLabelText('Graft date'), { target: { value: '2025-12-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Material' }), { target: { value: 'combination' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save graft' }));
    expect(vi.mocked(saveGraft)).toHaveBeenCalledWith({
      graftId: '', siteId: 's1', patientId: 'pt', procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01',
      material: 'combination', product: '', membrane: '', notes: '',
    });
  });

  it('deletes a graft only after confirming; no Add graft when grafting is "no"', async () => {
    const { unmount } = render(<SurgicalDetails site={site({ grafts: [graft] })} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete graft' }));
    expect(vi.mocked(deleteGraft)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(vi.mocked(deleteGraft)).toHaveBeenCalledWith({ patientId: 'pt', graftId: 'g1' });
    unmount();
    render(<SurgicalDetails site={site({ surgery: { ...surgery, grafting_performed: 'no' } })} patientId="pt" editable />);
    expect(screen.queryByRole('button', { name: 'Add graft' })).not.toBeInTheDocument();
  });
});
