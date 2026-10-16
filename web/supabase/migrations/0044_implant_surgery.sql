-- Research readiness, part 1: surgical details of a placed implant (one row per implant) and its grafts (any
-- number). Placement itself (place_implant_v2) is unchanged: details are added then or later. An empty value
-- means not recorded. Writes go only through the definer functions below.
create table public.implant_surgery (
  site_id uuid primary key references public.implant_sites (id) on delete cascade,
  extraction_date date,
  placement_timing text check (placement_timing in ('immediate', 'early_soft_tissue', 'early_partial_bone', 'delayed')),
  soft_tissue_phenotype text check (soft_tissue_phenotype in ('thin', 'thick')),
  keratinized_mucosa_mm numeric(3, 1) check (keratinized_mucosa_mm between 0 and 15),
  flap text check (flap in ('flapless', 'crestal', 'crestal_releasing', 'papilla_sparing', 'other')),
  torque_type text check (torque_type in ('peak', 'final')),
  healing text check (healing in ('submerged', 'transmucosal', 'immediate_provisional')),
  primary_closure text check (primary_closure in ('yes', 'no')),
  grafting_performed text check (grafting_performed in ('yes', 'no')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);

create table public.implant_grafts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  procedure text not null check (procedure in ('socket_preservation', 'gbr', 'horizontal_augmentation', 'vertical_augmentation',
    'sinus_crestal', 'sinus_lateral', 'ridge_split', 'other')),
  timing text not null check (timing in ('simultaneous', 'staged')),
  performed_on date,
  material text check (material in ('autogenous', 'allograft', 'xenograft', 'alloplast', 'combination', 'none')),
  product text not null default '' check (length(product) <= 120),
  membrane text check (membrane in ('none', 'resorbable', 'non_resorbable')),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_grafts_staged_date check ((timing = 'staged') = (performed_on is not null))
);
create index implant_grafts_site_idx on public.implant_grafts (site_id);

create trigger implant_surgery_set_updated_at before update on public.implant_surgery
  for each row execute function app_private.set_updated_at();
create trigger implant_grafts_set_updated_at before update on public.implant_grafts
  for each row execute function app_private.set_updated_at();
create trigger implant_surgery_audit after insert or update or delete on public.implant_surgery
  for each row execute function app_private.audit_row('site_id');
create trigger implant_grafts_audit after insert or update or delete on public.implant_grafts
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_surgery, public.implant_grafts from public, anon, authenticated;
grant select on public.implant_surgery, public.implant_grafts to authenticated;
alter table public.implant_surgery enable row level security;
alter table public.implant_grafts enable row level security;
create policy implant_surgery_select on public.implant_surgery for select to authenticated using (public.is_active_user());
create policy implant_grafts_select on public.implant_grafts for select to authenticated using (public.is_active_user());
create policy implant_surgery_area_read on public.implant_surgery as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy implant_grafts_area_read on public.implant_grafts as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- The site must be placed (placed, restored or failed); returns it locked. Lock order: site, then its details.
create function app_private.lock_placed_site(p_site uuid) returns public.implant_sites
language plpgsql set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Surgical details can only be recorded for a placed implant.');
  end if;
  return v_site;
end $$;

