-- Research part 4: radiographs and bone levels. Each X-ray of a patient is logged once (date, type, purpose, the
-- teeth it shows, an optional link to the image, notes), with optional mesial/distal bone levels for the implants on
-- those teeth. Bone level is in mm from the implant shoulder: positive = bone below the shoulder, null = not measured.
create table public.radiographs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  taken_on date not null,
  type text not null check (type in ('periapical', 'cbct')),
  purpose text not null check (purpose in ('planning', 'baseline', 'loading', 'follow_up', 'other')),
  teeth smallint[] not null check (
    cardinality(teeth) >= 1
    and teeth <@ array[11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
                       31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]::smallint[]),
  link text check (link ~ '^https?://' and length(link) <= 2000),
  notes text not null default '' check (length(notes) <= 1000),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);
create index radiographs_patient_idx on public.radiographs (patient_id);

create table public.radiograph_bone_levels (
  radiograph_id uuid not null references public.radiographs (id) on delete cascade,
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  mesial_mm numeric(3, 1) check (mesial_mm between -5 and 15),
  distal_mm numeric(3, 1) check (distal_mm between -5 and 15),
  primary key (radiograph_id, site_id),
  constraint radiograph_bone_levels_measured check (mesial_mm is not null or distal_mm is not null)
);
create index radiograph_bone_levels_site_idx on public.radiograph_bone_levels (site_id);

create trigger radiographs_set_updated_at before update on public.radiographs
  for each row execute function app_private.set_updated_at();
create trigger radiographs_audit after insert or update or delete on public.radiographs
  for each row execute function app_private.audit_row('id');
create trigger radiograph_bone_levels_audit after insert or update or delete on public.radiograph_bone_levels
  for each row execute function app_private.audit_row('radiograph_id');

revoke all on public.radiographs from public, anon, authenticated;
grant select on public.radiographs to authenticated;
alter table public.radiographs enable row level security;
create policy radiographs_select on public.radiographs for select to authenticated
  using (public.is_active_user());
create policy radiographs_area_read on public.radiographs as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

revoke all on public.radiograph_bone_levels from public, anon, authenticated;
grant select on public.radiograph_bone_levels to authenticated;
alter table public.radiograph_bone_levels enable row level security;
create policy radiograph_bone_levels_select on public.radiograph_bone_levels for select to authenticated
  using (public.is_active_user());
create policy radiograph_bone_levels_area_read on public.radiograph_bone_levels as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- Adds (p_id null) or edits an X-ray. p_levels is the whole measurement set, a JSON array of
-- {"site": uuid, "mesial_mm": number|null, "distal_mm": number|null}; it replaces the stored set.
create function public.save_radiograph(
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

  if p_purpose in ('baseline', 'loading', 'follow_up') and not exists (
    select 1 from public.implant_sites
    where patient_id = p_patient and tooth = any (v_teeth) and state in ('placed', 'restored', 'failed')
      and placed_on <= p_taken_on
  ) then
    perform app_private.fail('A baseline, loading or follow-up X-ray needs an implant placed by its date on one of its teeth.');
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
    delete from public.radiograph_bone_levels where radiograph_id = v_id;
  end if;

  insert into public.radiograph_bone_levels (radiograph_id, site_id, mesial_mm, distal_mm)
  select v_id, (e ->> 'site')::uuid, round((e ->> 'mesial_mm')::numeric, 1), round((e ->> 'distal_mm')::numeric, 1)
  from jsonb_array_elements(v_levels) e;
  return v_id;
end $$;

create function public.void_radiograph(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this X-ray is being removed from the record.');
  end if;
  perform 1 from public.radiographs where id = p_id and voided_at is null for update;
  if not found then perform app_private.fail('X-ray not found.'); end if;
  update public.radiographs
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_id;
end $$;

revoke execute on function public.save_radiograph(uuid, uuid, date, text, text, smallint[], text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_radiograph(uuid, uuid, date, text, text, smallint[], text, text, jsonb, timestamptz) to authenticated;
revoke execute on function public.void_radiograph(uuid, text) from public, anon;
grant execute on function public.void_radiograph(uuid, text) to authenticated;

-- A patient's X-rays (not voided), newest first, each with its bone levels in tooth order. Obeys RLS (View on Patients).
create function public.radiographs_for(p_patient uuid)
returns table (id uuid, taken_on date, type text, purpose text, teeth smallint[], link text, notes text,
               updated_at timestamptz, levels jsonb)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.taken_on, r.type, r.purpose, r.teeth, r.link, r.notes, r.updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('site', s.id, 'tooth', s.tooth, 'mesial_mm', b.mesial_mm,
                                               'distal_mm', b.distal_mm) order by s.tooth, s.id)
           from public.radiograph_bone_levels b
           join public.implant_sites s on s.id = b.site_id
           where b.radiograph_id = r.id
         ), '[]'::jsonb) as levels
  from public.radiographs r
  where r.patient_id = p_patient and r.voided_at is null
  order by r.taken_on desc, r.created_at desc;
$$;

revoke execute on function public.radiographs_for(uuid) from public, anon;
grant execute on function public.radiographs_for(uuid) to authenticated;

-- History tab and the audit-log read rule cover X-rays and their bone levels (latest definitions: 0058).
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations', 'radiographs')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications',
                          'restoration_sites')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
     or (a.table_name = 'restoration_problems'
         and coalesce(a.after ->> 'restoration_id', a.before ->> 'restoration_id') in
             (select r.id::text from public.restorations r where r.patient_id = p_patient))
     or (a.table_name = 'radiograph_bone_levels'
         and coalesce(a.after ->> 'radiograph_id', a.before ->> 'radiograph_id') in
             (select x.id::text from public.radiographs x where x.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems',
                           'radiographs', 'radiograph_bone_levels'))
  );
