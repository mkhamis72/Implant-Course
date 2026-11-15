import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asPostgres } from './helpers';
import { makePatient, makeDelegate, makeProduct, receive, makeCourse, makeSession, enroll, makeChair, pendingLogin, insertSelfAuthUser, insertSelfAuthFactor } from './fixtures';
import { exportCompany, parseExport, stringifyExport, type CompanyExport } from '../../scripts/company-export';
import { emptyExport, restoreCompany } from '../../scripts/company-restore';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

const B_ADMIN_EMAIL = 'zz-restore-admin@example.com';
const B_HOST = 'zz-company-restore.example.com';
const HASH = '$2a$10$zzrestorehash';

/** B's own admin: a Self-Auth account of company B (made through its pending login, as an invitation is accepted),
 *  with a password and a Google link carrying OAuth tokens (seededCompanyB adds the authenticator). */
async function bAdmin(c: Client, b: string): Promise<string> {
  await pendingLogin(c, B_ADMIN_EMAIL, { company: b, role: 'admin', fullName: 'Zz Restore Admin' });
  const id = await insertSelfAuthUser(c, { companyId: b, email: B_ADMIN_EMAIL });
  await c.query(`insert into self_auth.account ("accountId", "providerId", "userId", password, "updatedAt") values ($1::text, 'credential', $1::uuid, $2, now())`, [id, HASH]);
  await c.query(`insert into self_auth.account ("accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "updatedAt")
    values ('google-zz-restore', 'google', $1, 'zz-access', 'zz-refresh', 'zz-id-token', now())`, [id]);
  return id;
}

/** Deletes B the way docs/operations.md section D does: its rows (--delete), then step 4's SQL. */
async function eraseFully(c: Client, b: string): Promise<void> {
  // As in the SQL editor: postgres with no signed-in session (otherwise the audit rows would name company B).
  await c.query(`select set_config('request.jwt.claims', '', true)`);
  await restoreCompany(c, b, await emptyExport(c, b));
  await c.query(`delete from self_auth."user" where "companyId" = $1`, [b]);
  await c.query('delete from app.session_companies where company_id = $1', [b]);
  await c.query('delete from app_private.pending_logins where company_id = $1', [b]);
  await c.query('alter table public.companies disable trigger companies_audit');
  await c.query('delete from public.companies where id = $1', [b]);
  await c.query('alter table public.companies enable trigger companies_audit');
}

const companyRow = async (c: Client, id: string) =>
  (await c.query(`select to_jsonb(x) - 'updated_at' as r from public.companies x where id = $1`, [id])).rows[0]?.r;

