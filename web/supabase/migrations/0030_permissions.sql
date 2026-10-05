-- Roles & permissions: organizers get None/View/Edit per area; delegates see only their own data
-- through my_schedule()/my_report(). is_active_user() now means active *staff*.

-- ── 1. Permissions table, delegate link, defaults ────────────────────────────────────────────

create table public.user_permissions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  area text not null check (area in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates')),
  level text not null check (level in ('view', 'edit')),
  primary key (user_id, area)
);
create trigger user_permissions_audit after insert or update or delete on public.user_permissions
  for each row execute function app_private.audit_row('user_id');
revoke all on public.user_permissions from public, anon, authenticated;
grant select on public.user_permissions to authenticated;
alter table public.user_permissions enable row level security;
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

alter table public.profiles add column delegate_id uuid unique references public.delegates (id);
alter table public.profiles add constraint profiles_delegate_link check ((role = 'delegate') = (delegate_id is not null));

-- Existing organizers keep full access, so behaviour is unchanged on release.
insert into public.user_permissions (user_id, area, level)
select p.user_id, a.area, 'edit'
from public.profiles p
cross join (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area)
where p.role = 'organizer';

-- Anyone who is, or becomes, an organizer without permissions starts with View everywhere.
create function app_private.default_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'organizer' and not exists (select 1 from public.user_permissions where user_id = new.user_id) then
    insert into public.user_permissions (user_id, area, level)
    select new.user_id, a.area, 'view'
    from (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area);
  end if;
  return new;
end $$;
create trigger profiles_default_permissions after insert or update of role on public.profiles
  for each row execute function app_private.default_permissions();

-- ── 2. Helpers ───────────────────────────────────────────────────────────────────────────────

-- Staff only: delegates are shut out of every existing policy and of require_active().
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.active and p.role in ('admin', 'organizer')
    );
$$;

create function public.is_delegate_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.active and p.role = 'delegate' and p.delegate_id is not null
    );
$$;

create function public.my_delegate_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.delegate_id from public.profiles p where p.user_id = auth.uid();
$$;

create function public.can(p_area text, p_level text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or (public.is_active_user() and exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.area = p_area
        and (up.level = 'edit' or p_level = 'view')
    ));
$$;

create function app_private.require_perm(p_area text, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.can(p_area, p_level) then
    raise exception using
      message = format('You don''t have permission to %s %s.', p_level, initcap(p_area)),
      errcode = '42501', hint = 'user';
  end if;
end $$;

create function public.set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_level text;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change permissions.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You cannot change your own permissions.');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user and role = 'organizer') then
    perform app_private.fail('Permissions apply to organizers only.');
  end if;
  for v_key, v_level in select key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb)) loop
    if v_key not in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates') then
      perform app_private.fail(format('Unknown area: %s.', v_key));
    end if;
    if v_level is not null and v_level not in ('view', 'edit') then
      perform app_private.fail(format('Unknown level: %s.', v_level));
    end if;
  end loop;
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, area, level)
  select p_user, key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb))
  where value #>> '{}' is not null;
end $$;

revoke execute on function public.is_delegate_user() from public, anon;
revoke execute on function public.my_delegate_id() from public, anon;
revoke execute on function public.can(text, text) from public, anon;
revoke execute on function app_private.require_perm(text, text) from public, anon;
revoke execute on function app_private.default_permissions() from public, anon;
revoke execute on function public.set_user_permissions(uuid, jsonb) from public, anon;
grant execute on function public.is_delegate_user() to authenticated;
grant execute on function public.my_delegate_id() to authenticated;
grant execute on function public.can(text, text) to authenticated;
grant execute on function public.set_user_permissions(uuid, jsonb) to authenticated;

-- ── 3. Area enforcement on tables ────────────────────────────────────────────────────────────
-- Restrictive policies AND with the existing permissive ones (which keep their own conditions).
-- Writes made inside security-definer functions and triggers run as the owner and bypass RLS;
-- those functions are guarded by require_perm() below.

