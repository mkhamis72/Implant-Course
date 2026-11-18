-- Modules release 3: in a clinic, what a record named before the company became a clinic (its delegates,
-- supervisor and course) is hidden but kept. 0115 made correct_placement_v3 and update_restoration refuse any
-- of them in a clinic, so correcting an older implant's date or notes would have erased them (the app had to send
-- null) and an older restoration couldn't be edited at all. Now a clinic may send them back unchanged; only a
-- change (including clearing one) is refused. Same signatures, so owners and grants stay.
set local lock_timeout = '5s';

-- ── correct_placement_v3: 0115's body; the clinic compares with what is recorded ──────────────────
create or replace function public.correct_placement_v3(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_course uuid, p_graft text, p_notes text, p_placing_doctor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_first date;
  v_lot public.stock_lots;
  v_teaching boolean := public.module_on('teaching');
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has placement details to correct.');
  end if;

  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not v_teaching then
    -- Hidden in a clinic but kept: only the values already recorded are accepted.
    if (p_placing_delegate, p_assisting_delegate, p_supervisor, p_course)
       is distinct from (v_site.placing_delegate_id, v_site.assisting_delegate_id, v_site.supervisor_id, v_site.course_id) then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
  elsif p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  -- Components, restorations, X-rays, the scan, follow-ups, complications and the failure can't predate the placement.
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
    union all
    select v_site.impression_taken_on
    union all
    select xr.taken_on from public.radiographs xr
    where xr.patient_id = v_site.patient_id and v_site.tooth = any (xr.teeth) and xr.voided_at is null
      and xr.purpose <> 'planning' and xr.taken_on >= v_site.placed_on
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, restoration, X-ray, scan, follow-up, complication or failure (%s).', v_first));
  end if;
  select * into v_lot from public.stock_lots where id = v_site.stock_lot_id;
  if v_lot.expiry is not null and v_lot.expiry < p_placed_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Correct the batch first.',
      coalesce(v_lot.lot_no, '(no number)'), v_lot.expiry, p_placed_on));
  end if;

  -- People: active, or the one already recorded (they may have become inactive since).
  if not v_teaching then
    if p_placing_doctor is null or not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_site.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
  elsif p_placing_delegate is not null and p_placing_doctor is not null then
    perform app_private.fail('Choose a delegate or a doctor, not both.');
  elsif p_placing_doctor is not null then
    if not exists (
      select 1 from public.doctors where id = p_placing_doctor and (active or id = v_site.placing_doctor_id)
    ) then
      perform app_private.fail('Choose the doctor who placed the implant.');
    end if;
    if p_assisting_delegate is not null and not exists (
      select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
    ) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
    if (p_assisting_delegate, p_course) is distinct from (v_site.assisting_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_assisting_delegate);
    end if;
    if p_supervisor is not null and not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    -- A delegate: v2's rules.
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
    -- Only what changes is checked, so another field can still be fixed on an older record.
    if (p_placing_delegate, p_course) is distinct from (v_site.placing_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_placing_delegate);
    end if;
    if (p_assisting_delegate, p_course) is distinct from (v_site.assisting_delegate_id, v_site.course_id) then
      perform app_private.check_enrolled(p_course, p_assisting_delegate);
    end if;
    if p_supervisor is null or not exists (
      select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
    ) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  end if;

  -- In a clinic the people and course passed the check above, so these write back what was recorded.
  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, placing_doctor_id = p_placing_doctor,
      assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor, course_id = p_course,
      graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;

-- ── update_restoration: 0081's body; the clinic compares with what is recorded ────────────────────
-- check_restoration_details (0115) has no row to compare with, so add_restoration keeps its rule there (a new
-- restoration in a clinic names nobody). Here, in a clinic, the recorded delegate, supervisor and course must
-- come back unchanged, and the helper is then given null for them: its clinic check would refuse any value, and
-- unchanged values need no other check (their enrolment is checked only when they change, as before).
create or replace function public.update_restoration(
  p_restoration uuid, p_retention text, p_material text, p_delegate uuid, p_supervisor uuid, p_course uuid,
  p_notes text, p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.restorations;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_r from public.restorations where id = p_restoration and voided_at is null for update;
  if not found then perform app_private.fail('Restoration not found.'); end if;
  if p_expected_updated_at is null or v_r.updated_at <> p_expected_updated_at then
    perform app_private.fail('This restoration was changed by someone else. Reload to see it.');
  end if;
  if not public.module_on('teaching') then
    if (p_delegate, p_supervisor, p_course) is distinct from (v_r.delegate_id, v_r.supervisor_id, v_r.course_id) then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
    perform app_private.check_restoration_details(p_retention, p_material, null, null, null, p_notes);
  else
    perform app_private.check_restoration_details(p_retention, p_material, p_delegate, p_supervisor, p_course, p_notes);
    if (p_delegate, p_course) is distinct from (v_r.delegate_id, v_r.course_id) then
      perform app_private.check_enrolled(p_course, p_delegate);
    end if;
  end if;
  update public.restorations
  set retention = p_retention, material = p_material, delegate_id = p_delegate, supervisor_id = p_supervisor,
      course_id = p_course, notes = trim(coalesce(p_notes, ''))
  where id = p_restoration;
end $$;
