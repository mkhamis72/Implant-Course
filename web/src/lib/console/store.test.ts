import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

type Call = { table?: string; ops: [string, unknown[]][] };
const h = vi.hoisted(() => ({
  calls: [] as { table?: string; ops: [string, unknown[]][] }[],
  rpc: vi.fn(),
  results: new Map<string, unknown>(),
  resetProductionCache: vi.fn(),
}));

/** A PostgREST-like client: records every chained call; awaiting a query gives the result set for its table. */
function fakeClient() {
  return {
    rpc: h.rpc,
    from(table: string) {
      const call: Call = { table, ops: [] };
      h.calls.push(call);
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'order', 'limit', 'upsert']) {
        q[op] = (...args: unknown[]) => { call.ops.push([op, args]); return q; };
      }
      q.maybeSingle = async () => {
        const r = h.results.get(table) as { data: unknown[] } | undefined;
        return { data: r?.data?.[0] ?? null, error: null };
      };
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(h.results.get(table) ?? { data: [], error: null }).then(ok);
      return q;
    },
  };
}
vi.mock('./supabase', () => ({ createConsoleServiceClient: () => fakeClient() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('@/lib/tenant/production', () => ({ resetProductionCache: h.resetProductionCache }));

import { consoleStore } from './store';

const PROD = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'p-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'p-svc', DATABASE_URL: 'postgres://prod',
};
const stub = (env: Record<string, string>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };

beforeEach(() => {
  h.calls = [];
  h.results.clear();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.resetProductionCache.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('console store (production database)', () => {
  beforeEach(() => stub(PROD));
  const osdic = { id: 'c-osdic', slug: 'osdic', name: 'OSDIC', hosts: ['osdic.imploid.net'], status: 'active', kind: 'course_organizer', plan_id: 'p1', extra_modules: ['statistics'] };

  it('lists companies with the project keys from the env and the company id from the row', async () => {
    h.results.set('companies', { data: [osdic], error: null });
    const s = consoleStore();
    expect(await s.list()).toEqual([{
      slug: 'osdic', name: 'OSDIC', hosts: ['osdic.imploid.net'], status: 'active',
      supabase_url: 'https://prod.supabase.co', anon_key: 'p-anon', company_id: 'c-osdic',
      kind: 'course_organizer', plan_id: 'p1', extra_modules: ['statistics'],
    }]);
    expect(h.calls[0]).toEqual({ table: 'companies', ops: [['select', ['id, slug, name, hosts, status, kind, plan_id, extra_modules']], ['order', ['slug']]] });
  });
  it('gets one company by slug', async () => {
    h.results.set('companies', { data: [osdic], error: null });
    expect((await consoleStore().get('osdic'))?.company_id).toBe('c-osdic');
    expect(h.calls[0].ops).toContainEqual(['eq', ['slug', 'osdic']]);
  });
  it('reads history from company_log, newest first, 50 at most', async () => {
    h.results.set('company_log', { data: [{ at: 't', action: 'update', actor: 'me', reason: null, before: { name: 'A' }, after: { name: 'B', updated_at: 'x' } }], error: null });
    const rows = await consoleStore().history('osdic');
    expect(rows).toEqual([{ at: 't', action: 'update', actor: 'me', reason: null, changed: ['name'] }]);
    expect(h.calls[0].table).toBe('company_log');
    expect(h.calls[0].ops).toEqual([
      ['select', ['at, action, actor, reason, before, after']], ['eq', ['slug', 'osdic']],
      ['order', ['at', { ascending: false }]], ['order', ['id', { ascending: false }]], ['limit', [50]],
    ]);
  });
  it('history ignores keys an older snapshot never had (written before 0110)', async () => {
    h.results.set('company_log', { data: [{ at: 't', action: 'update', actor: 'me', reason: null, before: { name: 'A' }, after: { name: 'B', kind: 'course_organizer', plan_id: 'p', extra_modules: [] } }], error: null });
    expect((await consoleStore().history('osdic'))[0].changed).toEqual(['name']);
  });
  it('history lists a changed plan when both snapshots have it', async () => {
    h.results.set('company_log', { data: [{ at: 't', action: 'update', actor: 'me', reason: null, before: { plan_id: 'a', kind: 'course_organizer' }, after: { plan_id: 'b', kind: 'course_organizer' } }], error: null });
    expect((await consoleStore().history('osdic'))[0].changed).toEqual(['plan_id']);
  });
  it('lists plans with the number of companies on each', async () => {
    h.results.set('plans', { data: [{ id: 'p1', name: 'Starter', kind: 'course_organizer', modules: ['inventory'] }, { id: 'p2', name: 'Full', kind: 'course_organizer', modules: ['inventory', 'statistics'] }], error: null });
    h.results.set('companies', { data: [{ plan_id: 'p1' }, { plan_id: 'p1' }, { plan_id: 'p2' }], error: null });
    expect(await consoleStore().plans()).toEqual([
      { id: 'p1', name: 'Starter', kind: 'course_organizer', modules: ['inventory'], companies: 2 },
      { id: 'p2', name: 'Full', kind: 'course_organizer', modules: ['inventory', 'statistics'], companies: 1 },
    ]);
  });
  it('saves a plan through console_save_plan; the message comes back', async () => {
    expect(await consoleStore().savePlan({ id: null, name: 'X', kind: 'course_organizer', modules: ['inventory'] }, 'me')).toBeNull();
    expect(h.rpc).toHaveBeenCalledWith('console_save_plan', { p_id: null, p_name: 'X', p_kind: 'course_organizer', p_modules: ['inventory'], p_actor: 'me' });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'A plan called X already exists.' } });
    expect(await consoleStore().savePlan({ id: null, name: 'X', kind: 'course_organizer', modules: [] }, 'me')).toBe('A plan called X already exists.');
  });
  it('sets a company plan through console_set_company_plan and refreshes the routing cache', async () => {
    expect(await consoleStore().setCompanyPlan('osdic', 'course_organizer', 'p1', ['statistics'], 'me')).toBeNull();
    expect(h.rpc).toHaveBeenCalledWith('console_set_company_plan', { p_slug: 'osdic', p_kind: 'course_organizer', p_plan: 'p1', p_extras: ['statistics'], p_actor: 'me' });
    expect(h.resetProductionCache).toHaveBeenCalled();
  });
  it('reads the recorded errors from error_log, newest first, 1000 at most', async () => {
    h.results.set('error_log', { data: [{ at: 't', message: 'boom', path: null }], error: null });
    expect(await consoleStore().errors()).toEqual([{ at: 't', message: 'boom', path: null }]);
    expect(h.calls[0].table).toBe('error_log');
    expect(h.calls[0].ops).toEqual([['select', ['at, message, path']], ['order', ['at', { ascending: false }]], ['limit', [1000]]]);
  });
  it('errors() throws when error_log cannot be read', async () => {
    h.results.set('error_log', { data: null, error: { message: 'permission denied' } });
    await expect(consoleStore().errors()).rejects.toThrow('Could not load the errors.');
  });
  it('one service key and one shared project, from the env', async () => {
    const s = consoleStore();
    expect(await s.serviceKey('osdic')).toBe('p-svc');
    expect(await s.shared()).toEqual({ supabaseUrl: 'https://prod.supabase.co', anonKey: 'p-anon', serviceRoleKey: 'p-svc', databaseUrl: 'postgres://prod' });
  });
  it('adds a company: provision_company, then its name and addresses with the actor, then a fresh list', async () => {
    h.rpc.mockImplementation(async (name: string) => (name === 'provision_company' ? { data: 'c-new', error: null } : { data: null, error: null }));
    expect(await consoleStore().addCompany({ slug: 'new', name: 'New Co', hosts: ['new.imploid.net'] }, 'owner@x.com')).toMatchObject({ companyId: 'c-new', shared: { supabaseUrl: 'https://prod.supabase.co' } });
    expect(h.rpc.mock.calls).toEqual([
      ['provision_company', { p_slug: 'new', p_name: 'New Co' }],
      ['console_update_company', { p_slug: 'new', p_name: 'New Co', p_hosts: ['new.imploid.net'], p_actor: 'owner@x.com' }],
    ]);
    expect(h.resetProductionCache).toHaveBeenCalledTimes(1);
  });
  it('refuses an address another company uses before creating anything (review #1)', async () => {
    h.results.set('companies', { data: [osdic], error: null });
    expect(await consoleStore().addCompany({ slug: 'new', name: 'New Co', hosts: ['x.imploid.net', 'osdic.imploid.net'] }, 'me'))
      .toEqual({ error: 'A host of new is already used by osdic' });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('a failed provision is reported and nothing else runs', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'slug taken' } });
    expect(await consoleStore().addCompany({ slug: 'new', name: 'New Co', hosts: [] }, 'me')).toEqual({ error: 'The company could not be created in the database: slug taken' });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it('update, status and log call the console_*_company functions', async () => {
    const s = consoleStore();
    expect(await s.update('osdic', 'OSDIC', ['a.imploid.net'], 'me')).toBeNull();
    expect(await s.setStatus('osdic', 'suspended', 'unpaid', 'me')).toBeNull();
    expect(await s.log('osdic', 'domain_added', 'a.imploid.net', 'me')).toBeNull();
    expect(h.rpc.mock.calls).toEqual([
      ['console_update_company', { p_slug: 'osdic', p_name: 'OSDIC', p_hosts: ['a.imploid.net'], p_actor: 'me' }],
      ['console_set_company_status', { p_slug: 'osdic', p_status: 'suspended', p_reason: 'unpaid', p_actor: 'me' }],
      ['console_log_company', { p_slug: 'osdic', p_action: 'domain_added', p_detail: 'a.imploid.net', p_actor: 'me' }],
    ]);
    expect(h.resetProductionCache).toHaveBeenCalledTimes(2);
  });
  it('returns the database message on a refused write', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'Give a name (2–120 characters).' } });
    expect(await consoleStore().update('osdic', 'x', [], 'me')).toBe('Give a name (2–120 characters).');
  });
});
