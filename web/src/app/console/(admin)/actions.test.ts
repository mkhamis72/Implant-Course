import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const SHARED = { supabaseUrl: 'https://abcdefgh.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc-key', databaseUrl: 'postgres://db' };
vi.mock('@/lib/console/companies', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sharedProject: vi.fn(async () => SHARED),
}));
const dbRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ rpc: dbRpc })) }));
vi.mock('@/lib/tenant/check', () => ({ checkTenant: vi.fn() }));

const rpc = vi.fn();
let existing: object | null = null;
vi.mock('@/lib/console/supabase', () => ({
  createConsoleServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
  }),
}));

import { createClient } from '@supabase/supabase-js';
import { checkTenant } from '@/lib/tenant/check';
import { createFirstAdmin, inviteFirstAdmin } from '@/lib/console/first-admin';
import { addProjectDomain } from '@/lib/console/vercel';
import { sharedProject } from '@/lib/console/companies';
import { addDomain, firstAdmin, onboardCompany, replaceCompanyKeys, setCompanyStatus, updateCompany } from './actions';

const check = vi.mocked(checkTenant);
const KEY = 'k'.repeat(30);
const NEW_COMPANY = 'c0000000-0000-4000-8000-0000000000aa';
const row = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'a' };

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}
const onboardData = { slug: 'acme', name: 'Acme', hosts: 'acme.imploid.net', email: 'ann@acme.com', fullName: 'Ann Admin' };
const keysData = { slug: 'acme', supabaseUrl: 'https://abcdefgh.supabase.co', anonKey: KEY, serviceRoleKey: KEY, databaseUrl: 'postgres://u:p@host:5432/db' };
const noSecrets = (values?: Record<string, string>) => {
  expect(values).toBeDefined();
  for (const k of ['anonKey', 'serviceRoleKey', 'databaseUrl']) expect(values).not.toHaveProperty(k);
};

beforeEach(() => {
  vi.clearAllMocks();
  existing = null;
  flags.email = false;
  flags.vercel = true;
  check.mockResolvedValue([]);
  rpc.mockResolvedValue({ data: null, error: null });
  dbRpc.mockResolvedValue({ data: NEW_COMPANY, error: null });
});

describe('onboardCompany', () => {
  const logged = (action: string) =>
    rpc.mock.calls.filter(([fn, a]) => fn === 'console_log' && a.p_action === action).map(([, a]) => a.p_detail);

  it('refuses a slug whose company already exists, before saving anything', async () => {
    existing = { ...row, company_id: NEW_COMPANY };
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toBe('A company with this slug already exists — open it from the list.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registers with the shared database keys, creates the company, adds the address and invites the admin', async () => {
    flags.email = true;
    const r = await onboardCompany({}, form(onboardData));
    expect(rpc).toHaveBeenCalledWith('console_register_tenant', {
      p_slug: 'acme', p_name: 'Acme', p_hosts: ['acme.imploid.net'], p_supabase_url: SHARED.supabaseUrl, p_anon_key: 'anon',
      p_service_role_key: 'svc-key', p_database_url: 'postgres://db', p_actor: 'owner@example.com',
    });
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(SHARED.supabaseUrl, 'svc-key', expect.anything());
    expect(dbRpc).toHaveBeenCalledWith('provision_company', { p_slug: 'acme', p_name: 'Acme' });
    expect(rpc).toHaveBeenCalledWith('console_set_company', { p_slug: 'acme', p_company_id: NEW_COMPANY, p_actor: 'owner@example.com' });
    expect(vi.mocked(addProjectDomain)).toHaveBeenCalledWith('acme.imploid.net');
    expect(logged('domain_added')).toEqual(['acme.imploid.net']);
    expect(vi.mocked(inviteFirstAdmin)).toHaveBeenCalledWith(expect.anything(), {
      companyId: NEW_COMPANY, companyName: 'Acme', email: 'ann@acme.com', fullName: 'Ann Admin', origin: 'https://acme.imploid.net',
    });
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

  it('stops before registering when the shared database is unknown', async () => {
    vi.mocked(sharedProject).mockRejectedValueOnce(new Error('No registered company serves academy, so the shared database is unknown.'));
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toContain('No registered company serves academy');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says so when the company cannot be created, and stores no id', async () => {
    dbRpc.mockResolvedValue({ data: null, error: { message: 'A company with this slug already exists.' } });
    const r = await onboardCompany({}, form(onboardData));
    expect(r.error).toBe('Registered, but the company could not be created in the database: A company with this slug already exists.');
    expect(rpc).not.toHaveBeenCalledWith('console_set_company', expect.anything());
  });

  it('a retry after the id could not be saved stores the same company (provision_company hands back the empty company)', async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'console_set_company' ? { data: null, error: { message: 'boom' } } : { data: null, error: null }));
    expect((await onboardCompany({}, form(onboardData))).error)
      .toBe(`Company ${NEW_COMPANY} was created in the database, but its id could not be saved in the registry: boom`);
    existing = { ...row, company_id: null };
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await onboardCompany({}, form(onboardData))).ok).toBe('Company added.');
    expect(dbRpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('console_set_company', { p_slug: 'acme', p_company_id: NEW_COMPANY, p_actor: 'owner@example.com' });
  });
});

