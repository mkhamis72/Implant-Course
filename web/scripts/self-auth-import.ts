import './load-env';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import type { SelfAuth } from '@mkhamis72/self-auth';
import { migrateTarget } from './migrate-target';
import { closeNodeAuth, nodeAuth } from './self-auth-node';

/**
 * Switch-over import: Supabase Auth users → Self-Auth, keeping ids, bcrypt hashes and verified TOTP secrets.
 *
 * App database: one Self-Auth account per company membership (accounts are per company). A user's first company
 * (earliest company_members.created_at) keeps their id; every other company gets splitId(user, company), and that
 * company's user references are re-pointed to it in one transaction per (user, company), after a copy of the
 * profile is made for it (so Migration A's provisioning trigger skips the import). Every user column of the
 * database is discovered first, and the run stops if one isn't handled below.
 * A membership that is inactive (deactivated: the old app's inactive membership + Supabase ban) is imported as a
 * disabled account, so the admin tool's reactivate (setDisabled false) finds it later.
 * Control database: every auth user becomes an account of company 'console', same id; an inactive console admin
 * or a running Supabase ban (banned_until in the future) imports as a disabled account (listed in the dry run).
 * The final check counts only the planned ids: accounts made in Self-Auth itself are reported, not an error.
 *
 * Dry run by default; prints counts, the split plan, ids and masked emails, never hashes or secrets.
 * Re-running is safe: split ids are derived, not random, the re-pointing only moves rows still on the old id,
 * and accounts already imported are skipped. --undo-splits (app, for a rollback to Supabase Auth) moves each
 * split company's references back to the original id; the Self-Auth accounts stay.
 */

export type ImportDb = 'app';
export type ImportArgs = { db: ImportDb; apply: boolean; undoSplits: boolean };
export type SplitState = { userId: string; companyId: string; newId: string; done: boolean };
export type ImportSummary = {
  accounts: number; imported: number; alreadyImported: number; invited: number; withTotp: number; disabled: number;
  splits: SplitState[];
};

const USAGE = 'Usage: npm run self-auth:import -- --db app [--apply] [--undo-splits]';

export function parseImportArgs(argv: string[]): ImportArgs {
  let db: string | undefined;
  let apply = false;
  let undoSplits = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') db = argv[++i];
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--undo-splits') undoSplits = true;
    else throw new Error(USAGE);
  }
  if (db !== 'app') throw new Error(USAGE);
  if (undoSplits && db !== 'app') throw new Error(USAGE);
  return { db, apply, undoSplits };
}

// A fixed namespace: the same (user, company) always gives the same new id, so a re-run (or the rollback's undo)
// finds the split without any stored mapping.
const SPLIT_NAMESPACE = Buffer.from('3d0c6a52b1e94f0f8a4e5b7c9d2e1f60', 'hex');

/** UUID v5 (SHA-1, RFC 4122) of "user/company" in the import's namespace. */
export function splitId(userId: string, companyId: string): string {
  const h = createHash('sha1').update(SPLIT_NAMESPACE).update(`${userId.toLowerCase()}/${companyId.toLowerCase()}`).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return '(no email)';
  const at = e.lastIndexOf('@');
  return at < 1 ? '***' : `${e[0]}***@${e.slice(at + 1)}`;
}

/**
 * Every user column of the app database and what a split does with it. 'repoint': the column's rows of the split
 * company move to the new id (every such table has company_id; checked at run time). 'copy': profiles, copied for
 * the new id. 'history': audit_log is append-only by design and keeps who acted at the time.
 * Order matters: memberships first, so triggers that check membership already see the new id.
 */
