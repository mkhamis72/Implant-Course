-- Implant-stage filter for the patient list.

-- The stage of one implant site, from its state and its current component.
-- A placed implant with no current component has no stage (null).
create function public.implant_stage(p_state public.site_state, p_component public.component_type) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_state = 'planned' then 'planned'
    when p_state = 'restored' then 'restored'
    when p_state in ('failed', 'removed') then 'failed'
    when p_component = 'cover_screw' then 'cover_screw'
    when p_component = 'healing_abutment' then 'healing_abutment'
    when p_component in ('ti_base', 'multi_unit', 'abutment') then 'prosthetic'
  end;
$$;
revoke execute on function public.implant_stage(public.site_state, public.component_type) from public, anon;
grant execute on function public.implant_stage(public.site_state, public.component_type) to authenticated;

-- The staged implant sites of the given patients (the list's Teeth column).
create function public.implant_stage_sites(p_patients uuid[])
returns table (patient_id uuid, tooth smallint, stage text)
language sql stable security invoker set search_path = '' as $$
  select x.patient_id, x.tooth, x.stage
  from (
    select s.patient_id, s.tooth::smallint as tooth, public.implant_stage(s.state, c.component_type) as stage
    from public.implant_sites s
    left join public.site_components c on c.site_id = s.id and c.removed_on is null and c.voided_at is null
    where s.patient_id = any(p_patients)
  ) x
  where x.stage is not null
  order by x.patient_id, x.tooth;
$$;
revoke execute on function public.implant_stage_sites(uuid[]) from public, anon;
grant execute on function public.implant_stage_sites(uuid[]) to authenticated;

-- search_patients gains an optional stage filter. The old two-argument version is replaced in the
-- same transaction (keeping both would make two-argument calls ambiguous); calls by name or
-- position with two arguments still resolve to this one.
drop function public.search_patients(text, boolean);
create function public.search_patients(q text default '', include_archived boolean default false, stages text[] default '{}')
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
    )
  order by p.full_name
  limit 51; -- the page shows 50; the extra row tells it there are more
$$;
revoke execute on function public.search_patients(text, boolean, text[]) from public, anon;
grant execute on function public.search_patients(text, boolean, text[]) to authenticated;
