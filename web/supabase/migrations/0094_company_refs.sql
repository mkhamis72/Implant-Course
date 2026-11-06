set local lock_timeout = '5s';

-- A company names only its own rows (task 7's isolation sweep):
--   * study codes are keyed per company. research_codes kept 0070's (entity, entity_id) key, so B handing
--     A's course to research_code / assign_research_codes stored B's code for A's row, and A then never got
--     one. Codes are now stored only for rows of the caller's company, under (company_id, entity, entity_id).
--     The code itself stays unique across companies.
--   * create_pending_login refuses another company's delegate, as add_existing_member does.
-- Same signatures, so the grants and the owner (tenant_definer, 0092) stay.

-- ── Study codes ─────────────────────────────────────────────────────────────────────────────────────
alter table app_private.research_codes
  drop constraint research_codes_pkey,
  add constraint research_codes_pkey primary key (company_id, entity, entity_id);

-- Whether the id is a row of the bound company in the entity's table. Invoker: called from the research
-- definers (tenant_definer), never by users.
create function app_private.is_company_row(p_entity text, p_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case p_entity
    when 'patient' then exists (select 1 from public.patients x where x.id = p_id and x.company_id = app.current_company_id())
    when 'implant' then exists (select 1 from public.implant_sites x where x.id = p_id and x.company_id = app.current_company_id())
    when 'restoration' then exists (select 1 from public.restorations x where x.id = p_id and x.company_id = app.current_company_id())
    when 'delegate' then exists (select 1 from public.delegates x where x.id = p_id and x.company_id = app.current_company_id())
    when 'supervisor' then exists (select 1 from public.supervisors x where x.id = p_id and x.company_id = app.current_company_id())
    when 'course' then exists (select 1 from public.courses x where x.id = p_id and x.company_id = app.current_company_id())
    else false
  end
$$;
revoke all on function app_private.is_company_row(text, uuid) from public, anon, authenticated;
grant execute on function app_private.is_company_row(text, uuid) to tenant_definer;

-- 0070's research_code: null for an id that is not a row of the caller's company (as for a null id).
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
  if p_entity is null or p_entity not in ('patient', 'implant', 'restoration', 'delegate', 'supervisor', 'course') then
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

-- 0070's assign_research_codes: only the caller's company's rows get codes (the course and delegate
-- filters are taken as given, so they are checked too).
create or replace function public.assign_research_codes(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  loop
    begin
      with o as (
        select * from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system)
      ), r as (
        select distinct x.id, x.patient_id, x.delegate_id, x.supervisor_id
        from public.restorations x
        join public.restoration_sites rs on rs.restoration_id = x.id
        where rs.site_id in (select o.site_id from o) and x.voided_at is null
      ), wanted (entity, entity_id) as (
        select 'implant', o.site_id from o
        union select 'patient', o.patient_id from o
        union select 'course', o.course_id from o
        union select 'delegate', s.placing_delegate_id from public.implant_sites s where s.id in (select o.site_id from o)
        union select 'supervisor', s.supervisor_id from public.implant_sites s where s.id in (select o.site_id from o)
        union select 'restoration', r.id from r
        union select 'patient', r.patient_id from r
        union select 'delegate', r.delegate_id from r
        union select 'supervisor', r.supervisor_id from r
        union select 'course', p_course
        union select 'delegate', p_delegate
      )
      insert into app_private.research_codes (company_id, entity, entity_id, code)
      select v_company, w.entity, w.entity_id, app_private.research_code_draw(w.entity)
      from wanted w
      where w.entity_id is not null
        and app_private.is_company_row(w.entity, w.entity_id)
        and not exists (select 1 from app_private.research_codes rc
                        where rc.company_id = v_company and rc.entity = w.entity and rc.entity_id = w.entity_id)
      order by w.entity, w.entity_id
      on conflict (company_id, entity, entity_id) do nothing;
      exit;
    exception when unique_violation then
      -- A drawn code belongs to another entity: draw them all again.
    end;
  end loop;
end $$;


-- ── Pending logins ──────────────────────────────────────────────────────────────────────────────────
-- 0088's create_pending_login: the delegate must be the caller's company's (add_existing_member's check).
create or replace function public.create_pending_login(p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  if p_delegate_id is not null
     and not exists (select 1 from public.delegates d where d.company_id = v_company and d.id = p_delegate_id) then
    perform app_private.fail('Delegate not found.');
  end if;
  insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
  values (v_company, v_email, coalesce(trim(p_full_name), ''), p_role, p_delegate_id, app.current_user_id())
  on conflict (company_id, email) do update
    set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
        created_by = excluded.created_by, created_at = now();
end $$;
