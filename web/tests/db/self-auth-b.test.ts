import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { closeNodeAuth, nodeAuth } from '../../scripts/self-auth-node';
import { runImport, splitId } from '../../scripts/self-auth-import';
import { asCompany, withTx } from './helpers';
import { makePatient } from './fixtures';

// Migration B (0103) is held by default (migrate.ts), so the local stack never has it. Each case
// applies it inside a transaction that is rolled back, after a real import of Supabase-era users made here.
const B_APP = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0103_self_auth_b.sql'), 'utf8');
const PASSWORD = 'Import-old-pass-1';
const HASH = bcrypt.hashSync(PASSWORD, 10).replace(/^\$2b\$/, '$2a$');
const CREATED_BY_TABLES = ['patients', 'delegates', 'products', 'courses', 'enrollments', 'sessions', 'talks'];
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

/** A Supabase-era user in A (first) and B, with a verified Supabase TOTP factor, as the import test makes them. */
async function legacyUser(email: string, totp: string): Promise<string> {
  const id = randomUUID();
  await withPg(async (pg) => {
    for (const c of [A, B]) {
      await pg.query(`insert into app_private.pending_logins (company_id, email, full_name, role, created_by)
        values ($1, $2, 'Zz Import B', 'admin', '00000000-0000-0000-0000-000000000000')`, [c, email]);
    }
    await pg.query(`insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
      values ($1, 'authenticated', 'authenticated', $2, $3, now() - interval '30 days', now())`, [id, email, HASH]);
    await pg.query('update public.company_members set created_at = $3 where company_id = $1 and user_id = $2', [A, id, '2026-01-01']);
    await pg.query('update public.company_members set created_at = $3 where company_id = $1 and user_id = $2', [B, id, '2026-02-01']);
    await pg.query(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
      values (gen_random_uuid(), $1, 'phone', 'totp', 'verified', now(), now(), $2)`, [id, totp]);
  });
  return id;
}

async function patientBy(companyId: string, userId: string, name: string): Promise<string> {
  return withPg(async (pg) => {
    await pg.query('begin');
    await asCompany(pg, companyId, userId);
    const id = await makePatient(pg, name);
    await pg.query('commit');
    return id;
  });
}

/** Postgres, with a session of `user` bound to `companyId` at the given aal (the definers read the claims). */
async function as(c: Client, user: string, companyId: string, aal: 'aal1' | 'aal2') {
  await c.query('reset role');
  const session = randomUUID();
  await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)', [session, companyId, user]);
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: user, role: 'authenticated', session_id: session, aal })]);
}

/** The runbook's step before turning the hold off: anyone left only in Supabase Auth with no membership (so the
 *  import made no account for them) is removed the old way, which Migration A's delete trigger finishes. */
async function removeSupabaseOnlyUsers(c: Client) {
  await c.query(`delete from auth.users a where not exists (select 1 from self_auth."user" u where u.id = a.id)
    and not exists (select 1 from public.company_members m where m.user_id = a.id)`);
}

/** Supabase-era users of the local stack that the import would give an account (live, with a membership) but
 *  that no test imported yet (earlier e2e runs leave some): the "local import" is of these plus the test's own. */
async function unimportedMembers(): Promise<string[]> {
  return withPg(async (pg) => (await pg.query(`select a.id from auth.users a where a.deleted_at is null
    and not exists (select 1 from self_auth."user" u where u.id = a.id)
    and exists (select 1 from public.company_members m where m.user_id = a.id)`)).rows.map((r) => r.id as string));
}

async function removeUsers() {
  await withPg(async (pg) => {
    const ids = (await pg.query("select id from auth.users where email like 'zz-impb-%@example.com'")).rows.map((r) => r.id as string);
    const all = [...ids, ...ids.map((id) => splitId(id, B))];
    await pg.query('begin');
    await pg.query('alter table public.company_members disable trigger company_members_protect_last_admin');
    await pg.query('delete from self_auth."user" where id = any($1::uuid[])', [all]);
    await pg.query('delete from public.profiles where user_id = any($1::uuid[])', [all]);
    await pg.query('delete from auth.users where id = any($1::uuid[])', [ids]);
    await pg.query('alter table public.company_members enable trigger company_members_protect_last_admin');
    await pg.query('commit');
  });
}

beforeAll(async () => {
  await withPg(async (pg) => {
    A = await company(pg, 'zz-import-a');
    B = await company(pg, 'zz-import-b');
  });
  await removeUsers();
});

afterAll(async () => {
  await removeUsers();
  await closeNodeAuth();
});

describe('Migration B (0103): auth.* branches gone, keys on self_auth."user"', () => {
  it('migration_b_applies_cleanly_after_import', async () => {
    const totp = authenticator.generateSecret();
    const id = await legacyUser(`zz-impb-${Date.now()}@example.com`, totp);
    const inA = await patientBy(A, id, 'Zz Import B A');
    const inB = await patientBy(B, id, 'Zz Import B B');
    const split = splitId(id, B);
    await withPg(async (pg) => runImport({ db: 'app', apply: true, pg, auth: await nodeAuth(), onlyUserIds: [id, ...(await unimportedMembers())], log: () => undefined }));

    await withTx(async (c) => {
      await removeSupabaseOnlyUsers(c);
      await c.query(B_APP);

      // Keys point at self_auth."user", with the old delete actions.
      const fks = new Map((await c.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint
        where contype = 'f' and confrelid = 'self_auth."user"'::regclass and connamespace = 'public'::regnamespace`)).rows
        .map((r) => [r.conname as string, r.d as string]));
      expect(fks.get('profiles_user_id_fkey')).toBe('FOREIGN KEY (user_id) REFERENCES self_auth."user"(id) ON DELETE CASCADE');
      for (const t of CREATED_BY_TABLES) {
        expect(fks.get(`${t}_created_by_fkey`)).toBe('FOREIGN KEY (created_by) REFERENCES self_auth."user"(id) ON DELETE SET NULL');
      }
      // Nothing of ours is left on auth.users; the Self-Auth provisioning trigger stays, its delete stand-in goes.
      const triggers = (await c.query(`select tgname from pg_trigger where not tgisinternal
        and tgrelid in ('auth.users'::regclass, 'self_auth."user"'::regclass) order by 1`)).rows.map((r) => r.tgname);
      expect(triggers).toEqual(['self_auth_user_created']);
      expect((await c.query(`select 1 from pg_proc where proname = 'handle_deleted_user'`)).rows).toEqual([]);
      // No function reads Supabase Auth's tables any more.
      expect((await c.query(`select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app', 'app_private') and p.prosrc ~ 'auth\\.(users|sessions|mfa_factors)'`)).rows).toEqual([]);
      expect((await c.query(`select prosrc from pg_proc where proname = 'console_add_first_admin'`)).rows[0].prosrc).not.toContain('public.profiles');

      // The imported Self-Auth factor still makes aal2 necessary; a leftover Supabase factor alone no longer does.
      await as(c, id, A, 'aal1');
      expect((await c.query('select app_private.mfa_satisfied() ok')).rows[0].ok).toBe(false);
      await as(c, id, A, 'aal2');
      expect((await c.query('select app_private.mfa_satisfied() ok')).rows[0].ok).toBe(true);
      await c.query('reset role');
      await c.query('delete from self_auth.totp_factor where user_id = $1', [id]);
      await as(c, id, A, 'aal1');
      expect((await c.query('select app_private.mfa_satisfied() ok')).rows[0].ok).toBe(true);

      // Deleting a Self-Auth user now runs the keys' actions: profile (and membership) gone, created_by cleared.
      await c.query('reset role');
      await c.query('alter table public.company_members disable trigger company_members_protect_last_admin');
      await c.query('delete from self_auth."user" where id = $1', [split]);
      expect((await c.query('select count(*)::int n from public.profiles where user_id = $1', [split])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from public.company_members where user_id = $1', [split])).rows[0].n).toBe(0);
      expect((await c.query('select created_by from public.patients where id = $1', [inB])).rows[0].created_by).toBeNull();
      expect((await c.query('select created_by from public.patients where id = $1', [inA])).rows[0].created_by).toBe(id);
      // A profile for an id Self-Auth doesn't have is refused now.
      await c.query('savepoint s');
      await expect(c.query(`insert into public.profiles (user_id, email, full_name) values ($1, 'zz-impb-ghost@example.com', 'x')`, [randomUUID()]))
        .rejects.toThrow(/profiles_user_id_fkey/);
      await c.query('rollback to savepoint s');
    });
  });

  it('stops with a clear list when a row points at someone without a Self-Auth account', async () => {
    const leftovers = await unimportedMembers();
    if (leftovers.length) {
      await withPg(async (pg) => runImport({ db: 'app', apply: true, pg, auth: await nodeAuth(), onlyUserIds: leftovers, log: () => undefined }));
    }
    await withTx(async (c) => {
      await removeSupabaseOnlyUsers(c);
      const ghost = randomUUID();
      await c.query(`insert into public.profiles (user_id, email, full_name) values ($1, 'zz-impb-ghost@example.com', 'Zz Ghost')`, [ghost]);
      await expect(c.query(B_APP)).rejects.toThrow(/no Self-Auth account[^]*profiles: 1/);
    });
  });
});

