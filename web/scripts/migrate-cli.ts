import './load-env';
import { migrate } from './migrate';
import { migrateTarget } from './migrate-target';
import { migrateAllTenants, checkAllTenantsArgs, checkTargetArgs } from './migrate-all';
import { applyTenantArg, loadCompanies } from './tenant-env';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--all-tenants')) {
    checkAllTenantsArgs(argv);
    const companies = await loadCompanies(process.env, console.log);
    await migrateAllTenants(companies, process.env.CONTROL_DATABASE_CA_CERT ?? process.env.DATABASE_CA_CERT, migrate, console.log);
    return;
  }
  checkTargetArgs(argv);
  const { argv: rest, label } = await applyTenantArg(argv, process.env);
  const target = migrateTarget(rest, process.env);
  // Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
  console.log(`Target project: ${label ?? target.label}`);
  const applied = await migrate(target.dir, target.config);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
