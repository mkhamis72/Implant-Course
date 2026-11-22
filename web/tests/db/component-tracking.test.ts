import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');

const SPECS = `connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm`;
const SPEC_VALUES = {
  connection: 'Internal hex', gingival_height_mm: '3.0', angle_deg: '17.0', material: 'Titanium',
  driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'DRV-125', torque_ncm: '25.0',
};
const SET_SPECS = `connection = 'Internal hex', gingival_height_mm = 3, angle_deg = 17, material = 'Titanium',
  driver_interface = 'Hex', driver_size = '1.25 mm', driver_ref = 'DRV-125', torque_ncm = 25`;

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function linkedProduct(c: Client): Promise<{ id: string; catalog_item_id: string }> {
  await asPostgres(c);
  return one(c, `select id, catalog_item_id from public.products
    where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null
    order by ref_code limit 1`, [ACADEMY_ID]);
}

describe('component tracking (0133–0135)', () => {
  it('has the new component and product types', async () => {
    await withTx(async (c) => {
      const comp = await c.query(`select unnest(enum_range(null::public.component_type))::text as v`);
      const prod = await c.query(`select unnest(enum_range(null::public.product_type))::text as v`);
      const compVals = comp.rows.map((r) => r.v);
      const prodVals = prod.rows.map((r) => r.v);
      expect(compVals).toEqual(
        expect.arrayContaining([
          'healing_cap', 'temporary_abutment', 'scan_body', 'impression_coping',
          'abutment_screw', 'prosthetic_screw', 'temporary_cylinder_screw',
        ]),
      );
      expect(prodVals).toEqual(expect.arrayContaining(['healing_cap', 'temporary_abutment', 'abutment_screw']));
    });
  });

  it('stores specs on a hand-entered product', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'abutment_angled', 'Zz Specs Brand');
      await c.query(`update public.products set ${SET_SPECS} where id = $1`, [id]);
      expect(await one(c, `select ${SPECS} from public.products where id = $1`, [id])).toEqual(SPEC_VALUES);
    });
  });

  it('refuses spec changes on a library-linked product', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`update public.products set driver_size = 'x' where id = $1`, [p.id]),
        /This product comes from the catalogue library, so only its reorder level and Active can change\./);
      await refused(c, () => c.query(`update public.products set torque_ncm = 30 where id = $1`, [p.id]),
        /comes from the catalogue library/);
    });
  });

  it('copies library specs when an item is switched on', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const item = (await one<{ id: string }>(c, `insert into public.catalog_items (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS1') returning id`)).id;
      const copyItem = (await one<{ id: string }>(c, `insert into public.catalog_items (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS2') returning id`)).id;
      await c.query(`update public.catalog_items set ${SET_SPECS} where id = any($1)`, [[item, copyItem]]);
      await actAs(c, users.admin);
      // A hand-entered copy of the second item gets linked rather than a new product made.
      const copy = (await one<{ id: string }>(c, `insert into public.products (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS2') returning id`)).id;
      await c.query('select * from public.save_catalogue($1, $2, $3, $4)', [[item, copyItem], [], [], []]);
      expect(await one(c, `select ${SPECS} from public.products where catalog_item_id = $1`, [item])).toEqual(SPEC_VALUES);
      expect(await one(c, `select catalog_item_id, ${SPECS} from public.products where id = $1`, [copy]))
        .toEqual({ catalog_item_id: copyItem, ...SPEC_VALUES });
    });
  });

  it('a library update reaches linked products', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await c.query('update public.catalog_items set torque_ncm = 35 where id = $1', [p.catalog_item_id]);
      await actAs(c, users.organizer);
      expect(await one(c, 'select torque_ncm from public.products where id = $1', [p.id])).toEqual({ torque_ncm: '35.0' });
    });
  });

  it('refuses an angle of 60', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'abutment_angled', 'Zz Specs Brand');
      await refused(c, () => c.query('update public.products set angle_deg = 60 where id = $1', [id]), /check constraint/);
      await asPostgres(c);
      const p = await linkedProduct(c);
      await refused(c, () => c.query('update public.catalog_items set angle_deg = 60 where id = $1', [p.catalog_item_id]),
        /check constraint/);
    });
  });
});

const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';

type Fit = { product?: string | null; lot?: string | null; torque?: number | null; holds?: string | null; holdsRestoration?: string | null };

