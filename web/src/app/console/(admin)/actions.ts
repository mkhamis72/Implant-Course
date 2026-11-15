'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireConsoleAdmin } from '@/lib/console/session';
import { consoleStore, type CompanyRow, type ConsoleStore } from '@/lib/console/store';
import { createFirstAdmin, inviteFirstAdmin, type InviteResult } from '@/lib/console/first-admin';
import { addProjectDomain, vercelConfigured } from '@/lib/console/vercel';
import { firstAdminSchema, onboardSchema, statusSchema, updateSchema } from '@/lib/console/schemas';
import { emailEnabled } from '@/lib/flags';
import { failed, type FormState } from '@/lib/patients/form-state';

const fields = (formData: FormData) => Object.fromEntries(formData);
const sharedDb = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Adds each host to the Vercel project and records it; the hosts Vercel refused, with why. Nothing without the
 *  Vercel settings (the company page then shows the manual steps). */
async function addDomains(store: ConsoleStore, slug: string, hosts: string[], actor: string): Promise<string[]> {
  if (!vercelConfigured()) return [];
  const problems: string[] = [];
  for (const host of hosts) {
    try {
      await addProjectDomain(host);
      await store.log(slug, 'domain_added', host, actor);
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
 * Adds a company (multi-tenant part 5): the company with its starting data and its addresses, its address on Vercel, and the first admin by email. Once the company exists, later steps
 * report a problem instead of failing: the company page can redo them.
 */
export async function onboardCompany(_prev: OnboardState, formData: FormData): Promise<OnboardState> {
  const admin = await requireConsoleAdmin();
  const parsed = onboardSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const store = consoleStore();
  // A registry row without a company id is a registration whose company was never created: adding it again finishes it.
  if ((await store.get(c.slug))?.company_id) {
    return failed('A company with this slug already exists — open it from the list.', formData);
  }
  const added = await store.addCompany({ slug: c.slug, name: c.name, hosts: c.hosts }, admin.email);
  if ('error' in added) return failed(added.error, formData);
  const { companyId, shared } = added;
  const db = sharedDb(shared.supabaseUrl, shared.serviceRoleKey);
  revalidatePath('/console');
  const steps: Step[] = [{ label: 'Company', ok: true, detail: `${c.name} created with its starting data.` }];

  const domainProblems = await addDomains(store, c.slug, c.hosts, admin.email);
  steps.push(
    !vercelConfigured() ? { label: 'Address', ok: false, detail: 'Vercel is not connected: add the address by hand (steps on the company page).' }
    : domainProblems.length ? { label: 'Address', ok: false, detail: `${domainProblems.join('; ')}. Retry from the company page.` }
    : { label: 'Address', ok: true, detail: `${c.hosts.join(', ')} added to Vercel; live in a few minutes.` },
  );

  const admin1 = { companyId, email: c.email, fullName: c.fullName };
  let password: string | undefined;
  try {
    if (emailEnabled()) {
      const r = await inviteFirstAdmin(db, admin1);
      await store.log(c.slug, 'first_admin_invited', c.email, admin.email);
      steps.push({ label: 'First admin', ok: true, detail: inviteMessage(r, c.email) });
    } else {
      const r = await createFirstAdmin(db, admin1);
      await store.log(c.slug, r.outcome === 'reset' ? 'admin_password_reset' : 'first_admin_created', c.email, admin.email);
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
  const store = consoleStore();
  const before = await store.get(parsed.data.slug);
  const error = await store.update(parsed.data.slug, parsed.data.name, parsed.data.hosts, admin.email);
  if (error) return failed(error, formData);
  // New addresses go to Vercel too; removed ones stay there (harmless: unknown hosts get 404).
  const added = parsed.data.hosts.filter((h) => !before?.hosts.includes(h));
  const problems = await addDomains(store, parsed.data.slug, added, admin.email);
  revalidatePath(`/console/companies/${parsed.data.slug}`);
  return problems.length ? { ok: `Saved, but: ${problems.join('; ')}` } : { ok: 'Saved.' };
}

/** Retries adding one of the company's addresses to Vercel (the Address panel's button). */
export async function addDomain(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const slug = String(formData.get('slug') ?? '');
  const host = String(formData.get('host') ?? '');
  const store = consoleStore();
  const company = await store.get(slug);
  if (!company || !company.hosts.includes(host)) return { error: `${host} is not an address of ${slug}.` };
  const [problem] = await addDomains(store, slug, [host], admin.email);
  revalidatePath(`/console/companies/${slug}`);
  return problem ? { error: problem } : { ok: `${host} added to Vercel.` };
}

export async function setCompanyStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = statusSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const s = parsed.data;
  const error = await consoleStore().setStatus(s.slug, s.status, s.reason, admin.email);
  if (error) return failed(error, formData);
  revalidatePath(`/console/companies/${s.slug}`);
  revalidatePath('/console');
  return { ok: s.status === 'suspended' ? 'Suspended. Its users see “temporarily unavailable” within about a minute.' : 'Reactivated.' };
}

export type FirstAdminState = FormState & { password?: string; email?: string; seq?: number };

/** By email when email is on (an invite, or a reset for an existing login); else a one-time password. */
export async function firstAdmin(_prev: FirstAdminState, formData: FormData): Promise<FirstAdminState> {
  const admin = await requireConsoleAdmin();
  const parsed = firstAdminSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const store = consoleStore();
  const company = await store.get(parsed.data.slug);
  const key = company && (await store.serviceKey(parsed.data.slug));
  if (!company || !key) return failed(`Unknown company ${parsed.data.slug}`, formData);
  if (!company.company_id) return failed(`${parsed.data.slug} has no company in the database yet`, formData);
  const target = { companyId: company.company_id, email: parsed.data.email, fullName: parsed.data.fullName };
  try {
    const db = sharedDb(company.supabase_url, key);
    if (emailEnabled()) return await inviteByEmail(store, db, company, target, admin.email);
    const r = await createFirstAdmin(db, target);
    // The login exists now: a failed log entry must not hide the password. Never log the password.
    // The log knows two actions here: an added shared account is a created admin.
    const logError = await store.log(parsed.data.slug, r.outcome === 'reset' ? 'admin_password_reset' : 'first_admin_created', parsed.data.email, admin.email);
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
  store: ConsoleStore, db: SupabaseClient, company: CompanyRow,
  target: { companyId: string; email: string; fullName: string }, actor: string,
): Promise<FirstAdminState> {
  const r = await inviteFirstAdmin(db, target);
  const logError = await store.log(company.slug, 'first_admin_invited', target.email, actor);
  const ok = inviteMessage(r, target.email);
  return { ok: logError ? `${ok} The change could not be recorded in the history.` : ok, email: target.email };
}
