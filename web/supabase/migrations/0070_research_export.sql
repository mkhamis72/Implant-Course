-- Research part 6: anonymised research export. Additive: stable study codes, an export log and one export reader
-- per table. The readers take the Research page's filters and start from implant_outcomes_detail (0069), so the
-- exported implants are the page's set. They return only coded (CHECK / enum) values, numbers, dates, booleans
-- and study codes: never names, contact details, file numbers, dob, raw ids or free text (notes, reasons, "other"
-- details, treatment text, graft product, check type, radiograph link). Exporting needs View on Research and on
-- Patients.

-- ── 1. Study codes ───────────────────────────────────────────────────────────────────────────
-- Random codes, stored once and reused, so an entity has the same code in every export. Never derived from the id.
create table app_private.research_codes (
  entity text not null check (entity in ('patient', 'implant', 'restoration', 'delegate', 'supervisor')),
  entity_id uuid not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  primary key (entity, entity_id)
);
revoke all on app_private.research_codes from public, anon, authenticated;

-- The code for one entity: P- patient, I- implant, R- restoration, D- delegate, S- supervisor, then 6 characters
-- from an alphabet without 0/O/1/I. Assigned on first use; a collision with another code draws again. Null id = null.
create function public.research_code(p_entity text, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_prefix text;
  v_bytes bytea;
  v_code text;
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  v_prefix := case p_entity when 'patient' then 'P-' when 'implant' then 'I-' when 'restoration' then 'R-'
    when 'delegate' then 'D-' when 'supervisor' then 'S-' end;
  if v_prefix is null then
    perform app_private.fail(format('Unknown study code entity: %s.', p_entity));
  end if;
  if p_id is null then
    return null;
  end if;
  select rc.code into v_code from app_private.research_codes rc where rc.entity = p_entity and rc.entity_id = p_id;
  if found then
    return v_code;
  end if;
  loop
    -- The first 6 bytes of a v4 uuid are random (strong random source); 256 is a multiple of 32, so unbiased.
    v_bytes := uuid_send(gen_random_uuid());
    v_code := v_prefix;
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, i) % 32, 1);
    end loop;
    begin
      insert into app_private.research_codes (entity, entity_id, code) values (p_entity, p_id, v_code)
      on conflict (entity, entity_id) do nothing;
      exit;
    exception when unique_violation then
      -- The code belongs to another entity: draw again.
    end;
  end loop;
  -- A concurrent export may have stored this entity's code first.
  select rc.code into v_code from app_private.research_codes rc where rc.entity = p_entity and rc.entity_id = p_id;
  return v_code;
end $$;
revoke execute on function public.research_code(text, uuid) from public, anon;
grant execute on function public.research_code(text, uuid) to authenticated;

-- ── 2. Export log ────────────────────────────────────────────────────────────────────────────
-- Who exported what. Written only by log_research_export; admins read it; nobody updates or deletes it.
create table public.research_exports (
  id uuid primary key default gen_random_uuid(),
  exported_by uuid not null,
  exported_at timestamptz not null default now(),
  format text not null check (format in ('xlsx', 'csv')),
  filters jsonb not null default '{}'::jsonb,
  row_counts jsonb not null default '{}'::jsonb
);
create index research_exports_at_idx on public.research_exports (exported_at desc);
create trigger research_exports_audit after insert or update or delete on public.research_exports
  for each row execute function app_private.audit_row('id');

revoke all on public.research_exports from public, anon, authenticated;
grant select on public.research_exports to authenticated;
alter table public.research_exports enable row level security;
create policy research_exports_select on public.research_exports for select to authenticated
  using (public.is_admin());
create policy research_exports_admin_read on public.research_exports as restrictive for select to authenticated
  using ((select public.is_admin()));

