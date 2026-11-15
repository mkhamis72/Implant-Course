import { describe, it, expect } from 'vitest';
import { ensureLocalCompanies, LOCAL_COMPANIES } from './dev-companies';

type Row = { id: string; slug: string; hosts: string[]; status: string };

/** A fake pg client over a companies table: provision_company adds a row; the update sets hosts/status. */
function fakeDb(rows: Row[]) {
  const calls: string[] = [];
  return {
    calls,
    rows,
    async query(sql: string, params: unknown[] = []) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('from public.companies')) return { rows: rows.map((r) => ({ ...r })) };
      if (sql.includes('provision_company')) {
        rows.push({ id: `id-${params[0]}`, slug: String(params[0]), hosts: [], status: 'active' });
        return { rows: [{ id: `id-${params[0]}` }] };
      }
      if (sql.includes('update public.companies')) {
        const r = rows.find((x) => x.slug === params[0])!;
        r.hosts = params[1] as string[];
        r.status = String(params[2]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe('LOCAL_COMPANIES', () => {
  it('academy on localhost and a.localhost, company B, and a suspended one', () => {
    expect(LOCAL_COMPANIES).toEqual([
      { slug: 'academy', name: 'Academy', hosts: ['localhost', 'a.localhost'], status: 'active' },
      { slug: 'company-b', name: 'Company B', hosts: ['tenant2.localhost'], status: 'active' },
      { slug: 'paused', name: 'Paused Co', hosts: ['paused.localhost'], status: 'suspended' },
    ]);
  });
});

describe('ensureLocalCompanies', () => {
  it('refuses anything but a local database', async () => {
    await expect(ensureLocalCompanies(fakeDb([]), 'db.abcdefgh.supabase.co')).rejects.toThrow(/local/);
  });
  it('creates only the missing companies and sets addresses and status', async () => {
    const db = fakeDb([{ id: 'a7c0', slug: 'academy', hosts: [], status: 'active' }]);
    await ensureLocalCompanies(db, '127.0.0.1');
    expect(db.calls.filter((c) => c.includes('provision_company'))).toHaveLength(2);
    expect(db.rows.map((r) => [r.slug, r.hosts, r.status])).toEqual([
      ['academy', ['localhost', 'a.localhost'], 'active'],
      ['company-b', ['tenant2.localhost'], 'active'],
      ['paused', ['paused.localhost'], 'suspended'],
    ]);
  });
  it('a second run changes nothing', async () => {
    const db = fakeDb([]);
    await ensureLocalCompanies(db, 'localhost');
    const after = JSON.stringify(db.rows);
    db.calls.length = 0;
    await ensureLocalCompanies(db, 'localhost');
    expect(JSON.stringify(db.rows)).toBe(after);
    expect(db.calls.some((c) => c.includes('provision_company') || c.startsWith('update'))).toBe(false);
  });
});
