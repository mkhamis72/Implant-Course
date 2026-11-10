import { describe, it, expect, vi, beforeEach } from 'vitest';

const { A } = vi.hoisted(() => ({ A: 'a7c0de00-0000-4000-8000-000000000001' }));
/** A query chain that records every call and answers with `answer` (maybeSingle, or awaiting the chain). */
const { calls, answer, adminUnavailable } = vi.hoisted(() => ({
  calls: [] as { client: string; table: string; steps: unknown[][] }[],
  answer: { value: {} as unknown },
  adminUnavailable: { value: false },
}));
const client = (name: string) => ({
  from: (table: string) => {
    const call = { client: name, table, steps: [] as unknown[][] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'neq']) {
      chain[step] = (...args: unknown[]) => {
        call.steps.push([step, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => answer.value;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(answer.value);
    return chain;
  },
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client('rls') }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: async () => {
    if (adminUnavailable.value) throw new Error('Admin tools are unavailable.');
    return client('admin');
  },
}));
import { memberOfMyCompany, profileRemains } from './same-company';

beforeEach(() => {
  calls.length = 0;
  adminUnavailable.value = false;
});

describe('memberOfMyCompany', () => {
  it("reads this company's member row through the admin's own client", async () => {
    answer.value = { data: { user_id: 'u1' }, error: null };
    expect(await memberOfMyCompany('u1')).toBe(true);
    expect(calls).toEqual([
      { client: 'rls', table: 'company_members', steps: [['select', 'user_id'], ['eq', 'company_id', A], ['eq', 'user_id', 'u1']] },
    ]);
  });
  it('is false, and logs, when the lookup errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer.value = { data: null, error: { message: 'boom' } };
    expect(await memberOfMyCompany('u3')).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('is false when the user is not a member here', async () => {
    answer.value = { data: null, error: null };
    expect(await memberOfMyCompany('u2')).toBe(false);
  });
});

describe('profileRemains', () => {
  it("reads the user's profile with the admin client", async () => {
    answer.value = { data: { user_id: 'u1' }, error: null };
    expect(await profileRemains('u1')).toBe(true);
    expect(calls).toEqual([{ client: 'admin', table: 'profiles', steps: [['select', 'user_id'], ['eq', 'user_id', 'u1']] }]);
  });
  it('is false once the profile is gone', async () => {
    answer.value = { data: null, error: null };
    expect(await profileRemains('u1')).toBe(false);
  });
  it('is null, and logs, when it cannot tell', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer.value = { data: null, error: { message: 'boom' } };
    expect(await profileRemains('u1')).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
