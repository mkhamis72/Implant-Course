-- Review fixes for the restorations release.
--
-- correct_placement_v2 (0060): restorations fitted on the implant can't predate the placement either, like its
-- components, follow-ups, complications and failure. Same signature, so its grants are kept.
create or replace function public.correct_placement_v2(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_course uuid, p_graft text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_first date;
  v_lot public.stock_lots;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has placement details to correct.');
  end if;

  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  -- Components, restorations, follow-ups, complications and the failure can't predate the placement.
  select min(d) into v_first from (
    select fitted_on as d from public.site_components where site_id = p_site and voided_at is null
    union all
    select date from public.implant_followups where site_id = p_site and voided_at is null
    union all
    select v_site.failed_on
    union all
    select noticed_on from public.implant_complications where site_id = p_site and voided_at is null
    union all
    select r.fitted_on from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
    where rs.site_id = p_site and r.voided_at is null
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, restoration, follow-up, complication or failure (%s).', v_first));
  end if;
  select * into v_lot from public.stock_lots where id = v_site.stock_lot_id;
  if v_lot.expiry is not null and v_lot.expiry < p_placed_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Correct the batch first.',
      coalesce(v_lot.lot_no, '(no number)'), v_lot.expiry, p_placed_on));
  end if;

  -- People: active, or the one already recorded (they may have become inactive since).
  if p_placing_delegate is null or not exists (
    select 1 from public.delegates where id = p_placing_delegate and (active or id = v_site.placing_delegate_id)
  ) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (
      select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
    ) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  if p_supervisor is null or not exists (
    select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
  ) then
    perform app_private.fail('Choose an active supervisor.');
  end if;

  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, assisting_delegate_id = p_assisting_delegate,
      supervisor_id = p_supervisor, course_id = p_course, graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;
