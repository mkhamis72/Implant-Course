import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));
vi.mock('@/lib/console/middleware', () => ({ updateConsoleSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { updateConsoleSession } from '@/lib/console/middleware';
import { config, middleware } from './middleware';

describe('middleware matcher', () => {
  const re = new RegExp('^' + config.matcher[0] + '$');

  it.each(['/', '/login', '/patients/abc.png', '/patients/x/y.svg', '/api/activity'])('runs on %s', (path) => {
    expect(re.test(path)).toBe(true);
  });

  it.each(['/file.svg', '/_next/static/chunk.js', '/_next/image', '/favicon.ico'])('skips %s', (path) => {
    expect(re.test(path)).toBe(false);
  });
});

describe('middleware console routing', () => {
  const req = (host: string, path: string) => new NextRequest(`http://${host}${path}`, { headers: { host } });

  beforeEach(() => {
    vi.mocked(updateSession).mockReset();
    vi.mocked(updateConsoleSession).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('without CONSOLE_HOST, /console is a 404 and nothing else runs', async () => {
    vi.stubEnv('CONSOLE_HOST', '');
    const res = await middleware(req('academy.example.com', '/console'));
    expect(res.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
    expect(updateConsoleSession).not.toHaveBeenCalled();
  });

  it('console host + / redirects to /console', async () => {
    vi.stubEnv('CONSOLE_HOST', 'console.example.com');
    const res = await middleware(req('console.example.com', '/'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/console');
  });

  it('console host + /console uses the console session only', async () => {
    vi.stubEnv('CONSOLE_HOST', 'console.example.com');
    await middleware(req('console.example.com', '/console'));
    expect(updateConsoleSession).toHaveBeenCalledTimes(1);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('company host + /patients with CONSOLE_HOST set uses the company session', async () => {
    vi.stubEnv('CONSOLE_HOST', 'console.example.com');
    await middleware(req('academy.example.com', '/patients'));
    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(updateConsoleSession).not.toHaveBeenCalled();
  });
});

describe('middleware landing page', () => {
  const req = (host: string, path: string) => new NextRequest(`http://${host}${path}`, { headers: { host } });

  beforeEach(() => {
    vi.mocked(updateSession).mockReset();
    vi.mocked(updateConsoleSession).mockReset();
  });

  it.each(['/', '/login', '/patients'])('the bare domain shows the landing page on %s and reaches no company', async (path) => {
    const res = await middleware(req('imploid.net', path));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Implant Course Manager');
    expect(updateSession).not.toHaveBeenCalled();
    expect(updateConsoleSession).not.toHaveBeenCalled();
  });

  it('the bare domain shows the privacy page on /privacy and reaches no company', async () => {
    const res = await middleware(req('www.imploid.net', '/privacy'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Privacy</h1>');
    expect(updateSession).not.toHaveBeenCalled();
  });
});

describe('middleware maintenance mode', () => {
  const TOKEN = 'owner-bypass-token-0123456789abcdef';
  const req = (host: string, path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers: { host, ...init.headers } });

  beforeEach(() => {
    vi.mocked(updateSession).mockReset();
    vi.mocked(updateConsoleSession).mockReset();
    vi.stubEnv('CONSOLE_HOST', 'console.example.com');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('maintenance_blocks_sign_in', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', TOKEN);
    for (const r of [
      req('academy.example.com', '/login'),
      req('academy.example.com', '/login', { method: 'POST' }),
      req('academy.example.com', '/patients'),
      req('academy.example.com', '/auth/reset?token=x'),
      req('console.example.com', '/console/login'),
      req('console.example.com', '/console'),
    ]) {
      const res = await middleware(r);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toContain('back soon');
    }
    expect(updateSession).not.toHaveBeenCalled();
    expect(updateConsoleSession).not.toHaveBeenCalled();
  });

  it('still serves /brand/* (the logo) during maintenance', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    await middleware(req('academy.example.com', '/brand/logo'));
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it('lets the owner through with the bypass cookie or header, on company and console hosts', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', TOKEN);
    await middleware(req('academy.example.com', '/login', { headers: { cookie: `icm_maintenance_bypass=${TOKEN}` } }));
    await middleware(req('academy.example.com', '/patients', { headers: { 'x-maintenance-bypass': TOKEN } }));
    expect(updateSession).toHaveBeenCalledTimes(2);
    await middleware(req('console.example.com', '/console', { headers: { cookie: `icm_maintenance_bypass=${TOKEN}` } }));
    expect(updateConsoleSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong, partial or empty bypass, and any bypass when no token is configured', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', TOKEN);
    for (const v of ['wrong', TOKEN.slice(0, -1), `${TOKEN}x`, '']) {
      expect((await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': v } }))).status).toBe(503);
      expect((await middleware(req('academy.example.com', '/login', { headers: { cookie: `icm_maintenance_bypass=${v}` } }))).status).toBe(503);
    }
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', '');
    expect((await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': '' } }))).status).toBe(503);
    // Too short to be a secret: treated as unset.
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', 'short');
    expect((await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': 'short' } }))).status).toBe(503);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('maintenance_bypass_token_needs_32_chars (as docs/history/self-auth-switch-over.md §E says)', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    const t31 = 'a'.repeat(31);
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', t31);
    expect((await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': t31 } }))).status).toBe(503);
    expect(updateSession).not.toHaveBeenCalled();
    const t32 = 'a'.repeat(32);
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', t32);
    await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': t32 } }));
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it('is off unless MAINTENANCE is exactly 1', async () => {
    for (const v of ['', '0', 'false']) {
      vi.stubEnv('MAINTENANCE', v);
      await middleware(req('academy.example.com', '/login'));
    }
    expect(updateSession).toHaveBeenCalledTimes(3);
  });

  it('never echoes or logs the bypass token', async () => {
    vi.stubEnv('MAINTENANCE', '1');
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', TOKEN);
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const res = await middleware(req('academy.example.com', '/login', { headers: { 'x-maintenance-bypass': 'wrong' } }));
    expect(await res.text()).not.toContain(TOKEN);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
      s.mockRestore();
    }
  });
});
