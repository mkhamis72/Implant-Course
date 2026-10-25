-- Explore clinical data, part 1: recession at follow-up visits (facial, mesial, distal; mm). Empty = not measured.
-- record_visit takes it with the other findings (same signature, so the grants stay).

alter table public.implant_followups
  add column recession_facial_mm numeric(3, 1) check (recession_facial_mm between 0 and 15),
  add column recession_mesial_mm numeric(3, 1) check (recession_mesial_mm between 0 and 15),
  add column recession_distal_mm numeric(3, 1) check (recession_distal_mm between 0 and 15);

-- Latest definition: 0049_failure_fixes.sql.
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
    'bop_lingual', 'isq', 'prosthesis_status', 'radiograph_taken', 'recommended_treatment',
    'recession_facial_mm', 'recession_mesial_mm', 'recession_distal_mm'];
  c_yes_no constant text[] := array['yes', 'no'];
  c_probing constant text := 'Enter probing depths from 0 to 15 mm.';
  c_recession constant text := 'Enter recession from 0 to 15 mm.';
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
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment,
    recession_facial_mm, recession_mesial_mm, recession_distal_mm
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
    coalesce(trim(v_f ->> 'recommended_treatment'), ''),
    app_private.finding_number(v_f, 'recession_facial_mm', 0, 15, false, c_recession),
    app_private.finding_number(v_f, 'recession_mesial_mm', 0, 15, false, c_recession),
    app_private.finding_number(v_f, 'recession_distal_mm', 0, 15, false, c_recession)
  ) returning id into v_id;

  -- The failure details arrive with the visit; a failed visit on a working implant must carry them, and details
  -- given for an implant that failed before details were recorded complete it.
  if p_outcome = 'failed' and (v_site.state <> 'failed' or (v_has_failure and v_site.failure_type is null)) then
    perform app_private.apply_failure(v_site, coalesce(v_failed_on, p_date),
      nullif(trim(v_f ->> 'failure_type'), ''), nullif(trim(v_f ->> 'failure_reason'), ''), coalesce(v_f ->> 'failure_notes', ''));
  end if;
  return v_id;
end $$;
