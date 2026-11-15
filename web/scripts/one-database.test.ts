import { describe, it, expect } from 'vitest';
import { companyIdBySlug, refuseRemovedOptions, takeCompanyArg, TENANT_GONE, ONE_DATABASE } from './one-database';

describe('refuseRemovedOptions (release 3: one database)', () => {
  it('names the replacement of every removed option', () => {
    expect(() => refuseRemovedOptions(['--tenant', 'academy'])).toThrow(TENANT_GONE);
    expect(() => refuseRemovedOptions(['--tenant=academy'])).toThrow(TENANT_GONE);
    expect(() => refuseRemovedOptions(['--all-tenants'])).toThrow(ONE_DATABASE);
    expect(() => refuseRemovedOptions(['--control'])).toThrow(ONE_DATABASE);
    expect(TENANT_GONE).toBe('--tenant is gone: there is one database; company:export and company:restore take --company <slug>.');
    expect(ONE_DATABASE).toBe('--all-tenants / --control are gone: there is one database (ENV_FILE picks it).');
  });
  it('lets everything else through unchanged', () => {
    expect(refuseRemovedOptions(['a@b.com', 'Name', '--role', 'admin'])).toEqual(['a@b.com', 'Name', '--role', 'admin']);
  });
});

describe('takeCompanyArg', () => {
  it('takes --company <slug> anywhere', () => {
    expect(takeCompanyArg(['--out', '-', '--company', 'osdic'])).toEqual({ slug: 'osdic', rest: ['--out', '-'] });
  });
  it('needs a slug', () => {
    expect(() => takeCompanyArg(['--company'])).toThrow('Usage: --company <slug>');
    expect(() => takeCompanyArg(['--company', '--out'])).toThrow('Usage: --company <slug>');
    expect(takeCompanyArg(['--out', '-'])).toEqual({ slug: null, rest: ['--out', '-'] });
  });
  it('refuses the removed --tenant', () => {
    expect(() => takeCompanyArg(['--tenant', 'osdic'])).toThrow(TENANT_GONE);
  });
});

describe('companyIdBySlug', () => {
  const db = (rows: { id: string }[]) => ({ query: async (_sql: string, params: unknown[]) => ({ rows: params[0] === 'osdic' ? rows : [] }) });
  it('reads the id from public.companies', async () => {
    expect(await companyIdBySlug(db([{ id: 'c-osdic' }]), 'osdic')).toBe('c-osdic');
  });
  it('an unknown slug is refused, naming it', async () => {
    await expect(companyIdBySlug(db([]), 'nope')).rejects.toThrow('Unknown company nope');
  });
});
