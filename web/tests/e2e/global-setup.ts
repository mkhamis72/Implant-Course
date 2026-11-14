import '../../scripts/load-env';
import { migrate } from '../../scripts/migrate';
import { addLocalCompaniesAfterMigrate } from '../../scripts/dev-companies';
import { pgConfig } from '../../scripts/db';
import { assertSafeTestTarget } from '../../scripts/test-guard';
import { ensureTestUsers } from '../support/test-users';

export default async function globalSetup() {
  assertSafeTestTarget();
  await migrate();
  // The app routes by public.companies: localhost / a.localhost = academy, paused.localhost = suspended (dev-companies).
  await addLocalCompaniesAfterMigrate(pgConfig(), () => {});
  await ensureTestUsers();
}
