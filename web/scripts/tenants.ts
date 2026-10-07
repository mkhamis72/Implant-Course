import type { Client } from 'pg';

export type RegisterInput = {
  slug: string; name: string; hosts: string[]; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string;
};

export function parseRegisterArgs(argv: string[]): { slug: string; name: string; hosts: string[] } {
  const [slug, name, ...hosts] = argv;
  if (!slug || !name || hosts.length === 0) throw new Error('Usage: npm run tenant:register -- <slug> "<name>" <host> [more hosts]');
  return { slug, name, hosts };
}

/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
    t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey, t.serviceRoleKey, t.databaseUrl, 'script',
  ]);
}

export { checkTenant } from '../src/lib/tenant/check';
