import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { googleConfig, linked } = vi.hoisted(() => ({ googleConfig: vi.fn(), linked: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/self-auth/google-config', () => ({ googleConfig }));
vi.mock('@/lib/auth/session', () => ({ requireSignedIn: async () => ({ mfa_setup_required: false }) }));
vi.mock('@/lib/self-auth/session', () => ({ currentSelfAuthSession: async () => ({ userId: 'u1' }) }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ totp: { hasTotp: async () => false }, google: { linked } }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'c1' }) }));
vi.mock('@/lib/flags', () => ({ emailEnabled: () => false }));
vi.mock('./actions', () => ({ confirmEnroll: vi.fn(), removeFactor: vi.fn(), startEnroll: vi.fn() }));
vi.mock('./enroll-totp', () => ({ EnrollTotp: () => null }));
vi.mock('./finish-setup', () => ({ FinishSetup: () => null }));
vi.mock('./password-link', () => ({ PasswordLink: () => null }));
vi.mock('./change-password', () => ({ ChangePassword: () => null }));
import SecurityPage from './page';

beforeEach(() => { googleConfig.mockReset(); linked.mockReset(); });

describe('security page, Google line', () => {
  it('security_page_shows_google_line', async () => {
    googleConfig.mockReturnValue({ clientId: 'id', clientSecret: 's' });
    linked.mockResolvedValue(true);
    const used = render(await SecurityPage());
    expect(screen.getByText('Google sign-in: used')).toBeInTheDocument();
    expect(linked).toHaveBeenCalledWith('c1', 'u1');
    used.unmount();
    linked.mockResolvedValue(false);
    render(await SecurityPage());
    expect(screen.getByText('Google sign-in: not used yet')).toBeInTheDocument();
  });
  it('shows no Google line when Google is not configured', async () => {
    googleConfig.mockReturnValue(null);
    render(await SecurityPage());
    expect(screen.queryByText(/Google sign-in/)).not.toBeInTheDocument();
    expect(linked).not.toHaveBeenCalled();
  });
});
