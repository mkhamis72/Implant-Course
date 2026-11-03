-- One database (plan 3, release 4): the remaining admin functions act on the caller's bound company, and
-- the release-3 compatibility code goes. The previous app version is suspended while this release
-- migrates, so nothing writes profiles.role / active / delegate_id / mfa_setup_required any more: the
-- mirrors between profiles and academy's company_members rows are dropped, and no SQL reads those
-- columns (release 5 drops them). Signatures are unchanged, so grants and owners stay.
set local lock_timeout = '5s';


-- ── The mirrors and the profile-based triggers ──────────────────────────────────────────────────────

drop trigger profiles_sync_member on public.profiles;
drop function app_private.sync_member_from_profile();
drop trigger company_members_sync_profile on public.company_members;
drop function app_private.sync_profile_from_member();

-- protect_last_admin read profiles.role / active; company_members_protect_last_admin (0087) is the
-- per-company rule.
drop trigger profiles_protect_last_admin on public.profiles;
drop function app_private.protect_last_admin();

-- Only the name stays writable on profiles (admins, profiles_admin_update); role, active and the delegate
-- link are the membership's.
revoke update (role, active, delegate_id) on public.profiles from authenticated;

-- profiles.delegate_id is no longer maintained: a stale link must not stop delete_delegate removing the
-- delegate (the login's delegate is company_members.delegate_id).
alter table public.profiles drop constraint profiles_delegate_id_fkey;
-- profiles_delegate_link, per company: a delegate login has its delegate, a staff login has none.
alter table public.company_members add constraint company_members_delegate_link
  check ((role = 'delegate') = (delegate_id is not null));

-- Permissions are per company (spec §4): one row per company, user and area.
alter table public.user_permissions drop constraint user_permissions_pkey;
alter table public.user_permissions add primary key (company_id, user_id, area);

-- default_permissions (0030): an organizer membership gets View everywhere in its own company, now on
-- company_members (a new profile no longer has a meaningful role). Postgres-owned (spec §5 allowlist).
create or replace function app_private.default_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;
  if new.role = 'organizer' and not exists (
    select 1 from public.user_permissions where company_id = new.company_id and user_id = new.user_id
  ) then
    insert into public.user_permissions (company_id, user_id, area, level)
    select new.company_id, new.user_id, a.area, 'view'
    from (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area);
  end if;
  return new;
end $$;

drop trigger profiles_default_permissions on public.profiles;
create trigger company_members_default_permissions after insert or update of role on public.company_members
  for each row execute function app_private.default_permissions();


-- ── No more release-3 fallbacks ─────────────────────────────────────────────────────────────────────

-- 0087's admin_company: an unbound session is refused. p_academy_if_unbound is ignored (kept so the
-- signature and its callers stay).
create or replace function app_private.admin_company(p_message text, p_academy_if_unbound boolean) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
begin
  if not public.is_admin() then
    perform app_private.fail(p_message);
  end if;
  if v_company is null then
    perform app_private.fail('This session is not linked to a company. Sign in again.');
  end if;
  if not exists (select 1 from public.company_members m
                 where m.company_id = v_company and m.user_id = app.current_user_id()
                   and m.active and m.role = 'admin') then
    perform app_private.fail(p_message);
  end if;
  return v_company;
end $$;

-- 0087's admin_require_mfa_setup, without the fallback.
create or replace function public.admin_require_mfa_setup(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  v_company := app_private.admin_company('Only an admin can do this.', false);
  update public.company_members set mfa_setup_required = true where company_id = v_company and user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (company_id, user_id, kind, actor_id)
  values (v_company, p_user, 'mfa_reset', app.current_user_id());
end $$;

-- 0087's admin_end_sessions: only the sessions bound to the caller's company.
create or replace function public.admin_end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  v_company := app_private.admin_company('Only an admin can do this.', false);
  delete from auth.sessions s
  where s.user_id = p_user
    and s.id in (select sc.session_id from app.session_companies sc
                 where sc.company_id = v_company and sc.user_id = p_user);
end $$;

-- 0087's delete_user, without the fallback and the profiles.active write.
create or replace function public.delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_name text;
  v_role public.user_role;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can remove users.');
  end if;
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t remove your own account.');
  end if;
  v_company := app_private.admin_company('Only an admin can remove users.', false);
  select m.role into v_role from public.company_members m
  where m.company_id = v_company and m.user_id = p_user for update;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  select coalesce(nullif(p.full_name, ''), p.email) into v_name from public.profiles p where p.user_id = p_user for update;
  if v_role = 'delegate' then
    -- Checklist tasks could be assigned to delegate logins before 0037; those were never valid.
    update public.checklist_items set assignee_id = null where company_id = v_company and assignee_id = p_user;
  end if;
  if not exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id <> v_company) then
    begin
      delete from public.profiles where user_id = p_user;
    exception when foreign_key_violation then
      perform app_private.fail(format(
        '%s has records in the app (for example implants, stock or checklist work) and can''t be removed. Deactivate them instead.',
        v_name));
    end;
    return;
  end if;
  delete from public.user_permissions where company_id = v_company and user_id = p_user;
  delete from public.company_members where company_id = v_company and user_id = p_user;
end $$;

-- 0088's delete_delegate, on the bound company only (an unbound session fails require_perm), and without
-- the profile write: a login kept for another company just loses this company's membership.
create or replace function public.delete_delegate(p_delegate uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_login uuid;
begin
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
    if exists (select 1 from public.company_members m where m.user_id = v_login and m.company_id <> v_company) then
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

-- 0088's handle_new_user: every login comes from a pending row (createLogin, add_existing_member's
-- companion flow, the scripts); without one the sign-up is refused. Expiry and dropped rows as 0088.
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(new.email);
  v_name text;
