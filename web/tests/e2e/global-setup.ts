import '../../scripts/load-env';
import { migrate } from '../../scripts/migrate';
import { assertSafeTestTarget } from '../../scripts/test-guard';
import { ensureTestUsers } from '../support/test-users';

export default async function globalSetup() {
  assertSafeTestTarget();
  await migrate();
  await ensureTestUsers();
}
