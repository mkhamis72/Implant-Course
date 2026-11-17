-- Modules, release 3: in a Clinic (company kind 'clinic', module_on('teaching') false) the teaching data is
-- closed. Courses, delegates, enrolments, lecturers, supervisors, talks, booking delegates and study courses read
-- as empty (restrictive policies; the rows stay and come back when the company is a Course organizer again);
-- sessions stay readable (clinic days). The delegate portal returns nothing, delegate logins are refused, the
-- teaching writes say so, and the console may now choose the Clinic type (console_save_plan,
-- console_set_company_plan without the "come in a later release" refusals).
-- Functions are recreated from their latest definitions with the same signatures (grants kept):
-- my_schedule (0030), my_report (0111), my_restorations (0058), course_options (0061), patient_course_options
-- (0072), create_talk / update_talk / delete_talk (0030), delete_course (0058), delete_delegate (0092),
-- create_pending_login (0094), add_existing_member (0088), set_member_role (0087), fit_component_v2,
-- save_study (0073), console_save_plan (0111), console_set_company_plan (0110).
set local lock_timeout = '5s';

-- ── Reads: the eight teaching tables close in a clinic ──────────────────────────────────────────────
create policy courses_module_read on public.courses as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy delegates_module_read on public.delegates as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy enrollments_module_read on public.enrollments as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy lecturers_module_read on public.lecturers as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy supervisors_module_read on public.supervisors as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy talks_module_read on public.talks as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy slot_delegates_module_read on public.slot_delegates as restrictive for select to authenticated
  using ((select public.module_on('teaching')));
create policy study_courses_module_read on public.study_courses as restrictive for select to authenticated
  using ((select public.module_on('teaching')));

-- Lecturers and supervisors are written directly by admins (is_admin() only, no area): close their writes too.
-- The other tables' writes already need can('courses'|'delegates') (off in a clinic) or go through functions.
create policy lecturers_module_insert on public.lecturers as restrictive for insert to authenticated
  with check ((select public.module_on('teaching')));
create policy lecturers_module_update on public.lecturers as restrictive for update to authenticated
  using ((select public.module_on('teaching'))) with check ((select public.module_on('teaching')));
create policy supervisors_module_insert on public.supervisors as restrictive for insert to authenticated
  with check ((select public.module_on('teaching')));
create policy supervisors_module_update on public.supervisors as restrictive for update to authenticated
  using ((select public.module_on('teaching'))) with check ((select public.module_on('teaching')));

