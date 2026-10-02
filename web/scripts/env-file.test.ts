import { describe, it, expect } from 'vitest';
import { resolveEnvFile } from './env-file';

describe('resolveEnvFile', () => {
  it('uses .env.local by default', () => {
    expect(resolveEnvFile({}, () => false)).toBe('.env.local');
    expect(resolveEnvFile({ ENV_FILE: '' }, () => false)).toBe('.env.local');
  });
  it('uses ENV_FILE when the file exists', () => {
    expect(resolveEnvFile({ ENV_FILE: '.env.prod' }, () => true)).toBe('.env.prod');
  });
  it('refuses a missing ENV_FILE instead of silently using another environment', () => {
    expect(() => resolveEnvFile({ ENV_FILE: '.env.prod.local' }, () => false)).toThrow(/\.env\.prod\.local/);
  });
});
