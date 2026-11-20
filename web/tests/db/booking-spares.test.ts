import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asCompany, asPostgres } from './helpers';
import { insertSelfAuthUser, makeChair, makeCourse, makePatient, makeProduct, makeSession, pendingLogin } from './fixtures';

// Spare implants on a booking (0125): slot_spare_implants, create_surgery_slot_v4 and pull_list_v2.

const users = inject('testUsers');

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const asAdmin = (c: Client) => actAs(c, users.admin, { aal: 'aal2' });

type Seed = { session: string; date: string; chair: string; doctor: string; brand: string; products: string[] };

/** A surgery day on a date no other test uses, a chair, a doctor and five implant products of a brand unique to
 *  the test, written as postgres bound to academy. */
async function seed(c: Client, name: string): Promise<Seed> {
  await asCompany(c);
  const date = (await one(c, `select to_char('2080-01-01'::date + floor(random() * 3650)::int, 'YYYY-MM-DD')`)) as string;
  const course = await makeCourse(c, date, date);
  const session = await makeSession(c, course, 'surgery', date);
  const chair = await makeChair(c);
  const doctor = (await one(c, `insert into public.doctors (name) values ($1) returning id`, [`Zz Dr Spares ${name}`])) as string;
  const brand = `Zz Spares ${name} ${Math.random().toString(36).slice(2, 8)}`;
  const products: string[] = [];
  for (let i = 0; i < 7; i++) products.push(await makeProduct(c, 'implant', brand));
  return { session, date, chair, doctor, brand, products };
}

type Item = { tooth: number; product_id?: string | null; technique?: string; spares?: string[] };

const params = (s: Seed, patient: string, implants: Item[]) => [s.session, s.chair, patient, s.doctor,
  JSON.stringify(implants.map((i) => ({ technique: 'guided', ...i })))];
const call = (fn: string) => `select public.${fn}(
  p_session => $1, p_chair => $2, p_start => '09:00'::time, p_end => '10:00'::time, p_patient => $3, p_supervisor => null,
  p_placing => '{}'::uuid[], p_assisting => '{}'::uuid[], p_implants => $5::jsonb, p_override_reason => 'Zz test',
  p_notes => '', p_placing_doctor => $4, p_setting => null, p_date => null) as id`;
const V4 = call('create_surgery_slot_v4');
const V3 = call('create_surgery_slot_v3');

const book = async (c: Client, s: Seed, patient: string, implants: Item[], sql = V4) =>
  (await one(c, sql, params(s, patient, implants))) as string;

const newPatient = async (c: Client, name: string) => {
  await asCompany(c);
  const id = await makePatient(c, `Zz Spares ${name} Patient`);
  await asAdmin(c);
  return id;
};

