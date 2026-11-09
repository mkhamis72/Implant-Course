import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const guard = vi.fn(async () => ({ userId: 'u1', email: 'owner@example.com' }));
vi.mock('@/lib/console/session', () => ({ requireConsoleAdmin: () => guard() }));
const flags = { email: true };
vi.mock('@/lib/flags', () => ({ emailEnabled: () => flags.email }));
const requestPasswordReset = vi.fn(async (_i: { companyId: string; email: string }) => undefined);
vi.mock('@/lib/self-auth/console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => ({ requestPasswordReset }) }));

import { emailConsolePasswordLink } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  flags.email = true;
  // The limiter is per process: a fresh user id per test keeps them apart.
  guard.mockResolvedValue({ userId: `u-${Math.random()}`, email: 'owner@example.com' });
});

describe('emailConsolePasswordLink', () => {
  it('checks the console admin first', async () => {
    guard.mockRejectedValueOnce(new Error('REDIRECT /console/login'));
    await expect(emailConsolePasswordLink()).rejects.toThrow('REDIRECT /console/login');
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('emails a reset link to the admin\'s own address, company console', async () => {
    const r = await emailConsolePasswordLink();
    expect(r.sent).toBeTruthy();
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: 'console', email: 'owner@example.com' });
  });

  it('never returns a link', async () => {
    const r = await emailConsolePasswordLink();
    expect(JSON.stringify(r)).not.toMatch(/https?:|token/i);
  });

  it('says so when email is not available', async () => {
    flags.email = false;
    const r = await emailConsolePasswordLink();
    expect(r.error).toBeTruthy();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('limits repeated requests', async () => {
    guard.mockResolvedValue({ userId: 'same', email: 'owner@example.com' });
    for (let i = 0; i < 3; i++) await emailConsolePasswordLink();
    const r = await emailConsolePasswordLink();
    expect(r.error).toBeTruthy();
    expect(requestPasswordReset).toHaveBeenCalledTimes(3);
  });
});
