-- Final review of Plan 3.
-- I1: lock and check the stock batch BEFORE writing any row that references it. Writing the
--     site/component first takes a FOR KEY SHARE lock on the batch (foreign-key check); upgrading
--     it later to FOR UPDATE let two same-batch placements deadlock. Lock order is now: site → batch.
-- I2: once a product has stock its type is frozen, and once it has been used for a patient its
--     brand/system/platform/size are frozen (past records and recall would silently change).

create function app_private.lock_lot(p_lot uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  select * into v_lot from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Choose a stock batch.');
  end if;
  if v_lot.product_id <> p_product then
    perform app_private.fail('That stock batch is for a different product.');
  end if;
  if v_lot.expiry is not null and v_lot.expiry < current_date then
    perform app_private.fail(format('Lot %s expired on %s. Choose another batch.',
      coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD')));
  end if;
  if app_private.lot_on_hand(p_lot) < 1 then
    perform app_private.fail('This stock batch is empty. Choose another batch or receive stock first.');
  end if;
end $$;

create function app_private.insert_use(p_lot uuid, p_patient uuid, p_site uuid, p_component uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.stock_movements (stock_lot_id, delta, reason, implant_site_id, site_component_id, patient_id)
  values (p_lot, -1, 'use', p_site, p_component, p_patient);
$$;

create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > current_date + 1 then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
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
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  perform app_private.lock_lot(p_lot, p_product);

  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, '')
    ) returning id into v_id;
  end if;

  perform app_private.insert_use(p_lot, p_patient, v_id, null);
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');
  return v_id;
end $$;

create or replace function public.fit_component(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid default null,
  p_lot uuid default null, p_by_delegate uuid default null, p_by_organizer uuid default null,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > current_date + 1 then
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
  if p_by_organizer is not null and not exists (select 1 from public.profiles where user_id = p_by_organizer and active) then
    perform app_private.fail('Choose an active organizer.');
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
    if p_lot is null then
      perform app_private.fail('Choose the stock batch used.');
    end if;
    perform app_private.lock_lot(p_lot, p_product);
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id, fitted_by_organizer_id, notes
  ) values (
    p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate, p_by_organizer, coalesce(p_notes, '')
  ) returning id into v_id;

  if p_product is not null then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

-- take_one is superseded by lock_lot + insert_use.
drop function app_private.take_one(uuid, uuid, uuid, uuid, uuid);

-- I2: freeze identity of products that have stock / have been used.
create function app_private.protect_used_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type is distinct from old.type
     and exists (select 1 from public.stock_lots where product_id = old.id) then
    perform app_private.fail('This product already has stock, so its type cannot change. Add a new product instead.');
  end if;
  if (new.brand, new.system, new.platform, new.diameter_mm, new.length_mm)
       is distinct from (old.brand, old.system, old.platform, old.diameter_mm, old.length_mm)
     and exists (
       select 1 from public.stock_movements m
       join public.stock_lots l on l.id = m.stock_lot_id
       where l.product_id = old.id and m.reason = 'use'
     ) then
    perform app_private.fail(
      'This product has been used for patients, so its brand, system, platform and size cannot change. Add a new product instead.'
    );
  end if;
  return new;
end $$;

create trigger products_protect_used before update on public.products
  for each row execute function app_private.protect_used_product();
