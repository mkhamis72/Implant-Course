import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getCurrentProfile } = vi.hoisted(() => ({ getCurrentProfile: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getCurrentProfile }));
import MyLayout from './layout';

const profile = (features: string[]) => ({ role: 'delegate', active: true, features });

beforeEach(() => vi.clearAllMocks());

describe('/my layout', () => {
  it('shows the delegate pages when teaching is on', async () => {
    getCurrentProfile.mockResolvedValue(profile(['inventory', 'teaching']));
    render(await MyLayout({ children: <p>My schedule page</p> }));
    expect(screen.getByText('My schedule page')).toBeInTheDocument();
  });
  it('shows the not-available text when teaching is off', async () => {
    getCurrentProfile.mockResolvedValue(profile(['inventory']));
    render(await MyLayout({ children: <p>My schedule page</p> }));
    expect(screen.getByText('This page is not available for your organisation.')).toBeInTheDocument();
    expect(screen.queryByText('My schedule page')).not.toBeInTheDocument();
  });
});
