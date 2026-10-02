import { test, expect } from '@playwright/test';

test('pages are served with the security headers', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
