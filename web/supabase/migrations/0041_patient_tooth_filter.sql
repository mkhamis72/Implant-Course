-- Patient list: the stage filter also matches chart states 'missing' and 'extracted' ("To be extracted").
-- Same signature as 0023, so no new overload; any ticked value matches (OR). The previous app version
-- never sends the new values.
create or replace function public.search_patients(q text default '', include_archived boolean default false, stages text[] default '{}')
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
    )
  order by p.full_name
  limit 51; -- the page shows 50; the extra row tells it there are more
$$;
