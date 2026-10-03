-- Supervisors: a list of names maintained by admins, independent of user accounts.
-- Existing accounts are copied in with their own ids, so existing supervisor_id values stay valid.

create table public.supervisors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger supervisors_set_updated_at before update on public.supervisors
  for each row execute function app_private.set_updated_at();
create trigger supervisors_audit after insert or update or delete on public.supervisors
  for each row execute function app_private.audit_row('id');

revoke all on public.supervisors from public, anon, authenticated;
grant select on public.supervisors to authenticated;
grant insert (full_name, active) on public.supervisors to authenticated;
grant update (full_name, active) on public.supervisors to authenticated;
alter table public.supervisors enable row level security;
create policy supervisors_select on public.supervisors for select to authenticated using (public.is_active_user());
create policy supervisors_insert on public.supervisors for insert to authenticated with check (public.is_admin());
create policy supervisors_update on public.supervisors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.supervisors (id, full_name, active)
select user_id,
       left(case when length(trim(coalesce(full_name, ''))) >= 2 then trim(full_name) else email end, 120),
       active
from public.profiles;

-- Release 1 keeps the FKs to profiles (the previous app version embeds through them); 0025 drops them.
alter table public.surgery_slots
  add constraint surgery_slots_supervisor_ref_fkey foreign key (supervisor_id) references public.supervisors (id);
alter table public.implant_sites
  add constraint implant_sites_supervisor_ref_fkey foreign key (supervisor_id) references public.supervisors (id);

-- Clash message names the supervisor from the list (latest: 0014).
create or replace function public.slot_conflicts(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_delegates uuid[], p_exclude uuid default null
) returns table (kind text, message text)
language sql stable security invoker set search_path = '' as $$
  with me as (
    select public.cairo_ts(s.date, p_start) as s_at, public.cairo_ts(s.date, p_end) as e_at
    from public.sessions s where s.id = p_session
  ),
  other as (
    select o.id, o.chair_id, o.patient_id, o.supervisor_id, c.name as chair_name, p.full_name as patient_name,
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
  select 'delegate', format('%s is already booked %s (%s).', d.full_name, o.span, o.patient_name)
  from other o
  join public.slot_delegates sd on sd.slot_id = o.id
  join public.delegates d on d.id = sd.delegate_id
  where sd.delegate_id = any (p_delegates);
$$;

-- Recall: the supervisor's name comes from the list (latest: 0020).
create or replace function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         case when m.site_component_id is null then d.full_name
              else coalesce(fd.full_name, nullif(fo.full_name, ''), fo.email) end,
         su.full_name
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.supervisors su on su.id = s.supervisor_id
  left join public.delegates fd on fd.id = sc.fitted_by_delegate_id
  left join public.profiles fo on fo.user_id = sc.fitted_by_organizer_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by 2 desc, p.full_name;
$$;

-- Booking and placement validate the supervisor against the list (latest: 0021 and 0020).

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
          product_id = coalesce(v_product, product_id)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, p_session, v_slot)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null
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
        course_id = coalesce(v_course, course_id)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, v_course
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
