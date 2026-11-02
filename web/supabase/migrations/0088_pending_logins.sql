-- One database (plan 2): new logins carry their company, and an existing account can join another
-- company (spec §4). createLogin writes a pending row for the caller's company before the Auth call;
-- handle_new_user turns it into the membership. Without a pending row (the previous app version's
-- logins) a new login still becomes an inactive academy member through the forward sync. delete_delegate
-- now acts on the caller's company and keeps the profile of a login another company still has.
--
-- WARNING: a pending row grants its company and role to ANY auth.users insert with that email, so Auth
-- sign-ups must stay disabled in every company project ("Allow new users to sign up" off). tenant:check
-- and the console health check fail while they are on.
set local lock_timeout = '5s';


-- pending_logins: who an admin is creating a login for, per company, until Auth creates the account.
-- Global (app_private), closed to every API role; only the definers below read and write it.
create table app_private.pending_logins (
  company_id uuid not null references public.companies (id),
  email text not null,
  full_name text not null default '',
  role public.user_role not null,
  delegate_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, email)
);
create index pending_logins_email_idx on app_private.pending_logins (email);
alter table app_private.pending_logins enable row level security;
alter table app_private.pending_logins force row level security;
revoke all on app_private.pending_logins from public, anon, authenticated;
create trigger pending_logins_audit after insert or update or delete on app_private.pending_logins
  for each row execute function app_private.audit_row('email');

