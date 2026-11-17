-- A lot attached later (0112) has no use movement, so correcting it to another lot found no stock entry to
-- reverse. correct_batch now treats a lot with no use movement at all (reversed or not) like an attach: the same
-- checks, the lot swapped, no movement. A use that exists but is already reversed still fails as before.

-- 0112's body; only the attach condition changes.
create or replace function public.correct_batch(
  p_site uuid, p_new_lot uuid, p_reason text, p_component uuid default null, p_new_product uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_comp public.site_components;
  v_product uuid;
  v_old_product uuid;
  v_type public.product_type;
  v_old_lot uuid;
  v_use uuid;
  v_lot public.stock_lots;
  v_used_on date;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'correction');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has a batch to correct.');
  end if;
  if p_component is null then
    v_product := coalesce(p_new_product, v_site.product_id);
    if not exists (select 1 from public.products where id = v_product and type = 'implant'
                   and (active or v_product = v_site.product_id)) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_old_lot := v_site.stock_lot_id;
    v_old_product := v_site.product_id;
    v_used_on := v_site.placed_on;
  else
    select * into v_comp from public.site_components where id = p_component and site_id = p_site and voided_at is null;
    if not found then
      perform app_private.fail('Component not found.');
    end if;
    if v_comp.product_id is null then
      perform app_private.fail('This component was not taken from stock.');
    end if;
    v_product := coalesce(p_new_product, v_comp.product_id);
    select type into v_type from public.products where id = v_product and (active or v_product = v_comp.product_id);
    if not found or not app_private.component_accepts(v_comp.component_type, v_type) then
      perform app_private.fail(format('That product is not a %s.', replace(v_comp.component_type::text, '_', ' ')));
    end if;
    v_old_lot := v_comp.stock_lot_id;
    v_old_product := v_comp.product_id;
    v_used_on := v_comp.fitted_on;
  end if;
  if p_new_lot = v_old_lot or (v_old_lot is not null and p_new_lot is null) then
    perform app_private.fail('Choose a different batch.');
  end if;

  -- No lot before or after: the product alone is corrected.
  if v_old_lot is null and p_new_lot is null then
    if v_product = v_old_product then
      perform app_private.fail('Choose a different product.');
    end if;
    if p_component is null then
      update public.implant_sites set product_id = v_product where id = p_site;
    else
      update public.site_components set product_id = v_product where id = p_component;
    end if;
    return;
  end if;

  if not public.module_on('inventory') then
    perform app_private.fail('Inventory is not in your plan.');
  end if;

  -- A lot attached later, or a correction of one (its lot never had a use movement): the item never came from
  -- stock, so no movement is written. The checks are lock_lot_for_correction's without its on-hand check, which
  -- would wrongly refuse a lot that has since been used up.
  if v_old_lot is null or not exists (
    select 1 from public.stock_movements m
    where m.implant_site_id = p_site and m.reason = 'use'
      and m.site_component_id is not distinct from p_component and m.stock_lot_id = v_old_lot
  ) then
    select * into v_lot from public.stock_lots where id = p_new_lot;
    if not found then
      perform app_private.fail('Choose a stock batch.');
    end if;
    if v_lot.product_id <> v_product then
      perform app_private.fail('That stock batch is for a different product.');
    end if;
    if v_lot.expiry is not null and v_lot.expiry < v_used_on then
      perform app_private.fail(format('Lot %s had expired on %s, before it was used. Choose another batch.',
        coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD')));
    end if;
    if p_component is null then
      update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product where id = p_site;
    else
      update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
    end if;
    return;
  end if;

  v_use := app_private.unreversed_use(p_site, p_component, v_old_lot);
  if v_use is null then
    perform app_private.fail('The original stock entry was not found.');
  end if;

  perform app_private.lock_lot_for_correction(p_new_lot, v_product, v_used_on);
  perform app_private.reverse_use(v_use, 'Correction: ' || trim(p_reason));
  perform app_private.insert_use(p_new_lot, v_site.patient_id, p_site, p_component);
  if p_component is null then
    update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product where id = p_site;
  else
    update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
  end if;
end $$;
