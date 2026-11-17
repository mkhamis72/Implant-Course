import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('@/lib/console/session', () => ({ requireConsoleAdmin: vi.fn(async () => ({ userId: 'u1', email: 'owner@example.com' })) }));
vi.mock('@/lib/console/first-admin', () => ({
  createFirstAdmin: vi.fn(async () => ({ outcome: 'created', password: 'Temp-Pass-123' })),
  inviteFirstAdmin: vi.fn(async () => ({ outcome: 'invited' })),
}));
const flags = { email: false, vercel: true };
vi.mock('@/lib/flags', () => ({ emailEnabled: () => flags.email }));
vi.mock('@/lib/console/vercel', () => ({ vercelConfigured: () => flags.vercel, addProjectDomain: vi.fn(async () => undefined) }));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'https://console.imploid.net' }));
vi.mock('@/lib/tenant/production', () => ({ resetProductionCache: vi.fn() }));
// The company database client the actions build for first admins (one project: the env's).
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ rpc: vi.fn() })) }));

// The console's service client on the production database: RPCs, one company by slug, and the list.
const rpc = vi.fn();
let existing: object | null = null;
let list: object[] = [];
vi.mock('@/lib/console/supabase', () => ({
  createConsoleServiceClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }),
        order: async () => ({ data: list, error: null }),
      }),
    }),
  }),
}));

import { createClient } from '@supabase/supabase-js';
import { createFirstAdmin, inviteFirstAdmin } from '@/lib/console/first-admin';
import { addProjectDomain } from '@/lib/console/vercel';
import { requireConsoleAdmin } from '@/lib/console/session';
import { revalidatePath } from 'next/cache';
import { addDomain, firstAdmin, onboardCompany, savePlan, setCompanyPlan, setCompanyStatus, updateCompany } from './actions';

const NEW_COMPANY = 'c0000000-0000-4000-8000-0000000000aa';
/** A companies row as the store reads it (id, slug, name, hosts, status). */
const row = { id: 'c0000000-0000-4000-8000-00000000000c', slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active' };
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'p-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'p-svc', DATABASE_URL: 'postgres://prod',
};

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}
const onboardData = { slug: 'acme', name: 'Acme', hosts: 'acme.imploid.net', email: 'ann@acme.com', fullName: 'Ann Admin' };
const logged = (action: string) =>
  rpc.mock.calls.filter(([fn, a]) => fn === 'console_log_company' && a.p_action === action).map(([, a]) => a.p_detail);

beforeEach(() => {
  vi.clearAllMocks();
  existing = null;
  list = [];
  flags.email = false;
  flags.vercel = true;
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  rpc.mockImplementation(async (name: string) => (name === 'provision_company' ? { data: NEW_COMPANY, error: null } : { data: null, error: null }));
});
afterEach(() => vi.unstubAllEnvs());

