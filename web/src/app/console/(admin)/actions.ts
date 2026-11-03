'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { getCompany, serviceKeyOf } from '@/lib/console/companies';
import { createFirstAdmin } from '@/lib/console/first-admin';
import { firstAdminSchema, registerSchema, secretsSchema, statusSchema, updateSchema } from '@/lib/console/schemas';
import { checkTenant } from '@/lib/tenant/check';
import { failed, type FormState } from '@/lib/patients/form-state';

const SECRET_FIELDS = ['anonKey', 'serviceRoleKey', 'databaseUrl'];
/** Keeps what was typed after an error, except keys: they are never sent back to the browser. */
function failedWithoutSecrets(message: string, formData: FormData): FormState {
  const state = failed(message, formData);
  for (const k of SECRET_FIELDS) delete state.values?.[k];
  return state;
}
const fields = (formData: FormData) => Object.fromEntries(formData);

type Tenant = { supabaseUrl: string; anonKey: string; serviceRoleKey: string };
/** A message when the project fails the check or cannot be reached at all; null when it passes. */
async function checkProblem(t: Tenant): Promise<string | null> {
  try {
    const problems = await checkTenant(t);
    return problems.length ? `Not saved — the project didn't pass the check: ${problems.join('; ')}` : null;
  } catch (e) {
    return `Not saved — couldn't reach the project: ${(e as Error).message}`;
  }
}

export async function registerCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = registerSchema.safeParse(fields(formData));
  if (!parsed.success) return failedWithoutSecrets(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const control = createConsoleServiceClient();
  if (await getCompany(control, c.slug)) {
    return failedWithoutSecrets('A company with this slug already exists — open it to replace its keys.', formData);
  }
  const problem = await checkProblem({ supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, serviceRoleKey: c.serviceRoleKey });
  if (problem) return failedWithoutSecrets(problem, formData);
  const { error } = await control.rpc('console_register_tenant', {
    p_slug: c.slug, p_name: c.name, p_hosts: c.hosts, p_supabase_url: c.supabaseUrl, p_anon_key: c.anonKey,
    p_service_role_key: c.serviceRoleKey, p_database_url: c.databaseUrl, p_actor: admin.email,
  });
  if (error) return failedWithoutSecrets(error.message, formData);
  revalidatePath('/console');
  redirect(`/console/companies/${c.slug}`);
}

export async function updateCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = updateSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const { error } = await createConsoleServiceClient().rpc('console_update_tenant', {
    p_slug: parsed.data.slug, p_name: parsed.data.name, p_hosts: parsed.data.hosts, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  revalidatePath(`/console/companies/${parsed.data.slug}`);
  return { ok: 'Saved.' };
}

export async function setCompanyStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = statusSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const s = parsed.data;
  const { error } = await createConsoleServiceClient().rpc('console_set_status', {
    p_slug: s.slug, p_status: s.status, p_reason: s.reason, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  revalidatePath(`/console/companies/${s.slug}`);
  revalidatePath('/console');
  return { ok: s.status === 'suspended' ? 'Suspended. Its users see “temporarily unavailable” within about a minute.' : 'Reactivated.' };
}

export async function replaceCompanyKeys(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = secretsSchema.safeParse(fields(formData));
  if (!parsed.success) return failedWithoutSecrets(parsed.error.issues[0].message, formData);
  const k = parsed.data;
  if (!(await getCompany(createConsoleServiceClient(), k.slug))) return failedWithoutSecrets(`Unknown company ${k.slug}`, formData);
  const problem = await checkProblem({ supabaseUrl: k.supabaseUrl, anonKey: k.anonKey, serviceRoleKey: k.serviceRoleKey });
  if (problem) return failedWithoutSecrets(problem, formData);
  const { error } = await createConsoleServiceClient().rpc('console_replace_secrets', {
    p_slug: k.slug, p_supabase_url: k.supabaseUrl, p_anon_key: k.anonKey, p_service_role_key: k.serviceRoleKey,
    p_database_url: k.databaseUrl, p_actor: admin.email,
  });
  if (error) return failedWithoutSecrets(error.message, formData);
  revalidatePath(`/console/companies/${k.slug}`);
  return { ok: 'Keys replaced.' };
}

export type FirstAdminState = FormState & { password?: string; email?: string; seq?: number };

export async function firstAdmin(_prev: FirstAdminState, formData: FormData): Promise<FirstAdminState> {
  const admin = await requireConsoleAdmin();
  const parsed = firstAdminSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const control = createConsoleServiceClient();
  const company = await getCompany(control, parsed.data.slug);
  const key = company && (await serviceKeyOf(control, parsed.data.slug));
  if (!company || !key) return failed(`Unknown company ${parsed.data.slug}`, formData);
  if (!company.company_id) return failed(`${parsed.data.slug} has no company in the database yet`, formData);
  const companyId = company.company_id;
  try {
    const db = createClient(company.supabase_url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await createFirstAdmin(db, { companyId, email: parsed.data.email, fullName: parsed.data.fullName });
    // The login exists now: a failed log entry must not hide the password. Never log the password.
    const { error: logError } = await control.rpc('console_log', {
      p_slug: parsed.data.slug,
      p_action: r.created ? 'first_admin_created' : 'admin_password_reset',
      p_detail: parsed.data.email,
      p_actor: admin.email,
    });
    const ok = r.created ? 'Admin login created.' : 'Password reset for the existing login.';
    return {
      ok: logError ? `${ok} The change could not be recorded in the history.` : ok,
      password: r.password,
      email: parsed.data.email,
    };
  } catch (e) {
    return failed((e as Error).message, formData);
  }
}
