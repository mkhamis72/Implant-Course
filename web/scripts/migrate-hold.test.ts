import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { heldMigrations, SELF_AUTH_B_FILES } from './migrate';

describe('Migration B hold list', () => {
  it('migration_b_held_by_default', () => {
    for (const env of [{}, { SELF_AUTH_B_HOLD: '' }, { SELF_AUTH_B_HOLD: '1' }, { SELF_AUTH_B_HOLD: 'false' }, { SELF_AUTH_B_HOLD: 'off' }]) {
      expect([...heldMigrations(env)].sort()).toEqual([...SELF_AUTH_B_FILES].sort());
    }
  });

  it('releases Migration B only when SELF_AUTH_B_HOLD is exactly 0', () => {
    expect(heldMigrations({ SELF_AUTH_B_HOLD: '0' }).size).toBe(0);
    expect(heldMigrations({ SELF_AUTH_B_HOLD: ' 0\r\n' }).size).toBe(0);
  });

  it('names the real Migration B files, one per database', () => {
    expect(SELF_AUTH_B_FILES).toEqual(['0103_self_auth_b.sql', '0008_self_auth_b.sql']);
    const root = path.join(__dirname, '..', 'supabase');
    expect(existsSync(path.join(root, 'migrations', SELF_AUTH_B_FILES[0]))).toBe(true);
    expect(existsSync(path.join(root, 'control', 'migrations', SELF_AUTH_B_FILES[1]))).toBe(true);
  });
});
