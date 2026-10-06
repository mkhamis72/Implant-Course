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
    findTenantBySlug.mockResolvedValue(t);
    expect(await currentTenant()).toEqual(t);
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
  it('falls back to http for localhost', async () => {
    headerMap.set('host', 'localhost:3000');
    expect(await requestOrigin()).toBe('http://localhost:3000');
  });
});
