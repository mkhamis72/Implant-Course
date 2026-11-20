import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asCompany } from './helpers';
import { makeChair, makeCourse, makePatient, makeProduct, makeSession } from './fixtures';

// Editing a booking's whole set of planned implants (0126): set_booking_implants.

const users = inject('testUsers');

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const asAdmin = (c: Client) => actAs(c, users.admin, { aal: 'aal2' });

type Seed = { session: string; date: string; course: string; chair: string; doctor: string; products: string[] };

/** A surgery day on a date no other test uses, a chair, a doctor and six implant products of a brand unique to
 *  the test, written as postgres bound to academy. */
async function seed(c: Client, name: string): Promise<Seed> {
  await asCompany(c);
  const date = (await one(c, `select to_char('2080-01-01'::date + floor(random() * 3650)::int, 'YYYY-MM-DD')`)) as string;
  const course = await makeCourse(c, date, date);
  const session = await makeSession(c, course, 'surgery', date);
  const chair = await makeChair(c);
  const doctor = (await one(c, `insert into public.doctors (name) values ($1) returning id`, [`Zz Dr SetImpl ${name}`])) as string;
  const brand = `Zz SetImpl ${name} ${Math.random().toString(36).slice(2, 8)}`;
  const products: string[] = [];
  for (let i = 0; i < 6; i++) products.push(await makeProduct(c, 'implant', brand));
  return { session, date, course, chair, doctor, products };
}

type Item = { tooth: number; product_id?: string | null; technique?: string; spares?: string[] };
const json = (implants: Item[]) => JSON.stringify(implants.map((i) => ({ technique: 'guided', ...i })));

const V4 = `select public.create_surgery_slot_v4(
  p_session => $1, p_chair => $2, p_start => $6::time, p_end => $7::time, p_patient => $3, p_supervisor => null,
  p_placing => '{}'::uuid[], p_assisting => '{}'::uuid[], p_implants => $5::jsonb, p_override_reason => 'Zz test',
  p_notes => '', p_placing_doctor => $4, p_setting => null, p_date => null) as id`;
const SET = `select public.set_booking_implants(p_slot => $1, p_implants => $2::jsonb)`;

const book = async (c: Client, s: Seed, patient: string, implants: Item[], start = '09:00', end = '10:00') =>
  (await one(c, V4, [s.session, s.chair, patient, s.doctor, json(implants), start, end])) as string;
const setImplants = (c: Client, slot: string, implants: Item[]) => c.query(SET, [slot, json(implants)]);

const newPatient = async (c: Client, name: string) => {
  await asCompany(c);
  const id = await makePatient(c, `Zz SetImpl ${name} Patient`);
  await asAdmin(c);
  return id;
};

/** The booking's teeth as planned rows, sites and spares. */
async function stateOf(c: Client, slot: string) {
  return {
    planned: (await c.query(
      `select spi.tooth::int as tooth, spi.product_id, s.product_id as site_product, s.technique, s.state::text as state,
              s.slot_id = spi.slot_id as attached
       from public.slot_planned_implants spi join public.implant_sites s on s.id = spi.implant_site_id
       where spi.slot_id = $1 order by spi.tooth`, [slot])).rows,
    spares: (await c.query(
      `select tooth::int as tooth, product_id, position from public.slot_spare_implants where slot_id = $1
       order by tooth, position`, [slot])).rows,
  };
}

