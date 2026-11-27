-- Statistics for zygomatic and full-arch work (project E; spec
-- docs/superpowers/specs/2026-11-27-statistics-advanced-rehab-design.md, plan
-- docs/superpowers/plans/2026-11-27-statistics-advanced-rehab.md). Additive: new readers and a new study-code entity.
--   * implant_rehab_vars: implant type, geometry (0139) and current full-arch case (0142) per implant of the research
--     set, merged by implant into Compare by and Explore (as implant_outcomes_groups, 0071).
--   * analysis_full_arch_cases: one row per case with at least one implant in the set, with what the TS case rule
--     (src/lib/full-arch/cases.ts) needs to derive its status: every site of the case and its live restorations.
--   * full_arch_planned_cases: the company's open cases with no placed implant (unfiltered), for the Full arch note.
--   * research_export_implant_rehab / research_export_full_arch_cases: the export's coded versions.
--   * Study codes: entity full_arch_case, prefix A-.
-- Every reader is security invoker, takes the six research filters, starts from implant_outcomes_detail (0069) and
-- returns nothing without View on Research and on Patients. No free text is read (entry point, trajectory, case
-- name / notes, close reason, stage lab / occlusion / notes).
set local lock_timeout = '5s';

-- ── 1. Study codes: full_arch_case → A- ──────────────────────────────────────────────────────────────
alter table app_private.research_codes drop constraint research_codes_entity_check,
  add constraint research_codes_entity_check
    check (entity in ('patient', 'implant', 'restoration', 'delegate', 'supervisor', 'course', 'full_arch_case'));

-- 0070's draw, plus A- for a full-arch case.
create or replace function app_private.research_code_draw(p_entity text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_prefix text;
  v_bytes bytea;
  v_code text;
begin
  v_prefix := case p_entity when 'patient' then 'P-' when 'implant' then 'I-' when 'restoration' then 'R-'
    when 'delegate' then 'D-' when 'supervisor' then 'S-' when 'course' then 'C-' when 'full_arch_case' then 'A-' end;
  if v_prefix is null then
    perform app_private.fail(format('Unknown study code entity: %s.', p_entity));
  end if;
  -- The first 6 bytes of a v4 uuid are random (strong random source); 256 is a multiple of 32, so unbiased.
  v_bytes := uuid_send(gen_random_uuid());
  v_code := v_prefix;
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, i) % 32, 1);
  end loop;
  return v_code;
end $$;

-- 0094's company-row check, plus full_arch_cases.
create or replace function app_private.is_company_row(p_entity text, p_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case p_entity
    when 'patient' then exists (select 1 from public.patients x where x.id = p_id and x.company_id = app.current_company_id())
    when 'implant' then exists (select 1 from public.implant_sites x where x.id = p_id and x.company_id = app.current_company_id())
    when 'restoration' then exists (select 1 from public.restorations x where x.id = p_id and x.company_id = app.current_company_id())
    when 'delegate' then exists (select 1 from public.delegates x where x.id = p_id and x.company_id = app.current_company_id())
    when 'supervisor' then exists (select 1 from public.supervisors x where x.id = p_id and x.company_id = app.current_company_id())
    when 'course' then exists (select 1 from public.courses x where x.id = p_id and x.company_id = app.current_company_id())
    when 'full_arch_case' then exists (select 1 from public.full_arch_cases x where x.id = p_id and x.company_id = app.current_company_id())
    else false
  end
$$;

-- 0094's research_code, accepting full_arch_case. Same signature, so the grants and the owner (tenant_definer) stay.
create or replace function public.research_code(p_entity text, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  v_code text;
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  if p_entity is null
     or p_entity not in ('patient', 'implant', 'restoration', 'delegate', 'supervisor', 'course', 'full_arch_case') then
    perform app_private.fail(format('Unknown study code entity: %s.', p_entity));
  end if;
  if p_id is null or not app_private.is_company_row(p_entity, p_id) then
    return null;
  end if;
  select rc.code into v_code from app_private.research_codes rc
  where rc.company_id = v_company and rc.entity = p_entity and rc.entity_id = p_id;
  if found then
    return v_code;
  end if;
  loop
    begin
      insert into app_private.research_codes (company_id, entity, entity_id, code)
      values (v_company, p_entity, p_id, app_private.research_code_draw(p_entity))
      on conflict (company_id, entity, entity_id) do nothing;
      exit;
    exception when unique_violation then
      -- The code belongs to another entity: draw again.
    end;
  end loop;
  -- A concurrent export may have stored this entity's code first.
  select rc.code into v_code from app_private.research_codes rc
  where rc.company_id = v_company and rc.entity = p_entity and rc.entity_id = p_id;
  return v_code;
end $$;

-- ── 2. Implant level ─────────────────────────────────────────────────────────────────────────────────
-- The implants of implant_outcomes_detail with their type, geometry and current case (null when in none). An
-- implant moved from a closed case to a newer one has the newer case_id, so it counts there only.
create function public.implant_rehab_vars(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, implant_type text, angulation_deg numeric, angulation_direction text, anchorage text,
  case_id uuid, case_configuration text)
language sql stable security invoker set search_path = '' as $$
  select o.site_id, s.implant_type, s.angulation_deg, s.angulation_direction, s.anchorage, s.case_id, fc.configuration
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_sites s on s.id = o.site_id
  left join public.full_arch_cases fc on fc.id = s.case_id
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by o.site_id;
$$;

-- ── 3. Case level ────────────────────────────────────────────────────────────────────────────────────
-- The cases with at least one implant in the filtered set (implant_outcomes_detail: placed implants only), so a
-- planned-only case, or a closed case whose implants all moved on, is not returned. What a case contributes is
-- read whatever the filters: every site (planned ones included) and its live restorations with their sites, which
-- is what the TS case rule (src/lib/full-arch/cases.ts) needs. Placed = state placed, restored or failed; failed =
-- state failed; first placement over every site with a placement date. Problems: the live ones on live restorations.
create function public.analysis_full_arch_cases(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (case_id uuid, patient_id uuid, file_no text, arch text, configuration text, closed_at timestamptz,
  first_placed_on date, implants_placed int, implants_failed int, bridge_problems int, sites jsonb, bridges jsonb)
language sql stable security invoker set search_path = '' as $$
  with ids as (
    select distinct s.case_id
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
    join public.implant_sites s on s.id = o.site_id
    where s.case_id is not null
  )
  select fc.id, fc.patient_id, p.file_no, fc.arch, fc.configuration, fc.closed_at, f.first_placed_on,
         f.implants_placed, f.implants_failed, f.bridge_problems, f.sites, f.bridges
  from ids
  join public.full_arch_cases fc on fc.id = ids.case_id
  join public.patients p on p.id = fc.patient_id
  cross join lateral (
    select
      (select min(s.placed_on) from public.implant_sites s where s.case_id = fc.id and s.placed_on is not null)
        as first_placed_on,
      (select count(*) from public.implant_sites s
       where s.case_id = fc.id and s.state in ('placed', 'restored', 'failed'))::int as implants_placed,
      (select count(*) from public.implant_sites s where s.case_id = fc.id and s.state = 'failed')::int
        as implants_failed,
      (select count(*) from public.restoration_problems rp join public.restorations r on r.id = rp.restoration_id
       where r.case_id = fc.id and r.voided_at is null and rp.voided_at is null)::int as bridge_problems,
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'tooth', s.tooth, 'state', s.state) order by s.tooth, s.id)
                from public.implant_sites s where s.case_id = fc.id), '[]'::jsonb) as sites,
      coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'stage', r.stage,
                  'fitted_on', r.fitted_on, 'ended_on', r.ended_on,
                  'site_ids', coalesce((select jsonb_agg(rs.site_id order by rs.site_id) from public.restoration_sites rs
                                        where rs.restoration_id = r.id), '[]'::jsonb))
                  order by r.fitted_on, r.id)
                from public.restorations r where r.case_id = fc.id and r.voided_at is null), '[]'::jsonb) as bridges
  ) f
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by f.first_placed_on, fc.id;
$$;

