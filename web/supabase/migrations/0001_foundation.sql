create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.user_role as enum ('admin', 'organizer');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role public.user_role not null default 'organizer',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settings (
  id boolean primary key default true check (id),
  expiry_alert_days int not null default 60 check (expiry_alert_days between 1 and 365),
  session_timeout_minutes int not null default 30 check (session_timeout_minutes between 5 and 480),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create function app_private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();
create trigger settings_set_updated_at before update on public.settings
  for each row execute function app_private.set_updated_at();

-- Every auth user gets an inactive organizer profile; an Admin activates it on invite.
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.active);
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create function app_private.protect_last_admin() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and active and user_id <> old.user_id
    ) then
      raise exception 'Cannot remove the last active admin' using hint = 'last_admin';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect_last_admin before update on public.profiles
  for each row execute function app_private.protect_last_admin();

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
revoke all on public.profiles, public.settings from anon;

create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() or user_id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_select on public.settings for select to authenticated
  using (public.is_active_user());
create policy settings_admin_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
