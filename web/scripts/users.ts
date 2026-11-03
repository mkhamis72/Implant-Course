import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient, type Client } from 'pg';
import { pgConfig } from './db';
import { ACADEMY_COMPANY_ID } from '../src/lib/tenant/types';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL / service role key missing (see .env.example)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A pending login for the email in the company's database (as postgres): a new Auth account needs one
 *  (handle_new_user, 0090) and becomes an active organizer of the company. setProfile sets the final role. */
export async function addPendingLogin(pg: Client, email: string, companyId = ACADEMY_COMPANY_ID): Promise<void> {
  await pg.query(
    `insert into app_private.pending_logins (company_id, email, role, created_by)
     values ($1, lower(trim($2)), 'organizer', '00000000-0000-0000-0000-000000000000')
     on conflict (company_id, email) do update set created_at = now()`,
    [companyId, email],
  );
}

/** addPendingLogin on its own connection to DATABASE_URL: for tests that create Auth accounts directly. */
export async function pendingLoginFor(email: string, companyId = ACADEMY_COMPANY_ID): Promise<void> {
  const pg = new PgClient(pgConfig());
  await pg.connect();
  try {
    await addPendingLogin(pg, email, companyId);
  } finally {
    await pg.end();
  }
}

/** Finds or creates the Auth account. Pass `pending` for a company database: a new account then gets a
 *  pending login there first (the control project has no handle_new_user). */
export async function ensureUser(
  admin: SupabaseClient,
  opts: { email: string; password: string; emailConfirm?: boolean; pending?: { pg: Client; companyId?: string } },
): Promise<string> {
  const email = opts.email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const existing = data.users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
        password: opts.password,
        ban_duration: 'none',
      });
      if (updateError) throw updateError;
      return existing.id;
    }
    if (data.users.length < 1000) break;
  }
  if (opts.pending) await addPendingLogin(opts.pending.pg, email, opts.pending.companyId);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: opts.password,
    email_confirm: opts.emailConfirm ?? true,
  });
  if (error) throw error;
  return data.user.id;
}

export async function setProfile(
  pg: Client,
  userId: string,
  p: { full_name: string; role: 'admin' | 'organizer' | 'delegate'; active: boolean; delegate_id?: string | null },
  companyId = ACADEMY_COMPANY_ID,
): Promise<void> {
  // The name is the person's (profiles); role, active and the delegate link are the company's membership
  // (0090: nothing reads them on profiles). A delegate login names its delegate; staff never keep one.
  await pg.query(
    `insert into public.profiles (user_id, email, full_name)
     select u.id, lower(u.email), $2 from auth.users u where u.id = $1
     on conflict (user_id) do update set full_name = excluded.full_name`,
    [userId, p.full_name],
  );
  await pg.query(
    `insert into public.company_members (company_id, user_id, role, active, delegate_id) values ($1, $2, $3, $4, $5)
     on conflict (company_id, user_id) do update
       set role = excluded.role, active = excluded.active, delegate_id = excluded.delegate_id`,
    [companyId, userId, p.role, p.active, p.role === 'delegate' ? (p.delegate_id ?? null) : null],
  );
}

/** Replaces a user's area permissions in the company (migration 0030 on). Unlisted areas become None. */
export async function setPermissions(
  pg: Client, userId: string, perms: Record<string, 'view' | 'edit'>, companyId = ACADEMY_COMPANY_ID,
): Promise<void> {
  await pg.query('delete from public.user_permissions where company_id = $1 and user_id = $2', [companyId, userId]);
  for (const [area, level] of Object.entries(perms)) {
    await pg.query('insert into public.user_permissions (company_id, user_id, area, level) values ($1, $2, $3, $4)',
      [companyId, userId, area, level]);
  }
}
