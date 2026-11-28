-- Clean-up after the browser-built passport, exclude filters and screw sizes (0147–0151, released 2026-11-28, #144).
-- The app no longer calls any of these; the previous app version did, so they stayed one release.
--   * Stored passports (0145): the PDF bytes, their version rows and the download log. Dropping the tables
--     deletes the stored PDFs. Only passport_generations (0150) and passport_settings remain.
--   * search_patients (0098) and search_patients_count (0124): replaced by search_patients_v3 / _count_v2 (0147).
--     search_patients_v2 and patient_list_matches stay: the booking picker calls search_patients_v2.
--   * fit_component_v3 (0135): replaced by fit_component_v4 (0149).

drop function public.save_patient_passport(uuid, bytea, text);
drop function public.patient_passport_file(uuid);
drop table public.passport_downloads;
drop table public.patient_passport_files;
drop table public.patient_passports;

drop function public.search_patients(text, boolean, text[], uuid, uuid);
drop function public.search_patients_count(text, boolean, text[], uuid, uuid);

drop function public.fit_component_v3(
  uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid);

-- patient_history (latest definition: 0150) no longer lists patient_passports; same signature.
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations', 'radiographs', 'full_arch_cases',
                          'passport_generations')
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

-- Patients view stops reading the old stored passports' audit rows (latest definition: 0150); admins still read all.
drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems',
                           'radiographs', 'radiograph_bone_levels', 'full_arch_cases', 'full_arch_stages',
                           'passport_generations'))
  );
