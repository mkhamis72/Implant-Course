-- One database (plan 3, release 4): company isolation is enforced by the database (spec §5).
--   * RLS is enabled and forced on every table in public and app_private.
--   * Every company table gets four restrictive policies, <table>_company_select|insert|update|delete,
--     ANDed with the existing role and area policies: a row is reachable only from a session bound to its
--     company.
--   * Every security-definer function in public and app_private, apart from the DEFINER_ALLOWLIST
--     (scripts/definer-allowlist.ts), is owned by tenant_definer, a NOBYPASSRLS role, so the company
--     policies apply inside the definers too (spike: docs/one-database/spike-result.md). tenant_definer
--     gets a permissive using (true) policy on every table; the restrictive policies do the isolation.
--     scripts/migrate.ts checks the owners after every later migration.
--   * company_id defaults to the session's company instead of academy: a row written with no bound
--     session has no company and fails the not-null constraint (fail closed).
-- Release 4 runs with the previous app version suspended.
set local lock_timeout = '5s';


-- ── tenant_definer ──────────────────────────────────────────────────────────────────────────────────
-- Roles are per cluster: a restored or re-created database may already have it.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'tenant_definer') then
    create role tenant_definer nologin nobypassrls;
  end if;
  -- An existing role must not bypass RLS: the company policies would then not apply inside the definers.
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tenant_definer' and (rolbypassrls or rolsuper)) then
    raise exception 'role tenant_definer must be NOSUPERUSER NOBYPASSRLS';
  end if;
end $$;
-- postgres isn't a superuser on Supabase: ALTER ... OWNER TO needs it to be a member of the new owner.
grant tenant_definer to postgres;
grant anon to tenant_definer;
grant usage on schema public, app_private, app to tenant_definer;
grant select, insert, update, delete on all tables in schema public, app_private to tenant_definer;
-- The migration ledger is postgres's alone: no grants and no tenant_definer policy (forced RLS with no
-- policy; postgres bypasses RLS).
revoke all on app_private.schema_migrations from tenant_definer;
grant usage, select on all sequences in schema public, app_private to tenant_definer;
-- public too: definers call security-invoker readers (implant_stage, delegate_report, …) that grant
-- execute to authenticated only.
grant execute on all functions in schema public, app_private, app to tenant_definer;
-- Tables and functions later migrations create work inside the definers without a grant of their own
-- (each new table still needs its tenant_definer policy: the tenant-definer-policies guard).
alter default privileges for role postgres in schema public, app_private
  grant select, insert, update, delete on tables to tenant_definer;
alter default privileges for role postgres in schema public, app_private
  grant usage, select on sequences to tenant_definer;
alter default privileges for role postgres in schema public, app_private, app
  grant execute on functions to tenant_definer;


-- ── Functions that must see past the caller's company ───────────────────────────────────────────────

-- member_elsewhere: whether the user belongs to a company other than p_company. Postgres-owned (schema
-- app), because the company policies hide other companies' membership rows from tenant_definer. Only the
-- definers below call it.
create function app.member_elsewhere(p_user uuid, p_company uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id <> p_company);
end $$;
alter function app.member_elsewhere(uuid, uuid) owner to postgres;
revoke all on function app.member_elsewhere(uuid, uuid) from public, anon, authenticated;
grant execute on function app.member_elsewhere(uuid, uuid) to tenant_definer;

-- other_active_admin: whether the company has an active admin besides p_user. Postgres-owned for the same
-- reason: the trigger below acts on the row's company, which needn't be the session's (postgres scripts,
-- the service role, a write with no bound session).
create function app.other_active_admin(p_company uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from public.company_members m
                 where m.company_id = p_company and m.role = 'admin' and m.active and m.user_id <> p_user);
end $$;
alter function app.other_active_admin(uuid, uuid) owner to postgres;
revoke all on function app.other_active_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function app.other_active_admin(uuid, uuid) to tenant_definer;

