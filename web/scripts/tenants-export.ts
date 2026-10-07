import './load-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { envFileText, loadCompanies, type Company } from './tenant-env';
import { migrateTarget } from './migrate-target';

/**
 * For the backup workflow: one bash-sourceable file per company in --dir (mode 600, runner temp only,
 * never uploaded). Holds only what a dump and the keep-awake ping need; no service keys.
 */
export function exportFiles(companies: Company[]): { file: string; text: string }[] {
  return companies.map(({ tenant, secrets }) => ({
    file: `${tenant.slug}.env`,
    text: envFileText({ SLUG: tenant.slug, DATABASE_URL: secrets.databaseUrl, SUPABASE_URL: tenant.supabase_url, ANON_KEY: tenant.anon_key }),
  }));
}

async function main() {
  const i = process.argv.indexOf('--dir');
  const dir = i > -1 ? process.argv[i + 1] : undefined;
  if (!dir) throw new Error('Usage: npm run tenants:export -- --dir <directory>');
  console.log(`Target project: ${migrateTarget(['--control'], process.env).label}`);
  const companies = await loadCompanies(process.env, console.log);
  if (!companies.length) throw new Error('No companies in the control project.');
  mkdirSync(dir, { recursive: true });
  for (const f of exportFiles(companies)) writeFileSync(path.join(dir, f.file), f.text, { mode: 0o600 });
  console.log(`Exported ${companies.length} companies: ${companies.map((c) => c.tenant.slug).join(', ')}`);
}

if (process.argv[1]?.endsWith('tenants-export.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
