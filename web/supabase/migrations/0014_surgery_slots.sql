create type public.slot_status as enum ('scheduled', 'done', 'cancelled');

create table public.surgery_slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  chair_id uuid not null references public.chairs (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  patient_id uuid not null references public.patients (id) on delete cascade,
  supervisor_id uuid not null references public.profiles (user_id),
  status public.slot_status not null default 'scheduled',
  override_reason text not null default '' check (length(override_reason) <= 300),
  cancel_reason text not null default '' check (length(cancel_reason) <= 300),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint surgery_slots_times check (ends_at > starts_at)
);
create index surgery_slots_starts_idx on public.surgery_slots (starts_at);

create table public.slot_delegates (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.surgery_slots (id) on delete cascade,
  delegate_id uuid not null references public.delegates (id),
  role text not null check (role in ('placing', 'assisting')),
  unique (slot_id, delegate_id)
);

create table public.slot_planned_implants (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.surgery_slots (id) on delete cascade,
  tooth public.fdi_tooth not null,
  product_id uuid references public.products (id),
  implant_site_id uuid references public.implant_sites (id) on delete cascade,
  unique (slot_id, tooth)
);

alter table public.implant_sites
  add column course_id uuid references public.courses (id),
  add column session_id uuid references public.sessions (id),
  add column slot_id uuid references public.surgery_slots (id) on delete set null;

create trigger surgery_slots_set_updated_at before update on public.surgery_slots for each row execute function app_private.set_updated_at();
create trigger surgery_slots_audit after insert or update or delete on public.surgery_slots for each row execute function app_private.audit_row('id');
create trigger slot_delegates_audit after insert or update or delete on public.slot_delegates for each row execute function app_private.audit_row('id');
create trigger slot_planned_implants_audit after insert or update or delete on public.slot_planned_implants for each row execute function app_private.audit_row('id');

revoke all on public.surgery_slots, public.slot_delegates, public.slot_planned_implants from anon;
revoke insert, update, delete, truncate on public.surgery_slots, public.slot_delegates, public.slot_planned_implants from authenticated;
alter table public.surgery_slots enable row level security;
alter table public.slot_delegates enable row level security;
alter table public.slot_planned_implants enable row level security;
create policy surgery_slots_select on public.surgery_slots for select to authenticated using (public.is_active_user());
create policy slot_delegates_select on public.slot_delegates for select to authenticated using (public.is_active_user());
create policy slot_planned_implants_select on public.slot_planned_implants for select to authenticated using (public.is_active_user());

create function public.cairo_ts(p_date date, p_time time) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_date + p_time) at time zone 'Africa/Cairo';
$$;

create function public.slot_conflicts(
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
           (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.user_id = p_supervisor),
           span, patient_name)
  from other where supervisor_id = p_supervisor
  union all
  select 'delegate', format('%s is already booked %s (%s).', d.full_name, o.span, o.patient_name)
  from other o
  join public.slot_delegates sd on sd.slot_id = o.id
  join public.delegates d on d.id = sd.delegate_id
  where sd.delegate_id = any (p_delegates);
$$;

create function public.create_surgery_slot(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_implants jsonb default '[]',
  p_override_reason text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
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
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
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
  if exists (
    select 1 from public.slot_conflicts(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all)
  ) and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, trim(coalesce(p_override_reason, '')), coalesce(p_notes, ''))
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

create function public.cancel_surgery_slot(p_slot uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform app_private.fail('Explain why the surgery is cancelled (at least 3 characters).');
  end if;
  if not exists (select 1 from public.surgery_slots where id = p_slot and status = 'scheduled') then
    perform app_private.fail('Only scheduled surgeries can be cancelled.');
  end if;
  update public.surgery_slots set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_slot;
  update public.implant_sites set slot_id = null, session_id = null, course_id = null
  where slot_id = p_slot and state = 'planned';
end $$;

create function public.slots_on(p_date date) returns setof public.surgery_slots
language sql stable security invoker set search_path = '' as $$
  select * from public.surgery_slots
  where (starts_at at time zone 'Africa/Cairo')::date = p_date
  order by starts_at;
$$;

revoke execute on function public.cairo_ts(date, time) from public, anon;
revoke execute on function public.slot_conflicts(uuid, uuid, time, time, uuid, uuid, uuid[], uuid) from public, anon;
revoke execute on function public.create_surgery_slot(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text) from public, anon;
revoke execute on function public.cancel_surgery_slot(uuid, text) from public, anon;
revoke execute on function public.slots_on(date) from public, anon;
grant execute on function public.cairo_ts(date, time) to authenticated;
grant execute on function public.slot_conflicts(uuid, uuid, time, time, uuid, uuid, uuid[], uuid) to authenticated;
grant execute on function public.create_surgery_slot(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text) to authenticated;
grant execute on function public.cancel_surgery_slot(uuid, text) to authenticated;
grant execute on function public.slots_on(date) to authenticated;
