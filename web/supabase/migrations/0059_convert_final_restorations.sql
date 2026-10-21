-- Turns the final restorations already fitted as components into restoration records, so they appear on the
-- new restorations list. Idempotent: a component is skipped when a restoration is already linked to its site
-- with the same fitted date, so it can be run again to pick up rows the previous app version fitted during the
-- release window. A pure insert: site_components and implant_sites are not touched (the implant is already
-- restored). A crown that was replaced by anything other than another final restoration is not converted.
create function app_private.convert_final_restorations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_next uuid;
  v_id uuid;
  v_count integer := 0;
begin
  -- Newest first within a site, so the restoration a crown was remade by already exists when it is converted.
  for r in
    select * from (
      select c.id, c.site_id, c.component_type, c.fitted_on, c.removed_on, c.fitted_by_delegate_id,
             s.patient_id, s.tooth,
             lead(c.component_type) over w as next_type,
             lead(c.fitted_on) over w as next_fitted_on
      from public.site_components c
      join public.implant_sites s on s.id = c.site_id
      where c.voided_at is null
      window w as (partition by c.site_id order by c.fitted_on, c.created_at, c.id)
    ) q
    where q.component_type = 'final_restoration'
    order by q.site_id, q.fitted_on desc
  loop
    if exists (
      select 1 from public.restoration_sites rs join public.restorations x on x.id = rs.restoration_id
      where rs.site_id = r.site_id and x.fitted_on = r.fitted_on
    ) then
      continue;
    end if;

    if r.next_type is null then
      if r.removed_on is not null then continue; end if;
      insert into public.restorations (patient_id, stage, type, teeth, fitted_on, delegate_id, notes)
      values (r.patient_id, 'final', 'single_crown', array[r.tooth::smallint], r.fitted_on,
              r.fitted_by_delegate_id, 'Converted from a fitted final restoration.')
      returning id into v_id;
    elsif r.next_type = 'final_restoration' then
      select x.id into v_next
      from public.restoration_sites rs join public.restorations x on x.id = rs.restoration_id
      where rs.site_id = r.site_id and x.fitted_on = r.next_fitted_on
      order by x.created_at limit 1;
      insert into public.restorations (patient_id, stage, type, teeth, fitted_on, delegate_id, notes,
                                       ended_on, end_kind, end_reason, ended_by)
      values (r.patient_id, 'final', 'single_crown', array[r.tooth::smallint], r.fitted_on,
              r.fitted_by_delegate_id, 'Converted from a fitted final restoration.',
              r.next_fitted_on, 'remade', 'not recorded', v_next)
      returning id into v_id;
    else
      continue;
    end if;

    insert into public.restoration_sites (restoration_id, site_id) values (v_id, r.site_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function app_private.convert_final_restorations() from public;

select app_private.convert_final_restorations();
