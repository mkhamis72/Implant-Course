-- Guided / free-hand technique per implant, editing and completing bookings, deleting courses and patients.

alter table public.implant_sites
  add column technique text check (technique in ('guided', 'free_hand'));

create function app_private.check_technique(p_technique text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_technique is not null and p_technique not in ('guided', 'free_hand') then
    perform app_private.fail('Choose Guided or Free hand.');
  end if;
end $$;

-- Planning stores the technique (latest: 0010). New trailing parameter, so drop the old signature.
drop function public.plan_implant(uuid, smallint, uuid, text);
create function public.plan_implant(
  p_patient uuid, p_tooth smallint, p_product uuid default null, p_notes text default '', p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_active();
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if exists (select 1 from public.implant_sites where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')) then
    perform app_private.fail(format('Tooth %s already has an implant record.', p_tooth));
  end if;
  insert into public.implant_sites (patient_id, tooth, state, product_id, notes, technique)
  values (p_patient, p_tooth, 'planned', p_product, coalesce(p_notes, ''), p_technique)
  returning id into v_id;
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_planned');
  return v_id;
end $$;

-- Booking reads an optional technique per implant (latest: 0024). Signature unchanged.
create or replace function public.create_surgery_slot(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_implants jsonb default '[]',
  p_override_reason text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_clash boolean;
  v_session public.sessions;
  v_slot uuid;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_technique text;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
begin
  perform app_private.require_active();
  select * into v_session from public.sessions where id = p_session;
  if not found then
    perform app_private.fail('Choose a surgery session.');
  end if;
  if v_session.type <> 'surgery' then
    perform app_private.fail('Surgeries can only be booked in a surgery session.');
  end if;
  if not exists (select 1 from public.chairs where id = p_chair and active) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if exists (select 1 from public.patients where id = p_patient and archived) then
    perform app_private.fail('This patient is archived. Restore the patient first.');
  end if;
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate cannot be both placing and assisting.');
  end if;
  select d.full_name into v_missing
  from unnest(v_all) as x(id)
  left join public.delegates d on d.id = x.id
  where d.id is null or not d.active
     or not exists (select 1 from public.enrollments e where e.course_id = v_session.course_id and e.delegate_id = x.id)
  limit 1;
  if found then
    perform app_private.fail(format('%s is not enrolled in this course.', coalesce(v_missing, 'A delegate')));
  end if;
  -- I1: one booking at a time per day, so two clashing bookings cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, case when v_clash then trim(coalesce(p_override_reason, '')) else '' end, coalesce(p_notes, ''))
  returning id into v_slot;

  insert into public.slot_delegates (slot_id, delegate_id, role)
  select v_slot, x, 'placing' from unnest(p_placing) x
  union all
  select v_slot, x, 'assisting' from unnest(coalesce(p_assisting, '{}')) x;

  for v_item in select * from jsonb_array_elements(coalesce(p_implants, '[]'::jsonb)) loop
    v_tooth := (v_item ->> 'tooth')::int;
    if v_tooth is null or v_tooth / 10 not between 1 and 4 or v_tooth % 10 not between 1 and 8 then
      perform app_private.fail(format('%s is not a tooth number. Use FDI numbers 11–48.', coalesce(v_item ->> 'tooth', '?')));
    end if;
    if v_tooth = any (v_seen) then
      perform app_private.fail(format('Tooth %s is listed twice.', v_tooth));
    end if;
    v_seen := v_seen || v_tooth;
    v_product := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product is not null and not exists (select 1 from public.products where id = v_product and type = 'implant' and active) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_technique := nullif(v_item ->> 'technique', '');
    perform app_private.check_technique(v_technique);

    select * into v_site from public.implant_sites
    where patient_id = p_patient and tooth = v_tooth and state not in ('failed', 'removed')
    for update;
    if found and v_site.state <> 'planned' then
      perform app_private.fail(format('Tooth %s already has an implant.', v_tooth));
    end if;
    -- I2: a tooth planned in another active booking must be cancelled there first.
    if found and v_site.slot_id is not null and exists (
      select 1 from public.surgery_slots o where o.id = v_site.slot_id and o.status <> 'cancelled' and o.id <> v_slot
    ) then
      perform app_private.fail((
        select format('Tooth %s is already booked on %s (%s). Cancel that booking first.', v_tooth,
               to_char(o.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), c.name)
        from public.surgery_slots o join public.chairs c on c.id = o.chair_id where o.id = v_site.slot_id));
    end if;
    if found then
      update public.implant_sites
      set slot_id = v_slot, session_id = p_session, course_id = v_session.course_id,
          product_id = coalesce(v_product, product_id), technique = coalesce(v_technique, technique)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id, technique)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, p_session, v_slot, v_technique)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

-- Placement stores the technique (latest: 0024). New trailing parameter, so drop the old signature.
drop function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid);
create function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null,
  p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_course uuid;
  v_id uuid;
