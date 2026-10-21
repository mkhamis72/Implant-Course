-- Research part 3: restorations. A temporary or final crown, bridge, overdenture or full arch is recorded once
-- and linked to every implant it sits on. Adding one ends every current restoration on any of its implants
-- (a temporary is "replaced", a final is "remade" with a reason); undoing the newest one reopens what it ended.
-- An implant is restored exactly when it has a current final restoration.
create table public.restorations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  stage text not null check (stage in ('temporary', 'final')),
  type text not null check (type in ('single_crown', 'bridge', 'overdenture', 'full_arch')),
  teeth smallint[] not null check (cardinality(teeth) between 1 and 16),
  fitted_on date not null,
  retention text check (retention in ('screw', 'cement', 'attachment')),
  material text check (material in ('zirconia', 'lithium_disilicate', 'metal_ceramic', 'pmma_acrylic', 'composite',
    'metal_framework', 'other')),
  delegate_id uuid references public.delegates (id),
  supervisor_id uuid references public.supervisors (id),
  course_id uuid references public.courses (id),
  notes text not null default '' check (length(notes) <= 1000),
  ended_on date check (ended_on >= fitted_on),
  end_kind text check (end_kind in ('replaced', 'remade')),
  end_reason text check (length(end_reason) <= 500),
  ended_by uuid references public.restorations (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint restorations_ended_together check ((ended_on is null) = (end_kind is null)),
  constraint restorations_remade_reason check (end_kind is distinct from 'remade' or length(trim(end_reason)) > 0)
);
create index restorations_patient_idx on public.restorations (patient_id);
create index restorations_ended_by_idx on public.restorations (ended_by);

create table public.restoration_sites (
  restoration_id uuid not null references public.restorations (id) on delete cascade,
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  primary key (restoration_id, site_id)
);
create index restoration_sites_site_idx on public.restoration_sites (site_id);

create trigger restorations_set_updated_at before update on public.restorations
  for each row execute function app_private.set_updated_at();
create trigger restorations_audit after insert or update or delete on public.restorations
  for each row execute function app_private.audit_row('id');
create trigger restoration_sites_audit after insert or update or delete on public.restoration_sites
  for each row execute function app_private.audit_row('restoration_id');

revoke all on public.restorations from public, anon, authenticated;
grant select on public.restorations to authenticated;
alter table public.restorations enable row level security;
create policy restorations_select on public.restorations for select to authenticated
  using (public.is_active_user());
create policy restorations_area_read on public.restorations as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

revoke all on public.restoration_sites from public, anon, authenticated;
grant select on public.restoration_sites to authenticated;
alter table public.restoration_sites enable row level security;
create policy restoration_sites_select on public.restoration_sites for select to authenticated
  using (public.is_active_user());
