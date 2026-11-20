-- Booking: edit a booking's implants (spec docs/superpowers/specs/2026-11-20-booking-patient-picker-spares-design.md,
-- task 2). set_booking_implants(p_slot, p_implants) replaces the whole set of a booking's planned implants:
-- p_implants is [{ tooth, product_id, technique, spares }], each item checked by create_surgery_slot_v4's rules (0125).
--   * A tooth already placed (its site is no longer planned) must come back with the same tooth, product and
--     technique; only its spares may change. Changes to it go through Corrections.
--   * A new tooth is added exactly as v4 adds one.
--   * A tooth left out loses its slot_planned_implants row and its spares, and its planned site is detached as
--     cancel_surgery_slot (0030) does, so another booking can take the tooth later.
--   * A kept tooth gets its new product and technique, on the site and on the slot_planned_implants row.
-- A cancelled or completed booking is closed. Additive: update_surgery_slot_v3 and set_implant_technique stay.
set local lock_timeout = '5s';

create function public.set_booking_implants(p_slot uuid, p_implants jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.surgery_slots;
  v_session public.sessions;
  v_items jsonb := coalesce(p_implants, '[]'::jsonb);
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_technique text;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
  v_spares jsonb;
  v_spare_text text;
  v_spare uuid;
  v_spare_ids uuid[];
begin
  perform app_private.require_perm('schedule', 'edit');
  select * into v_slot from public.surgery_slots where id = p_slot for update;
  if not found then
    perform app_private.fail('Booking not found.');
  end if;
  if v_slot.status in ('cancelled', 'done') then
    perform app_private.fail('This booking is closed.');
  end if;
  select * into v_session from public.sessions where id = v_slot.session_id;

  -- 1. Every item, by v4's tooth, product, technique and spare rules (0125).
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_tooth := (v_item ->> 'tooth')::int;
    if v_tooth is null or v_tooth / 10 not between 1 and 4 or v_tooth % 10 not between 1 and 8 then
      perform app_private.fail(format('%s is not a tooth number. Use FDI numbers 11–48.', coalesce(v_item ->> 'tooth', '?')));
    end if;
    if v_tooth = any (v_seen) then
      perform app_private.fail(format('Tooth %s is listed twice.', v_tooth));
    end if;
    v_seen := v_seen || v_tooth;
    v_product := nullif(v_item ->> 'product_id', '')::uuid;
    -- The product this booking already records for the tooth stays allowed if it has since left the catalogue.
    if v_product is not null
       and not exists (select 1 from public.products where id = v_product and type = 'implant' and active)
       and not exists (select 1 from public.implant_sites where slot_id = p_slot and tooth = v_tooth and product_id = v_product) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_technique := nullif(v_item ->> 'technique', '');
    perform app_private.check_technique(v_technique);

    -- Spares: at most 5 active catalogue implants, none of them the planned one or listed twice.
    v_spares := coalesce(nullif(v_item -> 'spares', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_spares) <> 'array' then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    if jsonb_array_length(v_spares) > 5 then
      perform app_private.fail(format('Tooth %s has more than 5 spares.', v_tooth));
    end if;
    v_spare_ids := '{}';
    for v_spare_text in select x from jsonb_array_elements_text(v_spares) x loop
      if v_spare_text is null
         or v_spare_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform app_private.fail('Choose an implant from the catalog.');
      end if;
      v_spare := v_spare_text::uuid;
      if not exists (select 1 from public.products where id = v_spare and type = 'implant' and active) then
        perform app_private.fail('Choose an implant from the catalog.');
      end if;
      if v_spare = v_product or v_spare = any (v_spare_ids) then
        perform app_private.fail(format('Tooth %s lists the same implant twice.', v_tooth));
      end if;
      v_spare_ids := v_spare_ids || v_spare;
    end loop;
  end loop;

  -- 2. A placed tooth comes back unchanged: same tooth, product and technique.
  for v_site in
    select * from public.implant_sites where slot_id = p_slot and state <> 'planned' order by tooth for update
  loop
    v_item := null;
    select x into v_item from jsonb_array_elements(v_items) x where (x ->> 'tooth')::int = v_site.tooth;
    if v_item is null
       or nullif(v_item ->> 'product_id', '')::uuid is distinct from v_site.product_id
       or nullif(v_item ->> 'technique', '') is distinct from v_site.technique then
      perform app_private.fail(format('Tooth %s is already placed; change it in Corrections.', v_site.tooth));
    end if;
  end loop;

  -- 3. Teeth left out: detached as cancel_surgery_slot does. Every spare is rewritten below.
  update public.implant_sites set slot_id = null, session_id = null, course_id = null
  where slot_id = p_slot and state = 'planned' and tooth <> all (v_seen);
  delete from public.slot_planned_implants where slot_id = p_slot and tooth <> all (v_seen);
  delete from public.slot_spare_implants where slot_id = p_slot;

  -- 4. Kept, placed and new teeth.
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_tooth := (v_item ->> 'tooth')::int;
    v_product := nullif(v_item ->> 'product_id', '')::uuid;
    v_technique := nullif(v_item ->> 'technique', '');
    select array_agg(x::uuid order by n) into v_spare_ids
    from jsonb_array_elements_text(coalesce(nullif(v_item -> 'spares', 'null'::jsonb), '[]'::jsonb)) with ordinality as s(x, n);

    if not exists (select 1 from public.implant_sites where slot_id = p_slot and tooth = v_tooth and state <> 'planned') then
      select * into v_site from public.implant_sites
      where patient_id = v_slot.patient_id and tooth = v_tooth and state not in ('failed', 'removed')
      for update;
      if found and v_site.slot_id = p_slot then
        -- Kept: its new product and technique.
        update public.implant_sites set product_id = v_product, technique = v_technique
        where id = v_site.id and (product_id, technique) is distinct from (v_product, v_technique);
        v_site_id := v_site.id;
      else
        -- New: as create_surgery_slot_v4 adds a tooth.
        if found and v_site.state <> 'planned' then
          perform app_private.fail(format('Tooth %s already has an implant.', v_tooth));
        end if;
        -- I2: a tooth planned in another active booking must be cancelled there first.
        if found and v_site.slot_id is not null and exists (
          select 1 from public.surgery_slots o where o.id = v_site.slot_id and o.status <> 'cancelled' and o.id <> p_slot
        ) then
          perform app_private.fail((
            select format('Tooth %s is already booked on %s (%s). Cancel that booking first.', v_tooth,
                   to_char(o.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), c.name)
            from public.surgery_slots o join public.chairs c on c.id = o.chair_id where o.id = v_site.slot_id));
        end if;
        if found then
          update public.implant_sites
          set slot_id = p_slot, session_id = v_session.id, course_id = v_session.course_id,
              product_id = coalesce(v_product, product_id), technique = coalesce(v_technique, technique)
          where id = v_site.id
          returning id into v_site_id;
        else
          insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id, technique)
          values (v_slot.patient_id, v_tooth, 'planned', v_product, v_session.course_id, v_session.id, p_slot, v_technique)
          returning id into v_site_id;
          perform app_private.set_tooth(v_slot.patient_id, v_tooth::smallint, 'implant_planned');
        end if;
      end if;
      insert into public.slot_planned_implants as spi (slot_id, tooth, product_id, implant_site_id)
      values (p_slot, v_tooth, v_product, v_site_id)
      on conflict (slot_id, tooth) do update
        set product_id = excluded.product_id, implant_site_id = excluded.implant_site_id
        where (spi.product_id, spi.implant_site_id) is distinct from (excluded.product_id, excluded.implant_site_id);
    end if;

    insert into public.slot_spare_implants (slot_id, tooth, product_id, position)
    select p_slot, v_tooth, s.id, s.n::smallint from unnest(coalesce(v_spare_ids, '{}')) with ordinality as s(id, n);
  end loop;
end $$;

-- ── Owner and grants ─────────────────────────────────────────────────────────────────────────────────
-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0125.
grant create on schema public, app_private to tenant_definer;
alter function public.set_booking_implants(uuid, jsonb) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function public.set_booking_implants(uuid, jsonb) from public, anon;
grant execute on function public.set_booking_implants(uuid, jsonb) to authenticated;
