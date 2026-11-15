import { describe, expect, it } from 'vitest';
import * as migrateModule from './migrate';

describe('migrate', () => {
  it('has no hold list: every migration file applies in order (Migration B, 0103, is applied everywhere)', () => {
    expect(Object.keys(migrateModule).filter((k) => /held|SELF_AUTH_B/i.test(k))).toEqual([]);
  });
});