-- ── Delegate portal: nothing in a clinic ────────────────────────────────────────────────────────────
create or replace function public.my_schedule(p_from date, p_to date)
returns table (kind text, starts_at timestamptz, ends_at timestamptz, title text, course text, place text, lead text,
               my_role text, patient_name text, file_no text, teeth text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  if not public.module_on('teaching') then
    return;
  end if;
  return query
  select 'surgery'::text, o.starts_at, o.ends_at, se.title, c.name, ch.name, sv.full_name, sd.role::text,
         p.full_name, p.file_no,
         (select string_agg(spi.tooth::text, ', ' order by spi.tooth)
          from public.slot_planned_implants spi where spi.slot_id = o.id)
  from public.surgery_slots o
  join public.slot_delegates sd on sd.slot_id = o.id and sd.delegate_id = v_me
  join public.sessions se on se.id = o.session_id
  join public.courses c on c.id = se.course_id
  join public.chairs ch on ch.id = o.chair_id
  join public.patients p on p.id = o.patient_id
  left join public.supervisors sv on sv.id = o.supervisor_id
  where o.status <> 'cancelled' and se.date between p_from and p_to
  union all
  select se.type::text, t.starts_at, t.ends_at, t.topic, c.name, se.room, l.full_name,
         null::text, null::text, null::text, null::text
  from public.talks t
  join public.sessions se on se.id = t.session_id
  join public.courses c on c.id = se.course_id
  join public.lecturers l on l.id = t.lecturer_id
  where se.date between p_from and p_to
    and exists (select 1 from public.enrollments e where e.course_id = se.course_id and e.delegate_id = v_me)
  order by 2;
end $$;

create or replace function public.my_report()
returns table (site_id uuid, role text, course_name text, patient_name text, file_no text, tooth smallint,
               state public.site_state, placed_on date, brand text, system text, platform text, diameter_mm numeric,
               length_mm numeric, description text, lot_no text, last_outcome public.followup_outcome, technique text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  if not public.module_on('teaching') then
    return;
  end if;
  return query
  select s.id, case when s.placing_delegate_id = v_me then 'placing' else 'assisting' end,
         c.name, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         case when public.module_on('inventory') then l.lot_no end,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null and f.outcome is not null order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = v_me or s.assisting_delegate_id = v_me)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
end $$;

create or replace function public.my_restorations()
returns table (restoration_id uuid, course_name text, patient_name text, file_no text, teeth smallint[], stage text,
               type text, fitted_on date, ended_on date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  if not public.module_on('teaching') then
    return;
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

-- ── Course pickers: empty in a clinic ───────────────────────────────────────────────────────────────
create or replace function public.course_options()
returns table (id uuid, name text, start_date date, end_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'view');
  if not public.module_on('teaching') then
    return;
  end if;
  return query
  select c.id, c.name, c.start_date, c.end_date from public.courses c
  order by c.start_date desc, c.id;
end $$;

create or replace function public.patient_course_options(p_patient uuid)
returns table (id uuid, name text, start_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'view');
  if not public.module_on('teaching') then
    return;
  end if;
  return query
  select c.id, c.name, c.start_date from public.courses c
  where c.id in (
    select s.course_id from public.surgery_slots w join public.sessions s on s.id = w.session_id
    where w.patient_id = p_patient and w.status <> 'cancelled'
    union
    select i.course_id from public.implant_sites i where i.patient_id = p_patient and i.course_id is not null
  )
  order by c.start_date desc, c.id;
end $$;

-- ── Talks, courses and delegates: refused in a clinic ───────────────────────────────────────────────
create or replace function public.create_talk(
  p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_id uuid;
begin
  perform app_private.require_perm('schedule', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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

create or replace function public.update_talk(
  p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_talk public.talks;
  v_session public.sessions;
begin
  perform app_private.require_perm('schedule', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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

create or replace function public.delete_talk(p_talk uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('schedule', 'edit');
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  delete from public.talks where id = p_talk;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
end $$;

-- require_perm('courses' | 'delegates') is off in a clinic too; the plan message comes first so the user
-- learns why (after require_active, so only signed-in staff see it).
create or replace function public.delete_course(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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

create or replace function public.delete_delegate(p_delegate uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_login uuid;
begin
  perform app_private.require_active();
  if not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  perform app_private.require_perm('delegates', 'edit');
  v_company := app.current_company_id();
  perform 1 from public.delegates where id = p_delegate and company_id = v_company for update;
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
  select m.user_id into v_login from public.company_members m
  where m.company_id = v_company and m.delegate_id = p_delegate for update;
  if v_login is not null then
    perform app_private.admin_company('Only an admin can remove a delegate who has a login.', false);
    -- Delegate logins only read (my_schedule / my_report), so they have no records of their own; checklist
    -- tasks assigned to them before 0037 were never valid and are unassigned.
    update public.checklist_items set assignee_id = null where company_id = v_company and assignee_id = v_login;
    if app.member_elsewhere(v_login, v_company) then
      delete from public.user_permissions where company_id = v_company and user_id = v_login;
      delete from public.company_members where company_id = v_company and user_id = v_login;
    else
      delete from public.profiles where user_id = v_login;
    end if;
  end if;
  delete from app_private.pending_logins where company_id = v_company and delegate_id = p_delegate;
  delete from public.enrollments where delegate_id = p_delegate;
  delete from public.delegates where id = p_delegate;
  return v_login;
end $$;

-- ── Components: no delegate or course in a clinic ───────────────────────────────────────────────────
create or replace function public.fit_component_v2(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid, p_by_delegate uuid,
  p_by_organizer uuid, p_notes text, p_course uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
  v_stock boolean := public.module_on('inventory');
begin
  perform app_private.require_perm('patients', 'edit');
  if (p_by_delegate is not null or p_course is not null) and not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > public.cairo_today() then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  perform app_private.check_enrolled(p_course, p_by_delegate);
  if p_by_organizer is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_site.company_id and m.user_id = p_by_organizer
      and m.active and m.role in ('admin', 'organizer')
  ) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if v_stock then
      if p_lot is null then
        perform app_private.fail('Choose the stock batch used.');
      end if;
      perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
    end if;
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id
  ) values (
    v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course
  ) returning id into v_id;

  if p_product is not null and v_stock then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

-- ── Studies: no course links in a clinic; the hidden ones are kept ──────────────────────────────────
create or replace function public.save_study(
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
  v_teaching boolean := public.module_on('teaching');
  v_id uuid;
begin
  perform app_private.require_perm('research', 'edit');

  if not v_teaching and cardinality(v_courses) > 0 then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
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

  -- In a clinic the course list is hidden (the form sends none): leave the study's courses as they are.
  if v_teaching then
    -- Only the changes, so an unchanged course list adds no History rows.
    delete from public.study_courses where study_id = v_id and course_id <> all (v_courses);
    insert into public.study_courses (study_id, course_id)
    select v_id, x from unnest(v_courses) x
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- ── Logins: no delegate logins in a clinic ──────────────────────────────────────────────────────────
create or replace function public.create_pending_login(p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  if (p_role = 'delegate' or p_delegate_id is not null) and not public.module_on('teaching') then
    perform app_private.fail('Delegate logins are not used in your plan.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  if p_delegate_id is not null
     and not exists (select 1 from public.delegates d where d.company_id = v_company and d.id = p_delegate_id) then
    perform app_private.fail('Delegate not found.');
  end if;
  insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
  values (v_company, v_email, coalesce(trim(p_full_name), ''), p_role, p_delegate_id, app.current_user_id())
  on conflict (company_id, email) do update
    set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
        created_by = excluded.created_by, created_at = now();
end $$;

create or replace function public.add_existing_member(p_email text, p_role public.user_role, p_delegate_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_user uuid;
begin
  if (p_role = 'delegate' or p_delegate_id is not null) and not public.module_on('teaching') then
    perform app_private.fail('Delegate logins are not used in your plan.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  select p.user_id into v_user from public.profiles p where p.email = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_user is null then
    perform app_private.fail('User not found.');
  end if;
  if p_delegate_id is not null
     and not exists (select 1 from public.delegates d where d.company_id = v_company and d.id = p_delegate_id) then
    perform app_private.fail('Delegate not found.');
  end if;
  begin
    insert into public.company_members (company_id, user_id, role, active, delegate_id)
    values (v_company, v_user, p_role, true, p_delegate_id)
    on conflict (company_id, user_id) do nothing;
  exception when unique_violation then
    -- (company_id, delegate_id): one login per delegate in a company.
    perform app_private.fail('This delegate already has a login.');
  end;
  if not found then
    perform app_private.fail('A user with this email already exists.');
  end if;
  return v_user;
end $$;

create or replace function public.set_member_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_old public.user_role;
begin
  if p_role = 'delegate' and not public.module_on('teaching') then
    perform app_private.fail('Delegate logins are not used in your plan.');
  end if;
  select m.role into v_old from public.company_members m
  where m.company_id = v_company and m.user_id = p_user for update;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if p_role is null or p_role = 'delegate' or v_old = 'delegate' then
    perform app_private.fail('Choose admin or organizer for a staff login.');
  end if;
  update public.company_members set role = p_role where company_id = v_company and user_id = p_user;
end $$;

-- ── Console: Clinic plans and companies are allowed ─────────────────────────────────────────────────
create or replace function public.console_save_plan(p_id uuid, p_name text, p_kind text, p_modules text[], p_actor text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_kind text;
  v_bad text;
  v_modules text[];
  v_id uuid;
begin
  if length(v_name) not between 2 and 60 then
    raise exception 'Give a name (2–60 characters).';
  end if;
  if p_id is not null then
    select p.kind into v_kind from public.plans p where p.id = p_id for update;
    if not found then
      raise exception 'Unknown plan';
    end if;
    if v_kind is distinct from p_kind then
      raise exception 'A plan can''t change its type.';
    end if;
  end if;
  select m into v_bad from unnest(coalesce(p_modules, '{}')) m
  where m is null or m not in ('inventory', 'statistics') limit 1;
  if found then
    raise exception 'Unknown module %', coalesce(v_bad, 'null');
  end if;
  if exists (select 1 from public.plans p where p.name = v_name and p.id is distinct from p_id) then
    raise exception 'A plan called % already exists.', v_name;
  end if;
  v_modules := array(select distinct m from unnest(coalesce(p_modules, '{}')) m order by m);

  begin
    if p_id is null then
      insert into public.plans (name, kind, modules, updated_at, updated_by)
      values (v_name, p_kind, v_modules, now(), p_actor)
      returning id into v_id;
    else
      update public.plans set name = v_name, modules = v_modules, updated_at = now(), updated_by = p_actor
      where id = p_id
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'A plan called % already exists.', v_name;
  end;
  return v_id;
end $$;

create or replace function public.console_set_company_plan(p_slug text, p_kind text, p_plan uuid, p_extras text[], p_actor text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
begin
  select m into v_bad from unnest(coalesce(p_extras, '{}')) m
  where m is null or m not in ('inventory', 'statistics') limit 1;
  if found then
    raise exception 'Unknown module %', coalesce(v_bad, 'null');
  end if;
  if not exists (select 1 from public.plans p where p.id = p_plan and p.kind = p_kind) then
    raise exception 'Choose a plan for this type of company.';
  end if;
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  update public.companies
  set kind = p_kind, plan_id = p_plan,
      extra_modules = array(select distinct m from unnest(coalesce(p_extras, '{}')) m order by m)
  where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;
