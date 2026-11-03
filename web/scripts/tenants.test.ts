import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) }),
}));
import { checkTenant, nullCompanyWarning, parseRegisterArgs } from './tenants';

describe('parseRegisterArgs', () => {
  it('slug, name and one or more hosts', () => {
    expect(parseRegisterArgs(['academy', 'The Academy', 'implant-course.vercel.app', 'www.academy.com'])).toEqual({
      slug: 'academy', name: 'The Academy', hosts: ['implant-course.vercel.app', 'www.academy.com'],
    });
  });
  it('needs at least one host', () => {
    expect(() => parseRegisterArgs(['academy', 'The Academy'])).toThrow(/Usage/);
  });
  const id = 'a7c0de00-0000-4000-8000-000000000001';
  it('--company with a valid uuid, before or after the positionals', () => {
    const want = { slug: 'academy', name: 'The Academy', hosts: ['a.example.com'], companyId: id };
    expect(parseRegisterArgs(['academy', 'The Academy', 'a.example.com', '--company', id])).toEqual(want);
    expect(parseRegisterArgs(['--company', id, 'academy', 'The Academy', 'a.example.com'])).toEqual(want);
  });
  it('--company without a value or with a malformed id is refused', () => {
    expect(() => parseRegisterArgs(['academy', 'The Academy', 'a.example.com', '--company'])).toThrow(/--company/);
    expect(() => parseRegisterArgs(['academy', 'The Academy', 'a.example.com', '--company', 'nope'])).toThrow(/--company/);
  });
  it('--provision creates the company first, anywhere in the arguments', () => {
    const want = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], provision: true };
    expect(parseRegisterArgs(['acme', 'Acme', 'acme.example.com', '--provision'])).toEqual(want);
    expect(parseRegisterArgs(['--provision', 'acme', 'Acme', 'acme.example.com'])).toEqual(want);
  });
  it('--provision and --company together are refused', () => {
    expect(() => parseRegisterArgs(['acme', 'Acme', 'acme.example.com', '--provision', '--company', id])).toThrow(/either --provision or --company/);
  });
});

describe('checkTenant', () => {
  const t = { supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc' };
  it('ok when the anon key and service key both work', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"disable_signup":true}', { status: 200 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('https://a.supabase.co/auth/v1/settings', { headers: { apikey: 'anon' } });
  });
  it('fails while Auth sign-ups are open (a pending login would go to whoever signs up with its email)', async () => {
    for (const body of ['{"disable_signup":false}', '{}']) {
      const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
      expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual([
        'Auth sign-ups are enabled on https://a.supabase.co: turn off "Allow new users to sign up" (Authentication -> Sign In / Providers)',
      ]);
    }
  });
  it('reports a wrong anon key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual(['Anon key rejected by https://a.supabase.co (401)']);
  });
});

describe('nullCompanyWarning', () => {
  it('warns when the registered tenant has no company id', () => {
    expect(nullCompanyWarning('acme', null)).toBe(
      'Warning: acme has no company id, so it answers 503 until one is set (run again with --company <uuid>).',
    );
  });
  it('is quiet with a company id, or before control 0004 added the column', () => {
    expect(nullCompanyWarning('acme', 'a7c0de00-0000-4000-8000-000000000001')).toBeNull();
    expect(nullCompanyWarning('acme', undefined)).toBeNull();
  });
});
