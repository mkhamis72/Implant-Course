import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const env = { emailOn: true, ip: '1.1.1.1' };
vi.mock('@/lib/flags', () => ({ emailEnabled: () => env.emailOn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': `${env.ip}, 10.0.0.1` }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));
const requestPasswordReset = vi.fn(async (_: { companyId: string; email: string }) => undefined);
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ requestPasswordReset }) }));

import { requestReset } from './actions';
import { FORGOT_SENT, FORGOT_TOO_MANY } from '@/lib/auth/password-reset';

const form = (email: string) => {
  const fd = new FormData();
  fd.set('email', email);
  return fd;
};

let n = 0;
const fresh = () => `user${++n}@example.com`;

beforeEach(() => {
  vi.clearAllMocks();
  env.emailOn = true;
  env.ip = `9.9.9.${++n}`;
});

describe('requestReset', () => {
  it("asks Self-Auth for this host's company and replies with the fixed text", async () => {
    expect(await requestReset({}, form('  Someone@Example.com '))).toEqual({ sent: FORGOT_SENT });
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: 'company-a', email: 'someone@example.com' });
  });
  it('replies the same when Self-Auth throws (an unknown address and a failure look alike)', async () => {
    requestPasswordReset.mockRejectedValueOnce(new Error('boom'));
    expect(await requestReset({}, form(fresh()))).toEqual({ sent: FORGOT_SENT });
  });
  it('limits repeated requests for one address, keeping the address', async () => {
    const email = fresh();
    for (let i = 0; i < 3; i++) expect(await requestReset({}, form(email))).toEqual({ sent: FORGOT_SENT });
    expect(await requestReset({}, form(email))).toEqual({ error: FORGOT_TOO_MANY, email });
    expect(requestPasswordReset).toHaveBeenCalledTimes(3);
  });
  it('limits one client address across many email addresses', async () => {
    for (let i = 0; i < 10; i++) expect(await requestReset({}, form(fresh()))).toEqual({ sent: FORGOT_SENT });
    expect(await requestReset({}, form(fresh()))).toMatchObject({ error: FORGOT_TOO_MANY });
  });
  it('refuses an empty or malformed address without calling Self-Auth', async () => {
    expect(await requestReset({}, form('   '))).toEqual({ error: 'Enter your email address.', email: '' });
    expect(await requestReset({}, form('not-an-email'))).toEqual({ error: 'Enter your email address.', email: 'not-an-email' });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
  it('sends nothing while email is off', async () => {
    env.emailOn = false;
    expect(await requestReset({}, form('a@b.co'))).toEqual({ error: 'Password reset by email is not available. Ask an admin to reset your password.' });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});