describe('onboardCompany', () => {
  it('refuses a slug whose company already exists, before saving anything', async () => {
    existing = row;
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toBe('A company with this slug already exists — open it from the list.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('creates the company with its addresses, adds the address on Vercel and invites the admin', async () => {
    flags.email = true;
    const r = await onboardCompany({}, form(onboardData));
    expect(rpc).toHaveBeenCalledWith('provision_company', { p_slug: 'acme', p_name: 'Acme' });
    expect(rpc).toHaveBeenCalledWith('console_update_company', { p_slug: 'acme', p_name: 'Acme', p_hosts: ['acme.imploid.net'], p_actor: 'owner@example.com' });
    expect(vi.mocked(addProjectDomain)).toHaveBeenCalledWith('acme.imploid.net');
    expect(logged('domain_added')).toEqual(['acme.imploid.net']);
    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://prod.supabase.co', 'p-svc', expect.anything());
    expect(vi.mocked(inviteFirstAdmin)).toHaveBeenCalledWith(expect.anything(), { companyId: NEW_COMPANY, email: 'ann@acme.com', fullName: 'Ann Admin' });
    expect(logged('first_admin_invited')).toEqual(['ann@acme.com']);
    expect(r.ok).toBe('Company added.');
    expect(r.slug).toBe('acme');
    expect(r.steps?.map((s) => [s.label, s.ok])).toEqual([['Company', true], ['Address', true], ['First admin', true]]);
    expect(r.steps?.[2].detail).toBe('Invite sent to ann@acme.com.');
    expect(r.password).toBeUndefined();
  });

  it('with email off, creates the login and returns its temporary password once', async () => {
    const r = await onboardCompany({}, form(onboardData));
    expect(vi.mocked(inviteFirstAdmin)).not.toHaveBeenCalled();
    expect(r.password).toBe('Temp-Pass-123');
    expect(logged('first_admin_created')).toEqual(['ann@acme.com']);
  });

  it('still adds the company when Vercel or the invite fail, and says what to redo', async () => {
    flags.email = true;
    vi.mocked(addProjectDomain).mockRejectedValueOnce(new Error('Vercel did not add acme.imploid.net: forbidden'));
    vi.mocked(inviteFirstAdmin).mockRejectedValueOnce(new Error('The invite could not be sent: SMTP down'));
    const r = await onboardCompany({}, form(onboardData));
    expect(r.ok).toBe('Company added.');
    expect(r.steps?.map((s) => s.ok)).toEqual([true, false, false]);
    expect(r.steps?.[1].detail).toContain('forbidden');
    expect(r.steps?.[2].detail).toContain('SMTP down');
    expect(logged('domain_added')).toEqual([]);
  });

  it('without Vercel settings, leaves the address to the manual steps', async () => {
    flags.vercel = false;
    const r = await onboardCompany({}, form(onboardData));
    expect(vi.mocked(addProjectDomain)).not.toHaveBeenCalled();
    expect(r.steps?.[1]).toMatchObject({ label: 'Address', ok: false });
  });

  it('refuses an address another company uses, before creating anything', async () => {
    list = [{ ...row, slug: 'other', hosts: ['acme.imploid.net'] }];
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toBe('A host of acme is already used by other');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says so when the company cannot be created, and saves no addresses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'A company with this slug already exists.' } });
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toBe('The company could not be created in the database: A company with this slug already exists.');
    expect(rpc).not.toHaveBeenCalledWith('console_update_company', expect.anything());
  });

  it('says so when the company was created but its addresses could not be saved', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'provision_company' ? { data: NEW_COMPANY, error: null }
      : name === 'console_update_company' ? { data: null, error: { message: 'boom' } } : { data: null, error: null }));
    expect((await onboardCompany({}, form(onboardData))).error)
      .toBe(`Company ${NEW_COMPANY} was created in the database, but its addresses could not be saved: boom`);
  });
});

describe('updateCompany and addDomain', () => {
  it('adds only the new addresses to Vercel', async () => {
    existing = row;
    const r = await updateCompany({}, form({ slug: 'acme', name: 'Acme', hosts: 'acme.example.com\nnew.imploid.net' }));
    expect(r.ok).toBe('Saved.');
    expect(rpc).toHaveBeenCalledWith('console_update_company', { p_slug: 'acme', p_name: 'Acme', p_hosts: ['acme.example.com', 'new.imploid.net'], p_actor: 'owner@example.com' });
    expect(vi.mocked(addProjectDomain).mock.calls).toEqual([['new.imploid.net']]);
  });

  it('shows the database refusal', async () => {
    existing = row;
    rpc.mockResolvedValue({ data: null, error: { message: 'Give a name (2–120 characters).' } });
    expect((await updateCompany({}, form({ slug: 'acme', name: 'Ac', hosts: 'acme.example.com' }))).error).toBe('Give a name (2–120 characters).');
  });

  it('retries only an address of the company', async () => {
    existing = row;
    expect((await addDomain({}, form({ slug: 'acme', host: 'evil.example.com' }))).error).toBe('evil.example.com is not an address of acme.');
    expect(vi.mocked(addProjectDomain)).not.toHaveBeenCalled();
    expect((await addDomain({}, form({ slug: 'acme', host: 'acme.example.com' }))).ok).toBe('acme.example.com added to Vercel.');
  });
});

