import { describe, it, expect } from 'vitest';
import { consoleConfig } from './env';

const company = { NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'p-anon', SUPABASE_SERVICE_ROLE_KEY: 'p-svc' };
const control = { CONTROL_SUPABASE_URL: 'https://control.supabase.co', NEXT_PUBLIC_CONTROL_ANON_KEY: 'c-anon', CONTROL_SERVICE_ROLE_KEY: 'c-svc' };

describe('consoleConfig (release 3: the console lives in the company project)', () => {
  it('reads the company project, whatever control settings are left', () => {
    expect(consoleConfig({ ...company, ...control })).toEqual({ url: 'https://prod.supabase.co', anonKey: 'p-anon', serviceKey: 'p-svc' });
  });
  it('a missing key: not configured', () => {
    expect(() => consoleConfig({ ...company, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow('The console is not configured.');
    expect(() => consoleConfig({ ...control })).toThrow('The console is not configured.');
  });
});
