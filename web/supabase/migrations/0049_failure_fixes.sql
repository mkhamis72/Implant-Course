-- Final-review fixes for complications (0047) and failure (0048).

-- Void reasons are capped like the other free-text fields (the form limits them to 300 characters).
alter table public.implant_complications
  add constraint implant_complications_voided_reason_length check (length(voided_reason) <= 300);

-- apply_failure: latest 0048_implant_failure.sql; the tooth is failed only when the implant itself becomes failed.
create or replace function app_private.apply_failure(v_site public.implant_sites, p_failed_on date, p_type text, p_reason text, p_notes text)
returns void
language plpgsql set search_path = '' as $$
begin
  if p_failed_on is null or p_failed_on < v_site.placed_on or p_failed_on > public.cairo_today() then
    perform app_private.fail('Enter the failure date (from the placement date to today).');
  end if;
  if p_type is null or p_type not in ('lost', 'removed', 'failed_in_place') then
    perform app_private.fail('Choose the failure type.');
  end if;
  if p_reason is null or p_reason not in ('no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other') then
    perform app_private.fail('Choose the failure reason.');
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    perform app_private.fail('Keep the failure notes under 1000 characters.');
  end if;
  update public.implant_sites
  set state = 'failed', failed_on = p_failed_on, failure_type = p_type, failure_reason = p_reason,
      failure_notes = coalesce(trim(p_notes), '')
  where id = v_site.id;
  -- Only a real transition fails the tooth: editing an earlier implant's failure must not reset a tooth that now
  -- carries a newer implant.
  if v_site.state <> 'failed' then
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
end $$;

