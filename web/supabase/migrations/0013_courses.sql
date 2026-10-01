create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  start_date date not null,
  end_date date not null,
  venue text not null default '' check (length(venue) <= 200),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint courses_dates check (end_date >= start_date)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  delegate_id uuid not null references public.delegates (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (course_id, delegate_id)
);

create type public.session_type as enum ('lecture', 'workshop', 'surgery');

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  type public.session_type not null,
  title text not null check (length(trim(title)) between 2 and 120),
  date date not null,
  start_time time not null,
  end_time time not null,
  lead_organizer_id uuid references public.profiles (user_id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint sessions_times check (end_time > start_time)
);
create index sessions_date_idx on public.sessions (date);

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function app_private.check_session_in_course() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id and new.date between c.start_date and c.end_date
  ) then
    perform app_private.fail('The session date must fall within the course dates.');
  end if;
  return new;
end $$;

create trigger sessions_in_course before insert or update on public.sessions
  for each row execute function app_private.check_session_in_course();

create trigger courses_set_updated_at before update on public.courses for each row execute function app_private.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions for each row execute function app_private.set_updated_at();
create trigger chairs_set_updated_at before update on public.chairs for each row execute function app_private.set_updated_at();
create trigger courses_audit after insert or update or delete on public.courses for each row execute function app_private.audit_row('id');
create trigger enrollments_audit after insert or update or delete on public.enrollments for each row execute function app_private.audit_row('id');
create trigger sessions_audit after insert or update or delete on public.sessions for each row execute function app_private.audit_row('id');
create trigger chairs_audit after insert or update or delete on public.chairs for each row execute function app_private.audit_row('id');

revoke all on public.courses, public.enrollments, public.sessions, public.chairs from anon;
revoke insert, update, delete, truncate on public.courses, public.enrollments, public.sessions, public.chairs from authenticated;
grant insert (name, start_date, end_date, venue, notes) on public.courses to authenticated;
grant update (name, start_date, end_date, venue, notes) on public.courses to authenticated;
grant insert (course_id, delegate_id) on public.enrollments to authenticated;
grant delete on public.enrollments to authenticated;
grant insert (course_id, type, title, date, start_time, end_time, lead_organizer_id) on public.sessions to authenticated;
grant update (type, title, date, start_time, end_time, lead_organizer_id) on public.sessions to authenticated;
grant insert (name, active) on public.chairs to authenticated;
grant update (name, active) on public.chairs to authenticated;

alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.sessions enable row level security;
alter table public.chairs enable row level security;

create policy courses_select on public.courses for select to authenticated using (public.is_active_user());
create policy courses_insert on public.courses for insert to authenticated with check (public.is_active_user());
create policy courses_update on public.courses for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy enrollments_select on public.enrollments for select to authenticated using (public.is_active_user());
create policy enrollments_insert on public.enrollments for insert to authenticated with check (public.is_active_user());
create policy enrollments_delete on public.enrollments for delete to authenticated using (public.is_active_user());
create policy sessions_select on public.sessions for select to authenticated using (public.is_active_user());
create policy sessions_insert on public.sessions for insert to authenticated with check (public.is_active_user());
create policy sessions_update on public.sessions for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy chairs_select on public.chairs for select to authenticated using (public.is_active_user());
create policy chairs_insert on public.chairs for insert to authenticated with check (public.is_admin());
create policy chairs_update on public.chairs for update to authenticated using (public.is_admin()) with check (public.is_admin());
