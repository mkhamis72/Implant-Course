import { describe, it, expect } from 'vitest';
import { staticTenants, ANY_HOST } from './static';

const single = { NEXT_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const file = (tenants: unknown) => () => JSON.stringify(tenants);
const local = (slug: string, hosts: string[], status = 'active') => ({
  slug, hosts, supabaseUrl: `https://${slug}.supabase.co`, anonKey: 'anon', serviceRoleKey: 'svc', status,
});

describe('staticTenants', () => {
  it('without TENANTS_FILE: one default tenant from today\'s env vars, on any host', () => {
    expect(staticTenants(single)).toEqual([
      { slug: 'default', hosts: [ANY_HOST], supabaseUrl: 'https://dev.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc', status: 'active' },
    ]);
  });

  it('needs the env vars in single-tenant mode', () => {
    expect(() => staticTenants({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('reads the local file, normalising hosts', () => {
    const env = { TENANTS_FILE: 'tenants.local.json', NODE_ENV: 'development' };
    const tenants = staticTenants(env, file([local('dev', ['LOCALHOST:3000']), local('dev2', ['tenant2.localhost'], 'suspended')]));
    expect(tenants.map((t) => [t.slug, t.hosts, t.status])).toEqual([
      ['dev', ['localhost'], 'active'],
      ['dev2', ['tenant2.localhost'], 'suspended'],
    ]);
  });

  it('refuses the local file in production', () => {
    expect(() => staticTenants({ TENANTS_FILE: 'x.json', NODE_ENV: 'production' }, file([]))).toThrow(/production/);
  });

  it('refuses a host listed by two tenants', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([local('a', ['localhost']), local('b', ['localhost'])]))).toThrow(/localhost.*two tenants/);
  });

  it('refuses malformed entries', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([{ slug: 'a', hosts: [] }]))).toThrow(/Invalid tenant/);
  });
});
