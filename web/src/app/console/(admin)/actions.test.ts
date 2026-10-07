import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('@/lib/console/session', () => ({ requireConsoleAdmin: vi.fn(async () => ({ userId: 'u1', email: 'owner@example.com' })) }));
vi.mock('@/lib/console/first-admin', () => ({ createFirstAdmin: vi.fn(async () => ({ password: 'Temp-Pass-123', created: true })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/tenant/check', () => ({ checkTenant: vi.fn() }));

const rpc = vi.fn();
let existing: object | null = null;
vi.mock('@/lib/console/supabase', () => ({
  createConsoleServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
  }),
}));

import { checkTenant } from '@/lib/tenant/check';
import { firstAdmin, registerCompany, replaceCompanyKeys, setCompanyStatus } from './actions';

const check = vi.mocked(checkTenant);
const KEY = 'k'.repeat(30);
const row = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'a' };

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}
const registerData = {
  slug: 'acme', name: 'Acme', hosts: 'acme.example.com', supabaseUrl: 'https://abcdefgh.supabase.co',
  anonKey: KEY, serviceRoleKey: KEY, databaseUrl: 'postgres://u:p@host:5432/db',
};
const keysData = { slug: 'acme', supabaseUrl: registerData.supabaseUrl, anonKey: KEY, serviceRoleKey: KEY, databaseUrl: registerData.databaseUrl };
const noSecrets = (values?: Record<string, string>) => {
  expect(values).toBeDefined();
  for (const k of ['anonKey', 'serviceRoleKey', 'databaseUrl']) expect(values).not.toHaveProperty(k);
};

beforeEach(() => {
  vi.clearAllMocks();
  existing = null;
  check.mockResolvedValue([]);
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('registerCompany', () => {
  it('refuses an existing slug before checking or saving anything', async () => {
    existing = row;
    const r = await registerCompany({}, form(registerData));
    expect(r.error).toBe('A company with this slug already exists — open it to replace its keys.');
    noSecrets(r.values);
    expect(check).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not save when the check reports problems', async () => {
    check.mockResolvedValue(['service key rejected']);
    const r = await registerCompany({}, form(registerData));
    expect(r.error).toContain("Not saved — the project didn't pass the check: service key rejected");
    noSecrets(r.values);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not save when the project cannot be reached', async () => {
    check.mockRejectedValue(new Error('fetch failed'));
    const r = await registerCompany({}, form(registerData));
    expect(r.error).toBe("Not saved — couldn't reach the project: fetch failed");
    noSecrets(r.values);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('strips keys from a validation error too', async () => {
    const r = await registerCompany({}, form({ ...registerData, slug: 'X' }));
    expect(r.error).toBeTruthy();
    noSecrets(r.values);
    expect(r.values?.name).toBe('Acme');
  });

  it('saves with the actor and redirects to the company', async () => {
    await expect(registerCompany({}, form(registerData))).rejects.toThrow('REDIRECT:/console/companies/acme');
    expect(rpc).toHaveBeenCalledWith('console_register_tenant', expect.objectContaining({ p_slug: 'acme', p_actor: 'owner@example.com' }));
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
  const withKey = (logError: { message: string } | null = null) =>
    rpc.mockImplementation(async (name: string) =>
      name === 'tenant_secret' ? { data: 'svc-key', error: null } : { data: null, error: name === 'console_log' ? logError : null },
    );

  it('records who created the login and for whom, never the password', async () => {
    existing = row;
    withKey();
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toBe('Admin login created.');
    const call = rpc.mock.calls.find(([name]) => name === 'console_log')!;
    expect(call[1]).toEqual({ p_slug: 'acme', p_action: 'first_admin_created', p_detail: 'a@b.com', p_actor: 'owner@example.com' });
    expect(JSON.stringify(call)).not.toContain('Temp-Pass-123');
  });

  it('still shows the password, with a warning, when the history entry fails', async () => {
    existing = row;
    withKey({ message: 'boom' });
    const r = await firstAdmin({}, form(admin));
    expect(r.password).toBe('Temp-Pass-123');
    expect(r.ok).toContain('could not be recorded in the history');
  });
});
