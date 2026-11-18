-- Modules, release 1 (spec docs/superpowers/specs/2026-11-16-modular-design.md): per-company plans that can
-- switch a module off. A company has a kind (Course organizer or Clinic: Course organizers get the `teaching`
-- feature), a plan (a named list of modules) and extra modules on top of it. public.can() now also needs the
-- area's feature on for the bound company, so the area policies and every require_perm definer close with it.
-- Switching off never touches rows: switching back on shows the same rows again. Additive: every existing
-- company starts on the seeded Full plan, which has every module.
set local lock_timeout = '5s';

-- ── Plans ───────────────────────────────────────────────────────────────────────────────────────────
-- A global list (no company_id), kept by the console with the service role; closed to company users.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('course_organizer', 'clinic')),
  modules text[] not null default '{}' check (modules <@ array['inventory', 'statistics']),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.plans enable row level security;
alter table public.plans force row level security;
-- The definer mechanism (0092): every table has one, the tenant-definer-policies guard checks it.
create policy plans_tenant_definer on public.plans for all to tenant_definer using (true) with check (true);
revoke all on public.plans from public, anon, authenticated, service_role;
grant select on public.plans to service_role;

insert into public.plans (id, name, kind, modules)
values ('fa110000-0000-4000-8000-000000000001', 'Full', 'course_organizer', '{inventory,statistics}');

-- ── Company type, plan and extras ───────────────────────────────────────────────────────────────────
alter table public.companies
  add column kind text not null default 'course_organizer' check (kind in ('course_organizer', 'clinic')),
  add column plan_id uuid not null default 'fa110000-0000-4000-8000-000000000001' references public.plans (id),
  add column extra_modules text[] not null default '{}' check (extra_modules <@ array['inventory', 'statistics']);
create index companies_plan_id_idx on public.companies (plan_id);

-- ── Features ────────────────────────────────────────────────────────────────────────────────────────
-- A company's features: teaching for a Course organizer, its plan's modules, its extras, and inventory
-- (always on until release 2). Distinct and sorted; empty for an unknown company.
create function app_private.company_features(p_company uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct f from unnest(
        case when c.kind = 'course_organizer' then array['teaching'] else array[]::text[] end
        || p.modules || c.extra_modules
        || array['inventory']  -- always on until release 2
      ) f order by f)
    from public.companies c join public.plans p on p.id = c.plan_id
    where c.id = p_company), array[]::text[]);
$$;

-- Whether the feature is on for the caller's bound company; false without one.
create function public.module_on(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_feature = any(app_private.company_features(app.current_company_id())), false);
$$;

-- The bound company's kind, plan name and features (one row; none without a bound company).
create function public.my_company_plan() returns table (kind text, plan_name text, features text[])
language sql stable security definer set search_path = '' as $$
  select c.kind, p.name, app_private.company_features(c.id)
  from public.companies c join public.plans p on p.id = c.plan_id
  where c.id = app.current_company_id();
$$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it). It reads every company and plan
-- (their tenant_definer policies); callers reach only their bound company's row through module_on and
-- my_company_plan, since app_private is closed to them.
grant create on schema public, app_private to tenant_definer;
alter function app_private.company_features(uuid) owner to tenant_definer;
alter function public.module_on(text) owner to tenant_definer;
alter function public.my_company_plan() owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function app_private.company_features(uuid) from public, anon, authenticated;
revoke execute on function public.module_on(text), public.my_company_plan() from public, anon;
grant execute on function public.module_on(text), public.my_company_plan() to authenticated;

-- ── can(): the 0089 body, and the area's feature on ─────────────────────────────────────────────────
create or replace function public.can(p_area text, p_level text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.mfa_satisfied() and exists (
    select 1 from public.company_members m
    where m.company_id = app.current_company_id() and m.user_id = app.current_user_id() and m.active
      and (m.role = 'admin' or (m.role = 'organizer' and exists (
        select 1 from public.user_permissions up
        where up.company_id = m.company_id and up.user_id = m.user_id and up.area = p_area
          and (up.level = 'edit' or p_level = 'view')))))
    and case p_area
      when 'research' then public.module_on('statistics')
      when 'inventory' then public.module_on('inventory')
      when 'courses' then public.module_on('teaching')
      when 'delegates' then public.module_on('teaching')
      else true
    end;
end $$;

-- research_exports is read by admins without can() (0070's research_exports_admin_read): close it too.
create policy research_exports_module_read on public.research_exports as restrictive for select to authenticated
  using ((select public.module_on('statistics')));
