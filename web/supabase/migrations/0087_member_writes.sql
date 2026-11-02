-- One database (plan 2): membership writes for the caller's company (spec §4). The company-aware app
-- changes role, active and the 2FA setup flag on company_members; a reverse mirror copies academy's rows
-- to profiles, which the previous app version still reads. admin_require_mfa_setup, admin_end_sessions
-- and delete_user act on the caller's bound company. Signatures are unchanged, so grants stay.
set local lock_timeout = '5s';


-- Staff pickers read the members of their own company (0085's policy keeps the user's own row and admins).
create policy company_members_staff_select on public.company_members for select to authenticated
  using (company_id = (select app.current_company_id()) and (select public.is_active_user()));

-- admin_company: the caller's bound company, for an active admin of it. is_admin() still reads profiles
-- (academy) and checks aal2; the member row makes the admin check per company. An unbound session is
-- refused rather than acting on no company.
create function app_private.admin_company(p_message text) returns uuid
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
revoke all on function app_private.admin_company(text) from public, anon, authenticated;

-- protect_last_member_admin: protect_last_admin (0001) per company, same message.
create function app_private.protect_last_member_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active or new.company_id <> old.company_id) then
    if not exists (
      select 1 from public.company_members m
      where m.company_id = old.company_id and m.role = 'admin' and m.active and m.user_id <> old.user_id
    ) then
      raise exception 'Cannot remove the last active admin' using hint = 'last_admin';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function app_private.protect_last_member_admin() from public, anon, authenticated;

create trigger company_members_protect_last_admin before update or delete on public.company_members
  for each row execute function app_private.protect_last_member_admin();

-- sync_profile_from_member: the reverse of 0085's sync_member_from_profile, for academy rows. Same depth
-- guard; both directions write only rows that differ, so a change settles after one round.
create function app_private.sync_profile_from_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() < 3 then
    update public.profiles p
    set role = new.role, active = new.active, delegate_id = new.delegate_id, mfa_setup_required = new.mfa_setup_required
    where p.user_id = new.user_id
      and (p.role, p.active, p.delegate_id, p.mfa_setup_required)
        is distinct from (new.role, new.active, new.delegate_id, new.mfa_setup_required);
  end if;
  return null;
end $$;
revoke all on function app_private.sync_profile_from_member() from public, anon, authenticated;

create trigger company_members_sync_profile after insert or update on public.company_members
  for each row when (new.company_id = 'a7c0de00-0000-4000-8000-000000000001')
  execute function app_private.sync_profile_from_member();

-- set_member_role / set_member_active: admin-only, on the caller's company. The app offers admin and
-- organizer; a delegate login's role follows its delegate link, so it is not changed here.
create function public.set_member_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.');
  v_old public.user_role;
begin
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

create function public.set_member_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.');
begin
  if p_active is null then
    perform app_private.fail('Invalid request.');
  end if;
  update public.company_members set active = p_active where company_id = v_company and user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
end $$;

alter function public.set_member_role(uuid, public.user_role) owner to postgres;
alter function public.set_member_active(uuid, boolean) owner to postgres;
revoke all on function public.set_member_role(uuid, public.user_role), public.set_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_member_role(uuid, public.user_role), public.set_member_active(uuid, boolean) to authenticated;

-- 0074's admin_require_mfa_setup, on the caller's company's member row (the mirror updates profiles).
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
  v_company := app_private.admin_company('Only an admin can do this.');
  update public.company_members set mfa_setup_required = true where company_id = v_company and user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (company_id, user_id, kind, actor_id)
  values (v_company, p_user, 'mfa_reset', app.current_user_id());
end $$;

-- 0074's admin_end_sessions, limited to the sessions bound to the caller's company. Refresh tokens go
-- with the sessions (on delete cascade); access tokens already issued last until they expire.
create or replace function public.admin_end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  v_company := app_private.admin_company('Only an admin can do this.');
  delete from auth.sessions s
  where s.user_id = p_user
    and s.id in (select sc.session_id from app.session_companies sc
                 where sc.company_id = v_company and sc.user_id = p_user);
end $$;

-- 0037's delete_user, per company: removes the caller's company membership and its permissions. The
-- profile goes only with the last membership, and its foreign keys are still the "has records" check.
-- Removed from academy while another membership remains, the profile is set inactive first, so the
-- profile-based helpers of the previous app version stop granting academy access.
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
  v_company := app_private.admin_company('Only an admin can remove users.');
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
  if v_company = 'a7c0de00-0000-4000-8000-000000000001' then
    update public.profiles set active = false where user_id = p_user;
  end if;
  delete from public.user_permissions where company_id = v_company and user_id = p_user;
  delete from public.company_members where company_id = v_company and user_id = p_user;
end $$;
