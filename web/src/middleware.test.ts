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
