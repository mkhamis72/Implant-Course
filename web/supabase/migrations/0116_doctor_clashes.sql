-- Modules, release 3, review fix: a doctor booked twice at the same time is a clash, like a supervisor or a
-- delegate. slot_conflicts (0024) already has a defaulted p_exclude, so the doctor comes in a new function,
-- slot_conflicts_v2 (no defaults); slot_conflicts stays for the previous app version. create_surgery_slot_v2
-- and update_surgery_slot_v2 (0115) are recreated with the same signatures to use it, and a booking without a doctor
-- or with an inactive one now says "Choose the doctor." (placements keep "Choose the doctor who placed the implant.").
set local lock_timeout = '5s';

-- ── slot_conflicts_v2: 0024's slot_conflicts plus the doctor ───────────────────────────────────────
create function public.slot_conflicts_v2(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_delegates uuid[], p_doctor uuid, p_exclude uuid
) returns table (kind text, message text)
language sql stable security invoker set search_path = '' as $$
  with me as (
    select public.cairo_ts(s.date, p_start) as s_at, public.cairo_ts(s.date, p_end) as e_at
    from public.sessions s where s.id = p_session
  ),
  other as (
    select o.id, o.chair_id, o.patient_id, o.supervisor_id, o.placing_doctor_id, c.name as chair_name,
           p.full_name as patient_name,
           to_char(o.starts_at at time zone 'Africa/Cairo', 'HH24:MI') || '–' ||
           to_char(o.ends_at at time zone 'Africa/Cairo', 'HH24:MI') as span
    from public.surgery_slots o
    cross join me
    join public.chairs c on c.id = o.chair_id
    join public.patients p on p.id = o.patient_id
    where o.status <> 'cancelled'
      and (p_exclude is null or o.id <> p_exclude)
      and tstzrange(o.starts_at, o.ends_at) && tstzrange(me.s_at, me.e_at)
  )
  select 'chair', format('%s is already booked %s (%s).', chair_name, span, patient_name) from other where chair_id = p_chair
  union all
  select 'patient', format('%s already has a surgery %s.', patient_name, span) from other where patient_id = p_patient
  union all
  select 'supervisor', format('%s is already supervising %s (%s).',
           (select su.full_name from public.supervisors su where su.id = p_supervisor),
           span, patient_name)
  from other where supervisor_id = p_supervisor
  union all
  select 'doctor', format('%s is already booked %s (%s).',
           (select dr.name from public.doctors dr where dr.id = p_doctor),
           span, patient_name)
  from other where placing_doctor_id = p_doctor
  union all
  select 'delegate', format('%s is already booked %s (%s).', d.full_name, o.span, o.patient_name)
  from other o
  join public.slot_delegates sd on sd.slot_id = o.id
  join public.delegates d on d.id = sd.delegate_id
  where sd.delegate_id = any (p_delegates);
$$;
revoke execute on function public.slot_conflicts_v2(uuid, uuid, time, time, uuid, uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function public.slot_conflicts_v2(uuid, uuid, time, time, uuid, uuid, uuid[], uuid, uuid) to authenticated;

-- ── create_surgery_slot_v2: 0115's body; doctor clashes, "Choose the doctor." in a clinic ──────────
create or replace function public.create_surgery_slot_v2(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[], p_implants jsonb, p_override_reason text, p_notes text, p_placing_doctor uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_clash boolean;
  v_session public.sessions;
  v_slot uuid;
  v_placing uuid[] := coalesce(p_placing, '{}');
  v_assisting uuid[] := coalesce(p_assisting, '{}');
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_technique text;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('schedule', 'edit');
  -- Any surgery session of the company: in a clinic, a clinic day (no course) or any other.
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
  if not v_teaching then
    if p_supervisor is not null or cardinality(v_all) > 0 then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
    if p_placing_doctor is null or not exists (select 1 from public.doctors where id = p_placing_doctor and active) then
      perform app_private.fail('Choose the doctor.');
    end if;
  elsif p_placing_doctor is not null then
    if cardinality(v_placing) > 0 then
      perform app_private.fail('Choose a delegate or a doctor, not both.');
    end if;
    if not exists (select 1 from public.doctors where id = p_placing_doctor and active) then
      perform app_private.fail('Choose the doctor.');
    end if;
    if p_supervisor is not null and not exists (select 1 from public.supervisors where id = p_supervisor and active) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
    if cardinality(v_placing) = 0 then
      perform app_private.fail('Choose at least one placing delegate.');
    end if;
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts_v2(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all, p_placing_doctor, null)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id,
                                    placing_doctor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, p_placing_doctor,
          case when v_clash then trim(coalesce(p_override_reason, '')) else '' end, coalesce(p_notes, ''))
  returning id into v_slot;

  insert into public.slot_delegates (slot_id, delegate_id, role)
  select v_slot, x, 'placing' from unnest(v_placing) x
  union all
  select v_slot, x, 'assisting' from unnest(v_assisting) x;

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

-- ── update_surgery_slot_v2: 0115's body; doctor clashes, "Choose the doctor." in a clinic ──────────
create or replace function public.update_surgery_slot_v2(
  p_slot uuid, p_chair uuid, p_start time, p_end time, p_supervisor uuid, p_placing uuid[], p_assisting uuid[],
  p_override_reason text, p_notes text, p_placing_doctor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.surgery_slots;
  v_session public.sessions;
  v_clash boolean;
  v_placing uuid[] := coalesce(p_placing, '{}');
  v_assisting uuid[] := coalesce(p_assisting, '{}');
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('schedule', 'edit');
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
  if not v_teaching then
    if p_supervisor is not null or cardinality(v_all) > 0 then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
    if p_placing_doctor is null or not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_slot.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor.');
    end if;
  elsif p_placing_doctor is not null then
    if cardinality(v_placing) > 0 then
      perform app_private.fail('Choose a delegate or a doctor, not both.');
    end if;
    if not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_slot.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor.');
    end if;
    if p_supervisor is not null and not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_slot.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    if p_supervisor is null or not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_slot.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
    if cardinality(v_placing) = 0 then
      perform app_private.fail('Choose at least one placing delegate.');
    end if;
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts_v2(v_slot.session_id, p_chair, p_start, p_end, v_slot.patient_id, p_supervisor, v_all, p_placing_doctor, p_slot)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  update public.surgery_slots
  set chair_id = p_chair,
      starts_at = public.cairo_ts(v_session.date, p_start),
      ends_at = public.cairo_ts(v_session.date, p_end),
      supervisor_id = p_supervisor,
      placing_doctor_id = p_placing_doctor,
      override_reason = case when v_clash then trim(coalesce(p_override_reason, '')) else '' end,
      notes = coalesce(p_notes, '')
  where id = p_slot;

  delete from public.slot_delegates where slot_id = p_slot;
  insert into public.slot_delegates (slot_id, delegate_id, role)
  select p_slot, x, 'placing' from unnest(v_placing) x
  union all
  select p_slot, x, 'assisting' from unnest(v_assisting) x;
end $$;
