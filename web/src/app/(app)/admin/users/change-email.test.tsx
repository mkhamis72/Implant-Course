import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChangeEmail } from './change-email';

const { changeEmail } = vi.hoisted(() => ({ changeEmail: vi.fn(async () => ({})) }));
vi.mock('./actions', () => ({ changeEmail }));

describe('ChangeEmail', () => {
  it('asks in-page, saying they will be signed out everywhere, and can be cancelled', () => {
    render(<ChangeEmail userId="u1" email="org@example.com" />);
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change email of org@example.com' }));
    expect(screen.getByLabelText('New email')).toBeInTheDocument();
    expect(screen.getByText(/signed out everywhere/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument();
  });

  it('keeps the typed address after an error', async () => {
    changeEmail.mockResolvedValueOnce({ error: 'Another account already uses that email.' } as never);
    render(<ChangeEmail userId="u1" email="org@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Change email of org@example.com' }));
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another account already uses that email.');
    expect(screen.getByLabelText('New email')).toHaveValue('taken@example.com');
  });
});
