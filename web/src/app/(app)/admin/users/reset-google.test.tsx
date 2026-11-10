import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResetGoogle } from './reset-google';

const { resetGoogle } = vi.hoisted(() => ({ resetGoogle: vi.fn(async () => ({ ok: 'Google sign-in reset. Their next Google sign-in is remembered instead.' })) }));
vi.mock('./actions', () => ({ resetGoogle }));

describe('ResetGoogle', () => {
  it('is not offered when Google was never used', () => {
    const { container } = render(<ResetGoogle userId="u1" email="a@example.com" available={false} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('asks in-page, can be cancelled, and shows the success text', async () => {
    render(<ResetGoogle userId="u1" email="a@example.com" available />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Google sign-in for a@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Google sign-in for a@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Google sign-in' }));
    expect(await screen.findByText('Google sign-in reset. Their next Google sign-in is remembered instead.')).toBeInTheDocument();
  });
});
