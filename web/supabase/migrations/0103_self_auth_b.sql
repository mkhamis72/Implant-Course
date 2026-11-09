-- Self-Auth, Migration B (after the rollback window). Held by migrate.ts until the owner sets SELF_AUTH_B_HOLD=0
-- (docs/operations.md §E, "After the window"): once it runs, the previous app (Supabase Auth) no longer works,
-- so there is no rollback by redeploying. It:
--   - removes the auth.* branches that 0101 added to mfa_satisfied, mfa_setup_done, bind_session and
--     admin_end_sessions, and 0102's Supabase-era branch of console_add_first_admin;
--   - drops handle_new_user's trigger on auth.users, and 0101's delete triggers on auth.users and self_auth."user";
--   - re-adds the foreign keys that 0101 dropped, now to self_auth."user" with the old delete actions (profiles
--     cascade, created_by set null), which take over from 0101's delete trigger.
-- Owners, grants and DEFINER_ALLOWLIST entries are unchanged: create or replace keeps them.
set local lock_timeout = '5s';

-- ── Every user reference must have a Self-Auth account, or the keys can't be added ──────────────────────
-- Stops with the counts per table (the import missed someone, or a person left only in Supabase Auth with no
-- membership still has a profile). The runbook's pre-check lists them; nothing here is deleted.
do $$
declare
  v_table text;
  v_n bigint;
  v_missing text[] := '{}';
