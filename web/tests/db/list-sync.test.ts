import type { Client } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { withTx, asPostgres } from './helpers';
import { applyList, diffList, readSnapshot, type ControlAudit, type ControlCompany, type Snapshot } from '../../scripts/list-sync';

const control = (f: string) => readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', f), 'utf8');

async function provision(c: Client, slug: string, name: string): Promise<string> {
  await asPostgres(c);
  await c.query('set local role service_role');
  const { rows } = await c.query('select public.provision_company($1, $2) as id', [slug, name]);
  await asPostgres(c);
  return rows[0].id;
}

/** Production as it stands, as control would list it: every company, with its id. */
async function mirror(c: Client): Promise<ControlCompany[]> {
  const { rows } = await c.query('select id, slug, name, hosts, status from public.companies order by slug');
  return rows.map((r) => ({ slug: r.slug, name: r.name, hosts: r.hosts, status: r.status, company_id: r.id }));
}

function withRow(companies: ControlCompany[], slug: string, change: Partial<ControlCompany>): ControlCompany[] {
  return companies.map((r) => (r.slug === slug ? { ...r, ...change } : r));
}

const audit = (id: number, slug: string): ControlAudit => ({
  id, at: '2026-11-01 10:00:00+00', slug, action: 'update', actor: 'owner@example.com', reason: 'moved',
  before: { status: 'active' }, after: { status: 'suspended' },
});

const hostsOf = async (c: Client, id: string) =>
  (await c.query('select hosts from public.companies where id = $1', [id])).rows[0].hosts as string[];
const logCount = async (c: Client) => (await c.query('select count(*)::int as n from public.company_log')).rows[0].n as number;

