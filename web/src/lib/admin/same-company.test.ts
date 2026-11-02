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
import { activeInAnotherCompany, memberOfMyCompany, profileRemains, sharedWithAnotherCompany } from './same-company';

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

describe('sharedWithAnotherCompany', () => {
  it("counts the user's memberships of other companies with the admin client", async () => {
    answer.value = { count: 1, error: null };
    expect(await sharedWithAnotherCompany('u1')).toBe(true);
    expect(calls).toEqual([
      {
        client: 'admin',
        table: 'company_members',
        steps: [['select', 'user_id', { count: 'exact', head: true }], ['eq', 'user_id', 'u1'], ['neq', 'company_id', A]],
      },
    ]);
  });
  it('is false with no other membership', async () => {
    answer.value = { count: 0, error: null };
    expect(await sharedWithAnotherCompany('u1')).toBe(false);
  });
  it('is true, and logs, when the count errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer.value = { count: null, error: { message: 'boom' } };
    expect(await sharedWithAnotherCompany('u1')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('is true, and logs, when the admin client is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    adminUnavailable.value = true;
    expect(await sharedWithAnotherCompany('u1')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('activeInAnotherCompany', () => {
  it('counts only active memberships of other companies', async () => {
    answer.value = { count: 0, error: null };
    expect(await activeInAnotherCompany('u1')).toBe(false);
    expect(calls[0].steps).toEqual([
      ['select', 'user_id', { count: 'exact', head: true }], ['eq', 'user_id', 'u1'], ['neq', 'company_id', A], ['eq', 'active', true],
    ]);
  });
  it('is true, and logs, when the count errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer.value = { count: null, error: { message: 'boom' } };
    expect(await activeInAnotherCompany('u1')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
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
