import './load-env';
import { withControl } from './tenant-env';

/**
 * Release 3, before shipping: control migration 0004 gives academy's company id to the tenant whose slug
 * is `academy`, so that slug must exist. Read-only (`begin read only`); prints slugs and company ids only.
 *   ENV_FILE=.env.prod NODE_PATH=node_modules npx tsx scripts/control-tenants-check.ts
 */
export const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

export type TenantCompany = { slug: string; companyId: string | null | undefined };

/** Pure: pass when a tenant `academy` exists and, once 0004 has run, carries academy's company (or none yet). */
export function evaluateControlTenants(rows: TenantCompany[]): { ok: boolean; problems: string[] } {
  const academy = rows.find((r) => r.slug === 'academy');
  if (!academy) return { ok: false, problems: ["No tenant with slug 'academy': control 0004 would leave every company without a company id (503)"] };
  if (academy.companyId != null && academy.companyId !== ACADEMY_ID) {
    return { ok: false, problems: [`Tenant 'academy' has company ${academy.companyId}, not ${ACADEMY_ID}`] };
  }
  return { ok: true, problems: [] };
}

async function main() {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not set');
  console.log(`Target project: ${new URL(url).hostname}`);
  await withControl(process.env, async (c) => {
    await c.query('begin read only');
    try {
      // Before release 3 the column does not exist yet (control 0004 adds it).
      const hasColumn = (
        await c.query(
          "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'company_id'",
        )
      ).rowCount;
      const { rows } = await c.query(`select slug, ${hasColumn ? 'company_id' : 'null::uuid as company_id'} from public.tenants order by slug`);
      const tenants = rows.map((r) => ({ slug: r.slug as string, companyId: hasColumn ? (r.company_id as string | null) : undefined }));
      for (const t of tenants) console.log(`${t.slug}: ${t.companyId === undefined ? '(no company_id column yet)' : (t.companyId ?? 'null')}`);
      const result = evaluateControlTenants(tenants);
      for (const p of result.problems) console.log(`PROBLEM ${p}`);
      console.log(result.ok ? 'PASS' : 'FAIL');
      process.exitCode = result.ok ? 0 : 1;
    } finally {
      await c.query('rollback');
    }
  });
}

if (process.argv[1] && /control-tenants-check\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