-- correct_placement: latest 0042_correct_placement.sql; the failure date and complications also bound the date.
create or replace function public.correct_placement(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_torque numeric, p_isq numeric, p_bone_type text, p_graft text, p_notes text
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
  -- Components, follow-ups, complications and the failure can't predate the placement.
  select min(d) into v_first from (
    select fitted_on as d from public.site_components where site_id = p_site and voided_at is null
    union all
    select date from public.implant_followups where site_id = p_site and voided_at is null
    union all
    select v_site.failed_on
    union all
    select noticed_on from public.implant_complications where site_id = p_site and voided_at is null
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, follow-up, complication or failure (%s).', v_first));
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

  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;
  if p_isq is not null and (p_isq < 0 or p_isq > 100) then
    perform app_private.fail('Enter an ISQ between 0 and 100.');
  end if;
  if p_bone_type is not null and p_bone_type not in ('D1', 'D2', 'D3', 'D4') then
    perform app_private.fail('Choose a bone type from D1 to D4.');
  end if;

  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, assisting_delegate_id = p_assisting_delegate,
      supervisor_id = p_supervisor, torque_ncm = p_torque, isq = p_isq, bone_type = p_bone_type,
      graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;

-- record_visit: latest 0048_implant_failure.sql; refuses a failure date after the visit, and fills in the details
-- of an implant that failed before details were recorded instead of dropping them.
create or replace function public.record_visit(
  p_site uuid, p_date date, p_visit_key text, p_check_type text, p_attendance text,
  p_outcome public.followup_outcome, p_findings jsonb, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_f jsonb := coalesce(p_findings, '{}'::jsonb);
  v_label text;
  v_unknown text;
  v_id uuid;
  c_keys constant text[] := array['pain_score', 'patient_concerns', 'swelling', 'suppuration', 'plaque', 'mobility',
    'probing_mesial', 'probing_buccal', 'probing_distal', 'probing_lingual', 'bop_mesial', 'bop_buccal', 'bop_distal',
    'bop_lingual', 'isq', 'prosthesis_status', 'radiograph_taken', 'recommended_treatment'];
  c_yes_no constant text[] := array['yes', 'no'];
  c_probing constant text := 'Enter probing depths from 0 to 15 mm.';
  c_failure_keys constant text[] := array['failed_on', 'failure_type', 'failure_reason', 'failure_notes'];
  v_has_failure boolean;
  v_failed_on date;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Visits are recorded for placed implants.');
  end if;
  if p_date is null or p_date > public.cairo_today() then
    perform app_private.fail('Enter the visit date (today or earlier).');
  end if;
  if p_date < v_site.placed_on then
    perform app_private.fail('A visit cannot be before the implant was placed.');
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    perform app_private.fail('Unknown finding: (not an object).');
  end if;
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(v_f) k where not (k = any (c_keys || c_failure_keys));
  if v_unknown is not null then
    perform app_private.fail(format('Unknown finding: %s.', v_unknown));
  end if;
  v_has_failure := exists (select 1 from jsonb_each_text(v_f) e where e.key = any (c_failure_keys) and nullif(trim(e.value), '') is not null);
  if v_has_failure and p_outcome is distinct from 'failed' then
    perform app_private.fail('Failure details are recorded only with a "failed" outcome.');
  end if;
  if v_has_failure and v_site.failure_type is not null then
    perform app_private.fail('This implant''s failure is already recorded. Edit the failure details instead.');
  end if;
  v_failed_on := app_private.detail_date(v_f, 'failed_on', 'Enter the failure date (from the placement date to today).');
  if v_failed_on > p_date then
    perform app_private.fail('The failure date can''t be after the visit date.');
  end if;

  if p_visit_key is not null then
    select s.label into v_label from public.visit_schedule(99) s where s.visit_key = p_visit_key;
    if v_label is null then
      perform app_private.fail('Unknown visit.');
    end if;
    if exists (select 1 from public.implant_followups
               where site_id = p_site and visit_key = p_visit_key and voided_at is null) then
      perform app_private.fail(format('%s is already recorded for this implant. Remove it first to record it again.', v_label));
    end if;
  elsif length(trim(coalesce(p_check_type, ''))) = 0 then
    perform app_private.fail('Enter what the visit was for (e.g. pain review).');
  end if;

  if p_attendance is null or p_attendance not in ('attended', 'did_not_attend', 'not_needed') then
    perform app_private.fail('Choose whether the patient attended.');
  end if;
  if p_attendance = 'not_needed' and length(trim(coalesce(p_notes, ''))) = 0 then
    perform app_private.fail('Say why the visit was not needed.');
  end if;
  if p_attendance = 'attended' and p_outcome is null then
    perform app_private.fail('Choose the outcome.');
  end if;
  if p_attendance <> 'attended' then
    if p_outcome is not null then
      perform app_private.fail('An outcome is recorded only when the patient attended.');
    end if;
    if exists (select 1 from jsonb_each_text(v_f) e where nullif(trim(e.value), '') is not null) then
      perform app_private.fail('Findings are recorded only when the patient attended.');
    end if;
  end if;

  insert into public.implant_followups (
    site_id, date, check_type, outcome, notes, visit_key, attendance, pain_score, patient_concerns,
    swelling, suppuration, plaque, mobility, probing_mesial, probing_buccal, probing_distal, probing_lingual,
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment
  ) values (
    p_site, p_date, coalesce(v_label, trim(p_check_type)), p_outcome, coalesce(trim(p_notes), ''), p_visit_key, p_attendance,
    app_private.finding_number(v_f, 'pain_score', 0, 10, true, 'Enter a pain score from 0 to 10.')::int,
    coalesce(trim(v_f ->> 'patient_concerns'), ''),
    app_private.finding_choice(v_f, 'swelling', c_yes_no, 'swelling'),
    app_private.finding_choice(v_f, 'suppuration', c_yes_no, 'suppuration'),
    app_private.finding_choice(v_f, 'plaque', c_yes_no, 'plaque'),
    app_private.finding_choice(v_f, 'mobility', c_yes_no, 'mobility'),
    app_private.finding_number(v_f, 'probing_mesial', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_buccal', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_distal', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_lingual', 0, 15, false, c_probing),
    app_private.finding_choice(v_f, 'bop_mesial', c_yes_no, 'bleeding (mesial)'),
    app_private.finding_choice(v_f, 'bop_buccal', c_yes_no, 'bleeding (buccal)'),
    app_private.finding_choice(v_f, 'bop_distal', c_yes_no, 'bleeding (distal)'),
    app_private.finding_choice(v_f, 'bop_lingual', c_yes_no, 'bleeding (lingual)'),
    app_private.finding_number(v_f, 'isq', 0, 100, false, 'Enter an ISQ from 0 to 100.'),
    app_private.finding_choice(v_f, 'prosthesis_status', array['stable', 'loose', 'not_restored'], 'the prosthesis status'),
    app_private.finding_choice(v_f, 'radiograph_taken', c_yes_no, 'whether a radiograph was taken'),
    coalesce(trim(v_f ->> 'recommended_treatment'), '')
  ) returning id into v_id;

  -- The failure details arrive with the visit; a failed visit on a working implant must carry them, and details
  -- given for an implant that failed before details were recorded complete it.
  if p_outcome = 'failed' and (v_site.state <> 'failed' or (v_has_failure and v_site.failure_type is null)) then
    perform app_private.apply_failure(v_site, coalesce(v_failed_on, p_date),
      nullif(trim(v_f ->> 'failure_type'), ''), nullif(trim(v_f ->> 'failure_reason'), ''), coalesce(v_f ->> 'failure_notes', ''));
  end if;
  return v_id;
end $$;
