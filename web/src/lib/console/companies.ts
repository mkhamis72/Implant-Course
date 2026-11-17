import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkTenant } from '@/lib/tenant/check';
import type { CompanyKind, Module } from '@/lib/modules/modules';

export type CompanyRow = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; supabase_url: string; anon_key: string; company_id: string | null; kind: CompanyKind; plan_id: string; extra_modules: Module[] };
export type SharedProject = { supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string };
export type CompanyHealth = { problems: string[]; users: number | null; patients: number | null };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

const connectDefault = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Is the company's project answering with its keys, and how many active logins / patients of this company
 *  (counts only; the service role sees every company, so both counts filter by its id). */
export type CompanyLookup = { get(slug: string): Promise<CompanyRow | null>; serviceKey(slug: string): Promise<string | null> };

export async function companyHealth(
  lookup: CompanyLookup,
  slug: string,
  opts: { timeoutMs?: number; connect?: (url: string, key: string) => SupabaseClient; fetchImpl?: typeof fetch } = {},
): Promise<CompanyHealth> {
  const company = await lookup.get(slug);
  if (!company) return { problems: [`Unknown company ${slug}`], users: null, patients: null };
  const serviceRoleKey = await lookup.serviceKey(slug);
  if (!serviceRoleKey) return { problems: ['No service key'], users: null, patients: null };
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
