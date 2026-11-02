import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bindSessionToCompany, ensureSessionCompany } from './company-session';

const A = 'a7c0de00-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-0000000000b2';

/** rpc answers: my_session_company gives `bound`, bind_my_session gives `bindError`. */
function client(o: { bound?: string | null; bindError?: unknown; readError?: unknown; signOutError?: unknown } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'my_session_company') return { data: o.bound ?? null, error: o.readError ?? null };
    if (name === 'bind_my_session') return { data: null, error: o.bindError ?? null };
    throw new Error(`unexpected rpc ${name}`);
  });
  const signOut = vi.fn(async () => ({ error: o.signOutError ?? null }));
  return { supabase: { rpc, auth: { signOut } } as unknown as SupabaseClient, rpc, signOut };
}

describe('bindSessionToCompany', () => {
  it('binds the session to the company', async () => {
    const c = client();
    expect(await bindSessionToCompany(c.supabase, A)).toBe('ok');
    expect(c.rpc).toHaveBeenCalledWith('bind_my_session', { p_company: A });
    expect(c.signOut).not.toHaveBeenCalled();
  });
  it('a refused bind signs the session out', async () => {
    const c = client({ bindError: { message: 'You do not have access to this company.', hint: 'user' } });
    expect(await bindSessionToCompany(c.supabase, A)).toBe('refused');
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('a failed bind that is not a refusal is an error and keeps the session', async () => {
    const c = client({ bindError: { message: 'connection reset' } });
    await expect(bindSessionToCompany(c.supabase, A)).rejects.toThrow();
    expect(c.signOut).not.toHaveBeenCalled();
  });
  it('a refusal whose sign-out fails is an error', async () => {
    const c = client({ bindError: { message: 'You do not have access to this company.', hint: 'user' }, signOutError: { message: 'x' } });
    await expect(bindSessionToCompany(c.supabase, A)).rejects.toThrow();
  });
});

describe('ensureSessionCompany', () => {
  it('an unbound session is bound (lazy)', async () => {
    const c = client({ bound: null });
    expect(await ensureSessionCompany(c.supabase, A)).toBe('ok');
    expect(c.rpc).toHaveBeenCalledWith('bind_my_session', { p_company: A });
    expect(c.signOut).not.toHaveBeenCalled();
  });
  it('an unbound session that cannot be bound is signed out', async () => {
    const c = client({ bound: null, bindError: { message: 'You do not have access to this company.', hint: 'user' } });
    expect(await ensureSessionCompany(c.supabase, A)).toBe('refused');
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('a session bound to this company passes without binding again', async () => {
    const c = client({ bound: A });
    expect(await ensureSessionCompany(c.supabase, A)).toBe('ok');
    expect(c.rpc).not.toHaveBeenCalledWith('bind_my_session', expect.anything());
    expect(c.signOut).not.toHaveBeenCalled();
  });
  it('a session bound to another company is signed out', async () => {
    const c = client({ bound: B });
    expect(await ensureSessionCompany(c.supabase, A)).toBe('refused');
    expect(c.rpc).not.toHaveBeenCalledWith('bind_my_session', expect.anything());
    expect(c.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('a session bound elsewhere whose sign-out fails is an error', async () => {
    const c = client({ bound: B, signOutError: { message: 'x' } });
    await expect(ensureSessionCompany(c.supabase, A)).rejects.toThrow();
  });
  it('a failed read is an error, not a refusal', async () => {
    const c = client({ readError: { message: 'boom' } });
    await expect(ensureSessionCompany(c.supabase, A)).rejects.toThrow();
    expect(c.signOut).not.toHaveBeenCalled();
  });
});
