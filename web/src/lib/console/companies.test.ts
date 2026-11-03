import { describe, it, expect, vi } from 'vitest';
import { companyHealth } from './companies';

vi.mock('server-only', () => ({}));

function controlWith(row: object | null, secret: string | null = 'svc') {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    rpc: async () => ({ data: secret, error: null }),
  } as never;
}
const row = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon', company_id: 'c0000000-0000-4000-8000-00000000000c' };

/** A company database that answers counts, recording each query's table and filters. */
function companyCounting(users: number, patients: number, queries: string[] = []) {
  return (() => ({
    from: (table: string) => ({
      select: () => {
        const result = { count: table === 'patients' ? patients : users, error: null };
        const filters: string[] = [];
        const query = Object.assign(Promise.resolve(result), {
          eq: (column: string, value: unknown) => { filters.push(`${column}=${value}`); queries.push(`${table} ${filters.join(' ')}`); return query; },
          limit: () => Promise.resolve({ data: [], error: null }),
        });
        return query;
      },
    }),
  })) as never;
}

describe('companyHealth', () => {
  it('reports OK with counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"disable_signup":true}', { status: 200 }));
    const queries: string[] = [];
    const h = await companyHealth(controlWith(row), 'acme', { connect: companyCounting(4, 120, queries), fetchImpl });
    expect(h).toEqual({ problems: [], users: 4, patients: 120 });
    // Active memberships and patients of this company only: the database holds every company.
    expect(queries).toContain('company_members company_id=c0000000-0000-4000-8000-00000000000c active=true');
    expect(queries).toContain('patients company_id=c0000000-0000-4000-8000-00000000000c');
    expect(queries.some((q) => q.startsWith('profiles'))).toBe(false);
  });

  it('does not report a healthy row when a count query fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"disable_signup":true}', { status: 200 }));
    const failing = (): object => Object.assign(Promise.resolve({ count: null, error: { message: 'permission denied' } }), { eq: failing, limit: () => Promise.resolve({ data: [], error: null }) });
    const broken = (() => ({ from: () => ({ select: failing }) })) as never;
    const h = await companyHealth(controlWith(row), 'acme', { connect: broken, fetchImpl });
    expect(h).toEqual({ problems: ["Couldn't count users or patients: permission denied"], users: null, patients: null });
  });

  it('reports a missing company and a missing service key', async () => {
    expect((await companyHealth(controlWith(null), 'nope')).problems).toEqual(['Unknown company nope']);
    expect((await companyHealth(controlWith(row, null), 'acme')).problems).toEqual(['No service key in Vault']);
    expect((await companyHealth(controlWith({ ...row, company_id: null }), 'acme')).problems).toEqual(['No company in the database yet']);
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
