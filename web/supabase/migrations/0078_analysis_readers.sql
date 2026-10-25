-- Explore clinical data, part 3: the readers behind Statistics → Explore. Each returns the implant set of
-- implant_outcomes_detail (0069) with the same six filters, needs View on Research and Patients, and holds no free
-- text. The analysis (windows, missing-data reasons, tests) is pure TS in src/lib/analysis/.

-- One row per placed implant: the factors (patient, product, site, surgery, people) and the implant-level outcomes.
-- membrane_used / sinus_procedure: yes when a graft has a membrane / is a sinus procedure; no when grafting was not
-- performed or the grafts have none; empty when grafting was never recorded.
create function public.analysis_implants(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, patient_id uuid, file_no text, tooth smallint, course_id uuid, placing_delegate_id uuid,
  supervisor_id uuid, placed_on date, age_at_placement int, sex text, smoking text, cigarettes_per_day int,
  diabetes_status text, hba1c numeric, periodontitis_history text, bruxism text, previous_implant_failure text,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, technique text, bone_type text,
  torque_ncm numeric, isq numeric, placement_timing text, grafting_performed text, membrane_used text,
  sinus_procedure text, soft_tissue_phenotype text, keratinized_mucosa_mm numeric, flap text, healing text,
  event boolean, event_on date, event_time_unknown boolean, follow_up_days int, latest_grade text,
  biological_complications int, mechanical_complications int, restoration_problems int, final_restoration_on date)
language sql stable security invoker set search_path = '' as $$
  select o.site_id, o.patient_id, p.file_no, o.tooth, o.course_id, s.placing_delegate_id, s.supervisor_id, o.placed_on,
         extract(year from age(o.placed_on, p.dob))::int, p.sex, m.smoking, m.cigarettes_per_day, m.diabetes_status,
         m.hba1c, m.periodontitis_history, m.bruxism, m.previous_implant_failure,
         pr.brand, pr.system, nullif(pr.platform, ''), pr.diameter_mm, pr.length_mm, s.technique, s.bone_type,
         s.torque_ncm, s.isq, su.placement_timing, su.grafting_performed,
         case when gr.membrane then 'yes' when gr.any_graft or su.grafting_performed = 'no' then 'no' end,
         case when gr.sinus then 'yes' when gr.any_graft or su.grafting_performed = 'no' then 'no' end,
         su.soft_tissue_phenotype, su.keratinized_mucosa_mm, su.flap, su.healing,
         o.event, o.event_on, o.event_time_unknown, o.follow_up_days, o.latest_grade,
         o.biological_complications, o.mechanical_complications,
         (select count(*)::int
            from public.restoration_sites rs
            join public.restorations r on r.id = rs.restoration_id and r.voided_at is null
            join public.restoration_problems rp on rp.restoration_id = r.id and rp.voided_at is null
           where rs.site_id = o.site_id),
         (select min(r.fitted_on)
            from public.restoration_sites rs
            join public.restorations r on r.id = rs.restoration_id and r.voided_at is null and r.stage = 'final'
           where rs.site_id = o.site_id)
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_sites s on s.id = o.site_id
  join public.patients p on p.id = o.patient_id
  left join public.medical_history m on m.patient_id = o.patient_id
  left join public.products pr on pr.id = s.product_id
  left join public.implant_surgery su on su.site_id = o.site_id
  cross join lateral (
    select count(*) > 0 as any_graft,
           coalesce(bool_or(g.membrane in ('resorbable', 'non_resorbable')), false) as membrane,
           coalesce(bool_or(g.procedure in ('sinus_crestal', 'sinus_lateral')), false) as sinus
    from public.implant_grafts g where g.site_id = o.site_id
  ) gr
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, o.site_id;
$$;

-- One row per non-voided visit of those implants, with probing and bleeding summarised (worst site; any bleeding).
create function public.analysis_visits(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, visit_id uuid, date date, days_since_placement int, attendance text, pain_score int,
  swelling text, suppuration text, plaque text, mobility text, probing_max numeric, bop_any text, isq numeric,
  recession_facial_mm numeric, recession_mesial_mm numeric, recession_distal_mm numeric)
language sql stable security invoker set search_path = '' as $$
  select o.site_id, f.id, f.date, (f.date - o.placed_on)::int, coalesce(f.attendance, 'attended'), f.pain_score,
         f.swelling, f.suppuration, f.plaque, f.mobility,
         greatest(f.probing_mesial, f.probing_buccal, f.probing_distal, f.probing_lingual),
         case when 'yes' in (f.bop_mesial, f.bop_buccal, f.bop_distal, f.bop_lingual) then 'yes'
              when coalesce(f.bop_mesial, f.bop_buccal, f.bop_distal, f.bop_lingual) is not null then 'no' end,
         f.isq, f.recession_facial_mm, f.recession_mesial_mm, f.recession_distal_mm
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_followups f on f.site_id = o.site_id and f.voided_at is null
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by o.site_id, f.date, f.id;
$$;

-- One row per non-voided, non-planning X-ray × implant on its teeth (empty levels = not measured). The baseline is
-- the visit_grades (0066) one: the first measured X-ray on or after placement, a 'baseline' one first. Bone change
-- is the worse side against it, for measured X-rays dated after it.
create function public.analysis_radiographs(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, radiograph_id uuid, taken_on date, days_since_placement int, purpose text,
  mesial_mm numeric, distal_mm numeric, is_baseline boolean, bone_change_mm numeric)
language sql stable security invoker set search_path = '' as $$
  select o.site_id, r.id, r.taken_on, (r.taken_on - o.placed_on)::int, r.purpose, l.mesial_mm, l.distal_mm,
         r.id = b.radiograph_id,
         case when l.radiograph_id is not null and r.taken_on > b.taken_on
              then greatest(l.mesial_mm - b.mesial_mm, l.distal_mm - b.distal_mm) end
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.radiographs r
    on r.patient_id = o.patient_id and o.tooth = any (r.teeth) and r.voided_at is null and r.purpose <> 'planning'
  left join public.radiograph_bone_levels l on l.radiograph_id = r.id and l.site_id = o.site_id
  left join lateral (
    select r2.id as radiograph_id, r2.taken_on, l2.mesial_mm, l2.distal_mm
    from public.radiographs r2
    join public.radiograph_bone_levels l2 on l2.radiograph_id = r2.id and l2.site_id = o.site_id
    where r2.voided_at is null and r2.purpose <> 'planning' and r2.taken_on >= o.placed_on
    order by (r2.purpose = 'baseline') desc, r2.taken_on, r2.created_at
    limit 1
  ) b on true
  where (select public.can('research', 'view')) and (select public.can('patients', 'view'))
  order by o.site_id, r.taken_on, r.id;
$$;

revoke execute on function public.analysis_implants(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.analysis_implants(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.analysis_visits(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.analysis_visits(uuid, date, date, uuid, text, text) to authenticated;
revoke execute on function public.analysis_radiographs(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.analysis_radiographs(uuid, date, date, uuid, text, text) to authenticated;
