import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { SelfAuth } from '@mkhamis72/self-auth';
import { pgConfig } from '../../scripts/db';
import { closeNodeAuth, nodeAuth, nodeAuthFor, sentEmails } from '../../scripts/self-auth-node';
import { runImport, splitId } from '../../scripts/self-auth-import';
import { actAsBound, asCompany, withTx } from './helpers';
import { makePatient, makeProduct, receive } from './fixtures';

// Supabase-era accounts (auth.users + auth.mfa_factors, bcrypt hashes and plain base32 secrets, as the live
// proofs showed) are made here and imported through the package, as on switch-over day. The package commits on
// its own pool, so these rows are committed: each test scopes the import to its own users (onlyUserIds) and
// afterAll removes them. Two scratch companies, found or provisioned once, stand in for A and B.
const PASSWORD = 'Import-old-pass-1';
const HASH = bcrypt.hashSync(PASSWORD, 10).replace(/^\$2b\$/, '$2a$'); // Supabase writes $2a$
let A = '';
let B = '';

async function withPg<T>(fn: (pg: Client) => Promise<T>, url?: string): Promise<T> {
  const pg = new Client(pgConfig(url ? { DATABASE_URL: url } : process.env));
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

async function company(pg: Client, slug: string): Promise<string> {
  const found = (await pg.query('select id from public.companies where slug = $1', [slug])).rows[0]?.id as string | undefined;
  return found ?? (await pg.query('select public.provision_company($1, $2) as id', [slug, `Zz ${slug}`])).rows[0].id;
}

/** A Supabase Auth user as the live database holds one: memberships through pending logins (handle_new_user),
 *  each membership's created_at as given (the first company keeps the id), an optional verified TOTP factor. */
async function legacyUser(a: {
  email: string; companies: { id: string; at: string; role?: 'admin' | 'organizer' }[]; hash: string | null; totpSecret?: string;
}): Promise<string> {
  const id = randomUUID();
  await withPg(async (pg) => {
    for (const c of a.companies) {
      await pg.query(
        `insert into app_private.pending_logins (company_id, email, full_name, role, created_by)
         values ($1, $2, 'Zz Import', $3, '00000000-0000-0000-0000-000000000000')`, [c.id, a.email, c.role ?? 'admin']);
    }
    await pg.query(
      `insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
       values ($1, 'authenticated', 'authenticated', $2, $3, now() - interval '30 days', now())`, [id, a.email, a.hash]);
    for (const c of a.companies) {
      await pg.query('update public.company_members set created_at = $3 where company_id = $1 and user_id = $2', [c.id, id, c.at]);
    }
    if (a.totpSecret) {
      await pg.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 'phone', 'totp', 'verified', now(), now(), $2)`, [id, a.totpSecret]);
    }
  });
  return id;
}

/** A committed stock delivery in the company by the user: its ledger row (append-only) carries created_by. */
async function deliveryBy(companyId: string, userId: string): Promise<string> {
  return withPg(async (pg) => {
    await pg.query('begin');
    await asCompany(pg, companyId, userId);
    const lot = await receive(pg, await makeProduct(pg, 'implant', 'Zz Import Brand'), 2, `ZZ-${randomUUID().slice(0, 6)}`);
    await pg.query('commit');
    return lot;
  });
}

/** A committed patient in the company, created by the user (created_by from the bound fixture session). */
async function patientBy(companyId: string, userId: string, name: string): Promise<string> {
  return withPg(async (pg) => {
    await pg.query('begin');
    await asCompany(pg, companyId, userId);
    const id = await makePatient(pg, name);
    await pg.query('commit');
    return id;
  });
}

async function importApp(onlyUserIds: string[], apply: boolean, log: string[] = []) {
  return withPg(async (pg) => runImport({ db: 'app', apply, pg, auth: await nodeAuth(), onlyUserIds, log: (l) => log.push(l) }));
}

beforeAll(async () => {
  await withPg(async (pg) => {
    A = await company(pg, 'zz-import-a');
    B = await company(pg, 'zz-import-b');
  });
  await removeImportUsers();
});

/** Removes every zz-imp-* legacy user (this run's and any an interrupted run left) with its split copies. Their
 *  stock ledger rows go first (the ledger's purge switch), as the ledger would block deleting their profiles.
 *  One transaction: a failure leaves nothing half-removed (and the trigger switched off is switched on again). */
async function removeImportUsers() {
  await withPg(async (pg) => {
    const ids = (await pg.query("select id from auth.users where email like 'zz-imp-%@example.com'")).rows.map((r) => r.id as string);
    const all = [...ids, ...ids.map((id) => splitId(id, B))];
    await pg.query('begin');
    await pg.query("set local app.ledger_purge = 'on'");
    // The scratch companies' admins are all test users: let the last one go too.
    await pg.query('alter table public.company_members disable trigger company_members_protect_last_admin');
    await pg.query('delete from public.stock_movements where created_by = any($1::uuid[])', [all]);
    await pg.query('delete from public.stock_lots where created_by = any($1::uuid[])', [all]);
    // Deleting the Self-Auth user runs 0101's delete trigger: profile (and memberships) gone, created_by cleared.
    await pg.query('delete from self_auth."user" where id = any($1::uuid[])', [all]);
    await pg.query('delete from public.profiles where user_id = any($1::uuid[])', [all]);
    await pg.query('delete from auth.users where id = any($1::uuid[])', [ids]);
    await pg.query('alter table public.company_members enable trigger company_members_protect_last_admin');
    await pg.query('commit');
  });
}

afterAll(async () => {
  await removeImportUsers();
  await closeNodeAuth();
});

describe('self-auth-import (app database)', () => {
  it('dry_run_changes_nothing', async () => {
    const email = `zz-imp-dry-${Date.now()}@example.com`;
    const totp = authenticator.generateSecret();
    const id = await legacyUser({ email, hash: HASH, totpSecret: totp, companies: [{ id: A, at: '2026-01-01' }, { id: B, at: '2026-02-01' }] });
    const patient = await patientBy(B, id, 'Zz Import Dry');
    const snapshot = () => withPg(async (pg) => ({
      users: (await pg.query('select count(*)::int n from self_auth."user" where id = any($1)', [[id, splitId(id, B)]])).rows[0].n,
      members: (await pg.query('select company_id, user_id from public.company_members where user_id = any($1) order by 1', [[id, splitId(id, B)]])).rows,
      createdBy: (await pg.query('select created_by from public.patients where id = $1', [patient])).rows[0].created_by,
      profiles: (await pg.query('select count(*)::int n from public.profiles where user_id = $1', [splitId(id, B)])).rows[0].n,
    }));
    const before = await snapshot();
    const log: string[] = [];

    const summary = await importApp([id], false, log);

    expect(await snapshot()).toEqual(before);
    expect(before.users).toBe(0);
    expect(summary.accounts).toBe(2);
    expect(summary.splits).toEqual([{ userId: id, companyId: B, newId: splitId(id, B), done: false }]);
    const out = log.join('\n');
    expect(out).toContain(splitId(id, B));
    expect(out).toContain(`z***@example.com`);
    expect(out).not.toContain(email);
    expect(out).not.toContain(HASH);
    expect(out).not.toContain(totp);
    expect(out).toMatch(/dry run/i);
  });

  it('split_user_signs_in_per_company', async () => {
    const email = `zz-imp-split-${Date.now()}@example.com`;
    const id = await legacyUser({ email, hash: HASH, companies: [{ id: A, at: '2026-01-01' }, { id: B, at: '2026-02-01' }] });
    const inA = await patientBy(A, id, 'Zz Import A');
    const inB = await patientBy(B, id, 'Zz Import B');
    const lotB = await deliveryBy(B, id);
    const newId = splitId(id, B);

    const summary = await importApp([id], true);
    expect(summary.imported).toBe(2);
    // Re-running after success (or a partial failure) is safe: nothing imported or re-pointed twice.
    const again = await importApp([id], true);
    expect(again.imported).toBe(0);
    expect(again.alreadyImported).toBe(2);
    expect(again.splits).toEqual([{ userId: id, companyId: B, newId, done: true }]);

    const auth = await nodeAuth();
    const a = await auth.signIn({ companyId: A, email, password: PASSWORD });
    const b = await auth.signIn({ companyId: B, email, password: PASSWORD });
    expect(a.ok && a.session.userId).toBe(id);
    expect(b.ok && b.session.userId).toBe(newId);

    await withPg(async (pg) => {
      expect((await pg.query('select created_by from public.patients where id = $1', [inB])).rows[0].created_by).toBe(newId);
      expect((await pg.query('select created_by from public.patients where id = $1', [inA])).rows[0].created_by).toBe(id);
      expect((await pg.query('select company_id from public.company_members where user_id = $1', [id])).rows).toEqual([{ company_id: A }]);
      expect((await pg.query('select company_id from public.company_members where user_id = $1', [newId])).rows).toEqual([{ company_id: B }]);
      expect((await pg.query('select email from public.profiles where user_id = $1', [newId])).rows).toEqual([{ email }]);
      // The ledger row moved too, and its append-only guard is back on afterwards.
      expect((await pg.query('select distinct created_by from public.stock_movements where stock_lot_id = $1', [lotB])).rows).toEqual([{ created_by: newId }]);
      expect((await pg.query("select tgenabled from pg_trigger where tgname = 'stock_movements_no_change'")).rows).toEqual([{ tgenabled: 'O' }]);
    });
    // Each account sees only its own company's rows, and neither can bind to the other company.
    await withTx(async (c) => {
      await actAsBound(c, id, A);
      const seen = (await c.query("select id from public.patients where full_name like 'Zz Import %'")).rows.map((r) => r.id);
      expect(seen).toContain(inA);
      expect(seen).not.toContain(inB);
    });
    await withTx(async (c) => {
      await actAsBound(c, newId, B);
      const seen = (await c.query("select id from public.patients where full_name like 'Zz Import %'")).rows.map((r) => r.id);
      expect(seen).toContain(inB);
      expect(seen).not.toContain(inA);
    });
    await withTx(async (c) => {
      await expect(actAsBound(c, newId, A)).rejects.toThrow(/access to this company/);
    });
    await withTx(async (c) => {
      await expect(actAsBound(c, id, B)).rejects.toThrow(/access to this company/);
    });
  });

  it('undo_splits_gives_company_back_to_the_supabase_id', async () => {
    const email = `zz-imp-undo-${Date.now()}@example.com`;
    const id = await legacyUser({ email, hash: HASH, companies: [{ id: A, at: '2026-01-01' }, { id: B, at: '2026-02-01' }] });
    const inB = await patientBy(B, id, 'Zz Import Undo');
    await importApp([id], true);

    const undone = await withPg(async (pg) => runImport({ db: 'app', apply: true, undoSplits: true, pg, auth: await nodeAuth(), onlyUserIds: [id] }));

    expect(undone.splits).toEqual([{ userId: id, companyId: B, newId: splitId(id, B), done: false }]);
    await withPg(async (pg) => {
      expect((await pg.query('select created_by from public.patients where id = $1', [inB])).rows[0].created_by).toBe(id);
      expect((await pg.query('select company_id from public.company_members where user_id = $1 order by 1', [id])).rows.map((r) => r.company_id).sort())
        .toEqual([A, B].sort());
    });
  });

  it('unknown_user_column_aborts', async () => {
    const email = `zz-imp-unknown-${Date.now()}@example.com`;
    const id = await legacyUser({ email, hash: HASH, companies: [{ id: A, at: '2026-01-01' }, { id: B, at: '2026-02-01' }] });
    // An unknown user column, visible only on this (rolled-back) connection.
    await withTx(async (c) => {
      await c.query('create table public.zz_import_probe (company_id uuid, approved_by uuid)');
      await expect(runImport({ db: 'app', apply: true, pg: c, auth: await nodeAuth(), onlyUserIds: [id], log: () => undefined }))
        .rejects.toThrow(/public\.zz_import_probe\.approved_by/);
    });
    await withPg(async (pg) => {
      expect((await pg.query('select count(*)::int n from self_auth."user" where id = any($1)', [[id, splitId(id, B)]])).rows[0].n).toBe(0);
      expect((await pg.query('select company_id from public.company_members where user_id = $1 order by 1', [id])).rows).toHaveLength(2);
    });
  });

  it('inactive_member_imports_disabled_in_that_company_only', async () => {
    // Deactivated in B (the old app's inactive membership + Supabase ban); the Self-Auth way is a disabled account.
    const email = `zz-imp-inactive-${Date.now()}@example.com`;
    const id = await legacyUser({ email, hash: HASH, companies: [{ id: A, at: '2026-01-01' }, { id: B, at: '2026-02-01', role: 'organizer' }] });
    await withPg((pg) => pg.query('update public.company_members set active = false where company_id = $1 and user_id = $2', [B, id]));

    await importApp([id], true);

    const auth = await nodeAuth();
    expect(await auth.signIn({ companyId: B, email, password: PASSWORD })).toEqual({ ok: false, reason: 'disabled' });
    expect((await auth.signIn({ companyId: A, email, password: PASSWORD })).ok).toBe(true);
    // Reactivating later is the admin tool's setDisabled(false): the account exists for it.
    expect((await auth.admin.listUsers(B)).find((u) => u.userId === splitId(id, B))).toMatchObject({ disabled: true });
  });

  it('invited_user_imports_passwordless', async () => {
    const email = `zz-imp-invited-${Date.now()}@example.com`;
    const id = await legacyUser({ email, hash: null, companies: [{ id: A, at: '2026-01-01', role: 'organizer' }] });

    const summary = await importApp([id], true);

    expect(summary.invited).toBe(1);
    const auth = await nodeAuth();
    const row = (await auth.admin.listUsers(A)).find((u) => u.userId === id);
    expect(row).toMatchObject({ hasPassword: false, hasTotp: false, disabled: false });
    expect(await auth.signIn({ companyId: A, email, password: PASSWORD })).toMatchObject({ ok: false });
    // They finish through a reset link to their real address, as an invite would.
    await auth.requestPasswordReset({ companyId: A, email });
    const link = sentEmails.filter((m) => m.to === email && m.kind === 'reset').at(-1);
    expect(link).toBeDefined();
    const token = new URL(link!.url).searchParams.get('token')!;
    expect(await auth.resetPassword({ token, newPassword: 'Invited-new-pass-1' })).toEqual({ userId: id, companyId: A });
    expect((await auth.signIn({ companyId: A, email, password: 'Invited-new-pass-1' })).ok).toBe(true);
  });
});

describe('self-auth-import (control database)', () => {
  // A scratch database on the local cluster stands in for the control project: Supabase's auth tables (only the
  // columns the import reads), console_admins with its old key to auth.users, then control 0007 as written.
  const DB = 'zz_self_auth_import_control';
  let url = '';
  let consoleAuth: SelfAuth | null = null;

  beforeAll(async () => {
    await withPg(async (pg) => {
      await pg.query(`drop database if exists ${DB} with (force)`);
      await pg.query(`create database ${DB}`);
    });
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = `/${DB}`;
    url = u.toString();
    await withPg(async (pg) => {
      await pg.query(`create schema auth;
        create table auth.users (id uuid primary key, email text, encrypted_password text, created_at timestamptz not null, deleted_at timestamptz,
          banned_until timestamptz);
        create table auth.mfa_factors (id uuid primary key, user_id uuid not null references auth.users(id), factor_type text not null,
          status text not null, secret text, created_at timestamptz not null);
        create table public.console_admins (user_id uuid primary key constraint console_admins_user_id_fkey references auth.users(id),
          email text not null, active boolean not null default true);`);
      await pg.query(readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0007_self_auth_a.sql'), 'utf8'));
    }, url);
    consoleAuth = await nodeAuthFor(url, 'SELF_AUTH_SECRET');
  });

  afterAll(async () => {
    await consoleAuth?.close();
    await withPg(async (pg) => { await pg.query(`drop database if exists ${DB} with (force)`); });
  });

  it('console_admin_keeps_totp', async () => {
    const email = `zz-console-${Date.now()}@example.com`;
    const secret = authenticator.generateSecret();
    const id = randomUUID();
    const gone = randomUUID();
    await withPg(async (pg) => {
      await pg.query("insert into auth.users (id, email, encrypted_password, created_at) values ($1, $2, $3, now() - interval '9 days')", [id, email, HASH]);
      await pg.query("insert into auth.users (id, email, encrypted_password, created_at, deleted_at) values ($1, 'zz-gone@example.com', $2, now(), now())", [gone, HASH]);
      await pg.query("insert into auth.mfa_factors (id, user_id, factor_type, status, secret, created_at) values (gen_random_uuid(), $1, 'totp', 'verified', $2, now())", [id, secret]);
      await pg.query('insert into public.console_admins (user_id, email) values ($1, $2)', [id, email]);
    }, url);

    const summary = await withPg(async (pg) => runImport({ db: 'control', apply: true, pg, auth: consoleAuth!, log: () => undefined }), url);

    expect(summary).toMatchObject({ accounts: 1, imported: 1, withTotp: 1 });
    const r = await consoleAuth!.signIn({ companyId: 'console', email, password: PASSWORD });
    if (!r.ok) throw new Error(`sign-in failed: ${r.reason}`);
    expect(r.session.userId).toBe(id);
    expect(r.needsTotp).toBe(true);
    const s = await consoleAuth!.totp.verify(r.sessionToken, 'console', authenticator.generate(secret));
    expect(s?.aal).toBe('aal2');
    expect(await consoleAuth!.signIn({ companyId: 'console', email: 'zz-gone@example.com', password: PASSWORD })).toMatchObject({ ok: false });
  });

  it('console_inactive_or_banned_admin_imports_disabled', async () => {
    const stamp = Date.now();
    const admins = {
      inactive: { id: randomUUID(), email: `zz-console-inactive-${stamp}@example.com`, active: false, banned: null as string | null },
      banned: { id: randomUUID(), email: `zz-console-banned-${stamp}@example.com`, active: true, banned: '2999-01-01' },
      banEnded: { id: randomUUID(), email: `zz-console-banended-${stamp}@example.com`, active: true, banned: '2020-01-01' },
    };
    await withPg(async (pg) => {
      for (const a of Object.values(admins)) {
        await pg.query('insert into auth.users (id, email, encrypted_password, created_at, banned_until) values ($1, $2, $3, now(), $4)',
          [a.id, a.email, HASH, a.banned]);
        await pg.query('insert into public.console_admins (user_id, email, active) values ($1, $2, $3)', [a.id, a.email, a.active]);
      }
    }, url);

    const dry: string[] = [];
    const planned = await withPg(async (pg) => runImport({ db: 'control', apply: false, pg, auth: consoleAuth!, log: (l) => dry.push(l) }), url);
    expect(planned.disabled).toBe(2);
    expect(dry.some((l) => l.includes(admins.inactive.id) && l.includes('inactive console admin'))).toBe(true);
    expect(dry.some((l) => l.includes(admins.banned.id) && l.includes('banned in Supabase Auth'))).toBe(true);
    expect(dry.some((l) => l.includes(admins.banEnded.id))).toBe(false);

    await withPg(async (pg) => runImport({ db: 'control', apply: true, pg, auth: consoleAuth!, log: () => undefined }), url);
    const signIn = (email: string) => consoleAuth!.signIn({ companyId: 'console', email, password: PASSWORD });
    expect(await signIn(admins.inactive.email)).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await signIn(admins.banned.email)).toMatchObject({ ok: false, reason: 'disabled' });
    expect((await signIn(admins.banEnded.email)).ok).toBe(true);
  });

  it('post_check_counts_only_planned_accounts', async () => {
    // An account made in Self-Auth during the first window (before a rollback), not in Supabase Auth: going
    // forward again, the full re-import must still complete.
    await consoleAuth!.admin.createUser({ companyId: 'console', email: `zz-console-new-${Date.now()}@example.com`, password: 'Window-pass-123' });
    const log: string[] = [];
    await withPg(async (pg) => runImport({ db: 'control', apply: true, pg, auth: consoleAuth!, log: (l) => log.push(l) }), url);
    expect(log.at(-1)).toBe('Import complete.');
    expect(log.some((l) => /1 made in Self-Auth only/.test(l))).toBe(true);
  });
});
