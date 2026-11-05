import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asPostgres } from './helpers';
import { makePatient, makeDelegate, makeProduct, receive, makeCourse, makeSession, enroll, makeChair } from './fixtures';
import { exportCompany, parseExport, stringifyExport, type CompanyExport } from '../../scripts/company-export';
import { emptyExport, restoreCompany } from '../../scripts/company-restore';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** Company B with the test admin as its admin and a little of everything, including a stock ledger. */
async function seededCompanyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-restore', 'Zz Restore B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`, [b, users.admin]);
  await actAsBound(c, users.admin, b);
  await makePatient(c, 'Zz Restore Patient');
  const delegate = await makeDelegate(c, 'Zz Restore Delegate');
  const product = await makeProduct(c, 'implant', 'Zz Restore Brand');
  await receive(c, product, 5, 'ZZR-LOT');
  const course = await makeCourse(c);
  await makeSession(c, course);
  await enroll(c, course, delegate);
  await makeChair(c, 'Zz Restore Chair');
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
  return out;
}

const viaFile = (data: CompanyExport): CompanyExport => parseExport(stringifyExport(data)) as CompanyExport;

describe('company export and restore', () => {
  it("exports only the company's rows, with its members' profiles and accounts first", async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const data = await exportCompany(c, b);
      expect(data.company_id).toBe(b);
      const names = Object.keys(data.tables);
      expect(names.slice(0, 2)).toEqual(['auth.users', 'public.profiles']);
      expect(data.tables['public.patients'].map((r) => r.full_name)).toEqual(['Zz Restore Patient']);
      expect(data.tables['public.company_members']).toHaveLength(1);
      expect(data.tables['auth.users'].map((r) => r.id)).toEqual([users.admin]);
      expect(data.tables['public.profiles'].map((r) => r.user_id)).toEqual([users.admin]);
      expect(data.tables['public.stock_movements'].length).toBeGreaterThan(0);
      for (const [name, rows] of Object.entries(data.tables)) {
        if (name === 'auth.users' || name === 'public.profiles') continue;
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
      const tables = Object.keys(file.tables).filter((t) => t !== 'auth.users' && t !== 'public.profiles');
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

      expect(await fingerprint(c, ACADEMY_ID)).toEqual(before);
    });
  });

  it("restoring an empty file erases the company's rows and nothing of academy's or the accounts", async () => {
    await withTx(async (c) => {
      const b = await seededCompanyB(c);
      const aBefore = await fingerprint(c, ACADEMY_ID);
      await restoreCompany(c, b, await emptyExport(c, b));
      const after = await fingerprint(c, b);
      expect(Object.values(after).every((v) => v === '0:')).toBe(true);
      expect(await fingerprint(c, ACADEMY_ID)).toEqual(aBefore);
      expect((await c.query('select 1 from public.companies where id = $1', [b])).rowCount).toBe(1);
      expect((await c.query('select 1 from public.profiles where user_id = $1', [users.admin])).rowCount).toBe(1);
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
