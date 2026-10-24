-- Impossible dates are refused when entered, so the Data quality page can go (owner, 2026-10-24).
--
-- save_radiograph (0065): an "other" X-ray can't predate the first implant placed on its teeth either (baseline,
-- loading and follow-up already needed an implant placed by their date; planning X-rays come before placement).
-- correct_placement_v2 (0062): the implant can't be moved after its own scan / impression or a non-planning X-ray of
-- its tooth taken since it was placed (older ones belong to an earlier implant on the tooth).
-- Same signatures, so the grants stay.

create or replace function public.save_radiograph(
  p_id uuid, p_patient uuid, p_taken_on date, p_type text, p_purpose text, p_teeth smallint[], p_link text,
  p_notes text, p_levels jsonb, p_expected_updated_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.radiographs;
  v_id uuid;
  v_teeth smallint[];
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_levels jsonb := coalesce(p_levels, '[]'::jsonb);
  v_e jsonb;
  v_sites uuid[] := '{}';
  v_site uuid;
  v_found int;
  v_first_placed date;
begin
  perform app_private.require_perm('patients', 'edit');

  if p_id is null then
    if p_expected_updated_at is not null then
      perform app_private.fail('This X-ray was changed by someone else. Reload to see it.');
    end if;
    if not exists (select 1 from public.patients where id = p_patient) then
      perform app_private.fail('Patient not found.');
    end if;
  else
    select * into v_r from public.radiographs
    where id = p_id and patient_id = p_patient and voided_at is null for update;
    if not found then perform app_private.fail('X-ray not found.'); end if;
    if p_expected_updated_at is null or v_r.updated_at <> p_expected_updated_at then
      perform app_private.fail('This X-ray was changed by someone else. Reload to see it.');
    end if;
  end if;

  if p_taken_on is null then
    perform app_private.fail('Enter the date the X-ray was taken.');
  end if;
  if p_taken_on > public.cairo_today() then
    perform app_private.fail('The X-ray date can''t be in the future.');
  end if;
  if p_type is null or p_type not in ('periapical', 'cbct') then
    perform app_private.fail('Choose the X-ray type.');
  end if;
  if p_purpose is null or p_purpose not in ('planning', 'baseline', 'loading', 'follow_up', 'other') then
    perform app_private.fail('Choose the purpose of the X-ray.');
  end if;
  if p_teeth is null or cardinality(p_teeth) = 0 then
    perform app_private.fail('Choose at least one tooth on the X-ray.');
  end if;
  if exists (select 1 from unnest(p_teeth) t
             where t is null or not (t between 11 and 18 or t between 21 and 28 or t between 31 and 38 or t between 41 and 48))
     or (select count(distinct t) from unnest(p_teeth) t) <> cardinality(p_teeth) then
    perform app_private.fail('Each tooth must be a valid FDI tooth, chosen once.');
  end if;
  select array_agg(t order by t) into v_teeth from unnest(p_teeth) t;
  if v_link is not null and (v_link !~ '^https?://' or length(v_link) > 2000) then
    perform app_private.fail('Enter a link starting with http:// or https://.');
  end if;
  if length(trim(coalesce(p_notes, ''))) > 1000 then
    perform app_private.fail('Keep the notes under 1000 characters.');
  end if;

  -- The measurement rows: shape, values, one per implant.
  if jsonb_typeof(v_levels) <> 'array' then
    perform app_private.fail('Bone levels must be a list.');
  end if;
  for v_e in select value from jsonb_array_elements(v_levels) loop
    if jsonb_typeof(v_e) <> 'object'
       or coalesce(v_e ->> 'site', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(jsonb_typeof(v_e -> 'mesial_mm'), 'null') not in ('number', 'null')
       or coalesce(jsonb_typeof(v_e -> 'distal_mm'), 'null') not in ('number', 'null') then
      perform app_private.fail('Bone levels must be numbers in mm.');
    end if;
    if (v_e ->> 'mesial_mm') is null and (v_e ->> 'distal_mm') is null then
      perform app_private.fail('Enter a mesial or distal bone level for each implant measured.');
    end if;
    if round((v_e ->> 'mesial_mm')::numeric, 1) not between -5 and 15
       or round((v_e ->> 'distal_mm')::numeric, 1) not between -5 and 15 then
      perform app_private.fail('Bone levels must be between -5 and 15 mm.');
    end if;
    v_site := (v_e ->> 'site')::uuid;
    if v_site = any (v_sites) then
      perform app_private.fail('Each implant can be measured only once on an X-ray.');
    end if;
    v_sites := v_sites || v_site;
  end loop;

  -- Lock order: the X-ray (above), then the implants.
  perform 1 from public.implant_sites
  where patient_id = p_patient and (id = any (v_sites) or tooth = any (v_teeth))
  order by id for update;

  select count(*) into v_found from public.implant_sites
  where id = any (v_sites) and patient_id = p_patient and state in ('placed', 'restored', 'failed')
    and tooth = any (v_teeth);
  if v_found <> cardinality(v_sites) then
    perform app_private.fail('A bone level can only be recorded for an implant on one of this X-ray''s teeth.');
  end if;
  if exists (select 1 from public.implant_sites
             where id = any (v_sites) and (placed_on is null or placed_on > p_taken_on)) then
    perform app_private.fail('A bone level can only be recorded for an implant placed by the X-ray''s date.');
  end if;

  if p_purpose in ('baseline', 'loading', 'follow_up') and not exists (
    select 1 from public.implant_sites
    where patient_id = p_patient and tooth = any (v_teeth) and state in ('placed', 'restored', 'failed')
      and placed_on <= p_taken_on
  ) then
    perform app_private.fail('A baseline, loading or follow-up X-ray needs an implant placed by its date on one of its teeth.');
  end if;

  if p_purpose = 'other' then
    select min(placed_on) into v_first_placed from public.implant_sites
    where patient_id = p_patient and tooth = any (v_teeth) and placed_on is not null;
    if v_first_placed is not null and p_taken_on < v_first_placed then
      perform app_private.fail(format('A non-planning X-ray can''t be before the placement date (%s).', v_first_placed));
    end if;
  end if;

  if p_id is null then
    insert into public.radiographs (patient_id, taken_on, type, purpose, teeth, link, notes)
    values (p_patient, p_taken_on, p_type, p_purpose, v_teeth, v_link, trim(coalesce(p_notes, '')))
    returning id into v_id;
  else
    v_id := p_id;
    update public.radiographs
    set taken_on = p_taken_on, type = p_type, purpose = p_purpose, teeth = v_teeth, link = v_link,
        notes = trim(coalesce(p_notes, ''))
    where id = v_id;
    -- Only implants no longer measured lose their row; unchanged rows are left alone.
    delete from public.radiograph_bone_levels where radiograph_id = v_id and site_id <> all (v_sites);
  end if;

  insert into public.radiograph_bone_levels as b (radiograph_id, site_id, mesial_mm, distal_mm)
  select v_id, (e ->> 'site')::uuid, round((e ->> 'mesial_mm')::numeric, 1), round((e ->> 'distal_mm')::numeric, 1)
  from jsonb_array_elements(v_levels) e
  on conflict (radiograph_id, site_id) do update
  set mesial_mm = excluded.mesial_mm, distal_mm = excluded.distal_mm
  where (b.mesial_mm, b.distal_mm) is distinct from (excluded.mesial_mm, excluded.distal_mm);
  return v_id;
end $$;

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
