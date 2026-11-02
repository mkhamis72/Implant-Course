import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

/** The connection config for the target: a hosted host needs DATABASE_CA_CERT from the same env. */
export const clientConfig = (env: NodeJS.ProcessEnv) => pgConfig(env);

export type TableCount = { table: string; rows: number; nullCompany: number; otherCompany: number };
export type Totals = { companies: number; members: number; profiles: number };

/** Pure: pass only if every company table row names the academy and every profile has its company_members row. */
export function evaluateCheck(tables: TableCount[], totals: Totals): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const t of tables) {
    if (t.nullCompany) problems.push(`${t.table}: ${t.nullCompany} rows with null company_id`);
    if (t.otherCompany) problems.push(`${t.table}: ${t.otherCompany} rows of another company`);
  }
  if (totals.members !== totals.profiles) problems.push(`company_members has ${totals.members} rows but profiles has ${totals.profiles}`);
  return { ok: problems.length === 0, problems };
}

async function main() {
  await applyTenantArg(process.argv.slice(2), process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  console.log(`Target project: ${new URL(url).hostname}`);
  const c = new Client(clientConfig(process.env));
  await c.connect();
  try {
    await c.query('begin read only');
    const academy = (await c.query("select id from public.companies where slug = 'academy'")).rows[0]?.id as string | undefined;
    if (!academy) throw new Error("No 'academy' company row");
    const names = (await c.query("select t::text as name from app.company_tables() as t order by 1")).rows.map((r) => r.name as string);
    const tables: TableCount[] = [];
    for (const name of names) {
      const { rows } = await c.query(
        `select count(*)::int as rows, count(*) filter (where company_id is null)::int as nulls,
                count(*) filter (where company_id <> $1)::int as other from ${name}`,
        [academy],
      );
      tables.push({ table: name, rows: rows[0].rows, nullCompany: rows[0].nulls, otherCompany: rows[0].other });
    }
    const t = (await c.query('select (select count(*) from public.companies)::int as companies, (select count(*) from public.company_members)::int as members, (select count(*) from public.profiles)::int as profiles')).rows[0] as Totals;
    for (const r of tables) console.log(`${r.table}: rows ${r.rows}, null company_id ${r.nullCompany}, other company ${r.otherCompany}`);
    console.log(`companies ${t.companies}, company_members ${t.members}, profiles ${t.profiles}`);
    const result = evaluateCheck(tables, t);
    for (const p of result.problems) console.log(`PROBLEM ${p}`);
    console.log(result.ok ? 'PASS' : 'FAIL');
    await c.query('rollback');
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && /one-db-check\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
