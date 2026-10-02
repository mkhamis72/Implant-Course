-- Dates follow the Cairo calendar; expiry is judged on the day a batch is used.
create function public.cairo_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Cairo')::date;
$$;
revoke execute on function public.cairo_today() from public, anon;
grant execute on function public.cairo_today() to authenticated;

alter table public.visit_notes alter column visit_date set default public.cairo_today();
alter table public.stock_lots alter column received_on set default public.cairo_today();

create or replace function app_private.lock_lot(p_lot uuid, p_product uuid, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  select * into v_lot from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Choose a stock batch.');
  end if;
  if v_lot.product_id <> p_product then
    perform app_private.fail('That stock batch is for a different product.');
  end if;
  if v_lot.expiry is not null and v_lot.expiry < p_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Choose another batch.',
      coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD'), to_char(p_on, 'YYYY-MM-DD')));
  end if;
  if app_private.lot_on_hand(p_lot) < 1 then
    perform app_private.fail('This stock batch is empty. Choose another batch or receive stock first.');
  end if;
end $$;

create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_course uuid;
  v_id uuid;
begin
  perform app_private.require_active();
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
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
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
        course_id = coalesce(v_course, course_id)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, v_course
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
  perform app_private.require_active();
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

create or replace function public.record_followup(
  p_site uuid, p_date date, p_check_type text, p_outcome public.followup_outcome, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
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

create or replace function public.receive_stock(
  p_product uuid, p_qty int, p_lot_no text default null, p_expiry date default null,
  p_received_on date default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lot uuid;
begin
  perform app_private.require_active();
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

drop function app_private.lock_lot(uuid, uuid);

-- Recall: component rows name who fitted the component.
create or replace function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         case when m.site_component_id is null then d.full_name
              else coalesce(fd.full_name, nullif(fo.full_name, ''), fo.email) end,
         coalesce(nullif(pr.full_name, ''), pr.email)
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.profiles pr on pr.user_id = s.supervisor_id
  left join public.delegates fd on fd.id = sc.fitted_by_delegate_id
  left join public.profiles fo on fo.user_id = sc.fitted_by_organizer_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by 2 desc, p.full_name;
$$;

-- History: components and follow-ups belong to the patient through their implant site.
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
     or (a.table_name in ('site_components', 'implant_followups')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

-- A failed tooth (implant lost) can be set to a manual state, e.g. missing; failed itself stays automatic.
drop policy tooth_status_update on public.tooth_status;
create policy tooth_status_update on public.tooth_status for update to authenticated
  using (public.is_active_user() and status in ('present', 'missing', 'extracted', 'failed'))
  with check (public.is_active_user() and status in ('present', 'missing', 'extracted'));
