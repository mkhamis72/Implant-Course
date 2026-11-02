import { describe, it, expect, vi } from 'vitest';
import { companyHealth } from './companies';

vi.mock('server-only', () => ({}));

function controlWith(row: object | null, secret: string | null = 'svc') {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    rpc: async () => ({ data: secret, error: null }),
  } as never;
}
const row = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' };

function companyCounting(users: number, patients: number) {
  return (() => ({
    from: (table: string) => ({
      select: () => {
        const result = { count: table === 'patients' ? patients : users, error: null };
        return Object.assign(Promise.resolve(result), { eq: () => Promise.resolve(result), limit: () => Promise.resolve({ data: [], error: null }) });
      },
    }),
  })) as never;
}

describe('companyHealth', () => {
  it('reports OK with counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"disable_signup":true}', { status: 200 }));
    const h = await companyHealth(controlWith(row), 'acme', { connect: companyCounting(4, 120), fetchImpl });
    expect(h).toEqual({ problems: [], users: 4, patients: 120 });
  });

  it('does not report a healthy row when a count query fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"disable_signup":true}', { status: 200 }));
    const broken = (() => ({
      from: () => ({ select: () => Object.assign(Promise.resolve({ count: null, error: { message: 'permission denied' } }), { eq: () => Promise.resolve({ count: null, error: { message: 'permission denied' } }), limit: () => Promise.resolve({ data: [], error: null }) }) }),
    })) as never;
    const h = await companyHealth(controlWith(row), 'acme', { connect: broken, fetchImpl });
    expect(h).toEqual({ problems: ["Couldn't count users or patients: permission denied"], users: null, patients: null });
  });

  it('reports a missing company and a missing service key', async () => {
    expect((await companyHealth(controlWith(null), 'nope')).problems).toEqual(['Unknown company nope']);
    expect((await companyHealth(controlWith(row, null), 'acme')).problems).toEqual(['No service key in Vault']);
  });

  it('times out a project that never answers, without waiting for it', async () => {
    vi.useFakeTimers();
    const hang = () => new Promise<Response>(() => {});
    const pending = companyHealth(controlWith(row), 'acme', { connect: companyCounting(1, 1), fetchImpl: hang as never, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ problems: ["Couldn't check: timed out"], users: null, patients: null });
    vi.useRealTimers();
  });
});
