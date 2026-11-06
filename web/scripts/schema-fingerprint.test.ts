import { describe, expect, it } from 'vitest';
import { compareFingerprints, fingerprintQueries, FINGERPRINT_SCHEMAS } from './schema-fingerprint';

const fp = (entries: Record<string, string>) => ({ target: 'x', entries });

describe('compareFingerprints', () => {
  const base = fp({ 'fn public.f()': 'f | postgres | authenticated=X/postgres', 'role tenant_definer': 'super=false' });

  it('passes identical fingerprints', () => {
    expect(compareFingerprints(base, structuredClone(base))).toEqual({ onlyBefore: [], onlyAfter: [], different: [], regrouped: [] });
  });

  it('names entries on one side only and changed values (a grant, a leftover role)', () => {
    const after = fp({ 'fn public.f()': 'f | postgres | anon=X/postgres,authenticated=X/postgres', 'schema app': 'postgres' });
    expect(compareFingerprints(base, after)).toEqual({
      onlyBefore: ['role tenant_definer'],
      onlyAfter: ['schema app'],
      different: ['fn public.f()'],
      regrouped: [],
    });
  });

  it('treats a CHECK that only lost its nested parentheses as regrouped, not different', () => {
    const b = fp({ 'con public.t.c': 'CHECK ((((length(x) >= 1) AND (length(x) <= 20)) AND (x = TRIM(BOTH FROM x))))' });
    const a = fp({ 'con public.t.c': 'CHECK (((length(x) >= 1) AND (length(x) <= 20) AND (x = TRIM(BOTH FROM x))))' });
    expect(compareFingerprints(b, a)).toMatchObject({ different: [], regrouped: ['con public.t.c'] });
    const other = fp({ 'con public.t.c': 'CHECK (((length(x) >= 2) AND (length(x) <= 20) AND (x = TRIM(BOTH FROM x))))' });
    expect(compareFingerprints(b, other).different).toEqual(['con public.t.c']);
  });
});

describe('fingerprintQueries', () => {
  it('covers the three app schemas, ACLs with built-in defaults for NULL, default privileges and roles', () => {
    expect(FINGERPRINT_SCHEMAS).toEqual(['public', 'app_private', 'app']);
    const sql = fingerprintQueries().join('\n');
    expect(sql).toContain("in ('public', 'app_private', 'app')");
    expect(sql).toContain("coalesce(p.proacl, acldefault('f', p.proowner))");
    expect(sql).toContain('pg_default_acl');
    expect(sql).toContain("'role ' || rolname");
    expect(sql).toContain('a.attacl');
  });
});
