import type { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

export type RegisterInput = {
  slug: string; name: string; hosts: string[]; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string;
};

export function parseRegisterArgs(argv: string[]): { slug: string; name: string; hosts: string[] } {
  const [slug, name, ...hosts] = argv;
  if (!slug || !name || hosts.length === 0) throw new Error('Usage: npm run tenant:register -- <slug> "<name>" <host> [more hosts]');
  return { slug, name, hosts };
}

async function upsertSecret(c: Client, name: string, value: string) {
  const { rows } = await c.query('select id from vault.secrets where name = $1', [name]);
  if (rows[0]) await c.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await c.query('select vault.create_secret($1, $2)', [value, name]);
}

/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query(
    `insert into public.tenants (slug, name, hosts, supabase_url, anon_key)
     values ($1, $2, $3, $4, $5)
     on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts,
       supabase_url = excluded.supabase_url, anon_key = excluded.anon_key`,
    [t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey],
  );
  await upsertSecret(c, `tenant/${t.slug}/service_role_key`, t.serviceRoleKey);
  await upsertSecret(c, `tenant/${t.slug}/database_url`, t.databaseUrl);
}

/** Problems with a company's URL and keys (empty when both the public and the service key work). */
export async function checkTenant(
  t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const problems: string[] = [];
  const res = await fetchImpl(`${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
  if (!res.ok) problems.push(`Anon key rejected by ${t.supabaseUrl} (${res.status})`);
  const admin = createClient(t.supabaseUrl, t.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from('profiles').select('user_id').limit(1);
  if (error) problems.push(`Service key can't read profiles: ${error.message}`);
  return problems;
}
