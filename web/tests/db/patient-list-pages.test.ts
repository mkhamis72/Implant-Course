import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres, asCompany } from './helpers';

const users = inject('testUsers');

// Patients list in pages (0124): search_patients_v2 returns one page (by name, then id) and
// search_patients_count the number of matches, both with the 0098 filter.
type Args = { q?: string; archived?: boolean; stages?: string[]; course?: string | null; supervisor?: string | null };

async function page(c: Client, a: Args, offset: number, limit: number): Promise<string[]> {
  const { rows } = await c.query(
    `select id from public.search_patients_v2(q => $1, include_archived => $2, stages => $3, course => $4,
       supervisor => $5, p_offset => $6, p_limit => $7)`,
    [a.q ?? '', a.archived ?? false, a.stages ?? [], a.course ?? null, a.supervisor ?? null, offset, limit],
  );
  return rows.map((r) => r.id as string);
}

async function count(c: Client, a: Args): Promise<number> {
  const { rows } = await c.query(
    `select public.search_patients_count(q => $1, include_archived => $2, stages => $3, course => $4,
       supervisor => $5)::int as n`,
    [a.q ?? '', a.archived ?? false, a.stages ?? [], a.course ?? null, a.supervisor ?? null],
  );
  return rows[0].n;
}

/** 120 patients named Zz Pages 000 … 119, as the organizer; returns their ids in name order. */
async function seed(c: Client): Promise<string[]> {
  await actAs(c, users.organizer);
  const ids: string[] = [];
  for (let i = 0; i < 120; i++) {
    const name = `Zz Pages ${String(i).padStart(3, '0')}`;
    ids.push((await c.query('insert into public.patients (full_name) values ($1) returning id', [name])).rows[0].id);
  }
  return ids;
}

describe('patient list pages (0124)', () => {
  it('gives pages of 50 / 50 / 20 in name order, with no overlap and nothing missing, and counts 120', async () => {
    await withTx(async (c) => {
      const ids = await seed(c);
      const pages = [await page(c, { q: 'Zz Pages' }, 0, 50), await page(c, { q: 'Zz Pages' }, 50, 50), await page(c, { q: 'Zz Pages' }, 100, 50)];
      expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
      expect(pages.flat()).toEqual(ids);
      expect(await page(c, { q: 'Zz Pages' }, 120, 50)).toEqual([]);
      expect(await count(c, { q: 'Zz Pages' })).toBe(120);
    });
  });

  it('breaks ties between equal names by id, so pages are stable', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        ids.push((await c.query("insert into public.patients (full_name) values ('Zz Pages Twin') returning id")).rows[0].id);
      }
      const all = [...(await page(c, { q: 'Zz Pages Twin' }, 0, 3)), ...(await page(c, { q: 'Zz Pages Twin' }, 3, 3))];
      expect(all).toEqual([...ids].sort());
    });
  });

  it('caps the limit at 100 and treats a negative offset as 0', async () => {
    await withTx(async (c) => {
      const ids = await seed(c);
      expect(await page(c, { q: 'Zz Pages' }, 0, 500)).toHaveLength(100);
      expect(await page(c, { q: 'Zz Pages' }, -10, 5)).toEqual(ids.slice(0, 5));
    });
  });

  it('narrows the rows and the count the same way, and leaves archived patients out unless asked', async () => {
    await withTx(async (c) => {
      const ids = await seed(c);
      for (const id of ids.slice(0, 7)) {
        await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'missing')", [id]);
      }
      await asPostgres(c);
      await c.query('update public.patients set archived = true where id = any($1)', [ids.slice(110)]);
      await actAs(c, users.organizer);
      const missing = { q: 'Zz Pages', stages: ['missing'] };
      expect(await page(c, missing, 0, 50)).toEqual(ids.slice(0, 7));
      expect(await count(c, missing)).toBe(7);
      expect(await count(c, { q: 'Zz Pages 01' })).toBe(10);
      expect(await page(c, { q: 'Zz Pages 01' }, 0, 50)).toHaveLength(10);
      expect(await count(c, { q: 'Zz Pages' })).toBe(110);
      expect(await page(c, { q: 'Zz Pages' }, 100, 50)).toEqual(ids.slice(100, 110));
      expect(await count(c, { q: 'Zz Pages', archived: true })).toBe(120);
      expect(await page(c, { q: 'Zz Pages', archived: true }, 100, 50)).toEqual(ids.slice(100));
    });
  });

  it("never counts or lists another company's patients", async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-pages', 'Zz B') returning id`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
        [b, users.admin]);
      await asCompany(c, b);
      for (let i = 0; i < 3; i++) {
        await c.query(`insert into public.patients (company_id, full_name) values ($1, $2)`, [b, `Zz Pages Other ${i}`]);
      }
      await actAs(c, users.organizer);
      await c.query("insert into public.patients (full_name) values ('Zz Pages Own')");
      expect(await count(c, { q: 'Zz Pages' })).toBe(1);
      expect(await page(c, { q: 'Zz Pages' }, 0, 50)).toHaveLength(1);
    });
  });

  it('is invoker, granted to authenticated only, with no overloads or defaults', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select p.proname, p.prosecdef, p.pronargdefaults,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('search_patients_v2', 'search_patients_count')
         order by p.proname`,
      );
      expect(rows).toEqual([
        { proname: 'search_patients_count', prosecdef: false, pronargdefaults: 0, anon: false, auth: true },
        { proname: 'search_patients_v2', prosecdef: false, pronargdefaults: 0, anon: false, auth: true },
      ]);
    });
  });
});
