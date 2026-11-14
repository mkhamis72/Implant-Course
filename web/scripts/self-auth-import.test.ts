import { describe, expect, it } from 'vitest';
import { assertSelfAuthTarget, failureReason, maskEmail, parseImportArgs, splitId, unhandledColumns, USER_COLUMNS } from './self-auth-import';

describe('self-auth-import helpers', () => {
  it('parses --db and --apply; dry run by default', () => {
    expect(parseImportArgs(['--db', 'app'])).toEqual({ db: 'app', apply: false, undoSplits: false });
    expect(parseImportArgs(['--db', 'app', '--undo-splits', '--apply'])).toEqual({ db: 'app', apply: true, undoSplits: true });
    for (const bad of [[], ['--db'], ['--db', 'prod'], ['--db', 'app', '--force'], ['--db', 'control'], ['--db', 'control', '--apply']]) {
      expect(() => parseImportArgs(bad)).toThrow(/Usage/);
    }
  });

  it('split ids are stable per (user, company), distinct, and valid v5 uuids', () => {
    const u = '11111111-1111-4111-8111-111111111111';
    const a = 'a7c0de00-0000-4000-8000-000000000001';
    const b = '808efe9a-a72d-4c00-98bd-c392373b0350';
    expect(splitId(u, b)).toBe(splitId(u, b));
    expect(splitId(u, b)).not.toBe(splitId(u, a));
    expect(splitId(u, b)).not.toBe(u);
    expect(splitId(u, b)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(splitId(u.toUpperCase(), b)).toBe(splitId(u, b));
  });

  it('masks emails to the first character and the domain', () => {
    expect(maskEmail('Someone@Example.com')).toBe('s***@example.com');
    expect(maskEmail('')).toBe('(no email)');
  });

  it('flags every user column it does not handle', () => {
    expect(unhandledColumns(['public.patients.created_by', 'public.audit_log.user_id', 'public.zz.approved_by'])).toEqual(['public.zz.approved_by']);
    // The seven created_by columns the brief names are all handled, plus the memberships.
    for (const t of ['patients', 'delegates', 'products', 'courses', 'enrollments', 'sessions', 'talks']) {
      expect(USER_COLUMNS[`public.${t}.created_by`]).toBe('repoint');
    }
    expect(USER_COLUMNS['public.company_members.user_id']).toBe('repoint');
    expect(USER_COLUMNS['public.profiles.user_id']).toBe('copy');
  });
});

describe('self-auth-import target and failure reasons', () => {
  const pooler = (port: number, ref = 'abcdefghij') => `postgresql://postgres.${ref}:pw@aws-0-eu-central-1.pooler.supabase.com:${port}/postgres?sslmode=require`;

  it('stops before any write when SELF_AUTH_DATABASE_URL is another host or database than DATABASE_URL', () => {
    const DATABASE_URL = pooler(6543);
    // Unset, or the same project through another port of the pooler (session vs transaction): fine.
    expect(() => assertSelfAuthTarget({ DATABASE_URL })).not.toThrow();
    expect(() => assertSelfAuthTarget({ DATABASE_URL, SELF_AUTH_DATABASE_URL: pooler(5432) })).not.toThrow();
    expect(() => assertSelfAuthTarget({ DATABASE_URL: 'postgresql://postgres:a@127.0.0.1:54322/postgres', SELF_AUTH_DATABASE_URL: 'postgresql://postgres:b@127.0.0.1:54322/postgres' })).not.toThrow();
    // A Supabase project is its ref: the direct host db.<ref>.supabase.co and the pooler user postgres.<ref> agree.
    expect(() => assertSelfAuthTarget({ DATABASE_URL: 'postgresql://postgres:pw@db.abcdefghij.supabase.co:5432/postgres', SELF_AUTH_DATABASE_URL: pooler(5432) })).not.toThrow();
    expect(() => assertSelfAuthTarget({ DATABASE_URL: pooler(5432), SELF_AUTH_DATABASE_URL: 'postgresql://postgres:pw@DB.abcdefghij.supabase.co/postgres' })).not.toThrow();
    for (const other of [
      pooler(5432, 'zzzzzzzzzz'), // another project on the same shared pooler host
      'postgresql://postgres:pw@db.zzzzzzzzzz.supabase.co:5432/postgres', // another project's direct host
      'postgresql://postgres@aws-0-eu-central-1.pooler.supabase.com:5432/postgres', // pooler without a project ref
      'postgresql://postgres.abcdefghij:pw@aws-0-eu-central-1.pooler.supabase.com:5432/other',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ]) {
      expect(() => assertSelfAuthTarget({ DATABASE_URL, SELF_AUTH_DATABASE_URL: other })).toThrow(/Stopped before any change: SELF_AUTH_DATABASE_URL/);
    }
    // The message names hosts, never a password.
    try {
      assertSelfAuthTarget({ DATABASE_URL, SELF_AUTH_DATABASE_URL: 'postgresql://postgres:secretpw@127.0.0.1:54322/postgres' });
    } catch (e) {
      expect((e as Error).message).not.toContain('secretpw');
      expect((e as Error).message).not.toContain(':pw@');
    }
    expect(() => assertSelfAuthTarget({ DATABASE_URL, SELF_AUTH_DATABASE_URL: 'not a url' })).toThrow(/Stopped before any change/);
  });

  it('logs the error code, else the error class, never the message', () => {
    expect(failureReason(Object.assign(new Error('x'), { code: 'already_imported' }))).toBe('already_imported');
    expect(failureReason(new TypeError('secret detail'))).toBe('TypeError');
    class PoolTimeout extends Error {}
    expect(failureReason(new PoolTimeout('secret detail'))).toBe('PoolTimeout');
    const named = new Error('secret detail');
    named.name = 'ConnectionError';
    expect(failureReason(named)).toBe('ConnectionError');
    expect(failureReason('boom')).toBe('failed');
    expect(failureReason(null)).toBe('failed');
  });
});
