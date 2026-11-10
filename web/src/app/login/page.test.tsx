import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const { googleConfig } = vi.hoisted(() => ({ googleConfig: vi.fn() }));
vi.mock('@/lib/self-auth/google-config', () => ({ googleConfig }));
vi.mock('@/lib/branding/get', () => ({ getBranding: async () => ({ name: 'Academy', logoUrl: null }) }));
vi.mock('@/lib/flags', () => ({ emailEnabled: () => false }));
vi.mock('./login-form', () => ({ LoginForm: () => <form data-testid="login-form" /> }));
import LoginPage from './page';

const show = async (params: Record<string, string> = {}) => render(await LoginPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => googleConfig.mockReset());

describe('login page, Google', () => {
  it('login_shows_google_button_only_when_configured', async () => {
    googleConfig.mockReturnValue(null);
    const off = await show();
    expect(screen.queryByRole('link', { name: 'Sign in with Google' })).not.toBeInTheDocument();
    off.unmount();
    googleConfig.mockReturnValue({ clientId: 'id', clientSecret: 's' });
    await show();
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/auth/google/start');
  });

  it.each([
    ['google_no_account', "There's no account for this email here. Ask your admin."],
    ['google_disabled', 'This account is deactivated.'],
    ['google_unverified', "Google didn't confirm this email address."],
    ['google_other_account', 'This account uses a different Google account. Ask your admin.'],
    ['google_failed', "Google sign-in didn't work. Try again or use your password."],
  ])('login_shows_each_google_error_message %s', async (code, text) => {
    googleConfig.mockReturnValue(null);
    await show({ error: code });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('shows nothing for an unknown error code', async () => {
    googleConfig.mockReturnValue(null);
    await show({ error: 'whatever' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
