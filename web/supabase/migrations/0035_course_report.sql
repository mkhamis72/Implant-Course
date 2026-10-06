-- Course reports: ISQ and bone type at placement, and one row per implant placed in a course.

alter table public.implant_sites add column isq numeric(4,1) check (isq is null or isq between 0 and 100);
alter table public.implant_sites add column bone_type text check (bone_type is null or bone_type in ('D1', 'D2', 'D3', 'D4'));

-- The latest place_implant (0030) plus ISQ and bone type. A new name, not an overload: two functions that both
-- accept the same 13 named arguments would be ambiguous for PostgREST callers.
create function public.place_implant_v2(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null,
  p_technique text default null, p_isq numeric default null, p_bone_type text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_course uuid;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > public.cairo_today() then
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
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;
  if p_isq is not null and (p_isq < 0 or p_isq > 100) then
    perform app_private.fail('Enter an ISQ between 0 and 100.');
  end if;
  if p_bone_type is not null and p_bone_type not in ('D1', 'D2', 'D3', 'D4') then
    perform app_private.fail('Choose a bone type from D1 to D4.');
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
  if v_slot.id is not null then
    select course_id into v_course from public.sessions where id = v_slot.session_id;
  end if;

  perform app_private.lock_lot(p_lot, p_product, p_placed_on);

  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, isq = p_isq, bone_type = p_bone_type, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = coalesce(v_course, course_id), technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, isq, bone_type, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, p_isq, p_bone_type, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, v_course, p_technique
    ) returning id into v_id;
  end if;

  perform app_private.insert_use(p_lot, p_patient, v_id, null);
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

-- The previous app version (and anything else) still calls the 13-argument function: delegate to v2.
create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null,
  p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  return public.place_implant_v2(
    p_patient => p_patient, p_tooth => p_tooth, p_product => p_product, p_lot => p_lot, p_placed_on => p_placed_on,
    p_placing_delegate => p_placing_delegate, p_supervisor => p_supervisor, p_assisting_delegate => p_assisting_delegate,
    p_torque => p_torque, p_graft => p_graft, p_notes => p_notes, p_slot => p_slot, p_technique => p_technique);
end $$;

-- Security invoker: panel permissions apply through RLS (implants need Patients or Schedule view).
create function public.course_report(p_course uuid)
returns table (
  site_id uuid, session_id uuid, session_title text, session_date date, slot_start timestamptz,
  patient_name text, file_no text, tooth smallint, state public.site_state, placed_on date,
  placing_delegate text, assisting_delegate text, supervisor text,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text, lot_no text,
  torque_ncm numeric, isq numeric, bone_type text, technique text, graft text, last_outcome public.followup_outcome
)
language sql stable security invoker set search_path = '' as $$
  select s.id, se.id, se.title, se.date, o.starts_at,
         p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pd.full_name, ad.full_name, sv.full_name,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         s.torque_ncm, s.isq, s.bone_type, s.technique, s.graft,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null order by f.date desc, f.created_at desc limit 1)
  from public.courses c
  join public.implant_sites s on s.course_id = c.id
    or (s.course_id is null and s.placed_on between c.start_date and c.end_date
        and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = s.placing_delegate_id))
  join public.patients p on p.id = s.patient_id
  left join public.sessions se on se.id = s.session_id
  left join public.surgery_slots o on o.id = s.slot_id
  left join public.delegates pd on pd.id = s.placing_delegate_id
  left join public.delegates ad on ad.id = s.assisting_delegate_id
  left join public.supervisors sv on sv.id = s.supervisor_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where c.id = p_course and s.state not in ('planned', 'removed')
  order by se.date nulls last, o.starts_at nulls last, p.file_no, s.tooth;
$$;

revoke execute on function public.place_implant_v2(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric, text) from public, anon;
grant execute on function public.place_implant_v2(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric, text) to authenticated;
revoke execute on function public.course_report(uuid) from public, anon;
grant execute on function public.course_report(uuid) to authenticated;
