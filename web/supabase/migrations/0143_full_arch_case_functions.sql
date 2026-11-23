-- Full-arch cases (C2), part 2: the functions that write cases, their stages and links, and History
-- (plan docs/superpowers/plans/2026-11-24-full-arch-cases.md, Task 2). Tables and the restoration trigger: 0142.
-- Every writer needs Edit on Patients and runs as tenant_definer, so it sees and writes only the bound
-- company's rows (0092): another company's patient, case, implant or restoration is "not found".
-- Additive: no existing function changes signature; patient_history keeps its own.
set local lock_timeout = '5s';

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────
-- The FDI quadrants of an arch (upper = 1–2, lower = 3–4).
create function app_private.arch_has_tooth(p_arch text, p_tooth integer) returns boolean
language sql immutable set search_path = '' as $$
  select (p_tooth / 10) = any (case p_arch when 'upper' then array[1, 2] when 'lower' then array[3, 4] end);
$$;

-- Locks the case for a write. Refuses a missing case, a stale p_updated_at and (p_open) a closed case.
create function app_private.lock_case(p_case uuid, p_updated_at timestamptz, p_open boolean)
returns public.full_arch_cases
language plpgsql set search_path = '' as $$
declare
  v_case public.full_arch_cases;
begin
  select * into v_case from public.full_arch_cases where id = p_case for update;
  if not found then
    perform app_private.fail('This case no longer exists.');
  end if;
  if p_updated_at is null or v_case.updated_at <> p_updated_at then
    perform app_private.fail('Someone else changed this case. Reload and try again.');
  end if;
  if p_open and v_case.closed_at is not null then
    perform app_private.fail('This case is closed.');
  end if;
  return v_case;
end $$;

-- Makes p_sites the case's implants. Each must be the case's patient's, on its arch, not removed, and in no
-- other open case; an implant in a closed case is taken over (it leaves the closed one). Implants of the
-- case not in p_sites leave it. The caller has locked the open case.
create function app_private.set_case_members(p_case public.full_arch_cases, p_sites uuid[])
returns void
language plpgsql set search_path = '' as $$
declare
  v_sites uuid[] := coalesce((select array_agg(distinct x) from unnest(p_sites) x), '{}');
  v_ok integer;
begin
  perform 1 from public.implant_sites where id = any (v_sites) order by id for update;
  select count(*) into v_ok
  from public.implant_sites s
  left join public.full_arch_cases o on o.company_id = s.company_id and o.id = s.case_id
  where s.id = any (v_sites)
    and s.patient_id = p_case.patient_id
    and s.state <> 'removed'
    and app_private.arch_has_tooth(p_case.arch, s.tooth)
    and (s.case_id is null or s.case_id = p_case.id or o.closed_at is not null);
  if v_ok <> cardinality(v_sites) or array_position(v_sites, null) is not null then
    perform app_private.fail('An implant must be this patient''s, on this arch, and not in another case.');
  end if;

  update public.implant_sites set case_id = null where case_id = p_case.id and id <> all (v_sites);
  update public.implant_sites set case_id = p_case.id where id = any (v_sites) and case_id is distinct from p_case.id;
end $$;

