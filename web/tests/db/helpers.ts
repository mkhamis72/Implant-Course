import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';

/** Runs fn inside a transaction that is always rolled back. */
export async function withTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(pgConfig());
  await c.connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => {});
    await c.end();
  }
}

/** Impersonates a Supabase user (or anon when userId is null) for the rest of the transaction. */
export async function actAs(c: Client, userId: string | null, extraClaims: Record<string, unknown> = {}): Promise<void> {
  await c.query('reset role');
  if (userId === null) {
    await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await c.query('set local role anon');
    return;
  }
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', ...extraClaims }),
  ]);
  await c.query('set local role authenticated');
}

/** Impersonates the user with a new sign-in session bound to the company (academy by default), as the
 *  company-aware app does after sign-in. Definers that act on the caller's company (0087) need it. */
export async function actAsBound(
  c: Client, userId: string, company = 'a7c0de00-0000-4000-8000-000000000001',
): Promise<void> {
  await actAs(c, userId, { session_id: crypto.randomUUID() });
  await c.query('select public.bind_my_session($1)', [company]);
}

/** Back to the connection's own (postgres) role, bypassing RLS. */
export async function asPostgres(c: Client): Promise<void> {
  await c.query('reset role');
}