describe('setCompanyStatus', () => {
  it('needs the slug typed to confirm', async () => {
    const r = await setCompanyStatus({}, form({ slug: 'acme', status: 'suspended', reason: 'Unpaid invoice', confirm: 'other' }));
    expect(r.error).toBe('Type the company’s slug to confirm.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('suspends with the reason and actor', async () => {
    const r = await setCompanyStatus({}, form({ slug: 'acme', status: 'suspended', reason: 'Unpaid invoice', confirm: 'acme' }));
    expect(r.ok).toContain('Suspended.');
    expect(rpc).toHaveBeenCalledWith('console_set_company_status', { p_slug: 'acme', p_status: 'suspended', p_reason: 'Unpaid invoice', p_actor: 'owner@example.com' });
  });
});

describe('firstAdmin', () => {
  const admin = { slug: 'acme', email: 'a@b.com', fullName: 'Ann Admin' };
  const withLogError = (logError: { message: string } | null) =>
    rpc.mockImplementation(async (name: string) => ({ data: null, error: name === 'console_log_company' ? logError : null }));

  it('refuses an unknown company', async () => {
    const r = await firstAdmin({}, form(admin));
    expect(r.error).toBe('Unknown company acme');
    expect(r.password).toBeUndefined();
  });

  it('records who created the login and for whom, never the password', async () => {
    existing = row;
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toBe('Admin login created.');
    const call = rpc.mock.calls.find(([name]) => name === 'console_log_company')!;
    expect(call[1]).toEqual({ p_slug: 'acme', p_action: 'first_admin_created', p_detail: 'a@b.com', p_actor: 'owner@example.com' });
    expect(JSON.stringify(call)).not.toContain('Temp-Pass-123');
    expect(vi.mocked(createFirstAdmin)).toHaveBeenCalledWith(expect.anything(), { companyId: row.id, email: 'a@b.com', fullName: 'Ann Admin' });
    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://prod.supabase.co', 'p-svc', expect.anything());
  });

  it('still shows the password, with a warning, when the history entry fails', async () => {
    existing = row;
    withLogError({ message: 'boom' });
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toContain('could not be recorded in the history');
  });

  it('with email on, invites on the company address and records it, with no password', async () => {
    existing = row;
    flags.email = true;
    const r = await firstAdmin({}, form(admin));
    expect(vi.mocked(inviteFirstAdmin)).toHaveBeenCalledWith(expect.anything(), { companyId: row.id, email: 'a@b.com', fullName: 'Ann Admin' });
    expect(r.ok).toBe('Invite sent to a@b.com.');
    expect(r.password).toBeUndefined();
    expect(logged('first_admin_invited')).toEqual(['a@b.com']);
  });

  it('says the password was reset for the company\'s own existing login', async () => {
    existing = row;
    vi.mocked(createFirstAdmin).mockResolvedValueOnce({ outcome: 'reset', password: 'Temp-Pass-456' });
    const r = await firstAdmin({}, form(admin));
    expect(r.ok).toBe('Password reset for the existing login.');
    expect(r.password).toBe('Temp-Pass-456');
  });
});

describe('setCompanyPlan', () => {
  const PLAN = 'c0000000-0000-4000-8000-0000000000bb';
  const data = { slug: 'acme', kind: 'course_organizer', plan_id: PLAN, extra_statistics: 'on' };
  it('passes the parsed values and the admin email to the store', async () => {
    const r = await setCompanyPlan({}, form(data));
    expect(rpc).toHaveBeenCalledWith('console_set_company_plan', { p_slug: 'acme', p_kind: 'course_organizer', p_plan: PLAN, p_extras: ['statistics'], p_actor: 'owner@example.com' });
    expect(r).toEqual({ ok: 'Saved.' });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/console/companies/acme');
  });
  it('returns the store error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Choose a plan for this type of company.' } });
    expect((await setCompanyPlan({}, form(data))).error).toBe('Choose a plan for this type of company.');
  });
  it('refuses a bad form before calling the database', async () => {
    expect((await setCompanyPlan({}, form({ ...data, plan_id: '' }))).error).toBe('Choose a plan for this type of company.');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('needs a signed-in console admin', async () => {
    vi.mocked(requireConsoleAdmin).mockRejectedValueOnce(new Error('REDIRECT:/console/login'));
    await expect(setCompanyPlan({}, form(data))).rejects.toThrow('REDIRECT:/console/login');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('savePlan', () => {
  it('creates a plan with the ticked modules and the admin email', async () => {
    const r = await savePlan({}, form({ name: 'Starter', kind: 'course_organizer', module_inventory: 'on', module_statistics: 'on' }));
    expect(rpc).toHaveBeenCalledWith('console_save_plan', { p_id: null, p_name: 'Starter', p_kind: 'course_organizer', p_modules: ['inventory', 'statistics'], p_actor: 'owner@example.com' });
    expect(r).toEqual({ ok: 'Saved.' });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/console/plans');
  });
  it('returns the store error and needs an admin', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'A plan called Starter already exists.' } });
    expect((await savePlan({}, form({ name: 'Starter', kind: 'course_organizer' }))).error).toBe('A plan called Starter already exists.');
    vi.mocked(requireConsoleAdmin).mockRejectedValueOnce(new Error('REDIRECT:/console/login'));
    await expect(savePlan({}, form({ name: 'Starter', kind: 'course_organizer' }))).rejects.toThrow('REDIRECT');
  });
});
