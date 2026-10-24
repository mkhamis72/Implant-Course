-- Research part 8b: studies and ethics approvals. Additive.
-- 1. The research area gets an Edit level (0069 allowed View only): the check constraint goes and
--    set_user_permissions (latest body: 0069) stops refusing it. default_permissions() (0034) is unchanged, so new
--    organizers still get None; admins pass can() and so always have Edit.
-- 2. studies (a label for exports: title, committee, approval, protocol, notes, approval letter in 8a's stored_files)
--    and study_courses (the courses covered: descriptive, nothing enforces it). Written only through the definer
--    functions below (Research Edit; delete is admin only); read under RLS with Research view and Patients view.
-- 3. research_exports.study_id, set by log_research_export (same signature as 0070) from p_filters->>'study'.

-- ── 1. Research Edit ─────────────────────────────────────────────────────────────────────────
alter table public.user_permissions drop constraint user_permissions_research_view_only;

create or replace function public.set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_level text;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change permissions.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You cannot change your own permissions.');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user and role = 'organizer') then
    perform app_private.fail('Permissions apply to organizers only.');
  end if;
  for v_key, v_level in select key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb)) loop
    if v_key not in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates', 'research') then
      perform app_private.fail(format('Unknown area: %s.', v_key));
    end if;
    if v_level is not null and v_level not in ('view', 'edit') then
      perform app_private.fail(format('Unknown level: %s.', v_level));
    end if;
  end loop;
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, area, level)
  select p_user, key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb))
  where value #>> '{}' is not null;
end $$;

-- ── 2. Studies ───────────────────────────────────────────────────────────────────────────────
-- Optional text fields are null when empty (the functions trim and store null for blank input).
create table public.studies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200 and title = trim(title)),
  committee text check (length(committee) between 1 and 200),
  approval_number text check (length(approval_number) between 1 and 100),
  approval_date date,
  protocol_name text check (length(protocol_name) between 1 and 200),
  protocol_version text check (length(protocol_version) between 1 and 50),
  protocol_date date,
  notes text check (length(notes) between 1 and 2000),
  letter_file_id uuid unique references public.stored_files (id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);

create table public.study_courses (
  study_id uuid not null references public.studies (id) on delete cascade,
  -- Descriptive only: deleting a course (delete_course) just drops it from the list.
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (study_id, course_id)
);
create index study_courses_course_idx on public.study_courses (course_id);

create trigger studies_set_updated_at before update on public.studies
  for each row execute function app_private.set_updated_at();
create trigger studies_audit after insert or update or delete on public.studies
  for each row execute function app_private.audit_row('id');
create trigger study_courses_audit after insert or update or delete on public.study_courses
  for each row execute function app_private.audit_row('study_id');

revoke all on public.studies, public.study_courses from public, anon, authenticated;
grant select on public.studies, public.study_courses to authenticated;
alter table public.studies enable row level security;
alter table public.study_courses enable row level security;

create policy studies_select on public.studies for select to authenticated
  using (public.is_active_user());
create policy studies_area_read on public.studies as restrictive for select to authenticated
  using ((select public.can('research', 'view')) and (select public.can('patients', 'view')));
create policy study_courses_select on public.study_courses for select to authenticated
  using (public.is_active_user());
create policy study_courses_area_read on public.study_courses as restrictive for select to authenticated
  using ((select public.can('research', 'view')) and (select public.can('patients', 'view')));

-- Export log: which study an export was made for (null = none). delete_study refuses a referenced study.
alter table public.research_exports add column study_id uuid references public.studies (id);
create index research_exports_study_idx on public.research_exports (study_id);