export const USER_COLUMNS: Record<string, 'repoint' | 'copy' | 'history'> = {
  'public.profiles.user_id': 'copy',
  'public.audit_log.user_id': 'history',
  // Console accounts (0105) are Self-Auth users of the company 'console', never company users: left as they are.
  'public.console_users.user_id': 'history',
  'public.company_members.user_id': 'repoint',
  'public.user_permissions.user_id': 'repoint',
  'public.admin_events.user_id': 'repoint',
  'public.admin_events.actor_id': 'repoint',
  'app.session_companies.user_id': 'repoint',
  'app_private.pending_logins.created_by': 'repoint',
  'public.patients.created_by': 'repoint',
  'public.delegates.created_by': 'repoint',
  'public.products.created_by': 'repoint',
  'public.courses.created_by': 'repoint',
  'public.enrollments.created_by': 'repoint',
  'public.sessions.created_by': 'repoint',
  'public.sessions.lead_organizer_id': 'repoint',
  'public.talks.created_by': 'repoint',
  'public.checklist_templates.created_by': 'repoint',
  'public.checklists.created_by': 'repoint',
  'public.checklist_items.assignee_id': 'repoint',
  'public.checklist_items.done_by': 'repoint',
  'public.implant_complications.created_by': 'repoint',
  'public.implant_complications.voided_by': 'repoint',
  'public.implant_followups.created_by': 'repoint',
  'public.implant_followups.voided_by': 'repoint',
  'public.implant_grafts.created_by': 'repoint',
  'public.implant_sites.created_by': 'repoint',
  'public.implant_surgery.created_by': 'repoint',
  'public.patient_consents.recorded_by': 'repoint',
  'public.patient_consents.voided_by': 'repoint',
  'public.radiographs.created_by': 'repoint',
  'public.radiographs.voided_by': 'repoint',
  'public.research_exports.exported_by': 'repoint',
  'public.restoration_problems.created_by': 'repoint',
  'public.restoration_problems.voided_by': 'repoint',
  'public.restorations.created_by': 'repoint',
  'public.restorations.ended_by': 'repoint',
  'public.restorations.voided_by': 'repoint',
  'public.saved_analyses.created_by': 'repoint',
  'public.site_components.created_by': 'repoint',
  'public.site_components.fitted_by_organizer_id': 'repoint',
  'public.site_components.voided_by': 'repoint',
  'public.stock_lots.created_by': 'repoint',
  'public.stock_movements.created_by': 'repoint',
  'public.stored_files.uploaded_by': 'repoint',
  'public.surgery_slots.created_by': 'repoint',
  'public.visit_notes.author_id': 'repoint',
};

/**
 * Triggers that would refuse moving a row to the same person's new id. Each is off only around that one update,
 * inside the split's transaction (foreign keys and audit triggers stay on): the stock ledger is append-only, and
 * an assignee must be an active organizer (an inactive member's old assignments would otherwise stop the split),
 * and the session-in-course date check runs as tenant_definer under RLS, so with no signed-in user it can't see the
 * course (found in the rehearsal; a split changes neither the date nor the course, so there is nothing to check).
 */
const BYPASS_TRIGGERS: Record<string, string[]> = {
  'public.stock_movements': ['stock_movements_no_change'],
  'public.checklist_items': ['checklist_items_check_assignee'],
  'public.sessions': ['sessions_in_course'],
};

