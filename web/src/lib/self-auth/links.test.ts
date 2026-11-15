import { describe, it, expect, vi, beforeEach } from 'vitest';

const { productionTenants } = vi.hoisted(() => ({ productionTenants: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant/production', () => ({ productionTenants, resetProductionCache: vi.fn() }));
import { companyBaseUrl, resetLink, inviteLink } from './links';
import { ACADEMY_COMPANY_ID } from '@/lib/tenant/types';

const academy = { slug: 'academy', hosts: ['kaleidoscope.imploid.net'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active', companyId: ACADEMY_COMPANY_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('links', () => {
  it('links_use_company_host', async () => {
    productionTenants.mockResolvedValue([academy]);
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toBe('https://kaleidoscope.imploid.net');
  });
  it('an unknown or suspended company has no base url', async () => {
    productionTenants.mockResolvedValue([{ ...academy, status: 'suspended' }]);
    await expect(companyBaseUrl(ACADEMY_COMPANY_ID)).rejects.toThrow();
    await expect(companyBaseUrl('nope')).rejects.toThrow();
  });
  it('localhost hosts use http', async () => {
    productionTenants.mockResolvedValue([{ ...academy, hosts: ['localhost'] }]);
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
    expect(productionTenants).not.toHaveBeenCalled();
  });
  it('reset and invite links are paths with an encoded token', () => {
    expect(resetLink('c', 'a b')).toBe('/auth/reset?token=a%20b');
    expect(inviteLink('c', 'tok')).toBe('/auth/invite?token=tok');
  });
});

describe('local addresses', () => {
  it('a local company address gets the dev server port, so emailed links open locally', async () => {
    productionTenants.mockResolvedValue([{ ...academy, hosts: ['localhost', 'a.localhost'] }]);
    delete process.env.PORT;
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toBe('http://localhost:3000');
    process.env.PORT = '3100';
    expect(await companyBaseUrl(ACADEMY_COMPANY_ID)).toBe('http://localhost:3100');
    delete process.env.PORT;
  });
});
