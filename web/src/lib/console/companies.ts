import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkTenant } from '@/lib/tenant/check';

export type CompanyRow = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; supabase_url: string; anon_key: string; company_id: string | null };
export type CompanyHealth = { problems: string[]; users: number | null; patients: number | null };

const COLUMNS = 'slug, name, hosts, status, supabase_url, anon_key, company_id';

export async function listCompanies(control: SupabaseClient): Promise<CompanyRow[]> {
  const { data, error } = await control.from('tenants').select(COLUMNS).order('slug');
  if (error) throw new Error('Could not load the companies.');
  return (data ?? []) as CompanyRow[];
}

export async function getCompany(control: SupabaseClient, slug: string): Promise<CompanyRow | null> {
  const { data } = await control.from('tenants').select(COLUMNS).eq('slug', slug).maybeSingle();
  return (data as CompanyRow | null) ?? null;
}

/** Change history; secrets never live in tenants rows, so `changed` is safe to show. */
export async function companyAudit(control: SupabaseClient, slug: string) {
  const { data } = await control.from('tenant_audit').select('at, action, actor, reason, before, after').eq('slug', slug).order('at', { ascending: false }).limit(50);
  return ((data ?? []) as { at: string; action: string; actor: string; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]).map((r) => ({
    at: r.at, action: r.action, actor: r.actor, reason: r.reason,
    changed: Object.keys(r.after ?? {}).filter((k) => k !== 'updated_at' && JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k])),
  }));
}

export async function serviceKeyOf(control: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await control.rpc('tenant_secret', { p_slug: slug, p_name: 'service_role_key' });
  return (data as string | null) ?? null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

const connectDefault = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Is the company's project answering with its keys, and how many active logins / patients of this company
 *  (counts only; the service role sees every company, so both counts filter by its id). */
export async function companyHealth(
  control: SupabaseClient,
  slug: string,
  opts: { timeoutMs?: number; connect?: (url: string, key: string) => SupabaseClient; fetchImpl?: typeof fetch } = {},
): Promise<CompanyHealth> {
  const company = await getCompany(control, slug);
  if (!company) return { problems: [`Unknown company ${slug}`], users: null, patients: null };
  const serviceRoleKey = await serviceKeyOf(control, slug);
  if (!serviceRoleKey) return { problems: ['No service key in Vault'], users: null, patients: null };
  const companyId = company.company_id;
  if (!companyId) return { problems: ['No company in the database yet'], users: null, patients: null };
  try {
    return await withTimeout((async () => {
      const problems = await checkTenant({ supabaseUrl: company.supabase_url, anonKey: company.anon_key, serviceRoleKey }, opts.fetchImpl, opts.connect);
      if (problems.length) return { problems, users: null, patients: null };
      const db = (opts.connect ?? connectDefault)(company.supabase_url, serviceRoleKey);
      const [users, patients] = await Promise.all([
        db.from('company_members').select('user_id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true),
        db.from('patients').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      ]);
      const failure = users.error ?? patients.error;
      if (failure) return { problems: [`Couldn't count users or patients: ${failure.message}`], users: null, patients: null };
      return { problems: [], users: users.count ?? null, patients: patients.count ?? null };
    })(), opts.timeoutMs ?? 5000);
  } catch (e) {
    return { problems: [`Couldn't check: ${(e as Error).message}`], users: null, patients: null };
  }
}
