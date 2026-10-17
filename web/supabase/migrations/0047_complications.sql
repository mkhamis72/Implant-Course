-- Research readiness, part 2b: complications as their own events, at any time, optionally linked to the visit
-- where they were found. Editable as they evolve (treatment, resolution); removed by voiding, never deleted.
-- Peri-implantitis and mucositis are the clinician's diagnosis; nothing here diagnoses automatically.
create table public.implant_complications (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  category text not null check (category in ('surgical', 'biological', 'mechanical')),
  type text not null,
  other_type text not null default '' check (length(other_type) <= 120),
  noticed_on date not null,
  severity text check (severity in ('mild', 'moderate', 'severe')),
  treatment text not null default '' check (length(treatment) <= 1000),
  resolved_on date check (resolved_on >= noticed_on),
  followup_id uuid references public.implant_followups (id) on delete set null,
  notes text not null default '' check (length(notes) <= 1000),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_complications_type_in_category check (
    (category = 'surgical' and type in ('intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication',
      'wound_dehiscence', 'infection', 'graft_exposure_loss', 'early_osseointegration_loss', 'other'))
    or (category = 'biological' and type in ('mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration',
      'persistent_pain', 'soft_tissue_recession', 'other'))
    or (category = 'mechanical' and type in ('implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture',
      'restoration_fracture', 'loss_of_retention', 'prosthetic_remake', 'other'))
  ),
  constraint implant_complications_other_named check (type <> 'other' or length(trim(other_type)) > 0)
);
create index implant_complications_site_idx on public.implant_complications (site_id);

create trigger implant_complications_set_updated_at before update on public.implant_complications
  for each row execute function app_private.set_updated_at();
create trigger implant_complications_audit after insert or update or delete on public.implant_complications
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_complications from public, anon, authenticated;
grant select on public.implant_complications to authenticated;
alter table public.implant_complications enable row level security;
create policy implant_complications_select on public.implant_complications for select to authenticated
  using (public.is_active_user());
create policy implant_complications_area_read on public.implant_complications as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- A date detail (YYYY-MM-DD) or null; anything else fails with the message.
create function app_private.detail_date(p jsonb, k text, message text) returns date
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app_private.fail(message); end if;
  begin
    return v::date;
  exception when others then
    perform app_private.fail(message);
  end;
  return null;
end $$;

-- Validates a complication's details for a locked, placed site and returns them as a row of the table
-- (only the detail columns are filled).
create function app_private.complication_details(v_site public.implant_sites, p jsonb)
returns public.implant_complications
language plpgsql stable set search_path = '' as $$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  r public.implant_complications;
  v_unknown text;
  v_when text := 'Enter when the complication was noticed (from the placement date to today).';
