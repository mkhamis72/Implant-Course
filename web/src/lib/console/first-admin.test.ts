import { describe, it, expect, vi } from 'vitest';
import { createFirstAdmin } from './first-admin';

vi.mock('server-only', () => ({}));

const COMPANY = 'b0000000-0000-4000-8000-00000000000b';

function fakeCompany(existing: string | null, rpcError: string | null = null, createError: string | null = null) {
  const calls: string[] = [];
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: existing ? [{ user_id: existing }] : [], error: null }) }) }),
      update: () => { throw new Error('profiles must not be updated'); },
    }),
    rpc: vi.fn(async (fn: string, args: object) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      return { data: null, error: rpcError ? { message: rpcError } : null };
    }),
    auth: { admin: {
      createUser: vi.fn(async () => {
        calls.push('create');
        return createError ? { data: { user: null }, error: { message: createError } } : { data: { user: { id: 'new-id' } }, error: null };
      }),
      updateUserById: vi.fn(async (id: string) => { calls.push(`reset ${id}`); return { data: {}, error: null }; }),
    } },
  };
  return { client: client as never, calls };
}

const rpcCall = `console_add_first_admin {"p_company":"${COMPANY}","p_email":"owner@acme.com","p_full_name":"Dr Owner"}`;

describe('createFirstAdmin', () => {
  it("writes the company's pending admin login, then creates the confirmed user", async () => {
    const { client, calls } = fakeCompany(null);
    const r = await createFirstAdmin(client, { companyId: COMPANY, email: ' Owner@Acme.com ', fullName: 'Dr Owner' });
    expect(r.created).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    expect(calls).toEqual([rpcCall, 'create']);
  });

  it("adds an existing user's admin membership and resets their password instead", async () => {
    const { client, calls } = fakeCompany('old-id');
    const r = await createFirstAdmin(client, { companyId: COMPANY, email: 'owner@acme.com', fullName: 'Dr Owner' });
    expect(r.created).toBe(false);
    expect(calls).toEqual([rpcCall, 'reset old-id']);
  });

  it('creates no Auth user when the database refuses the admin', async () => {
    const { client, calls } = fakeCompany(null, 'Unknown company.');
    await expect(createFirstAdmin(client, { companyId: COMPANY, email: 'owner@acme.com', fullName: 'Dr Owner' }))
      .rejects.toThrow('The login was not finished: Unknown company.');
    expect(calls).toEqual([rpcCall]);
  });

  it('reports a failed Auth call', async () => {
    const { client } = fakeCompany(null, null, 'email exists');
    await expect(createFirstAdmin(client, { companyId: COMPANY, email: 'owner@acme.com', fullName: 'Dr Owner' }))
      .rejects.toThrow('The login could not be created: email exists');
  });
});
