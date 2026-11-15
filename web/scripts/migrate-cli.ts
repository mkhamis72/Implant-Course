import './load-env';
import { migrate } from './migrate';
import { migrateTarget } from './migrate-target';
import { addLocalCompaniesAfterMigrate } from './dev-companies';

async function main() {
  // One database (merge of control into production, release 3): --tenant / --all-tenants / --control are refused.
  const target = migrateTarget(process.argv.slice(2), process.env);
  // Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
  console.log(`Target project: ${target.label}`);
  const applied = await migrate(target.dir, target.config);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  // A local stack also gets its companies' addresses (the app routes by public.companies); hosted: nothing.
  await addLocalCompaniesAfterMigrate(target.config, console.log);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
