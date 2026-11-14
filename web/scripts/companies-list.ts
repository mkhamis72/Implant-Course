import { Client } from 'pg';

type Db = { query(sql: string): Promise<{ rows: unknown[] }> };

/**
 * Every company's slug, one per line (ordered), for the Backup workflow's per-company exports. Nothing else goes
 * to stdout: the workflow reads it as a list.
 */
export async function companySlugs(db: Db): Promise<string> {
  const { rows } = await db.query('select slug from public.companies order by slug');
  if (!rows.length) throw new Error('No companies in this database');
  return (rows as { slug: string }[]).map((r) => `${r.slug}\n`).join('');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/companies-list.ts')) {
  (async () => {
    await import('./load-env');
    const { pgConfig } = await import('./db');
    const c = new Client(pgConfig());
    await c.connect();
    try {
      await c.query('begin read only');
      process.stdout.write(await companySlugs(c));
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
