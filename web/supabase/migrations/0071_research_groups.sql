-- Research part 7: the per-implant group variables behind the Research page's "Compare by" panel. Additive: one
-- new reader. It returns the same implants as implant_outcomes_detail (0069) with the same six filters, plus the
-- grouping variables: technique and bone type from implant_sites, and the medical-history risk factors (0043).
-- A null (not recorded, or no medical-history row) stays null: the page shows it as "Not assessed".
-- Security invoker: needs View on Research (checked here and in the detail reader) and View on Patients.
create function public.implant_outcomes_groups(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, technique text, bone_type text, smoking text, diabetes_status text,
  periodontitis_history text)
language sql stable security invoker set search_path = '' as $$
  select o.site_id, s.technique, s.bone_type, m.smoking, m.diabetes_status, m.periodontitis_history
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_sites s on s.id = o.site_id
  left join public.medical_history m on m.patient_id = o.patient_id
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by o.site_id;
$$;
revoke execute on function public.implant_outcomes_groups(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.implant_outcomes_groups(uuid, date, date, uuid, text, text) to authenticated;
