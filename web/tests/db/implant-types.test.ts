import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import {
  book, enroll, insertSelfAuthUser, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, pendingLogin,
  place, receive,
} from './fixtures';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** The migration's backfill, between its `-- backfill:start` and `-- backfill:end` markers. */
function backfillSql(file = '0139_implant_kind_and_geometry.sql'): string {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
  const m = /-- backfill:start([\s\S]*?)-- backfill:end/.exec(sql);
  if (!m) throw new Error(`${file} has no backfill markers`);
  return m[1];
}
const BACKFILLS = ['0139_implant_kind_and_geometry.sql', '0140_implant_type_placement.sql'];

/** One of academy's Oxy implants that 0128 linked to the library. */
async function linkedProduct(c: Client): Promise<{ id: string; catalog_item_id: string }> {
  await asPostgres(c);
  return one(c, `select id, catalog_item_id from public.products
    where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null
    order by ref_code limit 1`, [ACADEMY_ID]);
}

/** A booking planning `planned` (conventional) on teeth 16 and 17; `placed` (of `placedKind`) has a lot in stock
 *  and, with `spare`, is the booking's spare for tooth 16. Acts as the organizer when it returns. */
async function bookedPlan(c: Client, opts: { placedKind?: string; spare?: boolean } = {}) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c, '2030-03-01', '2030-03-05');
  const session = await makeSession(c, course, 'surgery', '2030-03-02');
  const delegate = await makeDelegate(c, 'Zz Types Placer');
  await enroll(c, course, delegate);
  const planned = await makeProduct(c, 'implant', 'Zz Types Planned');
  const placed = await makeProduct(c, 'implant', 'Zz Types Placed');
  if (opts.placedKind) {
    await c.query('update public.products set implant_kind = $2 where id = $1', [placed, opts.placedKind]);
  }
  const lot = await receive(c, placed, 5, 'ZZTYPES');
  const patient = await makePatient(c, 'Zz Types Patient');
  const tooth16 = { tooth: 16, product_id: planned, ...(opts.spare ? { spares: [placed] } : {}) };
  const slot = await book(c, {
    session, chair, patient, supervisor: users.organizer, placing: [delegate],
    implants: [tooth16 as { tooth: number; product_id: string }, { tooth: 17, product_id: planned }],
  });
  const plannedSite = (await one<{ id: string }>(c,
    `select id from public.implant_sites where patient_id = $1 and tooth = 17 and state = 'planned'`, [patient])).id;
  return { course, delegate, planned, placed, lot, patient, slot, plannedSite };
}

/** bookedPlan, then tooth 16 placed with `placed`. */
async function placedFromBooking(c: Client, opts: { placedKind?: string; spare?: boolean } = {}) {
  const b = await bookedPlan(c, opts);
  const site = await place(c, {
    patient: b.patient, tooth: 16, product: b.placed, lot: b.lot, delegate: b.delegate, supervisor: users.organizer,
    slot: b.slot, placedOn: '2026-01-10',
  });
  return { ...b, site };
}

type SiteRow = {
  implant_type: string | null; angulation_deg: string | null; angulation_direction: string | null;
  anchorage: string | null; entry_point: string; trajectory: string; planned_product_id: string | null;
  product_id: string; updated_at: Date;
};
async function siteRow(c: Client, id: string): Promise<SiteRow> {
  return one<SiteRow>(c, `select implant_type, angulation_deg, angulation_direction, anchorage, entry_point, trajectory,
    planned_product_id, product_id, updated_at from public.implant_sites where id = $1`, [id]);
}

const GEOMETRY_SQL = 'select public.set_implant_geometry($1, $2, $3, $4, $5, $6, $7)';
function geometry(c: Client, site: string, type: string | null, angle: number | null = null, direction: string | null = null,
  anchorage: string | null = null, entry: string | null = null, trajectory: string | null = null) {
  return c.query(GEOMETRY_SQL, [site, type, angle, direction, anchorage, entry, trajectory]);
}

