-- Data-quality issues: impossible dates only (before the implant was placed, in the future, a restoration problem
-- before its restoration was fitted). A reader, not a constraint: the database refuses most of these today, but
-- older rows and imports may hold them. Security invoker like recall_list(): the caller needs View on Patients.
-- p_patient null = every patient. Voided records are ignored; planning X-rays are never "before placement".

create function public.data_quality_issues(p_patient uuid)
returns table (patient_id uuid, patient_name text, file_no text, site_id uuid, tooth smallint, kind text,
  record_table text, record_id uuid, record_date date, reference_date date, message text)
language sql stable security invoker set search_path = '' as $$
  with today as (select public.cairo_today() as d),
  dated as (
    -- follow-up visits
    select s.patient_id, s.id as site_id, s.tooth::smallint as tooth, 'implant_followups'::text as record_table,
           f.id as record_id, f.date as record_date, s.placed_on as placed_on,
           'Follow-up visit'::text as label
    from public.implant_followups f join public.implant_sites s on s.id = f.site_id
    where f.voided_at is null
    union all
    -- complications
    select s.patient_id, s.id, s.tooth::smallint, 'implant_complications', c.id, c.noticed_on, s.placed_on,
           'Complication'
    from public.implant_complications c join public.implant_sites s on s.id = c.site_id
    where c.voided_at is null
    union all
    -- restorations (one row per implant it sits on; a restoration with no implant is still checked for the future)
    select r.patient_id, s.id, s.tooth::smallint, 'restorations', r.id, r.fitted_on, s.placed_on,
           'Restoration'
    from public.restorations r
    left join public.restoration_sites rs on rs.restoration_id = r.id
    left join public.implant_sites s on s.id = rs.site_id
    where r.voided_at is null
    union all
    -- X-rays: a non-planning X-ray is compared only with the EARLIEST placement among the implants on its teeth (a
    -- re-implanted tooth keeps its first implant's X-rays); no matching implant = a row without a site
    select x.patient_id, s.id, coalesce(s.tooth, x.teeth[1])::smallint, 'radiographs', x.id, x.taken_on,
           case when x.purpose = 'planning' then null else s.placed_on end, 'X-ray'
    from public.radiographs x
    left join lateral (
      select i.id, i.tooth, i.placed_on from public.implant_sites i
      where i.patient_id = x.patient_id and i.tooth = any (x.teeth) order by i.placed_on, i.id limit 1
    ) s on true
    where x.voided_at is null
    union all
    -- failure date
    select s.patient_id, s.id, s.tooth::smallint, 'implant_sites', s.id, s.failed_on, s.placed_on, 'Failure'
    from public.implant_sites s
    where s.failed_on is not null
  ),
  found as (
    select d.patient_id, d.site_id, d.tooth, d.record_table, d.record_id, d.record_date,
           case when d.record_date < d.placed_on then 'before_placement' else 'in_future' end as kind,
           case when d.record_date < d.placed_on then d.placed_on end as reference_date, d.label, d.placed_on as site_placed_on
    from dated d, today
    where d.record_date < d.placed_on or d.record_date > today.d
    union all
    -- restoration problems noticed before the restoration was fitted
    select r.patient_id, s.id, s.tooth::smallint, 'restoration_problems', pr.id, pr.noticed_on,
           'problem_before_fitting', r.fitted_on, 'Restoration problem', s.placed_on
    from public.restoration_problems pr
    join public.restorations r on r.id = pr.restoration_id
    left join public.restoration_sites rs on rs.restoration_id = r.id
    left join public.implant_sites s on s.id = rs.site_id
    where pr.voided_at is null and r.voided_at is null and pr.noticed_on < r.fitted_on
  )
  -- one row per record and kind: a record on several implants keeps its earliest-placed one
  select distinct on (f.record_table, f.record_id, f.kind) f.patient_id, p.full_name, p.file_no, f.site_id, f.tooth, f.kind, f.record_table, f.record_id, f.record_date,
         f.reference_date,
         case f.kind
           when 'before_placement' then f.label || ' dated ' || f.record_date || ' is before the placement date (' || f.reference_date || ').'
           when 'in_future' then f.label || ' dated ' || f.record_date || ' is in the future.'
           else f.label || ' dated ' || f.record_date || ' is before the restoration was fitted (' || f.reference_date || ').'
         end
  from found f join public.patients p on p.id = f.patient_id
  where p_patient is null or f.patient_id = p_patient
  order by f.record_table, f.record_id, f.kind, f.site_placed_on nulls last, f.site_id;
$$;

revoke all on function public.data_quality_issues(uuid) from public, anon;
grant execute on function public.data_quality_issues(uuid) to authenticated;
