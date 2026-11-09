import { describe, it, expect, vi, beforeEach } from 'vitest';

const { controlTenants } = vi.hoisted(() => ({ controlTenants: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant/control', () => ({ controlTenants, controlSecret: vi.fn() }));
import { companyBaseUrl, resetLink, inviteLink } from './links';
import { ACADEMY_COMPANY_ID } from '@/lib/tenant/types';

const academy = { slug: 'academy', hosts: ['kaleidoscope.imploid.net'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active', companyId: ACADEMY_COMPANY_ID };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
});

describe('links', () => {
  it('links_use_company_host', async () => {
    controlTenants.mockResolvedValue([academy]);
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toBe('https://kaleidoscope.imploid.net');
  });
  it('an unknown or suspended company has no base url', async () => {
    controlTenants.mockResolvedValue([{ ...academy, status: 'suspended' }]);
    await expect(companyBaseUrl(ACADEMY_COMPANY_ID)).rejects.toThrow();
    await expect(companyBaseUrl('nope')).rejects.toThrow();
  });
  it('localhost hosts use http', async () => {
    controlTenants.mockResolvedValue([{ ...academy, hosts: ['localhost'] }]);
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toMatch(/^http:\/\/localhost/);
  });
  it('console_links_use_console_host', async () => {
    process.env.CONSOLE_HOST = 'console.imploid.net';
    expect(await companyBaseUrl('console')).toBe('https://console.imploid.net');
    process.env.CONSOLE_HOST = 'localhost:3000';
    expect(await companyBaseUrl('console')).toBe('http://localhost:3000');
    process.env.CONSOLE_HOST = '127.0.0.1:3000';
    expect(await companyBaseUrl('console')).toBe('http://127.0.0.1:3000');
    delete process.env.CONSOLE_HOST;
    await expect(companyBaseUrl('console')).rejects.toThrow(/CONSOLE_HOST/);
    expect(controlTenants).not.toHaveBeenCalled();
  });
  it('reset and invite links are paths with an encoded token', () => {
    expect(resetLink('c', 'a b')).toBe('/auth/reset?token=a%20b');
    expect(inviteLink('c', 'tok')).toBe('/auth/invite?token=tok');
  });
});

describe('single-company default', () => {
  it('uses SITE_URL when the only host is the wildcard', async () => {
    delete process.env.CONTROL_SUPABASE_URL;
    process.env.TENANTS_FILE = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SITE_URL = 'http://localhost:3000/';
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toBe('http://localhost:3000');
  });
});
