import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseCookies, RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';

const h = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => h.store }));
import { setSessionCookie, readSessionCookie, clearSessionCookie } from './cookie';

let headers: Headers;
beforeEach(() => {
  headers = new Headers();
  h.store = new ResponseCookies(headers);
  delete process.env.SITE_URL;
});

describe('session cookie', () => {
  it('cookie_is_host_only', async () => {
    await setSessionCookie('tenant', 'tok', 300);
    const c = headers.get('set-cookie')!;
    expect(c).toMatch(/^icm_session=tok/);
    expect(c).not.toMatch(/domain/i);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/Max-Age=300/i);
  });
  it('the console has its own cookie', async () => {
    await setSessionCookie('console', 'tok', 900);
    expect(headers.get('set-cookie')).toMatch(/^icm_console_session=tok/);
  });
  it('is not Secure on localhost', async () => {
    process.env.SITE_URL = 'http://localhost:3000';
    await setSessionCookie('tenant', 'tok', 60);
    expect(headers.get('set-cookie')).not.toMatch(/Secure/i);
  });
  it('reads and clears', async () => {
    h.store = new RequestCookies(new Headers({ cookie: 'icm_session=abc; icm_console_session=def' }));
    expect(await readSessionCookie('tenant')).toBe('abc');
    expect(await readSessionCookie('console')).toBe('def');
    h.store = new RequestCookies(new Headers());
    expect(await readSessionCookie('tenant')).toBeNull();
    h.store = new ResponseCookies(headers);
    await clearSessionCookie('tenant');
    const c = headers.get('set-cookie')!;
    expect(c).toMatch(/^icm_session=;/);
    expect(c).toMatch(/Max-Age=0/i);
    expect(c).not.toMatch(/domain/i);
  });
});
