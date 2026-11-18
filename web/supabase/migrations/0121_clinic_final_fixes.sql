-- Modules release 3, final review fixes. Same signatures throughout (create or replace of the latest definitions),
-- so owners (tenant_definer) and grants stay.
--   * place_implant_v3, correct_placement_v2, create_surgery_slot, update_surgery_slot (the previous app version's
--     functions) read courses, delegates and supervisors as their definer, past 0117's teaching policies: a clinic
--     could write those ids through them, rewrite an older booking's slot_delegates and read delegate names in
--     "… is not enrolled in this course.". They now refuse in a clinic, right after require_perm.
--   * correct_placement_v3: in a clinic, an implant a delegate placed (before the switch) takes no doctor (the
--     recorded one, usually none, comes back unchanged), as update_surgery_slot_v2 does for bookings (0120); with a
--     course organizer, a recorded null course (placed while a clinic) is accepted unchanged.
--   * place_implant_v4: the booking's doctor is accepted even if now inactive when no doctor is chosen.
--   * slot_conflicts_v2: no supervisor clash in a clinic, and none whose supervisor's name can't be read.
set local lock_timeout = '5s';

-- ── place_implant_v3: 0112's body; refused in a clinic ──
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
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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

-- ── correct_placement_v2: 0081's body; refused in a clinic ──
create or replace function public.correct_placement_v2(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_course uuid, p_graft text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_first date;
  v_lot public.stock_lots;
begin
  perform app_private.require_perm('patients', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has placement details to correct.');
  end if;

  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  -- Components, restorations, X-rays, the scan, follow-ups, complications and the failure can't predate the placement.
  select min(d) into v_first from (
    select fitted_on as d from public.site_components where site_id = p_site and voided_at is null
    union all
    select date from public.implant_followups where site_id = p_site and voided_at is null
    union all
    select v_site.failed_on
    union all
    select noticed_on from public.implant_complications where site_id = p_site and voided_at is null
    union all
    select r.fitted_on from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
    where rs.site_id = p_site and r.voided_at is null
    union all
    select v_site.impression_taken_on
    union all
    select xr.taken_on from public.radiographs xr
    where xr.patient_id = v_site.patient_id and v_site.tooth = any (xr.teeth) and xr.voided_at is null
      and xr.purpose <> 'planning' and xr.taken_on >= v_site.placed_on
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, restoration, X-ray, scan, follow-up, complication or failure (%s).', v_first));
  end if;
  select * into v_lot from public.stock_lots where id = v_site.stock_lot_id;
  if v_lot.expiry is not null and v_lot.expiry < p_placed_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Correct the batch first.',
      coalesce(v_lot.lot_no, '(no number)'), v_lot.expiry, p_placed_on));
  end if;

  -- People: active, or the one already recorded (they may have become inactive since).
  if p_placing_delegate is null or not exists (
    select 1 from public.delegates where id = p_placing_delegate and (active or id = v_site.placing_delegate_id)
  ) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (
      select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
    ) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  -- Only what changes is checked, so another field can still be fixed on an older record.
  if (p_placing_delegate, p_course) is distinct from (v_site.placing_delegate_id, v_site.course_id) then
    perform app_private.check_enrolled(p_course, p_placing_delegate);
  end if;
  if (p_assisting_delegate, p_course) is distinct from (v_site.assisting_delegate_id, v_site.course_id) then
    perform app_private.check_enrolled(p_course, p_assisting_delegate);
  end if;
  if p_supervisor is null or not exists (
    select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
  ) then
    perform app_private.fail('Choose an active supervisor.');
  end if;

  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, assisting_delegate_id = p_assisting_delegate,
      supervisor_id = p_supervisor, course_id = p_course, graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;

-- ── create_surgery_slot: 0091's body; refused in a clinic ──
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
  perform app_private.require_perm('schedule', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
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

-- ── update_surgery_slot: 0091's body; refused in a clinic ──
create or replace function public.update_surgery_slot(
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
  perform app_private.require_perm('schedule', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
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

-- ── place_implant_v4: 0115's body; the booking's doctor counts even if now inactive ──
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
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
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

-- ── correct_placement_v3: 0119's body; a delegate's implant in a clinic, a course-less one with a course organizer ──
create or replace function public.correct_placement_v3(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_course uuid, p_graft text, p_notes text, p_placing_doctor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_first date;
  v_lot public.stock_lots;
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has placement details to correct.');
  end if;

  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not v_teaching then
    -- Hidden in a clinic but kept: only the values already recorded are accepted.
    if (p_placing_delegate, p_assisting_delegate, p_supervisor, p_course)
       is distinct from (v_site.placing_delegate_id, v_site.assisting_delegate_id, v_site.supervisor_id, v_site.course_id) then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
  elsif p_course is null then
    -- An implant placed while the company was a clinic has no course: it may stay without one, by a doctor alone.
    if v_site.course_id is not null or coalesce(p_placing_delegate, p_assisting_delegate) is not null then
      perform app_private.fail('Choose the course.');
    end if;
  elsif not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  -- Components, restorations, X-rays, the scan, follow-ups, complications and the failure can't predate the placement.
  select min(d) into v_first from (
    select fitted_on as d from public.site_components where site_id = p_site and voided_at is null
    union all
    select date from public.implant_followups where site_id = p_site and voided_at is null
    union all
    select v_site.failed_on
    union all
    select noticed_on from public.implant_complications where site_id = p_site and voided_at is null
    union all
    select r.fitted_on from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
    where rs.site_id = p_site and r.voided_at is null
    union all
    select v_site.impression_taken_on
    union all
    select xr.taken_on from public.radiographs xr
    where xr.patient_id = v_site.patient_id and v_site.tooth = any (xr.teeth) and xr.voided_at is null
      and xr.purpose <> 'planning' and xr.taken_on >= v_site.placed_on
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, restoration, X-ray, scan, follow-up, complication or failure (%s).', v_first));
  end if;
  select * into v_lot from public.stock_lots where id = v_site.stock_lot_id;
  if v_lot.expiry is not null and v_lot.expiry < p_placed_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Correct the batch first.',
      coalesce(v_lot.lot_no, '(no number)'), v_lot.expiry, p_placed_on));
  end if;

  -- People: active, or the one already recorded (they may have become inactive since).
  if not v_teaching and v_site.placing_delegate_id is not null then
    -- A delegate placed it (before the switch): the doctor stays as recorded (none), as for bookings (0120).
    if p_placing_doctor is distinct from v_site.placing_doctor_id then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
  elsif not v_teaching then
    if p_placing_doctor is null or not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_site.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
  elsif p_placing_delegate is not null and p_placing_doctor is not null then
    perform app_private.fail('Choose a delegate or a doctor, not both.');
  elsif p_placing_doctor is not null then
    if not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_site.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
    if p_assisting_delegate is not null and not exists (
      select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
    ) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
    if (p_assisting_delegate, p_course) is distinct from (v_site.assisting_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_assisting_delegate);
    end if;
    if p_supervisor is not null and not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    -- A delegate: v2's rules.
    if p_placing_delegate is null or not exists (
      select 1 from public.delegates where id = p_placing_delegate and (active or id = v_site.placing_delegate_id)
    ) then
      perform app_private.fail('Choose the delegate who placed the implant.');
    end if;
    if p_assisting_delegate is not null then
      if p_assisting_delegate = p_placing_delegate then
        perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
      end if;
      if not exists (
        select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
      ) then
        perform app_private.fail('Choose an active assisting delegate.');
      end if;
    end if;
    -- Only what changes is checked, so another field can still be fixed on an older record.
    if (p_placing_delegate, p_course) is distinct from (v_site.placing_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_placing_delegate);
    end if;
    if (p_assisting_delegate, p_course) is distinct from (v_site.assisting_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_assisting_delegate);
    end if;
    if p_supervisor is null or not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  end if;

  -- In a clinic the people and course passed the check above, so these write back what was recorded.
  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, placing_doctor_id = p_placing_doctor,
      assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor, course_id = p_course,
      graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;

-- ── slot_conflicts_v2: 0116's body; the supervisor clash only with teaching on and a readable name ──
create or replace function public.slot_conflicts_v2(
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
  select 'supervisor', format('%s is already supervising %s (%s).', su.full_name, o.span, o.patient_name)
  from other o
  join public.supervisors su on su.id = p_supervisor
  where o.supervisor_id = p_supervisor and public.module_on('teaching')
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