describe('updateCompany and addDomain', () => {
  it('adds only the new addresses to Vercel', async () => {
    existing = { ...row, hosts: ['acme.example.com'] };
    const r = await updateCompany({}, form({ slug: 'acme', name: 'Acme', hosts: 'acme.example.com\nnew.imploid.net' }));
    expect(r.ok).toBe('Saved.');
    expect(vi.mocked(addProjectDomain).mock.calls).toEqual([['new.imploid.net']]);
  });

  it('retries only an address of the company', async () => {
    existing = row;
    expect((await addDomain({}, form({ slug: 'acme', host: 'evil.example.com' }))).error).toBe('evil.example.com is not an address of acme.');
    expect(vi.mocked(addProjectDomain)).not.toHaveBeenCalled();
    expect((await addDomain({}, form({ slug: 'acme', host: 'acme.example.com' }))).ok).toBe('acme.example.com added to Vercel.');
  });
});

describe('replaceCompanyKeys', () => {
  it('refuses an unknown company before checking', async () => {
    const r = await replaceCompanyKeys({}, form(keysData));
    expect(r.error).toBe('Unknown company acme');
    noSecrets(r.values);
    expect(check).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('strips keys when the check fails', async () => {
    existing = row;
    check.mockResolvedValue(['bad']);
    const r = await replaceCompanyKeys({}, form(keysData));
    expect(r.error).toContain('Not saved');
    noSecrets(r.values);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('replaces the keys with the actor', async () => {
    existing = row;
    const r = await replaceCompanyKeys({}, form(keysData));
    expect(r.ok).toBe('Keys replaced.');
    expect(rpc).toHaveBeenCalledWith('console_replace_secrets', expect.objectContaining({ p_slug: 'acme', p_actor: 'owner@example.com' }));
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
    expect(rpc).toHaveBeenCalledWith('console_set_status', { p_slug: 'acme', p_status: 'suspended', p_reason: 'Unpaid invoice', p_actor: 'owner@example.com' });
  });
});

describe('firstAdmin', () => {
  it('refuses an unknown company', async () => {
    const r = await firstAdmin({}, form({ slug: 'acme', email: 'a@b.com', fullName: 'Ann Admin' }));
    expect(r.error).toBe('Unknown company acme');
    expect(r.password).toBeUndefined();
  });

  const admin = { slug: 'acme', email: 'a@b.com', fullName: 'Ann Admin' };
  const linked = { ...row, company_id: 'c0000000-0000-4000-8000-00000000000c' };
  const withKey = (logError: { message: string } | null = null) =>
    rpc.mockImplementation(async (name: string) =>
      name === 'tenant_secret' ? { data: 'svc-key', error: null } : { data: null, error: name === 'console_log' ? logError : null },
    );

  it('records who created the login and for whom, never the password', async () => {
    existing = linked;
    withKey();
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toBe('Admin login created.');
    const call = rpc.mock.calls.find(([name]) => name === 'console_log')!;
    expect(call[1]).toEqual({ p_slug: 'acme', p_action: 'first_admin_created', p_detail: 'a@b.com', p_actor: 'owner@example.com' });
    expect(JSON.stringify(call)).not.toContain('Temp-Pass-123');
    expect(vi.mocked(createFirstAdmin)).toHaveBeenCalledWith(expect.anything(), { companyId: linked.company_id, email: 'a@b.com', fullName: 'Ann Admin' });
  });

  it('refuses a company not yet linked to the database', async () => {
    existing = row;
    withKey();
    vi.mocked(createFirstAdmin).mockClear();
    const r = await firstAdmin({}, form(admin));
    expect(r.error).toBe('acme has no company in the database yet');
    expect(r.password).toBeUndefined();
    expect(vi.mocked(createFirstAdmin)).not.toHaveBeenCalled();
  });

  it('still shows the password, with a warning, when the history entry fails', async () => {
    existing = linked;
    withKey({ message: 'boom' });
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toContain('could not be recorded in the history');
  });

  it('with email on, invites on the company address and records it, with no password', async () => {
    existing = linked;
    withKey();
    flags.email = true;
    const r = await firstAdmin({}, form(admin));
    expect(vi.mocked(inviteFirstAdmin)).toHaveBeenCalledWith(expect.anything(), {
      companyId: linked.company_id, companyName: 'Acme', email: 'a@b.com', fullName: 'Ann Admin', origin: 'https://acme.example.com',
    });
    expect(r.ok).toBe('Invite sent to a@b.com.');
    expect(r.password).toBeUndefined();
    const call = rpc.mock.calls.find(([name]) => name === 'console_log')!;
    expect(call[1]).toEqual({ p_slug: 'acme', p_action: 'first_admin_invited', p_detail: 'a@b.com', p_actor: 'owner@example.com' });
  });

  it('shows no password for an account another company uses', async () => {
    existing = linked;
    withKey();
    vi.mocked(createFirstAdmin).mockResolvedValueOnce({ outcome: 'added' });
    const r = await firstAdmin({}, form(admin));
    expect(r.ok).toBe('Added a@b.com as admin. They sign in with their existing password.');
    expect(r.password).toBeUndefined();
  });
});