export function unhandledColumns(found: string[]): string[] {
  return found.filter((c) => !(c in USER_COLUMNS)).sort();
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const qualified = (schemaTable: string) => schemaTable.split('.').map(q).join('.');

/** User columns by name (uuid *user_id*, created_by, actor*, *_by) or by a foreign key to profiles, auth.users or
 *  self_auth."user", in the app's schemas. */
export async function discoverUserColumns(pg: Client): Promise<string[]> {
  const { rows } = await pg.query<{ col: string }>(String.raw`
    select c.table_schema || '.' || c.table_name || '.' || c.column_name as col
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema in ('public', 'app', 'app_private') and c.data_type = 'uuid'
      and (c.column_name like '%user\_id%' or c.column_name = 'created_by' or c.column_name like 'actor%' or c.column_name like '%\_by')
    union
    select n.nspname || '.' || cl.relname || '.' || a.attname
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = co.conrelid and a.attnum = any (co.conkey)
    where co.contype = 'f' and n.nspname in ('public', 'app', 'app_private')
      and co.confrelid = any (array_remove(array[to_regclass('public.profiles'), to_regclass('auth.users'), to_regclass('self_auth."user"')], null)::oid[])
    order by 1`);
  return rows.map((r) => r.col);
}

type Account = {
  userId: string; companyId: string; accountId: string; email: string; hash: string | null; totp: string | null;
  createdAt: Date; splitDone: boolean; disabled: boolean;
};

type Plan = { accounts: Account[]; repointColumns: string[]; problems: string[] };

const BCRYPT = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;

type AuthUser = { id: string; email: string | null; encrypted_password: string | null; created_at: Date; deleted_at: Date | null };

/** auth.users (in scope) and each user's newest verified TOTP secret; checks that apply to both databases. */
async function readUsers(pg: Client, onlyUserIds: string[] | undefined, log: (l: string) => void, problems: string[]) {
  const users = (await pg.query<AuthUser>(
    `select u.id, u.email, u.encrypted_password, u.created_at, u.deleted_at from auth.users u
     ${onlyUserIds ? 'where u.id = any($1::uuid[])' : ''} order by u.created_at, u.id`,
    onlyUserIds ? [onlyUserIds] : [])).rows;
  const factors = (await pg.query<{ user_id: string; secret: string | null }>(
    `select f.user_id, f.secret from auth.mfa_factors f
     where f.factor_type = 'totp' and f.status = 'verified' order by f.created_at desc, f.id`)).rows;
  const totp = new Map<string, string | null>();
  const totpCount = new Map<string, number>();
  for (const f of factors) {
    if (!totp.has(f.user_id)) totp.set(f.user_id, f.secret);
    totpCount.set(f.user_id, (totpCount.get(f.user_id) ?? 0) + 1);
  }
  const live = users.filter((u) => !u.deleted_at);
  for (const u of live) {
    const who = `${u.id} (${maskEmail(u.email)})`;
    if (!u.email || !u.email.includes('@')) problems.push(`${u.id}: no email address`);
    if (u.encrypted_password && !BCRYPT.test(u.encrypted_password)) problems.push(`${who}: password hash is not bcrypt`);
    if (totp.has(u.id) && !totp.get(u.id)) problems.push(`${who}: verified TOTP factor without a readable secret`);
    if ((totpCount.get(u.id) ?? 0) > 1) log(`Note: ${who} has ${totpCount.get(u.id)} verified authenticators; the newest is imported.`);
  }
  log(`Auth users: ${users.length} (${users.length - live.length} deleted, skipped).`);
  return { live, totp };
}

const account = (
  u: AuthUser, totp: Map<string, string | null>, companyId: string, accountId: string, splitDone: boolean, disabled: boolean,
): Account => ({
  userId: u.id, companyId, accountId, email: u.email ?? '', hash: u.encrypted_password || null, totp: totp.get(u.id) ?? null,
  createdAt: u.created_at, splitDone, disabled,
});

async function planApp(pg: Client, onlyUserIds: string[] | undefined, log: (l: string) => void): Promise<Plan> {
  const found = await discoverUserColumns(pg);
  const unhandled = unhandledColumns(found);
  log(`User columns found: ${found.length}: ${found.filter((c) => USER_COLUMNS[c] === 'repoint').length} re-pointed on a split, profiles copied, audit_log kept as history.`);
  if (unhandled.length) {
    throw new Error(`Unhandled user column(s): ${unhandled.join(', ')}. Add each to USER_COLUMNS in scripts/self-auth-import.ts (repoint, copy or history) before importing.`);
  }
  const repointColumns = Object.keys(USER_COLUMNS).filter((c) => USER_COLUMNS[c] === 'repoint' && found.includes(c));
  const withCompany = new Set((await pg.query<{ t: string }>(
    `select table_schema || '.' || table_name as t from information_schema.columns where column_name = 'company_id'`)).rows.map((r) => r.t));
  for (const c of repointColumns) {
    const table = c.split('.').slice(0, 2).join('.');
    if (!withCompany.has(table)) throw new Error(`${c} is marked repoint but ${table} has no company_id.`);
  }

  const problems: string[] = [];
  const { live, totp } = await readUsers(pg, onlyUserIds, log, problems);
  const members = (await pg.query<{ company_id: string; user_id: string; active: boolean }>(
    'select company_id, user_id, active from public.company_members order by created_at, company_id')).rows;
  const accounts: Account[] = [];
  let noMembership = 0;
  for (const u of live) {
    // The user's memberships, oldest first: on their own id, or (after an earlier run) on the company's split id.
    const mine = members.filter((m) => m.user_id === u.id || m.user_id === splitId(u.id, m.company_id));
    if (!mine.length) {
      noMembership++;
      log(`  no membership, skipped: ${maskEmail(u.email)} ${u.id}`);
      continue;
    }
    if (mine[0].user_id !== u.id) problems.push(`${u.id}: the first company ${mine[0].company_id} is on a split id`);
    mine.forEach((m, i) => accounts.push(
      account(u, totp, m.company_id, i === 0 ? u.id : splitId(u.id, m.company_id), i > 0 && m.user_id !== u.id, !m.active)));
  }
  log(`Without a membership: ${noMembership}.`);
  return { accounts, repointColumns, problems };
}

/** One transaction: the profile copied for `to`, then every handled column of the company's rows moved from `from`. */
async function repoint(pg: Client, companyId: string, from: string, to: string, columns: string[]): Promise<number> {
  let moved = 0;
  await pg.query('begin');
  try {
    await pg.query(
      `insert into public.profiles (user_id, email, full_name, created_at)
       select $2, p.email, p.full_name, p.created_at from public.profiles p where p.user_id = $1
       on conflict (user_id) do nothing`, [from, to]);
    if (!(await pg.query('select 1 from public.profiles where user_id = $1', [to])).rowCount) {
      throw new Error(`No profile for ${from} to copy.`);
    }
    for (const col of columns) {
      const [schema, table, column] = col.split('.');
      const t = `${schema}.${table}`;
      const where = `company_id = $1 and ${q(column)} = $2`;
      if (!(await pg.query(`select 1 from ${qualified(t)} where ${where} limit 1`, [companyId, from])).rowCount) continue;
      const bypass = BYPASS_TRIGGERS[t] ?? [];
      for (const trg of bypass) await pg.query(`alter table ${qualified(t)} disable trigger ${q(trg)}`);
      const r = await pg.query(`update ${qualified(t)} set ${q(column)} = $3 where ${where}`, [companyId, from, to]);
      for (const trg of bypass) await pg.query(`alter table ${qualified(t)} enable trigger ${q(trg)}`);
      moved += r.rowCount ?? 0;
    }
    await pg.query('commit');
  } catch (e) {
    await pg.query('rollback').catch(() => undefined);
    throw e;
  }
  return moved;
}

/** Why a call failed, for the log: Self-Auth's `.code`, else the error's class or name (a pool timeout, a TLS
 *  error), never its message (which can quote input). */
export function failureReason(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code) return code;
  if (e instanceof Error) {
    if (e.name && e.name !== 'Error') return e.name;
    const cls = e.constructor?.name;
    if (cls && cls !== 'Error') return cls;
    return 'Error';
  }
  return 'failed';
}

