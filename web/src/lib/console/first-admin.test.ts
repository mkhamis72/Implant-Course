import { describe, it, expect, vi } from 'vitest';
import { createFirstAdmin } from './first-admin';

vi.mock('server-only', () => ({}));

function fakeCompany(existing: string | null, profileError: string | null = null) {
  const calls: string[] = [];
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing ? { user_id: existing } : null, error: null }) }) }),
      update: (values: object) => ({ eq: async () => { calls.push(`update ${JSON.stringify(values)}`); return { error: profileError ? { message: profileError } : null }; } }),
    }),
    auth: { admin: {
      createUser: vi.fn(async () => { calls.push('create'); return { data: { user: { id: 'new-id' } }, error: null }; }),
      updateUserById: vi.fn(async (id: string) => { calls.push(`reset ${id}`); return { data: {}, error: null }; }),
      deleteUser: vi.fn(async (id: string) => { calls.push(`delete ${id}`); return { data: {}, error: null }; }),
    } },
  };
  return { client: client as never, calls };
}

describe('createFirstAdmin', () => {
  it('creates a confirmed user and makes them an active admin', async () => {
    const { client, calls } = fakeCompany(null);
    const r = await createFirstAdmin(client, { email: ' Owner@Acme.com ', fullName: 'Dr Owner' });
    expect(r.created).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    expect(calls).toEqual(['create', 'update {"full_name":"Dr Owner","role":"admin","active":true,"delegate_id":null}']);
  });

  it('resets the password of an existing user instead', async () => {
    const { client, calls } = fakeCompany('old-id');
    const r = await createFirstAdmin(client, { email: 'owner@acme.com', fullName: 'Dr Owner' });
    expect(r.created).toBe(false);
    expect(calls[0]).toBe('reset old-id');
  });

  it('removes a just-created user when the profile can’t be set', async () => {
    const { client, calls } = fakeCompany(null, 'permission denied');
    await expect(createFirstAdmin(client, { email: 'owner@acme.com', fullName: 'Dr Owner' })).rejects.toThrow('The login was not finished: permission denied');
    expect(calls.at(-1)).toBe('delete new-id');
  });
});
