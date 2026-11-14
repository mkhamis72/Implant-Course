import { describe, it, expect } from 'vitest';
import { consoleConfig } from './env';

const company = { NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'p-anon', SUPABASE_SERVICE_ROLE_KEY: 'p-svc' };
const control = { CONTROL_SUPABASE_URL: 'https://control.supabase.co', NEXT_PUBLIC_CONTROL_ANON_KEY: 'c-anon', CONTROL_SERVICE_ROLE_KEY: 'c-svc' };

describe('consoleConfig', () => {
  it('control mode: the control project, as before', () => {
    expect(consoleConfig({ ...company, ...control })).toEqual({ url: 'https://control.supabase.co', anonKey: 'c-anon', serviceKey: 'c-svc', source: 'control' });
  });
  it('production mode: the company project, needing no CONTROL_* setting', () => {
    expect(consoleConfig({ ...company, COMPANY_LIST: 'production' })).toEqual({ url: 'https://prod.supabase.co', anonKey: 'p-anon', serviceKey: 'p-svc', source: 'production' });
    expect(consoleConfig({ ...company, ...control, COMPANY_LIST: 'production' }).url).toBe('https://prod.supabase.co');
  });
  it('a missing key in either mode: not configured', () => {
    expect(() => consoleConfig({ ...company, SUPABASE_SERVICE_ROLE_KEY: '', COMPANY_LIST: 'production' })).toThrow('The console is not configured.');
    expect(() => consoleConfig({ ...company })).toThrow('The console is not configured.');
  });
});