create policy restoration_sites_area_read on public.restoration_sites as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- True when the teeth are one run without gaps or repeats in arch order (upper 18→28, lower 48→38).
create function app_private.teeth_contiguous(p_teeth smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  with arch as (
    select case when p_teeth[1] / 10 in (1, 2)
             then array[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]::smallint[]
             else array[48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]::smallint[] end as a
  ), pos as (
    select array_position(arch.a, t) as p from arch, unnest(p_teeth) t
  )
  select coalesce(cardinality(p_teeth), 0) > 0
     and not exists (select 1 from pos where p is null)
     and (select count(distinct p) from pos) = cardinality(p_teeth)
     and (select max(p) - min(p) + 1 from pos) = cardinality(p_teeth);
$$;

-- The teeth in arch order (for storing a bridge's teeth the way they sit in the mouth).
create function app_private.teeth_in_arch_order(p_teeth smallint[]) returns smallint[]
language sql immutable set search_path = '' as $$
  select array_agg(t order by case when t / 10 in (1, 4) then -(t % 10) else t % 10 end)
  from unnest(p_teeth) t;
$$;

-- Applies the Restored state rule to one implant: restored exactly when it has a current final restoration.
-- Only placed/restored implants are switched; the tooth follows.
create function app_private.sync_restored(p_site uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_restored boolean;
begin
  select * into v_site from public.implant_sites where id = p_site;
  if not found or v_site.state not in ('placed', 'restored') then return; end if;
  v_restored := exists (
    select 1 from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
    where rs.site_id = p_site and r.stage = 'final' and r.ended_on is null and r.voided_at is null
  );
  if v_restored = (v_site.state = 'restored') then return; end if;
  update public.implant_sites set state = case when v_restored then 'restored' else 'placed' end::public.site_state
  where id = p_site;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
    case when v_restored then 'restored' else 'implant_placed' end::public.tooth_state);
end $$;

-- Locks the implants, then every implant of a current restoration on them, in id order, so a restoration and its
-- implants always lock in one order. Returns all the locked implants.
create function app_private.lock_restoration_sites(p_sites uuid[]) returns uuid[]
language plpgsql set search_path = '' as $$
declare
  v_all uuid[] := p_sites;
  v_more uuid[];
begin
  loop
    perform 1 from public.implant_sites where id = any (v_all) order by id for update;
    select array_agg(distinct rs2.site_id) into v_more
    from public.restoration_sites rs
    join public.restorations r on r.id = rs.restoration_id and r.ended_on is null and r.voided_at is null
    join public.restoration_sites rs2 on rs2.restoration_id = r.id
    where rs.site_id = any (v_all) and not (rs2.site_id = any (v_all));
    exit when v_more is null;
    v_all := v_all || v_more;
  end loop;
  return v_all;
end $$;

-- Validates the details that can be edited later.
create function app_private.check_restoration_details(
  p_retention text, p_material text, p_delegate uuid, p_supervisor uuid, p_course uuid, p_notes text
) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_retention is not null and p_retention not in ('screw', 'cement', 'attachment') then
    perform app_private.fail('Choose the retention from the list.');
  end if;
  if p_material is not null and p_material not in ('zirconia', 'lithium_disilicate', 'metal_ceramic', 'pmma_acrylic',
      'composite', 'metal_framework', 'other') then
    perform app_private.fail('Choose the material from the list.');
  end if;
  if p_delegate is not null and not exists (select 1 from public.delegates where id = p_delegate) then
    perform app_private.fail('Choose a delegate from the list.');
  end if;
  if p_supervisor is not null and not exists (select 1 from public.supervisors where id = p_supervisor) then
    perform app_private.fail('Choose a supervisor from the list.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  if length(trim(coalesce(p_notes, ''))) > 1000 then
    perform app_private.fail('Keep the notes under 1000 characters.');
  end if;
end $$;

revoke execute on function app_private.teeth_contiguous(smallint[]) from public;
revoke execute on function app_private.teeth_in_arch_order(smallint[]) from public;
revoke execute on function app_private.sync_restored(uuid) from public;
revoke execute on function app_private.lock_restoration_sites(uuid[]) from public;
revoke execute on function app_private.check_restoration_details(text, text, uuid, uuid, uuid, text) from public;

create function public.add_restoration(
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

create function public.update_restoration(
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
  update public.restorations
  set retention = p_retention, material = p_material, delegate_id = p_delegate, supervisor_id = p_supervisor,
      course_id = p_course, notes = trim(coalesce(p_notes, ''))
  where id = p_restoration;
end $$;

create function public.void_restoration(p_restoration uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.restorations;
  v_sites uuid[];
  v_all uuid[];
  v_site uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this restoration is being removed from the record.');
  end if;
  -- Its implants and those of the restorations it ended (which reopen), locked before the restorations.
  select coalesce(array_agg(distinct rs.site_id), '{}') into v_sites
  from public.restoration_sites rs
  where rs.restoration_id = p_restoration
     or rs.restoration_id in (select id from public.restorations where ended_by = p_restoration);
  v_all := app_private.lock_restoration_sites(v_sites);

  select * into v_r from public.restorations where id = p_restoration and voided_at is null for update;
  if not found then perform app_private.fail('Restoration not found.'); end if;
  if v_r.ended_on is not null then
    perform app_private.fail('Only the newest restoration on these implants can be undone.');
  end if;
  perform 1 from public.restorations where ended_by = p_restoration order by id for update;
  -- Reopening must not give an implant two current restorations.
  if exists (
    select 1
    from public.restorations reopened
    join public.restoration_sites rs on rs.restoration_id = reopened.id
    join public.restoration_sites other_rs on other_rs.site_id = rs.site_id
    join public.restorations other on other.id = other_rs.restoration_id
    where reopened.ended_by = p_restoration
      and other.id <> p_restoration and other.ended_on is null and other.voided_at is null
  ) then
    perform app_private.fail('Only the newest restoration on these implants can be undone.');
  end if;

  update public.restorations
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_restoration;
  update public.restorations
  set ended_on = null, end_kind = null, end_reason = null, ended_by = null
  where ended_by = p_restoration;

  foreach v_site in array v_all loop
    perform app_private.sync_restored(v_site);
  end loop;
end $$;

revoke execute on function public.add_restoration(uuid, text, text, uuid[], smallint[], date, text, text, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.add_restoration(uuid, text, text, uuid[], smallint[], date, text, text, uuid, uuid, uuid, text, text) to authenticated;
revoke execute on function public.update_restoration(uuid, text, text, uuid, uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.update_restoration(uuid, text, text, uuid, uuid, uuid, text, timestamptz) to authenticated;
revoke execute on function public.void_restoration(uuid, text) from public, anon;
grant execute on function public.void_restoration(uuid, text) to authenticated;

-- History tab and the audit-log read rule cover restorations (latest definitions: 0047).
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications',
                          'restoration_sites')
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
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites'))
  );