create function public.log_research_export(p_format text, p_filters jsonb, p_row_counts jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') then
    perform app_private.fail('Unknown export format.');
  end if;
  insert into public.research_exports (exported_by, format, filters, row_counts)
  values (auth.uid(), p_format, coalesce(p_filters, '{}'::jsonb), coalesce(p_row_counts, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.log_research_export(text, jsonb, jsonb) from public, anon;
grant execute on function public.log_research_export(text, jsonb, jsonb) to authenticated;

-- ── 3. Export readers ────────────────────────────────────────────────────────────────────────
-- All take the Research page's filters and are security invoker: implant_outcomes_detail needs View on Research
-- and on Patients, so without them every reader is empty. Volatile, because research_code stores new codes.

-- One row per exported implant: placement, product, surgical details, stability, scan / impression and every
-- implant_outcomes column (site_id / patient_id replaced by codes; course_id, a raw id, left out).
create function public.research_export_implants(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, tooth smallint, jaw text, placed_on date, technique text,
  brand text, system text, diameter_mm numeric, length_mm numeric, placing_delegate_code text, supervisor_code text,
  extraction_date date, placement_timing text, soft_tissue_phenotype text, keratinized_mucosa_mm numeric, flap text,
  torque_type text, healing text, primary_closure text, grafting_performed text, torque_ncm numeric, isq numeric,
  bone_type text, impression_type text, impression_taken_on date, loaded_on date, last_contact date,
  follow_up_days int, event boolean, event_on date, event_time_unknown boolean, at_loading text, year_1 text,
  year_2 text, year_3 text, year_5 text, latest_grade text, latest_grade_on date, latest_grade_reason text,
  ungraded_later int, biological_complications int, mechanical_complications int, version text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), o.tooth,
         case when o.tooth / 10 in (1, 2) then 'maxilla' when o.tooth / 10 in (3, 4) then 'mandible' end,
         o.placed_on, s.technique, o.brand, o.system, p.diameter_mm, p.length_mm,
         public.research_code('delegate', s.placing_delegate_id), public.research_code('supervisor', s.supervisor_id),
         su.extraction_date, su.placement_timing, su.soft_tissue_phenotype, su.keratinized_mucosa_mm, su.flap,
         su.torque_type, su.healing, su.primary_closure, su.grafting_performed, s.torque_ncm, s.isq, s.bone_type,
         s.impression_type, s.impression_taken_on, o.loaded_on, o.last_contact, o.follow_up_days, o.event, o.event_on,
         o.event_time_unknown, o.at_loading, o.year_1, o.year_2, o.year_3, o.year_5, o.latest_grade, o.latest_grade_on,
         o.latest_grade_reason, o.ungraded_later, o.biological_complications, o.mechanical_complications, o.version
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_sites s on s.id = o.site_id
  left join public.products p on p.id = s.product_id
  left join public.implant_surgery su on su.site_id = o.site_id
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth;
$$;

-- One row per patient with an exported implant: sex, age in whole years at the first exported placement (null
-- without dob) and the medical-history risk factors. Allergies, medications, other conditions and notes are free text.
create function public.research_export_patients(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (patient_code text, sex text, age_at_first_placement int, smoking text, cigarettes_per_day int,
  diabetes_status text, hba1c numeric, hba1c_date date, bisphosphonates_status text, anticoagulants_status text,
  radiotherapy_status text, osteoporosis_status text, periodontitis_history text, bruxism text,
  previous_implant_failure text)
language sql security invoker set search_path = '' as $$
  with x as (
    select o.patient_id, min(o.placed_on) as first_placed
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
    group by o.patient_id
  )
  select public.research_code('patient', x.patient_id), pt.sex,
         case when pt.dob is not null then date_part('year', age(x.first_placed, pt.dob))::int end,
         mh.smoking, mh.cigarettes_per_day, mh.diabetes_status, mh.hba1c, mh.hba1c_date, mh.bisphosphonates_status,
         mh.anticoagulants_status, mh.radiotherapy_status, mh.osteoporosis_status, mh.periodontitis_history,
         mh.bruxism, mh.previous_implant_failure
  from x
  join public.patients pt on pt.id = x.patient_id
  left join public.medical_history mh on mh.patient_id = x.patient_id
  where (select public.can('research', 'view'))
  order by x.first_placed, x.patient_id;
$$;

-- One row per non-voided visit of an exported implant, with all coded findings. Check type, notes, patient
-- concerns and recommended treatment are free text.
create function public.research_export_visits(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, date date, visit_key text, attendance text, outcome text,
  pain_score int, swelling text, suppuration text, plaque text, mobility text, probing_mesial numeric,
  probing_buccal numeric, probing_distal numeric, probing_lingual numeric, bop_mesial text, bop_buccal text,
  bop_distal text, bop_lingual text, isq numeric, prosthesis_status text, radiograph_taken text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), f.date,
         f.visit_key, f.attendance, f.outcome::text, f.pain_score, f.swelling, f.suppuration, f.plaque, f.mobility,
         f.probing_mesial, f.probing_buccal, f.probing_distal, f.probing_lingual, f.bop_mesial, f.bop_buccal,
         f.bop_distal, f.bop_lingual, f.isq, f.prosthesis_status, f.radiograph_taken
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_followups f on f.site_id = o.site_id and f.voided_at is null
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, f.date, f.created_at;
$$;

-- One row per non-voided X-ray × exported implant whose tooth is in the X-ray's teeth. Levels are null when that
-- implant wasn't measured on it. Link and notes are left out.
create function public.research_export_radiographs(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, tooth smallint, taken_on date, type text, purpose text,
  mesial_mm numeric, distal_mm numeric)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), o.tooth,
         r.taken_on, r.type, r.purpose, l.mesial_mm, l.distal_mm
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.radiographs r on r.patient_id = o.patient_id and o.tooth = any (r.teeth) and r.voided_at is null
  left join public.radiograph_bone_levels l on l.radiograph_id = r.id and l.site_id = o.site_id
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, r.taken_on, r.created_at;
$$;

-- One row per non-voided complication of an exported implant. The "other" type's name, treatment and notes are
-- free text.
create function public.research_export_complications(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, category text, type text, noticed_on date, resolved_on date,
  severity text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), k.category,
         k.type, k.noticed_on, k.resolved_on, k.severity
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_complications k on k.site_id = o.site_id and k.voided_at is null
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, k.noticed_on, k.created_at;
$$;

-- One row per non-voided restoration on at least one exported implant (all stages and types, current or ended),
-- with the codes of all its implants. Notes and the end reason are free text: only end_kind is exported.
create function public.research_export_restorations(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (restoration_code text, patient_code text, implant_codes text[], stage text, type text,
  teeth smallint[], fitted_on date, retention text, material text, delegate_code text, supervisor_code text,
  ended_on date, end_kind text)
language sql security invoker set search_path = '' as $$
  with chosen as (
    select distinct rs.restoration_id
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
    join public.restoration_sites rs on rs.site_id = o.site_id
  )
  select public.research_code('restoration', r.id), public.research_code('patient', r.patient_id),
         (select array_agg(public.research_code('implant', s.id) order by s.tooth)
          from public.restoration_sites rs join public.implant_sites s on s.id = rs.site_id
          where rs.restoration_id = r.id),
         r.stage, r.type, r.teeth, r.fitted_on, r.retention, r.material,
         public.research_code('delegate', r.delegate_id), public.research_code('supervisor', r.supervisor_id),
         r.ended_on, r.end_kind
  from public.restorations r
  where r.id in (select chosen.restoration_id from chosen) and r.voided_at is null
    and (select public.can('research', 'view'))
  order by r.fitted_on, r.patient_id, r.teeth;
$$;

-- One row per non-voided problem of an exported (non-voided) restoration. Notes are free text.
create function public.research_export_restoration_problems(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (restoration_code text, patient_code text, noticed_on date, type text, action text)
language sql security invoker set search_path = '' as $$
  with chosen as (
    select distinct rs.restoration_id
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
    join public.restoration_sites rs on rs.site_id = o.site_id
  )
  select public.research_code('restoration', r.id), public.research_code('patient', r.patient_id), q.noticed_on,
         q.type, q.action
  from public.restorations r
  join public.restoration_problems q on q.restoration_id = r.id and q.voided_at is null
  where r.id in (select chosen.restoration_id from chosen) and r.voided_at is null
    and (select public.can('research', 'view'))
  order by r.fitted_on, r.patient_id, r.teeth, q.noticed_on, q.created_at;
$$;

-- One row per graft of an exported implant (grafts are deleted, never voided). Product and notes are free text.
create function public.research_export_grafts(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, procedure text, timing text, performed_on date,
  material text, membrane text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), g.procedure,
         g.timing, g.performed_on, g.material, g.membrane
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_grafts g on g.site_id = o.site_id
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, g.created_at;
$$;

revoke execute on function public.research_export_implants(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_implants(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_patients(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_patients(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_visits(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_visits(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_radiographs(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_radiographs(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_complications(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_complications(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_restorations(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_restorations(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_restoration_problems(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_restoration_problems(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.research_export_grafts(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_grafts(uuid, date, date, uuid, text, text) to authenticated;
