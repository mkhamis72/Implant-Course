-- Catalogue library follow-ups (0128).
--   * set_catalog_items: switching an item off also switches off the company's hand-entered copies of it (same
--     brand, type and non-empty ref code, not linked), so the product leaves the dropdowns.
--   * set_products_active: refuses to switch on a product whose library item is retired.
--   * save_catalogue: Admin -> Catalogue's Save in one call, so a refused change saves nothing.
--   * catalog_items_select: is_active_user() once per query.
-- Same signatures: the replaced functions keep their owner (tenant_definer) and grants.

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
      update public.products set catalog_item_id = v_item.id, active = true where id = v_product;
    else
      insert into public.products (company_id, type, brand, system, platform, diameter_mm, length_mm, ref_code,
        description, reorder_level, active, catalog_item_id)
      values (v_company, v_item.type, v_item.brand, v_item.system, v_item.platform, v_item.diameter_mm,
        v_item.length_mm, v_item.ref_code, v_item.description, 0, true, v_item.id);
    end if;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

create or replace function public.set_products_active(p_product_ids uuid[], p_on boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_count int;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_on is null then
    perform app_private.fail('Choose on or off.');
  end if;
  if p_on and exists (
    select 1 from public.products p join public.catalog_items i on i.id = p.catalog_item_id
    where p.company_id = v_company and p.id = any (coalesce(p_product_ids, '{}')) and i.retired and not p.active
  ) then
    perform app_private.fail('This product is no longer in the catalogue.');
  end if;
  update public.products set active = p_on
  where company_id = v_company and id = any (coalesce(p_product_ids, '{}')) and active is distinct from p_on;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── save_catalogue: every change of one Save, all or nothing ─────────────────────────────────────────
create function public.save_catalogue(p_items_on uuid[], p_items_off uuid[], p_products_on uuid[], p_products_off uuid[])
returns table (switched_on int, switched_off int)
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  perform app_private.admin_company('Only an admin can do this.', false);
  -- Off first, so a product switched off as a copy and on as its own row ends up on.
  switched_off := public.set_catalog_items(coalesce(p_items_off, '{}'), false)
    + public.set_products_active(coalesce(p_products_off, '{}'), false);
  switched_on := public.set_catalog_items(coalesce(p_items_on, '{}'), true)
    + public.set_products_active(coalesce(p_products_on, '{}'), true);
  return next;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0128.
grant create on schema public, app_private to tenant_definer;
alter function public.save_catalogue(uuid[], uuid[], uuid[], uuid[]) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function public.save_catalogue(uuid[], uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.save_catalogue(uuid[], uuid[], uuid[], uuid[]) to authenticated;

alter policy catalog_items_select on public.catalog_items using ((select public.is_active_user()));
