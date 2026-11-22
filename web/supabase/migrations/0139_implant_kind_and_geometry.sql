-- Implant types (task 1): zygomatic, pterygoid and tilted implants.
--   * products / catalog_items: implant_kind (conventional / zygomatic / pterygoid), and implants up to 60 mm.
--   * protect_catalog_product (0134's body): a library-linked product's implant_kind is locked too, except when
--     the new value equals its library item's (that is how the library sync passes).
--   * set_catalog_items (0134's body): copies the item's implant_kind.
--   * sync_catalog_specs (0134's body): a library implant_kind change reaches every company's linked products.
--   * implant_sites: implant type and geometry (angulation, direction, anchorage, entry point, trajectory) and
--     the product that was planned (planned_product_id, kept once the implant is placed).
--   * Backfill: implants already placed are conventional; their planned product comes from the booking that
--     recorded it. Written without audit rows (no one changed these records).

-- ── Product kind and 60 mm implants ──────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['products', 'catalog_items'] loop
    execute format($f$
      alter table public.%1$I
        add column implant_kind text not null default 'conventional',
        add constraint %1$s_implant_kind_check check (implant_kind in ('conventional', 'zygomatic', 'pterygoid')),
        drop constraint %1$s_length_mm_check,
        add constraint %1$s_length_mm_check check (length_mm between 4 and 60)
    $f$, t);
  end loop;
end $$;

grant insert (implant_kind) on public.products to authenticated;
grant update (implant_kind) on public.products to authenticated;

-- ── Implant type and geometry ────────────────────────────────────────────────────────────────────────
-- planned_product_id: a composite key (0091) so a row can only name a product of its own company.
alter table public.implant_sites
  add column implant_type text,
  add column angulation_deg numeric(3,1),
  add column angulation_direction text,
  add column anchorage text,
  add column entry_point text not null default '',
  add column trajectory text not null default '',
  add column planned_product_id uuid,
  add constraint implant_sites_implant_type_check
    check (implant_type in ('conventional', 'tilted', 'zygomatic', 'pterygoid')),
  add constraint implant_sites_angulation_range check (angulation_deg between 0 and 60),
  add constraint implant_sites_angulation_direction_check
    check (angulation_direction in ('mesial', 'distal', 'buccal', 'palatal_lingual')),
  add constraint implant_sites_anchorage_check
    check (anchorage in ('zygoma', 'pterygoid_plate', 'tuberosity', 'other')),
  add constraint implant_sites_entry_point_len check (char_length(entry_point) <= 200),
  add constraint implant_sites_trajectory_len check (char_length(trajectory) <= 200),
  add constraint implant_sites_planned_product_id_fkey foreign key (company_id, planned_product_id)
    references public.products (company_id, id);
create index implant_sites_planned_product_id_idx on public.implant_sites (company_id, planned_product_id);

-- ── Linked products keep the library's fields, specs and kind included ───────────────────────────────
create or replace function app_private.protect_catalog_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.catalog_item_id is not null
     and (new.type, new.brand, new.system, new.platform, new.diameter_mm, new.length_mm, new.ref_code, new.description)
       is distinct from
         (old.type, old.brand, old.system, old.platform, old.diameter_mm, old.length_mm, old.ref_code, old.description) then
    perform app_private.fail('This product comes from the catalogue library, so only its reorder level and Active can change.');
  end if;
  if old.catalog_item_id is not null
     and (new.connection, new.gingival_height_mm, new.angle_deg, new.material, new.driver_interface, new.driver_size,
          new.driver_ref, new.torque_ncm, new.implant_kind)
       is distinct from
         (old.connection, old.gingival_height_mm, old.angle_deg, old.material, old.driver_interface, old.driver_size,
          old.driver_ref, old.torque_ncm, old.implant_kind)
     and not exists (
       select 1 from public.catalog_items i
       where i.id = old.catalog_item_id
         and (i.connection, i.gingival_height_mm, i.angle_deg, i.material, i.driver_interface, i.driver_size,
              i.driver_ref, i.torque_ncm, i.implant_kind)
           is not distinct from
             (new.connection, new.gingival_height_mm, new.angle_deg, new.material, new.driver_interface, new.driver_size,
              new.driver_ref, new.torque_ncm, new.implant_kind)) then
    perform app_private.fail('This product comes from the catalogue library, so only its reorder level and Active can change.');
  end if;
  return new;
end $$;

-- ── set_catalog_items: 0134's body, copying the item's implant_kind too ──────────────────────────────
create or replace function public.set_catalog_items(p_item_ids uuid[], p_on boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_item public.catalog_items;
  v_product uuid;
  v_changed int := 0;
  v_count int;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_on is null then
    perform app_private.fail('Choose on or off.');
  end if;
  if exists (select 1 from unnest(coalesce(p_item_ids, '{}')) x(id)
             where not exists (select 1 from public.catalog_items i where i.id = x.id)) then
    perform app_private.fail('Product not found.');
  end if;

  for v_item in select * from public.catalog_items where id = any (p_item_ids) order by id loop
    if not p_on then
      -- The linked product, and any hand-entered copy of the same item.
      update public.products set active = false
      where company_id = v_company and active
        and (catalog_item_id = v_item.id
             or (catalog_item_id is null and v_item.ref_code <> ''
                 and brand = v_item.brand and type = v_item.type and ref_code = v_item.ref_code));
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
      continue;
    end if;

    if v_item.retired then
      perform app_private.fail('This product is no longer in the catalogue.');
    end if;
    select id into v_product from public.products
    where company_id = v_company and catalog_item_id = v_item.id for update;
    if found then
      update public.products set active = true where id = v_product and not active;
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
      continue;
    end if;

    select id into v_product from public.products
    where company_id = v_company and catalog_item_id is null and v_item.ref_code <> ''
      and brand = v_item.brand and type = v_item.type and ref_code = v_item.ref_code
    order by created_at, id limit 1 for update;
    if found then
      update public.products set catalog_item_id = v_item.id, active = true,
        connection = v_item.connection, gingival_height_mm = v_item.gingival_height_mm,
        angle_deg = v_item.angle_deg, material = v_item.material, driver_interface = v_item.driver_interface,
        driver_size = v_item.driver_size, driver_ref = v_item.driver_ref, torque_ncm = v_item.torque_ncm,
        implant_kind = v_item.implant_kind
      where id = v_product;
    else
      insert into public.products (company_id, type, brand, system, platform, diameter_mm, length_mm, ref_code,
        description, reorder_level, active, catalog_item_id,
        connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm,
        implant_kind)
      values (v_company, v_item.type, v_item.brand, v_item.system, v_item.platform, v_item.diameter_mm,
        v_item.length_mm, v_item.ref_code, v_item.description, 0, true, v_item.id,
        v_item.connection, v_item.gingival_height_mm, v_item.angle_deg, v_item.material, v_item.driver_interface,
        v_item.driver_size, v_item.driver_ref, v_item.torque_ncm, v_item.implant_kind);
    end if;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- ── A library update reaches linked products, in every company, implant_kind included ────────────────
create or replace function app_private.sync_catalog_specs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.products p set
    connection = new.connection, gingival_height_mm = new.gingival_height_mm, angle_deg = new.angle_deg,
    material = new.material, driver_interface = new.driver_interface, driver_size = new.driver_size,
    driver_ref = new.driver_ref, torque_ncm = new.torque_ncm, implant_kind = new.implant_kind
  where p.catalog_item_id = new.id
    and (p.connection, p.gingival_height_mm, p.angle_deg, p.material, p.driver_interface, p.driver_size,
         p.driver_ref, p.torque_ncm, p.implant_kind)
      is distinct from
        (new.connection, new.gingival_height_mm, new.angle_deg, new.material, new.driver_interface, new.driver_size,
         new.driver_ref, new.torque_ncm, new.implant_kind);
  return null;
end $$;

drop trigger catalog_items_specs_sync on public.catalog_items;
create trigger catalog_items_specs_sync
  after update of connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref,
    torque_ncm, implant_kind on public.catalog_items
  for each row execute function app_private.sync_catalog_specs();

-- ── Backfill, without audit rows or a new updated_at (an open Surgical details form stays valid) ─────
-- backfill:start
alter table public.implant_sites disable trigger implant_sites_audit;
alter table public.implant_sites disable trigger implant_sites_set_updated_at;
update public.implant_sites set implant_type = 'conventional'
where state in ('placed', 'restored', 'failed') and implant_type is null;

-- The plan of an implant already placed is known only where a booking recorded it (one row, with a product).
update public.implant_sites s set planned_product_id = x.product_id
from (
  select spi.implant_site_id, min(spi.product_id::text)::uuid as product_id
  from public.slot_planned_implants spi
  where spi.implant_site_id is not null
  group by spi.implant_site_id
  having count(*) = 1 and count(spi.product_id) = 1
) x
where x.implant_site_id = s.id and s.state <> 'planned' and s.planned_product_id is null;
alter table public.implant_sites enable trigger implant_sites_set_updated_at;
alter table public.implant_sites enable trigger implant_sites_audit;
-- backfill:end
