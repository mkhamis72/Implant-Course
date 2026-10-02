-- Final review of Plan 4.
-- I1: serialise bookings per day (advisory lock) so concurrent clashing bookings cannot both pass.
-- I2: a tooth planned in another active booking is refused (not silently moved); the pull list
--     counts a planned implant only on the booking it currently belongs to.
-- I3: a batch correction judges expiry on the day of use, and allows an unchanged inactive product.
-- I4: the same delegate listed twice gets a specific message.


-- Like lock_lot, but expiry is judged on the day the item was used, not today.
create function app_private.lock_lot_for_correction(p_lot uuid, p_product uuid, p_used_on date) returns void
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
  if v_lot.expiry is not null and v_lot.expiry < p_used_on then
    perform app_private.fail(format('Lot %s had expired on %s, before it was used. Choose another batch.',
      coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD')));
  end if;
  if app_private.lot_on_hand(p_lot) < 1 then
    perform app_private.fail('This stock batch is empty. Choose another batch or receive stock first.');
  end if;
end $$;

create or replace function public.create_surgery_slot(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_implants jsonb default '[]',
  p_override_reason text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_slot uuid;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
begin
  perform app_private.require_active();
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
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
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
  if exists (
    select 1 from public.slot_conflicts(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all)
  ) and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, trim(coalesce(p_override_reason, '')), coalesce(p_notes, ''))
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
          product_id = coalesce(v_product, product_id)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, p_session, v_slot)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

create or replace function public.pull_list(p_date date)
returns table (
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text, needed int, available int
)
language sql stable security invoker set search_path = '' as $$
  with need as (
    select site.product_id, count(*)::int as needed
    from public.surgery_slots s
    join public.slot_planned_implants spi on spi.slot_id = s.id
    join public.implant_sites site on site.id = spi.implant_site_id and site.slot_id = s.id
    where s.status <> 'cancelled'
      and (s.starts_at at time zone 'Africa/Cairo')::date = p_date
      and site.state = 'planned'
    group by site.product_id
  ),
  have as (
    select h.product_id, sum(h.on_hand)::int as available
    from public.stock_on_hand h
    where h.on_hand > 0 and (h.expiry is null or h.expiry >= p_date)
    group by h.product_id
  )
  select n.product_id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.description,
         n.needed, coalesce(h.available, 0)
  from need n
  left join public.products p on p.id = n.product_id
  left join have h on h.product_id = n.product_id
  order by p.brand nulls last, p.system, p.diameter_mm, p.length_mm;
$$;

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
  perform app_private.require_active();
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
