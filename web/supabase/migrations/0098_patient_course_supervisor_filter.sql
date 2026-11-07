set local lock_timeout = '5s';

-- Patients list: filter by course and by supervisor. search_patients gains two defaulted parameters; the old
-- three-parameter function is dropped first (an overload with defaulted parameters would make PostgREST's
-- named-argument calls ambiguous), and the previous app version's call (q, include_archived, stages) still
-- resolves to the new one. Body as 0054 plus the two filters.
-- A patient is "in course X" through a placed implant of course X or a booking (not cancelled) in a session of
-- course X, the same rule as patient_course_options (0072); "supervised by Y" through an implant or such a
-- booking with supervisor Y.
drop function public.search_patients(text, boolean, text[]);

create function public.search_patients(
  q text default '', include_archived boolean default false, stages text[] default '{}',
  course uuid default null, supervisor uuid default null
)
returns setof public.patients
language sql stable security invoker set search_path = '' as $$
  with term as (
    select
      replace(replace(replace(coalesce(trim(q), ''), '\', '\\'), '%', '\%'), '_', '\_') as text_pat,
      nullif(regexp_replace(coalesce(q, ''), '\D', '', 'g'), '') as digits
  )
  select p.*
  from public.patients p, term t
  where (include_archived or not p.archived)
    and (
      t.text_pat = ''
      or p.full_name ilike '%' || t.text_pat || '%' escape '\'
      or p.file_no ilike '%' || t.text_pat || '%' escape '\'
      or (t.digits is not null and regexp_replace(p.phone, '\D', '', 'g') like '%' || t.digits || '%')
    )
    and (
      coalesce(cardinality(stages), 0) = 0
      or exists (
        select 1
        from public.implant_sites s
        left join public.site_components c on c.site_id = s.id and c.removed_on is null and c.voided_at is null
        where s.patient_id = p.id and public.implant_stage(s.state, c.component_type) = any(stages)
      )
      or exists (
        select 1
        from public.tooth_status ts
        where ts.patient_id = p.id and ts.status::text = any(stages)
      )
      or exists (
        select 1
        from public.implant_sites s
        left join public.site_components c on c.site_id = s.id and c.removed_on is null and c.voided_at is null
        where s.patient_id = p.id
          and (
            s.impression_type = any(stages)
            or ('impression_pending' = any(stages) and s.impression_type is null
                and public.implant_stage(s.state, c.component_type) in ('cover_screw', 'healing_abutment'))
          )
      )
    )
    and (
      course is null
      or exists (select 1 from public.implant_sites s where s.patient_id = p.id and s.course_id = course)
      or exists (
        select 1 from public.surgery_slots w join public.sessions se on se.id = w.session_id
        where w.patient_id = p.id and w.status <> 'cancelled' and se.course_id = course
      )
    )
    and (
      supervisor is null
      or exists (select 1 from public.implant_sites s where s.patient_id = p.id and s.supervisor_id = supervisor)
      or exists (
        select 1 from public.surgery_slots w
        where w.patient_id = p.id and w.status <> 'cancelled' and w.supervisor_id = supervisor
      )
    )
  order by p.full_name
  limit 51; -- the page shows 50; the extra row tells it there are more
$$;

revoke execute on function public.search_patients(text, boolean, text[], uuid, uuid) from public, anon;
grant execute on function public.search_patients(text, boolean, text[], uuid, uuid) to authenticated;