/** Two placed implants (36, 37) of one patient, as the organizer. */
async function twoSites(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Tracking Patient');
  const implant = await makeProduct(c, 'implant', 'Zz Tracking Brand');
  const lot = await receive(c, implant, 5, 'ZZTRK');
  const delegate = await makeDelegate(c, 'Zz Tracking Delegate');
  const at = (tooth: number) => place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer });
  return { patient, site: await at(36), other: await at(37) };
}

async function fit3(c: Client, site: string, type: string, a: Fit = {}): Promise<string> {
  const r = await one<{ id: string }>(c,
    `select public.fit_component_v3(p_site => $1, p_type => $2::public.component_type, p_fitted_on => public.cairo_today(),
       p_product => $3, p_lot => $4, p_by_delegate => null, p_by_organizer => $5, p_notes => '', p_course => null,
       p_torque => $6, p_holds_component => $7, p_holds_restoration => $8) as id`,
    [site, type, a.product ?? null, a.lot ?? null, users.organizer, a.torque ?? null, a.holds ?? null, a.holdsRestoration ?? null]);
  return r.id;
}

async function fit2(c: Client, site: string, type: string): Promise<string> {
  const r = await one<{ id: string }>(c,
    `select public.fit_component_v2(p_site => $1, p_type => $2::public.component_type, p_fitted_on => public.cairo_today(),
       p_product => null, p_lot => null, p_by_delegate => null, p_by_organizer => $3, p_notes => '', p_course => null) as id`,
    [site, type, users.organizer]);
  return r.id;
}

const undo = (c: Client, id: string) => c.query(`select public.void_component($1, 'Entered by mistake')`, [id]);

const row = (c: Client, id: string) => one<Record<string, unknown>>(c,
  `select removed_on is null as current, removed_on = fitted_on as closed_same_day, replaced_by,
          voided_at is not null as voided, torque_ncm
   from public.site_components where id = $1`, [id]);

async function currentAt(c: Client, site: string): Promise<string[]> {
  const { rows } = await c.query('select id from public.site_components where site_id = $1 and removed_on is null', [site]);
  return rows.map((r) => r.id as string).sort();
}

const restorationOn = async (c: Client, patient: string, site: string) =>
  (await one<{ id: string }>(c,
    `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => 'single_crown', p_sites => $2::uuid[],
       p_teeth => null, p_fitted_on => public.cairo_today(), p_retention => 'screw', p_material => null, p_delegate => null,
       p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => null) as id`,
    [patient, [site]])).id;