begin
  select count(*) into v_n from public.profiles p
  where not exists (select 1 from self_auth."user" u where u.id = p.user_id);
  if v_n > 0 then v_missing := v_missing || format('profiles: %s', v_n); end if;
  foreach v_table in array array['patients', 'delegates', 'products', 'courses', 'enrollments', 'sessions', 'talks'] loop
    execute format('select count(*) from public.%I x where x.created_by is not null
                    and not exists (select 1 from self_auth."user" u where u.id = x.created_by)', v_table) into v_n;
    if v_n > 0 then v_missing := v_missing || format('%s.created_by: %s', v_table, v_n); end if;
  end loop;
  if cardinality(v_missing) > 0 then
    raise exception 'Migration B: rows point at people with no Self-Auth account (%). Run self-auth:import, or remove those people first (docs/operations.md §E, After the window).',
      array_to_string(v_missing, ', ');
  end if;
end $$;

-- ── Helpers: Self-Auth only ──────────────────────────────────────────────────────────────────────────────

-- 0101's mfa_satisfied without auth.mfa_factors: a confirmed Self-Auth factor makes aal2 necessary.
create or replace function app_private.mfa_satisfied() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.current_user_id();
begin
  return (coalesce(app.current_aal(), 'aal1') = 'aal2'
          or not exists (select 1 from self_auth.totp_factor t where t.user_id = v_user and t.confirmed))
    and not exists (select 1 from public.company_members m
                    where m.company_id = app.current_company_id() and m.user_id = v_user and m.mfa_setup_required);
end $$;

-- 0101's mfa_setup_done without auth.mfa_factors: the Self-Auth factor must be newer than the latest reset.
create or replace function public.mfa_setup_done() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := app.current_user_id();
  v_company uuid := app.current_company_id();
  v_reset timestamptz;
begin
  if v_user is null then
    perform app_private.fail('Sign in first.');
  end if;
  if v_company is null then
    perform app_private.fail('This session is not linked to a company. Sign in again.');
  end if;
  v_reset := coalesce(
    (select max(e.at) from public.admin_events e where e.user_id = v_user and e.kind = 'mfa_reset'),
    '-infinity'::timestamptz);
  -- The factor must be newer than the latest reset: one that survived it (a failed deletion) is the
  -- lost phone's, and must not lift the requirement.
  if coalesce(app.current_aal(), '') <> 'aal2'
     or not exists (select 1 from self_auth.totp_factor t
                    where t.user_id = v_user and t.confirmed and t.created_at > v_reset) then
    perform app_private.fail('Finish setting up two-factor authentication first.');
  end if;
  update public.company_members set mfa_setup_required = false where company_id = v_company and user_id = v_user;
end $$;

-- 0101's bind_session without auth.sessions: a binding survives while its Self-Auth session is alive. Binding
-- itself needs a live Self-Auth session of the caller (id and user), so a token whose session doesn't exist in
-- self_auth.session (a leftover Supabase Auth token, a revoked or expired session) binds nothing.
create or replace function app.bind_session(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := app.current_session_id();
  v_user uuid := app.current_user_id();
  v_bound app.session_companies;
begin
  if v_session is null or v_user is null
     or not exists (select 1 from self_auth.session s
                    where s.id = v_session and s."userId" = v_user and s."expiresAt" > now()) then
    perform app_private.fail('No sign-in session.');
  end if;
  if not exists (select 1 from public.company_members m
                 where m.company_id = p_company and m.user_id = v_user) then
    perform app_private.fail('You do not have access to this company.');
  end if;
  insert into app.session_companies (session_id, company_id, user_id)
  values (v_session, p_company, v_user)
  on conflict (session_id) do nothing;
  select * into v_bound from app.session_companies where session_id = v_session;
  if v_bound.company_id <> p_company or v_bound.user_id <> v_user then
    perform app_private.fail('You do not have access to this company.');
  end if;
  delete from app.session_companies sc
  where sc.user_id = v_user
    and sc.session_id <> v_session
    and not exists (select 1 from self_auth.session s where s.id = sc.session_id and s."expiresAt" > now());
end $$;

-- 0101's admin_end_sessions without auth.sessions: the Self-Auth sessions bound to the caller's company.
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
  delete from self_auth.session s
  where s."userId" = p_user
    and s.id in (select sc.session_id from app.session_companies sc
                 where sc.company_id = v_company and sc.user_id = p_user);
end $$;

-- 0102's console_add_first_admin without the Supabase-era branch: an existing account is a Self-Auth user of
-- p_company with that real email; anyone else gets the pending admin login.
create or replace function public.console_add_first_admin(p_company uuid, p_email text, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company) then
    perform app_private.fail('Unknown company.');
  end if;
  select u.id into v_user from self_auth."user" u
  where u."companyId" = p_company::text and lower(u."realEmail") = v_email limit 1;
  if v_user is null then
    insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
    values (p_company, v_email, coalesce(trim(p_full_name), ''), 'admin', null, '00000000-0000-0000-0000-000000000000')
    on conflict (company_id, email) do update
      set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
          created_by = excluded.created_by, created_at = now();
  else
    insert into public.company_members (company_id, user_id, role, active, delegate_id)
    values (p_company, v_user, 'admin', true, null)
    on conflict (company_id, user_id) do update
      set role = excluded.role, active = excluded.active, delegate_id = excluded.delegate_id;
  end if;
end $$;

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────────────────
-- Supabase Auth no longer creates users: its provisioning trigger goes (the function stays, unused, so an
-- older migration's references and the definer allowlist stay valid). The delete stand-ins go; the keys below
-- do their work. The Self-Auth provisioning trigger (self_auth_user_created) stays.
drop trigger on_auth_user_created on auth.users;
drop trigger on_auth_user_deleted on auth.users;
drop trigger self_auth_user_deleted on self_auth."user";
drop function app_private.handle_deleted_user();

-- ── Foreign keys to self_auth."user" (0101 dropped the ones to auth.users) ──────────────────────────────
alter table public.profiles add constraint profiles_user_id_fkey
  foreign key (user_id) references self_auth."user" (id) on delete cascade;
alter table public.patients add constraint patients_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.delegates add constraint delegates_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.products add constraint products_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.courses add constraint courses_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.enrollments add constraint enrollments_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.sessions add constraint sessions_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
alter table public.talks add constraint talks_created_by_fkey
  foreign key (created_by) references self_auth."user" (id) on delete set null;
