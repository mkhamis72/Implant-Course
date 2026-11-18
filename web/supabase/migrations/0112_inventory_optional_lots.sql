-- Modules, release 2, part 2 (spec docs/superpowers/specs/2026-11-16-modular-design.md): when Inventory is off,
-- implants are placed and components fitted with a catalogue product and no stock batch (no stock movement).
-- correct_batch can then correct the product alone, or attach a lot later (once Inventory is on) without
-- changing stock: the item was never taken from it. With Inventory on everything is as before (a lot is still
-- required and deducted), so existing companies (all on Full) see no change.
set local lock_timeout = '5s';

-- 0010's constraint without "stock_lot_id is not null".
alter table public.implant_sites drop constraint implant_sites_placed_details;
alter table public.implant_sites add constraint implant_sites_placed_details check (
  state in ('planned', 'removed')
  or (product_id is not null and placed_on is not null
      and placing_delegate_id is not null and supervisor_id is not null)
);

-- 0081's body; the stock batch is used only when Inventory is on.
create or replace function public.place_implant_v3(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid,
  p_graft text, p_notes text, p_slot uuid, p_technique text, p_course uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_id uuid;
  v_stock boolean := public.module_on('inventory');
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
  end if;
  if p_placing_delegate is null or not exists (select 1 from public.delegates where id = p_placing_delegate and active) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  perform app_private.check_enrolled(p_course, p_placing_delegate);
  perform app_private.check_enrolled(p_course, p_assisting_delegate);
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if p_slot is not null then
    select * into v_slot from public.surgery_slots where id = p_slot;
    if not found or v_slot.status = 'cancelled' then
      perform app_private.fail('That surgery booking was not found or is cancelled.');
    end if;
    if v_slot.patient_id <> p_patient then
      perform app_private.fail('That surgery booking is for another patient.');
    end if;
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  v_slot_id := coalesce(p_slot, v_site.slot_id);
  if v_slot_id is not null and v_slot.id is null then
    select * into v_slot from public.surgery_slots where id = v_slot_id;
  end if;

  if v_stock then
    perform app_private.lock_lot(p_lot, p_product, p_placed_on);
  end if;

  -- The chosen course wins over the booking's session course.
  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = p_course, technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, p_course, p_technique
    ) returning id into v_id;
  end if;

  if v_stock then
    perform app_private.insert_use(p_lot, p_patient, v_id, null);
  end if;
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');

  if v_slot.id is not null then
    update public.surgery_slots set status = 'done'
    where id = v_slot.id and status = 'scheduled'
      and not exists (
        select 1 from public.slot_planned_implants spi
        join public.implant_sites s on s.id = spi.implant_site_id
        where spi.slot_id = v_slot.id and s.state = 'planned'
      );
  end if;
  return v_id;
end $$;

-- 0090's body; the stock batch is used only when Inventory is on.
create or replace function public.fit_component_v2(p_site uuid, p_type public.component_type, p_fitted_on date,
  p_product uuid, p_lot uuid, p_by_delegate uuid, p_by_organizer uuid, p_notes text, p_course uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
  v_stock boolean := public.module_on('inventory');
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > public.cairo_today() then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  perform app_private.check_enrolled(p_course, p_by_delegate);
  if p_by_organizer is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_site.company_id and m.user_id = p_by_organizer
      and m.active and m.role in ('admin', 'organizer')
  ) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if v_stock then
      if p_lot is null then
        perform app_private.fail('Choose the stock batch used.');
      end if;
      perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
    end if;
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id
  ) values (
    v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course
  ) returning id into v_id;

  if p_product is not null and v_stock then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

-- 0030's body. The path follows (old lot, new lot):
--   set  → set:  as before (reverse the use, use the new lot); Inventory must be on.
--   null → null: the product alone is corrected; no stock movement.
--   null → set:  a lot is attached later (Inventory on); it must match the product and not have expired
--                before the item was used. No on-hand check and no movement: the item never came from stock.
--   set  → null: refused (a lot is never removed).
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

  -- A lot attached later: checked like lock_lot_for_correction, without on-hand or a movement.
  if v_old_lot is null then
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