describe('components by role (0135)', () => {
  it('abutment closes the healing abutment and records what replaced it', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healing = await fit3(c, s.site, 'healing_abutment');
      const abutment = await fit3(c, s.site, 'ti_base');
      expect(await row(c, healing)).toMatchObject({ current: false, closed_same_day: true, replaced_by: abutment });
      expect(await currentAt(c, s.site)).toEqual([abutment]);
    });
  });

  it('abutment, abutment screw and prosthetic screw are current together', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'multi_unit');
      const screw = await fit3(c, s.site, 'abutment_screw', { holds: abutment });
      const prosthetic = await fit3(c, s.site, 'prosthetic_screw', { holds: abutment });
      expect(await currentAt(c, s.site)).toEqual([abutment, screw, prosthetic].sort());
    });
  });

  it('replacing a prosthetic screw keeps the old one, closed, with replaced_by', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'ti_base');
      const first = await fit3(c, s.site, 'prosthetic_screw', { holds: abutment });
      const second = await fit3(c, s.site, 'temporary_cylinder_screw', { holds: abutment });
      expect(await row(c, first)).toMatchObject({ current: false, replaced_by: second, voided: false });
      expect(await currentAt(c, s.site)).toEqual([abutment, second].sort());
    });
  });

  it('replacing the abutment closes its abutment screw', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const first = await fit3(c, s.site, 'ti_base');
      const screw = await fit3(c, s.site, 'abutment_screw', { holds: first });
      const second = await fit3(c, s.site, 'abutment');
      expect(await row(c, first)).toMatchObject({ current: false, replaced_by: second });
      expect(await row(c, screw)).toMatchObject({ current: false, replaced_by: second });
      expect(await currentAt(c, s.site)).toEqual([second]);
    });
  });

  it('screw must hold this site\'s abutment', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      await fit3(c, s.site, 'ti_base');
      const elsewhere = await fit3(c, s.other, 'ti_base');
      await refused(c, () => fit3(c, s.site, 'abutment_screw', { holds: elsewhere }), /Choose the abutment this screw holds\./);
      await refused(c, () => fit3(c, s.site, 'abutment_screw'), /Choose the abutment this screw holds\./);
      await refused(c, () => fit3(c, s.site, 'prosthetic_screw', { holds: elsewhere }), /Choose what this screw holds\./);
    });
  });

  it('restoration must include the site', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'ti_base');
      const elsewhere = await restorationOn(c, s.patient, s.other);
      await refused(c, () => fit3(c, s.site, 'prosthetic_screw', { holdsRestoration: elsewhere }), /Choose what this screw holds\./);
      await refused(c, () => fit3(c, s.site, 'prosthetic_screw'), /Choose what this screw holds\./);
      const own = await restorationOn(c, s.patient, s.site);
      await refused(c, () => fit3(c, s.site, 'prosthetic_screw', { holds: abutment, holdsRestoration: own }),
        /Choose what this screw holds\./);
      const screw = await fit3(c, s.site, 'prosthetic_screw', { holdsRestoration: own });
      expect(await one(c, 'select holds_restoration_id from public.site_components where id = $1', [screw]))
        .toEqual({ holds_restoration_id: own });
      await refused(c, () => fit3(c, s.site, 'healing_cap', { holds: abutment }), /Only screws hold another part\./);
    });
  });

  it('transfer rows are never current', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healing = await fit3(c, s.site, 'healing_abutment');
      const scan = await fit3(c, s.site, 'scan_body');
      const coping = await fit3(c, s.site, 'impression_coping');
      expect(await row(c, scan)).toMatchObject({ current: false, closed_same_day: true, replaced_by: null });
      expect(await row(c, coping)).toMatchObject({ current: false, closed_same_day: true, replaced_by: null });
      expect(await currentAt(c, s.site)).toEqual([healing]);
    });
  });

  it('void reopens what the fitting closed', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healing = await fit3(c, s.site, 'healing_abutment');
      const abutment = await fit3(c, s.site, 'ti_base');
      const screw = await fit3(c, s.site, 'abutment_screw', { holds: abutment });
      await undo(c, screw);
      await undo(c, abutment);
      expect(await currentAt(c, s.site)).toEqual([healing]);
      expect(await row(c, healing)).toMatchObject({ current: true, replaced_by: null });
      expect(await row(c, screw)).toMatchObject({ current: false, voided: true });
    });
  });

  it('void of a v2 fitting reopens the previous row of the same role group', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healing = await fit2(c, s.site, 'healing_abutment');
      const abutment = await fit2(c, s.site, 'ti_base');
      await undo(c, abutment);
      expect(await currentAt(c, s.site)).toEqual([healing]);
    });
  });

  it('refuses to void a part a current screw holds', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'ti_base');
      await fit3(c, s.site, 'abutment_screw', { holds: abutment });
      await refused(c, () => undo(c, abutment), /Undo the screw that holds this part first\./);
    });
  });

  it('uses stock once per fitting with Inventory on and none with it off', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healingProduct = await makeProduct(c, 'healing_abutment', 'Zz Tracking Brand');
      const healingLot = await receive(c, healingProduct, 3, 'ZZTRKHA');
      const abutmentProduct = await makeProduct(c, 'ti_base', 'Zz Tracking Brand');
      const healing = await fit3(c, s.site, 'healing_abutment', { product: healingProduct, lot: healingLot });
      await asPostgres(c);
      const plan = await one<{ id: string }>(c,
        `insert into public.plans (name, kind, modules) values ('Zz no inventory', 'course_organizer', '{statistics}')
         on conflict (name) do update set modules = excluded.modules returning id`);
      await c.query('update public.companies set plan_id = $1 where id = $2', [plan.id, ACADEMY_ID]);
      await actAs(c, users.organizer);
      const abutment = await fit3(c, s.site, 'ti_base', { product: abutmentProduct });
      await asPostgres(c);
      const uses = async (id: string) => (await one<{ n: number }>(c,
        `select count(*)::int as n from public.stock_movements where site_component_id = $1 and reason = 'use'`, [id])).n;
      expect(await uses(healing)).toBe(1);
      expect(await uses(abutment)).toBe(0);
      await c.query('update public.companies set plan_id = $1 where id = $2', [FULL_PLAN, ACADEMY_ID]);
    });
  });

  it('records torque and refuses 200 Ncm', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'ti_base', { torque: 35 });
      expect(await row(c, abutment)).toMatchObject({ torque_ncm: '35.0' });
      await refused(c, () => fit3(c, s.site, 'abutment', { torque: 200 }), /Enter a torque between 0 and 150 Ncm\./);
      await refused(c, () => fit3(c, s.site, 'final_restoration'), /Record crowns and bridges in the Restoration tab\./);
    });
  });

  it('v2 still fits a component', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const id = await fit2(c, s.site, 'cover_screw');
      expect(await currentAt(c, s.site)).toEqual([id]);
      const next = await fit2(c, s.site, 'healing_abutment');
      expect(await row(c, id)).toMatchObject({ current: false, replaced_by: next });
    });
  });
});