begin
  if jsonb_typeof(d) <> 'object' then perform app_private.fail('Unknown detail: (not an object).'); end if;
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(d) k
  where not (k = any (array['category', 'type', 'other_type', 'noticed_on', 'severity', 'treatment', 'resolved_on', 'followup_id', 'notes']));
  if v_unknown is not null then perform app_private.fail(format('Unknown detail: %s.', v_unknown)); end if;

  r.category := nullif(trim(d ->> 'category'), '');
  if r.category is null or r.category not in ('surgical', 'biological', 'mechanical') then
    perform app_private.fail('Choose the complication category.');
  end if;
  r.type := nullif(trim(d ->> 'type'), '');
  if r.type is null or not (r.type = any (case r.category
      when 'surgical' then array['intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication',
        'wound_dehiscence', 'infection', 'graft_exposure_loss', 'early_osseointegration_loss', 'other']
      when 'biological' then array['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration',
        'persistent_pain', 'soft_tissue_recession', 'other']
      else array['implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture', 'restoration_fracture',
        'loss_of_retention', 'prosthetic_remake', 'other'] end)) then
    perform app_private.fail('Choose the complication type.');
  end if;
  r.other_type := coalesce(trim(d ->> 'other_type'), '');
  if r.type = 'other' and r.other_type = '' then perform app_private.fail('Describe the other complication.'); end if;
  if r.type <> 'other' then r.other_type := ''; end if;

  r.noticed_on := app_private.detail_date(d, 'noticed_on', v_when);
  if r.noticed_on is null or r.noticed_on < v_site.placed_on or r.noticed_on > public.cairo_today() then
    perform app_private.fail(v_when);
  end if;
  r.resolved_on := app_private.detail_date(d, 'resolved_on',
    'The resolved date must be on or after the date noticed, and not in the future.');
  if r.resolved_on is not null and (r.resolved_on < r.noticed_on or r.resolved_on > public.cairo_today()) then
    perform app_private.fail('The resolved date must be on or after the date noticed, and not in the future.');
  end if;

  r.severity := nullif(trim(d ->> 'severity'), '');
  if r.severity is not null and r.severity not in ('mild', 'moderate', 'severe') then
    perform app_private.fail('Choose the severity from the list.');
  end if;

  if nullif(trim(d ->> 'followup_id'), '') is not null then
    if (d ->> 'followup_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app_private.fail('Choose a visit of this implant.');
    end if;
    r.followup_id := (d ->> 'followup_id')::uuid;
    if not exists (select 1 from public.implant_followups f where f.id = r.followup_id and f.site_id = v_site.id and f.voided_at is null) then
      perform app_private.fail('Choose a visit of this implant.');
    end if;
  end if;

  r.treatment := coalesce(trim(d ->> 'treatment'), '');
  r.notes := coalesce(trim(d ->> 'notes'), '');
  if length(r.other_type) > 120 or length(r.treatment) > 1000 or length(r.notes) > 1000 then
    perform app_private.fail('Keep the text shorter (other type 120, treatment and notes 1000 characters).');
  end if;
  return r;
end $$;

create function app_private.lock_complication_site(p_site uuid) returns public.implant_sites
language plpgsql set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Complications are recorded for placed implants.');
  end if;
  return v_site;
end $$;

revoke execute on function app_private.detail_date(jsonb, text, text) from public;
revoke execute on function app_private.complication_details(public.implant_sites, jsonb) from public;
revoke execute on function app_private.lock_complication_site(uuid) from public;

create function public.record_complication(p_site uuid, p_details jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  r public.implant_complications;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_complication_site(p_site);
  r := app_private.complication_details(v_site, p_details);
  insert into public.implant_complications (site_id, category, type, other_type, noticed_on, severity, treatment, resolved_on, followup_id, notes)
  values (p_site, r.category, r.type, r.other_type, r.noticed_on, r.severity, r.treatment, r.resolved_on, r.followup_id, r.notes)
  returning id into v_id;
  return v_id;
end $$;

create function public.update_complication(p_complication uuid, p_details jsonb, p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.implant_complications;
  v_site public.implant_sites;
  r public.implant_complications;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
  v_site := app_private.lock_complication_site(v_c.site_id);
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null for update;
  if not found then perform app_private.fail('Complication not found.'); end if;
  if p_expected_updated_at is null or v_c.updated_at <> p_expected_updated_at then
    perform app_private.fail('This complication was changed by someone else. Reload to see it.');
  end if;
  r := app_private.complication_details(v_site, p_details);
  update public.implant_complications
  set category = r.category, type = r.type, other_type = r.other_type, noticed_on = r.noticed_on, severity = r.severity,
      treatment = r.treatment, resolved_on = r.resolved_on, followup_id = r.followup_id, notes = r.notes
  where id = p_complication;
end $$;

create function public.void_complication(p_complication uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.implant_complications;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this complication');
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
  perform 1 from public.implant_sites where id = v_c.site_id for update;
  update public.implant_complications
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
end $$;

revoke execute on function public.record_complication(uuid, jsonb) from public, anon;
grant execute on function public.record_complication(uuid, jsonb) to authenticated;
revoke execute on function public.update_complication(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.update_complication(uuid, jsonb, timestamptz) to authenticated;
revoke execute on function public.void_complication(uuid, text) from public, anon;
grant execute on function public.void_complication(uuid, text) to authenticated;

-- History tab and the audit-log read rule cover complications (latest definitions: 0044).
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications'))
  );
