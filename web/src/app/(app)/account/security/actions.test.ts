import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const requireSignedIn = vi.hoisted(() => vi.fn(async (_o?: unknown) => ({ user_id: 'u1', email: 'u@example.com' })));
vi.mock('@/lib/auth/session', () => ({ requireSignedIn }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/flags', () => ({ emailEnabled: () => true }));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => 'tok' }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));
const rpc = vi.fn(async (_n: string) => ({ error: null as unknown }));
const forSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
  createClientForSession: async (s: unknown) => {
    forSession(s);
    return { rpc };
  },
}));
const totp = {
  startEnroll: vi.fn(async (..._a: unknown[]) => ({ secret: 'ABCDEF', otpauthUrl: 'otpauth://totp/Implant%20Course:u@example.com?secret=ABCDEF' })),
  confirmEnroll: vi.fn(async (..._a: unknown[]) => ({ sessionId: 's1', aal: 'aal2' }) as unknown),
  remove: vi.fn(async (..._a: unknown[]) => true),
};
const requestPasswordReset = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ totp, requestPasswordReset }) }));

import { confirmEnroll, emailPasswordLink, finishMfaSetup, removeFactor, startEnroll } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  totp.confirmEnroll.mockResolvedValue({ sessionId: 's1', aal: 'aal2' });
  totp.remove.mockResolvedValue(true);
  rpc.mockResolvedValue({ error: null });
});

describe('startEnroll', () => {
  it('returns the secret and a QR code image made from the otpauth URL, for this session and company', async () => {
    const result = await startEnroll();
    expect(totp.startEnroll).toHaveBeenCalledWith('tok', 'company-a');
    expect(result).toMatchObject({ secret: 'ABCDEF' });
    expect((result as { qrCode: string }).qrCode).toMatch(/^data:image\/png;base64,/);
    expect(requireSignedIn).toHaveBeenCalledWith({ allowMfaSetup: true });
  });
  it('says so when an authenticator is already set up', async () => {
    totp.startEnroll.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'totp_already_enrolled' }));
    expect(await startEnroll()).toEqual({ error: 'An authenticator is already set up.' });
  });
});

describe('confirmEnroll', () => {
  it('confirms the code, then clears the set-up requirement with the raised session', async () => {
    expect(await confirmEnroll('totp', '123 456')).toEqual({ ok: true });
    expect(totp.confirmEnroll).toHaveBeenCalledWith('tok', 'company-a', '123456');
    expect(forSession).toHaveBeenCalledWith({ sessionId: 's1', aal: 'aal2' });
    expect(rpc).toHaveBeenCalledWith('mfa_setup_done');
  });
  it('a wrong code shows the existing message and clears nothing', async () => {
    totp.confirmEnroll.mockResolvedValue(null);
    expect(await confirmEnroll('totp', '000000')).toEqual({
      error: 'That code is not correct. Check your authenticator app and try again.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows a refused clear', async () => {
    rpc.mockResolvedValue({ error: { message: 'Finish setting up two-factor authentication first.', hint: 'user' } });
    expect(await confirmEnroll('totp', '123456')).toEqual({ error: 'Finish setting up two-factor authentication first.' });
  });
});

describe('removeFactor', () => {
  it('removes the authenticator through Self-Auth', async () => {
    await removeFactor();
    expect(totp.remove).toHaveBeenCalledWith('tok', 'company-a');
  });
  it('refused below aal2 is an error', async () => {
    totp.remove.mockResolvedValue(false);
    await expect(removeFactor()).rejects.toThrow();
  });
});

describe('finishMfaSetup', () => {
  it('clears the requirement with the request session', async () => {
    expect(await finishMfaSetup()).toEqual({});
    expect(rpc).toHaveBeenCalledWith('mfa_setup_done');
  });
});

describe('emailPasswordLink', () => {
  it('asks for a reset link to the signed-in address and limits repeats', async () => {
    for (let i = 0; i < 3; i++) expect(await emailPasswordLink()).toMatchObject({ sent: expect.any(String) });
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: 'company-a', email: 'u@example.com' });
    expect(await emailPasswordLink()).toMatchObject({ error: expect.stringMatching(/Too many/) });
    expect(requestPasswordReset).toHaveBeenCalledTimes(3);
  });
});
