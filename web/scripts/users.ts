import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'pg';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL / service role key missing (see .env.example)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensureUser(
  admin: SupabaseClient,
  opts: { email: string; password: string; emailConfirm?: boolean },
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
  p: { full_name: string; role: 'admin' | 'organizer'; active: boolean },
): Promise<void> {
  // Upsert: users created before migration 0001 existed have no profile row yet.
  await pg.query(
    `insert into public.profiles (user_id, email, full_name, role, active)
     select u.id, lower(u.email), $2, $3, $4 from auth.users u where u.id = $1
     on conflict (user_id) do update
       set full_name = excluded.full_name, role = excluded.role, active = excluded.active`,
    [userId, p.full_name, p.role, p.active],
  );
}
