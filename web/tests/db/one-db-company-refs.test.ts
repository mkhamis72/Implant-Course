import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asCompany, asPostgres } from './helpers';
import { makeCourse, makeDelegate } from './fixtures';

// 0094: a company can only name its own rows in study codes and pending logins.

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the test admin as its active admin. */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-refs', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`, [b, users.admin]);
  return b;
}

const codeOf = async (c: Client, entity: string, id: string) =>
  (await c.query('select public.research_code($1, $2) as code', [entity, id])).rows[0].code as string | null;

const codeRows = async (c: Client, id: string) => {
  await asPostgres(c);
  return (await c.query('select company_id from app_private.research_codes where entity_id = $1', [id])).rows;
};

describe('study codes are per company (0094)', () => {
  it('keys research_codes by company, entity and entity id', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`select array_agg(a.attname::text order by k.ord) as cols
        from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where i.indrelid = 'app_private.research_codes'::regclass and i.indisprimary`);
      expect(rows[0].cols).toEqual(['company_id', 'entity', 'entity_id']);
    });
  });

  it("research_code gives nothing for another company's row and stores nothing; that company still gets its code", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await asCompany(c);
      const academyCourse = await makeCourse(c);
      await asCompany(c, b, users.admin);
      const bCourse = await makeCourse(c);

      await actAsBound(c, users.admin, b);
      expect(await codeOf(c, 'course', academyCourse)).toBeNull();
      expect(await codeOf(c, 'course', bCourse)).toMatch(/^C-/);
      expect(await codeRows(c, academyCourse)).toEqual([]);

      await actAsBound(c, users.admin);
      expect(await codeOf(c, 'course', academyCourse)).toMatch(/^C-/);
      expect(await codeRows(c, academyCourse)).toEqual([{ company_id: 'a7c0de00-0000-4000-8000-000000000001' }]);
    });
  });

  it("assign_research_codes stores no code for another company's course or delegate filter", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await asCompany(c);
      const academyCourse = await makeCourse(c);
      const academyDelegate = await makeDelegate(c, 'Zz Refs Academy Delegate');

      await actAsBound(c, users.admin, b);
      await c.query('select public.assign_research_codes($1, null, null, $2, null, null)', [academyCourse, academyDelegate]);
      expect(await codeRows(c, academyCourse)).toEqual([]);
      expect(await codeRows(c, academyDelegate)).toEqual([]);

      await actAsBound(c, users.admin);
      expect(await codeOf(c, 'course', academyCourse)).toMatch(/^C-/);
      expect(await codeOf(c, 'delegate', academyDelegate)).toMatch(/^D-/);
    });
  });
});

describe('create_pending_login names only its own delegates (0094)', () => {
  it("refuses another company's delegate with Delegate not found., accepts its own", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await asCompany(c);
      const academyDelegate = await makeDelegate(c, 'Zz Refs Academy Delegate');
      await asCompany(c, b, users.admin);
      const bDelegate = await makeDelegate(c, 'Zz Refs B Delegate');

      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.create_pending_login('zz-refs-a@example.com', 'Zz', 'delegate', $1)`, [academyDelegate]),
        /^Delegate not found\.$/);
      await c.query(`select public.create_pending_login('zz-refs-b@example.com', 'Zz', 'delegate', $1)`, [bDelegate]);
      await asPostgres(c);
      expect((await c.query(`select company_id, delegate_id from app_private.pending_logins where email like 'zz-refs-%'`)).rows)
        .toEqual([{ company_id: b, delegate_id: bDelegate }]);
    });
  });
});
