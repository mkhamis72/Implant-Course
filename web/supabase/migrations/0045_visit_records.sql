-- Research readiness, part 2a: a follow-up becomes a visit — scheduled (visit_key) or unscheduled — with
-- attendance and structured findings. Empty means not assessed. Existing rows stay as unscheduled visits
-- (visit_key and attendance null). record_followup stays for the previous app version; a later PR drops it.
alter table public.implant_followups
  add column visit_key text check (visit_key ~ '^(early_review|osseointegration|month_6|month_12|year_([2-9]|[1-9][0-9]))$'),
  add column attendance text check (attendance in ('attended', 'did_not_attend', 'not_needed')),
  add column pain_score int check (pain_score between 0 and 10),
  add column patient_concerns text not null default '' check (length(patient_concerns) <= 1000),
  add column swelling text check (swelling in ('yes', 'no')),
  add column suppuration text check (suppuration in ('yes', 'no')),
  add column plaque text check (plaque in ('yes', 'no')),
  add column mobility text check (mobility in ('yes', 'no')),
  add column probing_mesial numeric(3, 1) check (probing_mesial between 0 and 15),
  add column probing_buccal numeric(3, 1) check (probing_buccal between 0 and 15),
  add column probing_distal numeric(3, 1) check (probing_distal between 0 and 15),
  add column probing_lingual numeric(3, 1) check (probing_lingual between 0 and 15),
  add column bop_mesial text check (bop_mesial in ('yes', 'no')),
  add column bop_buccal text check (bop_buccal in ('yes', 'no')),
  add column bop_distal text check (bop_distal in ('yes', 'no')),
  add column bop_lingual text check (bop_lingual in ('yes', 'no')),
  add column isq numeric(4, 1) check (isq between 0 and 100),
  add column prosthesis_status text check (prosthesis_status in ('stable', 'loose', 'not_restored')),
  add column radiograph_taken text check (radiograph_taken in ('yes', 'no')),
  add column recommended_treatment text not null default '' check (length(recommended_treatment) <= 1000);

-- A not-attended visit has no outcome. (The previous app version may briefly show it blank.)
alter table public.implant_followups alter column outcome drop not null;

create unique index implant_followups_one_visit on public.implant_followups (site_id, visit_key)
  where voided_at is null and visit_key is not null;

-- The fixed visit schedule, in days after placement. p_through = the last annual (year-N) visit to list.
create function public.visit_schedule(p_through int)
returns table (visit_key text, label text, target_day int, window_start int, window_end int)
language sql immutable set search_path = '' as $$
  select * from (values
    ('early_review', 'Early review (suture removal)', 10, 7, 21),
    ('osseointegration', 'Osseointegration check', 90, 70, 112),
    ('month_6', '6-month review', 182, 152, 212),
    ('month_12', '12-month review', 365, 305, 425)
  ) v (visit_key, label, target_day, window_start, window_end)
  union all
  select 'year_' || n, 'Year-' || n || ' review', 365 * n, 365 * n - 60, 365 * n + 60
  from generate_series(2, p_through) n;
$$;
revoke execute on function public.visit_schedule(int) from public, anon;
grant execute on function public.visit_schedule(int) to authenticated;

-- Finding readers for record_visit (called only from that definer function). Empty or missing = not assessed.
create function app_private.finding_number(p jsonb, k text, lo numeric, hi numeric, whole boolean, message text)
returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]+(\.[0-9]+)?$' then perform app_private.fail(message); end if;
  if v::numeric < lo or v::numeric > hi or (whole and v::numeric <> trunc(v::numeric)) then
    perform app_private.fail(message);
  end if;
  return v::numeric;
end $$;

create function app_private.finding_choice(p jsonb, k text, allowed text[], label text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is not null and not (v = any (allowed)) then
    perform app_private.fail(format('Choose %s from the list.', label));
  end if;
  return v;
end $$;

revoke execute on function app_private.finding_number(jsonb, text, numeric, numeric, boolean, text) from public;
revoke execute on function app_private.finding_choice(jsonb, text, text[], text) from public;

create function public.record_visit(
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
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(v_f) k where not (k = any (c_keys));
  if v_unknown is not null then
    perform app_private.fail(format('Unknown finding: %s.', v_unknown));
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

  if p_outcome = 'failed' and v_site.state <> 'failed' then
    update public.implant_sites set state = 'failed' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
  return v_id;
end $$;

revoke execute on function public.record_visit(uuid, date, text, text, text, public.followup_outcome, jsonb, text) from public, anon;
grant execute on function public.record_visit(uuid, date, text, text, text, public.followup_outcome, jsonb, text) to authenticated;
