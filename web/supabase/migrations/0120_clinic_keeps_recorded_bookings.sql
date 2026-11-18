-- Modules release 3: like 0119 for placements, a clinic editing a booking made before the company became a
-- clinic keeps its supervisor and delegates (hidden but kept). 0116's update_surgery_slot_v2 refused any of them
-- in a clinic, so the app had to send none and an edit erased them. Now, in a clinic:
--   * the supervisor must be the recorded one (clearing it is a change, and refused);
--   * empty p_placing / p_assisting mean "keep what is recorded" (a clinic can't read slot_delegates); non-empty
--     ones must be the recorded ones;
--   * a doctor is required only when no delegate is recorded as placing; with one, the booking takes no doctor.
-- slot_delegates are rewritten only while teaching is on. A course organizer's behaviour is unchanged.
-- Same signature, so owner and grants stay.
set local lock_timeout = '5s';

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
  v_rec_placing uuid[];
  v_rec_assisting uuid[];
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

  if v_teaching then
    delete from public.slot_delegates where slot_id = p_slot;
    insert into public.slot_delegates (slot_id, delegate_id, role)
    select p_slot, x, 'placing' from unnest(v_placing) x
    union all
    select p_slot, x, 'assisting' from unnest(v_assisting) x;
  end if;
end $$;
