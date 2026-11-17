-- Modules, release 1, part 2 (spec docs/superpowers/specs/2026-11-16-modular-design.md): the console's writes
-- for plans (0109) and a company's type, plan and extras, service role only as 0105's console_* functions; and
-- the company list's History records those three columns. Release 1: only Course organizer plans and companies,
-- and every plan keeps inventory (always on until release 2).
set local lock_timeout = '5s';

-- Creates a plan (p_id null) or saves one; returns its id. A plan keeps its type.
create function public.console_save_plan(p_id uuid, p_name text, p_kind text, p_modules text[], p_actor text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_kind text;
  v_bad text;
  v_modules text[];
  v_id uuid;
begin
  if length(v_name) not between 2 and 60 then
    raise exception 'Give a name (2–60 characters).';
  end if;
  if p_id is not null then
    select p.kind into v_kind from public.plans p where p.id = p_id for update;
    if not found then
      raise exception 'Unknown plan';
    end if;
    if v_kind is distinct from p_kind then
      raise exception 'A plan can''t change its type.';
    end if;
  end if;
  if p_kind = 'clinic' then
    raise exception 'Clinic plans come in a later release.';
  end if;
  select m into v_bad from unnest(coalesce(p_modules, '{}')) m
  where m is null or m not in ('inventory', 'statistics') limit 1;
  if found then
    raise exception 'Unknown module %', coalesce(v_bad, 'null');
  end if;
  if exists (select 1 from public.plans p where p.name = v_name and p.id is distinct from p_id) then
    raise exception 'A plan called % already exists.', v_name;
  end if;
  v_modules := array(select distinct m from unnest(coalesce(p_modules, '{}') || array['inventory']) m order by m);

  begin
    if p_id is null then
      insert into public.plans (name, kind, modules, updated_at, updated_by)
      values (v_name, p_kind, v_modules, now(), p_actor)
      returning id into v_id;
    else
      update public.plans set name = v_name, modules = v_modules, updated_at = now(), updated_by = p_actor
      where id = p_id
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'A plan called % already exists.', v_name;
  end;
  return v_id;
end $$;

-- A company's type, plan and extra modules, recorded in company_log by companies_list_audit with p_actor.
create function public.console_set_company_plan(p_slug text, p_kind text, p_plan uuid, p_extras text[], p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
begin
  if p_kind = 'clinic' then
    raise exception 'Clinic companies come in a later release.';
  end if;
  select m into v_bad from unnest(coalesce(p_extras, '{}')) m
  where m is null or m not in ('inventory', 'statistics') limit 1;
  if found then
    raise exception 'Unknown module %', coalesce(v_bad, 'null');
  end if;
  if not exists (select 1 from public.plans p where p.id = p_plan and p.kind = p_kind) then
    raise exception 'Choose a plan for this type of company.';
  end if;
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  update public.companies
  set kind = p_kind, plan_id = p_plan,
      extra_modules = array(select distinct m from unnest(coalesce(p_extras, '{}')) m order by m)
  where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

-- Owned by postgres (scripts/definer-allowlist.ts), as 0105's: they act on any company and the global plan list.
alter function public.console_save_plan(uuid, text, text, text[], text) owner to postgres;
alter function public.console_set_company_plan(text, text, uuid, text[], text) owner to postgres;
revoke all on function public.console_save_plan(uuid, text, text, text[], text),
  public.console_set_company_plan(text, text, uuid, text[], text) from public, anon, authenticated, tenant_definer;
grant execute on function public.console_save_plan(uuid, text, text, text[], text),
  public.console_set_company_plan(text, text, uuid, text[], text) to service_role;

-- 0104's list log, now also with the company's type, plan and extras, so the console's History shows them.
create or replace function app_private.companies_list_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then jsonb_build_object('slug', old.slug, 'name', old.name, 'hosts', to_jsonb(old.hosts), 'status', old.status,
    'kind', old.kind, 'plan_id', old.plan_id, 'extra_modules', to_jsonb(old.extra_modules)) end;
  v_after jsonb := case when tg_op <> 'DELETE' then jsonb_build_object('slug', new.slug, 'name', new.name, 'hosts', to_jsonb(new.hosts), 'status', new.status,
    'kind', new.kind, 'plan_id', new.plan_id, 'extra_modules', to_jsonb(new.extra_modules)) end;
begin
  if coalesce(current_setting('app.list_copy', true), '') = 'on' or v_before is not distinct from v_after then
    return null;
  end if;
  insert into public.company_log (slug, action, actor, reason, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          coalesce(nullif(current_setting('app.actor', true), ''), current_user),
          nullif(current_setting('app.reason', true), ''),
          v_before, v_after);
  return null;
end $$;