/** Company B with its own admin and a little of everything, including a stock ledger. */
async function seededCompanyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name, hosts) values ('zz-company-restore', 'Zz Restore B', array[$1]) returning id`, [B_HOST])).rows[0].id;
  const admin = await bAdmin(c, b);
  await actAsBound(c, admin, b);
  await makePatient(c, 'Zz Restore Patient');
  const delegate = await makeDelegate(c, 'Zz Restore Delegate');
  const product = await makeProduct(c, 'implant', 'Zz Restore Brand');
  await receive(c, product, 5, 'ZZR-LOT');
  const course = await makeCourse(c);
  await makeSession(c, course);
  await enroll(c, course, delegate);
  await makeChair(c, 'Zz Restore Chair');
  await insertSelfAuthFactor(c, admin); // last: with it, writes need a 2FA session
  await asPostgres(c);
  return b;
}

/** Per company table: row count and an md5 of the rows, for one company. */
async function fingerprint(c: Client, companyId: string): Promise<Record<string, string>> {
  const { rows: tables } = await c.query<{ t: string }>('select x::text as t from app.company_tables() x order by 1');
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const { rows } = await c.query(
      `select count(*)::int as n, coalesce(md5(string_agg(r::text, '|' order by r::text)), '') as h from ${t} r where company_id = $1`, [companyId]);
    out[t] = `${rows[0].n}:${rows[0].h}`;
  }
  // The company's sign-in accounts (OAuth tokens left out: an export never carries them) and its members' profiles.
  const accounts = `(select id from self_auth."user" where "companyId" = $1::text)`;
  for (const [t, cols, where] of [
    ['self_auth."user"', 'r.*', `r."companyId" = $1::text`],
    ['self_auth.account', 'r.id, r."accountId", r."providerId", r."userId", r.password', `r."userId" in ${accounts}`],
    ['self_auth.totp_factor', 'r.*', `r.user_id in ${accounts}`],
    ['public.profiles', 'r.*', 'r.user_id in (select user_id from public.company_members where company_id = $1)'],
  ]) {
    const { rows } = await c.query(
      `select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from (select ${cols} from ${t} r where ${where}) x`, [companyId]);
    out[t] = `${rows[0].n}:${rows[0].h}`;
  }
  return out;
}

const viaFile = (data: CompanyExport): CompanyExport => parseExport(stringifyExport(data)) as CompanyExport;

describe('company export and restore', () => {
  it('exports the company row, its sign-in accounts (no OAuth tokens) and profiles first, then only its rows', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const data = await exportCompany(c, b);
      expect(data.format).toBe('company-export-v2');
      expect(data.company_id).toBe(b);
      expect(data.company).toMatchObject({ id: b, slug: 'zz-company-restore', hosts: [B_HOST] });
      const names = Object.keys(data.tables);
      expect(names.slice(0, 4)).toEqual(['self_auth.user', 'self_auth.account', 'self_auth.totp_factor', 'public.profiles']);
      expect(names).not.toContain('auth.users');
      const admin = data.tables['self_auth.user'].map((r) => r.id);
      expect(admin).toHaveLength(1);
      expect(data.tables['self_auth.user'][0].companyId).toBe(b);
      expect(data.tables['self_auth.account'].map((r) => r.providerId).sort()).toEqual(['credential', 'google']);
      for (const a of data.tables['self_auth.account']) {
        expect([a.accessToken, a.refreshToken, a.idToken, a.accessTokenExpiresAt, a.refreshTokenExpiresAt]).toEqual([null, null, null, null, null]);
      }
      expect(data.tables['self_auth.account'].find((a) => a.providerId === 'credential')?.password).toBe(HASH);
      expect(data.tables['self_auth.totp_factor'].map((r) => r.user_id)).toEqual(admin);
      expect(data.tables['public.patients'].map((r) => r.full_name)).toEqual(['Zz Restore Patient']);
      expect(data.tables['public.company_members']).toHaveLength(1);
      expect(data.tables['public.profiles'].map((r) => r.user_id)).toEqual(admin);
      expect(data.tables['public.stock_movements'].length).toBeGreaterThan(0);
      for (const [name, rows] of Object.entries(data.tables)) {
        if (name.startsWith('self_auth.') || name === 'public.profiles') continue;
        for (const row of rows) expect(row.company_id, name).toBe(b);
      }
      // parents before children: courses before sessions
      expect(names.indexOf('public.courses')).toBeLessThan(names.indexOf('public.sessions'));
    });
  });

  it("restoring B over a changed B puts B back exactly and leaves academy's rows untouched", async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const aBefore = await fingerprint(c, ACADEMY_ID);
      const bBefore = await fingerprint(c, b);
      const file = viaFile(await exportCompany(c, b));

      await c.query('delete from public.sessions where company_id = $1', [b]);
      await c.query(`update public.chairs set name = 'Zz Changed' where company_id = $1`, [b]);
      await c.query(`insert into public.chairs (company_id, name) values ($1, 'Zz Extra')`, [b]);
      expect(await fingerprint(c, b)).not.toEqual(bBefore);

      const log = await restoreCompany(c, b, file);
      expect(log.join('\n')).toMatch(/public\.patients/);

      expect(await fingerprint(c, b)).toEqual(bBefore);
      expect(await fingerprint(c, ACADEMY_ID)).toEqual(aBefore);
      const again = await exportCompany(c, b);
      expect(again.tables).toEqual(file.tables);
      // triggers are back on for the rest of the session
      expect((await c.query(`select current_setting('session_replication_role') as r`)).rows[0].r).toBe('origin');
    });
  });

  it('restores a company whose rows were all deleted, keeping the stock ledger identical', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const bBefore = await fingerprint(c, b);
      const file = viaFile(await exportCompany(c, b));
      const tables = Object.keys(file.tables).filter((t) => !t.startsWith('self_auth.') && t !== 'public.profiles');
      for (const t of tables) await c.query(`alter table ${t} disable trigger user`);
      for (const t of [...tables].reverse()) await c.query(`delete from ${t} where company_id = $1`, [b]);
      for (const t of tables) await c.query(`alter table ${t} enable trigger user`);
      await restoreCompany(c, b, file);
      expect(await fingerprint(c, b)).toEqual(bBefore);
    });
  });

  it("refuses a file for another company, or with a row carrying another company's id", async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const file = viaFile(await exportCompany(c, b));
      const before = await fingerprint(c, ACADEMY_ID);

      await c.query('savepoint s');
      await expect(restoreCompany(c, ACADEMY_ID, file)).rejects.toThrow(/company/i);
      await c.query('rollback to savepoint s');

      const planted = viaFile(file);
      planted.tables['public.chairs'][0].company_id = ACADEMY_ID;
      await c.query('savepoint s');
      await expect(restoreCompany(c, b, planted)).rejects.toThrow(/company_id/);
      await c.query('rollback to savepoint s');

      const stranger = viaFile(file);
      stranger.tables['public.profiles'].push({ ...stranger.tables['public.profiles'][0], user_id: users.organizer });
      await c.query('savepoint s');
      await expect(restoreCompany(c, b, stranger)).rejects.toThrow(/member/i);
      await c.query('rollback to savepoint s');

      // An account of another company, or a password or authenticator of someone not in the file.
      const foreign = viaFile(file);
      foreign.tables['self_auth.user'][0].companyId = ACADEMY_ID;
      await c.query('savepoint s');
      await expect(restoreCompany(c, b, foreign)).rejects.toThrow(/self_auth\.user.*another company/);
      await c.query('rollback to savepoint s');
      for (const [t, key] of [['self_auth.account', 'userId'], ['self_auth.totp_factor', 'user_id']]) {
        const orphan = viaFile(file);
        orphan.tables[t][0][key] = users.organizer;
        await c.query('savepoint s');
        await expect(restoreCompany(c, b, orphan), t).rejects.toThrow(/not an account of the company/);
        await c.query('rollback to savepoint s');
      }

      expect(await fingerprint(c, ACADEMY_ID)).toEqual(before);
    });
  });

  it("restoring an empty file erases the company's rows and nothing of academy's or the accounts", async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const aBefore = await fingerprint(c, ACADEMY_ID);
      const accounts = (await fingerprint(c, b))['self_auth."user"'];
      await restoreCompany(c, b, await emptyExport(c, b));
      const after = await fingerprint(c, b);
      expect(Object.entries(after).filter(([t]) => !t.startsWith('self_auth') && t !== 'public.profiles').every(([, v]) => v === '0:')).toBe(true);
      expect(await fingerprint(c, ACADEMY_ID)).toEqual(aBefore);
      expect((await c.query('select 1 from public.companies where id = $1', [b])).rowCount).toBe(1);
      expect(after['self_auth."user"']).toBe(accounts);
    });
  });

  it('rebuilds a fully erased company from its export: company row, accounts, authenticator, members and data', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const aBefore = await fingerprint(c, ACADEMY_ID);
      const bBefore = await fingerprint(c, b);
      const companyBefore = await companyRow(c, b);
      const file = viaFile(await exportCompany(c, b));
      await eraseFully(c, b);

      await c.query('savepoint s');
      await expect(restoreCompany(c, b, file)).rejects.toThrow(/--create/);
      await c.query('rollback to savepoint s');

      await restoreCompany(c, b, file, { create: true });
      expect(await companyRow(c, b)).toEqual(companyBefore);
      expect(await fingerprint(c, b)).toEqual(bBefore);
      expect(await fingerprint(c, ACADEMY_ID)).toEqual(aBefore);
    });
  });

  it('a restore never changes an account that still exists (a password changed after the export stays)', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const file = viaFile(await exportCompany(c, b));
      const admin = file.tables['self_auth.user'][0].id as string;
      const changed = `update self_auth.account set password = '$2a$10$zznewerhash' where "userId" = $1 and "providerId" = 'credential'`;
      await c.query(changed, [admin]);
      await restoreCompany(c, b, file);
      expect((await c.query(`select password from self_auth.account where "userId" = $1 and "providerId" = 'credential'`, [admin])).rows[0].password)
        .toBe('$2a$10$zznewerhash');
    });
  });

  it('still restores an export made before accounts were included (format v1, with auth.users)', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const bBefore = await fingerprint(c, b);
      const v2 = viaFile(await exportCompany(c, b));
      const tables = Object.fromEntries(Object.entries(v2.tables).filter(([t]) => !t.startsWith('self_auth.')));
      const v1 = { format: 'company-export-v1', company_id: b, exported_at: v2.exported_at, tables: { 'auth.users': [], ...tables } };
      await c.query('delete from public.chairs where company_id = $1', [b]);
      await restoreCompany(c, b, v1);
      expect(await fingerprint(c, b)).toEqual(bBefore);
    });
  });

  it('create refuses a company that exists, a slug or an address another company now holds', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const file = viaFile(await exportCompany(c, b));
      await c.query('savepoint s');
      await expect(restoreCompany(c, b, file, { create: true })).rejects.toThrow(/already exists/);
      await c.query('rollback to savepoint s');

      await eraseFully(c, b);
      await c.query('savepoint s');
      await c.query(`insert into public.companies (slug, name) values ('zz-company-restore', 'Zz Taken')`);
      await expect(restoreCompany(c, b, file, { create: true })).rejects.toThrow(/zz-company-restore.*another company/);
      await c.query('rollback to savepoint s');

      await c.query('savepoint s');
      await c.query(`insert into public.companies (slug, name, hosts) values ('zz-other-host', 'Zz Host', array[$1])`, [B_HOST]);
      await expect(restoreCompany(c, b, file, { create: true })).rejects.toThrow(/address.*zz-other-host/);
      await c.query('rollback to savepoint s');
    });
  });

  it('rolls back when the restored rows break a foreign key', async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const file = viaFile(await exportCompany(c, b));
      const bBefore = await fingerprint(c, b);
      file.tables['public.courses'] = [];
      await c.query('savepoint s');
      await expect(restoreCompany(c, b, file)).rejects.toThrow(/foreign key/i);
      await c.query('rollback to savepoint s');
      expect(await fingerprint(c, b)).toEqual(bBefore);
    });
  });
});
