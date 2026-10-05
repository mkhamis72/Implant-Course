-- Lectures and workshops: an admin-maintained list of lecturers, a room on sessions,
-- and talks (time, lecturer, topic) inside lecture and workshop sessions.

create table public.lecturers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lecturers_set_updated_at before update on public.lecturers
  for each row execute function app_private.set_updated_at();
create trigger lecturers_audit after insert or update or delete on public.lecturers
  for each row execute function app_private.audit_row('id');

revoke all on public.lecturers from public, anon, authenticated;
grant select on public.lecturers to authenticated;
grant insert (full_name, active) on public.lecturers to authenticated;
grant update (full_name, active) on public.lecturers to authenticated;
alter table public.lecturers enable row level security;
create policy lecturers_select on public.lecturers for select to authenticated using (public.is_active_user());
create policy lecturers_insert on public.lecturers for insert to authenticated with check (public.is_admin());
create policy lecturers_update on public.lecturers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.sessions add column room text
  constraint sessions_room_check check (room is null or length(trim(room)) between 1 and 120);
grant insert (room) on public.sessions to authenticated;
grant update (room) on public.sessions to authenticated;

create table public.talks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lecturer_id uuid not null constraint talks_lecturer_id_fkey references public.lecturers (id),
  topic text not null check (length(trim(topic)) between 2 and 200),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint talks_times check (ends_at > starts_at)
);
create index talks_session_idx on public.talks (session_id);
create index talks_starts_at_idx on public.talks (starts_at);
create index talks_lecturer_idx on public.talks (lecturer_id);
create trigger talks_set_updated_at before update on public.talks
  for each row execute function app_private.set_updated_at();
create trigger talks_audit after insert or update or delete on public.talks
  for each row execute function app_private.audit_row('id');

revoke all on public.talks from public, anon, authenticated;
grant select on public.talks to authenticated;
alter table public.talks enable row level security;
create policy talks_select on public.talks for select to authenticated using (public.is_active_user());

-- Shared checks for create/update: times, topic, then clashes under a per-day lock.
create function app_private.check_talk(
  p_session public.sessions, p_start time, p_end time, p_lecturer uuid, p_topic text, p_exclude uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := public.cairo_ts(p_session.date, p_start);
  v_end timestamptz := public.cairo_ts(p_session.date, p_end);
  v_clash record;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('End time must be after the start time.');
  end if;
  if p_start < p_session.start_time or p_end > p_session.end_time then
    perform app_private.fail(format('The talk must fit within the session (%s–%s).',
      left(p_session.start_time::text, 5), left(p_session.end_time::text, 5)));
  end if;
  if length(trim(coalesce(p_topic, ''))) < 2 then
    perform app_private.fail('Enter a topic.');
  end if;

  perform pg_advisory_xact_lock(hashtext('talk-day:' || p_session.date::text));

  select t.starts_at, t.ends_at, t.topic into v_clash
  from public.talks t
  where t.session_id = p_session.id
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('Another talk in this session overlaps (%s–%s, %s).',
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI'), v_clash.topic));
  end if;

  select t.starts_at, t.ends_at, l.full_name as lecturer into v_clash
  from public.talks t join public.lecturers l on l.id = t.lecturer_id
  where t.lecturer_id = p_lecturer
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('%s is already giving a talk at %s–%s.', v_clash.lecturer,
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI')));
  end if;
end $$;

create function public.create_talk(
  p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_session from public.sessions where id = p_session;
  if not found or v_session.type not in ('lecture', 'workshop') then
    perform app_private.fail('Choose a lecture or workshop session.');
  end if;
  if not exists (select 1 from public.lecturers where id = p_lecturer and active) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, null);
  insert into public.talks (session_id, starts_at, ends_at, lecturer_id, topic, notes)
  values (p_session, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_lecturer, trim(p_topic), trim(coalesce(p_notes, '')))
  returning id into v_id;
  return v_id;
end $$;

-- The session stays fixed; an inactive lecturer is kept if already on the talk.
create function public.update_talk(
  p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_talk public.talks;
  v_session public.sessions;
begin
  perform app_private.require_active();
  select * into v_talk from public.talks where id = p_talk for update;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
  select * into v_session from public.sessions where id = v_talk.session_id;
  if not exists (select 1 from public.lecturers where id = p_lecturer and (active or id = v_talk.lecturer_id)) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, p_talk);
  update public.talks
  set starts_at = public.cairo_ts(v_session.date, p_start), ends_at = public.cairo_ts(v_session.date, p_end),
      lecturer_id = p_lecturer, topic = trim(p_topic), notes = trim(coalesce(p_notes, ''))
  where id = p_talk;
end $$;

create function public.delete_talk(p_talk uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  delete from public.talks where id = p_talk;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
end $$;

revoke execute on function app_private.check_talk(public.sessions, time, time, uuid, text, uuid) from public, anon;
revoke execute on function public.create_talk(uuid, time, time, uuid, text, text) from public, anon;
revoke execute on function public.update_talk(uuid, time, time, uuid, text, text) from public, anon;
revoke execute on function public.delete_talk(uuid) from public, anon;
grant execute on function public.create_talk(uuid, time, time, uuid, text, text) to authenticated;
grant execute on function public.update_talk(uuid, time, time, uuid, text, text) to authenticated;
grant execute on function public.delete_talk(uuid) to authenticated;
