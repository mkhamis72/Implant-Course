import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) }),
}));
import { checkTenant, parseRegisterArgs } from './tenants';

describe('parseRegisterArgs', () => {
  it('slug, name and one or more hosts', () => {
    expect(parseRegisterArgs(['academy', 'The Academy', 'implant-course.vercel.app', 'www.academy.com'])).toEqual({
      slug: 'academy', name: 'The Academy', hosts: ['implant-course.vercel.app', 'www.academy.com'],
    });
  });
  it('needs at least one host', () => {
    expect(() => parseRegisterArgs(['academy', 'The Academy'])).toThrow(/Usage/);
  });
});

describe('checkTenant', () => {
  const t = { supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc' };
  it('ok when the anon key and service key both work', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('https://a.supabase.co/auth/v1/settings', { headers: { apikey: 'anon' } });
  });
  it('reports a wrong anon key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual(['Anon key rejected by https://a.supabase.co (401)']);
  });
});
