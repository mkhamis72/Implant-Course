import { describe, it, expect } from 'vitest';
import { sortTables, takeFileArg } from './company-export';
import { checkCompanyFile } from './company-restore';

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
});
