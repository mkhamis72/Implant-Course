import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));

import { config } from './middleware';

describe('middleware matcher', () => {
  const re = new RegExp('^' + config.matcher[0] + '$');

  it.each(['/', '/login', '/patients/abc.png', '/patients/x/y.svg', '/api/activity'])('runs on %s', (path) => {
    expect(re.test(path)).toBe(true);
  });

  it.each(['/file.svg', '/_next/static/chunk.js', '/_next/image', '/favicon.ico'])('skips %s', (path) => {
    expect(re.test(path)).toBe(false);
  });
});
