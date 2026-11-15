import 'server-only';
import { resetProductionCache } from '@/lib/tenant/production';
import type { CompanyRow, SharedProject } from './companies';
import { consoleAdminActive } from './admin-active';
import type { ErrorEntry } from './errors';
import { createConsoleServiceClient } from './supabase';

export type HistoryRow = { at: string; action: string; actor: string; reason: string | null; changed: string[] };
export type LogAction = 'first_admin_created' | 'admin_password_reset' | 'first_admin_invited' | 'domain_added';
export type NewCompany = { slug: string; name: string; hosts: string[] };

/** Everything the console reads and writes about companies; pages and actions never touch a table directly. */
export type ConsoleStore = {
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
  adminActive(userId: string): Promise<boolean>;
  /** The server errors recorded in error_log (kept 30 days), newest first. */
  errors(): Promise<ErrorEntry[]>;
};

const message = (r: { error: { message: string } | null }) => r.error?.message ?? null;

/** Keys that changed between two audit snapshots (updated_at left out). */
const changedKeys = (before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  Object.keys(after ?? {}).filter((k) => k !== 'updated_at' && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));

type CompanyListRow = { id: string; slug: string; name: string; hosts: string[] | null; status: 'active' | 'suspended' };

/** The console on the one database: companies, company_log and the console_*_company functions (merge of control). */
export function consoleStore(): ConsoleStore {
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
    adminActive: consoleAdminActive,
    async errors() {
      const { data, error } = await db.from('error_log').select('at, message, path').order('at', { ascending: false }).limit(1000);
      if (error) throw new Error('Could not load the errors.');
      return (data ?? []) as ErrorEntry[];
    },
  };
}

export type { CompanyRow, SharedProject };
