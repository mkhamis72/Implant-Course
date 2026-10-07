import { describe, it, expect, vi } from 'vitest';

const tenant = (slug: string, hosts: string[]) => ({ slug, hosts, supabaseUrl: `https://${slug}.supabase.co`, anonKey: 'k', status: 'active' as const });
vi.mock('server-only', () => ({}));
vi.mock('./control', () => ({ controlTenants: vi.fn(), controlSecret: vi.fn() }));
vi.mock('./static', () => ({
  ANY_HOST: '*',
  // The wildcard is listed first so only the exact-before-wildcard rule can make 'exact' win.
  staticTenants: () => [tenant('wild', ['*']), tenant('exact', ['exact.example.com'])],
}));
import { findTenantByHost } from './registry';

describe('static mode host matching', () => {
  it('an exact host match wins over the any-host wildcard', async () => {
    expect((await findTenantByHost('exact.example.com'))?.slug).toBe('exact');
    expect((await findTenantByHost('other.example.com'))?.slug).toBe('wild');
  });
});
