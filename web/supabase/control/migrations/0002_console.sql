-- Console (multi-tenant part 4): who may use the super-admin console, and the only functions it writes
-- through. Console admins sign in against this project's Auth with TOTP; the app checks the row and aal2.
create table public.console_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.console_admins enable row level security;
revoke all on public.console_admins from public, anon, authenticated, service_role;
grant select, insert, update on public.console_admins to service_role;

create function public.is_console_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
     and exists (select 1 from public.console_admins a where a.user_id = auth.uid() and a.active)
$$;
revoke execute on function public.is_console_admin() from public, anon;
grant execute on function public.is_console_admin() to authenticated;

-- Who changed a company and why: set per transaction by the console functions (scripts pass 'script').
alter table public.tenant_audit add column reason text;

create or replace function public.tenants_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_audit (slug, action, actor, reason, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          coalesce(nullif(current_setting('app.actor', true), ''), current_user),
          nullif(current_setting('app.reason', true), ''),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- Local development and E2E register companies on the local stacks (http://127.0.0.1:<port>).
alter table public.tenants drop constraint tenants_supabase_url_check;
alter table public.tenants add constraint tenants_supabase_url_check
  check (supabase_url ~ '^https://[a-z0-9]+\.supabase\.co$' or supabase_url ~ '^http://(127\.0\.0\.1|localhost):[0-9]{2,5}$');

create schema if not exists control_private;
revoke all on schema control_private from public, anon, authenticated, service_role;

create function control_private.act(p_actor text, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
end $$;

create function control_private.put_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'Missing value for %', p_name;
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end $$;

create function public.console_register_tenant(
  p_slug text, p_name text, p_hosts text[], p_supabase_url text, p_anon_key text,
  p_service_role_key text, p_database_url text, p_actor text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  insert into public.tenants (slug, name, hosts, supabase_url, anon_key)
  values (p_slug, trim(p_name), p_hosts, p_supabase_url, p_anon_key)
  on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts,
    supabase_url = excluded.supabase_url, anon_key = excluded.anon_key;
  perform control_private.put_secret('tenant/' || p_slug || '/service_role_key', p_service_role_key);
  perform control_private.put_secret('tenant/' || p_slug || '/database_url', p_database_url);
end $$;

create function public.console_update_tenant(p_slug text, p_name text, p_hosts text[], p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  update public.tenants set name = trim(p_name), hosts = p_hosts where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_set_status(p_slug text, p_status text, p_reason text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'Give a reason (3–300 characters).';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status %', p_status;
  end if;
  perform control_private.act(p_actor, trim(p_reason));
  update public.tenants set status = p_status where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_replace_secrets(
  p_slug text, p_supabase_url text, p_anon_key text, p_service_role_key text, p_database_url text, p_actor text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  update public.tenants set supabase_url = p_supabase_url, anon_key = p_anon_key where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
  perform control_private.put_secret('tenant/' || p_slug || '/service_role_key', p_service_role_key);
  perform control_private.put_secret('tenant/' || p_slug || '/database_url', p_database_url);
end $$;

revoke execute on function public.console_register_tenant(text, text, text[], text, text, text, text, text),
  public.console_update_tenant(text, text, text[], text), public.console_set_status(text, text, text, text),
  public.console_replace_secrets(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.console_register_tenant(text, text, text[], text, text, text, text, text),
  public.console_update_tenant(text, text, text[], text), public.console_set_status(text, text, text, text),
  public.console_replace_secrets(text, text, text, text, text, text) to service_role;
