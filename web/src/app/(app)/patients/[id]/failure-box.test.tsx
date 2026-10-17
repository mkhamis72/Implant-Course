import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';

vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
import { FailureBox } from './failure-box';
import { saveFailure } from './outcome-actions';

const failed = (over: Partial<ImplantSite> = {}) => ({
  id: 's1', tooth: 46, state: 'failed', placed_on: '2026-03-10', updated_at: '2026-05-02T08:00:00.5+00:00', components: [],
  failed_on: null, failure_type: null, failure_reason: null, failure_notes: '', ...over,
}) as unknown as ImplantSite;

beforeEach(() => vi.mocked(saveFailure).mockReset().mockResolvedValue({}));

describe('<FailureBox>', () => {
  it('asks for details on an old failure and records them without a version', () => {
    render(<FailureBox site={failed()} patientId="pt" editable />);
    expect(screen.getByTestId('failure')).toHaveTextContent('Failure details not recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Add failure details' }));
    fireEvent.change(screen.getByLabelText(/^Failure date/), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure type' }), { target: { value: 'lost' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure reason' }), { target: { value: 'no_osseointegration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save failure details' }));
    expect(vi.mocked(saveFailure)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', expectedUpdatedAt: '', failedOn: '2026-05-01', failureType: 'lost', failureReason: 'no_osseointegration', failureNotes: '',
    });
  });

  it('shows recorded details with early/late and edits them with the version it opened with', () => {
    render(<FailureBox site={failed({ failed_on: '2026-05-01', failure_type: 'removed', failure_reason: 'peri_implantitis' })} patientId="pt" editable />);
    expect(screen.getByTestId('failure')).toHaveTextContent(/Removed · Peri-implantitis · .+ · early/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit failure details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save failure details' }));
    expect(vi.mocked(saveFailure)).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: '2026-05-02T08:00:00.5+00:00', failureType: 'removed' }));
  });

  it('renders nothing for an implant that has not failed', () => {
    const { container } = render(<FailureBox site={failed({ state: 'placed' } as Partial<ImplantSite>)} patientId="pt" editable />);
    expect(container).toBeEmptyDOMElement();
  });
});
