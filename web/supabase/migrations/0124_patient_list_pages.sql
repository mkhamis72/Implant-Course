set local lock_timeout = '5s';

-- Patients list in pages of 50 with a total. search_patients (0098) stays for the previous app version.
-- patient_list_matches is the 0098 filter, unordered, in one place; search_patients_v2 returns one page of it
-- (by name, then id so pages are stable; offset below 0 counts as 0, at most 100 rows) and
-- search_patients_count the number of matches. All security invoker, so RLS and the module gates apply.
create function public.patient_list_matches(
  q text, include_archived boolean, stages text[], course uuid, supervisor uuid
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
    );
$$;

create function public.search_patients_v2(
  q text, include_archived boolean, stages text[], course uuid, supervisor uuid, p_offset int, p_limit int
)
returns setof public.patients
language sql stable security invoker set search_path = '' as $$
  select p.*
  from public.patient_list_matches(q, include_archived, stages, course, supervisor) p
  order by p.full_name, p.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 0), 0), 100);
$$;

create function public.search_patients_count(
  q text, include_archived boolean, stages text[], course uuid, supervisor uuid
)
returns bigint
language sql stable security invoker set search_path = '' as $$
  select count(*) from public.patient_list_matches(q, include_archived, stages, course, supervisor);
$$;

revoke execute on function public.patient_list_matches(text, boolean, text[], uuid, uuid) from public, anon;
grant execute on function public.patient_list_matches(text, boolean, text[], uuid, uuid) to authenticated;
revoke execute on function public.search_patients_v2(text, boolean, text[], uuid, uuid, int, int) from public, anon;
grant execute on function public.search_patients_v2(text, boolean, text[], uuid, uuid, int, int) to authenticated;
revoke execute on function public.search_patients_count(text, boolean, text[], uuid, uuid) from public, anon;
grant execute on function public.search_patients_count(text, boolean, text[], uuid, uuid) to authenticated;
