import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { refresh, downloadPassport } = vi.hoisted(() => ({ refresh: vi.fn(), downloadPassport: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/passport/client', () => ({
  downloadPassport, PASSPORT_FAILED: 'Could not generate the passport. Please try again.',
}));
import { GeneratePassport } from './generate-passport';

beforeEach(() => vi.clearAllMocks());

describe('GeneratePassport', () => {
  it('shows "Preparing…" while the passport is built, then re-enables and refreshes the list', async () => {
    let done!: () => void;
    downloadPassport.mockReturnValue(new Promise<void>((r) => { done = r; }));
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate passport' }));
    expect(downloadPassport).toHaveBeenCalledWith('pat-1');
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    done();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate passport' })).toBeEnabled());
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error in an alert and re-enables the button', async () => {
    downloadPassport.mockRejectedValue(new Error('Patient not found.'));
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate passport' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Patient not found.');
    expect(screen.getByRole('button', { name: 'Generate passport' })).toBeEnabled();
  });

  it('a failure without a message (a chunk that did not load) gives the generic message', async () => {
    downloadPassport.mockRejectedValue('boom');
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate passport' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not generate the passport. Please try again.');
  });
});
