'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { getCompany, serviceKeyOf, sharedProject, type CompanyRow } from '@/lib/console/companies';
import { createFirstAdmin, inviteFirstAdmin, type InviteResult } from '@/lib/console/first-admin';
import { addProjectDomain, vercelConfigured } from '@/lib/console/vercel';
import { firstAdminSchema, onboardSchema, secretsSchema, statusSchema, updateSchema } from '@/lib/console/schemas';
import { checkTenant } from '@/lib/tenant/check';
import { emailEnabled } from '@/lib/flags';
import { failed, type FormState } from '@/lib/patients/form-state';

const SECRET_FIELDS = ['anonKey', 'serviceRoleKey', 'databaseUrl'];
/** Keeps what was typed after an error, except keys: they are never sent back to the browser. */
function failedWithoutSecrets(message: string, formData: FormData): FormState {
  const state = failed(message, formData);
  for (const k of SECRET_FIELDS) delete state.values?.[k];
  return state;
}
const fields = (formData: FormData) => Object.fromEntries(formData);
const sharedDb = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

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

/** Adds each host to the Vercel project and records it; the hosts Vercel refused, with why. Nothing without the
 *  Vercel settings (the company page then shows the manual steps). */
async function addDomains(control: SupabaseClient, slug: string, hosts: string[], actor: string): Promise<string[]> {
  if (!vercelConfigured()) return [];
  const problems: string[] = [];
  for (const host of hosts) {
    try {
      await addProjectDomain(host);
      await control.rpc('console_log', { p_slug: slug, p_action: 'domain_added', p_detail: host, p_actor: actor });
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return problems;
}

const inviteMessage = (r: InviteResult, email: string) =>
  r.outcome === 'invited' ? `Invite sent to ${email}.`
  : r.outcome === 'reinvited' ? `Invite sent again to ${email} (they had not accepted the first one).`
  : `${email} already had a login here: they were sent a password-reset email.`;

export type Step = { label: string; ok: boolean; detail: string };
export type OnboardState = FormState & { slug?: string; steps?: Step[]; password?: string; email?: string };

/**
 * Adds a company (multi-tenant part 5): the registry row with the shared database's keys, the company with its
 * starting data, its address on Vercel, and the first admin by email. Once the company exists, later steps
 * report a problem instead of failing: the company page can redo them.
 */
export async function onboardCompany(_prev: OnboardState, formData: FormData): Promise<OnboardState> {
  const admin = await requireConsoleAdmin();
  const parsed = onboardSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const control = createConsoleServiceClient();
  // A registry row without a company id is a registration whose company was never created: adding it again finishes it.
  if ((await getCompany(control, c.slug))?.company_id) {
    return failed('A company with this slug already exists — open it from the list.', formData);
  }
  let shared;
  try {
    shared = await sharedProject(control);
  } catch (e) {
    return failed((e as Error).message, formData);
  }
  const { error } = await control.rpc('console_register_tenant', {
    p_slug: c.slug, p_name: c.name, p_hosts: c.hosts, p_supabase_url: shared.supabaseUrl, p_anon_key: shared.anonKey,
    p_service_role_key: shared.serviceRoleKey, p_database_url: shared.databaseUrl, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  // The company itself, with its starting data, in the shared database (0095), then its id on the registry row.
  const db = sharedDb(shared.supabaseUrl, shared.serviceRoleKey);
  const { data: companyId, error: provisionError } = await db.rpc('provision_company', { p_slug: c.slug, p_name: c.name });
  if (provisionError || !companyId) {
    return failed(`Registered, but the company could not be created in the database: ${provisionError?.message ?? 'no id returned'}`, formData);
  }
  const { error: saveError } = await control.rpc('console_set_company', { p_slug: c.slug, p_company_id: companyId, p_actor: admin.email });
  if (saveError) {
    return failed(`Company ${companyId} was created in the database, but its id could not be saved in the registry: ${saveError.message}`, formData);
  }
  revalidatePath('/console');
  const steps: Step[] = [{ label: 'Company', ok: true, detail: `${c.name} created with its starting data.` }];

  const domainProblems = await addDomains(control, c.slug, c.hosts, admin.email);
  steps.push(
    !vercelConfigured() ? { label: 'Address', ok: false, detail: 'Vercel is not connected: add the address by hand (steps on the company page).' }
    : domainProblems.length ? { label: 'Address', ok: false, detail: `${domainProblems.join('; ')}. Retry from the company page.` }
    : { label: 'Address', ok: true, detail: `${c.hosts.join(', ')} added to Vercel; live in a few minutes.` },
  );

  const admin1 = { companyId: companyId as string, email: c.email, fullName: c.fullName };
  let password: string | undefined;
  try {
    if (emailEnabled()) {
      const r = await inviteFirstAdmin(db, admin1);
      await control.rpc('console_log', { p_slug: c.slug, p_action: 'first_admin_invited', p_detail: c.email, p_actor: admin.email });
      steps.push({ label: 'First admin', ok: true, detail: inviteMessage(r, c.email) });
    } else {
      const r = await createFirstAdmin(db, admin1);
      await control.rpc('console_log', { p_slug: c.slug, p_action: r.outcome === 'reset' ? 'admin_password_reset' : 'first_admin_created', p_detail: c.email, p_actor: admin.email });
      password = r.password;
      steps.push({ label: 'First admin', ok: true, detail: `Login created for ${c.email}: pass on the temporary password below.` });
    }
  } catch (e) {
    steps.push({ label: 'First admin', ok: false, detail: `${(e as Error).message}. Retry from the company page.` });
  }
  return { ok: 'Company added.', slug: c.slug, steps, password, email: c.email };
}

export async function updateCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = updateSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const control = createConsoleServiceClient();
  const before = await getCompany(control, parsed.data.slug);
  const { error } = await control.rpc('console_update_tenant', {
    p_slug: parsed.data.slug, p_name: parsed.data.name, p_hosts: parsed.data.hosts, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  // New addresses go to Vercel too; removed ones stay there (harmless: unknown hosts get 404).
  const added = parsed.data.hosts.filter((h) => !before?.hosts.includes(h));
  const problems = await addDomains(control, parsed.data.slug, added, admin.email);
  revalidatePath(`/console/companies/${parsed.data.slug}`);
  return problems.length ? { ok: `Saved, but: ${problems.join('; ')}` } : { ok: 'Saved.' };
}

/** Retries adding one of the company's addresses to Vercel (the Address panel's button). */
export async function addDomain(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const slug = String(formData.get('slug') ?? '');
  const host = String(formData.get('host') ?? '');
  const control = createConsoleServiceClient();
  const company = await getCompany(control, slug);
  if (!company || !company.hosts.includes(host)) return { error: `${host} is not an address of ${slug}.` };
  const [problem] = await addDomains(control, slug, [host], admin.email);
  revalidatePath(`/console/companies/${slug}`);
  return problem ? { error: problem } : { ok: `${host} added to Vercel.` };
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

/** By email when email is on (an invite, or a reset for an existing login); else a one-time password. */
export async function firstAdmin(_prev: FirstAdminState, formData: FormData): Promise<FirstAdminState> {
  const admin = await requireConsoleAdmin();
  const parsed = firstAdminSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const control = createConsoleServiceClient();
  const company = await getCompany(control, parsed.data.slug);
  const key = company && (await serviceKeyOf(control, parsed.data.slug));
  if (!company || !key) return failed(`Unknown company ${parsed.data.slug}`, formData);
  if (!company.company_id) return failed(`${parsed.data.slug} has no company in the database yet`, formData);
  const target = { companyId: company.company_id, email: parsed.data.email, fullName: parsed.data.fullName };
  try {
    const db = sharedDb(company.supabase_url, key);
    if (emailEnabled()) return await inviteByEmail(control, db, company, target, admin.email);
    const r = await createFirstAdmin(db, target);
    // The login exists now: a failed log entry must not hide the password. Never log the password.
    const { error: logError } = await control.rpc('console_log', {
      p_slug: parsed.data.slug,
      // console_log (control 0003) knows two actions: an added shared account is a created admin there.
      p_action: r.outcome === 'reset' ? 'admin_password_reset' : 'first_admin_created',
      p_detail: parsed.data.email,
      p_actor: admin.email,
    });
    const ok = r.outcome === 'created' ? 'Admin login created.' : 'Password reset for the existing login.';
    return {
      ok: logError ? `${ok} The change could not be recorded in the history.` : ok,
      password: r.password,
      email: parsed.data.email,
    };
  } catch (e) {
    return failed((e as Error).message, formData);
  }
}

async function inviteByEmail(
  control: SupabaseClient, db: SupabaseClient, company: CompanyRow,
  target: { companyId: string; email: string; fullName: string }, actor: string,
): Promise<FirstAdminState> {
  const r = await inviteFirstAdmin(db, target);
  const { error: logError } = await control.rpc('console_log', { p_slug: company.slug, p_action: 'first_admin_invited', p_detail: target.email, p_actor: actor });
  const ok = inviteMessage(r, target.email);
  return { ok: logError ? `${ok} The change could not be recorded in the history.` : ok, email: target.email };
}
