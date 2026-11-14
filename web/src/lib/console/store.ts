import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { resetControlCache } from '@/lib/tenant/control';
import { resetProductionCache } from '@/lib/tenant/production';
import { companyAudit, getCompany, listCompanies, serviceKeyOf, sharedProject, type CompanyRow, type SharedProject } from './companies';
import { consoleAdminActive } from './admin-active';
import { consoleSource } from './env';
import { createConsoleServiceClient } from './supabase';

export type HistoryRow = { at: string; action: string; actor: string; reason: string | null; changed: string[] };
export type LogAction = 'first_admin_created' | 'admin_password_reset' | 'first_admin_invited' | 'domain_added';
export type NewCompany = { slug: string; name: string; hosts: string[] };
export type CompanyKeys = { slug: string; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string };

export const KEYS_NOT_PER_COMPANY = 'Keys are no longer kept per company.';

/** Everything the console reads and writes about companies; pages and actions never touch a table directly. */
export type ConsoleStore = {
  source: 'control' | 'production';
  list(): Promise<CompanyRow[]>;
  get(slug: string): Promise<CompanyRow | null>;
  history(slug: string): Promise<HistoryRow[]>;
  serviceKey(slug: string): Promise<string | null>;
  shared(): Promise<SharedProject>;
  /** Creates the company with its starting data and its addresses, and gives the shared project it lives in;
   *  `error` is shown to the admin as is. */
  addCompany(c: NewCompany, actor: string): Promise<{ companyId: string; shared: SharedProject } | { error: string }>;
  /** Each write returns the message to show, or null when it worked. */
  update(slug: string, name: string, hosts: string[], actor: string): Promise<string | null>;
  setStatus(slug: string, status: 'active' | 'suspended', reason: string, actor: string): Promise<string | null>;
  log(slug: string, action: LogAction, detail: string, actor: string): Promise<string | null>;
  replaceKeys(k: CompanyKeys, actor: string): Promise<string | null>;
  adminActive(userId: string): Promise<boolean>;
};

const serviceClient = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const message = (r: { error: { message: string } | null }) => r.error?.message ?? null;

/** Keys that changed between two audit snapshots (updated_at left out). */
const changedKeys = (before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  Object.keys(after ?? {}).filter((k) => k !== 'updated_at' && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));

