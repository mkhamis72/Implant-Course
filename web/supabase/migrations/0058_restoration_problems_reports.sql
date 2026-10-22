-- Research part 3: problems on a restoration (chipping, debonding, screw loosening …), the Restored state owned by
-- restorations in void_component / void_followup, the report readers, and the delete functions that must not
-- break on restorations.
create table public.restoration_problems (
  id uuid primary key default gen_random_uuid(),
  restoration_id uuid not null references public.restorations (id) on delete cascade,
  noticed_on date not null,
  type text not null check (type in ('chipping', 'fracture', 'debonding', 'screw_loosening', 'screw_fracture', 'wear', 'other')),
  action text not null check (action in ('recemented', 'retightened', 'repaired', 'none', 'other')),
  notes text not null default '' check (length(notes) <= 1000),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);
create index restoration_problems_restoration_idx on public.restoration_problems (restoration_id);

create trigger restoration_problems_set_updated_at before update on public.restoration_problems
  for each row execute function app_private.set_updated_at();
create trigger restoration_problems_audit after insert or update or delete on public.restoration_problems
  for each row execute function app_private.audit_row('id');

revoke all on public.restoration_problems from public, anon, authenticated;
grant select on public.restoration_problems to authenticated;
alter table public.restoration_problems enable row level security;
create policy restoration_problems_select on public.restoration_problems for select to authenticated
  using (public.is_active_user());
create policy restoration_problems_area_read on public.restoration_problems as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- Validates a problem against its (locked, non-voided) restoration.
create function app_private.check_restoration_problem(
  p_r public.restorations, p_noticed_on date, p_type text, p_action text, p_notes text
) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_type is null or p_type not in ('chipping', 'fracture', 'debonding', 'screw_loosening', 'screw_fracture', 'wear', 'other') then
    perform app_private.fail('Choose the problem type.');
  end if;
  if p_action is null or p_action not in ('recemented', 'retightened', 'repaired', 'none', 'other') then
    perform app_private.fail('Choose the action taken.');
  end if;
  if p_noticed_on is null or p_noticed_on < p_r.fitted_on
     or p_noticed_on > coalesce(p_r.ended_on, public.cairo_today()) then
    perform app_private.fail(format('The problem date must be between the fitting date and %s.',
      case when p_r.ended_on is null then 'today' else 'the date it ended' end));
  end if;
  if length(trim(coalesce(p_notes, ''))) > 1000 then
    perform app_private.fail('Keep the notes under 1000 characters.');
  end if;
end $$;
revoke execute on function app_private.check_restoration_problem(public.restorations, date, text, text, text) from public;

