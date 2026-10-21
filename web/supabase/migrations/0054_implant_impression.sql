-- Each placed implant records whether a digital scan or a conventional impression was taken, and when.
-- Written only through record_impression (no UPDATE grant on the columns). The patient list filter also takes
-- 'digital_scan', 'conventional' and 'impression_pending' (cover screw or healing abutment, nothing recorded yet);
-- the previous app version never sends them.
alter table public.implant_sites
  add column impression_type text check (impression_type in ('digital_scan', 'conventional')),
  add column impression_taken_on date,
  add constraint implant_sites_impression_date check (impression_taken_on is null or impression_type is not null);

create function public.record_impression(p_site uuid, p_type text, p_taken_on date, p_expected_updated_at timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('A scan or impression can only be recorded for a placed implant.');
  end if;
  if p_expected_updated_at is null or v_site.updated_at <> p_expected_updated_at then
    perform app_private.fail('This implant was changed by someone else. Reload to see it.');
  end if;
  if p_type is null then
    update public.implant_sites set impression_type = null, impression_taken_on = null where id = p_site;
    return;
  end if;
  if p_type not in ('digital_scan', 'conventional') then
    perform app_private.fail('Choose a digital scan or a conventional impression.');
  end if;
  if p_taken_on is not null and p_taken_on > public.cairo_today() then
    perform app_private.fail('The scan / impression date can''t be in the future.');
  end if;
  if p_taken_on is not null and p_taken_on < v_site.placed_on then
    perform app_private.fail(format('The scan / impression date can''t be before the placement date (%s).', v_site.placed_on));
  end if;
  update public.implant_sites set impression_type = p_type, impression_taken_on = p_taken_on where id = p_site;
end $$;

revoke execute on function public.record_impression(uuid, text, date, timestamptz) from public, anon;
grant execute on function public.record_impression(uuid, text, date, timestamptz) to authenticated;

-- search_patients: latest 0041_patient_tooth_filter.sql, plus the scan / impression values.
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
  order by p.full_name
  limit 51; -- the page shows 50; the extra row tells it there are more
$$;
