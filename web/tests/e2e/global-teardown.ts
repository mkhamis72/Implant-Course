import '../../scripts/load-env';
import { assertSafeTestTarget } from '../../scripts/test-guard';
import { deactivateE2eCatalog, deleteE2ePatients } from './patients';

export default async function globalTeardown() {
  assertSafeTestTarget();
  await deleteE2ePatients();
  await deactivateE2eCatalog();
}
