-- Admin user tools: change a user's email (profile + linked delegate), edit their name, reset 2FA
-- (a "must set up 2FA" flag), end their sessions, and a short per-user history of admin changes.

-- ── 1. The 2FA flag ─────────────────────────────────────────────────────────────────────────
-- Set by admin_require_mfa_setup, cleared by mfa_setup_done. It doesn't affect RLS: the app's
-- session guards send a flagged user to Account → Security.
alter table public.profiles add column mfa_setup_required boolean not null default false;

-- Admins updated profiles through the table-level privilege; narrow it to the existing columns so
-- the flag can only change through the functions below.
revoke update on public.profiles from authenticated;
grant update (full_name, email, role, active, delegate_id) on public.profiles to authenticated;

-- ── 2. Admin events (things audit_log can't show: a 2FA reset, a resent invite, a failed email change) ──
create table public.admin_events (
  id uuid primary key default gen_random_uuid(),
  -- Cascade: an event mustn't stop delete_user removing an invite nobody accepted.
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('mfa_reset', 'invite_resent', 'email_change_incomplete')),
  actor_id uuid references public.profiles (user_id),
  at timestamptz not null default now()
);
create index admin_events_user_idx on public.admin_events (user_id, at desc);

alter table public.admin_events enable row level security;
grant select on public.admin_events to authenticated;
create policy admin_events_select on public.admin_events for select to authenticated
  using ((select public.is_admin()));

create trigger admin_events_audit after insert or update or delete on public.admin_events
  for each row execute function app_private.audit_row('id');

-- ── 3. Admin functions ──────────────────────────────────────────────────────────────────────
-- Each starts with the Delegates edit check (the permissions guard rail) and then admits admins only.

create function public.admin_change_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_delegate uuid;
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_user = auth.uid() then
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

create function public.admin_set_name(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if v_name = '' then
    perform app_private.fail('Enter a name.');
  end if;
  if length(v_name) > 120 then
    perform app_private.fail('Keep the name to 120 characters or fewer.');
  end if;
  update public.profiles set full_name = v_name where user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
end $$;

-- Called after the app has deleted the user's factors through the Auth admin API.
create function public.admin_require_mfa_setup(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  update public.profiles set mfa_setup_required = true where user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (user_id, kind, actor_id) values (p_user, 'mfa_reset', auth.uid());
end $$;

-- invite_resent and email_change_incomplete; mfa_reset comes only from admin_require_mfa_setup.
create function public.admin_record_event(p_user uuid, p_kind text) returns void
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
  insert into public.admin_events (user_id, kind, actor_id) values (p_user, p_kind, auth.uid());
end $$;

-- Signs the user out everywhere: their refresh tokens go with the sessions (on delete cascade);
-- access tokens already issued last until they expire.
create function public.admin_end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  delete from auth.sessions where user_id = p_user;
end $$;

-- Newest first, at most 10: audited email / name changes of the profile, and admin events.
-- A name or email set from empty (the profile's first name, given when the login is created) isn't a change.
create function public.admin_user_history(p_user uuid)
returns table (at timestamptz, actor_name text, kind text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_perm('delegates', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  return query
  with entries as (
    select a.at, a.user_id as actor_id, 'email_changed'::text as kind
    from public.audit_log a
    where a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'email', '') <> ''
      and a.before ->> 'email' is distinct from a.after ->> 'email'
    union all
    select a.at, a.user_id, 'name_changed'
    from public.audit_log a
    where a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'full_name', '') <> ''
      and a.before ->> 'full_name' is distinct from a.after ->> 'full_name'
    union all
    select e.at, e.actor_id, e.kind from public.admin_events e where e.user_id = p_user
  )
  select en.at, coalesce(nullif(p.full_name, ''), p.email), en.kind
  from entries en left join public.profiles p on p.user_id = en.actor_id
  order by en.at desc, en.kind
  limit 10;
end $$;

-- ── 4. The user's own step: clear the flag once a factor is verified ──────────────────────────
-- Self-service, so no area check: any signed-in user, for themselves only.
create function public.mfa_setup_done() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform app_private.fail('Sign in first.');
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') then
    perform app_private.fail('Finish setting up two-factor authentication first.');
  end if;
  update public.profiles set mfa_setup_required = false where user_id = auth.uid();
end $$;

revoke execute on function public.admin_change_email(uuid, text) from public, anon;
revoke execute on function public.admin_set_name(uuid, text) from public, anon;
revoke execute on function public.admin_require_mfa_setup(uuid) from public, anon;
revoke execute on function public.admin_record_event(uuid, text) from public, anon;
revoke execute on function public.admin_end_sessions(uuid) from public, anon;
revoke execute on function public.admin_user_history(uuid) from public, anon;
revoke execute on function public.mfa_setup_done() from public, anon;
grant execute on function public.admin_change_email(uuid, text) to authenticated;
grant execute on function public.admin_set_name(uuid, text) to authenticated;
grant execute on function public.admin_require_mfa_setup(uuid) to authenticated;
grant execute on function public.admin_record_event(uuid, text) to authenticated;
grant execute on function public.admin_end_sessions(uuid) to authenticated;
grant execute on function public.admin_user_history(uuid) to authenticated;
grant execute on function public.mfa_setup_done() to authenticated;