-- Name, notes and configuration as the case form sends them; refuses what the table would.
create function app_private.check_case_fields(p_configuration text, p_name text, p_notes text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_configuration is null or p_configuration not in ('all_on_4', 'all_on_6', 'all_on_x', 'other') then
    perform app_private.fail('Choose the configuration.');
  end if;
  if char_length(trim(coalesce(p_name, ''))) > 60 then
    perform app_private.fail('Keep the name to 60 characters.');
  end if;
  if char_length(trim(coalesce(p_notes, ''))) > 1000 then
    perform app_private.fail('Keep the notes to 1000 characters.');
  end if;
end $$;

revoke all on function app_private.arch_has_tooth(text, integer) from public;
revoke all on function app_private.lock_case(uuid, timestamptz, boolean) from public;
revoke all on function app_private.set_case_members(public.full_arch_cases, uuid[]) from public;
revoke all on function app_private.check_case_fields(text, text, text) from public;
grant execute on function app_private.arch_has_tooth(text, integer) to tenant_definer;
grant execute on function app_private.lock_case(uuid, timestamptz, boolean) to tenant_definer;
grant execute on function app_private.set_case_members(public.full_arch_cases, uuid[]) to tenant_definer;
grant execute on function app_private.check_case_fields(text, text, text) to tenant_definer;

-- ── create_full_arch_case ───────────────────────────────────────────────────────────────────────────
create function public.create_full_arch_case(
  p_patient uuid, p_arch text, p_configuration text, p_name text, p_notes text, p_sites uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_case public.full_arch_cases;
begin
  perform app_private.require_perm('patients', 'edit');
  -- The patient lock serialises two "start case" clicks, so the open-case check below holds.
  perform 1 from public.patients where id = p_patient for update;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  if p_arch is null or p_arch not in ('upper', 'lower') then
    perform app_private.fail('Choose the arch.');
  end if;
  perform app_private.check_case_fields(p_configuration, p_name, p_notes);
  if exists (select 1 from public.full_arch_cases
             where patient_id = p_patient and arch = p_arch and closed_at is null) then
    perform app_private.fail('This arch already has an open full-arch case.');
  end if;

  insert into public.full_arch_cases (patient_id, arch, configuration, name, notes)
  values (p_patient, p_arch, p_configuration, trim(coalesce(p_name, '')), trim(coalesce(p_notes, '')))
  returning * into v_case;
  perform app_private.set_case_members(v_case, p_sites);
  return v_case.id;
end $$;

-- ── update_full_arch_case ───────────────────────────────────────────────────────────────────────────
create function public.update_full_arch_case(
  p_case uuid, p_configuration text, p_name text, p_notes text, p_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.lock_case(p_case, p_updated_at, true);
  perform app_private.check_case_fields(p_configuration, p_name, p_notes);
  update public.full_arch_cases
  set configuration = p_configuration, name = trim(coalesce(p_name, '')), notes = trim(coalesce(p_notes, ''))
  where id = p_case;
end $$;

-- ── set_case_sites ──────────────────────────────────────────────────────────────────────────────────
-- Replaces the implants of an open case. Bumps the case's updated_at, so a second stale form is refused.
create function public.set_case_sites(p_case uuid, p_sites uuid[], p_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case public.full_arch_cases;
begin
  perform app_private.require_perm('patients', 'edit');
  v_case := app_private.lock_case(p_case, p_updated_at, true);
  perform app_private.set_case_members(v_case, p_sites);
  update public.full_arch_cases set updated_at = now() where id = p_case;
end $$;

-- ── set_case_restoration ────────────────────────────────────────────────────────────────────────────
-- Links a restoration to an open case (every tooth on the case's arch, same patient) or, with p_case null,
-- unlinks it. A restoration linked to a closed case stays with it (History); linking it to an open case
-- moves it, as with implants.
create function public.set_case_restoration(p_restoration uuid, p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_resto public.restorations;
  v_case public.full_arch_cases;
  v_current_closed boolean;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_resto from public.restorations where id = p_restoration for update;
  if not found then
    perform app_private.fail('Restoration not found.');
  end if;

  if p_case is null then
    if v_resto.case_id is null then
      return;
    end if;
    select closed_at is not null into v_current_closed from public.full_arch_cases where id = v_resto.case_id;
    if v_current_closed then
      perform app_private.fail('This case is closed.');
    end if;
    update public.restorations set case_id = null where id = p_restoration;
    return;
  end if;

  select * into v_case from public.full_arch_cases where id = p_case for update;
  if not found then
    perform app_private.fail('This case no longer exists.');
  end if;
  if v_case.closed_at is not null then
    perform app_private.fail('This case is closed.');
  end if;
  if v_resto.patient_id <> v_case.patient_id
     or exists (select 1 from unnest(v_resto.teeth) t where not app_private.arch_has_tooth(v_case.arch, t)) then
    perform app_private.fail('A restoration in a case must be this patient''s and on the case''s arch.');
  end if;
  if v_resto.case_id is distinct from p_case then
    update public.restorations set case_id = p_case where id = p_restoration;
  end if;
end $$;

-- ── record_case_stage / clear_case_stage ────────────────────────────────────────────────────────────
-- Creates or replaces one stage. Dates: from the case's first placement to today (Cairo); a stage needs a
-- placed implant in the case. Lab only on Lab and design; passive fit and occlusion only on the try-in.
create function public.record_case_stage(
  p_case uuid, p_stage text, p_done_on date, p_lab text, p_passive_fit boolean, p_occlusion text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case public.full_arch_cases;
  v_first date;
  v_lab text := nullif(trim(coalesce(p_lab, '')), '');
  v_occlusion text := nullif(trim(coalesce(p_occlusion, '')), '');
  v_notes text := trim(coalesce(p_notes, ''));
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_case from public.full_arch_cases where id = p_case for update;
  if not found then
    perform app_private.fail('This case no longer exists.');
  end if;
  if v_case.closed_at is not null then
    perform app_private.fail('This case is closed.');
  end if;
  if p_stage is null or p_stage not in ('scan', 'lab_design', 'try_in') then
    perform app_private.fail('Choose the stage.');
  end if;
  if v_lab is not null and p_stage <> 'lab_design' then
    perform app_private.fail('The lab is recorded only for Lab and design.');
  end if;
  if (p_passive_fit is not null or v_occlusion is not null) and p_stage <> 'try_in' then
    perform app_private.fail('Passive fit and occlusion are recorded only for the try-in.');
  end if;
  if char_length(coalesce(v_lab, '')) > 120 then
    perform app_private.fail('Keep the lab to 120 characters.');
  end if;
  if char_length(coalesce(v_occlusion, '')) > 500 then
    perform app_private.fail('Keep the occlusion to 500 characters.');
  end if;
  if char_length(v_notes) > 1000 then
    perform app_private.fail('Keep the notes to 1000 characters.');
  end if;

  select min(placed_on) into v_first from public.implant_sites
  where case_id = p_case and state in ('placed', 'restored', 'failed') and placed_on is not null;
  if v_first is null then
    perform app_private.fail('Record a stage after an implant of the case is placed.');
  end if;
  if p_done_on is null or p_done_on < v_first or p_done_on > public.cairo_today() then
    perform app_private.fail('The date must be between the first placement and today.');
  end if;

  insert into public.full_arch_stages (company_id, case_id, stage, done_on, lab, passive_fit, occlusion, notes)
  values (v_case.company_id, p_case, p_stage, p_done_on, v_lab, p_passive_fit, v_occlusion, v_notes)
  on conflict (case_id, stage) do update
  set done_on = excluded.done_on, lab = excluded.lab, passive_fit = excluded.passive_fit,
      occlusion = excluded.occlusion, notes = excluded.notes;
end $$;

create function public.clear_case_stage(p_case uuid, p_stage text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case public.full_arch_cases;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_case from public.full_arch_cases where id = p_case for update;
  if not found then
    perform app_private.fail('This case no longer exists.');
  end if;
  if v_case.closed_at is not null then
    perform app_private.fail('This case is closed.');
  end if;
  delete from public.full_arch_stages where case_id = p_case and stage = p_stage;
end $$;

-- ── close_full_arch_case / reopen_full_arch_case ────────────────────────────────────────────────────
-- closed_at and close_reason move together. A closed case keeps its implants and restorations until a new
-- case takes them. Reopening needs the arch to have no other open case.
create function public.close_full_arch_case(p_case uuid, p_reason text, p_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.lock_case(p_case, p_updated_at, true);
  if v_reason = '' then
    perform app_private.fail('Give a reason to close the case.');
  end if;
  if char_length(v_reason) > 500 then
    perform app_private.fail('Keep the reason to 500 characters.');
  end if;
  update public.full_arch_cases set closed_at = now(), close_reason = v_reason where id = p_case;
end $$;

create function public.reopen_full_arch_case(p_case uuid, p_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case public.full_arch_cases;
begin
  perform app_private.require_perm('patients', 'edit');
  v_case := app_private.lock_case(p_case, p_updated_at, false);
  if v_case.closed_at is null then
    return;
  end if;
  -- As in create: the patient lock serialises this with a new case on the same arch.
  perform 1 from public.patients where id = v_case.patient_id for update;
  if exists (select 1 from public.full_arch_cases
             where patient_id = v_case.patient_id and arch = v_case.arch and closed_at is null) then
    perform app_private.fail('This arch already has an open full-arch case.');
  end if;
  update public.full_arch_cases set closed_at = null, close_reason = null where id = p_case;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0140.
grant create on schema public, app_private to tenant_definer;
alter function public.create_full_arch_case(uuid, text, text, text, text, uuid[]) owner to tenant_definer;
alter function public.update_full_arch_case(uuid, text, text, text, timestamptz) owner to tenant_definer;
alter function public.set_case_sites(uuid, uuid[], timestamptz) owner to tenant_definer;
alter function public.set_case_restoration(uuid, uuid) owner to tenant_definer;
alter function public.record_case_stage(uuid, text, date, text, boolean, text, text) owner to tenant_definer;
alter function public.clear_case_stage(uuid, text) owner to tenant_definer;
alter function public.close_full_arch_case(uuid, text, timestamptz) owner to tenant_definer;
alter function public.reopen_full_arch_case(uuid, timestamptz) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function public.create_full_arch_case(uuid, text, text, text, text, uuid[]) from public, anon;
revoke execute on function public.update_full_arch_case(uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function public.set_case_sites(uuid, uuid[], timestamptz) from public, anon;
revoke execute on function public.set_case_restoration(uuid, uuid) from public, anon;
revoke execute on function public.record_case_stage(uuid, text, date, text, boolean, text, text) from public, anon;
revoke execute on function public.clear_case_stage(uuid, text) from public, anon;
revoke execute on function public.close_full_arch_case(uuid, text, timestamptz) from public, anon;
revoke execute on function public.reopen_full_arch_case(uuid, timestamptz) from public, anon;
grant execute on function public.create_full_arch_case(uuid, text, text, text, text, uuid[]) to authenticated;
grant execute on function public.update_full_arch_case(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.set_case_sites(uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.set_case_restoration(uuid, uuid) to authenticated;
grant execute on function public.record_case_stage(uuid, text, date, text, boolean, text, text) to authenticated;
grant execute on function public.clear_case_stage(uuid, text) to authenticated;
grant execute on function public.close_full_arch_case(uuid, text, timestamptz) to authenticated;
grant execute on function public.reopen_full_arch_case(uuid, timestamptz) to authenticated;

-- ── History ─────────────────────────────────────────────────────────────────────────────────────────
-- patient_history (latest definition: 0064) adds the patient's cases and their stages. A restoration's link
-- to a case (by 0142's trigger right after add_restoration, or by set_case_restoration) is a restorations
-- UPDATE of case_id only; it stays, and the app labels it "Linked to full-arch case".
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations', 'radiographs', 'full_arch_cases')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications',
                          'restoration_sites')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
     or (a.table_name = 'restoration_problems'
         and coalesce(a.after ->> 'restoration_id', a.before ->> 'restoration_id') in
             (select r.id::text from public.restorations r where r.patient_id = p_patient))
     or (a.table_name = 'radiograph_bone_levels'
         and coalesce(a.after ->> 'radiograph_id', a.before ->> 'radiograph_id') in
             (select x.id::text from public.radiographs x where x.patient_id = p_patient))
     or (a.table_name = 'full_arch_stages'
         and coalesce(a.after ->> 'case_id', a.before ->> 'case_id') in
             (select fc.id::text from public.full_arch_cases fc where fc.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

-- Patients view reads the new tables' audit rows too (latest definition: 0064).
drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems',
                           'radiographs', 'radiograph_bone_levels', 'full_arch_cases', 'full_arch_stages'))
  );
