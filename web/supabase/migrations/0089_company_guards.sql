-- One database (plan 3, release 4): the guards and auth helpers read the bound company (spec §4).
-- Roles, active and the 2FA setup flag come from the caller's company_members row for
-- app.current_company_id(), and permissions from user_permissions of that company. An unbound session
-- has no company, so it gets no access. Every other function and policy that called auth.uid() /
-- auth.jwt() now calls the app.* helpers. Same signatures, so grants and owners stay.
-- app_private.require_active() and require_perm() call is_active_user() and can(), so they follow.
set local lock_timeout = '5s';


-- ── Guards ──────────────────────────────────────────────────────────────────────────────────────
-- RLS calls these once per row in the *_select policies, so they are plpgsql: a non-inlined SQL
-- function is planned again on every call, plpgsql keeps its plans for the session. Measured on the
-- local stack (~1000 patients, as organizer): recall_list about 2 s like this, 6 s with the profiles-based
-- guards before 0089, and several times slower with SQL bodies reading company_members.

-- The 0083 / 0085 session helpers, unchanged, in plpgsql for the same reason.
create or replace function app.current_user_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  return auth.uid();
end $$;

create or replace function app.current_aal() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return auth.jwt() ->> 'aal';
end $$;

create or replace function app.current_company_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select sc.company_id from app.session_companies sc
          where sc.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and sc.user_id = auth.uid());
end $$;

-- mfa_satisfied: aal2 when the user has a verified factor (auth.mfa_factors, read by this postgres-owned
-- function), and no 2FA set-up pending on the member row of the bound company.
create or replace function app_private.mfa_satisfied() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.current_user_id();
begin
  return (coalesce(app.current_aal(), 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f where f.user_id = v_user and f.status = 'verified'))
    and not exists (select 1 from public.company_members m
                    where m.company_id = app.current_company_id() and m.user_id = v_user and m.mfa_setup_required);
end $$;

create or replace function public.is_active_user() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.mfa_satisfied() and exists (
    select 1 from public.company_members m
    where m.company_id = app.current_company_id() and m.user_id = app.current_user_id()
      and m.active and m.role in ('admin', 'organizer'));
end $$;

create or replace function public.is_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.mfa_satisfied() and exists (
    select 1 from public.company_members m
    where m.company_id = app.current_company_id() and m.user_id = app.current_user_id()
      and m.active and m.role = 'admin');
end $$;

-- can: is_admin() or (is_active_user() and a permission row in the bound company), with one 2FA check.
create or replace function public.can(p_area text, p_level text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.mfa_satisfied() and exists (
    select 1 from public.company_members m
    where m.company_id = app.current_company_id() and m.user_id = app.current_user_id() and m.active
      and (m.role = 'admin' or (m.role = 'organizer' and exists (
        select 1 from public.user_permissions up
        where up.company_id = m.company_id and up.user_id = m.user_id and up.area = p_area
          and (up.level = 'edit' or p_level = 'view')))));
end $$;

create or replace function public.is_delegate_user() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.mfa_satisfied() and exists (
    select 1 from public.company_members m
    where m.company_id = app.current_company_id() and m.user_id = app.current_user_id()
      and m.active and m.role = 'delegate' and m.delegate_id is not null);
end $$;

create or replace function public.my_delegate_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select m.delegate_id from public.company_members m
          where m.company_id = app.current_company_id() and m.user_id = app.current_user_id());
end $$;

-- mfa_setup_done: clears the flag on the member row of the bound company only (academy's row mirrors to
-- profiles). A reset in any company counts: a factor older than the latest one is the lost phone's.
create or replace function public.mfa_setup_done() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := app.current_user_id();
  v_company uuid := app.current_company_id();
begin
  if v_user is null then
    perform app_private.fail('Sign in first.');
  end if;
  if v_company is null then
    perform app_private.fail('This session is not linked to a company. Sign in again.');
  end if;
  -- The factor must be newer than the latest reset: one that survived it (a failed deletion) is the
  -- lost phone's, and must not lift the requirement.
  if coalesce(app.current_aal(), '') <> 'aal2'
     or not exists (
       select 1 from auth.mfa_factors f
       where f.user_id = v_user and f.status = 'verified'
         and f.created_at > coalesce(
           (select max(e.at) from public.admin_events e where e.user_id = v_user and e.kind = 'mfa_reset'),
           '-infinity'::timestamptz)
     ) then
    perform app_private.fail('Finish setting up two-factor authentication first.');
  end if;
  update public.company_members set mfa_setup_required = false where company_id = v_company and user_id = v_user;
end $$;


-- ── Policies ────────────────────────────────────────────────────────────────────────────────────

alter policy profiles_select on public.profiles
  using (public.is_active_user() or user_id = (select app.current_user_id()));

alter policy visit_notes_insert on public.visit_notes
  with check (public.is_active_user() and author_id = (select app.current_user_id()));

-- A member with 2FA set-up pending in the bound company still reads settings (the set-up page needs them).
alter policy settings_select on public.settings
  using (public.is_active_user() or public.is_delegate_user() or exists (
    select 1 from public.company_members m
    where m.company_id = (select app.current_company_id()) and m.user_id = (select app.current_user_id())
      and m.active and m.mfa_setup_required));

alter policy user_permissions_select on public.user_permissions
  using (public.is_admin() or user_id = (select app.current_user_id()));


-- ── The rest: auth.uid() becomes app.current_user_id() ──────────────────────────────────────────