/** Which database a URL reaches. A Supabase project is named by its ref, whichever way it is reached: the direct
 *  host db.<ref>.supabase.co, or the shared pooler host with user postgres.<ref> (any port: session 5432 and
 *  transaction 6543 are the same database). Anything else is host + database; the port is left out. */
function databaseIdentity(raw: string): string {
  const u = new URL(raw);
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) throw new Error('not a postgres URL');
  const host = u.hostname.toLowerCase();
  const db = decodeURIComponent(u.pathname.slice(1)) || 'postgres';
  const user = decodeURIComponent(u.username);
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (direct) return `Supabase project ${direct[1]}/${db}`;
  if (host.endsWith('.pooler.supabase.com') && user.includes('.')) return `Supabase project ${user.slice(user.indexOf('.') + 1).toLowerCase()}/${db}`;
  return `${host}/${db}`;
}

/**
 * The import reads and re-points rows over DATABASE_URL but writes the accounts through Self-Auth, which uses
 * SELF_AUTH_DATABASE_URL when set. If the two are different databases, the accounts would land somewhere else
 * than the rows: stop before any change. Names hosts and databases only, never credentials.
 */
export function assertSelfAuthTarget(env: Record<string, string | undefined>): void {
  const selfAuth = env.SELF_AUTH_DATABASE_URL?.trim();
  if (!selfAuth) return;
  const main = env.DATABASE_URL?.trim() ?? '';
  let a: string;
  let b: string;
  try {
    a = databaseIdentity(main);
    b = databaseIdentity(selfAuth);
  } catch {
    throw new Error('Stopped before any change: SELF_AUTH_DATABASE_URL or DATABASE_URL is not a valid postgres URL.');
  }
  if (a !== b) {
    throw new Error(`Stopped before any change: SELF_AUTH_DATABASE_URL points at ${b}, DATABASE_URL at ${a}. They must be the same database.`);
  }
}

