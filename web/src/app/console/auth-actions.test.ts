import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  token: 'tok' as string | null,
  host: { ok: true },
  listed: true,
  tables: [] as string[],
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.cookieSet, delete: h.cookieDelete }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/supabase/middleware', () => ({ lastSeenCookieOptions: { httpOnly: true } }));
vi.mock('@/lib/console/session', () => ({
  requireConsoleUser: async () => ({ userId: 'u1', email: 'a@b.c' }),
  requireConsoleHost: async () => {
    if (!h.host.ok) throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/self-auth/cookie', () => ({
  readSessionCookie: async () => h.token,
  setSessionCookie: h.setSessionCookie,
  clearSessionCookie: h.clearSessionCookie,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }));
vi.mock('@/lib/console/supabase', () => ({
  createConsoleServiceClient: () => ({
    from: (t: string) => (h.tables.push(t), { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.listed ? { active: true } : null }) }) }) }),
  }),
}));

const auth = {
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  totp: { startEnroll: vi.fn(), confirmEnroll: vi.fn(), verify: vi.fn() },
};
vi.mock('@/lib/self-auth/console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => auth }));

import { confirmConsoleEnroll, signInConsole, signOutConsole, startConsoleEnroll, verifyConsoleMfa } from './auth-actions';

const session = { sessionId: 's', userId: 'u1', companyId: 'console', email: 'a@b.c', aal: 'aal1', expiresAt: new Date(Date.now() + 3600_000) };

beforeEach(() => {
  vi.clearAllMocks();
  h.token = 'tok';
  h.host.ok = true;
  h.listed = true;
  h.tables = [];
  auth.signIn.mockResolvedValue({ ok: true, sessionToken: 'new-tok', session, needsTotp: false });
  auth.totp.startEnroll.mockResolvedValue({ secret: 'SECRET', otpauthUrl: 'otpauth://totp/x' });
  auth.totp.confirmEnroll.mockResolvedValue({ ...session, aal: 'aal2' });
  auth.totp.verify.mockResolvedValue({ ...session, aal: 'aal2' });
});

describe('console host', () => {
  it('every auth action is a 404 off the console host', async () => {
    h.host.ok = false;
    const fd = new FormData();
    await expect(signInConsole({}, fd)).rejects.toThrow('NOT_FOUND');
    await expect(verifyConsoleMfa({}, fd)).rejects.toThrow('NOT_FOUND');
    await expect(startConsoleEnroll()).rejects.toThrow('NOT_FOUND');
    await expect(confirmConsoleEnroll('f', '1')).rejects.toThrow('NOT_FOUND');
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});

describe('startConsoleEnroll', () => {
  it('returns the secret and a QR code for the session', async () => {
    expect(await startConsoleEnroll()).toEqual({ factorId: 'totp', qrCode: 'data:image/png;base64,QR', secret: 'SECRET' });
    expect(auth.totp.startEnroll).toHaveBeenCalledWith('tok', 'console');
  });
  it('refuses when an authenticator is already confirmed', async () => {
    auth.totp.startEnroll.mockRejectedValue(Object.assign(new Error('x'), { code: 'totp_already_enrolled' }));
    expect(await startConsoleEnroll()).toEqual({ error: 'An authenticator is already set up.' });
  });
});

describe('confirmConsoleEnroll', () => {
  it('confirms with the code, spaces removed', async () => {
    expect(await confirmConsoleEnroll('totp', '123 456')).toEqual({ ok: true });
    expect(auth.totp.confirmEnroll).toHaveBeenCalledWith('tok', 'console', '123456');
  });
  it('says so on a wrong code', async () => {
    auth.totp.confirmEnroll.mockResolvedValue(null);
    expect(await confirmConsoleEnroll('totp', '000000')).toHaveProperty('error');
  });
});

describe('verifyConsoleMfa', () => {
  const form = (code: string) => {
    const fd = new FormData();
    fd.set('code', code);
    return fd;
  };
  it('raises the session and continues to the console', async () => {
    await expect(verifyConsoleMfa({}, form('123 456'))).rejects.toThrow('REDIRECT /console');
    expect(auth.totp.verify).toHaveBeenCalledWith('tok', 'console', '123456');
  });
  it('shows an error on a wrong code', async () => {
    auth.totp.verify.mockResolvedValue(null);
    expect(await verifyConsoleMfa({}, form('000000'))).toHaveProperty('error');
  });
  it('goes to login without a session cookie', async () => {
    h.token = null;
    await expect(verifyConsoleMfa({}, form('123456'))).rejects.toThrow('REDIRECT /console/login');
  });
});

describe('signInConsole', () => {
  const form = () => {
    const fd = new FormData();
    fd.set('email', 'A@b.c');
    fd.set('password', 'pw');
    return fd;
  };
  it('signs in as company console and sets the console cookie', async () => {
    await expect(signInConsole({}, form())).rejects.toThrow('REDIRECT /console');
    expect(auth.signIn).toHaveBeenCalledWith({ companyId: 'console', email: 'a@b.c', password: 'pw' });
    expect(h.setSessionCookie).toHaveBeenCalledWith('console', 'new-tok', expect.any(Number));
    expect(h.cookieSet).toHaveBeenCalledWith('icm_console_last_seen', expect.any(String), expect.anything());
  });
  it('answers like a wrong password for bad credentials', async () => {
    auth.signIn.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
    expect(await signInConsole({}, form())).toEqual({ error: 'Incorrect email or password.', email: 'a@b.c' });
    expect(h.setSessionCookie).not.toHaveBeenCalled();
  });
  it('answers like a wrong password and ends the session when the user is not listed', async () => {
    h.listed = false;
    expect(await signInConsole({}, form())).toEqual({ error: 'Incorrect email or password.', email: 'a@b.c' });
    expect(auth.signOut).toHaveBeenCalledWith('new-tok');
    expect(h.setSessionCookie).not.toHaveBeenCalled();
  });
});

describe('signOutConsole', () => {
  it('ends the session, clears both cookies and goes to login', async () => {
    await expect(signOutConsole()).rejects.toThrow('REDIRECT /console/login');
    expect(auth.signOut).toHaveBeenCalledWith('tok');
    expect(h.clearSessionCookie).toHaveBeenCalledWith('console');
    expect(h.cookieDelete).toHaveBeenCalledWith('icm_console_last_seen');
  });
});

describe('signInConsole checks the list of the active source', () => {
  it('control: console_admins; production: console_users', async () => {
    const f = new FormData();
    f.set('email', 'owner@example.com');
    f.set('password', 'pw-123456');
    await signInConsole({}, f).catch(() => undefined);
    vi.stubEnv('COMPANY_LIST', 'production');
    try {
      await signInConsole({}, f).catch(() => undefined);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(h.tables).toEqual(['console_admins', 'console_users']);
  });
});
