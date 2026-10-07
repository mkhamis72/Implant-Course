import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
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
  it('without CONSOLE_HOST, /console is a 404 and company routing is not reached', async () => {
    const res = await middleware(new NextRequest('http://academy.example.com/console', { headers: { host: 'academy.example.com' } }));
    expect(res.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });
});
