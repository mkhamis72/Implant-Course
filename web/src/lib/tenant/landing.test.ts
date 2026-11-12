import { describe, expect, it } from 'vitest';
import { isLandingHost, landingResponse, privacyResponse } from './landing';

describe('isLandingHost', () => {
  it('is the bare domain and www only, never a company or the console', () => {
    expect(isLandingHost('imploid.net')).toBe(true);
    expect(isLandingHost('WWW.imploid.net:443')).toBe(true);
    expect(isLandingHost('kaleidoscope.imploid.net')).toBe(false);
    expect(isLandingHost('console.imploid.net')).toBe(false);
    expect(isLandingHost('localhost')).toBe(false);
    expect(isLandingHost(null)).toBe(false);
  });
});

describe('landingResponse', () => {
  it('is a plain page that names no company and loads nothing from elsewhere', async () => {
    const r = landingResponse();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await r.text();
    expect(html).toContain('<title>Implant Course Manager</title>');
    expect(html).toContain('your organisation’s own address');
    expect(html).not.toMatch(/kaleidoscope|osdic|academy/i);
    expect(html).not.toMatch(/<script|src=/i);
  });

  it('links to the privacy page', async () => {
    expect(await landingResponse().text()).toContain('<a href="/privacy">');
  });
});

describe('privacyResponse', () => {
  it('is a plain public page that names no company and loads nothing from elsewhere', async () => {
    const r = privacyResponse();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await r.text();
    expect(html).toContain('<title>Privacy – Implant Course Manager</title>');
    expect(html).not.toMatch(/kaleidoscope|osdic|academy/i);
    expect(html).not.toMatch(/<script|src=/i);
    expect(html).not.toContain('noindex');
  });

  it('says what Google sign-in shares and how to reach us', async () => {
    const html = await privacyResponse().text();
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('mailto:implantcourseapp@gmail.com');
  });
});
