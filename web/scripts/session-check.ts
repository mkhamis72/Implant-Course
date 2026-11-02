import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

export type SessionCount = { companyId: string; rows: number };

/** Pure: pass only if every bound session belongs to the academy. No rows at all is fine (nobody signed in yet). */
export function evaluateSessions(counts: SessionCount[], academyId: string): { ok: boolean; problems: string[] } {
  const problems = counts
    .filter((c) => c.companyId !== academyId && c.rows > 0)
    .map((c) => `app.session_companies: ${c.rows} rows of company ${c.companyId}`);
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
    const academy = (await c.query("select id from public.companies where slug = 'academy'")).rows[0]?.id as string | undefined;
    if (!academy) throw new Error("No 'academy' company row");
    const counts = (
      await c.query('select company_id, count(*)::int as rows from app.session_companies group by company_id order by 1')
    ).rows.map((r) => ({ companyId: r.company_id as string, rows: r.rows as number }));
    for (const r of counts) console.log(`${r.companyId === academy ? 'academy' : r.companyId}: ${r.rows} sessions`);
    if (!counts.length) console.log('no bound sessions yet');
    const result = evaluateSessions(counts, academy);
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
