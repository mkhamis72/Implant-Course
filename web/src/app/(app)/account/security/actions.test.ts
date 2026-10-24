import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auth, rpc } = vi.hoisted(() => ({
  auth: { mfa: { challengeAndVerify: vi.fn() } },
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth, rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { confirmEnroll } from './actions';

beforeEach(() => vi.clearAllMocks());

describe('confirmEnroll', () => {
  it('clears "must set up 2FA" after a successful verify', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    rpc.mockResolvedValue({ error: null });
    expect(await confirmEnroll('f1', '123 456')).toEqual({ ok: true });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
    expect(rpc).toHaveBeenCalledWith('mfa_setup_done');
    expect(auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });
  it('does not call it when the code is wrong', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed', message: 'x' } });
    expect(await confirmEnroll('f1', '000000')).toEqual({ error: 'That code is not correct. Check your authenticator app and try again.' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows the database refusal', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    rpc.mockResolvedValue({ error: { message: 'Finish setting up two-factor authentication first.', hint: 'user' } });
    expect(await confirmEnroll('f1', '123456')).toEqual({ error: 'Finish setting up two-factor authentication first.' });
  });
});
