import path from 'node:path';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { companyLabel, tenantEnvFrom, type Company } from './tenant-env';

/** Throws if `--all-tenants` appears with any other flag. */
export function checkAllTenantsArgs(argv: string[]): void {
  if (argv.includes('--all-tenants') && argv.length > 1) {
    throw new Error('Use --all-tenants on its own.');
  }
}

/** Throws if `--tenant` and `--control` are both given (they name different projects). */
export function checkTargetArgs(argv: string[]): void {
  const tenant = argv.some((a) => a === '--tenant' || a.startsWith('--tenant='));
  if (tenant && argv.includes('--control')) throw new Error('Use --tenant or --control, not both.');
}

/** Applies the app migrations to every company in turn; the first failure stops the run (nothing is deployed). */
export async function migrateAllTenants(
  companies: Company[],
  caPath: string | undefined,
  run: (dir: string, config: ClientConfig) => Promise<string[]>,
  log: (line: string) => void,
): Promise<void> {
  if (!companies.length) throw new Error('No companies in the control project.');
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  for (const company of companies) {
    log(`Target project: ${companyLabel(company.tenant)}`);
    let applied: string[];
    try {
      applied = await run(dir, pgConfig(tenantEnvFrom(company, caPath)));
    } catch (error) {
      throw new Error(`Company ${company.tenant.slug}: ${(error as Error).message}`);
    }
    log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  }
}