-- 0087's protect_last_member_admin, through app.other_active_admin.
create or replace function app_private.protect_last_member_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active or new.company_id <> old.company_id) then
    if not app.other_active_admin(old.company_id, old.user_id) then
      raise exception 'Cannot remove the last active admin' using hint = 'last_admin';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- 0086's bind_session, now also forgetting the caller's own bindings whose Auth session has ended (moved
-- here from bind_my_session: tenant_definer can't read auth.sessions or app.session_companies). The
-- session just bound is kept even if auth.sessions has no row for it.
create or replace function app.bind_session(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := app.current_session_id();
  v_user uuid := app.current_user_id();
  v_bound app.session_companies;
begin
  if v_session is null or v_user is null then
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
    and not exists (select 1 from auth.sessions s where s.id = sc.session_id);
end $$;

-- 0086's bind_my_session: the clean-up is now app.bind_session's.
create or replace function public.bind_my_session(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bind_session(p_company);
end $$;

-- 0090's delete_user: "another company" through app.member_elsewhere.
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
  if not app.member_elsewhere(p_user, v_company) then
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

-- 0090's delete_delegate: "another company" through app.member_elsewhere.
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

-- 0090's admin_change_email: "another company" through app.member_elsewhere. The email stays unique
-- across all profiles (tenant_definer reads every profile).
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
  if app.member_elsewhere(p_user, v_company) then
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

-- 0090's admin_set_name: "another company" through app.member_elsewhere.
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
  if app.member_elsewhere(p_user, v_company) then
    perform app_private.fail('This user also belongs to another company. Ask support to change their sign-in details.');
  end if;
  update public.profiles set full_name = v_name where user_id = p_user;
end $$;

-- 0089's audit_row: each row is logged in its company. A row with company_id is its company's, a
-- companies row its own; otherwise (profiles) the session's company. A person's row written with no bound
-- session (sign-up, scripts, an Auth delete) is logged in each company they belong to, and nowhere while
-- they belong to none.
create or replace function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_company uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);
  v_company := case
    when v_row ? 'company_id' then (v_row ->> 'company_id')::uuid
    when tg_table_schema = 'public' and tg_table_name = 'companies' then (v_row ->> 'id')::uuid
    else app.current_company_id()
  end;
  if v_company is not null then
    insert into public.audit_log (company_id, table_name, row_id, action, user_id, before, after)
    values (v_company, tg_table_name, v_row ->> tg_argv[0], tg_op, app.current_user_id(), v_before, v_after);
  elsif v_row ? 'user_id' then
    insert into public.audit_log (company_id, table_name, row_id, action, user_id, before, after)
    select m.company_id, tg_table_name, v_row ->> tg_argv[0], tg_op, app.current_user_id(), v_before, v_after
    from public.company_members m where m.user_id = (v_row ->> 'user_id')::uuid;
  end if;
  return coalesce(new, old);
end $$;


-- ── Company tables ──────────────────────────────────────────────────────────────────────────────────
-- 0083's company_tables: every table in public and app_private with a company_id column, so the
-- app_private ones (research_codes, pending_logins, file_no_counters) get the company policies too. Same
-- signature, so the grants stay. The company list, profiles and the migration ledger have no company_id.
create or replace function app.company_tables() returns setof regclass
language sql stable set search_path = '' as $$
  select c.oid::regclass from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private') and c.relkind = 'r'
    and c.relname not in ('companies', 'profiles', 'schema_migrations')
    and exists (select 1 from pg_catalog.pg_attribute a
                where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
$$;


-- ── Column defaults ─────────────────────────────────────────────────────────────────────────────────
-- created_by and the like: auth.uid() becomes app.current_user_id() (no auth.* outside schema app).
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl, a.attname
    from pg_catalog.pg_attrdef d
    join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_catalog.pg_class c on c.oid = d.adrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app_private') and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'auth.uid()'
  loop
    execute format('alter table %s alter column %I set default app.current_user_id()', r.tbl, r.attname);
  end loop;
end $$;

-- company_id: the session's company instead of academy (0084). company_members keeps no default (0085:
-- every membership names its company).
do $$
declare
  t regclass;
begin
  for t in select x from app.company_tables() x where x <> 'public.company_members'::regclass loop
    execute format('alter table %s alter column company_id set default app.current_company_id()', t);
  end loop;
end $$;


-- ── RLS and policies ────────────────────────────────────────────────────────────────────────────────
-- Forced RLS on every table in public and app_private, and a tenant_definer policy on each but the
-- migration ledger (only postgres, which bypasses RLS, touches it).
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl, c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p')
  loop
    if length(r.relname || '_tenant_definer') > 63 then
      raise exception 'policy name for % would be truncated', r.relname;
    end if;
    execute format('alter table %s enable row level security', r.tbl);
    execute format('alter table %s force row level security', r.tbl);
    if r.tbl <> 'app_private.schema_migrations'::regclass then
      execute format('create policy %I on %s for all to tenant_definer using (true) with check (true)',
                     r.relname || '_tenant_definer', r.tbl);
    end if;
  end loop;
end $$;

-- The four restrictive company policies on every company table.
do $$
declare
  t regclass;
  rel text;
  v_check constant text := 'company_id = (select app.current_company_id())';
begin
  for t in select x from app.company_tables() x loop
    select c.relname into rel from pg_catalog.pg_class c where c.oid = t;
    if length(rel || '_company_select') > 63 then
      raise exception 'company policy names for % would be truncated', rel;
    end if;
    execute format('create policy %I on %s as restrictive for select to public using (%s)',
                   rel || '_company_select', t, v_check);
    execute format('create policy %I on %s as restrictive for insert to public with check (%s)',
                   rel || '_company_insert', t, v_check);
    execute format('create policy %I on %s as restrictive for update to public using (%s) with check (%s)',
                   rel || '_company_update', t, v_check, v_check);
    execute format('create policy %I on %s as restrictive for delete to public using (%s)',
                   rel || '_company_delete', t, v_check);
  end loop;
end $$;

-- profiles is the person, not the company's (no company_id): a user reads their own row, and active staff
-- read the people of their company. Writes go through the definers (admin_set_name, admin_change_email).
drop policy profiles_select on public.profiles;
drop policy profiles_admin_update on public.profiles;
revoke update on public.profiles from authenticated;
create policy profiles_self on public.profiles for select to authenticated
  using (user_id = (select app.current_user_id()));
create policy profiles_company on public.profiles for select to authenticated
  using ((select public.is_active_user())
         and exists (select 1 from public.company_members m
                     where m.user_id = profiles.user_id and m.company_id = (select app.current_company_id())));

-- An admin reads the memberships of their own company only. The restrictive policies already limit it;
-- the admin branch says so too, so this policy never reads wider than its company on its own.
alter policy company_members_select on public.company_members
  using (user_id = (select app.current_user_id())
         or ((select public.is_admin()) and company_id = (select app.current_company_id())));

-- Never on the company alone: the company row is for its active staff.
alter policy companies_select_own on public.companies
  using (id = (select app.current_company_id()) and (select public.is_active_user()));

-- company-id-index: app.current_company_id() is looked up by session, admin_end_sessions by company.
create index session_companies_company_id_idx on app.session_companies (company_id);


-- ── Execute: anon only on the pre-login readers ─────────────────────────────────────────────────────
-- app_private is closed to the API roles (no schema usage), but functions default to execute for PUBLIC.
revoke execute on all functions in schema app_private from public, anon;
revoke execute on function public.is_active_user(), public.is_admin(),
  public.product_category(public.product_type) from public, anon;
grant execute on function public.is_active_user(), public.is_admin(),
  public.product_category(public.product_type) to authenticated;


-- ── Owners ──────────────────────────────────────────────────────────────────────────────────────────
-- Every definer in public and app_private outside the allowlist (spec §5; scripts/definer-allowlist.ts,
-- which migrate.ts checks) moves to tenant_definer. ALTER ... OWNER needs CREATE on the schema for the
-- new owner, granted only while the owners change (spike).
grant create on schema public, app_private to tenant_definer;
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prosecdef
      and pg_catalog.pg_get_userbyid(p.proowner) <> 'tenant_definer'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and n.nspname || '.' || p.proname not in (
        'app_private.mfa_satisfied', 'public.mfa_setup_done',
        'app_private.handle_new_user', 'app_private.default_permissions',
        'app_private.audit_row', 'public.admin_end_sessions',
        'public.branding_for', 'public.branding_logo_for',
        'public.branding_public', 'public.branding_logo')
  loop
    execute format('alter function %s owner to tenant_definer', r.sig);
  end loop;
end $$;
revoke create on schema public, app_private from tenant_definer;


-- ── Statistics ──────────────────────────────────────────────────────────────────────────────────────
-- Every query now filters on company_id = (initplan). On a table never analyzed the planner takes that
-- for one row and scans the company_id index instead of the parent's (measured: recall_list 9 s → 4 s on
-- the local stack after ANALYZE). Analyze the company tables once so the first plans are right.
do $$
declare
  t regclass;
begin
  for t in select x from app.company_tables() x loop
    execute format('analyze %s', t);
  end loop;
end $$;