describe('components by role: fixes (0136)', () => {
  it('replacing the abutment closes a prosthetic screw that holds it, not one that holds a restoration', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const first = await fit3(c, s.site, 'ti_base');
      const onAbutment = await fit3(c, s.site, 'prosthetic_screw', { holds: first });
      const second = await fit3(c, s.site, 'abutment');
      expect(await row(c, onAbutment)).toMatchObject({ current: false, replaced_by: second });
      expect(await currentAt(c, s.site)).toEqual([second]);
      await undo(c, second);
      expect(await currentAt(c, s.site)).toEqual([first, onAbutment].sort());

      const otherAbutment = await fit3(c, s.other, 'ti_base');
      const crown = await restorationOn(c, s.patient, s.other);
      const onCrown = await fit3(c, s.other, 'prosthetic_screw', { holdsRestoration: crown });
      const healing = await fit3(c, s.other, 'healing_abutment');
      expect(await row(c, otherAbutment)).toMatchObject({ current: false, replaced_by: healing });
      expect(await row(c, onCrown)).toMatchObject({ current: true, replaced_by: null });
    });
  });

  it('legacy final restoration current → v3 abutment → void → final restoration current again, the older abutment still closed', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const older = await fit2(c, s.site, 'ti_base');
      const legacy = await fit2(c, s.site, 'final_restoration');
      const abutment = await fit3(c, s.site, 'abutment');
      expect(await row(c, legacy)).toMatchObject({ current: false, replaced_by: abutment });
      expect(await currentAt(c, s.site)).toEqual([abutment]);
      await undo(c, abutment);
      expect(await currentAt(c, s.site)).toEqual([legacy]);
      expect(await row(c, older)).toMatchObject({ current: false, replaced_by: legacy });
    });
  });

  it('a v3 fitting that closed nothing reopens nothing when undone', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const abutment = await fit3(c, s.site, 'ti_base');
      const first = await fit3(c, s.site, 'abutment_screw', { holds: abutment });
      await fit3(c, s.site, 'abutment');
      const healing = await fit3(c, s.site, 'healing_abutment');
      await undo(c, healing);
      // The newer abutment came back; the first screw, closed with the first abutment, did not.
      expect(await row(c, first)).toMatchObject({ current: false });
      const screwless = await fit3(c, s.other, 'ti_base');
      await undo(c, screwless);
      expect(await currentAt(c, s.other)).toEqual([]);
    });
  });

  it('a scan body entered by mistake can be undone and its stock returns', async () => {
    await withTx(async (c) => {
      const s = await twoSites(c);
      const healing = await fit3(c, s.site, 'healing_abutment');
      const product = await makeProduct(c, 'scan_body', 'Zz Tracking Brand');
      const lot = await receive(c, product, 2, 'ZZTRKSB');
      const scan = await fit3(c, s.site, 'scan_body', { product, lot });
      expect(await onHand(c, lot)).toBe(1);
      await undo(c, scan);
      expect(await onHand(c, lot)).toBe(2);
      expect(await row(c, scan)).toMatchObject({ current: false, voided: true });
      expect(await currentAt(c, s.site)).toEqual([healing]);
      await refused(c, () => undo(c, scan), /Only the current component can be undone\./);
    });
  });

  it('every component type has a role', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query(
        `select t::text as type, app_private.component_role(t) as role
         from unnest(enum_range(null::public.component_type)) t`);
      expect(rows.filter((r) => r.role === null)).toEqual([]);
      expect(rows.length).toBeGreaterThanOrEqual(13);
    });
  });
});
