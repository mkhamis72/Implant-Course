-- Product specs (component tracking, task 2): connection, gingival height, angle, material, screwdriver and
-- recommended torque, stored once on the product (and on the shared library's item).
--   * The same 8 columns on public.products and public.catalog_items, with range / length checks.
--   * protect_catalog_product: a library-linked product's specs are locked too, except when the new values
--     equal its library item's (that is how the library sync below passes).
--   * set_catalog_items (0132's body): a product switched on from the library, or a hand-entered copy linked
--     to it, takes the item's specs.
--   * catalog_items_specs_sync: a library update reaches every company's linked products. Its function is
--     owned by postgres (DEFINER_ALLOWLIST): it runs from catalog:load with no session or company, where
--     tenant_definer's company policies would let it see no products.

-- ── Columns ──────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['products', 'catalog_items'] loop
    execute format($f$
      alter table public.%1$I
        add column connection text not null default '',
        add column gingival_height_mm numeric(3,1),
        add column angle_deg numeric(4,1),
        add column material text not null default '',
        add column driver_interface text not null default '',
        add column driver_size text not null default '',
        add column driver_ref text not null default '',
        add column torque_ncm numeric(5,1),
        add constraint %1$s_connection_len check (char_length(connection) <= 60),
        add constraint %1$s_gingival_height_range check (gingival_height_mm between 0 and 10),
        add constraint %1$s_angle_range check (angle_deg between 0 and 45),
        add constraint %1$s_material_len check (char_length(material) <= 60),
        add constraint %1$s_driver_interface_len check (char_length(driver_interface) <= 60),
        add constraint %1$s_driver_size_len check (char_length(driver_size) <= 30),
        add constraint %1$s_driver_ref_len check (char_length(driver_ref) <= 60),
        add constraint %1$s_torque_range check (torque_ncm between 0 and 150)
    $f$, t);
  end loop;
end $$;

grant insert (connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm)
  on public.products to authenticated;
grant update (connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm)
  on public.products to authenticated;

-- ── Linked products keep the library's fields, specs included ────────────────────────────────────────
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
          new.driver_ref, new.torque_ncm)
       is distinct from
         (old.connection, old.gingival_height_mm, old.angle_deg, old.material, old.driver_interface, old.driver_size,
          old.driver_ref, old.torque_ncm)
     and not exists (
       select 1 from public.catalog_items i
       where i.id = old.catalog_item_id
         and (i.connection, i.gingival_height_mm, i.angle_deg, i.material, i.driver_interface, i.driver_size,
              i.driver_ref, i.torque_ncm)
           is not distinct from
             (new.connection, new.gingival_height_mm, new.angle_deg, new.material, new.driver_interface, new.driver_size,
              new.driver_ref, new.torque_ncm)) then
    perform app_private.fail('This product comes from the catalogue library, so only its reorder level and Active can change.');
  end if;
  return new;
end $$;

-- ── set_catalog_items: 0132's body, copying the item's specs ─────────────────────────────────────────
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
        driver_size = v_item.driver_size, driver_ref = v_item.driver_ref, torque_ncm = v_item.torque_ncm
      where id = v_product;
    else
      insert into public.products (company_id, type, brand, system, platform, diameter_mm, length_mm, ref_code,
        description, reorder_level, active, catalog_item_id,
        connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm)
      values (v_company, v_item.type, v_item.brand, v_item.system, v_item.platform, v_item.diameter_mm,
        v_item.length_mm, v_item.ref_code, v_item.description, 0, true, v_item.id,
        v_item.connection, v_item.gingival_height_mm, v_item.angle_deg, v_item.material, v_item.driver_interface,
        v_item.driver_size, v_item.driver_ref, v_item.torque_ncm);
    end if;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- ── A library update reaches linked products, in every company ───────────────────────────────────────
create function app_private.sync_catalog_specs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.products p set
    connection = new.connection, gingival_height_mm = new.gingival_height_mm, angle_deg = new.angle_deg,
    material = new.material, driver_interface = new.driver_interface, driver_size = new.driver_size,
    driver_ref = new.driver_ref, torque_ncm = new.torque_ncm
  where p.catalog_item_id = new.id
    and (p.connection, p.gingival_height_mm, p.angle_deg, p.material, p.driver_interface, p.driver_size,
         p.driver_ref, p.torque_ncm)
      is distinct from
        (new.connection, new.gingival_height_mm, new.angle_deg, new.material, new.driver_interface, new.driver_size,
         new.driver_ref, new.torque_ncm);
  return null;
end $$;
alter function app_private.sync_catalog_specs() owner to postgres;
revoke all on function app_private.sync_catalog_specs() from public;

create trigger catalog_items_specs_sync
  after update of connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref,
    torque_ncm on public.catalog_items
  for each row execute function app_private.sync_catalog_specs();
