import { describe, it, expect, vi, afterEach } from 'vitest';
import { googleConfig } from './google-config';

afterEach(() => vi.restoreAllMocks());

describe('googleConfig', () => {
  it('google_config_both_or_neither: unset gives null, both gives the settings', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' ' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' })).toEqual({ clientId: 'id', clientSecret: 'sec' });
  });
  it('google_config_both_or_neither: one alone gives null and logs the missing name once, never a value', async () => {
    for (const [env, missing] of [
      [{ GOOGLE_CLIENT_ID: 'the-id-value' }, 'GOOGLE_CLIENT_SECRET'],
      [{ GOOGLE_CLIENT_SECRET: 'the-secret-value' }, 'GOOGLE_CLIENT_ID'],
    ] as const) {
      vi.resetModules();
      const { googleConfig: fresh } = await import('./google-config');
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(fresh(env)).toBeNull();
      expect(fresh(env)).toBeNull();
      expect(err).toHaveBeenCalledTimes(1);
      const logged = err.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain(missing);
      expect(logged).not.toMatch(/the-id-value|the-secret-value/);
      err.mockRestore();
    }
  });
});
