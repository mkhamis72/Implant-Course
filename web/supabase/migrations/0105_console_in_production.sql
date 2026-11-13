set local lock_timeout = '5s';

-- Merge of the control project into this database, release 1 (docs/superpowers/specs/
-- 2026-11-14-merge-control-into-production-design.md): the console's admins and its list functions, next to
-- the company list of 0104. Unused until release 2 switches the console over. Named apart from the control
-- project's console_admins / console_* (tests/db/control.test.ts applies that schema to this database).
-- Not recreated: console_register_tenant, console_replace_secrets, console_set_company and tenant_secret, as
-- companies are created by provision_company (0095) and no per-company keys are kept any more.

-- Console sign-in accounts are Self-Auth users of the company 'console'. They get no profile and no
-- membership, so is_active_user() is false for them and they read no company's data.
create or replace function app_private.handle_new_self_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(new."realEmail");
  v_name text;
begin
  if new."companyId" = 'console' then
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.user_id = new.id) then
    return new;
  end if;
  delete from app_private.pending_logins where email = v_email and created_at < now() - interval '7 days';
  select pl.full_name into v_name from app_private.pending_logins pl
  where pl.email = v_email and pl.company_id::text = new."companyId" order by pl.created_at desc limit 1;
  if not found then
    perform app_private.fail('No pending login for this address.');
  end if;
  insert into public.profiles (user_id, email, full_name) values (new.id, v_email, v_name);
  insert into public.company_members (company_id, user_id, role, active, delegate_id)
  select pl.company_id, new.id, pl.role, true, pl.delegate_id
  from app_private.pending_logins pl
  where pl.email = v_email and pl.company_id::text = new."companyId"
    and (pl.delegate_id is null
         or exists (select 1 from public.delegates d where d.company_id = pl.company_id and d.id = pl.delegate_id))
  on conflict do nothing;
  delete from app_private.pending_logins where email = v_email and company_id::text = new."companyId";
  return new;
end $$;

-- Who may use the console: a console account and its address, as control's console_admins.
create table public.console_users (
  user_id uuid primary key references self_auth."user" (id) on delete cascade,
  email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.console_users enable row level security;
alter table public.console_users force row level security;
create policy console_users_tenant_definer on public.console_users for all to tenant_definer using (true) with check (true);
revoke all on public.console_users from public, anon, authenticated, service_role;
grant select, insert, update on public.console_users to service_role;

-- As control's is_console_admin (control 0002): the second factor and an active console_users row. Reads the
-- token through app.current_aal / app.current_user_id, as every function outside schema app must (0089).
create function public.is_console_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_aal() = 'aal2', false)
     and exists (select 1 from public.console_users u where u.user_id = app.current_user_id() and u.active)
$$;

-- The console's writes to the list, service role only (the console checks is_console_user first). app.actor and
-- app.reason are what 0104's companies_list_audit records. Messages as in control 0002 / 0006.
create function public.console_update_company(p_slug text, p_name text, p_hosts text[], p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Control's tenants.name limit (control 0001); companies.name has none of its own.
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Give a name (2–120 characters).';
  end if;
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  update public.companies set name = trim(p_name), hosts = p_hosts where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_set_company_status(p_slug text, p_status text, p_reason text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'Give a reason (3–300 characters).';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status %', p_status;
  end if;
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  perform set_config('app.reason', trim(p_reason), true);
  update public.companies set status = p_status where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_log_company(p_slug text, p_action text, p_detail text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('first_admin_created', 'admin_password_reset', 'first_admin_invited', 'domain_added') then
    raise exception 'Unknown action %', p_action;
  end if;
  if not exists (select 1 from public.companies where slug = p_slug) then
    raise exception 'Unknown company %', p_slug;
  end if;
  insert into public.company_log (slug, action, actor, reason)
  values (p_slug, p_action, coalesce(nullif(trim(p_actor), ''), current_user), p_detail);
end $$;

-- Owned by postgres (scripts/definer-allowlist.ts), as provision_company: they act on any company, with no session.
alter function public.is_console_user() owner to postgres;
alter function public.console_update_company(text, text, text[], text) owner to postgres;
alter function public.console_set_company_status(text, text, text, text) owner to postgres;
alter function public.console_log_company(text, text, text, text) owner to postgres;
revoke all on function public.is_console_user() from public, anon, tenant_definer;
grant execute on function public.is_console_user() to authenticated;
revoke all on function public.console_update_company(text, text, text[], text),
  public.console_set_company_status(text, text, text, text),
  public.console_log_company(text, text, text, text) from public, anon, authenticated, tenant_definer;
grant execute on function public.console_update_company(text, text, text[], text),
  public.console_set_company_status(text, text, text, text),
  public.console_log_company(text, text, text, text) to service_role;
