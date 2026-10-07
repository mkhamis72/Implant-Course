import { describe, it, expect } from 'vitest';
import { companyLabel, envFileText, maskLines, takeTenantArg, tenantEnvFrom, type Company } from './tenant-env';

const academy: Company = {
  tenant: { slug: 'academy', name: 'Implant Course Academy', status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon-key' },
  secrets: { serviceRoleKey: 'svc-key', databaseUrl: 'postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres' },
};

describe('takeTenantArg', () => {
  it('takes the slug and leaves the other arguments in order', () => {
    expect(takeTenantArg(['--tenant', 'academy', 'a@b.com', 'Name', '--role', 'admin'])).toEqual({
      slug: 'academy', rest: ['a@b.com', 'Name', '--role', 'admin'],
    });
    expect(takeTenantArg(['a@b.com', '--tenant', 'academy'])).toEqual({ slug: 'academy', rest: ['a@b.com'] });
  });
  it('is a no-op without --tenant', () => {
    expect(takeTenantArg(['--control'])).toEqual({ slug: null, rest: ['--control'] });
  });
  it('refuses --tenant without a slug or followed by another flag', () => {
    expect(() => takeTenantArg(['--tenant'])).toThrow('Usage: --tenant <slug>');
    expect(() => takeTenantArg(['--tenant', '--role', 'admin'])).toThrow('Usage: --tenant <slug>');
  });
  it('refuses --tenant=<slug>', () => {
    expect(() => takeTenantArg(['--tenant=academy'])).toThrow('Usage: --tenant <slug>');
  });
  it('refuses a repeated --tenant', () => {
    expect(() => takeTenantArg(['--tenant', 'academy', '--tenant', 'other'])).toThrow('Usage: --tenant <slug>');
  });
});

describe('company env', () => {
  it('maps a company to the env a script reads', () => {
    expect(tenantEnvFrom(academy, '/tmp/ca.crt')).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
      DATABASE_URL: 'postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres',
      DATABASE_CA_CERT: '/tmp/ca.crt',
    });
  });
  it('labels a company by slug and host', () => {
    expect(companyLabel(academy.tenant)).toBe('academy abcdefgh.supabase.co');
  });
});

describe('maskLines', () => {
  it('masks every secret value under GitHub Actions only', () => {
    expect(maskLines(academy, { GITHUB_ACTIONS: 'true' })).toEqual([
      '::add-mask::svc-key',
      '::add-mask::postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres',
      '::add-mask::anon-key',
    ]);
    expect(maskLines(academy, {})).toEqual([]);
  });
});

describe('envFileText', () => {
  it('writes one single-quoted assignment per line', () => {
    expect(envFileText({ SLUG: 'academy', DATABASE_URL: "postgres://u:p'w$x@h/db" })).toBe(
      "SLUG='academy'\nDATABASE_URL='postgres://u:p'\\''w$x@h/db'\n",
    );
  });
});
