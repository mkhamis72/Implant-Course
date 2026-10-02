import { describe, it, expect } from 'vitest';
import { parseCreateUserArgs, targetLabel } from './create-user-args';

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
  it('refuses an unknown role, a missing name or a bad email', () => {
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role', 'owner'])).toEqual({ error: 'Unknown role "owner". Use organizer or admin.' });
    expect(parseCreateUserArgs(['a@x.com'])).toHaveProperty('error');
    expect(parseCreateUserArgs(['not-an-email', 'Dr A'])).toHaveProperty('error');
  });
});

describe('targetLabel', () => {
  it('names the Supabase project the script will change', () => {
    expect(targetLabel('https://abcd1234.supabase.co')).toBe('abcd1234.supabase.co');
    expect(targetLabel(undefined)).toBe('(NEXT_PUBLIC_SUPABASE_URL not set)');
  });
});