create function public.record_restoration_problem(
  p_restoration uuid, p_noticed_on date, p_type text, p_action text, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.restorations;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_r from public.restorations where id = p_restoration for share;
  if not found then perform app_private.fail('Restoration not found.'); end if;
  if v_r.voided_at is not null then
    perform app_private.fail('This restoration was removed from the record.');
  end if;
  perform app_private.check_restoration_problem(v_r, p_noticed_on, p_type, p_action, p_notes);
  insert into public.restoration_problems (restoration_id, noticed_on, type, action, notes)
  values (p_restoration, p_noticed_on, p_type, p_action, trim(coalesce(p_notes, '')))
  returning id into v_id;
  return v_id;
end $$;

create function public.update_restoration_problem(
  p_problem uuid, p_noticed_on date, p_type text, p_action text, p_notes text, p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.restoration_problems;
  v_r public.restorations;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_p from public.restoration_problems where id = p_problem and voided_at is null;
  if not found then perform app_private.fail('Problem not found.'); end if;
  -- Restoration before problem, the order record_restoration_problem and void_restoration take.
  select * into v_r from public.restorations where id = v_p.restoration_id for share;
  select * into v_p from public.restoration_problems where id = p_problem and voided_at is null for update;
  if not found then perform app_private.fail('Problem not found.'); end if;
  if p_expected_updated_at is null or v_p.updated_at <> p_expected_updated_at then
    perform app_private.fail('This problem was changed by someone else. Reload to see it.');
  end if;
  if v_r.voided_at is not null then
    perform app_private.fail('This restoration was removed from the record.');
  end if;
  perform app_private.check_restoration_problem(v_r, p_noticed_on, p_type, p_action, p_notes);
  update public.restoration_problems
  set noticed_on = p_noticed_on, type = p_type, action = p_action, notes = trim(coalesce(p_notes, ''))
  where id = p_problem;
end $$;

create function public.void_restoration_problem(p_problem uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this problem is being removed from the record.');
  end if;
  update public.restoration_problems
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_problem and voided_at is null;
  if not found then perform app_private.fail('Problem not found.'); end if;
end $$;

revoke execute on function public.record_restoration_problem(uuid, date, text, text, text) from public, anon;
grant execute on function public.record_restoration_problem(uuid, date, text, text, text) to authenticated;
revoke execute on function public.update_restoration_problem(uuid, date, text, text, text, timestamptz) from public, anon;
grant execute on function public.update_restoration_problem(uuid, date, text, text, text, timestamptz) to authenticated;
revoke execute on function public.void_restoration_problem(uuid, text) from public, anon;
grant execute on function public.void_restoration_problem(uuid, text) to authenticated;

-- void_component: latest 0030_permissions.sql:432. Undoing a final_restoration component no longer decides the
-- state itself: restorations do (app_private.sync_restored).
create or replace function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
  v_prev uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null or v_c.removed_on is not null then
    perform app_private.fail('Only the current component can be undone.');
  end if;
  select * into v_site from public.implant_sites where id = v_c.site_id for update;
  if v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be changed on a placed implant.');
  end if;
  if v_c.stock_lot_id is not null then
    v_use := app_private.unreversed_use(v_site.id, p_component, v_c.stock_lot_id);
    if v_use is not null then
      perform app_private.reverse_use(v_use, 'Undone: ' || trim(p_reason));
    end if;
  end if;
  update public.site_components
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason), removed_on = fitted_on
  where id = p_component;
  select id into v_prev from public.site_components
  where site_id = v_site.id and id <> p_component and voided_at is null
  order by fitted_on desc, created_at desc
  limit 1;
  if v_prev is not null then
    update public.site_components set removed_on = null where id = v_prev;
  end if;
  if v_c.component_type = 'final_restoration' then
    perform app_private.sync_restored(v_site.id);
  end if;
end $$;

-- void_followup: latest 0048_implant_failure.sql:188. Undoing a failure gives back Restored when the implant has
-- a current final restoration (no longer when it has a final_restoration component).
create or replace function public.void_followup(p_followup uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.implant_followups;
  v_site public.implant_sites;
  v_state public.site_state;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this follow-up');
  select * into v_f from public.implant_followups where id = p_followup and voided_at is null;
  if not found then
    perform app_private.fail('Follow-up not found.');
  end if;
  select * into v_site from public.implant_sites where id = v_f.site_id for update;
  update public.implant_followups
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_followup;

  if v_f.outcome = 'failed' and v_site.state = 'failed'
     and not exists (select 1 from public.implant_followups where site_id = v_site.id and outcome = 'failed' and voided_at is null) then
    if exists (
      select 1 from public.implant_sites
      where patient_id = v_site.patient_id and tooth = v_site.tooth and state not in ('failed', 'removed')
    ) then
      perform app_private.fail('A new implant is already recorded on this tooth, so the failure cannot be undone.');
    end if;
    v_state := case when exists (
      select 1 from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
      where rs.site_id = v_site.id and r.stage = 'final' and r.ended_on is null and r.voided_at is null
    ) then 'restored' else 'placed' end;
    update public.implant_sites
    set state = v_state, failed_on = null, failure_type = null, failure_reason = null, failure_notes = ''
    where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
      case when v_state = 'restored' then 'restored' else 'implant_placed' end::public.tooth_state);
  end if;
end $$;

-- delete_course: latest 0030_permissions.sql:955. A course a restoration was recorded in stays (its course is part
-- of the report), like one with placed implants.
create or replace function public.delete_course(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('courses', 'edit');
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
  if exists (select 1 from public.restorations where course_id = p_course) then
    perform app_private.fail('Restorations were recorded in this course, so it can''t be deleted.');
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

-- delete_delegate: latest 0037_remove_users_delegates.sql:42. A delegate who fitted a restoration has records.
-- (delete_patient needs no change: restorations and their problems go with the patient's implants, by cascade.)
create or replace function public.delete_delegate(p_delegate uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_login uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  perform 1 from public.delegates where id = p_delegate for update;
  if not found then
    perform app_private.fail('Delegate not found.');
  end if;
  if exists (select 1 from public.implant_sites where p_delegate in (placing_delegate_id, assisting_delegate_id))
     or exists (select 1 from public.site_components where fitted_by_delegate_id = p_delegate) then
    perform app_private.fail('This delegate has implant records and can''t be removed. Set them Inactive instead.');
  end if;
  if exists (select 1 from public.restorations where delegate_id = p_delegate) then
    perform app_private.fail('This delegate fitted restorations and can''t be removed. Set them Inactive instead.');
  end if;
  if exists (select 1 from public.slot_delegates where delegate_id = p_delegate) then
    perform app_private.fail('This delegate is on surgery bookings. Remove them from those bookings first, or set them Inactive.');
  end if;
  select user_id into v_login from public.profiles where delegate_id = p_delegate;
  if v_login is not null then
    if not public.is_admin() then
      perform app_private.fail('Only an admin can remove a delegate who has a login.');
    end if;
    -- Delegate logins only read (my_schedule / my_report), so they have no records of their own; checklist
    -- tasks assigned to them before 0037 were never valid and are unassigned.
    update public.checklist_items set assignee_id = null where assignee_id = v_login;
    delete from public.profiles where user_id = v_login;
  end if;
  delete from public.enrollments where delegate_id = p_delegate;
  delete from public.delegates where id = p_delegate;
  return v_login;
end $$;

-- Report readers. The course of a restoration is its course_id, otherwise the course whose dates contain the date
-- fitted and in which its delegate is enrolled. Undone (voided) restorations are left out.
create function public.course_restorations(p_course uuid)
returns table (
  restoration_id uuid, patient_name text, file_no text, teeth smallint[], stage text, type text, fitted_on date,
  delegate_id uuid, delegate text, supervisor text, ended_on date, end_kind text
)
language sql stable security invoker set search_path = '' as $$
  select r.id, p.full_name, p.file_no, r.teeth, r.stage, r.type, r.fitted_on,
         r.delegate_id, d.full_name, sv.full_name, r.ended_on, r.end_kind
  from public.courses c
  join public.restorations r on r.course_id = c.id
    or (r.course_id is null and r.fitted_on between c.start_date and c.end_date
        and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = r.delegate_id))
  join public.patients p on p.id = r.patient_id
  left join public.delegates d on d.id = r.delegate_id
  left join public.supervisors sv on sv.id = r.supervisor_id
  where c.id = p_course and r.voided_at is null
  order by r.fitted_on, p.file_no, r.teeth;
$$;

create function public.my_restorations()
returns table (
  restoration_id uuid, course_name text, patient_name text, file_no text, teeth smallint[], stage text, type text,
  fitted_on date, ended_on date
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select r.id, c.name, p.full_name, p.file_no, r.teeth, r.stage, r.type, r.fitted_on, r.ended_on
  from public.restorations r
  join public.patients p on p.id = r.patient_id
  left join lateral (
    select c.name, c.start_date from public.courses c
    where c.id = r.course_id
       or (r.course_id is null and r.fitted_on between c.start_date and c.end_date
           and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = r.delegate_id))
    order by c.start_date, c.id
    limit 1
  ) c on true
  where r.delegate_id = v_me and r.voided_at is null
  order by c.start_date nulls last, r.fitted_on, r.teeth;
end $$;

create function public.delegate_restorations(p_delegate uuid)
returns table (
  restoration_id uuid, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text,
  teeth smallint[], stage text, type text, fitted_on date, ended_on date
)
language sql stable security invoker set search_path = '' as $$
  select r.id, c.id, c.name, p.id, p.full_name, p.file_no, r.teeth, r.stage, r.type, r.fitted_on, r.ended_on
  from public.restorations r
  join public.patients p on p.id = r.patient_id
  left join lateral (
    select c.id, c.name, c.start_date from public.courses c
    where c.id = r.course_id
       or (r.course_id is null and r.fitted_on between c.start_date and c.end_date
           and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = r.delegate_id))
    order by c.start_date, c.id
    limit 1
  ) c on true
  where r.delegate_id = p_delegate and r.voided_at is null
  order by c.start_date nulls last, r.fitted_on, r.teeth;
$$;

revoke execute on function public.course_restorations(uuid) from public, anon;
grant execute on function public.course_restorations(uuid) to authenticated;
revoke execute on function public.my_restorations() from public, anon;
grant execute on function public.my_restorations() to authenticated;
revoke execute on function public.delegate_restorations(uuid) from public, anon;
grant execute on function public.delegate_restorations(uuid) to authenticated;

-- History tab and the audit-log read rule cover restoration problems (latest definitions: 0057).
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications',
                          'restoration_sites')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
     or (a.table_name = 'restoration_problems'
         and coalesce(a.after ->> 'restoration_id', a.before ->> 'restoration_id') in
             (select r.id::text from public.restorations r where r.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems'))
  );