create function app_private.area_policies(p_table text, p_area text, p_read text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_read text := coalesce(p_read, format('public.can(%L, ''view'')', p_area));
begin
  execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)',
    p_table || '_area_read', p_table, v_read);
  execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.can(%L, ''edit''))',
    p_table || '_area_insert', p_table, p_area);
  execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.can(%L, ''edit'')) with check (public.can(%L, ''edit''))',
    p_table || '_area_update', p_table, p_area, p_area);
  execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.can(%L, ''edit''))',
    p_table || '_area_delete', p_table, p_area);
end $$;

-- The schedule shows patient names, so Schedule view also reads patients (not their history or chart).
select app_private.area_policies('patients', 'patients', 'public.can(''patients'', ''view'') or public.can(''schedule'', ''view'')');
select app_private.area_policies(t, 'patients') from unnest(array[
  'medical_history', 'visit_notes', 'tooth_status', 'implant_sites', 'site_components', 'implant_followups', 'audit_log']) t;
select app_private.area_policies(t, 'schedule') from unnest(array[
  'surgery_slots', 'slot_delegates', 'slot_planned_implants', 'talks']) t;
select app_private.area_policies(t, 'courses') from unnest(array['courses', 'sessions', 'enrollments']) t;
select app_private.area_policies(t, 'checklists') from unnest(array[
  'checklist_templates', 'template_items', 'checklists', 'checklist_items']) t;
select app_private.area_policies('stock_movements', 'inventory');
-- Reference lists: every staff member reads them; writes need the owning area.
select app_private.area_policies('products', 'inventory', 'true');
select app_private.area_policies('delegates', 'delegates', 'true');
drop function app_private.area_policies(text, text, text);

-- ── 4. Write functions check the area permission ─────────────────────────────────────────────
-- Each is the latest definition, copied verbatim, with require_active() → require_perm(area, 'edit').

