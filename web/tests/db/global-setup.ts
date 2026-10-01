import '../../scripts/load-env';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../scripts/migrate';
import { assertSafeTestTarget } from '../../scripts/test-guard';
import { ensureTestUsers, type TestUserIds } from '../support/test-users';

declare module 'vitest' {
  export interface ProvidedContext {
    testUsers: TestUserIds;
  }
}

export default async function setup(project: TestProject) {
  assertSafeTestTarget();
  await migrate();
  project.provide('testUsers', await ensureTestUsers());
}
