-- Catalogue library, part 2 (spec docs/superpowers/specs/2026-11-21-catalogue-library-design.md). place_implant_v4,
-- same signature (0121's body), so its owner (tenant_definer) and grants stay: an implant switched off in
-- Admin → Catalogue (0128) can still be placed when it is the product planned for that patient's tooth, or one of
-- the booking's spares for it. Any other inactive product is still refused.
set local lock_timeout = '5s';

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

  -- The chosen course wins over the booking's session course.
  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
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
      course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, coalesce(p_graft, ''),
      p_placing_delegate, v_doctor, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
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