begin
  perform app_private.require_active();
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
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = coalesce(v_course, course_id), technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
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

create function public.set_implant_technique(p_site uuid, p_technique text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if p_technique is null then
    perform app_private.fail('Choose Guided or Free hand.');
  end if;
  perform app_private.check_technique(p_technique);
  update public.implant_sites set technique = p_technique where id = p_site and state <> 'removed';
  if not found then
    perform app_private.fail('Implant not found.');
  end if;
end $$;

-- Edit a scheduled booking on the same day: chair, times, supervisor, delegates, notes.
create function public.update_surgery_slot(
  p_slot uuid, p_chair uuid, p_start time, p_end time, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_override_reason text default '', p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.surgery_slots;
  v_session public.sessions;
  v_clash boolean;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
begin
  perform app_private.require_active();
  select * into v_slot from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if v_slot.status <> 'scheduled' then
    perform app_private.fail('Only scheduled surgeries can be edited.');
  end if;
  select * into v_session from public.sessions where id = v_slot.session_id;
  if not exists (select 1 from public.chairs where id = p_chair and (active or id = v_slot.chair_id)) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if p_supervisor is null or not exists (
    select 1 from public.supervisors where id = p_supervisor and (active or id = v_slot.supervisor_id)
  ) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate cannot be both placing and assisting.');
  end if;
  select d.full_name into v_missing
  from unnest(v_all) as x(id)
  left join public.delegates d on d.id = x.id
  where d.id is null or not d.active
     or not exists (select 1 from public.enrollments e where e.course_id = v_session.course_id and e.delegate_id = x.id)
  limit 1;
  if found then
    perform app_private.fail(format('%s is not enrolled in this course.', coalesce(v_missing, 'A delegate')));
  end if;
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts(v_slot.session_id, p_chair, p_start, p_end, v_slot.patient_id, p_supervisor, v_all, p_slot)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  update public.surgery_slots
  set chair_id = p_chair,
      starts_at = public.cairo_ts(v_session.date, p_start),
      ends_at = public.cairo_ts(v_session.date, p_end),
      supervisor_id = p_supervisor,
      override_reason = case when v_clash then trim(coalesce(p_override_reason, '')) else '' end,
      notes = coalesce(p_notes, '')
  where id = p_slot;

  delete from public.slot_delegates where slot_id = p_slot;
  insert into public.slot_delegates (slot_id, delegate_id, role)
  select p_slot, x, 'placing' from unnest(p_placing) x
  union all
  select p_slot, x, 'assisting' from unnest(coalesce(p_assisting, '{}')) x;
end $$;

-- Mark a booking completed by hand, or reopen it.
create function public.set_slot_status(p_slot uuid, p_status public.slot_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.slot_status;
begin
  perform app_private.require_active();
  select status into v_status from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if not ((v_status = 'scheduled' and p_status = 'done') or (v_status = 'done' and p_status = 'scheduled')) then
    perform app_private.fail(case when p_status = 'done' then 'Only scheduled surgeries can be marked completed.'
                                  else 'Only completed surgeries can be reopened.' end);
  end if;
  update public.surgery_slots set status = p_status where id = p_slot;
end $$;

-- Delegate report returns the technique (latest: 0016). Return type changes, so drop first.
drop function public.delegate_report(uuid);
create function public.delegate_report(p_delegate uuid)
returns table (
  site_id uuid, role text, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text,
  tooth smallint, state public.site_state, placed_on date, product_id uuid, type public.product_type,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text,
  lot_no text, last_outcome public.followup_outcome, technique text
)
language sql stable security invoker set search_path = '' as $$
  select s.id,
         case when s.placing_delegate_id = p_delegate then 'placing' else 'assisting' end,
         c.id, c.name, p.id, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.id, pr.type, pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null
          order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = p_delegate or s.assisting_delegate_id = p_delegate)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
$$;

-- Delete a patient who has no stock traceability; everything else of theirs cascades.
create function public.delete_patient(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  perform 1 from public.patients where id = p_patient for update;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  if exists (
    select 1 from public.stock_movements m
    where m.patient_id = p_patient
       or m.implant_site_id in (select id from public.implant_sites where patient_id = p_patient)
       or m.site_component_id in (
         select sc.id from public.site_components sc
         join public.implant_sites s on s.id = sc.site_id where s.patient_id = p_patient)
  ) then
    perform app_private.fail('This patient has stock movements (placed implants or fitted components) and can''t be deleted. Archive them instead.');
  end if;
  delete from public.surgery_slots where patient_id = p_patient;
  delete from public.patients where id = p_patient;
end $$;

-- Delete a course with no placed implants and no live bookings; sessions and enrolments cascade.
create function public.delete_course(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  perform 1 from public.courses where id = p_course for update;
  if not found then
    perform app_private.fail('Course not found.');
  end if;
  if exists (
    select 1 from public.implant_sites s
    where (s.course_id = p_course or s.session_id in (select id from public.sessions where course_id = p_course))
      and s.state not in ('planned', 'removed')
  ) then
    perform app_private.fail('Implants were placed in this course, so it can''t be deleted.');
  end if;
  if exists (
    select 1 from public.surgery_slots o join public.sessions se on se.id = o.session_id
    where se.course_id = p_course and o.status <> 'cancelled'
  ) then
    perform app_private.fail('This course has surgery bookings. Cancel them first.');
  end if;
  update public.implant_sites set course_id = null, session_id = null
  where course_id = p_course or session_id in (select id from public.sessions where course_id = p_course);
  delete from public.surgery_slots
  where session_id in (select id from public.sessions where course_id = p_course);
  delete from public.courses where id = p_course;
end $$;

revoke execute on function app_private.check_technique(text) from public, anon;
revoke execute on function public.plan_implant(uuid, smallint, uuid, text, text) from public, anon;
revoke execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text) from public, anon;
revoke execute on function public.set_implant_technique(uuid, text) from public, anon;
revoke execute on function public.update_surgery_slot(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text) from public, anon;
revoke execute on function public.set_slot_status(uuid, public.slot_status) from public, anon;
revoke execute on function public.delegate_report(uuid) from public, anon;
revoke execute on function public.delete_patient(uuid) from public, anon;
revoke execute on function public.delete_course(uuid) from public, anon;
grant execute on function public.plan_implant(uuid, smallint, uuid, text, text) to authenticated;
grant execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text) to authenticated;
grant execute on function public.set_implant_technique(uuid, text) to authenticated;
grant execute on function public.update_surgery_slot(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text) to authenticated;
grant execute on function public.set_slot_status(uuid, public.slot_status) to authenticated;
grant execute on function public.delegate_report(uuid) to authenticated;
grant execute on function public.delete_patient(uuid) to authenticated;
grant execute on function public.delete_course(uuid) to authenticated;