-- Open cases with no placed implant (unfiltered: a planned case has no implant for the filters to select).
create function public.full_arch_planned_cases() returns int
language sql stable security invoker set search_path = '' as $$
  select count(*)::int
  from public.full_arch_cases fc
  where fc.closed_at is null
    and not exists (select 1 from public.implant_sites s
                    where s.case_id = fc.id and s.state in ('placed', 'restored', 'failed'))
    and (select public.can('research', 'view')) and (select public.can('patients', 'view'));
$$;

-- ── 4. Export ────────────────────────────────────────────────────────────────────────────────────────
-- Coded values, numbers, dates and study codes only. Volatile: research_code stores a code on first use.
create function public.research_export_implant_rehab(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, implant_type text, angulation_deg numeric, angulation_direction text, anchorage text,
  case_code text, case_configuration text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', v.site_id), v.implant_type, v.angulation_deg, v.angulation_direction,
         v.anchorage, public.research_code('full_arch_case', v.case_id), v.case_configuration
  from public.implant_rehab_vars(p_course, p_from, p_to, p_delegate, p_brand, p_system) v
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by 1;
$$;

-- sites / bridges carry the ids the TS case rule links by; the export derives status and the final-bridge date
-- from them and drops both before writing the file. Stage dates: the latest done_on per stage.
create function public.research_export_full_arch_cases(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (case_code text, patient_code text, arch text, configuration text, first_placed_on date, closed_on date,
  scan_on date, lab_design_on date, try_in_on date, implants_placed int, implants_failed int, bridge_problems int,
  sites jsonb, bridges jsonb)
language sql security invoker set search_path = '' as $$
  select public.research_code('full_arch_case', a.case_id), public.research_code('patient', a.patient_id),
         a.arch, a.configuration, a.first_placed_on, (a.closed_at at time zone 'Africa/Cairo')::date,
         (select max(st.done_on) from public.full_arch_stages st where st.case_id = a.case_id and st.stage = 'scan'),
         (select max(st.done_on) from public.full_arch_stages st where st.case_id = a.case_id and st.stage = 'lab_design'),
         (select max(st.done_on) from public.full_arch_stages st where st.case_id = a.case_id and st.stage = 'try_in'),
         a.implants_placed, a.implants_failed, a.bridge_problems, a.sites, a.bridges
  from public.analysis_full_arch_cases(p_course, p_from, p_to, p_delegate, p_brand, p_system) a
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by 1;
$$;

revoke execute on function public.implant_rehab_vars(uuid, date, date, uuid, text, text),
  public.analysis_full_arch_cases(uuid, date, date, uuid, text, text),
  public.full_arch_planned_cases(),
  public.research_export_implant_rehab(uuid, date, date, uuid, text, text),
  public.research_export_full_arch_cases(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.implant_rehab_vars(uuid, date, date, uuid, text, text),
  public.analysis_full_arch_cases(uuid, date, date, uuid, text, text),
  public.full_arch_planned_cases(),
  public.research_export_implant_rehab(uuid, date, date, uuid, text, text),
  public.research_export_full_arch_cases(uuid, date, date, uuid, text, text) to authenticated;
