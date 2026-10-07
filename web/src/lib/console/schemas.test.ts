import { describe, it, expect } from 'vitest';
import { firstAdminSchema, registerSchema, statusSchema } from './schemas';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const base = {
  slug: 'acme', name: 'Acme Implants', hosts: 'acme.example.com\n Clinic.Acme.com ',
  supabaseUrl: 'https://abcdefgh.supabase.co', anonKey: 'a'.repeat(30), serviceRoleKey: 's'.repeat(30),
  databaseUrl: 'postgresql://postgres.abcdefgh:pw@aws-0.pooler.supabase.com:5432/postgres',
};

describe('registerSchema', () => {
  it('splits and normalises hosts', () => {
    expect(registerSchema.parse(base).hosts).toEqual(['acme.example.com', 'clinic.acme.com']);
  });
  it('refuses a bad slug, no hosts, a bad URL and missing keys', () => {
    expect(err(registerSchema.safeParse({ ...base, slug: 'Acme Co' }))).toBe('Use 2–40 lower-case letters, digits or hyphens.');
    expect(err(registerSchema.safeParse({ ...base, hosts: '  ' }))).toBe('Enter at least one address.');
    expect(err(registerSchema.safeParse({ ...base, hosts: 'acme.example.com/x' }))).toBe('Not a valid address: acme.example.com/x');
    expect(err(registerSchema.safeParse({ ...base, supabaseUrl: 'https://evil.example.com' }))).toBe('Enter the project URL, e.g. https://abcd.supabase.co');
    expect(err(registerSchema.safeParse({ ...base, serviceRoleKey: '' }))).toBe('Paste the key.');
    expect(err(registerSchema.safeParse({ ...base, databaseUrl: 'mysql://x' }))).toBe('Paste the session pooler URI.');
  });
  it('accepts a local stack URL (development)', () => {
    expect(registerSchema.safeParse({ ...base, supabaseUrl: 'http://127.0.0.1:54421' }).success).toBe(true);
  });
});

describe('statusSchema', () => {
  const s = { slug: 'acme', status: 'suspended', reason: 'Unpaid invoice', confirm: 'acme' };
  it('needs a reason and the typed slug', () => {
    expect(statusSchema.parse(s)).toMatchObject({ reason: 'Unpaid invoice' });
    expect(err(statusSchema.safeParse({ ...s, reason: ' x ' }))).toBe('Give a reason (3–300 characters).');
    expect(err(statusSchema.safeParse({ ...s, confirm: 'acm' }))).toBe('Type the company’s slug to confirm.');
  });
});

describe('firstAdminSchema', () => {
  it('normalises the email', () => {
    expect(firstAdminSchema.parse({ slug: 'acme', email: ' Owner@Acme.COM ', fullName: 'Dr Owner' })).toEqual({ slug: 'acme', email: 'owner@acme.com', fullName: 'Dr Owner' });
  });
});
