-- A delegate on a patient record must be enrolled in the record's course, as surgery bookings already require (0014).
-- Records saved before this keep their delegate: edits check only a delegate or course that changes.
-- A restoration or component with no course accepts any active delegate.

-- The pickers on the patient page need to know who is enrolled.
alter policy enrollments_area_read on public.enrollments
  using ((select public.can('courses', 'view')) or (select public.can('schedule', 'view')) or (select public.can('patients', 'view')));

-- The course a component was fitted in; empty on older records.
alter table public.site_components add column course_id uuid references public.courses (id);
create index site_components_course_idx on public.site_components (course_id);

create function app_private.check_enrolled(p_course uuid, p_delegate uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_course is null or p_delegate is null then
    return;
  end if;
  if not exists (select 1 from public.enrollments where course_id = p_course and delegate_id = p_delegate) then
    perform app_private.fail(format('%s is not enrolled in this course.',
      coalesce((select full_name from public.delegates where id = p_delegate), 'That delegate')));
  end if;
end $$;
revoke execute on function app_private.check_enrolled(uuid, uuid) from public, anon, authenticated;

-- From 0060.
create or replace function public.place_implant_v3(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid,
  p_graft text, p_notes text, p_slot uuid, p_technique text, p_course uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose the course.');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if p_placing_delegate is null or not exists (select 1 from public.delegates where id = p_placing_delegate and active) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  perform app_private.check_enrolled(p_course, p_placing_delegate);
  perform app_private.check_enrolled(p_course, p_assisting_delegate);
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if p_slot is not null then
    select * into v_slot from public.surgery_slots where id = p_slot;
    if not found or v_slot.status = 'cancelled' then
      perform app_private.fail('That surgery booking was not found or is cancelled.');
    end if;
    if v_slot.patient_id <> p_patient then
      perform app_private.fail('That surgery booking is for another patient.');
    end if;
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  v_slot_id := coalesce(p_slot, v_site.slot_id);
  if v_slot_id is not null and v_slot.id is null then
    select * into v_slot from public.surgery_slots where id = v_slot_id;
  end if;

  perform app_private.lock_lot(p_lot, p_product, p_placed_on);

  -- The chosen course wins over the booking's session course.
  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = p_course, technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, p_course, p_technique
    ) returning id into v_id;
  end if;

  perform app_private.insert_use(p_lot, p_patient, v_id, null);
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');

  if v_slot.id is not null then
    update public.surgery_slots set status = 'done'
    where id = v_slot.id and status = 'scheduled'
      and not exists (
        select 1 from public.slot_planned_implants spi
        join public.implant_sites s on s.id = spi.implant_site_id
        where spi.slot_id = v_slot.id and s.state = 'planned'
      );
  end if;
  return v_id;
end $$;

-- From 0075.
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

  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, assisting_delegate_id = p_assisting_delegate,
      supervisor_id = p_supervisor, course_id = p_course, graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;

-- From 0057.
create or replace function public.add_restoration(
  p_patient uuid, p_stage text, p_type text, p_sites uuid[], p_teeth smallint[], p_fitted_on date,
  p_retention text, p_material text, p_delegate uuid, p_supervisor uuid, p_course uuid, p_remake_reason text, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_sites uuid[];
  v_all uuid[];
  v_n int;
  v_found int;
  v_jaws int;
  v_site_teeth smallint[];
  v_teeth smallint[];
  v_last_placed date;
  v_old public.restorations;
  v_id uuid;
  v_site uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  if p_stage is null or p_stage not in ('temporary', 'final') then
    perform app_private.fail('Choose temporary or final.');
  end if;
  if p_type is null or p_type not in ('single_crown', 'bridge', 'overdenture', 'full_arch') then
    perform app_private.fail('Choose the restoration type.');
  end if;
  select coalesce(array_agg(distinct s), '{}') into v_sites from unnest(p_sites) s where s is not null;
  v_n := cardinality(v_sites);
  if p_type = 'single_crown' and v_n <> 1 then
    perform app_private.fail('A single crown sits on one implant.');
  end if;
  if p_type <> 'single_crown' and v_n < 2 then
    perform app_private.fail('A bridge, overdenture or full arch sits on at least two implants.');
  end if;

  v_all := app_private.lock_restoration_sites(v_sites);

  select count(*), count(distinct (tooth / 10 in (1, 2))), array_agg(tooth::smallint), max(placed_on)
  into v_found, v_jaws, v_site_teeth, v_last_placed
  from public.implant_sites
  where id = any (v_sites) and patient_id = p_patient and state in ('placed', 'restored');
  if v_found <> v_n then
    perform app_private.fail('Choose placed implants of this patient.');
  end if;
  if v_jaws > 1 then
    perform app_private.fail('The implants of one restoration must be in the same jaw.');
  end if;

  if p_type = 'single_crown' then
    if p_teeth is not null and cardinality(p_teeth) > 0 and p_teeth <> v_site_teeth then
      perform app_private.fail('A single crown covers its own tooth.');
    end if;
    v_teeth := v_site_teeth;
  else
    if not app_private.teeth_contiguous(p_teeth) or not (v_site_teeth <@ p_teeth) then
      perform app_private.fail('The teeth covered must be one run without gaps that includes every implant''s tooth.');
    end if;
    v_teeth := app_private.teeth_in_arch_order(p_teeth);
  end if;

  if p_fitted_on is null or p_fitted_on > public.cairo_today() or p_fitted_on < v_last_placed then
    perform app_private.fail('Enter the date fitted (from the placement date to today).');
  end if;
  perform app_private.check_restoration_details(p_retention, p_material, p_delegate, p_supervisor, p_course, p_notes);
  perform app_private.check_enrolled(p_course, p_delegate);

  -- Every current restoration on any of these implants ends, completely.
  for v_old in
    select r.* from public.restorations r
    where r.ended_on is null and r.voided_at is null
      and exists (select 1 from public.restoration_sites rs where rs.restoration_id = r.id and rs.site_id = any (v_sites))
    order by r.id
    for update
  loop
    if v_old.stage = 'final' and p_stage = 'temporary' then
      perform app_private.fail('This implant has a final restoration. Record the repair as a problem on it instead of fitting a temporary.');
    end if;
    if v_old.stage = 'final' and length(trim(coalesce(p_remake_reason, ''))) = 0 then
      perform app_private.fail('Say why the final restoration was remade.');
    end if;
    if v_old.fitted_on > p_fitted_on then
      perform app_private.fail('The date fitted can''t be before the date the restoration it replaces was fitted.');
    end if;
  end loop;

  insert into public.restorations (patient_id, stage, type, teeth, fitted_on, retention, material, delegate_id,
                                   supervisor_id, course_id, notes)
  values (p_patient, p_stage, p_type, v_teeth, p_fitted_on, p_retention, p_material, p_delegate,
          p_supervisor, p_course, trim(coalesce(p_notes, '')))
  returning id into v_id;
  insert into public.restoration_sites (restoration_id, site_id) select v_id, s from unnest(v_sites) s;

  update public.restorations r
  set ended_on = p_fitted_on, ended_by = v_id,
      end_kind = case when r.stage = 'final' then 'remade' else 'replaced' end,
      end_reason = case when r.stage = 'final' then trim(p_remake_reason) end
  where r.id <> v_id and r.ended_on is null and r.voided_at is null
    and exists (select 1 from public.restoration_sites rs where rs.restoration_id = r.id and rs.site_id = any (v_sites));

  foreach v_site in array v_all loop
    perform app_private.sync_restored(v_site);
  end loop;
  return v_id;
end $$;

-- From 0057.
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
  perform app_private.check_restoration_details(p_retention, p_material, p_delegate, p_supervisor, p_course, p_notes);
  if (p_delegate, p_course) is distinct from (v_r.delegate_id, v_r.course_id) then
    perform app_private.check_enrolled(p_course, p_delegate);
  end if;
  update public.restorations
  set retention = p_retention, material = p_material, delegate_id = p_delegate, supervisor_id = p_supervisor,
      course_id = p_course, notes = trim(coalesce(p_notes, ''))
  where id = p_restoration;
end $$;

-- fit_component (0030) with a course. The old function stays for the previous app version; drop it in a later release.
create function public.fit_component_v2(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid,
  p_by_delegate uuid, p_by_organizer uuid, p_notes text, p_course uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > public.cairo_today() then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  perform app_private.check_enrolled(p_course, p_by_delegate);
  if p_by_organizer is not null and not exists (select 1 from public.profiles where user_id = p_by_organizer and active) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if p_lot is null then
      perform app_private.fail('Choose the stock batch used.');
    end if;
    perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id, fitted_by_organizer_id, notes, course_id
  ) values (
    p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate, p_by_organizer, coalesce(p_notes, ''), p_course
  ) returning id into v_id;

  if p_product is not null then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;
revoke execute on function public.fit_component_v2(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.fit_component_v2(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid) to authenticated;
