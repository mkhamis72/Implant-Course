import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ signOut: vi.fn(), token: 'tok' as string | null }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ signOut: h.signOut }) }));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => h.token }));
import { POST } from './route';

beforeEach(() => {
  h.signOut.mockReset().mockResolvedValue(undefined);
  h.token = 'tok';
});


describe('POST /auth/signout', () => {
  it('ends the Self-Auth session and clears both cookies', async () => {
    const res = await POST();
    expect(h.signOut).toHaveBeenCalledWith('tok');
    expect(res.status).toBe(204);
    const cookies = res.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/icm_session=;/);
    expect(cookies).toMatch(/icm_last_seen=;/);
  });
  it('without a session it is still a quiet success', async () => {
    h.token = null;
    const res = await POST();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(204);
  });
  it('a failed sign-out is an error, never a pretend success', async () => {
    h.signOut.mockRejectedValue(new Error('db down'));
    await expect(POST()).rejects.toThrow();
  });
});
