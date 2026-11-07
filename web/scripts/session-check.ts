import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

/** Bound sessions of one company: all of them, and those whose user has no membership in that company. */
export type SessionCount = { company: string; rows: number; strays: number };

/**
 * Pure: pass only if every bound session belongs to a member of the company it is bound to. Several companies are
 * fine (one login may belong to several); no rows at all is fine too (nobody signed in yet).
 */
export function evaluateSessions(counts: SessionCount[]): { ok: boolean; problems: string[] } {
  const problems = counts
    .filter((c) => c.strays > 0)
    .map((c) => `app.session_companies: ${c.strays} of ${c.rows} sessions of ${c.company} belong to a user who is not its member`);
  return { ok: problems.length === 0, problems };
}

async function main() {
  await applyTenantArg(process.argv.slice(2), process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  console.log(`Target project: ${new URL(url).hostname}`);
  const c = new Client(pgConfig(process.env));
  await c.connect();
  try {
    await c.query('begin read only');
    const counts = (
      await c.query(`
        select coalesce(co.slug, s.company_id::text) as company, count(*)::int as rows,
               count(*) filter (where not exists (
                 select 1 from public.company_members m where m.company_id = s.company_id and m.user_id = s.user_id))::int as strays
          from app.session_companies s left join public.companies co on co.id = s.company_id
         group by 1 order by 1`)
    ).rows.map((r) => ({ company: r.company as string, rows: r.rows as number, strays: r.strays as number }));
    for (const r of counts) console.log(`${r.company}: ${r.rows} sessions`);
    if (!counts.length) console.log('no bound sessions yet');
    const result = evaluateSessions(counts);
    for (const p of result.problems) console.log(`PROBLEM ${p}`);
    console.log(result.ok ? 'PASS' : 'FAIL');
    await c.query('rollback');
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && /session-check\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