begin
  delete from app_private.pending_logins where email = v_email and created_at < now() - interval '7 days';
  select pl.full_name into v_name from app_private.pending_logins pl
  where pl.email = v_email order by pl.created_at desc limit 1;
  if not found then
    perform app_private.fail('No pending login for this address.');
  end if;
  insert into public.profiles (user_id, email, full_name) values (new.id, v_email, v_name);
  insert into public.company_members (company_id, user_id, role, active, delegate_id)
  select pl.company_id, new.id, pl.role, true, pl.delegate_id
  from app_private.pending_logins pl
  where pl.email = v_email
    and (pl.delegate_id is null
         or exists (select 1 from public.delegates d where d.company_id = pl.company_id and d.id = pl.delegate_id))
  on conflict do nothing;
  delete from app_private.pending_logins where email = v_email;
  return new;
end $$;


-- ── Admin functions on the caller's company ─────────────────────────────────────────────────────────
-- Each takes the company from admin_company and refuses a user who isn't a member there.

-- 0089's set_user_permissions: the target must be an organizer of the caller's company; only that
-- company's rows are replaced.
create or replace function public.set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role public.user_role;
  v_key text;
  v_level text;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can change permissions.', false);
  if p_user = app.current_user_id() then
    perform app_private.fail('You cannot change your own permissions.');
  end if;
  select m.role into v_role from public.company_members m where m.company_id = v_company and m.user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if v_role <> 'organizer' then
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
  delete from public.user_permissions where company_id = v_company and user_id = p_user;
  insert into public.user_permissions (company_id, user_id, area, level)
  select v_company, p_user, key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb))
  where value #>> '{}' is not null;
end $$;

-- 0089's admin_change_email: the target must be a member of the caller's company, and of no other (the
-- sign-in email is the person's, shared by every company they belong to: support changes it). It stays
-- unique across profiles; the delegate whose address follows is this company's.
create or replace function public.admin_change_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_delegate uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform app_private.fail('Enter a valid email address.');
  end if;
  if length(v_email) > 120 then
    perform app_private.fail('Keep the email to 120 characters or fewer.');
  end if;
  select m.delegate_id into v_delegate from public.company_members m
  where m.company_id = v_company and m.user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id <> v_company) then
    perform app_private.fail('This user also belongs to another company. Ask support to change their sign-in details.');
  end if;
  perform 1 from public.profiles where user_id = p_user for update;
  if exists (select 1 from public.profiles where lower(email) = v_email and user_id <> p_user) then
    perform app_private.fail('Another account already uses that email.');
  end if;
  update public.profiles set email = v_email where user_id = p_user;
  if v_delegate is not null then
    update public.delegates set email = v_email where company_id = v_company and id = v_delegate;
  end if;
end $$;

-- 0074's admin_set_name: the target must be a member of the caller's company, and of no other (the name is
-- the person's, as for admin_change_email).
create or replace function public.admin_set_name(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform app_private.require_perm('delegates', 'edit');
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if v_name = '' then
    perform app_private.fail('Enter a name.');
  end if;
  if length(v_name) > 120 then
    perform app_private.fail('Keep the name to 120 characters or fewer.');
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  if exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id <> v_company) then
    perform app_private.fail('This user also belongs to another company. Ask support to change their sign-in details.');
  end if;
  update public.profiles set full_name = v_name where user_id = p_user;
end $$;

-- 0089's admin_record_event: the target must be a member of the caller's company; the event is that
-- company's.
create or replace function public.admin_record_event(p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_kind is null or p_kind not in ('invite_resent', 'email_change_incomplete') then
    perform app_private.fail('Unknown event.');
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (company_id, user_id, kind, actor_id)
  values (v_company, p_user, p_kind, app.current_user_id());
end $$;

-- 0074's admin_user_history: a member of the caller's company, and only that company's audit rows and
-- events.
create or replace function public.admin_user_history(p_user uuid)
returns table (at timestamptz, actor_name text, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  return query
  with entries as (
    select a.at, a.user_id as actor_id, 'email_changed'::text as kind
    from public.audit_log a
    where a.company_id = v_company and a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'email', '') <> ''
      and a.before ->> 'email' is distinct from a.after ->> 'email'
    union all
    select a.at, a.user_id, 'name_changed'
    from public.audit_log a
    where a.company_id = v_company and a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'full_name', '') <> ''
      and a.before ->> 'full_name' is distinct from a.after ->> 'full_name'
    union all
    select e.at, e.actor_id, e.kind from public.admin_events e where e.company_id = v_company and e.user_id = p_user
  )
  select en.at, coalesce(nullif(p.full_name, ''), p.email), en.kind
  from entries en left join public.profiles p on p.user_id = en.actor_id
  order by en.at desc, en.kind
  limit 10;
end $$;

-- 0037's check_assignee: the assignee must be an active staff member of the checklist item's company.
create or replace function app_private.check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (
       select 1 from public.company_members m
       where m.company_id = new.company_id and m.user_id = new.assignee_id
         and m.active and m.role in ('admin', 'organizer')
     ) then
    perform app_private.fail('Choose an active organizer or admin to assign this to.');
  end if;
  return new;
end $$;

-- 0081's fit_component_v2: "fitted by organizer" must be an active admin or organizer of the implant's company
-- (profiles.active is no longer maintained), and the component row takes that company.
create or replace function public.fit_component_v2(p_site uuid, p_type public.component_type, p_fitted_on date,
  p_product uuid, p_lot uuid, p_by_delegate uuid, p_by_organizer uuid, p_notes text, p_course uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
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
    if p_lot is null then
      perform app_private.fail('Choose the stock batch used.');
    end if;
    perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id
  ) values (
    v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course
  ) returning id into v_id;

  if p_product is not null then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;
