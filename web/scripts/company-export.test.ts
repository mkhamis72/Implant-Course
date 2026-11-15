import { describe, it, expect } from 'vitest';
import { ACCOUNT_TABLE_NAMES, ACCOUNT_TABLES, sortTables, takeFileArg } from './company-export';
import { checkCompanyFile, normalizeExport } from './company-restore';

describe('sortTables', () => {
  it('puts parents before children, ties by name', () => {
    const edges: [string, string][] = [['public.sessions', 'public.courses'], ['public.bookings', 'public.sessions'], ['public.sessions', 'public.sessions']];
    expect(sortTables(['public.bookings', 'public.sessions', 'public.chairs', 'public.courses'], edges))
      .toEqual(['public.chairs', 'public.courses', 'public.sessions', 'public.bookings']);
  });

  it('refuses a cycle between tables', () => {
    expect(() => sortTables(['a', 'b'], [['a', 'b'], ['b', 'a']])).toThrow(/cycle/i);
  });
});

describe('takeFileArg', () => {
  it('reads the flag and returns the rest', () => {
    expect(takeFileArg(['--tenant', 'x', '--out', 'f.json'], '--out')).toEqual({ file: 'f.json', rest: ['--tenant', 'x'] });
  });
  it('throws without a value', () => {
    expect(() => takeFileArg(['--out'], '--out')).toThrow(/--out/);
    expect(() => takeFileArg([], '--in')).toThrow(/--in/);
  });
});

describe('checkCompanyFile', () => {
  const id = 'a7c0de00-0000-4000-8000-000000000002';
  const file = () => ({ format: 'company-export-v1', company_id: id, exported_at: 'x', tables: { 'public.chairs': [{ company_id: id }] } });
  it('accepts a file for the company', () => {
    expect(() => checkCompanyFile(file(), id)).not.toThrow();
  });
  it("refuses another company's file", () => {
    expect(() => checkCompanyFile(file(), 'a7c0de00-0000-4000-8000-000000000001')).toThrow(/company/);
  });
  it('refuses anything that is not a company export', () => {
    expect(() => checkCompanyFile({ ...file(), format: 'x' }, id)).toThrow(/company export/);
    expect(() => checkCompanyFile(null, id)).toThrow(/company export/);
  });
  it('accepts both formats: v1 (before accounts were exported) and v2', () => {
    expect(() => checkCompanyFile({ ...file(), format: 'company-export-v2', company: { id } }, id)).not.toThrow();
  });
});

describe('normalizeExport', () => {
  const id = 'a7c0de00-0000-4000-8000-000000000002';
  it('reads a v1 file as v2: auth.users dropped, the account tables empty, no company row', () => {
    const v1 = { format: 'company-export-v1' as const, company_id: id, exported_at: 'x', tables: { 'auth.users': [{ id: 'u' }], 'public.profiles': [{ user_id: 'u' }], 'public.chairs': [] } };
    const n = normalizeExport(v1);
    expect(n.format).toBe('company-export-v2');
    expect(n.company).toBeNull();
    expect(Object.keys(n.tables).sort()).toEqual(['public.chairs', 'public.profiles', 'self_auth.account', 'self_auth.totp_factor', 'self_auth.user']);
    expect(n.tables['public.profiles']).toEqual([{ user_id: 'u' }]);
  });
  it('leaves a v2 file as it is', () => {
    const v2 = { format: 'company-export-v2' as const, company_id: id, exported_at: 'x', company: { id }, tables: {} };
    expect(normalizeExport(v2)).toBe(v2);
  });
});

describe('ACCOUNT_TABLES', () => {
  it('loads users before their passwords, authenticators and profiles, and never exports OAuth tokens', () => {
    expect(ACCOUNT_TABLE_NAMES).toEqual(['self_auth.user', 'self_auth.account', 'self_auth.totp_factor', 'public.profiles']);
    const account = ACCOUNT_TABLES.find((a) => a.table === 'self_auth.account');
    expect(account && 'nullColumns' in account ? account.nullColumns : []).toEqual(
      expect.arrayContaining(['accessToken', 'refreshToken', 'idToken']));
  });
});
