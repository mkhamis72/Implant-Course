import { Client } from 'pg';
import { migrateTarget } from './migrate-target';

/**
 * Companies as the operations scripts see them: rows of the control project's `tenants` table plus their
 * Vault secrets, turned into the env a script reads. Under GitHub Actions every secret is masked first.
 */
export type Env = Record<string, string | undefined>;
export type TenantRow = { slug: string; name: string; status: 'active' | 'suspended'; supabase_url: string; anon_key: string };
export type TenantSecrets = { serviceRoleKey: string; databaseUrl: string };
export type Company = { tenant: TenantRow; secrets: TenantSecrets };

export async function withControl<T>(env: Env, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(migrateTarget(['--control'], env).config);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function listTenants(c: Client): Promise<TenantRow[]> {
  const { rows } = await c.query<TenantRow>('select slug, name, status, supabase_url, anon_key from public.tenants order by slug');
  return rows;
}

export async function tenantSecrets(c: Client, slug: string): Promise<TenantSecrets> {
  const read = async (name: 'service_role_key' | 'database_url') => {
    const { rows } = await c.query<{ value: string | null }>('select public.tenant_secret($1, $2) as value', [slug, name]);
    if (!rows[0]?.value) throw new Error(`Company ${slug} has no ${name} in Vault; register it again with tenant:register.`);
    return rows[0].value;
  };
  return { serviceRoleKey: await read('service_role_key'), databaseUrl: await read('database_url') };
}

export function tenantEnvFrom({ tenant, secrets }: Company, caPath: string | undefined): Env {
  return {
    NEXT_PUBLIC_SUPABASE_URL: tenant.supabase_url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: tenant.anon_key,
    SUPABASE_SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    DATABASE_URL: secrets.databaseUrl,
    DATABASE_CA_CERT: caPath,
  };
}

export function maskLines({ tenant, secrets }: Company, env: Env): string[] {
  if (env.GITHUB_ACTIONS !== 'true') return [];
  return [secrets.serviceRoleKey, secrets.databaseUrl, tenant.anon_key].map((v) => `::add-mask::${v}`);
}

export function companyLabel(t: TenantRow): string {
  return `${t.slug} ${new URL(t.supabase_url).host}`;
}

export function takeTenantArg(argv: string[]): { slug: string | null; rest: string[] } {
  // Check for --tenant=<slug> syntax
  if (argv.some((arg) => arg.startsWith('--tenant='))) throw new Error('Usage: --tenant <slug>');
  // Check for repeated --tenant
  if (argv.filter((arg) => arg === '--tenant').length > 1) throw new Error('Usage: --tenant <slug>');
  const i = argv.indexOf('--tenant');
  if (i === -1) return { slug: null, rest: argv };
  const slug = argv[i + 1];
  if (!slug || slug.startsWith('--')) throw new Error('Usage: --tenant <slug>');
  return { slug, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

/** Every company (or just `only`), secrets read and masked before anything else is printed. */
export async function loadCompanies(env: Env, log: (line: string) => void, only?: string): Promise<Company[]> {
  const companies = await withControl(env, async (c) => {
    const tenants = (await listTenants(c)).filter((t) => !only || t.slug === only);
    if (only && !tenants.length) throw new Error(`No company ${only} in the control project.`);
    const out: Company[] = [];
    for (const tenant of tenants) out.push({ tenant, secrets: await tenantSecrets(c, tenant.slug) });
    return out;
  });
  for (const company of companies) for (const line of maskLines(company, env)) log(line);
  return companies;
}

/** `--tenant <slug>`: point this script at that company by overlaying its env; the label is for "Target project". */
export async function applyTenantArg(
  argv: string[],
  env: Env,
  log: (line: string) => void = console.log,
): Promise<{ argv: string[]; label: string | null }> {
  const { slug, rest } = takeTenantArg(argv);
  if (!slug) return { argv, label: null };
  const [company] = await loadCompanies(env, log, slug);
  Object.assign(env, tenantEnvFrom(company, env.CONTROL_DATABASE_CA_CERT ?? env.DATABASE_CA_CERT));
  return { argv: rest, label: companyLabel(company.tenant) };
}

/** A file `source`-able by bash: each value single-quoted, embedded quotes as '\''. */
export function envFileText(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}='${v.replaceAll("'", "'\\''")}'\n`).join('');
}
