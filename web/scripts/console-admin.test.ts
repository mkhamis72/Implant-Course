import { describe, it, expect } from 'vitest';
import { consoleAdminTarget, parseConsoleAdminArgs } from './console-admin';

describe('consoleAdminTarget', () => {
  const company = { NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'p-svc' };
  const control = { CONTROL_SUPABASE_URL: 'https://control.supabase.co', CONTROL_SERVICE_ROLE_KEY: 'c-svc' };
  it('production mode: console_users in the company project, the company Self-Auth, no CONTROL_*', () => {
    expect(consoleAdminTarget({ ...company, ...control, COMPANY_LIST: 'production' })).toEqual({
      source: 'production', url: 'https://prod.supabase.co', key: 'p-svc', table: 'console_users',
    });
  });
  it('control mode: console_admins in the control project, as before', () => {
    expect(consoleAdminTarget({ ...company, ...control })).toEqual({
      source: 'control', url: 'https://control.supabase.co', key: 'c-svc', table: 'console_admins',
    });
  });
  it('a missing key names what to add', () => {
    expect(() => consoleAdminTarget({ COMPANY_LIST: 'production', NEXT_PUBLIC_SUPABASE_URL: 'x' })).toThrow('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    expect(() => consoleAdminTarget({})).toThrow('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY missing');
  });
});

describe('parseConsoleAdminArgs', () => {
  it('takes one email, lower-cased', () => {
    expect(parseConsoleAdminArgs([' Owner@Example.com '])).toEqual({ email: 'owner@example.com' });
  });
  it('refuses anything else', () => {
    expect(() => parseConsoleAdminArgs([])).toThrow('Usage: npm run console:admin -- <email>');
    expect(() => parseConsoleAdminArgs(['not-an-email'])).toThrow('Usage: npm run console:admin -- <email>');
  });
});
