-- Removing users and delegates added by mistake (test accounts, duplicates). Anyone with records stays: the
-- ledger and clinical history are permanent, so those are deactivated / set inactive instead.

-- delete_user: removes a staff or delegate profile; the app then deletes the Auth account (service role).
-- The profiles foreign keys (created_by, author_id, assignee_id, done_by, fitted_by_organizer_id, voided_by,
-- lead_organizer_id, …) are the "has records" check, so tables added later are covered too.
-- No last-admin check: the caller is an active admin and can't remove themselves, so another admin remains.
create function public.delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_role text;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can remove users.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You can''t remove your own account.');
  end if;
  select coalesce(nullif(full_name, ''), email), role into v_name, v_role from public.profiles where user_id = p_user for update;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if v_role = 'delegate' then
    -- Checklist tasks could be assigned to delegate logins before 0037; those were never valid.
    update public.checklist_items set assignee_id = null where assignee_id = p_user;
  end if;
  begin
    delete from public.profiles where user_id = p_user;
  exception when foreign_key_violation then
    perform app_private.fail(format(
      '%s has records in the app (for example implants, stock or checklist work) and can''t be removed. Deactivate them instead.',
      v_name));
  end;
end $$;
revoke execute on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated;

-- delete_delegate: removes a delegate with no implant records or surgery bookings, with their course enrollments
-- and their login's profile. Returns that login's user id so the app can delete the Auth account.
create function public.delete_delegate(p_delegate uuid) returns uuid
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
revoke execute on function public.delete_delegate(uuid) from public, anon;
grant execute on function public.delete_delegate(uuid) to authenticated;

-- check_assignee: latest 0022_checklist_polish.sql:86; only staff (not delegate logins) take checklist tasks.
create or replace function app_private.check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (
       select 1 from public.profiles
       where user_id = new.assignee_id and active and role in ('admin', 'organizer')
     ) then
    perform app_private.fail('Choose an active organizer or admin to assign this to.');
  end if;
  return new;
end $fn$;
