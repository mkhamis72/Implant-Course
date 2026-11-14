import { Client, type ClientConfig } from 'pg';
import { isLocalHost } from './test-guard';

/**
 * The companies of a local stack and their addresses (merge of control into production, release 3): the app reads
 * its company list from public.companies, so local development and the E2E tests need these rows. `npm run
 * db:migrate` on a local stack adds them; `npm run dev:companies` does only that.
 */
export const LOCAL_COMPANIES = [
  { slug: 'academy', name: 'Academy', hosts: ['localhost', 'a.localhost'], status: 'active' },
  { slug: 'company-b', name: 'Company B', hosts: ['tenant2.localhost'], status: 'active' },
  { slug: 'paused', name: 'Paused Co', hosts: ['paused.localhost'], status: 'suspended' },
] as const;

type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };
type Row = { slug: string; hosts: string[] | null; status: string };

/** Creates the missing local companies (provision_company) and sets their addresses and status. Local only. */
export async function ensureLocalCompanies(db: Db, databaseHost: string, log: (line: string) => void = () => {}): Promise<void> {
  if (!isLocalHost(databaseHost)) throw new Error(`Refusing to add local companies to ${databaseHost}: local stacks only.`);
  const rows = (await db.query('select slug, hosts, status from public.companies')).rows as Row[];
  for (const c of LOCAL_COMPANIES) {
    const row = rows.find((r) => r.slug === c.slug);
    if (!row) {
      await db.query('select public.provision_company($1, $2)', [c.slug, c.name]);
      log(`Added company ${c.slug}`);
    }
    const same = row && row.status === c.status && JSON.stringify(row.hosts ?? []) === JSON.stringify(c.hosts);
    if (!same) {
      await db.query('update public.companies set hosts = $2, status = $3 where slug = $1', [c.slug, [...c.hosts], c.status]);
      log(`${c.slug}: ${c.hosts.join(', ')} (${c.status})`);
    }
  }
}

/** Adds the local companies to the database a local migration just ran on (no-op for hosted databases). */
export async function addLocalCompaniesAfterMigrate(config: ClientConfig, log: (line: string) => void): Promise<void> {
  const host = config.connectionString ? new URL(config.connectionString).hostname : String(config.host ?? '');
  if (!isLocalHost(host)) return;
  const db = new Client(config);
  await db.connect();
  try {
    await ensureLocalCompanies(db, host, log);
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/dev-companies.ts')) {
  (async () => {
    await import('./load-env');
    const { pgConfig } = await import('./db');
    const config = pgConfig();
    const host = new URL(String(config.connectionString)).hostname;
    if (!isLocalHost(host)) throw new Error(`Refusing to add local companies to ${host}: local stacks only.`);
    await addLocalCompaniesAfterMigrate(config, console.log);
    console.log("Local companies ready: localhost / a.localhost = academy, tenant2.localhost = company-b, paused.localhost = suspended (b.localhost belongs to the isolation specs).");
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