describe('implant types (0139–0140)', () => {
  it('a 45 mm zygomatic implant product can be saved', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { id } = await one<{ id: string }>(c, `insert into public.products
        (type, brand, system, diameter_mm, length_mm, implant_kind)
        values ('implant', 'Zz Zygoma', 'Z', 4.0, 45, 'zygomatic') returning id`);
      const row = await one<{ length_mm: string; implant_kind: string }>(c,
        'select length_mm, implant_kind from public.products where id = $1', [id]);
      expect(Number(row.length_mm)).toBe(45);
      expect(row.implant_kind).toBe('zygomatic');
      await c.query(`update public.products set length_mm = 60, implant_kind = 'pterygoid' where id = $1`, [id]);
      await refused(c, () => c.query(`update public.products set implant_kind = 'tilted' where id = $1`, [id]),
        /check constraint/);
    });
  });

  it('61 mm is refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`insert into public.products (type, brand, system, diameter_mm, length_mm)
        values ('implant', 'Zz Too Long', 'Z', 4.0, 61)`), /check constraint/);
      await asPostgres(c);
      await c.query(`insert into public.catalog_items (type, brand, system, diameter_mm, length_mm, ref_code, implant_kind)
        values ('implant', 'Zz Library Zyg', 'Z', 4.0, 60, 'ZZ-60', 'zygomatic')`);
      await refused(c, () => c.query(`insert into public.catalog_items (type, brand, system, diameter_mm, length_mm, ref_code)
        values ('implant', 'Zz Library Zyg', 'Z', 4.0, 61, 'ZZ-61')`), /check constraint/);
    });
  });

  it('implant_kind defaults to conventional', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'implant', 'Zz Default Kind');
      const row = await one<{ implant_kind: string }>(c, 'select implant_kind from public.products where id = $1', [id]);
      expect(row.implant_kind).toBe('conventional');
      await asPostgres(c);
      const { n } = await one<{ n: number }>(c,
        `select count(*)::int as n from public.catalog_items where implant_kind <> 'conventional'`);
      expect(n).toBe(0);
    });
  });

  it('a linked product refuses an implant_kind change', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`update public.products set implant_kind = 'zygomatic' where id = $1`, [p.id]),
        /comes from the catalogue library, so only its reorder level and Active can change/);
    });
  });

  it('a library implant_kind change reaches linked products', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await c.query(`update public.catalog_items set implant_kind = 'pterygoid' where id = $1`, [p.catalog_item_id]);
      const row = await one<{ implant_kind: string }>(c, 'select implant_kind from public.products where id = $1', [p.id]);
      expect(row.implant_kind).toBe('pterygoid');
    });
  });

  it('switching on a library item copies its implant_kind', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { id } = await one<{ id: string }>(c, `insert into public.catalog_items
        (type, brand, system, diameter_mm, length_mm, ref_code, implant_kind)
        values ('implant', 'Zz Library Kind', 'Z', 4.0, 45, 'ZZ-KIND', 'zygomatic') returning id`);
      await actAs(c, users.admin);
      await c.query('select public.set_catalog_items($1::uuid[], true)', [[id]]);
      const row = await one<{ implant_kind: string }>(c,
        'select implant_kind from public.products where catalog_item_id = $1', [id]);
      expect(row.implant_kind).toBe('zygomatic');
    });
  });

  it('a library implant_kind change leaves a placed implant\'s type unchanged', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const p = await one<{ id: string; catalog_item_id: string }>(c, `select id, catalog_item_id from public.products
        where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null and active
        order by ref_code limit 1`, [ACADEMY_ID]);
      await actAs(c, users.organizer);
      const delegate = await makeDelegate(c, 'Zz Types Library Placer');
      const patient = await makePatient(c, 'Zz Types Library Patient');
      const lot = await receive(c, p.id, 2, 'ZZLIBKIND');
      const site = await place(c, { patient, tooth: 26, product: p.id, lot, delegate, supervisor: users.organizer });
      expect((await siteRow(c, site)).implant_type).toBe('conventional');
      await asPostgres(c);
      await c.query(`update public.catalog_items set implant_kind = 'zygomatic' where id = $1`, [p.catalog_item_id]);
      expect((await one<{ implant_kind: string }>(c, 'select implant_kind from public.products where id = $1', [p.id])).implant_kind)
        .toBe('zygomatic');
      expect((await siteRow(c, site)).implant_type).toBe('conventional');
    });
  });

  it.each(BACKFILLS)('placed implants are backfilled as conventional (%s)', async (file) => {
    await withTx(async (c) => {
      const { site, plannedSite } = await placedFromBooking(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set implant_type = null, planned_product_id = null where id = $1', [site]);
      const before = await siteRow(c, site);
      await c.query(backfillSql(file));
      const row = await siteRow(c, site);
      expect(row.implant_type).toBe('conventional');
      expect(row.updated_at).toEqual(before.updated_at); // no new updated_at
      expect((await siteRow(c, plannedSite)).implant_type).toBeNull();
      const { n } = await one<{ n: number }>(c, `select count(*)::int as n from public.implant_sites
        where state in ('placed', 'restored', 'failed') and implant_type is null`);
      expect(n).toBe(0);
    });
  });

  it.each(BACKFILLS)('backfill takes the planned product from the booking (%s)', async (file) => {
    await withTx(async (c) => {
      const { site, planned, placed } = await placedFromBooking(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set implant_type = null, planned_product_id = null where id = $1', [site]);
      const { audits } = await one<{ audits: number }>(c, 'select count(*)::int as audits from public.audit_log');
      await c.query(backfillSql(file));
      const row = await siteRow(c, site);
      expect(row.product_id).toBe(placed);
      expect(row.planned_product_id).toBe(planned);
      const after = await one<{ audits: number }>(c, 'select count(*)::int as audits from public.audit_log');
      expect(after.audits).toBe(audits); // written without audit rows
    });
  });

  // ── Placement (0140) ─────────────────────────────────────────────────────────────────────────────────
  it('placing records the planned product and the product\'s kind', async () => {
    await withTx(async (c) => {
      const { site, planned, placed } = await placedFromBooking(c, { placedKind: 'zygomatic' });
      const row = await siteRow(c, site);
      expect(row.product_id).toBe(placed);
      expect(row.planned_product_id).toBe(planned);
      expect(row.implant_type).toBe('zygomatic');
    });
  });

  it('placing a spare keeps the primary plan', async () => {
    await withTx(async (c) => {
      const b = await bookedPlan(c, { placedKind: 'pterygoid', spare: true });
      // Switched off: accepted only because it is the booking's spare for this tooth.
      await c.query('update public.products set active = false where id = $1', [b.placed]);
      const site = await place(c, {
        patient: b.patient, tooth: 16, product: b.placed, lot: b.lot, delegate: b.delegate, supervisor: users.organizer,
        slot: b.slot, placedOn: '2026-01-10',
      });
      const row = await siteRow(c, site);
      expect(row.product_id).toBe(b.placed);
      expect(row.planned_product_id).toBe(b.planned);
      expect(row.implant_type).toBe('pterygoid');
    });
  });

  it('placement via the unchanged signature sets type and plan', async () => {
    await withTx(async (c) => {
      const b = await bookedPlan(c, { placedKind: 'zygomatic' });
      // The named arguments exactly as implant-actions.ts sends them.
      const { id } = await one<{ id: string }>(c, `select public.place_implant_v4(
        p_patient => $1, p_tooth => $2, p_product => $3, p_lot => $4, p_placed_on => $5,
        p_placing_delegate => $6, p_supervisor => $7, p_assisting_delegate => $8, p_graft => $9, p_notes => $10,
        p_slot => $11, p_technique => $12, p_course => $13, p_placing_doctor => $14) as id`,
      [b.patient, 16, b.placed, b.lot, '2026-01-10', b.delegate, users.organizer, null, '', '', b.slot, null, b.course, null]);
      const row = await siteRow(c, id);
      expect(row.planned_product_id).toBe(b.planned);
      expect(row.implant_type).toBe('zygomatic');

      // No plan: nothing was planned, the type still comes from the product.
      const conventional = await makeProduct(c, 'implant', 'Zz Types Unplanned');
      const lot2 = await receive(c, conventional, 1, 'ZZUNPLANNED');
      const free = await one<{ id: string }>(c, `select public.place_implant_v4(
        p_patient => $1, p_tooth => $2, p_product => $3, p_lot => $4, p_placed_on => $5,
        p_placing_delegate => $6, p_supervisor => $7, p_assisting_delegate => $8, p_graft => $9, p_notes => $10,
        p_slot => $11, p_technique => $12, p_course => $13, p_placing_doctor => $14) as id`,
      [b.patient, 36, conventional, lot2, '2026-01-10', b.delegate, users.organizer, null, '', '', null, null, b.course, null]);
      const freeRow = await siteRow(c, free.id);
      expect(freeRow.planned_product_id).toBeNull();
      expect(freeRow.implant_type).toBe('conventional');
    });
  });

  it('correct_batch re-defaults an untouched type', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      expect((await siteRow(c, site)).implant_type).toBe('conventional');
      const zyg = await makeProduct(c, 'implant', 'Zz Types Zyg');
      await c.query(`update public.products set implant_kind = 'zygomatic' where id = $1`, [zyg]);
      const zygLot = await receive(c, zyg, 1, 'ZZZYG');
      await c.query(`select public.correct_batch($1, $2, 'Wrong box picked', null, $3)`, [site, zygLot, zyg]);
      const row = await siteRow(c, site);
      expect(row.product_id).toBe(zyg);
      expect(row.implant_type).toBe('zygomatic');
    });
  });

  it('correct_batch keeps a type the user changed', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await geometry(c, site, 'tilted', 30, 'distal');
      const zyg = await makeProduct(c, 'implant', 'Zz Types Zyg');
      await c.query(`update public.products set implant_kind = 'zygomatic' where id = $1`, [zyg]);
      const zygLot = await receive(c, zyg, 1, 'ZZZYG');
      await c.query(`select public.correct_batch($1, $2, 'Wrong box picked', null, $3)`, [site, zygLot, zyg]);
      const row = await siteRow(c, site);
      expect(row.product_id).toBe(zyg);
      expect(row.implant_type).toBe('tilted');
    });
  });

  // ── set_implant_geometry (0140) ──────────────────────────────────────────────────────────────────────
  it('set_implant_geometry saves tilted 30° distal', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await geometry(c, site, 'tilted', 30, 'distal');
      const row = await siteRow(c, site);
      expect(row.implant_type).toBe('tilted');
      expect(Number(row.angulation_deg)).toBe(30);
      expect(row.angulation_direction).toBe('distal');
      expect(row.anchorage).toBeNull();
      expect(row.entry_point).toBe('');
      expect(row.trajectory).toBe('');

      await geometry(c, site, 'zygomatic', 45, 'buccal', 'zygoma', 'Zygoma body', 'Extra-sinus');
      const z = await siteRow(c, site);
      expect([z.implant_type, Number(z.angulation_deg), z.angulation_direction, z.anchorage, z.entry_point, z.trajectory])
        .toEqual(['zygomatic', 45, 'buccal', 'zygoma', 'Zygoma body', 'Extra-sinus']);

      await geometry(c, site, 'conventional');
      const back = await siteRow(c, site);
      expect([back.implant_type, back.angulation_deg, back.angulation_direction, back.anchorage, back.entry_point, back.trajectory])
        .toEqual(['conventional', null, null, null, '', '']);
    });
  });

  it('tilted needs an angle', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await refused(c, () => geometry(c, site, 'tilted'), /Enter the angle of the tilted implant\./);
      await refused(c, () => geometry(c, site, null), /Choose the implant type\./);
      await refused(c, () => geometry(c, site, 'tilted', 61), /Enter an angle between 0 and 60°\./);
      await refused(c, () => geometry(c, site, 'tilted', -1), /Enter an angle between 0 and 60°\./);
      await geometry(c, site, 'tilted', 60);
    });
  });

  it('direction without angle is refused (0144)', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await geometry(c, site, 'conventional', 10, 'mesial');
      const before = await siteRow(c, site);
      await refused(c, () => geometry(c, site, 'conventional', null, 'distal'), /Give the angle as well as the direction\./);
      await refused(c, () => geometry(c, site, 'zygomatic', null, 'buccal', 'zygoma'),
        /Give the angle as well as the direction\./);
      const after = await siteRow(c, site);
      expect([after.implant_type, Number(after.angulation_deg), after.angulation_direction])
        .toEqual([before.implant_type, 10, 'mesial']);
    });
  });

  it('angle and direction save, and so do neither or an angle alone (0144)', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await geometry(c, site, 'conventional', 15, 'palatal_lingual');
      let row = await siteRow(c, site);
      expect([row.implant_type, Number(row.angulation_deg), row.angulation_direction])
        .toEqual(['conventional', 15, 'palatal_lingual']);
      await geometry(c, site, 'conventional', 5);
      row = await siteRow(c, site);
      expect([Number(row.angulation_deg), row.angulation_direction]).toEqual([5, null]);
      await geometry(c, site, 'conventional', null, '  ');
      row = await siteRow(c, site);
      expect([row.angulation_deg, row.angulation_direction]).toEqual([null, null]);
    });
  });

  it('company isolation for geometry: another company\'s implant is refused and unchanged (0144)', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await geometry(c, site, 'tilted', 30, 'distal');
      await asPostgres(c);
      const before = await siteRow(c, site);

      await c.query("select set_config('request.jwt.claims', '', true)");
      const tag = Math.random().toString(36).slice(2, 8);
      const companyB = (await one<{ id: string }>(c,
        'insert into public.companies (slug, name) values ($1, $2) returning id', [`zz-geo-${tag}`, 'Zz Geo B'])).id;
      const email = `zz-geo-${tag}-admin@example.com`;
      await pendingLogin(c, email, { company: companyB, role: 'admin', fullName: 'Zz Geo admin' });
      const adminB = await insertSelfAuthUser(c, { email, companyId: companyB });
      await actAsBound(c, adminB, companyB);

      await refused(c, () => geometry(c, site, 'zygomatic', 45, 'buccal', 'zygoma'),
        /Only a placed implant has a type and angle\./);
      await asPostgres(c);
      const after = await siteRow(c, site);
      expect(after).toEqual(before);
    });
  });

  it('anchorage only for zygomatic or pterygoid', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      const ONLY = /Anchorage is only recorded for zygomatic and pterygoid implants\./;
      await refused(c, () => geometry(c, site, 'conventional', null, null, 'zygoma'), ONLY);
      await refused(c, () => geometry(c, site, 'tilted', 30, 'distal', null, 'Crest'), ONLY);
      await refused(c, () => geometry(c, site, 'tilted', 30, 'distal', null, null, 'Along the sinus wall'), ONLY);
      await refused(c, () => geometry(c, site, 'pterygoid', null, null, 'pterygoid_plate', 'x'.repeat(201)),
        /200 characters/);
      await geometry(c, site, 'pterygoid', null, null, 'pterygoid_plate', 'Tuberosity', 'Towards the pterygoid plate');
      expect((await siteRow(c, site)).anchorage).toBe('pterygoid_plate');
    });
  });

  it('refuses on a planned implant', async () => {
    await withTx(async (c) => {
      const { plannedSite } = await bookedPlan(c);
      await refused(c, () => geometry(c, plannedSite, 'conventional'), /Only a placed implant has a type and angle\./);
      await refused(c, () => geometry(c, '00000000-0000-4000-8000-000000000000', 'conventional'),
        /Only a placed implant has a type and angle\./);
    });
  });

  it('works in a clinic', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await asPostgres(c);
      await c.query(`update public.companies set kind = 'clinic' where id = $1`, [ACADEMY_ID]);
      await actAs(c, users.organizer);
      await geometry(c, site, 'zygomatic', 40, 'buccal', 'zygoma');
      expect((await siteRow(c, site)).implant_type).toBe('zygomatic');
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await actAs(c, users.viewer);
      await refused(c, () => geometry(c, site, 'tilted', 30, 'distal'), /You don't have permission to edit Patients/);
    });
  });
});

describe('planned product key (0141 dropped it, 0144 adds it back)', () => {
  it('implant_sites_planned_product_id_fkey exists and refuses a product of another company', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query(`select conname from pg_constraint
        where contype = 'f' and conrelid = 'public.implant_sites'::regclass and confrelid = 'public.products'::regclass
        order by conname`);
      expect(rows.map((r) => r.conname)).toEqual(['implant_sites_planned_product_id_fkey', 'implant_sites_product_id_fkey']);
      const idx = await one(c, `select count(*)::int as n from pg_indexes
        where schemaname = 'public' and indexname = 'implant_sites_planned_product_id_idx'`);
      expect(idx.n).toBe(1);

      const { site } = await placedFromBooking(c);
      await asPostgres(c);
      const tag = Math.random().toString(36).slice(2, 8);
      const companyB = (await one<{ id: string }>(c,
        'insert into public.companies (slug, name) values ($1, $2) returning id', [`zz-key-${tag}`, 'Zz Key B'])).id;
      const otherProduct = (await one<{ id: string }>(c, `insert into public.products
        (company_id, type, brand, system, diameter_mm, length_mm) values ($1, 'implant', 'Zz Key Other', 'T1', 4.0, 10)
        returning id`, [companyB])).id;
      await refused(c, () => c.query('update public.implant_sites set planned_product_id = $2 where id = $1', [site, otherProduct]),
        /implant_sites_planned_product_id_fkey/);
    });
  });
});

describe('old component function dropped (0144)', () => {
  it('fit_component_v2 and clear_wrong_closer_links no longer exist', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const r = await one<{ v2: string | null; clear: string | null }>(c, `select
        to_regprocedure('public.fit_component_v2(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid)')::text as v2,
        to_regprocedure('app_private.clear_wrong_closer_links()')::text as clear`);
      expect(r).toEqual({ v2: null, clear: null });
    });
  });
});