describe('list:copy / list:compare', () => {
  it('reads the control list and history', async () => {
    await withTx(async (c) => {
      for (const f of ['0001_control_registry.sql', '0002_console.sql', '0003_console_log.sql', '0004_tenant_company.sql']) await c.query(control(f));
      await c.query(`insert into public.tenants (slug, name, hosts, supabase_url, anon_key, company_id)
        values ('zz-ctl', 'Zz Ctl', array['Zz-Ctl.Example.com'], 'https://abcdefgh.supabase.co', 'anon', 'a7c0de00-0000-4000-8000-0000000000ff')`);
      const s = await readSnapshot(c);
      expect(s.companies.find((r) => r.slug === 'zz-ctl')).toEqual({
        slug: 'zz-ctl', name: 'Zz Ctl', hosts: ['zz-ctl.example.com'], status: 'active', company_id: 'a7c0de00-0000-4000-8000-0000000000ff',
      });
      const entry = s.audit.find((r) => r.slug === 'zz-ctl');
      expect(entry).toMatchObject({ action: 'insert' });
      expect(typeof entry!.id).toBe('number');
    });
  });

  it('copies addresses and status and reports no difference afterwards', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      const s: Snapshot = { companies: withRow(await mirror(c), 'zz-a', { hosts: ['zz-a.imploid.net'], status: 'suspended' }), audit: [] };
      const result = await applyList(c, s);
      expect(result).toEqual({ updated: 1, skipped: [], auditAdded: 0 });
      expect((await c.query('select hosts, status from public.companies where id = $1', [id])).rows[0])
        .toEqual({ hosts: ['zz-a.imploid.net'], status: 'suspended' });
      expect(await diffList(c, s)).toEqual([]);
    });
  });

  it('cleans a control address before comparing', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      const s: Snapshot = { companies: withRow(await mirror(c), 'zz-a', { hosts: ['Zz-A.Imploid.net.:443'] }), audit: [] };
      await applyList(c, s);
      expect(await diffList(c, s)).toEqual([]);
    });
  });

  it('skips a control company without a company id and compare names it', async () => {
    await withTx(async (c) => {
      const extra: ControlCompany = { slug: 'zz-x', name: 'Zz X', hosts: ['zz-x.imploid.net'], status: 'active', company_id: null };
      const s: Snapshot = { companies: [...(await mirror(c)), extra], audit: [] };
      expect((await applyList(c, s)).skipped).toEqual(['zz-x']);
      expect(await diffList(c, s)).toEqual(['zz-x: no company id in control']);
    });
  });

  it('skips a control company that production does not have', async () => {
    await withTx(async (c) => {
      const extra: ControlCompany = { slug: 'zz-y', name: 'Zz Y', hosts: [], status: 'active', company_id: 'a7c0de00-0000-4000-8000-0000000000fe' };
      const s: Snapshot = { companies: [...(await mirror(c)), extra], audit: [] };
      expect((await applyList(c, s)).skipped).toEqual(['zz-y']);
      expect(await diffList(c, s)).toEqual(['zz-y: not in production']);
    });
  });

  it('is safe to run twice', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      const s: Snapshot = { companies: withRow(await mirror(c), 'zz-a', { hosts: ['zz-a.imploid.net'] }), audit: [audit(900000001, 'zz-a')] };
      await applyList(c, s);
      const logs = await logCount(c);
      expect(await applyList(c, s)).toEqual({ updated: 0, skipped: [], auditAdded: 0 });
      expect(await logCount(c)).toBe(logs);
    });
  });

  it('moves an address from one company to another', async () => {
    await withTx(async (c) => {
      const a = await provision(c, 'zz-a', 'Zz A');
      const b = await provision(c, 'zz-b', 'Zz B');
      await applyList(c, { companies: withRow(await mirror(c), 'zz-a', { hosts: ['zz-shared.imploid.net'] }), audit: [] });
      const moved = withRow(withRow(await mirror(c), 'zz-a', { hosts: [] }), 'zz-b', { hosts: ['zz-shared.imploid.net'] });
      await applyList(c, { companies: moved, audit: [] });
      expect(await hostsOf(c, a)).toEqual([]);
      expect(await hostsOf(c, b)).toEqual(['zz-shared.imploid.net']);
    });
  });

  it('frees the addresses of a production company that control no longer lists', async () => {
    await withTx(async (c) => {
      const a = await provision(c, 'zz-a', 'Zz A');
      const b = await provision(c, 'zz-b', 'Zz B');
      await applyList(c, { companies: withRow(await mirror(c), 'zz-a', { hosts: ['zz-shared.imploid.net'] }), audit: [] });
      const withoutA = withRow((await mirror(c)).filter((r) => r.slug !== 'zz-a'), 'zz-b', { hosts: ['zz-shared.imploid.net'] });
      await applyList(c, { companies: withoutA, audit: [] });
      expect(await hostsOf(c, a)).toEqual([]);
      expect(await hostsOf(c, b)).toEqual(['zz-shared.imploid.net']);
    });
  });

  it('swaps two addresses between companies in one copy', async () => {
    await withTx(async (c) => {
      const a = await provision(c, 'zz-a', 'Zz A');
      const b = await provision(c, 'zz-b', 'Zz B');
      await applyList(c, { companies: withRow(withRow(await mirror(c), 'zz-a', { hosts: ['zz-1.imploid.net'] }), 'zz-b', { hosts: ['zz-2.imploid.net'] }), audit: [] });
      await applyList(c, { companies: withRow(withRow(await mirror(c), 'zz-a', { hosts: ['zz-2.imploid.net'] }), 'zz-b', { hosts: ['zz-1.imploid.net'] }), audit: [] });
      expect(await hostsOf(c, a)).toEqual(['zz-2.imploid.net']);
      expect(await hostsOf(c, b)).toEqual(['zz-1.imploid.net']);
    });
  });

  it('writes no change-log entries of its own', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      const logs = await logCount(c);
      await applyList(c, { companies: withRow(await mirror(c), 'zz-a', { hosts: ['zz-a.imploid.net'], status: 'suspended' }), audit: [] });
      expect(await logCount(c)).toBe(logs);
    });
  });

  it('copies history once, keeping time, actor and reason', async () => {
    await withTx(async (c) => {
      const s: Snapshot = { companies: await mirror(c), audit: [audit(900000001, 'zz-a'), audit(900000002, 'zz-a')] };
      expect((await applyList(c, s)).auditAdded).toBe(2);
      const rows = (await c.query(`select at, actor, reason, before, after from public.company_log where source_id = 900000001`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor: 'owner@example.com', reason: 'moved', before: { status: 'active' }, after: { status: 'suspended' } });
      expect(new Date(rows[0].at).toISOString()).toBe('2026-11-01T10:00:00.000Z');
      expect((await applyList(c, s)).auditAdded).toBe(0);
    });
  });

  it('reports history that has not been copied yet', async () => {
    await withTx(async (c) => {
      const s: Snapshot = { companies: await mirror(c), audit: [audit(900000003, 'zz-a')] };
      expect(await diffList(c, s)).toEqual(['history: 1 control rows missing in production']);
    });
  });

  it('reports a production company that control does not know', async () => {
    await withTx(async (c) => {
      const before = await mirror(c);
      await provision(c, 'zz-only', 'Zz Only');
      expect(await diffList(c, { companies: before, audit: [] })).toEqual(['zz-only: not in control']);
    });
  });

  it('reports a different address, status or slug', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      const companies = withRow(await mirror(c), 'zz-a', { slug: 'zz-a-ctl', hosts: ['zz-a.imploid.net'], status: 'suspended' });
      expect(await diffList(c, { companies, audit: [] })).toEqual([
        'zz-a-ctl: slug differs (production: zz-a)',
        'zz-a-ctl: addresses differ (control: zz-a.imploid.net; production: none)',
        'zz-a-ctl: status differs (control: suspended; production: active)',
      ]);
    });
  });

  it('does not change slug or name', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await applyList(c, { companies: withRow(await mirror(c), 'zz-a', { slug: 'zz-other', name: 'Other' }), audit: [] });
      expect((await c.query('select slug, name from public.companies where id = $1', [id])).rows[0]).toEqual({ slug: 'zz-a', name: 'Zz A' });
    });
  });
});
