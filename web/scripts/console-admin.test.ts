import { describe, it, expect } from 'vitest';
import { consoleAdminTarget, parseConsoleAdminArgs } from './console-admin';

describe('consoleAdminTarget (release 3: production only)', () => {
  it('console_users in the company project, whatever control settings are left', () => {
    expect(consoleAdminTarget({ NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'p-svc', CONTROL_SUPABASE_URL: 'x', CONTROL_SERVICE_ROLE_KEY: 'y' }))
      .toEqual({ url: 'https://prod.supabase.co', key: 'p-svc' });
  });
  it('a missing key names what to add', () => {
    expect(() => consoleAdminTarget({ NEXT_PUBLIC_SUPABASE_URL: 'x' })).toThrow('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
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
