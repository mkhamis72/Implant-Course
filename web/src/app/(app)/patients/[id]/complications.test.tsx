import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';
import type { ImplantComplication } from '@/lib/implants/complications';

vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
import { Complications } from './complications';
import { saveComplication, voidComplication } from './outcome-actions';

const open: ImplantComplication = {
  id: 'c1', site_id: 's1', category: 'biological', type: 'peri_implantitis', other_type: '', noticed_on: '2026-09-01', severity: 'moderate',
  treatment: '', resolved_on: null, followup_id: null, notes: '', voided_at: null, voided_reason: '', updated_at: '2026-09-01T10:00:00.5+00:00',
};
const resolved = { ...open, id: 'c2', type: 'mucositis', resolved_on: '2026-08-20', noticed_on: '2026-08-01' };
const site = (complications: ImplantComplication[], followups: unknown[] = []) =>
  ({ id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10', followups, complications }) as unknown as ImplantSite;

beforeEach(() => {
  vi.mocked(saveComplication).mockReset().mockResolvedValue({});
  vi.mocked(voidComplication).mockReset().mockResolvedValue({});
});

describe('<Complications>', () => {
  it('lists open complications first with a bad badge, resolved ones after', () => {
    render(<Complications site={site([resolved, open])} patientId="pt" editable />);
    const items = within(screen.getByTestId('complications')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Peri-implantitis');
    expect(within(items[0]).getByText('Open')).toHaveClass('badge-bad');
    expect(items[1]).toHaveTextContent('Peri-implant mucositis');
    expect(within(items[1]).getByText('Resolved')).toBeInTheDocument();
  });

  it('adds a complication; the type list follows the category and resets when it changes', async () => {
    render(<Complications site={site([])} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Add complication' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'biological' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'peri_implantitis' } });
    expect(screen.getByText(/increased probing depth compared with previous examinations/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'mechanical' } });
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'screw_loosening' } });
    fireEvent.change(screen.getByLabelText(/^Noticed on/), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save complication' }));
    expect(vi.mocked(saveComplication)).toHaveBeenCalledWith(expect.objectContaining({
      complicationId: '', expectedUpdatedAt: '', siteId: 's1', patientId: 'pt', category: 'mechanical', type: 'screw_loosening', noticedOn: '2026-09-10',
    }));
  });

  it('edits with the version it opened with, and removes with a reason', async () => {
    const { rerender } = render(<Complications site={site([open])} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit complication' }));
    rerender(<Complications site={site([{ ...open, updated_at: '2026-09-02T09:00:00+00:00' }])} patientId="pt" editable />);
    fireEvent.change(screen.getByLabelText('Resolved on'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save complication' }));
    expect(vi.mocked(saveComplication)).toHaveBeenCalledWith(expect.objectContaining({
      complicationId: 'c1', expectedUpdatedAt: '2026-09-01T10:00:00.5+00:00', resolvedOn: '2026-09-15',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from record' }));
    fireEvent.change(screen.getByLabelText('Reason for removing'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove complication' }));
    expect(vi.mocked(voidComplication)).toHaveBeenCalledWith({ patientId: 'pt', complicationId: 'c1', reason: 'Duplicate entry' });
  });

  it('shows nothing to edit for viewers', () => {
    render(<Complications site={site([open])} patientId="pt" editable={false} />);
    expect(screen.queryByRole('button', { name: 'Add complication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit complication' })).not.toBeInTheDocument();
  });

  it('drops the linked visit when it was voided, so resolving is not refused', () => {
    const fu = (id: string, voided_at: string | null) => ({ id, date: '2026-09-01', check_type: '6-month', voided_at });
    render(<Complications site={site([{ ...open, followup_id: 'f1' }], [fu('f1', '2026-09-05T00:00:00+00:00'), fu('f2', null)])} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit complication' }));
    expect(screen.getByRole('combobox', { name: 'Found at visit' })).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Resolved on'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save complication' }));
    expect(vi.mocked(saveComplication)).toHaveBeenCalledWith(expect.objectContaining({ complicationId: 'c1', followupId: '' }));
  });
});
