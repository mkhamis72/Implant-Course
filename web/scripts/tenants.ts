import type { Client } from 'pg';

export type RegisterInput = {
  slug: string; name: string; hosts: string[]; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string;
  /** Written when given; an existing company id is kept when omitted. */
  companyId?: string;
};

export function parseRegisterArgs(argv: string[]): { slug: string; name: string; hosts: string[]; companyId?: string } {
  const rest = [...argv];
  let companyId: string | undefined;
  const at = rest.indexOf('--company');
  if (at >= 0) {
    companyId = rest[at + 1];
    if (!companyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw new Error('--company needs a company id (uuid)');
    rest.splice(at, 2);
  }
  const [slug, name, ...hosts] = rest;
  if (!slug || !name || hosts.length === 0) throw new Error('Usage: npm run tenant:register -- <slug> "<name>" <host> [more hosts] [--company <uuid>]');
  return { slug, name, hosts, companyId };
}

/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
    t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey, t.serviceRoleKey, t.databaseUrl, 'script',
  ]);
  if (t.companyId) await c.query('update public.tenants set company_id = $2 where slug = $1', [t.slug, t.companyId]);
}

export { checkTenant } from '../src/lib/tenant/check';
