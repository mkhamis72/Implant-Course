import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { targetLabel } from './create-user-args';
import { takeCompanyArg } from './one-database';

/**
 * Company isolation check: can a signed-in admin of one company see any row of another? For every pair of active
 * companies (both ways; `--company <slug>` limits it to that company's pairs) it acts as an active admin of the
 * viewing company exactly as PostgREST does (role authenticated, JWT claims with a live Self-Auth session at aal2,
 * the session bound with bind_my_session), and counts the other company's rows in every company table. Each pair is
 * one transaction that is always rolled back: the session it makes is never saved and nothing changes.
 * No passwords or Self-Auth secrets: it needs only the database (ENV_FILE). Expect 0 everywhere, and the viewer's
 * own settings row visible (otherwise the session was not bound and the zeros prove nothing).
 */

export type TableCount = { table: string; visible: number | null; present: number; errorCode?: string; errorMessage?: string };
export type PairResult = { counts: TableCount[]; ownSettings: number; skipped?: string };
export type PairReport = { ok: boolean; lines: string[]; problems: string[] };
type Db = Pick<Client, 'query'>;

/** Pure: the verdict for one pair. A table closed to signed-in users (42501) shows nothing, which is fine. */
export function evaluatePair(viewer: string, target: string, counts: TableCount[], ownSettings: number): PairReport {
  const problems: string[] = [];
  const lines: string[] = [];
  if (!counts.length) problems.push('no company tables were checked');
  for (const r of [...counts].sort((a, b) => a.table.localeCompare(b.table))) {
    if (r.visible === null) {
      if (r.errorCode === '42501') {
        lines.push(`${r.table}: closed to signed-in users`);
      } else {
        lines.push(`${r.table}: ERROR ${r.errorCode ?? ''}`.trimEnd());
        problems.push(`${r.table}: the query failed (${r.errorCode ?? 'no code'}${r.errorMessage ? `: ${r.errorMessage}` : ''})`);
      }
    } else {
      lines.push(`${r.table}: ${r.visible} of ${r.present} ${target} rows visible`);
      if (r.visible > 0) problems.push(`${r.table}: ${r.visible} of ${r.present} ${target} rows visible to a ${viewer} admin`);
    }
  }
  if (ownSettings < 1) {
    problems.push(`a ${viewer} admin does not see its own settings row: the session is not bound, so the zeros prove nothing`);
  }
  return { ok: problems.length === 0, lines, problems };
}

/** Pure: [viewer, target] pairs, every company against every other, both ways; `only` keeps the pairs it is in. */
export function pairsToCheck(slugs: string[], only?: string | null): [string, string][] {
  if (slugs.length < 2) throw new Error('The isolation check needs at least two companies.');
  if (only && !slugs.includes(only)) throw new Error(`Unknown company: ${only}`);
  const pairs: [string, string][] = [];
  for (const a of slugs) for (const b of slugs) if (a !== b && (!only || a === only || b === only)) pairs.push([a, b]);
  return pairs;
}

const companyId = async (c: Db, slug: string): Promise<string> => {
  const id = (await c.query('select id from public.companies where slug = $1', [slug])).rows[0]?.id as string | undefined;
  if (!id) throw new Error(`Unknown company: ${slug}`);
  return id;
};

/** One pair, in one transaction that is always rolled back. `viewer === target` is the control run (rows visible). */
export async function checkPair(c: Db, viewer: string, target: string): Promise<PairResult> {
  await c.query('begin');
  try {
    const viewerId = await companyId(c, viewer);
    const targetId = await companyId(c, target);
    const admin = (await c.query(
      `select m.user_id from public.company_members m join self_auth."user" u on u.id = m.user_id
       where m.company_id = $1 and m.role = 'admin' and m.active and not m.mfa_setup_required
       order by m.created_at limit 1`, [viewerId])).rows[0]?.user_id as string | undefined;
    if (!admin) return { counts: [], ownSettings: 0, skipped: `${viewer} has no active admin who can sign in yet` };
    const tables = (await c.query(
      `select c.relname as name from app.company_tables() t join pg_class c on c.oid = t
       where c.relnamespace = 'public'::regnamespace order by 1`)).rows.map((r) => r.name as string);
    // As postgres (bypasses RLS): how many of the target's rows each table holds, so a 0 below means something.
    const present = new Map<string, number>();
    for (const t of tables) present.set(t, (await c.query(`select count(*)::int n from public.${t} where company_id = $1`, [targetId])).rows[0].n);
    const session = (await c.query(
      `insert into self_auth.session ("expiresAt", token, "updatedAt", "userId", aal)
       values (now() + interval '5 minutes', gen_random_uuid()::text, now(), $1, 'aal2') returning id`, [admin])).rows[0].id as string;
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: admin, role: 'authenticated', session_id: session, aal: 'aal2' })]);
    await c.query('set local role authenticated');
    await c.query('select public.bind_my_session($1)', [viewerId]);
    const ownSettings = (await c.query('select count(*)::int n from public.settings where company_id = $1', [viewerId])).rows[0].n as number;
    const counts: TableCount[] = [];
    for (const t of tables) {
      await c.query('savepoint isolation_table');
      try {
        const n = (await c.query(`select count(*)::int n from public.${t} where company_id = $1`, [targetId])).rows[0].n as number;
        await c.query('release savepoint isolation_table');
        counts.push({ table: t, visible: n, present: present.get(t) ?? 0 });
      } catch (e) {
        await c.query('rollback to savepoint isolation_table');
        const err = e as { code?: string; message?: string };
        counts.push({ table: t, visible: null, present: present.get(t) ?? 0, errorCode: err.code, errorMessage: err.message });
      }
    }
    return { counts, ownSettings };
  } finally {
    await c.query('rollback').catch(() => undefined);
  }
}

async function main() {
  const { slug: only } = takeCompanyArg(process.argv.slice(2));
  const cfg = pgConfig();
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const c = new Client(cfg);
  await c.connect();
  let failed = 0;
  let checked = 0;
  try {
    const slugs = (await c.query("select slug from public.companies where status = 'active' order by slug")).rows.map((r) => r.slug as string);
    for (const [viewer, target] of pairsToCheck(slugs, only)) {
      const r = await checkPair(c, viewer, target);
      if (r.skipped) {
        console.log(`SKIPPED ${viewer} → ${target}: ${r.skipped}`);
        continue;
      }
      checked += 1;
      const report = evaluatePair(viewer, target, r.counts, r.ownSettings);
      const withRows = r.counts.filter((x) => x.present > 0).length;
      console.log(`${report.ok ? 'PASS' : 'FAIL'} ${viewer} → ${target}: ${r.counts.length} tables, ${withRows} holding ${target} rows, own settings visible: ${r.ownSettings}`);
      for (const p of report.problems) console.log(`  PROBLEM ${p}`);
      if (!report.ok) failed += 1;
    }
  } finally {
    await c.end();
  }
  if (!checked) {
    console.log('FAIL: no pair could be checked');
    process.exitCode = 1;
    return;
  }
  console.log(failed ? `FAIL: ${failed} of ${checked} pairs` : `PASS: ${checked} pairs, no company sees another's rows`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/isolation-check.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