describe('set_booking_implants (0126)', () => {
  it('adds a tooth', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Add');
      const patient = await newPatient(c, 'Add');
      const [p1, p2, p3] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 11, product_id: p1 }]);
      await setImplants(c, slot, [{ tooth: 11, product_id: p1 }, { tooth: 12, product_id: p2, technique: 'free_hand', spares: [p3] }]);

      const st = await stateOf(c, slot);
      expect(st.planned).toEqual([
        { tooth: 11, product_id: p1, site_product: p1, technique: 'guided', state: 'planned', attached: true },
        { tooth: 12, product_id: p2, site_product: p2, technique: 'free_hand', state: 'planned', attached: true },
      ]);
      expect(st.spares).toEqual([{ tooth: 12, product_id: p3, position: 1 }]);
      const site = (await c.query(
        `select session_id, course_id from public.implant_sites where patient_id = $1 and tooth = 12`, [patient])).rows[0];
      expect(site).toEqual({ session_id: s.session, course_id: s.course });
      expect(await one(c, `select status::text from public.tooth_status where patient_id = $1 and tooth = 12`, [patient]))
        .toBe('implant_planned');
    });
  });

  it('changes product and technique', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Change');
      const patient = await newPatient(c, 'Change');
      const [p1, p2] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 21, product_id: p1 }]);
      const siteBefore = await one(c, `select id from public.implant_sites where slot_id = $1`, [slot]);
      await setImplants(c, slot, [{ tooth: 21, product_id: p2, technique: 'free_hand' }]);

      expect((await stateOf(c, slot)).planned).toEqual([
        { tooth: 21, product_id: p2, site_product: p2, technique: 'free_hand', state: 'planned', attached: true },
      ]);
      // Same site, edited in place.
      expect(await one(c, `select id from public.implant_sites where slot_id = $1`, [slot])).toBe(siteBefore);
    });
  });

  it('changes a tooth number', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Number');
      const patient = await newPatient(c, 'Number');
      const [p1, p2] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 31, product_id: p1, spares: [p2] }]);
      await setImplants(c, slot, [{ tooth: 32, product_id: p1, spares: [p2] }]);

      const st = await stateOf(c, slot);
      expect(st.planned).toEqual([
        { tooth: 32, product_id: p1, site_product: p1, technique: 'guided', state: 'planned', attached: true },
      ]);
      expect(st.spares).toEqual([{ tooth: 32, product_id: p2, position: 1 }]);
      // 31's site is detached as cancel_surgery_slot does.
      const old = (await c.query(
        `select state::text as state, slot_id, session_id, course_id from public.implant_sites
         where patient_id = $1 and tooth = 31`, [patient])).rows;
      expect(old).toEqual([{ state: 'planned', slot_id: null, session_id: null, course_id: null }]);
    });
  });

  it('remove then re-add a tooth', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Readd');
      const patient = await newPatient(c, 'Readd');
      const [p1, p2] = s.products;
      const first = await book(c, s, patient, [{ tooth: 14, product_id: p1 }, { tooth: 15, product_id: p1 }]);
      const site14 = await one(c, `select id from public.implant_sites where slot_id = $1 and tooth = 14`, [first]);
      await setImplants(c, first, [{ tooth: 15, product_id: p1 }]);
      expect((await stateOf(c, first)).planned.map((r) => r.tooth)).toEqual([15]);

      // A second booking for the same patient takes the detached tooth 14 and reuses its site.
      const second = await book(c, s, patient, [{ tooth: 14, product_id: p2 }], '11:00', '12:00');
      expect(await one(c, `select implant_site_id from public.slot_planned_implants where slot_id = $1`, [second]))
        .toBe(site14);
      expect((await stateOf(c, second)).planned).toEqual([
        { tooth: 14, product_id: p2, site_product: p2, technique: 'guided', state: 'planned', attached: true },
      ]);
      // And re-adding it to the first booking is now refused: it is planned in the second one.
      await refused(c, SET, [first, json([{ tooth: 15, product_id: p1 }, { tooth: 14, product_id: p1 }])],
        /Tooth 14 is already booked on .*Cancel that booking first\./);
    });
  });

  it('replaces spares', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Spares');
      const patient = await newPatient(c, 'Spares');
      const [p1, a, b, d] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 41, product_id: p1, spares: [a, b] }]);
      await setImplants(c, slot, [{ tooth: 41, product_id: p1, spares: [d, a] }]);
      expect((await stateOf(c, slot)).spares).toEqual([
        { tooth: 41, product_id: d, position: 1 },
        { tooth: 41, product_id: a, position: 2 },
      ]);
      // The v4 spare rules apply.
      const [, , , , e, f] = s.products;
      await refused(c, SET, [slot, json([{ tooth: 41, product_id: p1, spares: [a, b, d, e, f, crypto.randomUUID()] }])],
        /Tooth 41 has more than 5 spares\./);
      await refused(c, SET, [slot, json([{ tooth: 41, product_id: p1, spares: [p1] }])],
        /Tooth 41 lists the same implant twice\./);
      await refused(c, SET, [slot, json([{ tooth: 41, product_id: p1, spares: [crypto.randomUUID()] }])],
        /Choose an implant from the catalog\./);
      await setImplants(c, slot, [{ tooth: 41, product_id: p1 }]);
      expect((await stateOf(c, slot)).spares).toEqual([]);
    });
  });

  it('placed tooth is locked, spares still editable', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Placed');
      const patient = await newPatient(c, 'Placed');
      const [p1, p2, a] = s.products;
      const slot = await book(c, s, patient, [{ tooth: 16, product_id: p1 }, { tooth: 17, product_id: p1 }]);
      await asCompany(c);
      await c.query(
        `update public.implant_sites set state = 'placed', placed_on = $2::date, placing_doctor_id = $3
         where slot_id = $1 and tooth = 16`, [slot, s.date, s.doctor]);
      await asAdmin(c);

      const PLACED = /Tooth 16 is already placed; change it in Corrections\./;
      // Product, technique or tooth changed, or the tooth left out: refused.
      await refused(c, SET, [slot, json([{ tooth: 16, product_id: p2 }, { tooth: 17, product_id: p1 }])], PLACED);
      await refused(c, SET, [slot, json([{ tooth: 16, product_id: p1, technique: 'free_hand' }, { tooth: 17, product_id: p1 }])],
        PLACED);
      await refused(c, SET, [slot, json([{ tooth: 26, product_id: p1 }, { tooth: 17, product_id: p1 }])], PLACED);
      await refused(c, SET, [slot, json([{ tooth: 17, product_id: p1 }])], PLACED);

      // Sent back unchanged with new spares: accepted, and the other tooth may change.
      await setImplants(c, slot, [{ tooth: 16, product_id: p1, spares: [a] }, { tooth: 17, product_id: p2 }]);
      const st = await stateOf(c, slot);
      expect(st.planned).toEqual([
        { tooth: 16, product_id: p1, site_product: p1, technique: 'guided', state: 'placed', attached: true },
        { tooth: 17, product_id: p2, site_product: p2, technique: 'guided', state: 'planned', attached: true },
      ]);
      expect(st.spares).toEqual([{ tooth: 16, product_id: a, position: 1 }]);
    });
  });

  it('closed booking refused', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Closed');
      const patient = await newPatient(c, 'Closed');
      const other = await newPatient(c, 'Closed done');
      const [p1, p2] = s.products;
      const cancelled = await book(c, s, patient, [{ tooth: 11, product_id: p1 }]);
      await c.query(`select public.cancel_surgery_slot($1, 'Zz test')`, [cancelled]);
      await refused(c, SET, [cancelled, json([{ tooth: 11, product_id: p2 }])], /This booking is closed\./);

      const done = await book(c, s, other, [{ tooth: 11, product_id: p1 }], '11:00', '12:00');
      await c.query(`select public.set_slot_status($1, 'done')`, [done]);
      await refused(c, SET, [done, json([{ tooth: 11, product_id: p2 }])], /This booking is closed\./);
      // Closed is checked before the items.
      await refused(c, SET, [done, json([{ tooth: 99 }])], /This booking is closed\./);
      await refused(c, SET, [crypto.randomUUID(), json([])], /Booking not found\./);
    });
  });

  it('tooth in another active booking refused', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Other');
      const patient = await newPatient(c, 'Other');
      const [p1] = s.products;
      await book(c, s, patient, [{ tooth: 22, product_id: p1 }]);
      const second = await book(c, s, patient, [{ tooth: 23, product_id: p1 }], '11:00', '12:00');
      await refused(c, SET, [second, json([{ tooth: 23, product_id: p1 }, { tooth: 22, product_id: p1 }])],
        /Tooth 22 is already booked on .*Cancel that booking first\./);

      // A tooth with a placed implant outside this booking is refused too.
      await asCompany(c);
      await c.query(
        `insert into public.implant_sites (patient_id, tooth, state, product_id, placed_on, placing_doctor_id)
         values ($1, 24, 'placed', $2, $3::date, $4)`, [patient, p1, s.date, s.doctor]);
      await asAdmin(c);
      await refused(c, SET, [second, json([{ tooth: 23, product_id: p1 }, { tooth: 24, product_id: p1 }])],
        /Tooth 24 already has an implant\./);
      // The tooth rules of v4 apply.
      await refused(c, SET, [second, json([{ tooth: 23 }, { tooth: 23 }])], /Tooth 23 is listed twice\./);
      await refused(c, SET, [second, json([{ tooth: 19 }])], /19 is not a tooth number/);
      await refused(c, SET, [second, json([{ tooth: 23, technique: 'robot' }])], /Choose Guided or Free hand\./);
    });
  });

  it('needs Edit on Schedule', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Perm');
      const patient = await newPatient(c, 'Perm');
      const slot = await book(c, s, patient, [{ tooth: 11, product_id: s.products[0] }]);
      await actAs(c, users.viewer);
      await refused(c, SET, [slot, json([{ tooth: 11 }])], /permission/i);
    });
  });

  it('catalogue', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select p.proname, p.prosecdef, p.pronargdefaults, pg_get_userbyid(p.proowner) as owner,
                pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'set_booking_implants'`);
      expect(rows).toEqual([
        { proname: 'set_booking_implants', prosecdef: true, pronargdefaults: 0, owner: 'tenant_definer',
          args: 'p_slot uuid, p_implants jsonb', result: 'void', authenticated: true, anon: false, public: false },
      ]);
    });
  });
});