describe('Migration B (0103): bind_session', () => {
  it('bind_rejects_session_not_in_self_auth', async () => {
    const leftovers = await unimportedMembers();
    if (leftovers.length) {
      await withPg(async (pg) => runImport({ db: 'app', apply: true, pg, auth: await nodeAuth(), onlyUserIds: leftovers, log: () => undefined }));
    }
    await withTx(async (c) => {
      await removeSupabaseOnlyUsers(c);
      await c.query(B_APP);
      const m = (await c.query(`select m.user_id, m.company_id from public.company_members m
        join self_auth."user" u on u.id = m.user_id order by m.created_at limit 1`)).rows[0] as { user_id: string; company_id: string };
      const other = (await c.query('select id as user_id from self_auth."user" where id <> $1 limit 1', [m.user_id])).rows[0] as { user_id: string };
      const session = async (user: string, expires: string) => (await c.query(
        `insert into self_auth.session ("expiresAt", token, "updatedAt", "userId")
         values (now() + $2::interval, gen_random_uuid()::text, now(), $1) returning id`, [user, expires])).rows[0].id as string;
      const tryBind = async (sessionId: string): Promise<string> => {
        await c.query('savepoint b');
        await c.query(`select set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: m.user_id, role: 'authenticated', session_id: sessionId, aal: 'aal2' })]);
        await c.query('set local role authenticated');
        try {
          await c.query('select public.bind_my_session($1)', [m.company_id]);
          await c.query('reset role');
          await c.query('release savepoint b');
          return 'bound';
        } catch (e) {
          await c.query('rollback to savepoint b');
          return (e as Error).message;
        }
      };
      const live = await session(m.user_id, '1 hour');
      const expired = await session(m.user_id, '-1 hour');
      const othersSession = await session(other.user_id, '1 hour');

      // A made-up id (an old Supabase Auth token's), an expired session and another user's live session are refused.
      expect(await tryBind(randomUUID())).toBe('No sign-in session.');
      expect(await tryBind(expired)).toBe('No sign-in session.');
      expect(await tryBind(othersSession)).toBe('No sign-in session.');
      expect((await c.query('select count(*)::int n from app.session_companies where session_id = any($1::uuid[])',
        [[expired, othersSession]])).rows[0].n).toBe(0);
      // The user's own live Self-Auth session binds.
      expect(await tryBind(live)).toBe('bound');
      expect((await c.query('select company_id from app.session_companies where session_id = $1', [live])).rows)
        .toEqual([{ company_id: m.company_id }]);
    });
  });
});
