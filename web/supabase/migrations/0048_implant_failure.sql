-- Research readiness, part 2b: structured implant failure. Recorded with a "failed" visit (record_visit) or, for
-- implants failed before this, with record_failure; editable with correct_failure. Early vs late is derived in
-- the app, not stored. Undoing the failed visit (void_followup) clears the details with the failure.
alter table public.implant_sites
  add column failed_on date,
  add column failure_type text check (failure_type in ('lost', 'removed', 'failed_in_place')),
  add column failure_reason text check (failure_reason in ('no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other')),
  add column failure_notes text not null default '' check (length(failure_notes) <= 1000);

-- Validates and writes failure details on a locked site, failing the implant and the tooth.
create function app_private.apply_failure(v_site public.implant_sites, p_failed_on date, p_type text, p_reason text, p_notes text)
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
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
end $$;
revoke execute on function app_private.apply_failure(public.implant_sites, date, text, text, text) from public;

create function public.record_failure(p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Failure details are recorded for placed implants.');
  end if;
  if v_site.failure_type is not null then
    perform app_private.fail('This implant''s failure is already recorded. Edit the failure details instead.');
  end if;
  perform app_private.apply_failure(v_site, p_failed_on, p_type, p_reason, p_notes);
end $$;

create function public.correct_failure(
  p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text, p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.failure_type is null then
    perform app_private.fail('No failure details are recorded for this implant.');
  end if;
  if p_expected_updated_at is null or v_site.updated_at <> p_expected_updated_at then
    perform app_private.fail('This implant was changed by someone else. Reload to see it.');
  end if;
  perform app_private.apply_failure(v_site, p_failed_on, p_type, p_reason, p_notes);
end $$;

revoke execute on function public.record_failure(uuid, date, text, text, text) from public, anon;
grant execute on function public.record_failure(uuid, date, text, text, text) to authenticated;
revoke execute on function public.correct_failure(uuid, date, text, text, text, timestamptz) from public, anon;
grant execute on function public.correct_failure(uuid, date, text, text, text, timestamptz) to authenticated;

-- record_visit: latest 0045_visit_records.sql; findings may also carry the failure details, which a failed visit
-- on a working implant must include.
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
    -- The failure details arrive with the visit; a failed visit on a working implant must carry them.
    perform app_private.apply_failure(v_site,
      coalesce(app_private.detail_date(v_f, 'failed_on', 'Enter the failure date (from the placement date to today).'), p_date),
      nullif(trim(v_f ->> 'failure_type'), ''), nullif(trim(v_f ->> 'failure_reason'), ''), coalesce(v_f ->> 'failure_notes', ''));
  end if;
  return v_id;
end $$;

-- void_followup: latest 0030_permissions.sql; undoing the failure also clears its details.
create or replace function public.void_followup(p_followup uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.implant_followups;
  v_site public.implant_sites;
  v_state public.site_state;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this follow-up');
  select * into v_f from public.implant_followups where id = p_followup and voided_at is null;
  if not found then
    perform app_private.fail('Follow-up not found.');
  end if;
  select * into v_site from public.implant_sites where id = v_f.site_id for update;
  update public.implant_followups
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_followup;

  if v_f.outcome = 'failed' and v_site.state = 'failed'
     and not exists (select 1 from public.implant_followups where site_id = v_site.id and outcome = 'failed' and voided_at is null) then
    if exists (
      select 1 from public.implant_sites
      where patient_id = v_site.patient_id and tooth = v_site.tooth and state not in ('failed', 'removed')
    ) then
      perform app_private.fail('A new implant is already recorded on this tooth, so the failure cannot be undone.');
    end if;
    v_state := case when exists (
      select 1 from public.site_components
      where site_id = v_site.id and removed_on is null and voided_at is null and component_type = 'final_restoration'
    ) then 'restored' else 'placed' end;
    update public.implant_sites
    set state = v_state, failed_on = null, failure_type = null, failure_reason = null, failure_notes = ''
    where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
      case when v_state = 'restored' then 'restored' else 'implant_placed' end::public.tooth_state);
  end if;
end $$;

-- implant_visits and recall_list: latest 0046_visit_status.sql. A failed implant keeps the visits whose window
-- closed before it failed; the recall list looks at the visit's own implant, not any implant of the patient.
create or replace function public.implant_visits(p_patient uuid)
returns table (site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_start date,
  window_end date, status text, followup_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.tooth::smallint, v.visit_key, v.label,
         s.placed_on + v.target_day, s.placed_on + v.window_start, s.placed_on + v.window_end,
         case
           when f.id is not null then
             case f.attendance when 'did_not_attend' then 'did_not_attend' when 'not_needed' then 'not_needed' else 'done' end
           when public.cairo_today() < s.placed_on + v.window_start then 'upcoming'
           when public.cairo_today() <= s.placed_on + v.target_day then 'due'
           when public.cairo_today() <= s.placed_on + v.window_end then 'overdue'
           else 'missed'
         end,
         f.id
  from public.implant_sites s
  cross join lateral public.visit_schedule(((public.cairo_today() - s.placed_on) + 60) / 365 + 1) v
  left join public.implant_followups f
    on f.site_id = s.id and f.visit_key = v.visit_key and f.voided_at is null
  where s.patient_id = p_patient
    and s.placed_on is not null
    and (select public.can('patients', 'view'))
    -- A failed (or removed) implant expects nothing more; what was recorded still shows.
    and (s.state in ('placed', 'restored') or f.id is not null
         -- A failed implant keeps the visits whose window closed before it failed.
         or (s.failed_on is not null and s.placed_on + v.window_end < s.failed_on))
  order by s.tooth, s.placed_on + v.target_day;
$$;

create or replace function public.recall_list()
returns table (patient_id uuid, full_name text, phone text, site_id uuid, tooth smallint, visit_key text, label text,
  target_date date, window_end date, status text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.phone, v.site_id, v.tooth, v.visit_key, v.label, v.target_date, v.window_end, v.status
  from public.patients p
  cross join lateral public.implant_visits(p.id) v
  where not p.archived
    and exists (select 1 from public.implant_sites s where s.id = v.site_id and s.state in ('placed', 'restored'))
    and (v.status in ('due', 'overdue') or (v.status = 'missed' and v.window_end >= public.cairo_today() - 60))
  order by v.target_date, p.full_name, v.tooth;
$$;
