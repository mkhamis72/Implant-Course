import '../../scripts/load-env';
import { migrate } from '../../scripts/migrate';
import { ensureTestUsers } from '../support/test-users';

export default async function globalSetup() {
  await migrate();
  await ensureTestUsers();
}
