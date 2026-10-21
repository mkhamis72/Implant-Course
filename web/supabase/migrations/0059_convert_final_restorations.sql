-- One-time conversion: turns the final restorations already fitted as components into restoration records, so
-- they appear on the new restorations list. It runs once, here; it is not meant to be run again (a crown fitted
-- later by the previous app version would become a second current restoration). A pure insert: site_components
-- and implant_sites are not touched (the implant is already restored). A crown that was replaced by anything
-- other than another final restoration, or removed with nothing after it, is not converted.
create function app_private.convert_final_restorations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_next uuid;
  v_id uuid;
  v_count integer := 0;
begin
  -- Newest first within a site, in the same order as the window (fitted_on, created_at, id), so the restoration
  -- a crown was remade by already exists when it is converted. day_rank numbers a site's convertible crowns of
  -- one day from the newest, so a site with day_rank restorations on that day already has this crown converted:
  -- the newest crown of a day is always converted first, and an older one of the same day is not skipped.
  for r in
    select q.*,
           row_number() over (partition by q.site_id, q.fitted_on order by q.created_at desc, q.id desc) as day_rank
    from (
      select c.id, c.site_id, c.component_type, c.fitted_on, c.created_at, c.removed_on, c.fitted_by_delegate_id,
             s.patient_id, s.tooth,
             lead(c.component_type) over w as next_type,
             lead(c.fitted_on) over w as next_fitted_on
      from public.site_components c
      join public.implant_sites s on s.id = c.site_id
      where c.voided_at is null
      window w as (partition by c.site_id order by c.fitted_on, c.created_at, c.id)
    ) q
    where q.component_type = 'final_restoration'
      and ((q.next_type is null and q.removed_on is null) or q.next_type = 'final_restoration')
    order by q.site_id, q.fitted_on desc, q.created_at desc, q.id desc
  loop
    if (select count(*) from public.restoration_sites rs join public.restorations x on x.id = rs.restoration_id
        where rs.site_id = r.site_id and x.fitted_on = r.fitted_on) >= r.day_rank then
      continue;
    end if;

    if r.next_type is null then
      insert into public.restorations (patient_id, stage, type, teeth, fitted_on, delegate_id, notes)
      values (r.patient_id, 'final', 'single_crown', array[r.tooth::smallint], r.fitted_on,
              r.fitted_by_delegate_id, 'Converted from a fitted final restoration.')
      returning id into v_id;
    else
      -- The crown that remade this one: the restoration converted from the next crown, i.e. the one on its date
      -- that no other restoration is ended by yet.
      select x.id into v_next
      from public.restoration_sites rs join public.restorations x on x.id = rs.restoration_id
      where rs.site_id = r.site_id and x.fitted_on = r.next_fitted_on
        and not exists (select 1 from public.restorations e where e.ended_by = x.id)
      order by x.created_at desc, x.id
      limit 1;
      insert into public.restorations (patient_id, stage, type, teeth, fitted_on, delegate_id, notes,
                                       ended_on, end_kind, end_reason, ended_by)
      values (r.patient_id, 'final', 'single_crown', array[r.tooth::smallint], r.fitted_on,
              r.fitted_by_delegate_id, 'Converted from a fitted final restoration.',
              r.next_fitted_on, 'remade', 'not recorded', v_next)
      returning id into v_id;
    end if;

    insert into public.restoration_sites (restoration_id, site_id) values (v_id, r.site_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function app_private.convert_final_restorations() from public;

select app_private.convert_final_restorations();