/** Today's console: the control project's registry, Vault and audit (control migrations 0002–0006). */
function controlStore(): ConsoleStore {
  const db = createConsoleServiceClient();
  return {
    source: 'control',
    list: () => listCompanies(db),
    get: (slug) => getCompany(db, slug),
    history: (slug) => companyAudit(db, slug),
    serviceKey: (slug) => serviceKeyOf(db, slug),
    shared: () => sharedProject(db),
    async addCompany(c, actor) {
      let shared: SharedProject;
      try {
        shared = await sharedProject(db);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const registered = await db.rpc('console_register_tenant', {
        p_slug: c.slug, p_name: c.name, p_hosts: c.hosts, p_supabase_url: shared.supabaseUrl, p_anon_key: shared.anonKey,
        p_service_role_key: shared.serviceRoleKey, p_database_url: shared.databaseUrl, p_actor: actor,
      });
      if (registered.error) return { error: registered.error.message };
      // The company itself, with its starting data, in the shared database (0095), then its id on the registry row.
      const { data: companyId, error } = await serviceClient(shared.supabaseUrl, shared.serviceRoleKey).rpc('provision_company', { p_slug: c.slug, p_name: c.name });
      if (error || !companyId) return { error: `Registered, but the company could not be created in the database: ${error?.message ?? 'no id returned'}` };
      const saved = await db.rpc('console_set_company', { p_slug: c.slug, p_company_id: companyId, p_actor: actor });
      if (saved.error) return { error: `Company ${companyId} was created in the database, but its id could not be saved in the registry: ${saved.error.message}` };
      resetControlCache();
      return { companyId: companyId as string, shared };
    },
    update: async (slug, name, hosts, actor) => message(await db.rpc('console_update_tenant', { p_slug: slug, p_name: name, p_hosts: hosts, p_actor: actor })),
    setStatus: async (slug, status, reason, actor) => message(await db.rpc('console_set_status', { p_slug: slug, p_status: status, p_reason: reason, p_actor: actor })),
    log: async (slug, action, detail, actor) => message(await db.rpc('console_log', { p_slug: slug, p_action: action, p_detail: detail, p_actor: actor })),
    replaceKeys: async (k, actor) => message(await db.rpc('console_replace_secrets', {
      p_slug: k.slug, p_supabase_url: k.supabaseUrl, p_anon_key: k.anonKey, p_service_role_key: k.serviceRoleKey,
      p_database_url: k.databaseUrl, p_actor: actor,
    })),
    adminActive: consoleAdminActive,
  };
}

type CompanyListRow = { id: string; slug: string; name: string; hosts: string[] | null; status: 'active' | 'suspended' };

/** The console on the production database (merge release 2): companies, company_log and the console_*_company functions. */
function productionStore(): ConsoleStore {
  const db = createConsoleServiceClient();
  const env = () => ({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    databaseUrl: process.env.SELF_AUTH_DATABASE_URL || process.env.DATABASE_URL || '',
  });
  const toRow = (r: CompanyListRow): CompanyRow => ({
    slug: r.slug, name: r.name, hosts: r.hosts ?? [], status: r.status,
    supabase_url: env().supabaseUrl, anon_key: env().anonKey, company_id: r.id,
  });
  const COLUMNS = 'id, slug, name, hosts, status';
  /** A write the routing of this process must see at once (other processes within 60 s). */
  const fresh = (m: string | null) => {
    if (!m) resetProductionCache();
    return m;
  };
  return {
    source: 'production',
    async list() {
      const { data, error } = await db.from('companies').select(COLUMNS).order('slug');
      if (error) throw new Error('Could not load the companies.');
      return ((data ?? []) as CompanyListRow[]).map(toRow);
    },
    async get(slug) {
      const { data } = await db.from('companies').select(COLUMNS).eq('slug', slug).maybeSingle();
      return data ? toRow(data as CompanyListRow) : null;
    },
    async history(slug) {
      const { data } = await db.from('company_log').select('at, action, actor, reason, before, after').eq('slug', slug)
        .order('at', { ascending: false }).order('id', { ascending: false }).limit(50);
      return ((data ?? []) as { at: string; action: string; actor: string; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[])
        .map((r) => ({ at: r.at, action: r.action, actor: r.actor, reason: r.reason, changed: changedKeys(r.before, r.after) }));
    },
    serviceKey: async () => env().serviceRoleKey || null,
    shared: async () => env(),
    async addCompany(c, actor) {
      // An address must belong to one company. Check before creating anything: the list trigger (0104) would only
      // refuse it after provision_company, leaving a company without an address (control refuses it first too).
      const taken = (await this.list()).find((r) => r.slug !== c.slug && r.hosts.some((h) => c.hosts.includes(h)));
      if (taken) return { error: `A host of ${c.slug} is already used by ${taken.slug}` };
      const { data: companyId, error } = await db.rpc('provision_company', { p_slug: c.slug, p_name: c.name });
      if (error || !companyId) return { error: `The company could not be created in the database: ${error?.message ?? 'no id returned'}` };
      const saved = await db.rpc('console_update_company', { p_slug: c.slug, p_name: c.name, p_hosts: c.hosts, p_actor: actor });
      resetProductionCache();
      if (saved.error) return { error: `Company ${companyId} was created in the database, but its addresses could not be saved: ${saved.error.message}` };
      return { companyId: companyId as string, shared: env() };
    },
    update: async (slug, name, hosts, actor) => fresh(message(await db.rpc('console_update_company', { p_slug: slug, p_name: name, p_hosts: hosts, p_actor: actor }))),
    setStatus: async (slug, status, reason, actor) => fresh(message(await db.rpc('console_set_company_status', { p_slug: slug, p_status: status, p_reason: reason, p_actor: actor }))),
    log: async (slug, action, detail, actor) => message(await db.rpc('console_log_company', { p_slug: slug, p_action: action, p_detail: detail, p_actor: actor })),
    replaceKeys: async () => KEYS_NOT_PER_COMPANY,
    adminActive: consoleAdminActive,
  };
}

/** The console's company store for the active source (COMPANY_LIST=production, else the control project). */
export function consoleStore(): ConsoleStore {
  return consoleSource() === 'production' ? productionStore() : controlStore();
}

export type { CompanyRow, SharedProject };
