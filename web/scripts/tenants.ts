import type { Client } from 'pg';

export type RegisterInput = {
  slug: string; name: string; hosts: string[]; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string;
  /** Written when given; an existing company id is kept when omitted. */
  companyId?: string;
};

export function parseRegisterArgs(argv: string[]): { slug: string; name: string; hosts: string[]; companyId?: string; provision?: true } {
  const rest = [...argv];
  let companyId: string | undefined;
  const provisionAt = rest.indexOf('--provision');
  if (provisionAt >= 0) rest.splice(provisionAt, 1);
  const at = rest.indexOf('--company');
  if (at >= 0) {
    companyId = rest[at + 1];
    if (!companyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw new Error('--company needs a company id (uuid)');
    rest.splice(at, 2);
  }
  if (provisionAt >= 0 && companyId) throw new Error('Give either --provision or --company, not both');
  const [slug, name, ...hosts] = rest;
  if (!slug || !name || hosts.length === 0) throw new Error('Usage: npm run tenant:register -- <slug> "<name>" <host> [more hosts] [--provision | --company <uuid>]');
  return { slug, name, hosts, companyId, ...(provisionAt >= 0 && { provision: true as const }) };
}

/** Creates the company and its starting data in the shared database (0095; run with a postgres connection
 *  to the company's project) and returns its id. */
export async function provisionCompany(c: Client, slug: string, name: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>('select public.provision_company($1, $2) as id', [slug, name]);
  return rows[0].id;
}

/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
    t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey, t.serviceRoleKey, t.databaseUrl, 'script',
  ]);
  if (t.companyId) await c.query('update public.tenants set company_id = $2 where slug = $1', [t.slug, t.companyId]);
}

/** The tenant's company id: null when none is set, undefined before control 0004 added the column. */
export async function tenantCompanyId(c: Client, slug: string): Promise<string | null | undefined> {
  const column = await c.query(
    "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'company_id'",
  );
  if (!column.rowCount) return undefined;
  const { rows } = await c.query<{ company_id: string | null }>('select company_id from public.tenants where slug = $1', [slug]);
  return rows[0]?.company_id ?? null;
}

/** The app serves a tenant without a company as suspended. */
export function nullCompanyWarning(slug: string, companyId: string | null | undefined): string | null {
  return companyId === null ? `Warning: ${slug} has no company id, so it answers 503 until one is set (run again with --company <uuid>).` : null;
}

export { checkTenant } from '../src/lib/tenant/check';
