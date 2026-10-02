import './load-env';
import { migrate } from './migrate';
import { targetLabel } from './create-user-args';

// Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);

migrate()
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
