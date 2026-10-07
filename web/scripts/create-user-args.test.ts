import { describe, it, expect } from 'vitest';
import { parseCreateUserArgs, targetLabel } from './create-user-args';
import { takeTenantArg } from './tenant-env';

describe('parseCreateUserArgs', () => {
  it('defaults to organizer and joins the name', () => {
    expect(parseCreateUserArgs(['Dr.A@Example.com ', 'Amal', 'Hassan'])).toEqual({
      email: 'dr.a@example.com', fullName: 'Amal Hassan', role: 'organizer',
    });
  });
  it('accepts --role before or after the other arguments', () => {
    expect(parseCreateUserArgs(['--role', 'admin', 'a@x.com', 'Dr A'])).toMatchObject({ role: 'admin' });
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role=organizer'])).toMatchObject({ role: 'organizer' });
  });
  it('creates a delegate login only for a named delegate', () => {
    const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role', 'delegate', '--delegate', id])).toEqual({
      email: 'a@x.com', fullName: 'Dr A', role: 'delegate', delegateId: id,
    });
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role=delegate'])).toEqual({ error: 'A delegate login needs --delegate <id>.' });
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role', 'delegate', '--delegate', 'nope'])).toEqual({ error: 'A delegate login needs --delegate <id>.' });
  });
  it('refuses an unknown role, a missing name or a bad email', () => {
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role', 'owner'])).toEqual({ error: 'Unknown role "owner". Use organizer, admin or delegate.' });
    expect(parseCreateUserArgs(['a@x.com'])).toHaveProperty('error');
    expect(parseCreateUserArgs(['not-an-email', 'Dr A'])).toHaveProperty('error');
  });
  it('parses the arguments left after --tenant is taken out', () => {
    const { rest } = takeTenantArg(['--tenant', 'academy', 'a@b.com', 'Some Name', '--role', 'admin']);
    expect(parseCreateUserArgs(rest)).toMatchObject({ email: 'a@b.com', fullName: 'Some Name', role: 'admin' });
  });
});

describe('targetLabel', () => {
  it('names the Supabase project the script will change', () => {
    expect(targetLabel('https://abcd1234.supabase.co')).toBe('abcd1234.supabase.co');
    expect(targetLabel(undefined)).toBe('(NEXT_PUBLIC_SUPABASE_URL not set)');
  });
});
