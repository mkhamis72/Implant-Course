-- Clinic workflow, task 1: a clinic books a surgery by date, without a separate "Add clinic day" step, and
-- records where it happens (In clinic / GA in hospital).
--   * surgery_slots.setting: 'clinic' or 'hospital_ga' (null on course bookings and older rows).
--   * app_private.clinic_day(date): the company's earliest course-less surgery session on that date, or a new
--     "Clinic day" (00:00–23:59). An advisory lock per company and date makes two bookings at once share one day;
--     no unique index, since release 3 let a clinic add several course-less days on one date by hand.
--   * create_surgery_slot_v3 / update_surgery_slot_v3: v2 plus p_setting and p_date (v2 stays for the previous
--     app version). A clinic passes a date and no session; an update with another date moves the booking to that
--     date's clinic day. A course organizer passes a session as before, and no date or setting.
set local lock_timeout = '5s';

alter table public.surgery_slots
  add column setting text check (setting in ('clinic', 'hospital_ga'));

-- ── clinic_day: find or make the company's clinic day on a date ──────────────────────────────────────
create function app_private.clinic_day(p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  -- One caller at a time per company and date, so two bookings at once find the same day.
  perform pg_advisory_xact_lock(hashtext(app.current_company_id()::text || p_date::text));
  select id into v_id from public.sessions
  where company_id = app.current_company_id() and date = p_date and course_id is null and type = 'surgery'
  order by start_time, created_at, id
  limit 1;
  if v_id is null then
    insert into public.sessions (course_id, type, title, date, start_time, end_time)
    values (null, 'surgery', 'Clinic day', p_date, '00:00', '23:59')
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ── create_surgery_slot_v3: 0116's create_surgery_slot_v2 body, plus the clinic date and the setting ──
create function public.create_surgery_slot_v3(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[], p_implants jsonb, p_override_reason text, p_notes text, p_placing_doctor uuid,
  p_setting text, p_date date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_clash boolean;
  v_session public.sessions;
  v_session_id uuid := p_session;
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
  if not v_teaching then
    -- A clinic books by date: the day's hidden clinic day is found or made.
    if p_session is not null then
      perform app_private.fail('Clinic bookings take a date, not a surgery day.');
    end if;
    if p_date is null then
      perform app_private.fail('Choose a date.');
    end if;
    v_session_id := app_private.clinic_day(p_date);
  else
    if p_date is not null or p_setting is not null then
      perform app_private.fail('Dates and settings are set on clinic bookings only.');
    end if;
    if p_session is null then
      perform app_private.fail('Choose a surgery day.');
    end if;
  end if;
  select * into v_session from public.sessions where id = v_session_id;
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
    select 1 from public.slot_conflicts_v2(v_session_id, p_chair, p_start, p_end, p_patient, p_supervisor, v_all, p_placing_doctor, null)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id,
                                    placing_doctor_id, override_reason, notes, setting)
  values (v_session_id, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, p_placing_doctor,
          case when v_clash then trim(coalesce(p_override_reason, '')) else '' end, coalesce(p_notes, ''), p_setting)
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
      set slot_id = v_slot, session_id = v_session_id, course_id = v_session.course_id,
          product_id = coalesce(v_product, product_id), technique = coalesce(v_technique, technique)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id, technique)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, v_session_id, v_slot, v_technique)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

