import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  deleted: [] as unknown[],
  validate: vi.fn(),
  signIn: vi.fn(),
  finishSignIn: vi.fn(),
  origin: 'https://demo.imploid.net',
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name) } : undefined),
    delete: (arg: unknown) => {
      h.deleted.push(arg);
    },
  }),
}));
vi.mock('arctic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('arctic')>();
  class Google extends actual.Google {
    validateAuthorizationCode = h.validate;
  }
  return { ...actual, Google };
});
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ google: { signIn: h.signIn } }) }));
vi.mock('@/lib/tenant/current', () => ({
  currentTenant: async () => ({ companyId: 'company-1' }),
  requestOrigin: async () => h.origin,
}));
vi.mock('@/lib/auth/finish-sign-in', () => ({ finishSignIn: h.finishSignIn }));
import { googleStart, googleCallback, googleErrorCode, GOOGLE_OAUTH_COOKIE } from './google-flow';

const session = { userId: 'u1', expiresAt: new Date(Date.now() + 3600_000) };
const saved = { state: 'state-1', codeVerifier: 'verifier-1', nonce: 'nonce-1' };

function callbackUrl(params: Record<string, string>): URL {
  const url = new URL(`${h.origin}/auth/google/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

function cookieDeleted(): boolean {
  return h.deleted.some(
    (d) => typeof d === 'object' && d !== null && (d as { name: string }).name === GOOGLE_OAUTH_COOKIE && (d as { path: string }).path === '/auth/google',
  );
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
  h.origin = 'https://demo.imploid.net';
  h.jar.clear();
  h.jar.set(GOOGLE_OAUTH_COOKIE, JSON.stringify(saved));
  h.deleted.length = 0;
  h.validate.mockReset().mockResolvedValue({ idToken: () => 'id-token-1' });
  h.signIn.mockReset().mockResolvedValue({ ok: true, sessionToken: 'sess-tok', session, needsTotp: false });
  h.finishSignIn.mockReset().mockRejectedValue(new Error('NEXT_REDIRECT:/'));
});

describe('googleStart', () => {
  it('start_redirects_to_google_with_pkce_state_nonce', async () => {
    const res = await googleStart();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = new URL(res.headers.get('location')!);
    expect(location.host).toBe('accounts.google.com');
    const p = location.searchParams;
    expect(p.get('state')).toBeTruthy();
    expect(p.get('code_challenge')).toBeTruthy();
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('nonce')).toBeTruthy();
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('redirect_uri')).toBe('https://demo.imploid.net/auth/google/callback');
    expect(p.get('client_id')).toBe('client-id.apps.googleusercontent.com');

    const cookie = res.cookies.get(GOOGLE_OAUTH_COOKIE)!;
    const value = JSON.parse(cookie.value);
    expect(value.state).toBe(p.get('state'));
    expect(value.nonce).toBe(p.get('nonce'));
    expect(value.codeVerifier).toBeTruthy();
    expect(value.codeVerifier).not.toBe(p.get('code_challenge'));
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/google', maxAge: 600 });
  });

  it('the cookie is not secure on localhost only', async () => {
    h.origin = 'http://localhost:3000';
    const res = await googleStart();
    expect(res.cookies.get(GOOGLE_OAUTH_COOKIE)!.secure).toBe(false);
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
  });

  it('each start makes fresh state, nonce and verifier', async () => {
    const a = JSON.parse((await googleStart()).cookies.get(GOOGLE_OAUTH_COOKIE)!.value);
    const b = JSON.parse((await googleStart()).cookies.get(GOOGLE_OAUTH_COOKIE)!.value);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.nonce).not.toBe(a.state);
  });
});

describe('without Google settings', () => {
  it('start_and_callback_404_without_settings', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect((await googleStart()).status).toBe(404);
    expect((await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }))).status).toBe(404);
    expect(h.validate).not.toHaveBeenCalled();
  });
});

describe('googleCallback', () => {
  const failed = 'https://demo.imploid.net/login?error=google_failed';

  it('callback_rejects_state_mismatch_and_missing_cookie', async () => {
    let res = await googleCallback(callbackUrl({ code: 'c', state: 'other-state' }));
    expect(res.headers.get('location')).toBe(failed);
    expect(cookieDeleted()).toBe(true);

    h.jar.clear();
    h.deleted.length = 0;
    res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);
    expect(cookieDeleted()).toBe(true);

    h.jar.set(GOOGLE_OAUTH_COOKIE, 'not json');
    res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);

    h.jar.set(GOOGLE_OAUTH_COOKIE, JSON.stringify(saved));
    res = await googleCallback(callbackUrl({ state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);

    expect(h.validate).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('a cancelled consent (error param) goes back to login', async () => {
    const res = await googleCallback(callbackUrl({ error: 'access_denied', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);
    expect(cookieDeleted()).toBe(true);
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('a failed code exchange goes back to login', async () => {
    h.validate.mockRejectedValue(new Error('invalid_grant'));
    const res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);
    expect(cookieDeleted()).toBe(true);
  });

  it('callback_maps_reasons_to_login_errors', async () => {
    const cases: Array<[string, string]> = [
      ['no_account', 'google_no_account'],
      ['disabled', 'google_disabled'],
      ['email_not_verified', 'google_unverified'],
      ['google_account_mismatch', 'google_other_account'],
      ['invalid_token', 'google_failed'],
    ];
    for (const [reason, code] of cases) {
      expect(googleErrorCode(reason)).toBe(code);
      h.deleted.length = 0;
      h.signIn.mockResolvedValueOnce({ ok: false, reason });
      const res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
      expect(res.headers.get('location')).toBe(`https://demo.imploid.net/login?error=${code}`);
      expect(cookieDeleted()).toBe(true);
    }
    expect(h.finishSignIn).not.toHaveBeenCalled();
  });

  it('Self-Auth throwing (e.g. google_not_configured) goes back to login', async () => {
    h.signIn.mockRejectedValue(new Error('google_not_configured'));
    const res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);
    expect(cookieDeleted()).toBe(true);
  });

  it('callback_signs_in_and_clears_cookie', async () => {
    await expect(googleCallback(callbackUrl({ code: 'the-code', state: 'state-1' }))).rejects.toThrow('NEXT_REDIRECT:/');
    expect(h.validate).toHaveBeenCalledWith('the-code', 'verifier-1');
    expect(h.signIn).toHaveBeenCalledWith({ companyId: 'company-1', idToken: 'id-token-1', nonce: 'nonce-1' });
    expect(h.finishSignIn).toHaveBeenCalledWith({ companyId: 'company-1', sessionToken: 'sess-tok', session, needsTotp: false });
    expect(cookieDeleted()).toBe(true);
  });

  it('callback_sends_totp_users_to_mfa', async () => {
    h.signIn.mockResolvedValue({ ok: true, sessionToken: 'sess-tok', session, needsTotp: true });
    h.finishSignIn.mockRejectedValue(new Error('NEXT_REDIRECT:/login/mfa'));
    await expect(googleCallback(callbackUrl({ code: 'c', state: 'state-1' }))).rejects.toThrow('NEXT_REDIRECT:/login/mfa');
    expect(h.finishSignIn).toHaveBeenCalledWith(expect.objectContaining({ needsTotp: true }));
    expect(cookieDeleted()).toBe(true);
  });

  it('finishSignIn failures map to login errors', async () => {
    h.finishSignIn.mockResolvedValueOnce({ error: 'x', code: 'company' });
    let res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe('https://demo.imploid.net/login?error=company');
    h.finishSignIn.mockResolvedValueOnce({ error: 'x', code: 'unavailable' });
    res = await googleCallback(callbackUrl({ code: 'c', state: 'state-1' }));
    expect(res.headers.get('location')).toBe(failed);
  });
});
