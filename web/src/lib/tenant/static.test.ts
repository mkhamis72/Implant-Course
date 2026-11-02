import { describe, it, expect } from 'vitest';
import { staticTenants, ANY_HOST } from './static';
import { ACADEMY_COMPANY_ID } from './types';

const single = { NEXT_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const file = (tenants: unknown) => () => JSON.stringify(tenants);
const local = (slug: string, hosts: string[], status = 'active') => ({
  slug, hosts, supabaseUrl: `https://${slug}.supabase.co`, anonKey: 'anon', serviceRoleKey: 'svc', status,
});

describe('staticTenants', () => {
  it('without TENANTS_FILE: one default tenant from today\'s env vars, on any host', () => {
    expect(staticTenants(single)).toEqual([
      { slug: 'default', hosts: [ANY_HOST], supabaseUrl: 'https://dev.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc', status: 'active', companyId: ACADEMY_COMPANY_ID },
    ]);
  });

  it('a TENANTS_FILE entry without companyId gets the academy id; an explicit one is kept', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    const other = '11111111-1111-4111-8111-111111111111';
    const [a, b] = staticTenants(env, file([local('aa', ['a.local']), { ...local('bb', ['b.local']), companyId: other }]));
    expect(a.companyId).toBe(ACADEMY_COMPANY_ID);
    expect(b.companyId).toBe(other);
  });

  it('the default tenant works without a service key (only admin actions need it)', () => {
    const noKey: Record<string, string | undefined> = { ...single, SUPABASE_SERVICE_ROLE_KEY: undefined };
    const [t] = staticTenants(noKey);
    expect(t.slug).toBe('default');
    expect(t.serviceRoleKey).toBeUndefined();
  });

  it('a TENANTS_FILE entry still needs its service key', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    const noKey = { ...local('dev', ['localhost']), serviceRoleKey: undefined };
    expect(() => staticTenants(env, file([noKey]))).toThrow(/Invalid tenant/);
  });

  it('invalid JSON in TENANTS_FILE names the file but never echoes its contents', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    let message = '';
    try {
      staticTenants(env, () => '[{"serviceRoleKey": "SECRET-VALUE" oops}]');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('TENANTS_FILE x.json is not valid JSON');
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
    expect(() => staticTenants(env, file([local('aa', ['localhost']), local('bb', ['localhost'])]))).toThrow(/localhost.*two tenants/);
  });

  it('refuses malformed entries', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([{ slug: 'aa', hosts: [] }]))).toThrow(/Invalid tenant/);
  });

  it('refuses when file cannot be read', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    const read = () => { throw new Error('ENOENT'); };
    expect(() => staticTenants(env, read)).toThrow(/TENANTS_FILE x\.json/);
  });

  it('refuses malformed JSON', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    const read = () => 'not json';
    expect(() => staticTenants(env, read)).toThrow(/TENANTS_FILE x\.json/);
  });

  it('refuses a bad host string', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([local('cc', ['evil.com/x'])]))).toThrow(/bad host evil\.com\/x/);
  });
});