-- ── update_surgery_slot_v3: 0120's update_surgery_slot_v2 body, plus the clinic date and the setting ──
create function public.update_surgery_slot_v3(
  p_slot uuid, p_chair uuid, p_start time, p_end time, p_supervisor uuid, p_placing uuid[], p_assisting uuid[],
  p_override_reason text, p_notes text, p_placing_doctor uuid, p_setting text, p_date date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.surgery_slots;
  v_session public.sessions;
  v_clash boolean;
  v_placing uuid[] := coalesce(p_placing, '{}');
  v_assisting uuid[] := coalesce(p_assisting, '{}');
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_rec_placing uuid[];
  v_rec_assisting uuid[];
  v_day uuid;
  v_missing text;
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('schedule', 'edit');
  if v_teaching and (p_date is not null or p_setting is not null) then
    perform app_private.fail('Dates and settings are set on clinic bookings only.');
  end if;
  select * into v_slot from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if v_slot.status <> 'scheduled' then
    perform app_private.fail('Only scheduled surgeries can be edited.');
  end if;
  select * into v_session from public.sessions where id = v_slot.session_id;
  if not v_teaching and p_date is not null and p_date <> v_session.date then
    -- A clinic moves the booking to that date's clinic day; p_start / p_end give its times there.
    v_day := app_private.clinic_day(p_date);
    select * into v_session from public.sessions where id = v_day;
  end if;
  if not exists (select 1 from public.chairs where id = p_chair and (active or id = v_slot.chair_id)) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if not v_teaching then
    -- What the booking recorded before the switch stays; only a change is refused.
    select coalesce(array_agg(delegate_id) filter (where role = 'placing'), '{}'),
           coalesce(array_agg(delegate_id) filter (where role = 'assisting'), '{}')
    into v_rec_placing, v_rec_assisting
    from public.slot_delegates where slot_id = p_slot;
    if p_supervisor is distinct from v_slot.supervisor_id
       or (cardinality(v_placing) > 0
           and not (v_placing @> v_rec_placing and v_rec_placing @> v_placing and cardinality(v_placing) = cardinality(v_rec_placing)))
       or (cardinality(v_assisting) > 0
           and not (v_assisting @> v_rec_assisting and v_rec_assisting @> v_assisting and cardinality(v_assisting) = cardinality(v_rec_assisting))) then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
    v_placing := v_rec_placing;
    v_assisting := v_rec_assisting;
    v_all := v_rec_placing || v_rec_assisting;
    if cardinality(v_placing) > 0 then
      if p_placing_doctor is not null then
        perform app_private.fail('Choose a delegate or a doctor, not both.');
      end if;
    elsif p_placing_doctor is null or not exists (
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
  if v_teaching then
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
  end if;
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts_v2(v_session.id, p_chair, p_start, p_end, v_slot.patient_id, p_supervisor, v_all, p_placing_doctor, p_slot)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  update public.surgery_slots
  set session_id = v_session.id,
      chair_id = p_chair,
      starts_at = public.cairo_ts(v_session.date, p_start),
      ends_at = public.cairo_ts(v_session.date, p_end),
      supervisor_id = p_supervisor,
      placing_doctor_id = p_placing_doctor,
      override_reason = case when v_clash then trim(coalesce(p_override_reason, '')) else '' end,
      notes = coalesce(p_notes, ''),
      setting = case when v_teaching then setting else p_setting end
  where id = p_slot;
  if v_session.id <> v_slot.session_id then
    -- Moved to another clinic day: its planned implants follow it.
    update public.implant_sites set session_id = v_session.id where slot_id = p_slot and state = 'planned';
  end if;

  if v_teaching then
    delete from public.slot_delegates where slot_id = p_slot;
    insert into public.slot_delegates (slot_id, delegate_id, role)
    select p_slot, x, 'placing' from unnest(v_placing) x
    union all
    select p_slot, x, 'assisting' from unnest(v_assisting) x;
  end if;
end $$;

-- ── Owner and grants ─────────────────────────────────────────────────────────────────────────────────
-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0109 and 0115.
grant create on schema public, app_private to tenant_definer;
alter function app_private.clinic_day(date) owner to tenant_definer;
alter function public.create_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date)
  owner to tenant_definer;
alter function public.update_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text, uuid, text, date)
  owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function app_private.clinic_day(date) from public, anon, authenticated;
revoke execute on function
  public.create_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date),
  public.update_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text, uuid, text, date)
  from public, anon;
grant execute on function
  public.create_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date),
  public.update_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text, uuid, text, date)
  to authenticated;