create or replace function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  insert into public.audit_log (table_name, row_id, action, user_id, before, after)
  values (
    tg_table_name,
    coalesce(v_after, v_before) ->> tg_argv[0],
    tg_op,
    app.current_user_id(),
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

create or replace function public.admin_change_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_delegate uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform app_private.fail('Enter a valid email address.');
  end if;
  if length(v_email) > 120 then
    perform app_private.fail('Keep the email to 120 characters or fewer.');
  end if;
  select delegate_id into v_delegate from public.profiles where user_id = p_user for update;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email and user_id <> p_user) then
    perform app_private.fail('Another account already uses that email.');
  end if;
  update public.profiles set email = v_email where user_id = p_user;
  if v_delegate is not null then
    update public.delegates set email = v_email where id = v_delegate;
  end if;
end $$;

create or replace function public.admin_record_event(p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_kind is null or p_kind not in ('invite_resent', 'email_change_incomplete') then
    perform app_private.fail('Unknown event.');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (user_id, kind, actor_id) values (p_user, p_kind, app.current_user_id());
end $$;

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
  if p_user = app.current_user_id() then
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
  values (app.current_user_id(), p_format, coalesce(p_filters, '{}'::jsonb), coalesce(p_row_counts, '{}'::jsonb), v_study)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.save_analysis(p_id uuid, p_title text, p_config jsonb, p_course uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_owner uuid;
  v_id uuid;
begin
  perform app_private.require_perm('research', 'edit');
  if not public.can('patients', 'view') then
    perform app_private.fail('Saving an analysis needs View on Patients.');
  end if;
  if length(v_title) not between 1 and 120 then
    perform app_private.fail('Enter a title for the analysis.');
  end if;
  if p_id is null then
    insert into public.saved_analyses (title, config, course_id, created_by)
    values (v_title, p_config, p_course, app.current_user_id())
    returning id into v_id;
    return v_id;
  end if;
  select created_by into v_owner from public.saved_analyses where id = p_id for update;
  if not found then
    perform app_private.fail('Saved analysis not found.');
  end if;
  if v_owner is distinct from app.current_user_id() and not public.is_admin() then
    perform app_private.fail('Only the person who saved this analysis or an admin can change it.');
  end if;
  update public.saved_analyses set title = v_title, config = p_config, course_id = p_course where id = p_id;
  return p_id;
end $$;

create or replace function public.delete_analysis(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  perform app_private.require_perm('research', 'edit');
  select created_by into v_owner from public.saved_analyses where id = p_id for update;
  if not found then
    perform app_private.fail('Saved analysis not found.');
  end if;
  if v_owner is distinct from app.current_user_id() and not public.is_admin() then
    perform app_private.fail('Only the person who saved this analysis or an admin can change it.');
  end if;
  delete from public.saved_analyses where id = p_id;
end $$;

create or replace function public.toggle_checklist_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('checklists', 'edit');
  update public.checklist_items
  set done_by = case when p_done then coalesce(done_by, app.current_user_id()) end,
      done_at = case when p_done then coalesce(done_at, now()) end
  where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
end $$;

create or replace function public.void_complication(p_complication uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.implant_complications;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this complication');
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
  perform 1 from public.implant_sites where id = v_c.site_id for update;
  update public.implant_complications
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
  where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
end $$;

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
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason), removed_on = fitted_on
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

create or replace function public.void_consent(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this consent record is being voided.');
  end if;
  if length(trim(p_reason)) > 500 then
    perform app_private.fail('Keep the reason under 500 characters.');
  end if;
  perform 1 from public.patient_consents where id = p_id and voided_at is null for update;
  if not found then perform app_private.fail('Consent record not found.'); end if;
  update public.patient_consents
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
  where id = p_id;
end $$;

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
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
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

create or replace function public.void_radiograph(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this X-ray is being removed from the record.');
  end if;
  perform 1 from public.radiographs where id = p_id and voided_at is null for update;
  if not found then perform app_private.fail('X-ray not found.'); end if;
  update public.radiographs
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
  where id = p_id;
end $$;

create or replace function public.void_restoration(p_restoration uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.restorations;
  v_sites uuid[];
  v_all uuid[];
  v_site uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this restoration is being removed from the record.');
  end if;
  -- Its implants and those of the restorations it ended (which reopen), locked before the restorations.
  select coalesce(array_agg(distinct rs.site_id), '{}') into v_sites
  from public.restoration_sites rs
  where rs.restoration_id = p_restoration
     or rs.restoration_id in (select id from public.restorations where ended_by = p_restoration);
  v_all := app_private.lock_restoration_sites(v_sites);

  select * into v_r from public.restorations where id = p_restoration and voided_at is null for update;
  if not found then perform app_private.fail('Restoration not found.'); end if;
  if v_r.ended_on is not null then
    perform app_private.fail('Only the newest restoration on these implants can be undone.');
  end if;
  perform 1 from public.restorations where ended_by = p_restoration order by id for update;
  -- Reopening must not give an implant two current restorations.
  if exists (
    select 1
    from public.restorations reopened
    join public.restoration_sites rs on rs.restoration_id = reopened.id
    join public.restoration_sites other_rs on other_rs.site_id = rs.site_id
    join public.restorations other on other.id = other_rs.restoration_id
    where reopened.ended_by = p_restoration
      and other.id <> p_restoration and other.ended_on is null and other.voided_at is null
  ) then
    perform app_private.fail('Only the newest restoration on these implants can be undone.');
  end if;

  update public.restorations
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
  where id = p_restoration;
  update public.restorations
  set ended_on = null, end_kind = null, end_reason = null, ended_by = null
  where ended_by = p_restoration;

  foreach v_site in array v_all loop
    perform app_private.sync_restored(v_site);
  end loop;
end $$;

create or replace function public.void_restoration_problem(p_problem uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this problem is being removed from the record.');
  end if;
  update public.restoration_problems
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason)
  where id = p_problem and voided_at is null;
  if not found then perform app_private.fail('Problem not found.'); end if;
end $$;
