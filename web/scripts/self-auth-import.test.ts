import { describe, expect, it } from 'vitest';
import { maskEmail, parseImportArgs, splitId, unhandledColumns, USER_COLUMNS } from './self-auth-import';

describe('self-auth-import helpers', () => {
  it('parses --db and --apply; dry run by default', () => {
    expect(parseImportArgs(['--db', 'app'])).toEqual({ db: 'app', apply: false, undoSplits: false });
    expect(parseImportArgs(['--db', 'control', '--apply'])).toEqual({ db: 'control', apply: true, undoSplits: false });
    expect(parseImportArgs(['--db', 'app', '--undo-splits', '--apply'])).toEqual({ db: 'app', apply: true, undoSplits: true });
    for (const bad of [[], ['--db'], ['--db', 'prod'], ['--db', 'app', '--force'], ['--db', 'control', '--undo-splits']]) {
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
