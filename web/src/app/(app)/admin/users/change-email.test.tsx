import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChangeEmail } from './change-email';

vi.mock('./actions', () => ({ changeEmail: vi.fn(async () => ({})) }));

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
});
