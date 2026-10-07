-- Control project: the registry of companies (tenants). It holds no patient data. Only the service role
-- (the app server, the release workflow, the owner's scripts) reads or writes it.

create table public.tenants (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  hosts text[] not null check (cardinality(hosts) > 0),
  supabase_url text not null check (supabase_url ~ '^https://[a-z0-9]+\.supabase\.co$'),
  anon_key text not null check (length(anon_key) > 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  slug text not null,
  action text not null,
  actor text not null default current_user,
  before jsonb,
  after jsonb
);

-- Hosts: lower case, no port or trailing dot, each used by one company only.
create function public.tenants_normalise() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_host text;
  v_owner text;
begin
  new.hosts := array(select distinct regexp_replace(regexp_replace(lower(trim(h)), ':\d+$', ''), '\.$', '') from unnest(new.hosts) h);
  foreach v_host in array new.hosts loop
    if v_host is null or v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
      raise exception 'Invalid host: %', coalesce(v_host, 'null');
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('public.tenants.hosts'));
  select t.slug into v_owner from public.tenants t where t.slug <> new.slug and t.hosts && new.hosts limit 1;
  if v_owner is not null then
    raise exception 'A host of % is already used by %', new.slug, v_owner;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tenants_normalise before insert or update on public.tenants
  for each row execute function public.tenants_normalise();

create function public.tenants_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_audit (slug, action, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger tenants_audit after insert or update or delete on public.tenants
  for each row execute function public.tenants_audit();

alter table public.tenants enable row level security;
alter table public.tenant_audit enable row level security;
revoke all on public.tenants, public.tenant_audit from public, anon, authenticated;
-- Supabase default privileges give service_role everything on new tables; keep only what is needed (no truncate).
revoke all on public.tenants, public.tenant_audit from service_role;
grant select, insert, update, delete on public.tenants to service_role;
grant select on public.tenant_audit to service_role;
revoke execute on function public.tenants_normalise(), public.tenants_audit() from public, anon, authenticated;

-- Company secrets live in Vault as tenant/<slug>/<name>; this is the only way to read them.
create function public.tenant_secret(p_slug text, p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if p_name is null or p_name not in ('service_role_key', 'database_url') then
    raise exception 'Unknown secret %', p_name;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'tenant/' || p_slug || '/' || p_name;
  return v_secret;
end $$;
revoke execute on function public.tenant_secret(text, text) from public, anon, authenticated;
grant execute on function public.tenant_secret(text, text) to service_role;
