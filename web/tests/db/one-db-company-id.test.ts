import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeSession } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const SINGLETONS = ['public.settings', 'public.branding', 'public.branding_logos'];
// Tables created after 0084 that set company_id explicitly: no academy default, keyed by their own primary key.
const EXPLICIT_COMPANY = ['public.company_members', 'app_private.pending_logins', 'app_private.file_no_counters'];
const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '0084_company_id.sql');
/** 0083's app.company_tables(), which 0084 ran with: 0092 lists only tables that already have company_id. */
function companyTables0083(): string {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0083_companies.sql'), 'utf8');
  const start = sql.indexOf('create function app.company_tables()');
  return sql.slice(start, sql.indexOf('$;', start) + 3).replace('create function', 'create or replace function');
}

type TableInfo = {
  name: string; relname: string; pk: string[]; notnull: boolean; default_expr: string | null;
  fk_to_companies: boolean; leading_index: boolean; key_cols: string[] | null;
};

async function tables(c: Client): Promise<TableInfo[]> {
  const { rows } = await c.query(`
    select n.nspname || '.' || k.relname as name, k.relname,
      array(select a.attname::text from pg_constraint p, unnest(p.conkey) with ordinality u(attnum, i)
            join pg_attribute a on a.attnum = u.attnum
            where p.conrelid = t and p.contype = 'p' and a.attrelid = t order by u.i) as pk,
      coalesce(col.attnotnull, false) as notnull,
      pg_get_expr(d.adbin, d.adrelid) as default_expr,
      exists (select 1 from pg_constraint f where f.conrelid = t and f.contype = 'f'
              and f.confrelid = 'public.companies'::regclass and f.conkey = array[col.attnum]) as fk_to_companies,
      exists (select 1 from pg_index i where i.indrelid = t and i.indkey[0] = col.attnum
              and i.indexrelid = to_regclass(quote_ident(n.nspname) || '.' || quote_ident(k.relname || '_company_id_idx'))) as leading_index,
      (select array(select a.attname::text from unnest(u.conkey) with ordinality x(attnum, i)
                    join pg_attribute a on a.attrelid = t and a.attnum = x.attnum order by x.i)
       from pg_constraint u where u.conrelid = t and u.contype = 'u' and u.conname = k.relname || '_company_id_key') as key_cols
    from app.company_tables() t
    join pg_class k on k.oid = t join pg_namespace n on n.oid = k.relnamespace
    left join pg_attribute col on col.attrelid = t and col.attname = 'company_id' and not col.attisdropped
    left join pg_attrdef d on d.adrelid = t and d.adnum = col.attnum`);
  return rows;
}

describe('company_id on every company table (0084)', () => {
  it('adds a not-null company_id defaulting to the session company (0092), with an FK to companies and an index', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const all = await tables(c);
      expect(all.length).toBeGreaterThan(40);
      for (const t of all.filter((x) => !EXPLICIT_COMPANY.includes(x.name))) {
        expect({ name: t.name, notnull: t.notnull, fk: t.fk_to_companies, index: t.leading_index })
          .toEqual({ name: t.name, notnull: true, fk: true, index: true });
        expect(t.default_expr, t.name).toBe('app.current_company_id()');
      }
    });
  });

  it('keys singletons by company and id-keyed tables by (company_id, id)', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const all = await tables(c);
      for (const t of all) {
        // 0091 made company_id the singletons' primary key, replacing their unique (company_id).
        const singleton = SINGLETONS.includes(t.name);
        const expected = !singleton && t.pk.length === 1 && t.pk[0] === 'id' ? ['company_id', 'id'] : null;
        expect({ name: t.name, key: t.key_cols }).toEqual({ name: t.name, key: expected });
        if (singleton) expect({ name: t.name, pk: t.pk }).toEqual({ name: t.name, pk: ['company_id'] });
      }
      const composite = all.filter((t) => t.key_cols === null).map((t) => t.name);
      expect(composite).toEqual(expect.arrayContaining(['app_private.research_codes', 'public.medical_history', 'public.user_permissions']));
    });
  });

  it('gives every existing row academy', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      for (const t of await tables(c)) {
        // The backfill: nothing of the single-company data sits in another company. Companies provisioned later
        // (the console E2E leaves some on the local stack) legitimately hold rows of their own.
        const { rows } = await c.query(
          `select count(*)::int as n from ${t.name} where company_id <> $1
             and company_id in (select id from public.companies where created_at <= (select created_at from public.companies where id = $1))`,
          [ACADEMY_ID]);
        expect({ name: t.name, n: rows[0].n }).toEqual({ name: t.name, n: 0 });
      }
    });
  });

  it('stamps rows written through existing functions, and their audit rows, with academy', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const d = await makeDelegate(c);
      await enroll(c, course, d);
      const slot = await book(c, { session, chair, patient: await makePatient(c), supervisor: users.organizer, placing: [d] });
      await asPostgres(c);
      const s = await c.query('select company_id from public.surgery_slots where id = $1', [slot]);
      expect(s.rows).toEqual([{ company_id: ACADEMY_ID }]);
      const a = await c.query(
        `select company_id from public.audit_log where table_name = 'surgery_slots' and row_id = $1`, [slot]);
      expect(a.rows).toEqual([{ company_id: ACADEMY_ID }]);
    });
  });

  it('adds the column to the append-only ledger and audit log without touching a row', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      // Take the column off again, then run the migration as written: it must re-add it without
      // firing the no-change triggers, writing an audit row or adding ledger rows.
      await c.query('alter table public.stock_movements drop column company_id cascade');
      await c.query('alter table public.audit_log drop column company_id cascade');
      const before = (await c.query(
        'select (select count(*) from public.stock_movements)::int as moves, (select count(*) from public.audit_log)::int as audits, (select max(id) from public.audit_log)::text as last_audit',
      )).rows[0];
      await c.query(companyTables0083());
      await c.query(readFileSync(MIGRATION, 'utf8'));
      const after = (await c.query(
        'select (select count(*) from public.stock_movements)::int as moves, (select count(*) from public.audit_log)::int as audits, (select max(id) from public.audit_log)::text as last_audit',
      )).rows[0];
      expect(after).toEqual(before);
      const off = await c.query(
        `select (select count(*) from public.stock_movements where company_id is distinct from $1)::int as moves,
                (select count(*) from public.audit_log where company_id is distinct from $1)::int as audits`, [ACADEMY_ID]);
      expect(off.rows[0]).toEqual({ moves: 0, audits: 0 });
      expect((await tables(c)).filter((t) => ['public.stock_movements', 'public.audit_log'].includes(t.name))
        .map((t) => [t.name, t.notnull, t.fk_to_companies, t.leading_index, t.key_cols]).sort())
        .toEqual([['public.audit_log', true, true, true, ['company_id', 'id']], ['public.stock_movements', true, true, true, ['company_id', 'id']]]);
    });
  });
});
