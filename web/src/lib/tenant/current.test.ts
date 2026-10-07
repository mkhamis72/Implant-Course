import { describe, it, expect, vi, beforeEach } from 'vitest';

const { headerMap, findTenantBySlug } = vi.hoisted(() => ({ headerMap: new Map<string, string>(), findTenantBySlug: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => headerMap.get(k) ?? null }) }));
vi.mock('./registry', () => ({ findTenantBySlug }));
import { currentTenant, requestOrigin } from './current';

const t = { slug: 'academy', hosts: ['academy.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'k', status: 'active' };

beforeEach(() => {
  headerMap.clear();
  vi.clearAllMocks();
});

describe('currentTenant', () => {
  it('resolves the trusted header', async () => {
    headerMap.set('x-tenant', 'academy');
    headerMap.set('host', 'Academy.Example.com:443');
    findTenantBySlug.mockResolvedValue(t);
    expect(await currentTenant()).toEqual(t);
  });
  it("refuses another company's host with a forged x-tenant", async () => {
    headerMap.set('x-tenant', 'academy');
    headerMap.set('host', 'other.example.com');
    findTenantBySlug.mockResolvedValue(t);
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
  it('refuses a missing or unparseable host for a listed company', async () => {
    headerMap.set('x-tenant', 'academy');
    findTenantBySlug.mockResolvedValue(t);
    await expect(currentTenant()).rejects.toThrow('No company for this request');
    headerMap.set('host', '127.0.0.1:3000');
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
  it('the any-host default accepts any host, even unparseable', async () => {
    headerMap.set('x-tenant', 'default');
    findTenantBySlug.mockResolvedValue({ ...t, slug: 'default', hosts: ['*'] });
    for (const host of ['whatever.example.com', '127.0.0.1:3000', '']) {
      headerMap.set('host', host);
      expect((await currentTenant()).slug).toBe('default');
    }
    headerMap.delete('host');
    expect((await currentTenant()).slug).toBe('default');
  });
  it('throws without a routed company', async () => {
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
  it('throws for a suspended company', async () => {
    headerMap.set('x-tenant', 'academy');
    findTenantBySlug.mockResolvedValue({ ...t, status: 'suspended' });
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
});

describe('requestOrigin', () => {
  it('uses the Host header and https in production', async () => {
    headerMap.set('host', 'academy.example.com');
    headerMap.set('x-forwarded-proto', 'https');
    expect(await requestOrigin()).toBe('https://academy.example.com');
  });
  it('takes only the first forwarded protocol', async () => {
    headerMap.set('host', 'academy.example.com');
    headerMap.set('x-forwarded-proto', 'https,http');
    expect(await requestOrigin()).toBe('https://academy.example.com');
  });
  it('uses the normalised host, keeping a non-default port', async () => {
    headerMap.set('host', 'Academy.Example.com.:8443');
    expect(await requestOrigin()).toBe('https://academy.example.com:8443');
  });
  it('keeps the port for an IP host in local development', async () => {
    headerMap.set('host', '127.0.0.1:3000');
    expect(await requestOrigin()).toBe('https://127.0.0.1:3000');
  });
  it('never echoes a malformed host', async () => {
    headerMap.set('host', 'evil.com/x@y');
    expect(await requestOrigin()).toBe('http://localhost');
  });
  it('falls back to http for localhost', async () => {
    headerMap.set('host', 'localhost:3000');
    expect(await requestOrigin()).toBe('http://localhost:3000');
  });
});