-- plan_implant: latest 0027_technique_booking_edit_delete.sql:16; require_active() → require_perm('patients', 'edit')
create or replace function public.plan_implant(
  p_patient uuid, p_tooth smallint, p_product uuid default null, p_notes text default '', p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.check_technique(p_technique);
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if exists (select 1 from public.implant_sites where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')) then
    perform app_private.fail(format('Tooth %s already has an implant record.', p_tooth));
  end if;
  insert into public.implant_sites (patient_id, tooth, state, product_id, notes, technique)
  values (p_patient, p_tooth, 'planned', p_product, coalesce(p_notes, ''), p_technique)
  returning id into v_id;
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_planned');
  return v_id;
end $$;

-- place_implant: latest 0027_technique_booking_edit_delete.sql:174; require_active() → require_perm('patients', 'edit')
create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null,
  p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_course uuid;
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
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
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
  if v_slot.id is not null then
    select course_id into v_course from public.sessions where id = v_slot.session_id;
  end if;

  perform app_private.lock_lot(p_lot, p_product, p_placed_on);

  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = coalesce(v_course, course_id), technique = coalesce(p_technique, technique)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id, technique
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, v_course, p_technique
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

-- cancel_planned_implant: latest 0010_implant_sites.sql:141; require_active() → require_perm('patients', 'edit')
create or replace function public.cancel_planned_implant(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state <> 'planned' then
    perform app_private.fail('Only a planned implant can be cancelled.');
  end if;
  update public.implant_sites set state = 'removed' where id = p_site;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'missing');
end $$;

-- set_implant_technique: latest 0027_technique_booking_edit_delete.sql:279; require_active() → require_perm('patients', 'edit')
create or replace function public.set_implant_technique(p_site uuid, p_technique text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if p_technique is null then
    perform app_private.fail('Choose Guided or Free hand.');
  end if;
  perform app_private.check_technique(p_technique);
  update public.implant_sites set technique = p_technique where id = p_site and state <> 'removed';
  if not found then
    perform app_private.fail('Implant not found.');
  end if;
end $$;

-- fit_component: latest 0020_clinical_accuracy.sql:136; require_active() → require_perm('patients', 'edit')
create or replace function public.fit_component(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid default null,
  p_lot uuid default null, p_by_delegate uuid default null, p_by_organizer uuid default null,
  p_notes text default ''
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
    site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id, fitted_by_organizer_id, notes
  ) values (
    p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate, p_by_organizer, coalesce(p_notes, '')
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

-- record_followup: latest 0020_clinical_accuracy.sql:201; require_active() → require_perm('patients', 'edit')
create or replace function public.record_followup(
  p_site uuid, p_date date, p_check_type text, p_outcome public.followup_outcome, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Follow-ups are recorded for placed implants.');
  end if;
  if p_date is null or p_date > public.cairo_today() then
    perform app_private.fail('Enter the follow-up date (today or earlier).');
  end if;
  if p_date < v_site.placed_on then
    perform app_private.fail('A follow-up cannot be before the implant was placed.');
  end if;
  if length(trim(coalesce(p_check_type, ''))) = 0 then
    perform app_private.fail('Enter the check (e.g. 3-month).');
  end if;
  insert into public.implant_followups (site_id, date, check_type, outcome, notes)
  values (p_site, p_date, trim(p_check_type), p_outcome, coalesce(p_notes, ''))
  returning id into v_id;
  if p_outcome = 'failed' and v_site.state <> 'failed' then
    update public.implant_sites set state = 'failed' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
  return v_id;
end $$;

-- void_component: latest 0015_corrections.sql:129; require_active() → require_perm('patients', 'edit')
create or replace function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
  v_prev uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null or v_c.removed_on is not null then
    perform app_private.fail('Only the current component can be undone.');
  end if;
  select * into v_site from public.implant_sites where id = v_c.site_id for update;
  if v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be changed on a placed implant.');
  end if;
  if v_c.stock_lot_id is not null then
    v_use := app_private.unreversed_use(v_site.id, p_component, v_c.stock_lot_id);
    if v_use is not null then
      perform app_private.reverse_use(v_use, 'Undone: ' || trim(p_reason));
    end if;
  end if;
  update public.site_components
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason), removed_on = fitted_on
  where id = p_component;
  select id into v_prev from public.site_components
  where site_id = v_site.id and id <> p_component and voided_at is null
  order by fitted_on desc, created_at desc
  limit 1;
  if v_prev is not null then
    update public.site_components set removed_on = null where id = v_prev;
  end if;
  if v_c.component_type = 'final_restoration' and v_site.state = 'restored' then
    update public.implant_sites set state = 'placed' where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'implant_placed');
  end if;
end $$;

-- void_followup: latest 0015_corrections.sql:93; require_active() → require_perm('patients', 'edit')
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
    update public.implant_sites set state = v_state where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
      case when v_state = 'restored' then 'restored' else 'implant_placed' end::public.tooth_state);
  end if;
end $$;

-- correct_batch: latest 0017_plan4_review_fixes.sql:186; require_active() → require_perm('patients', 'edit')
create or replace function public.correct_batch(
  p_site uuid, p_new_lot uuid, p_reason text, p_component uuid default null, p_new_product uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_comp public.site_components;
  v_product uuid;
  v_type public.product_type;
  v_old_lot uuid;
  v_use uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'correction');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has a batch to correct.');
  end if;
  if p_component is null then
    v_product := coalesce(p_new_product, v_site.product_id);
    if not exists (select 1 from public.products where id = v_product and type = 'implant'
                   and (active or v_product = v_site.product_id)) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_old_lot := v_site.stock_lot_id;
  else
    select * into v_comp from public.site_components where id = p_component and site_id = p_site and voided_at is null;
    if not found then
      perform app_private.fail('Component not found.');
    end if;
    if v_comp.stock_lot_id is null then
      perform app_private.fail('This component was not taken from stock.');
    end if;
    v_product := coalesce(p_new_product, v_comp.product_id);
    select type into v_type from public.products where id = v_product and (active or v_product = v_comp.product_id);
    if not found or not app_private.component_accepts(v_comp.component_type, v_type) then
      perform app_private.fail(format('That product is not a %s.', replace(v_comp.component_type::text, '_', ' ')));
    end if;
    v_old_lot := v_comp.stock_lot_id;
  end if;
  if p_new_lot = v_old_lot then
    perform app_private.fail('Choose a different batch.');
  end if;
  v_use := app_private.unreversed_use(p_site, p_component, v_old_lot);
  if v_use is null then
    perform app_private.fail('The original stock entry was not found.');
  end if;

  perform app_private.lock_lot_for_correction(p_new_lot, v_product, coalesce(v_comp.fitted_on, v_site.placed_on));
  perform app_private.reverse_use(v_use, 'Correction: ' || trim(p_reason));
  perform app_private.insert_use(p_new_lot, v_site.patient_id, p_site, p_component);
  if p_component is null then
    update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product where id = p_site;
  else
    update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
  end if;
end $$;

-- delete_patient: latest 0027_technique_booking_edit_delete.sql:417; require_active() → require_perm('patients', 'edit')
create or replace function public.delete_patient(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  perform 1 from public.patients where id = p_patient for update;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  if exists (
    select 1 from public.stock_movements m
    where m.patient_id = p_patient
       or m.implant_site_id in (select id from public.implant_sites where patient_id = p_patient)
       or m.site_component_id in (
         select sc.id from public.site_components sc
         join public.implant_sites s on s.id = sc.site_id where s.patient_id = p_patient)
  ) then
    perform app_private.fail('This patient has stock movements (placed implants or fitted components) and can''t be deleted. Archive them instead.');
  end if;
  delete from public.surgery_slots where patient_id = p_patient;
  delete from public.patients where id = p_patient;
end $$;

-- create_surgery_slot: latest 0027_technique_booking_edit_delete.sql:42; require_active() → require_perm('schedule', 'edit')
create or replace function public.create_surgery_slot(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_implants jsonb default '[]',
  p_override_reason text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_clash boolean;
  v_session public.sessions;
  v_slot uuid;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_technique text;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
begin
  perform app_private.require_perm('schedule', 'edit');
  select * into v_session from public.sessions where id = p_session;
  if not found then
    perform app_private.fail('Choose a surgery session.');
  end if;
  if v_session.type <> 'surgery' then
    perform app_private.fail('Surgeries can only be booked in a surgery session.');
  end if;
  if not exists (select 1 from public.chairs where id = p_chair and active) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if exists (select 1 from public.patients where id = p_patient and archived) then
    perform app_private.fail('This patient is archived. Restore the patient first.');
  end if;
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate cannot be both placing and assisting.');
  end if;
  select d.full_name into v_missing
  from unnest(v_all) as x(id)
  left join public.delegates d on d.id = x.id
  where d.id is null or not d.active
     or not exists (select 1 from public.enrollments e where e.course_id = v_session.course_id and e.delegate_id = x.id)
  limit 1;
  if found then
    perform app_private.fail(format('%s is not enrolled in this course.', coalesce(v_missing, 'A delegate')));
  end if;
  -- I1: one booking at a time per day, so two clashing bookings cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, case when v_clash then trim(coalesce(p_override_reason, '')) else '' end, coalesce(p_notes, ''))
  returning id into v_slot;

  insert into public.slot_delegates (slot_id, delegate_id, role)
  select v_slot, x, 'placing' from unnest(p_placing) x
  union all
  select v_slot, x, 'assisting' from unnest(coalesce(p_assisting, '{}')) x;

  for v_item in select * from jsonb_array_elements(coalesce(p_implants, '[]'::jsonb)) loop
    v_tooth := (v_item ->> 'tooth')::int;
    if v_tooth is null or v_tooth / 10 not between 1 and 4 or v_tooth % 10 not between 1 and 8 then
      perform app_private.fail(format('%s is not a tooth number. Use FDI numbers 11–48.', coalesce(v_item ->> 'tooth', '?')));
    end if;
    if v_tooth = any (v_seen) then
      perform app_private.fail(format('Tooth %s is listed twice.', v_tooth));
    end if;
    v_seen := v_seen || v_tooth;
    v_product := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product is not null and not exists (select 1 from public.products where id = v_product and type = 'implant' and active) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_technique := nullif(v_item ->> 'technique', '');
    perform app_private.check_technique(v_technique);

    select * into v_site from public.implant_sites
    where patient_id = p_patient and tooth = v_tooth and state not in ('failed', 'removed')
    for update;
    if found and v_site.state <> 'planned' then
      perform app_private.fail(format('Tooth %s already has an implant.', v_tooth));
    end if;
    -- I2: a tooth planned in another active booking must be cancelled there first.
    if found and v_site.slot_id is not null and exists (
      select 1 from public.surgery_slots o where o.id = v_site.slot_id and o.status <> 'cancelled' and o.id <> v_slot
    ) then
      perform app_private.fail((
        select format('Tooth %s is already booked on %s (%s). Cancel that booking first.', v_tooth,
               to_char(o.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), c.name)
        from public.surgery_slots o join public.chairs c on c.id = o.chair_id where o.id = v_site.slot_id));
    end if;
    if found then
      update public.implant_sites
      set slot_id = v_slot, session_id = p_session, course_id = v_session.course_id,
          product_id = coalesce(v_product, product_id), technique = coalesce(v_technique, technique)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id, technique)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, p_session, v_slot, v_technique)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

-- update_surgery_slot: latest 0027_technique_booking_edit_delete.sql:294; require_active() → require_perm('schedule', 'edit')
create or replace function public.update_surgery_slot(
  p_slot uuid, p_chair uuid, p_start time, p_end time, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_override_reason text default '', p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.surgery_slots;
  v_session public.sessions;
  v_clash boolean;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
begin
  perform app_private.require_perm('schedule', 'edit');
  select * into v_slot from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if v_slot.status <> 'scheduled' then
    perform app_private.fail('Only scheduled surgeries can be edited.');
  end if;
  select * into v_session from public.sessions where id = v_slot.session_id;
  if not exists (select 1 from public.chairs where id = p_chair and (active or id = v_slot.chair_id)) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if p_supervisor is null or not exists (
    select 1 from public.supervisors where id = p_supervisor and (active or id = v_slot.supervisor_id)
  ) then
    perform app_private.fail('Choose an active supervisor.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate cannot be both placing and assisting.');
  end if;
  select d.full_name into v_missing
  from unnest(v_all) as x(id)
  left join public.delegates d on d.id = x.id
  where d.id is null or not d.active
     or not exists (select 1 from public.enrollments e where e.course_id = v_session.course_id and e.delegate_id = x.id)
  limit 1;
  if found then
    perform app_private.fail(format('%s is not enrolled in this course.', coalesce(v_missing, 'A delegate')));
  end if;
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts(v_slot.session_id, p_chair, p_start, p_end, v_slot.patient_id, p_supervisor, v_all, p_slot)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  update public.surgery_slots
  set chair_id = p_chair,
      starts_at = public.cairo_ts(v_session.date, p_start),
      ends_at = public.cairo_ts(v_session.date, p_end),
      supervisor_id = p_supervisor,
      override_reason = case when v_clash then trim(coalesce(p_override_reason, '')) else '' end,
      notes = coalesce(p_notes, '')
  where id = p_slot;

  delete from public.slot_delegates where slot_id = p_slot;
  insert into public.slot_delegates (slot_id, delegate_id, role)
  select p_slot, x, 'placing' from unnest(p_placing) x
  union all
  select p_slot, x, 'assisting' from unnest(coalesce(p_assisting, '{}')) x;
end $$;

-- set_slot_status: latest 0027_technique_booking_edit_delete.sql:370; require_active() → require_perm('schedule', 'edit')
create or replace function public.set_slot_status(p_slot uuid, p_status public.slot_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.slot_status;
begin
  perform app_private.require_perm('schedule', 'edit');
  select status into v_status from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if not ((v_status = 'scheduled' and p_status = 'done') or (v_status = 'done' and p_status = 'scheduled')) then
    perform app_private.fail(case when p_status = 'done' then 'Only scheduled surgeries can be marked completed.'
                                  else 'Only completed surgeries can be reopened.' end);
  end if;
  update public.surgery_slots set status = p_status where id = p_slot;
end $$;

-- cancel_surgery_slot: latest 0014_surgery_slots.sql:210; require_active() → require_perm('schedule', 'edit')
create or replace function public.cancel_surgery_slot(p_slot uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('schedule', 'edit');
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform app_private.fail('Explain why the surgery is cancelled (at least 3 characters).');
  end if;
  if not exists (select 1 from public.surgery_slots where id = p_slot and status = 'scheduled') then
    perform app_private.fail('Only scheduled surgeries can be cancelled.');
  end if;
  update public.surgery_slots set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_slot;
  update public.implant_sites set slot_id = null, session_id = null, course_id = null
  where slot_id = p_slot and state = 'planned';
end $$;

-- create_talk: latest 0028_lectures.sql:105; require_active() → require_perm('schedule', 'edit')
create or replace function public.create_talk(
  p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_id uuid;
begin
  perform app_private.require_perm('schedule', 'edit');
  select * into v_session from public.sessions where id = p_session;
  if not found or v_session.type not in ('lecture', 'workshop') then
    perform app_private.fail('Choose a lecture or workshop session.');
  end if;
  if not exists (select 1 from public.lecturers where id = p_lecturer and active) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, null);
  insert into public.talks (session_id, starts_at, ends_at, lecturer_id, topic, notes)
  values (p_session, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_lecturer, trim(p_topic), trim(coalesce(p_notes, '')))
  returning id into v_id;
  return v_id;
end $$;

-- update_talk: latest 0028_lectures.sql:130; require_active() → require_perm('schedule', 'edit')
create or replace function public.update_talk(
  p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_talk public.talks;
  v_session public.sessions;
begin
  perform app_private.require_perm('schedule', 'edit');
  select * into v_talk from public.talks where id = p_talk for update;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
  select * into v_session from public.sessions where id = v_talk.session_id;
  if not exists (select 1 from public.lecturers where id = p_lecturer and (active or id = v_talk.lecturer_id)) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, p_talk);
  update public.talks
  set starts_at = public.cairo_ts(v_session.date, p_start), ends_at = public.cairo_ts(v_session.date, p_end),
      lecturer_id = p_lecturer, topic = trim(p_topic), notes = trim(coalesce(p_notes, ''))
  where id = p_talk;
end $$;

-- delete_talk: latest 0028_lectures.sql:154; require_active() → require_perm('schedule', 'edit')
create or replace function public.delete_talk(p_talk uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('schedule', 'edit');
  delete from public.talks where id = p_talk;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
end $$;

-- receive_stock: latest 0020_clinical_accuracy.sql:233; require_active() → require_perm('inventory', 'edit')
create or replace function public.receive_stock(
  p_product uuid, p_qty int, p_lot_no text default null, p_expiry date default null,
  p_received_on date default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lot uuid;
begin
  perform app_private.require_perm('inventory', 'edit');
  if not exists (select 1 from public.products where id = p_product and active) then
    perform app_private.fail('Choose an active product from the catalog.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    perform app_private.fail('Enter a quantity between 1 and 100000.');
  end if;
  if coalesce(p_received_on, public.cairo_today()) > public.cairo_today() then
    perform app_private.fail('The received date cannot be in the future.');
  end if;
  insert into public.stock_lots (product_id, lot_no, expiry, received_on, qty_received, notes)
  values (p_product, nullif(trim(p_lot_no), ''), p_expiry, coalesce(p_received_on, public.cairo_today()), p_qty, coalesce(p_notes, ''))
  returning id into v_lot;
  insert into public.stock_movements (stock_lot_id, delta, reason) values (v_lot, p_qty, 'receive');
  return v_lot;
end $$;

-- adjust_stock: latest 0009_stock.sql:109; require_active() → require_perm('inventory', 'edit')
create or replace function public.adjust_stock(p_lot uuid, p_delta int, p_reason public.movement_reason, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_on_hand int;
  v_id uuid;
begin
  perform app_private.require_perm('inventory', 'edit');
  if p_reason not in ('adjust', 'waste', 'return') then
    perform app_private.fail('Choose adjust, waste or return.');
  end if;
  if p_delta is null or p_delta = 0 then
    perform app_private.fail('Enter a quantity other than zero.');
  end if;
  if p_reason in ('waste', 'return') and p_delta > 0 then
    perform app_private.fail('Waste and returns take stock out: the quantity must be negative.');
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform app_private.fail('Explain the change (at least 3 characters).');
  end if;
  perform 1 from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Stock batch not found.');
  end if;
  v_on_hand := app_private.lot_on_hand(p_lot);
  if v_on_hand + p_delta < 0 then
    perform app_private.fail(format('Only %s left in this batch.', v_on_hand));
  end if;
  insert into public.stock_movements (stock_lot_id, delta, reason, note)
  values (p_lot, p_delta, p_reason, trim(p_note))
  returning id into v_id;
  return v_id;
end $$;

-- delete_course: latest 0027_technique_booking_edit_delete.sql:440; require_active() → require_perm('courses', 'edit')
create or replace function public.delete_course(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('courses', 'edit');
  perform 1 from public.courses where id = p_course for update;
  if not found then
    perform app_private.fail('Course not found.');
  end if;
  if exists (
    select 1 from public.implant_sites s
    where (s.course_id = p_course or s.session_id in (select id from public.sessions where course_id = p_course))
      and s.state not in ('planned', 'removed')
  ) then
    perform app_private.fail('Implants were placed in this course, so it can''t be deleted.');
  end if;
  if exists (
    select 1 from public.surgery_slots o join public.sessions se on se.id = o.session_id
    where se.course_id = p_course and o.status <> 'cancelled'
  ) then
    perform app_private.fail('This course has surgery bookings. Cancel them first.');
  end if;
  update public.implant_sites set course_id = null, session_id = null
  where course_id = p_course or session_id in (select id from public.sessions where course_id = p_course);
  delete from public.surgery_slots
  where session_id in (select id from public.sessions where course_id = p_course);
  delete from public.courses where id = p_course;
end $$;

-- create_checklist: latest 0018_checklists.sql:143; require_active() → require_perm('checklists', 'edit')
create or replace function public.create_checklist(
  p_title text, p_items text[] default '{}', p_template uuid default null,
  p_session uuid default null, p_slot uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_perm('checklists', 'edit');
  if length(trim(coalesce(p_title, ''))) < 2 then
    perform app_private.fail('Enter the checklist title (at least 2 characters).');
  end if;
  if p_session is not null and p_slot is not null then
    perform app_private.fail('A checklist belongs to either a session or a surgery booking, not both.');
  end if;
  if p_template is not null and not exists (select 1 from public.checklist_templates where id = p_template) then
    perform app_private.fail('Template not found.');
  end if;
  v_items := app_private.clean_items(
    coalesce((select array_agg(text order by position) from public.template_items where template_id = p_template), '{}')
    || coalesce(p_items, '{}')
  );
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  insert into public.checklists (title, template_id, session_id, slot_id)
  values (trim(p_title), p_template, p_session, p_slot)
  returning id into v_id;
  perform app_private.insert_items(v_id, v_items, 0);
  return v_id;
end $$;

-- add_checklist_items: latest 0022_checklist_polish.sql:49; require_active() → require_perm('checklists', 'edit')
create or replace function public.add_checklist_items(p_checklist uuid, p_items text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_max int;
begin
  perform app_private.require_perm('checklists', 'edit');
  perform 1 from public.checklists where id = p_checklist for update;
  if not found then
    perform app_private.fail('Checklist not found.');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  select coalesce(max(position), 0) into v_max from public.checklist_items where checklist_id = p_checklist;
  if (select count(*) from public.checklist_items where checklist_id = p_checklist) + array_length(v_items, 1) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  perform app_private.insert_items(p_checklist, v_items, v_max);
end $$;

-- save_template: latest 0022_checklist_polish.sql:6; require_active() → require_perm('checklists', 'edit')
create or replace function public.save_template(
  p_template uuid, p_name text, p_applies_to public.checklist_scope, p_is_default boolean, p_items text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_perm('checklists', 'edit');
  if length(trim(coalesce(p_name, ''))) < 2 then
    perform app_private.fail('Enter the template name (at least 2 characters).');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  if p_is_default and p_applies_to = 'general' then
    perform app_private.fail('General templates are not attached automatically, so they cannot be the default.');
  end if;
  if p_is_default then
    update public.checklist_templates set is_default = false
    where applies_to = p_applies_to and is_default and id is distinct from p_template;
  end if;
  if p_template is null then
    insert into public.checklist_templates (name, applies_to, is_default)
    values (trim(p_name), p_applies_to, coalesce(p_is_default, false))
    returning id into v_id;
  else
    update public.checklist_templates
    set name = trim(p_name), applies_to = p_applies_to, is_default = coalesce(p_is_default, false)
    where id = p_template
    returning id into v_id;
    if v_id is null then
      perform app_private.fail('Template not found.');
    end if;
    delete from public.template_items where template_id = v_id;
  end if;
  insert into public.template_items (template_id, position, text)
  select v_id, ord::int, x from unnest(v_items) with ordinality as t (x, ord);
  return v_id;
end $$;

-- toggle_checklist_item: latest 0022_checklist_polish.sql:72; require_active() → require_perm('checklists', 'edit')
create or replace function public.toggle_checklist_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('checklists', 'edit');
  update public.checklist_items
  set done_by = case when p_done then coalesce(done_by, auth.uid()) end,
      done_at = case when p_done then coalesce(done_at, now()) end
  where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
end $$;

-- move_checklist_item: latest 0018_checklists.sql:211; require_active() → require_perm('checklists', 'edit')
create or replace function public.move_checklist_item(p_item uuid, p_direction int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.checklist_items;
  v_other public.checklist_items;
begin
  perform app_private.require_perm('checklists', 'edit');
  select * into v_item from public.checklist_items where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
  perform 1 from public.checklists where id = v_item.checklist_id for update;
  if p_direction < 0 then
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position < v_item.position order by position desc limit 1;
  else
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position > v_item.position order by position asc limit 1;
  end if;
  if v_other.id is null then
    return;
  end if;
  update public.checklist_items set position = v_other.position where id = v_item.id;
  update public.checklist_items set position = v_item.position where id = v_other.id;
end $$;


-- ── 5. Delegate readers: their own bookings, their courses' talks, their own implants ─────────

create function public.my_schedule(p_from date, p_to date)
returns table (
  kind text, starts_at timestamptz, ends_at timestamptz, title text, course text, place text, lead text,
  my_role text, patient_name text, file_no text, teeth text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select 'surgery'::text, o.starts_at, o.ends_at, se.title, c.name, ch.name, sv.full_name, sd.role::text,
         p.full_name, p.file_no,
         (select string_agg(spi.tooth::text, ', ' order by spi.tooth)
          from public.slot_planned_implants spi where spi.slot_id = o.id)
  from public.surgery_slots o
  join public.slot_delegates sd on sd.slot_id = o.id and sd.delegate_id = v_me
  join public.sessions se on se.id = o.session_id
  join public.courses c on c.id = se.course_id
  join public.chairs ch on ch.id = o.chair_id
  join public.patients p on p.id = o.patient_id
  left join public.supervisors sv on sv.id = o.supervisor_id
  where o.status <> 'cancelled' and se.date between p_from and p_to
  union all
  select se.type::text, t.starts_at, t.ends_at, t.topic, c.name, se.room, l.full_name,
         null::text, null::text, null::text, null::text
  from public.talks t
  join public.sessions se on se.id = t.session_id
  join public.courses c on c.id = se.course_id
  join public.lecturers l on l.id = t.lecturer_id
  where se.date between p_from and p_to
    and exists (select 1 from public.enrollments e where e.course_id = se.course_id and e.delegate_id = v_me)
  order by 2;
end $$;

create function public.my_report()
returns table (
  site_id uuid, role text, course_name text, patient_name text, file_no text, tooth smallint,
  state public.site_state, placed_on date, brand text, system text, platform text, diameter_mm numeric,
  length_mm numeric, description text, lot_no text, last_outcome public.followup_outcome, technique text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select s.id, case when s.placing_delegate_id = v_me then 'placing' else 'assisting' end,
         c.name, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = v_me or s.assisting_delegate_id = v_me)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
end $$;

revoke execute on function public.my_schedule(date, date) from public, anon;
revoke execute on function public.my_report() from public, anon;
grant execute on function public.my_schedule(date, date) to authenticated;
grant execute on function public.my_report() to authenticated;
