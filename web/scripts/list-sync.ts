import type { Client } from 'pg';

/**
 * Merge of the control project into production, release 1 (docs/superpowers/specs/
 * 2026-11-14-merge-control-into-production-design.md): bring the company list (addresses, status) and its
 * history from the control project into production's companies / company_log (0104), and tell whether the two
 * agree. Functions take connected clients; the caller owns the transactions (scripts/list-sync-cli.ts).
 */
export type ControlCompany = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; company_id: string | null };
export type ControlAudit = { id: number; at: string; slug: string; action: string; actor: string; reason: string | null; before: unknown; after: unknown };
export type Snapshot = { companies: ControlCompany[]; audit: ControlAudit[] };

type ProdCompany = { id: string; slug: string; hosts: string[]; status: string };

/** As 0104's companies_list_normalise (and control's tenants_normalise): lower case, no port, no trailing dot. */
export function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

const cleanHosts = (hosts: string[]): string[] => [...new Set(hosts.map(cleanHost))].sort();
const sameSet = (a: string[], b: string[]) => {
  const x = cleanHosts(a);
  const y = cleanHosts(b);
  return x.length === y.length && x.every((h, i) => h === y[i]);
};

export async function readSnapshot(control: Client): Promise<Snapshot> {
  const companies = (await control.query<ControlCompany>(
    'select slug, name, hosts, status, company_id from public.tenants order by slug')).rows;
  const audit = (await control.query<ControlAudit>(
    `select id::int as id, at::text as at, slug, action, actor, reason, before, after from public.tenant_audit order by id`)).rows;
  return { companies, audit };
}

async function production(prod: Client): Promise<ProdCompany[]> {
  return (await prod.query<ProdCompany>('select id, slug, hosts, status from public.companies order by slug')).rows;
}

/** Copies addresses, status and history into production. Never changes a slug or a name. */
export async function applyList(prod: Client, s: Snapshot): Promise<{ updated: number; skipped: string[]; auditAdded: number }> {
  await prod.query(`select set_config('app.list_copy', 'on', true)`);
  const byId = new Map((await production(prod)).map((p) => [p.id, p]));
  const skipped: string[] = [];
  const want = new Map<string, { hosts: string[]; status: string }>();
  for (const r of s.companies) {
    if (!r.company_id || !byId.has(r.company_id)) skipped.push(r.slug);
    else want.set(r.company_id, { hosts: cleanHosts(r.hosts), status: r.status });
  }

  // First take away the addresses a company should no longer hold, so one can move to another company. A
  // production company that control does not list (diffList reports it) holds none.
  for (const [id, p] of byId) {
    const current = p.hosts;
    const kept = current.filter((h) => want.get(id)?.hosts.includes(h));
    if (kept.length !== current.length) await prod.query('update public.companies set hosts = $2 where id = $1', [id, kept]);
  }
  let updated = 0;
  for (const [id, w] of want) {
    const p = byId.get(id)!;
    if (sameSet(p.hosts, w.hosts) && p.status === w.status) continue;
    await prod.query('update public.companies set hosts = $2, status = $3 where id = $1', [id, w.hosts, w.status]);
    updated++;
  }

  let auditAdded = 0;
  for (const a of s.audit) {
    const res = await prod.query(
      `insert into public.company_log (at, slug, action, actor, reason, before, after, source_id)
       values ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8) on conflict (source_id) do nothing`,
      [a.at, a.slug, a.action, a.actor, a.reason, a.before === null ? null : JSON.stringify(a.before),
        a.after === null ? null : JSON.stringify(a.after), a.id]);
    auditAdded += res.rowCount ?? 0;
  }
  return { updated, skipped: skipped.sort(), auditAdded };
}

/** One line per difference between control and production; [] when they agree. */
export async function diffList(prod: Client, s: Snapshot): Promise<string[]> {
  const prodRows = await production(prod);
  const byId = new Map(prodRows.map((p) => [p.id, p]));
  const lines: string[] = [];
  for (const r of s.companies) {
    if (!r.company_id) {
      lines.push(`${r.slug}: no company id in control`);
      continue;
    }
    const p = byId.get(r.company_id);
    if (!p) {
      lines.push(`${r.slug}: not in production`);
      continue;
    }
    if (p.slug !== r.slug) lines.push(`${r.slug}: slug differs (production: ${p.slug})`);
    if (!sameSet(r.hosts, p.hosts)) {
      const show = (h: string[]) => cleanHosts(h).join(', ') || 'none';
      lines.push(`${r.slug}: addresses differ (control: ${show(r.hosts)}; production: ${show(p.hosts)})`);
    }
    if (p.status !== r.status) lines.push(`${r.slug}: status differs (control: ${r.status}; production: ${p.status})`);
  }
  const known = new Set(s.companies.map((r) => r.company_id).filter(Boolean));
  for (const p of prodRows) if (!known.has(p.id)) lines.push(`${p.slug}: not in control`);
  if (s.audit.length) {
    const { rows } = await prod.query<{ n: number }>(
      'select count(*)::int as n from unnest($1::bigint[]) as u(src) where not exists (select 1 from public.company_log l where l.source_id = u.src)',
      [s.audit.map((a) => a.id)]);
    if (rows[0].n > 0) lines.push(`history: ${rows[0].n} control rows missing in production`);
  }
  return lines;
}
