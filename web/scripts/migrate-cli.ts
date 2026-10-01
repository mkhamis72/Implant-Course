import './load-env';
import { migrate } from './migrate';

migrate()
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