describe('booking spares (0125)', () => {
  it('v4 stores spares in order', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Order');
      const patient = await newPatient(c, 'Order');
      const [planned, a, b, d] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 11, product_id: planned, spares: [d, a, b] }, { tooth: 12 }]);

      const { rows } = await c.query(
        `select tooth::int as tooth, product_id, position from public.slot_spare_implants where slot_id = $1 order by position`,
        [slot]);
      expect(rows).toEqual([
        { tooth: 11, product_id: d, position: 1 },
        { tooth: 11, product_id: a, position: 2 },
        { tooth: 11, product_id: b, position: 3 },
      ]);
    });
  });

  it('v4 refuses 6 spares', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Six');
      const patient = await newPatient(c, 'Six');
      const [planned, ...rest] = s.products;
      await refused(c, V4, params(s, patient, [{ tooth: 21, product_id: planned, spares: rest.slice(0, 6) }]),
        /Tooth 21 has more than 5 spares\./);
      // Five is allowed.
      expect(await book(c, s, patient, [{ tooth: 21, product_id: planned, spares: rest.slice(0, 5) }])).toBeTruthy();
    });
  });

  it('v4 refuses a spare equal to the planned implant', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Same');
      const patient = await newPatient(c, 'Same');
      const [planned, a] = s.products;
      await refused(c, V4, params(s, patient, [{ tooth: 31, product_id: planned, spares: [a, planned] }]),
        /Tooth 31 lists the same implant twice\./);
      await refused(c, V4, params(s, patient, [{ tooth: 31, product_id: planned, spares: [a, a] }]),
        /Tooth 31 lists the same implant twice\./);
      // The same spare on another tooth is fine.
      expect(await book(c, s, patient, [{ tooth: 31, product_id: planned, spares: [a] }, { tooth: 32, spares: [a] }]))
        .toBeTruthy();
    });
  });

  it('v4 refuses an inactive product', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Inactive');
      const [planned, a] = s.products;
      await asPostgres(c);
      await c.query(`update public.products set active = false where id = $1`, [a]);
      await asCompany(c);
      const abutment = await makeProduct(c, 'healing_abutment', s.brand);
      const patient = await newPatient(c, 'Inactive');
      const CATALOG = /Choose an implant from the catalog\./;
      await refused(c, V4, params(s, patient, [{ tooth: 41, product_id: planned, spares: [a] }]), CATALOG);
      await refused(c, V4, params(s, patient, [{ tooth: 41, product_id: planned, spares: [abutment] }]), CATALOG);
      await refused(c, V4, params(s, patient, [{ tooth: 41, product_id: planned, spares: [crypto.randomUUID()] }]), CATALOG);
    });
  });

  it('v4 without spares behaves like v3', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Like');
      const p3 = await newPatient(c, 'Like v3');
      const p4 = await newPatient(c, 'Like v4');
      const implants: Item[] = [{ tooth: 14, product_id: s.products[0] }, { tooth: 15, technique: 'free_hand' }];
      const slot3 = await book(c, s, p3, implants, V3);
      const slot4 = await book(c, s, p4, implants);

      const rowsOf = async (slot: string) => ({
        sites: (await c.query(
          `select tooth::int as tooth, state, product_id, technique, course_id, session_id from public.implant_sites
           where slot_id = $1 order by tooth`, [slot])).rows,
        planned: (await c.query(
          `select spi.tooth::int as tooth, spi.product_id, s.tooth::int as site_tooth from public.slot_planned_implants spi
           join public.implant_sites s on s.id = spi.implant_site_id where spi.slot_id = $1 order by spi.tooth`, [slot])).rows,
        spares: Number(await one(c, `select count(*) from public.slot_spare_implants where slot_id = $1`, [slot])),
      });
      const a = await rowsOf(slot3);
      expect(a.sites).toHaveLength(2);
      expect(await rowsOf(slot4)).toEqual(a);
      expect(a.spares).toBe(0);
    });
  });

  it('pull list counts spares', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Pull');
      const [p1, p2, p3, p4] = s.products;
      const patient = await newPatient(c, 'Pull');
      const other = await newPatient(c, 'Pull cancelled');
      await book(c, s, patient, [
        { tooth: 11, product_id: p1, spares: [p2] },
        { tooth: 12, product_id: p2, spares: [p1, p3] },
      ]);
      // A cancelled booking's teeth and spares are not counted.
      const cancelled = await book(c, s, other, [{ tooth: 21, product_id: p1, spares: [p4] }]);
      await c.query(`select public.cancel_surgery_slot($1, 'Zz test')`, [cancelled]);

      const { rows } = await c.query(
        `select product_id, brand, needed, spares from public.pull_list_v2($1::date) where brand = $2`, [s.date, s.brand]);
      const byProduct = Object.fromEntries(rows.map((r) => [r.product_id, { needed: r.needed, spares: r.spares }]));
      expect(byProduct).toEqual({
        [p1]: { needed: 1, spares: 1 },
        [p2]: { needed: 1, spares: 1 },
        [p3]: { needed: 0, spares: 1 },
      });
      // pull_list (0017) is unchanged for the previous app version.
      const old = await c.query(`select product_id, needed from public.pull_list($1::date) where brand = $2`, [s.date, s.brand]);
      expect(Object.fromEntries(old.rows.map((r) => [r.product_id, r.needed]))).toEqual({ [p1]: 1, [p2]: 1 });
    });
  });

  it('spares are company-scoped', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Scope');
      const patient = await newPatient(c, 'Scope');
      const slot = await book(c, s, patient, [{ tooth: 11, product_id: s.products[0], spares: [s.products[1]] }]);
      expect(Number(await one(c, `select count(*) from public.slot_spare_implants where slot_id = $1`, [slot]))).toBe(1);

      // Another company with its own admin (the isolation pattern of tenant-isolation.test.ts).
      await asPostgres(c);
      await c.query("select set_config('request.jwt.claims', '', true)");
      const tag = Math.random().toString(36).slice(2, 8);
      const companyB = (await one(c, `insert into public.companies (slug, name) values ($1, $2) returning id`,
        [`zz-spares-${tag}`, 'Zz Spares B'])) as string;
      const email = `zz-spares-${tag}-admin@example.com`;
      await pendingLogin(c, email, { company: companyB, role: 'admin', fullName: 'Zz Spares admin' });
      const adminB = await insertSelfAuthUser(c, { email, companyId: companyB });
      await actAsBound(c, adminB, companyB);

      expect(Number(await one(c, `select count(*) from public.slot_spare_implants`))).toBe(0);
      expect((await c.query(`select * from public.pull_list_v2($1::date)`, [s.date])).rows).toEqual([]);
      // Nor can B write a spare onto academy's booking.
      await refused(c,
        `insert into public.slot_spare_implants (slot_id, tooth, product_id, position) values ($1, 13, $2, 1)`,
        [slot, s.products[2]], /permission denied|row-level security|violates foreign key/);
    });
  });

  it('catalogue', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select p.proname, p.prosecdef, p.pronargdefaults, pg_get_userbyid(p.proowner) as owner,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('create_surgery_slot_v4', 'pull_list_v2')
         order by p.proname`);
      expect(rows).toEqual([
        { proname: 'create_surgery_slot_v4', prosecdef: true, pronargdefaults: 0, owner: 'tenant_definer',
          authenticated: true, anon: false, public: false },
        { proname: 'pull_list_v2', prosecdef: false, pronargdefaults: 0, owner: 'postgres',
          authenticated: true, anon: false, public: false },
      ]);
      // v4 takes v3's parameters, in the same order and types.
      const args = await c.query(
        `select proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and proname in ('create_surgery_slot_v3', 'create_surgery_slot_v4')`);
      const [a, b] = args.rows.map((r) => r.args);
      expect(a).toBe(b);
    });
  });

  it('needs Edit on Schedule', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Perm');
      await asCompany(c);
      const patient = await makePatient(c, 'Zz Spares Perm Patient');
      await actAs(c, users.viewer);
      await refused(c, V4, params(s, patient, [{ tooth: 11 }]), /permission/i);
    });
  });
});
