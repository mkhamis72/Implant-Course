-- Modules, release 2, part 1 (spec docs/superpowers/specs/2026-11-16-modular-design.md): Inventory can be
-- switched off. A plan's features no longer force inventory; when it is off the stock tables are closed to
-- company users (every inventory reader is security invoker over them, and stock_on_hand is a security_invoker
-- view) and the delegate report shows no lot numbers. Every existing company is on Full, so nothing changes
-- for them; switching Inventory back on shows the same rows (nothing is deleted).
set local lock_timeout = '5s';

-- 0109's body without the forced inventory.
create or replace function app_private.company_features(p_company uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array(
      select distinct f from unnest(
        case when c.kind = 'course_organizer' then array['teaching'] else array[]::text[] end
        || p.modules || c.extra_modules
      ) f order by f)
    from public.companies c join public.plans p on p.id = c.plan_id
    where c.id = p_company), array[]::text[]);
$$;

-- 0110's body: a plan keeps the modules it is given (no longer forcing inventory).
create or replace function public.console_save_plan(p_id uuid, p_name text, p_kind text, p_modules text[], p_actor text) returns uuid
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
  v_modules := array(select distinct m from unnest(coalesce(p_modules, '{}')) m order by m);

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

-- The stock tables close for company users when Inventory is off (stock_movements' area_read also lets
-- Patients and Schedule viewers in, so it needs its own module check). Definers (tenant_definer) are not
-- affected: they gate themselves (tests/db/module-guards.test.ts).
create policy stock_lots_module_read on public.stock_lots as restrictive for select to authenticated
  using ((select public.module_on('inventory')));
create policy stock_movements_module_read on public.stock_movements as restrictive for select to authenticated
  using ((select public.module_on('inventory')));

-- 0046's body; a definer (it reads past RLS), so it hides the lot number itself when Inventory is off.
create or replace function public.my_report()
returns table (
  site_id uuid, role text, course_name text, patient_name text, file_no text, tooth smallint,
  state public.site_state, placed_on date, brand text, system text, platform text, diameter_mm numeric,
  length_mm numeric, description text, lot_no text, last_outcome public.followup_outcome, technique text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select s.id, case when s.placing_delegate_id = v_me then 'placing' else 'assisting' end,
         c.name, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         case when public.module_on('inventory') then l.lot_no end,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null and f.outcome is not null order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = v_me or s.assisting_delegate_id = v_me)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
end $$;