-- A delegate login has its delegate; a staff login has none (profiles_delegate_link, per company).
create function app_private.check_login_role(p_role public.user_role, p_delegate_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_role is null or (p_role = 'delegate') <> (p_delegate_id is not null) then
    perform app_private.fail('Invalid request.');
  end if;
end $$;
revoke all on function app_private.check_login_role(public.user_role, uuid) from public, anon, authenticated;

-- create_pending_login: admin-only, for the caller's bound company. A repeat replaces the row.
create function public.create_pending_login(p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
  values (v_company, v_email, coalesce(trim(p_full_name), ''), p_role, p_delegate_id, app.current_user_id())
  on conflict (company_id, email) do update
    set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
        created_by = excluded.created_by, created_at = now();
end $$;

-- add_existing_member: admin-only. Someone who already has an account (another company's login) joins the
-- caller's bound company, active, with the given role. Returns their user id.
create function public.add_existing_member(p_email text, p_role public.user_role, p_delegate_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_user uuid;
begin
  perform app_private.check_login_role(p_role, p_delegate_id);
  select p.user_id into v_user from public.profiles p where p.email = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_user is null then
    perform app_private.fail('User not found.');
  end if;
  insert into public.company_members (company_id, user_id, role, active, delegate_id)
  values (v_company, v_user, p_role, true, p_delegate_id)
  on conflict (company_id, user_id) do nothing;
  if not found then
    perform app_private.fail('A user with this email already exists.');
  end if;
  return v_user;
end $$;

-- cancel_pending_login: admin-only. createLogin removes its pending row again when the Auth call fails,
-- so a later sign-up of that address doesn't join the company unasked.
create function public.cancel_pending_login(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
begin
  delete from app_private.pending_logins
  where company_id = v_company and email = lower(trim(coalesce(p_email, '')));
end $$;

alter function public.create_pending_login(text, text, public.user_role, uuid) owner to postgres;
alter function public.add_existing_member(text, public.user_role, uuid) owner to postgres;
alter function public.cancel_pending_login(text) owner to postgres;
revoke all on function public.create_pending_login(text, text, public.user_role, uuid),
  public.add_existing_member(text, public.user_role, uuid), public.cancel_pending_login(text) from public, anon;
grant execute on function public.create_pending_login(text, text, public.user_role, uuid),
  public.add_existing_member(text, public.user_role, uuid), public.cancel_pending_login(text) to authenticated;

-- 0001's handle_new_user: the profile takes its name from a pending row. Each pending row becomes an
-- active membership and is removed; the flag tells the forward sync not to add academy's row as well.
-- A pending row whose delegate has gone since, or whose delegate already has a login, is dropped rather
-- than failing the sign-up. Rows older than 7 days are expired: deleted, never used. Without (fresh)
-- pending rows: as before (an inactive academy member, through the sync).
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
    insert into public.profiles (user_id, email) values (new.id, v_email);
    return new;
  end if;
  perform set_config('app.member_from_pending', 'on', true);
  insert into public.profiles (user_id, email, full_name) values (new.id, v_email, v_name);
  perform set_config('app.member_from_pending', 'off', true);
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

-- 0087's sync_member_from_profile, with the INSERT branch skipped while handle_new_user creates the
-- memberships from pending rows. Everything else as 0087.
create or replace function app_private.sync_member_from_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() < 3 then
    if tg_op = 'DELETE' then
      delete from public.company_members
      where company_id = 'a7c0de00-0000-4000-8000-000000000001' and user_id = old.user_id;
    elsif tg_op = 'INSERT' then
      if coalesce(current_setting('app.member_from_pending', true), '') = 'on' then
        return null;
      end if;
      insert into public.company_members as m (company_id, user_id, role, active, delegate_id, mfa_setup_required)
      values ('a7c0de00-0000-4000-8000-000000000001', new.user_id, new.role, new.active, new.delegate_id, new.mfa_setup_required)
      on conflict (company_id, user_id) do update
        set role = excluded.role, active = excluded.active, delegate_id = excluded.delegate_id,
            mfa_setup_required = excluded.mfa_setup_required
        where (m.role, m.active, m.delegate_id, m.mfa_setup_required)
          is distinct from (excluded.role, excluded.active, excluded.delegate_id, excluded.mfa_setup_required);
    else
      update public.company_members m
      set role = new.role, active = new.active, delegate_id = new.delegate_id, mfa_setup_required = new.mfa_setup_required
      where m.company_id = 'a7c0de00-0000-4000-8000-000000000001' and m.user_id = new.user_id
        and (m.role, m.active, m.delegate_id, m.mfa_setup_required)
          is distinct from (new.role, new.active, new.delegate_id, new.mfa_setup_required);
    end if;
  end if;
  return null;
end $$;

-- delete_delegate: latest 0058, per company. The delegate must be the caller's company's (unbound
-- sessions are academy's). Its login is found through that company's membership; the membership goes,
-- and the profile only with the last membership. Kept for another company, an academy profile loses
-- its delegate link and is set inactive, so the previous app version's profile-based helpers stop
-- granting academy access. Returns the login id: the app deletes the Auth account only when no profile
-- remains. Same refusals as 0058.
create or replace function public.delete_delegate(p_delegate uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  -- release-3 compatibility: an unbound session is academy's (the previous app version never binds); plan 3 removes this fallback
  v_company uuid := coalesce(app.current_company_id(), 'a7c0de00-0000-4000-8000-000000000001'::uuid);
  v_login uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
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
    perform app_private.admin_company('Only an admin can remove a delegate who has a login.', true);
    -- Delegate logins only read (my_schedule / my_report), so they have no records of their own; checklist
    -- tasks assigned to them before 0037 were never valid and are unassigned.
    update public.checklist_items set assignee_id = null where company_id = v_company and assignee_id = v_login;
    if exists (select 1 from public.company_members m where m.user_id = v_login and m.company_id <> v_company) then
      delete from public.user_permissions where company_id = v_company and user_id = v_login;
      delete from public.company_members where company_id = v_company and user_id = v_login;
      update public.profiles set role = 'organizer', delegate_id = null, active = false
      where user_id = v_login and delegate_id = p_delegate;
    else
      delete from public.profiles where user_id = v_login;
    end if;
  end if;
  delete from app_private.pending_logins where company_id = v_company and delegate_id = p_delegate;
  delete from public.enrollments where delegate_id = p_delegate;
  delete from public.delegates where id = p_delegate;
  return v_login;
end $$;