create function public.save_implant_surgery(
  p_site uuid, p_extraction_date date, p_placement_timing text, p_soft_tissue_phenotype text, p_keratinized_mucosa_mm numeric,
  p_flap text, p_torque_type text, p_healing text, p_primary_closure text, p_grafting_performed text,
  p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_row public.implant_surgery;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_placed_site(p_site);
  if p_extraction_date is not null and p_extraction_date > v_site.placed_on then
    perform app_private.fail(format('The extraction date can''t be after the placement date (%s).', v_site.placed_on));
  end if;
  if p_placement_timing = 'immediate' and p_extraction_date is not null and p_extraction_date <> v_site.placed_on then
    perform app_private.fail('An immediate placement is on the extraction day. Change the timing or the extraction date.');
  end if;
  if p_grafting_performed = 'no' and exists (select 1 from public.implant_grafts where site_id = p_site) then
    perform app_private.fail('This implant has grafts recorded. Delete them before setting Grafting performed to No.');
  end if;

  select * into v_row from public.implant_surgery where site_id = p_site for update;
  if found then
    if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    update public.implant_surgery
    set extraction_date = p_extraction_date, placement_timing = p_placement_timing, soft_tissue_phenotype = p_soft_tissue_phenotype,
        keratinized_mucosa_mm = p_keratinized_mucosa_mm, flap = p_flap, torque_type = p_torque_type, healing = p_healing,
        primary_closure = p_primary_closure, grafting_performed = p_grafting_performed
    where site_id = p_site;
  else
    if p_expected_updated_at is not null then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    insert into public.implant_surgery (site_id, extraction_date, placement_timing, soft_tissue_phenotype, keratinized_mucosa_mm,
      flap, torque_type, healing, primary_closure, grafting_performed)
    values (p_site, p_extraction_date, p_placement_timing, p_soft_tissue_phenotype, p_keratinized_mucosa_mm,
      p_flap, p_torque_type, p_healing, p_primary_closure, p_grafting_performed);
  end if;
end $$;

-- Shared checks for adding or changing a graft on a locked, placed site.
create function app_private.check_graft(v_site public.implant_sites, p_procedure text, p_timing text, p_performed_on date)
returns void
language plpgsql set search_path = '' as $$
begin
  if p_procedure is null then perform app_private.fail('Choose the graft procedure.'); end if;
  if p_timing is null then perform app_private.fail('Choose simultaneous or staged.'); end if;
  if p_timing = 'staged' and (p_performed_on is null or p_performed_on >= v_site.placed_on) then
    perform app_private.fail(format('A staged graft needs its date, before the placement date (%s).', v_site.placed_on));
  end if;
end $$;

create function public.add_implant_graft(
  p_site uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_placed_site(p_site);
  if exists (select 1 from public.implant_surgery where site_id = p_site and grafting_performed = 'no') then
    perform app_private.fail('Grafting performed is set to No for this implant. Change it to Yes before adding a graft.');
  end if;
  perform app_private.check_graft(v_site, p_procedure, p_timing, p_performed_on);
  insert into public.implant_grafts (site_id, procedure, timing, performed_on, material, product, membrane, notes)
  values (p_site, p_procedure, p_timing, case when p_timing = 'staged' then p_performed_on end, p_material,
    coalesce(trim(p_product), ''), p_membrane, coalesce(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.update_implant_graft(
  p_graft uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site_id uuid;
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select site_id into v_site_id from public.implant_grafts where id = p_graft;
  if not found then perform app_private.fail('Graft not found.'); end if;
  v_site := app_private.lock_placed_site(v_site_id);
  perform app_private.check_graft(v_site, p_procedure, p_timing, p_performed_on);
  update public.implant_grafts
  set procedure = p_procedure, timing = p_timing, performed_on = case when p_timing = 'staged' then p_performed_on end,
      material = p_material, product = coalesce(trim(p_product), ''), membrane = p_membrane, notes = coalesce(trim(p_notes), '')
  where id = p_graft;
end $$;

create function public.delete_implant_graft(p_graft uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  select site_id into v_site_id from public.implant_grafts where id = p_graft;
  if not found then perform app_private.fail('Graft not found.'); end if;
  perform app_private.lock_placed_site(v_site_id);
  delete from public.implant_grafts where id = p_graft;
end $$;

revoke execute on function public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz) to authenticated;
revoke execute on function public.add_implant_graft(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.add_implant_graft(uuid, text, text, date, text, text, text, text) to authenticated;
revoke execute on function public.update_implant_graft(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.update_implant_graft(uuid, text, text, date, text, text, text, text) to authenticated;
revoke execute on function public.delete_implant_graft(uuid) from public, anon;
grant execute on function public.delete_implant_graft(uuid) to authenticated;
revoke execute on function app_private.lock_placed_site(uuid) from public;
revoke execute on function app_private.check_graft(public.implant_sites, text, text, date) from public;

-- History tab (latest definition in 0020) and the audit-log read rule (latest in 0036) cover the new tables.
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
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts')
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
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts'))
  );