export async function runImport(o: {
  db: ImportDb; apply: boolean; undoSplits?: boolean; pg: Client; auth: SelfAuth; onlyUserIds?: string[]; log?: (line: string) => void;
}): Promise<ImportSummary> {
  const log = o.log ?? ((l: string) => console.log(l));
  const mode = !o.apply ? 'dry run' : o.undoSplits ? 'APPLY, undo splits' : 'APPLY';
  log(`Self-Auth import, ${o.db} database: ${mode}.`);
  const plan = await planApp(o.pg, o.onlyUserIds, log);
  if (plan.problems.length) throw new Error(`Stopped before any change:\n  ${plan.problems.join('\n  ')}`);
  const { accounts } = plan;

  // Accounts already in Self-Auth: the same id and company is a finished import; another company is a conflict.
  const existing = new Map((await o.pg.query<{ id: string; companyId: string }>(
    'select id, "companyId" from self_auth."user" where id = any($1::uuid[])', [accounts.map((a) => a.accountId)])).rows.map((r) => [r.id, r.companyId]));
  const conflicts = accounts.filter((a) => existing.has(a.accountId) && existing.get(a.accountId) !== a.companyId);
  if (conflicts.length) {
    throw new Error(`Stopped before any change: Self-Auth already has these ids in another company: ${conflicts.map((a) => a.accountId).join(', ')}`);
  }

  const slugs = new Map((await o.pg.query<{ id: string; slug: string }>('select id, slug from public.companies')).rows.map((r) => [r.id, r.slug]));
  const name = (companyId: string) => slugs.get(companyId) ?? companyId;
  const splits = accounts.filter((a) => a.accountId !== a.userId);
  const summary: ImportSummary = {
    accounts: accounts.length, imported: 0, alreadyImported: 0,
    invited: accounts.filter((a) => !a.hash).length, withTotp: accounts.filter((a) => a.totp).length,
    disabled: accounts.filter((a) => a.disabled).length,
    splits: splits.map((s) => ({ userId: s.userId, companyId: s.companyId, newId: s.accountId, done: s.splitDone })),
  };
  log(`Accounts (one per membership): ${summary.accounts}; invited without a password: ${summary.invited}; with 2FA: ${summary.withTotp}; deactivated (imported disabled): ${summary.disabled}; already in Self-Auth: ${accounts.filter((a) => existing.has(a.accountId)).length}.`);
  log(`Splits: ${splits.length}.`);
  for (const s of splits) {
    const first = accounts.find((a) => a.userId === s.userId && a.accountId === s.userId)!;
    log(`  ${maskEmail(s.email)} ${s.userId} keeps ${name(first.companyId)}; ${name(s.companyId)} -> ${s.accountId} (${s.splitDone ? 'done' : 'pending'})`);
  }
  if (!o.apply) {
    log('Dry run: nothing changed. Add --apply to import.');
    return summary;
  }

  if (o.undoSplits) {
    for (const s of splits) {
      const moved = await repoint(o.pg, s.companyId, s.accountId, s.userId, plan.repointColumns);
      log(`  undone: ${name(s.companyId)} ${s.accountId} -> ${s.userId} (${moved} rows)`);
    }
    summary.splits = summary.splits.map((s) => ({ ...s, done: false }));
    log('Splits undone. The Self-Auth accounts stay; a later --apply splits again.');
    return summary;
  }

  // Every split, even one already done: it moves only rows still on the old id (normally none).
  for (const s of splits) {
    const moved = await repoint(o.pg, s.companyId, s.userId, s.accountId, plan.repointColumns);
    log(`  split: ${name(s.companyId)} ${s.userId} -> ${s.accountId} (${moved} rows)`);
  }
  summary.splits = summary.splits.map((s) => ({ ...s, done: true }));

  const failures: string[] = [];
  for (const a of accounts) {
    try {
      await o.auth.importSupabaseUser({
        companyId: a.companyId, userId: a.accountId, email: a.email, passwordHash: a.hash, totpSecret: a.totp, createdAt: a.createdAt,
      });
      summary.imported++;
    } catch (e) {
      const reason = failureReason(e);
      if (reason === 'already_imported') summary.alreadyImported++;
      else failures.push(`${a.accountId} ${maskEmail(a.email)} in ${name(a.companyId)}: ${reason}`);
    }
  }
  // Deactivated memberships: disabled in that company only (never re-enabled here: that is the admin's call).
  for (const a of accounts.filter((x) => x.disabled)) {
    try {
      await o.auth.admin.setDisabled(a.companyId, a.accountId, true);
    } catch (e) {
      failures.push(`${a.accountId} ${maskEmail(a.email)} in ${name(a.companyId)}: disable ${failureReason(e)}`);
    }
  }
  log(`Imported ${summary.imported}; already imported ${summary.alreadyImported}; failed ${failures.length}.`);

  // Check: every account is there, in its company, with its password, 2FA and disabled status.
  const rows = (await o.pg.query<{ id: string; companyId: string; disabled: boolean; has_password: boolean; has_totp: boolean }>(
    `select u.id, u."companyId", coalesce(u.disabled, false) as disabled,
       exists (select 1 from self_auth.account a where a."userId" = u.id and a."providerId" = 'credential' and a.password is not null) as has_password,
       exists (select 1 from self_auth.totp_factor t where t.user_id = u.id and t.confirmed) as has_totp
     from self_auth."user" u where u.id = any($1::uuid[])`, [accounts.map((a) => a.accountId)])).rows;
  const got = new Map(rows.map((r) => [r.id, r]));
  const missing: string[] = [];
  for (const a of accounts) {
    const r = got.get(a.accountId);
    if (!r || r.companyId !== a.companyId) missing.push(`${a.accountId}: no account in ${name(a.companyId)}`);
    else if (a.hash && !r.has_password) missing.push(`${a.accountId}: password not imported`);
    else if (a.totp && !r.has_totp) missing.push(`${a.accountId}: 2FA not imported`);
    else if (a.disabled && !r.disabled) missing.push(`${a.accountId}: deactivated in ${name(a.companyId)} but not disabled`);
  }
  if (!o.onlyUserIds) {
    // Only the planned ids count. Accounts made in Self-Auth itself (invites, logins created during a first
    // window before a rollback) are expected on "Going forward again" and are reported, not an error.
    const total = (await o.pg.query<{ n: number }>('select count(*)::int as n from self_auth."user"')).rows[0].n;
    log(`Check: Self-Auth users ${total}: ${rows.length} planned (one per membership: ${accounts.length}), ${total - rows.length} made in Self-Auth only.`);
  }
  log(`Check: ${accounts.length - missing.length} of ${accounts.length} accounts in place with their password, 2FA and status.`);
  if (failures.length || missing.length) {
    throw new Error(`Import incomplete (safe to re-run once fixed):\n  ${[...failures, ...missing].join('\n  ')}`);
  }
  log('Import complete.');
  return summary;
}

async function main() {
  const args = parseImportArgs(process.argv.slice(2));
  // The import writes through nodeAuth() (SELF_AUTH_DATABASE_URL || DATABASE_URL) and reads DATABASE_URL: both must be the same database.
  assertSelfAuthTarget(process.env);
  const target = migrateTarget([], process.env);
  console.log(`Target: ${target.label}`);
  const pg = new Client(target.config);
  await pg.connect();
  try {
    const auth = await nodeAuth();
    await runImport({ ...args, pg, auth });
  } finally {
    await pg.end();
  }
}

if (process.argv[1]?.endsWith('self-auth-import.ts')) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : 'failed');
      process.exitCode = 1;
    })
    .finally(() => closeNodeAuth());
}
