-- Research part 5b: a View-only "research" permission area and filtering readers over the 5a readers
-- (implant_outcomes 0066, crown_outcomes 0067), which are left unchanged. Additive: a wider area check, a new
-- constraint, set_user_permissions accepting research (latest body from 0030), and two new functions.
-- New organizers get no research row: app_private.default_permissions() (0034) is unchanged. Admins pass can().

-- ── 1. Permission area ───────────────────────────────────────────────────────────────────────
alter table public.user_permissions drop constraint user_permissions_area_check;
alter table public.user_permissions add constraint user_permissions_area_check
  check (area in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates', 'research'));
-- Nothing writes on the research page: View is the only level.
alter table public.user_permissions add constraint user_permissions_research_view_only
  check (area <> 'research' or level = 'view');

create or replace function public.set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_level text;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change permissions.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You cannot change your own permissions.');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user and role = 'organizer') then
    perform app_private.fail('Permissions apply to organizers only.');
  end if;
  for v_key, v_level in select key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb)) loop
    if v_key not in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates', 'research') then
      perform app_private.fail(format('Unknown area: %s.', v_key));
    end if;
    if v_level is not null and v_level not in ('view', 'edit') then
      perform app_private.fail(format('Unknown level: %s.', v_level));
    end if;
    if v_key = 'research' and v_level = 'edit' then
      perform app_private.fail('Research can only be None or View.');
    end if;
  end loop;
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, area, level)
  select p_user, key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb))
  where value #>> '{}' is not null;
end $$;

-- ── 2. Filtering readers ─────────────────────────────────────────────────────────────────────
-- implant_outcomes plus the placing delegate, product and patient, filtered in SQL. Null parameters = no filter;
-- brand / system match products.brand / products.system exactly, so an implant with no product appears only when
-- both are null. Security invoker: needs View on Research here and View on Patients in implant_outcomes.
create function public.implant_outcomes_detail(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, patient_id uuid, tooth smallint, course_id uuid, placed_on date, loaded_on date,
  last_contact date, follow_up_days int, event boolean, event_on date, event_time_unknown boolean, at_loading text,
  year_1 text, year_2 text, year_3 text, year_5 text, latest_grade text, latest_grade_on date,
  latest_grade_reason text, ungraded_later int, biological_complications int, mechanical_complications int,
  version text, placing_delegate_id uuid, placing_delegate text, brand text, system text, product_id uuid,
  patient_name text, file_no text)
language sql stable security invoker set search_path = '' as $$
  select o.*, s.placing_delegate_id, d.full_name, p.brand, p.system, s.product_id, pt.full_name, pt.file_no
  from public.implant_outcomes(p_course, p_from, p_to) o
  join public.implant_sites s on s.id = o.site_id
  left join public.products p on p.id = s.product_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.patients pt on pt.id = o.patient_id
  where (select public.can('research', 'view'))
    and (p_delegate is null or s.placing_delegate_id = p_delegate)
    and (p_brand is null or p.brand = p_brand)
    and (p_system is null or p.system = p_system)
  order by o.placed_on, o.patient_id, o.tooth;
$$;
revoke execute on function public.implant_outcomes_detail(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.implant_outcomes_detail(uuid, date, date, uuid, text, text) to authenticated;

-- crown_outcomes plus the patient, for crowns with at least one implant in implant_outcomes_detail(...) with the
-- same parameters (so course and dates select the implants, not the crowns). One row per crown.
create function public.crown_outcomes_detail(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (restoration_id uuid, patient_id uuid, type text, teeth smallint[], fitted_on date, last_contact date,
  follow_up_days int, remade boolean, remade_on date, censored_by_implant_event boolean, problems int, version text,
  patient_name text, file_no text)
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select distinct rs.restoration_id
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) i
    join public.restoration_sites rs on rs.site_id = i.site_id
  )
  select co.*, pt.full_name, pt.file_no
  from public.crown_outcomes(null, null, null) co
  left join public.patients pt on pt.id = co.patient_id
  where (select public.can('research', 'view'))
    and co.restoration_id in (select chosen.restoration_id from chosen)
  order by co.fitted_on, co.patient_id, co.teeth;
$$;
revoke execute on function public.crown_outcomes_detail(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.crown_outcomes_detail(uuid, date, date, uuid, text, text) to authenticated;