-- Adds (p_id null) or edits a study and replaces its course set (null = no courses).
create function public.save_study(
  p_id uuid, p_title text, p_committee text, p_approval_number text, p_approval_date date, p_protocol_name text,
  p_protocol_version text, p_protocol_date date, p_notes text, p_courses uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_committee text := nullif(trim(coalesce(p_committee, '')), '');
  v_approval_number text := nullif(trim(coalesce(p_approval_number, '')), '');
  v_protocol_name text := nullif(trim(coalesce(p_protocol_name, '')), '');
  v_protocol_version text := nullif(trim(coalesce(p_protocol_version, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_courses uuid[] := coalesce((select array_agg(distinct x) from unnest(p_courses) x where x is not null), '{}');
  v_id uuid;
begin
  perform app_private.require_perm('research', 'edit');

  if p_id is not null then
    perform 1 from public.studies where id = p_id for update;
    if not found then perform app_private.fail('Study not found.'); end if;
  end if;
  if length(v_title) = 0 then
    perform app_private.fail('Enter the study title.');
  end if;
  if length(v_title) > 200 then
    perform app_private.fail('Keep the title under 200 characters.');
  end if;
  if length(v_committee) > 200 or length(v_protocol_name) > 200 then
    perform app_private.fail('Keep the committee and protocol name under 200 characters.');
  end if;
  if length(v_approval_number) > 100 then
    perform app_private.fail('Keep the approval number under 100 characters.');
  end if;
  if length(v_protocol_version) > 50 then
    perform app_private.fail('Keep the protocol version under 50 characters.');
  end if;
  if length(v_notes) > 2000 then
    perform app_private.fail('Keep the notes under 2000 characters.');
  end if;
  if p_approval_date > public.cairo_today() then
    perform app_private.fail('The approval date can''t be in the future.');
  end if;
  if exists (select 1 from unnest(v_courses) x where not exists (select 1 from public.courses c where c.id = x)) then
    perform app_private.fail('Course not found.');
  end if;

  if p_id is null then
    insert into public.studies (title, committee, approval_number, approval_date, protocol_name, protocol_version,
                                protocol_date, notes)
    values (v_title, v_committee, v_approval_number, p_approval_date, v_protocol_name, v_protocol_version,
            p_protocol_date, v_notes)
    returning id into v_id;
  else
    v_id := p_id;
    update public.studies
    set title = v_title, committee = v_committee, approval_number = v_approval_number, approval_date = p_approval_date,
        protocol_name = v_protocol_name, protocol_version = v_protocol_version, protocol_date = p_protocol_date,
        notes = v_notes
    where id = v_id
      and (title, committee, approval_number, approval_date, protocol_name, protocol_version, protocol_date, notes)
          is distinct from
          (v_title, v_committee, v_approval_number, p_approval_date, v_protocol_name, v_protocol_version,
           p_protocol_date, v_notes);
  end if;

  -- Only the changes, so an unchanged course list adds no History rows.
  delete from public.study_courses where study_id = v_id and course_id <> all (v_courses);
  insert into public.study_courses (study_id, course_id)
  select v_id, x from unnest(v_courses) x
  on conflict do nothing;
  return v_id;
end $$;

-- Sets or replaces the approval letter (8a's file rules: JPEG or PDF, 1 byte to 2 MB). A replaced file is deleted.
create function public.set_study_letter(p_study uuid, p_file bytea, p_content_type text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
  v_file uuid;
begin
  perform app_private.require_perm('research', 'edit');
  select letter_file_id into v_old from public.studies where id = p_study for update;
  if not found then perform app_private.fail('Study not found.'); end if;
  if p_file is null or octet_length(p_file) = 0 then
    perform app_private.fail('Upload the approval letter.');
  end if;
  if octet_length(p_file) > 2097152 then
    perform app_private.fail('The file is too large: 2 MB at most.');
  end if;
  if p_content_type is null
     or not ((p_content_type = 'image/jpeg' and substring(p_file from 1 for 3) = '\xffd8ff'::bytea)
             or (p_content_type = 'application/pdf' and substring(p_file from 1 for 5) = '\x255044462d'::bytea)) then
    perform app_private.fail('Upload a JPEG image or a PDF.');
  end if;

  insert into public.stored_files (bytes, content_type) values (p_file, p_content_type) returning id into v_file;
  update public.studies set letter_file_id = v_file where id = p_study;
  if v_old is not null then
    delete from public.stored_files where id = v_old;
  end if;
end $$;

create function public.clear_study_letter(p_study uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
begin
  perform app_private.require_perm('research', 'edit');
  select letter_file_id into v_old from public.studies where id = p_study for update;
  if not found then perform app_private.fail('Study not found.'); end if;
  if v_old is not null then
    update public.studies set letter_file_id = null where id = p_study;
    delete from public.stored_files where id = v_old;
  end if;
end $$;

-- Admin only; refused once an export names the study. Its course links and letter go with it.
create function public.delete_study(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file uuid;
begin
  perform app_private.require_perm('research', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can delete a study.');
  end if;
  select letter_file_id into v_file from public.studies where id = p_id for update;
  if not found then perform app_private.fail('Study not found.'); end if;
  if exists (select 1 from public.research_exports where study_id = p_id) then
    perform app_private.fail('This study is named on an export and can''t be deleted.');
  end if;
  delete from public.studies where id = p_id;
  if v_file is not null then
    delete from public.stored_files where id = v_file;
  end if;
end $$;

revoke execute on function public.save_study(uuid, text, text, text, date, text, text, date, text, uuid[]) from public, anon;
grant execute on function public.save_study(uuid, text, text, text, date, text, text, date, text, uuid[]) to authenticated;
revoke execute on function public.set_study_letter(uuid, bytea, text), public.clear_study_letter(uuid),
  public.delete_study(uuid) from public, anon;
grant execute on function public.set_study_letter(uuid, bytea, text), public.clear_study_letter(uuid),
  public.delete_study(uuid) to authenticated;

-- Every study, newest first, with its courses (jsonb array of {id, name, start_date}, by start date), whether it has a
-- letter, and whether an export names it (research_exports is admin-read, so this is false for everyone else).
-- Invoker: studies obey RLS; the course names come from course_options() (definer, View on Patients), since the
-- courses table needs Courses or Schedule view. Empty without Research view and Patients view.
create function public.studies_list()
returns table (id uuid, title text, committee text, approval_number text, approval_date date, protocol_name text,
               protocol_version text, protocol_date date, notes text, has_letter boolean, on_export boolean,
               courses jsonb, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not (public.can('research', 'view') and public.can('patients', 'view')) then
    return;
  end if;
  return query
  with co as (select * from public.course_options())
  select s.id, s.title, s.committee, s.approval_number, s.approval_date, s.protocol_name, s.protocol_version,
         s.protocol_date, s.notes, s.letter_file_id is not null,
         exists (select 1 from public.research_exports e where e.study_id = s.id),
         coalesce((select jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name, 'start_date', co.start_date)
                                    order by co.start_date, co.name, co.id)
                   from public.study_courses sc join co on co.id = sc.course_id
                   where sc.study_id = s.id), '[]'::jsonb),
         s.created_at, s.updated_at
  from public.studies s
  order by s.created_at desc, s.id;
end $$;

-- A study's approval letter; no row without Research view and Patients view, or when it has none.
-- Definer because stored_files is closed to every role; the area checks are explicit.
create function public.study_letter(p_study uuid)
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select f.bytes, f.content_type
  from public.studies s
  join public.stored_files f on f.id = s.letter_file_id
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
    and s.id = p_study;
$$;

revoke execute on function public.studies_list(), public.study_letter(uuid) from public, anon;
grant execute on function public.studies_list(), public.study_letter(uuid) to authenticated;

-- ── 3. Export study link ─────────────────────────────────────────────────────────────────────
-- Same signature and checks as 0070. p_filters->>'study' (absent, null or empty = none) must name an existing study;
-- it is stored in study_id as well as in filters. The study is a label only: it doesn't change the export.
create or replace function public.log_research_export(p_format text, p_filters jsonb, p_row_counts jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_study_text text := nullif(trim(coalesce(p_filters ->> 'study', '')), '');
  v_study uuid;
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') then
    perform app_private.fail('Unknown export format.');
  end if;
  if v_study_text is not null then
    if v_study_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app_private.fail('Study not found.');
    end if;
    v_study := v_study_text::uuid;
    if not exists (select 1 from public.studies where id = v_study) then
      perform app_private.fail('Study not found.');
    end if;
  end if;
  insert into public.research_exports (exported_by, format, filters, row_counts, study_id)
  values (auth.uid(), p_format, coalesce(p_filters, '{}'::jsonb), coalesce(p_row_counts, '{}'::jsonb), v_study)
  returning id into v_id;
  return v_id;
end $$;
