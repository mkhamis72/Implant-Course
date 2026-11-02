import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { A } = vi.hoisted(() => ({ A: 'a7c0de00-0000-4000-8000-000000000001' }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
import { staffOptions } from './staff';

const calls: { table: string; steps: unknown[][] }[] = [];
let answer: unknown;
const supabase = {
  from: (table: string) => {
    const call = { table, steps: [] as unknown[][] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'in']) {
      chain[step] = (...args: unknown[]) => {
        call.steps.push([step, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
    return chain;
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  calls.length = 0;
});

describe('staffOptions', () => {
  it("reads this company's active admins and organizers from company_members, with their names", async () => {
    answer = { data: [], error: null };
    await staffOptions(supabase);
    expect(calls).toEqual([
      {
        table: 'company_members',
        steps: [
          ['select', 'user_id, profile:profiles(full_name, email)'],
          ['eq', 'company_id', A],
          ['eq', 'active', true],
          ['in', 'role', ['admin', 'organizer']],
        ],
      },
    ]);
  });
  it('labels each by name, or email without one, sorted by label', async () => {
    answer = {
      data: [
        { user_id: 'u1', profile: { full_name: 'Dr Zed', email: 'z@example.com' } },
        { user_id: 'u2', profile: { full_name: '', email: 'b@example.com' } },
        { user_id: 'u3', profile: { full_name: 'Dr Adam', email: 'a@example.com' } },
      ],
      error: null,
    };
    expect(await staffOptions(supabase)).toEqual({
      data: [
        { id: 'u2', label: 'b@example.com' },
        { id: 'u3', label: 'Dr Adam' },
        { id: 'u1', label: 'Dr Zed' },
      ],
      error: null,
    });
  });
  it('passes the error on', async () => {
    const error = { message: 'boom' };
    answer = { data: null, error };
    expect(await staffOptions(supabase)).toEqual({ data: null, error });
  });
});
