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

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** Impersonates a Supabase user (or anon when userId is null) for the rest of the transaction.
 *  Without a session_id claim, the user gets a new sign-in session bound to academy when they are an
 *  academy member (any row, active or not, as bind_session allows), so the guards (0089) see their
 *  academy membership. Pass a session_id to manage the binding yourself: that session starts unbound
 *  (session_id: undefined gives a JWT with no session id at all). */
export async function actAs(c: Client, userId: string | null, extraClaims: Record<string, unknown> = {}): Promise<void> {
  await c.query('reset role');
  if (userId === null) {
    await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await c.query('set local role anon');
    return;
  }
  const claims: Record<string, unknown> = { sub: userId, role: 'authenticated', ...extraClaims };
  if (!('session_id' in extraClaims)) {
    claims.session_id = crypto.randomUUID();
    await c.query(`insert into app.session_companies (session_id, company_id, user_id)
      select $1, m.company_id, m.user_id from public.company_members m where m.company_id = $2 and m.user_id = $3`,
    [claims.session_id, ACADEMY_ID, userId]);
  }
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await c.query('set local role authenticated');
}

/** Impersonates the user with a new sign-in session bound to the company (academy by default), as the
 *  company-aware app does after sign-in. Definers that act on the caller's company (0087) need it. */
export async function actAsBound(
  c: Client, userId: string, company = ACADEMY_ID,
): Promise<void> {
  await actAs(c, userId, { session_id: crypto.randomUUID() });
  await c.query('select public.bind_my_session($1)', [company]);
}

/** Stays postgres (bypassing RLS) but with a fixture session bound to the company, so column defaults
 *  resolve: company_id (0092: the session's company, null without one) and created_by. The session's user
 *  is userId, else one of the company's members. For fixtures that write as postgres. */
export async function asCompany(c: Client, companyId = ACADEMY_ID, userId?: string): Promise<void> {
  await c.query('reset role');
  const user = userId ?? (await c.query(
    'select user_id from public.company_members where company_id = $1 order by created_at limit 1', [companyId],
  )).rows[0]?.user_id;
  if (!user) throw new Error(`asCompany: company ${companyId} has no member to act as`);
  const session = crypto.randomUUID();
  await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)',
    [session, companyId, user]);
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: user, role: 'authenticated', session_id: session })]);
}

/** Back to the connection's own (postgres) role, bypassing RLS. */
export async function asPostgres(c: Client): Promise<void> {
  await c.query('reset role');
}
