import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDelete } from './confirm-delete';

describe('ConfirmDelete', () => {
  it('only enables delete once the exact name is typed', async () => {
    const user = userEvent.setup();
    render(<ConfirmDelete id="p1" noun="patient" name="Amal Hassan" consequences="Their chart goes too." action={vi.fn(async () => ({}))} />);
    await user.click(screen.getByRole('button', { name: 'Delete patient' }));
    const del = screen.getByRole('button', { name: 'Delete patient' });
    expect(del).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), 'Amal');
    expect(del).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), ' Hassan');
    expect(del).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/to confirm/)).not.toBeInTheDocument();
  });
});
