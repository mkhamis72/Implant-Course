-- Branding (multi-tenant part 2): each company's name, colours and logo, in its own database.
-- Read by anyone (the login page renders before sign-in) through two definer functions; the tables
-- themselves stay closed. Written by admins only. Logo bytes live in their own table without the
-- audit trigger, so audit_log never stores images; every logo change bumps branding.logo_version,
-- which is audited.
create table public.branding (
  id boolean primary key default true check (id),
  name text check (name is null or length(trim(name)) between 2 and 60),
  brand_color text check (brand_color ~ '^#[0-9a-f]{6}$'),
  nav_color text check (nav_color ~ '^#[0-9a-f]{6}$'),
  logo_version int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.branding default values;

create table public.branding_logos (
  id boolean primary key default true check (id),
  bytes bytea not null check (octet_length(bytes) between 1 and 204800),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp'))
);

alter table public.branding enable row level security;
alter table public.branding_logos enable row level security;
revoke all on public.branding, public.branding_logos from public, anon, authenticated;

create trigger branding_set_updated_at before update on public.branding
  for each row execute function app_private.set_updated_at();
create trigger branding_audit after insert or update or delete on public.branding
  for each row execute function app_private.audit_row('id');

create function public.branding_public()
returns table (name text, brand_color text, nav_color text, logo_version int, has_logo boolean)
language sql stable security definer set search_path = '' as $$
  select b.name, b.brand_color, b.nav_color, b.logo_version, exists (select 1 from public.branding_logos)
  from public.branding b where b.id
$$;

create function public.branding_logo()
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select l.bytes, l.content_type from public.branding_logos l where l.id
$$;

create function public.update_branding(p_name text, p_brand_color text, p_nav_color text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  update public.branding set
    name = nullif(trim(coalesce(p_name, '')), ''),
    brand_color = lower(nullif(trim(coalesce(p_brand_color, '')), '')),
    nav_color = lower(nullif(trim(coalesce(p_nav_color, '')), ''))
  where id;
end $$;

create function public.set_branding_logo(p_bytes bytea, p_content_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  insert into public.branding_logos (id, bytes, content_type) values (true, p_bytes, p_content_type)
  on conflict (id) do update set bytes = excluded.bytes, content_type = excluded.content_type;
  update public.branding set logo_version = logo_version + 1 where id;
end $$;

create function public.clear_branding_logo() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  delete from public.branding_logos where id;
  update public.branding set logo_version = logo_version + 1 where id;
end $$;

revoke execute on function public.branding_public(), public.branding_logo() from public;
grant execute on function public.branding_public(), public.branding_logo() to anon, authenticated;
revoke execute on function public.update_branding(text, text, text), public.set_branding_logo(bytea, text),
  public.clear_branding_logo() from public, anon;
grant execute on function public.update_branding(text, text, text), public.set_branding_logo(bytea, text),
  public.clear_branding_logo() to authenticated;
