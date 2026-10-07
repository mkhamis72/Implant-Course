import './load-env';
import { migrate } from './migrate';
import { migrateTarget } from './migrate-target';

const target = migrateTarget(process.argv.slice(2), process.env);
// Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
console.log(`Target project: ${target.label}`);

migrate(target.dir, target.config)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
