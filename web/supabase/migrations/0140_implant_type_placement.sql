-- Implant types (task 2, spec docs/superpowers/specs/2026-11-23-implant-types-design.md).
--   * place_implant_v4 (0129's body, same signature, so its owner and grants stay): placing keeps the product
--     that was planned for the tooth (planned_product_id; a spare placed instead keeps the primary plan) and sets
--     implant_type from the placed product's kind. Its checks and messages do not change.
--   * correct_batch (0113's body, same signature): a product correction re-defaults implant_type to the new
--     product's kind only while it still equals the old product's kind (a type the user changed is kept).
--   * set_implant_geometry: type, angle, direction, anchorage, entry point and trajectory of a placed implant
--     (Edit on Patients; clinical data, the same in a clinic).
--   * Backfill again (0139's): implants placed by the previous app version between 0139 and this release.
set local lock_timeout = '5s';

-- ── place_implant_v4: 0129's body; only the two implant_sites writes change ──────────────────────────
create or replace function public.place_implant_v4(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid,
  p_graft text, p_notes text, p_slot uuid, p_technique text, p_course uuid, p_placing_doctor uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_id uuid;
  v_doctor uuid;
  v_stock boolean := public.module_on('inventory');
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not v_teaching then
    if coalesce(p_placing_delegate, p_assisting_delegate, p_supervisor, p_course) is not null then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
  elsif p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  -- A product switched off in Admin → Catalogue (0128) is still accepted when it is the one planned, or a spare,
  -- for this patient's tooth: switching off only hides it from new choices.
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active)
     and not exists (
       select 1 from public.products pr
       where pr.id = p_product and pr.type = 'implant'
         and (exists (select 1 from public.implant_sites s
                      where s.patient_id = p_patient and s.tooth = p_tooth and s.state = 'planned' and s.product_id = pr.id)
           or exists (select 1 from public.slot_spare_implants sp
                      join public.implant_sites s on s.slot_id = sp.slot_id and s.tooth = sp.tooth
                      where s.patient_id = p_patient and s.tooth = p_tooth and s.state = 'planned' and sp.product_id = pr.id)
           or exists (select 1 from public.slot_spare_implants sp
                      where sp.slot_id = p_slot and sp.tooth = p_tooth and sp.product_id = pr.id)))
  then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
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

  -- Who placed it: the doctor named, else (no delegate named either) the booking's doctor.
  v_doctor := p_placing_doctor;
  if v_doctor is null and p_placing_delegate is null then
    v_doctor := v_slot.placing_doctor_id;
  end if;
  if not v_teaching then
    if v_doctor is null or not exists (select 1 from public.doctors where id = v_doctor and (active or (p_placing_doctor is null and id = v_slot.placing_doctor_id))) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
  elsif p_placing_delegate is not null and v_doctor is not null then
    perform app_private.fail('Choose a delegate or a doctor, not both.');
  elsif v_doctor is not null then
    if not exists (select 1 from public.doctors where id = v_doctor and (active or (p_placing_doctor is null and id = v_slot.placing_doctor_id))) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
    if p_assisting_delegate is not null and not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
    perform app_private.check_enrolled(p_course, p_assisting_delegate);
    if p_supervisor is not null and not exists (select 1 from public.supervisors where id = p_supervisor and active) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    -- A delegate: v3's rules.
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
  end if;

  if v_stock then
    perform app_private.lock_lot(p_lot, p_product, p_placed_on);
  end if;

  -- The chosen course wins over the booking's session course. The planned product is kept (a spare placed
  -- instead keeps the primary plan); the type comes from the placed product's kind.
  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        planned_product_id = coalesce(planned_product_id, v_site.product_id),
        implant_type = coalesce(implant_type, (select implant_kind from public.products where id = p_product)),
        graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate, placing_doctor_id = v_doctor,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = p_course, technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, graft,
      placing_delegate_id, placing_doctor_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id,
      course_id, technique, implant_type
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, coalesce(p_graft, ''),
      p_placing_delegate, v_doctor, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, p_course, p_technique,
      (select implant_kind from public.products where id = p_product)
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

-- ── correct_batch: 0113's body; an implant's product correction also re-defaults its type ─────────────
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
  v_implant_type text;
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
    -- A new product re-defaults the type only while it is still the old product's kind.
    v_implant_type := case
      when v_site.implant_type = (select implant_kind from public.products where id = v_old_product)
        then (select implant_kind from public.products where id = v_product)
      else v_site.implant_type
    end;
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
      update public.implant_sites set product_id = v_product, implant_type = v_implant_type where id = p_site;
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
      update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product, implant_type = v_implant_type where id = p_site;
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
    update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product, implant_type = v_implant_type where id = p_site;
  else
    update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
  end if;
end $$;

-- ── set_implant_geometry ───────────────────────────────────────────────────────────────────────────
-- Saves the whole section at once: empty text and a null mean "not recorded". Audited by implant_sites_audit.
create function public.set_implant_geometry(
  p_site uuid, p_type text, p_angulation numeric, p_direction text, p_anchorage text, p_entry text, p_trajectory text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_direction text := nullif(trim(p_direction), '');
  v_anchorage text := nullif(trim(p_anchorage), '');
  v_entry text := trim(coalesce(p_entry, ''));
  v_trajectory text := trim(coalesce(p_trajectory, ''));
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Only a placed implant has a type and angle.');
  end if;
  if p_type is null or p_type not in ('conventional', 'tilted', 'zygomatic', 'pterygoid') then
    perform app_private.fail('Choose the implant type.');
  end if;
  if p_type = 'tilted' and p_angulation is null then
    perform app_private.fail('Enter the angle of the tilted implant.');
  end if;
  if p_angulation is not null and (p_angulation < 0 or p_angulation > 60) then
    perform app_private.fail('Enter an angle between 0 and 60°.');
  end if;
  if v_direction is not null and v_direction not in ('mesial', 'distal', 'buccal', 'palatal_lingual') then
    perform app_private.fail('Choose the direction of the angle.');
  end if;
  if p_type not in ('zygomatic', 'pterygoid') and (v_anchorage is not null or v_entry <> '' or v_trajectory <> '') then
    perform app_private.fail('Anchorage is only recorded for zygomatic and pterygoid implants.');
  end if;
  if v_anchorage is not null and v_anchorage not in ('zygoma', 'pterygoid_plate', 'tuberosity', 'other') then
    perform app_private.fail('Choose the anchorage.');
  end if;
  if char_length(v_entry) > 200 or char_length(v_trajectory) > 200 then
    perform app_private.fail('Keep the entry point and trajectory to 200 characters each.');
  end if;

  update public.implant_sites
  set implant_type = p_type, angulation_deg = p_angulation, angulation_direction = v_direction,
      anchorage = v_anchorage, entry_point = v_entry, trajectory = v_trajectory
  where id = p_site;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0132.
grant create on schema public, app_private to tenant_definer;
alter function public.set_implant_geometry(uuid, text, numeric, text, text, text, text) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function public.set_implant_geometry(uuid, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.set_implant_geometry(uuid, text, numeric, text, text, text, text) to authenticated;

-- ── Backfill again (0139's): implants the previous app version placed during this release ───────────
-- Without audit rows or a new updated_at, as in 0139.
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
