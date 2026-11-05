import { describe, expect, it } from 'vitest';
import { compareChecksums, EXPECTED_SCHEMA_CHANGES, hashSql, type Checksums } from './window-checksums';

const sum = (rows: number, columns: Record<string, string>) => ({ rows, columns });
const make = (tables: Checksums['tables']): Checksums => ({ target: 'x', tables });

describe('compareChecksums', () => {
  const base = make({
    'public.patients': sum(2, { id: 'a', name: 'b' }),
    'public.audit_log': sum(10, { id: 'c' }),
    'auth.sessions': sum(1, { id: 'd' }),
  });

  it('passes on identical data', () => {
    const r = compareChecksums(base, structuredClone(base));
    expect(r.ok).toBe(true);
    expect(r.differences).toEqual([]);
  });

  it('fails when a row count or a column hash differs', () => {
    const after = structuredClone(base);
    after.tables['public.patients'] = sum(3, { id: 'a', name: 'b' });
    expect(compareChecksums(base, after).differences.join('\n')).toMatch(/public\.patients: rows 2 -> 3/);
    const changed = structuredClone(base);
    changed.tables['public.patients'].columns.name = 'zzz';
    const r = compareChecksums(base, changed);
    expect(r.ok).toBe(false);
    expect(r.differences.join('\n')).toMatch(/public\.patients\.name: hash differs/);
  });

  it('hashes only the columns present on both sides (a new column is not a difference)', () => {
    const after = structuredClone(base);
    after.tables['public.patients'].columns.company_note = 'q';
    const r = compareChecksums(base, after);
    expect(r.ok).toBe(false);
    expect(r.differences.join('\n')).toMatch(/public\.patients: column company_note only after/);
  });

  it('reports audit_log and auth session tables without failing', () => {
    const after = structuredClone(base);
    after.tables['public.audit_log'] = sum(40, { id: 'zz' });
    after.tables['auth.sessions'] = sum(0, { id: 'e' });
    const r = compareChecksums(base, after);
    expect(r.ok).toBe(true);
    expect(r.reported.join('\n')).toMatch(/public\.audit_log/);
    expect(r.reported.join('\n')).toMatch(/auth\.sessions/);
  });

  it('fails on a table or column on one side only unless it is on the expected list, and prints the expected ones', () => {
    const after = structuredClone(base);
    after.tables['public.surprise'] = sum(0, {});
    delete after.tables['auth.sessions'];
    const r = compareChecksums(base, after);
    expect(r.ok).toBe(false);
    expect(r.differences.join('\n')).toMatch(/public\.surprise: table only after/);

    const listed = { table: 'public.surprise', kind: 'table-added' as const, migration: '9999_test' };
    const ok = compareChecksums(base, { ...after, tables: { ...after.tables } }, [listed]);
    expect(ok.differences.join('\n')).not.toMatch(/surprise/);
    expect(ok.expected.join('\n')).toMatch(/public\.surprise.*9999_test/);
  });

  it('allows a listed data change but still fails an unlisted table', () => {
    const before = make({ 'app_private.schema_migrations': sum(1, { name: 'a' }), 'public.x': sum(1, { id: 'a' }) });
    const after = make({ 'app_private.schema_migrations': sum(8, { name: 'b' }), 'public.x': sum(1, { id: 'a' }) });
    const r = compareChecksums(before, after);
    expect(r.ok).toBe(true);
    expect(r.expected.join('\n')).toMatch(/schema_migrations/);
  });

  it('names a migration for every expected entry', () => {
    for (const e of EXPECTED_SCHEMA_CHANGES) expect(e.migration).toMatch(/^\d{4}_|runner/);
  });
});

describe('hashSql', () => {
  it('excludes company_id and orders by the key without it', () => {
    const sql = hashSql('public', 't', ['company_id', 'id', 'name'], ['company_id', 'id']);
    expect(sql).toContain('"id"');
    expect(sql).not.toMatch(/md5\(coalesce\("company_id"/);
    expect(sql).toMatch(/order by "id"/);
  });
  it('falls back to every column but company_id when the key is only company_id', () => {
    const sql = hashSql('public', 'settings', ['company_id', 'a', 'b'], ['company_id']);
    expect(sql).toMatch(/order by "a"::text, "b"::text/);
  });
});
