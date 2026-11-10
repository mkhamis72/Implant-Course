import { describe, it, expect } from 'vitest';
import { googleConfig } from './google-config';

describe('googleConfig', () => {
  it('google_config_both_or_neither: unset gives null, both gives the settings', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' ' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' })).toEqual({ clientId: 'id', clientSecret: 'sec' });
  });
  it('one alone throws naming the missing one', () => {
    expect(() => googleConfig({ GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => googleConfig({ GOOGLE_CLIENT_SECRET: 'sec' })).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
