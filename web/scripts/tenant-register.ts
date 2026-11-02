import './load-env';
import { Client } from 'pg';
import { migrateTarget } from './migrate-target';
import { checkTenant, nullCompanyWarning, parseRegisterArgs, registerTenant, tenantCompanyId } from './tenants';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in the ENV_FILE`);
  return v;
}

async function main() {
  const args = parseRegisterArgs(process.argv.slice(2));
  const company = {
    ...args,
    supabaseUrl: need('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    databaseUrl: need('DATABASE_URL'),
  };
  const target = migrateTarget(['--control'], process.env);
  console.log(`Target project: ${target.label}; company ${args.slug} → ${new URL(company.supabaseUrl).host}`);
  const problems = await checkTenant(company);
  if (problems.length) throw new Error(`Not registered:\n- ${problems.join('\n- ')}`);
  const c = new Client(target.config);
  await c.connect();
  try {
    await c.query('begin');
    await registerTenant(c, company);
    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    await c.end();
  }
  console.log(`Registered ${args.slug}: ${args.hosts.join(', ')}`);
  if (warning) console.warn(warning);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
