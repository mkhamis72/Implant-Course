drop function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text);

create function public.place_implant(
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
  if p_placed_on is null or p_placed_on > current_date + 1 then
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

  perform app_private.lock_lot(p_lot, p_product);

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

create function public.pull_list(p_date date)
returns table (
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text, needed int, available int
)
language sql stable security invoker set search_path = '' as $$
  with need as (
    select site.product_id, count(*)::int as needed
    from public.surgery_slots s
    join public.slot_planned_implants spi on spi.slot_id = s.id
    join public.implant_sites site on site.id = spi.implant_site_id
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

create function public.delegate_report(p_delegate uuid)
returns table (
  site_id uuid, role text, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text,
  tooth smallint, state public.site_state, placed_on date, product_id uuid, type public.product_type,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text,
  lot_no text, last_outcome public.followup_outcome
)
language sql stable security invoker set search_path = '' as $$
  select s.id,
         case when s.placing_delegate_id = p_delegate then 'placing' else 'assisting' end,
         c.id, c.name, p.id, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.id, pr.type, pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null
          order by f.date desc, f.created_at desc limit 1)
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = p_delegate or s.assisting_delegate_id = p_delegate)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
$$;

revoke execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid) from public, anon;
revoke execute on function public.pull_list(date) from public, anon;
revoke execute on function public.delegate_report(uuid) from public, anon;
grant execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.pull_list(date) to authenticated;
grant execute on function public.delegate_report(uuid) to authenticated;
