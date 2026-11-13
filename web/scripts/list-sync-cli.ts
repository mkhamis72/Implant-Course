import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { listTenants, tenantEnvFrom, tenantSecrets, withControl } from './tenant-env';
import { applyList, diffList, readSnapshot, type Snapshot } from './list-sync';
import { ACADEMY_COMPANY_ID } from '../src/lib/tenant/types';

/**
 * npm run list:copy     copy the company list (addresses, status) and its history from control into production
 * npm run list:compare  print every difference between the two; exit 1 if there is any
 * Reads CONTROL_DATABASE_URL (and DATABASE_CA_CERT for hosted projects) from ENV_FILE. Production is the shared
 * database: the one academy's company (ACADEMY_COMPANY_ID, whatever its slug in control) is on. Prints hosts
 * and counts only, never keys or URLs.
 */

async function main(mode: string) {
  if (mode !== 'copy' && mode !== 'compare') throw new Error('Usage: list-sync-cli.ts copy|compare');
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not set');
  console.log(`Target project: ${new URL(url).hostname} (control)`);
  await withControl(process.env, async (control) => {
    await control.query('begin isolation level repeatable read read only');
    let snapshot: Snapshot;
    try {
      snapshot = await readSnapshot(control);
    } finally {
      await control.query('rollback');
    }
    const shared = snapshot.companies.find((c) => c.company_id === ACADEMY_COMPANY_ID)?.slug;
    const tenant = (await listTenants(control)).find((t) => t.slug === shared);
    if (!tenant) throw new Error("The control project lists no company with academy's company id (the shared database)");
    const env = tenantEnvFrom({ tenant, secrets: await tenantSecrets(control, tenant.slug) }, process.env.DATABASE_CA_CERT);
    console.log(`Target project: ${new URL(tenant.supabase_url).hostname} (production)`);

    const prod = new Client(pgConfig(env));
    await prod.connect();
    try {
      if (mode === 'copy') {
        await prod.query('begin');
        try {
          const r = await applyList(prod, snapshot);
          await prod.query('commit');
          console.log(`Copied: ${r.updated} companies changed, ${r.auditAdded} history rows added.`);
          if (r.skipped.length) {
            console.log(`Not copied (no company id in control, or no such company in production): ${r.skipped.join(', ')}`);
            process.exitCode = 1;
          }
        } catch (e) {
          await prod.query('rollback');
          throw e;
        }
      } else {
        await prod.query('begin read only');
        try {
          const lines = await diffList(prod, snapshot);
          for (const l of lines) console.log(`DIFFERENT ${l}`);
          console.log(`${lines.length} differences`);
          process.exitCode = lines.length ? 1 : 0;
        } finally {
          await prod.query('rollback');
        }
      }
    } finally {
      await prod.end();
    }
  });
}

if (process.argv[1] && /list-sync-cli\.ts$/.test(process.argv[1])) {
  main(process.argv[2] ?? '').catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
