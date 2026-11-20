-- Booking: spare implants (spec docs/superpowers/specs/2026-11-20-booking-patient-picker-spares-design.md, task 1).
-- A booked tooth may carry up to 5 spare implants, other catalogue implants to have at hand in case the planned
-- one does not fit. They are a plan only: nothing is placed or taken from stock.
--   * slot_spare_implants: one row per spare, per booking and tooth, in the order they were chosen.
--   * create_surgery_slot_v4: 0122's create_surgery_slot_v3, plus each p_implants item's `spares` (product ids).
--   * pull_list_v2: 0017's pull_list plus `spares`, the spares of that day's live bookings whose tooth is still
--     planned; a product that is only a spare is listed with needed 0.
-- Additive: create_surgery_slot_v3 and pull_list stay for the previous app version.
set local lock_timeout = '5s';

-- ── slot_spare_implants ─────────────────────────────────────────────────────────────────────────────
-- Built like slot_planned_implants as it stands after 0091–0100: in its company from the start (the company_id
-- default and key of 0084/0092, the composite foreign keys of 0091, indexed as 0100 does), the schedule area
-- policies of 0034 (Schedule or Patients view reads, Schedule edit writes), the company policies of 0092 and
-- the tenant_definer policy. Writes go through the definers only. Not a teaching table (0117): both company
-- types book spares.
create table public.slot_spare_implants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  slot_id uuid not null,
  tooth public.fdi_tooth not null,
  product_id uuid not null,
  position smallint not null check (position between 1 and 5),
  constraint slot_spare_implants_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint slot_spare_implants_company_id_key unique (company_id, id),
  constraint slot_spare_implants_slot_id_fkey foreign key (company_id, slot_id)
    references public.surgery_slots (company_id, id) on delete cascade,
  constraint slot_spare_implants_product_id_fkey foreign key (company_id, product_id)
    references public.products (company_id, id),
  constraint slot_spare_implants_slot_id_tooth_product_id_key unique (slot_id, tooth, product_id)
);
create index slot_spare_implants_product_id_idx on public.slot_spare_implants (company_id, product_id);
create trigger slot_spare_implants_audit after insert or update or delete on public.slot_spare_implants
  for each row execute function app_private.audit_row('id');

revoke all on public.slot_spare_implants from public, anon, authenticated;
grant select on public.slot_spare_implants to authenticated;
-- tenant_definer gets its table privileges from 0092's default privileges.

alter table public.slot_spare_implants enable row level security;
alter table public.slot_spare_implants force row level security;
create policy slot_spare_implants_select on public.slot_spare_implants for select to authenticated
  using (public.is_active_user());
create policy slot_spare_implants_area_read on public.slot_spare_implants as restrictive for select to authenticated
  using ((select public.can('schedule', 'view')) or (select public.can('patients', 'view')));
create policy slot_spare_implants_area_insert on public.slot_spare_implants as restrictive for insert to authenticated
  with check ((select public.can('schedule', 'edit')));
create policy slot_spare_implants_area_update on public.slot_spare_implants as restrictive for update to authenticated
  using ((select public.can('schedule', 'edit'))) with check ((select public.can('schedule', 'edit')));
create policy slot_spare_implants_area_delete on public.slot_spare_implants as restrictive for delete to authenticated
  using ((select public.can('schedule', 'edit')));
create policy slot_spare_implants_tenant_definer on public.slot_spare_implants for all to tenant_definer
  using (true) with check (true);
create policy slot_spare_implants_company_select on public.slot_spare_implants as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy slot_spare_implants_company_insert on public.slot_spare_implants as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy slot_spare_implants_company_update on public.slot_spare_implants as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy slot_spare_implants_company_delete on public.slot_spare_implants as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- ── create_surgery_slot_v4: 0122's create_surgery_slot_v3 body, plus each tooth's spares ─────────────
create function public.create_surgery_slot_v4(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[], p_implants jsonb, p_override_reason text, p_notes text, p_placing_doctor uuid,
  p_setting text, p_date date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_clash boolean;
  v_session public.sessions;
  v_session_id uuid := p_session;
  v_slot uuid;
  v_placing uuid[] := coalesce(p_placing, '{}');
  v_assisting uuid[] := coalesce(p_assisting, '{}');
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_technique text;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
  v_teaching boolean := public.module_on('teaching');
  v_spares jsonb;
  v_spare_text text;
  v_spare uuid;
  v_spare_ids uuid[];
begin
  perform app_private.require_perm('schedule', 'edit');
  if not v_teaching then
    -- A clinic books by date: the day's hidden clinic day is found or made.
    if p_session is not null then
      perform app_private.fail('Clinic bookings take a date, not a surgery day.');
    end if;
    if p_date is null then
      perform app_private.fail('Choose a date.');
    end if;
    v_session_id := app_private.clinic_day(p_date);
  else
    if p_date is not null or p_setting is not null then
      perform app_private.fail('Dates and settings are set on clinic bookings only.');
    end if;
    if p_session is null then
      perform app_private.fail('Choose a surgery day.');
    end if;
  end if;
  select * into v_session from public.sessions where id = v_session_id;
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
  if not v_teaching then
    if p_supervisor is not null or cardinality(v_all) > 0 then
      perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
    end if;
    if p_placing_doctor is null or not exists (select 1 from public.doctors where id = p_placing_doctor and active) then
      perform app_private.fail('Choose the doctor.');
    end if;
  elsif p_placing_doctor is not null then
    if cardinality(v_placing) > 0 then
      perform app_private.fail('Choose a delegate or a doctor, not both.');
    end if;
    if not exists (select 1 from public.doctors where id = p_placing_doctor and active) then
      perform app_private.fail('Choose the doctor.');
    end if;
    if p_supervisor is not null and not exists (select 1 from public.supervisors where id = p_supervisor and active) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
  else
    if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
      perform app_private.fail('Choose an active supervisor.');
    end if;
    if cardinality(v_placing) = 0 then
      perform app_private.fail('Choose at least one placing delegate.');
    end if;
  end if;
  if (select count(*) from unnest(v_all)) <> (select count(distinct x) from unnest(v_all) x)
     and not exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
    perform app_private.fail('A delegate is listed twice.');
  end if;
  if exists (select 1 from unnest(v_placing) x where x = any (v_assisting)) then
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
  v_clash := exists (
    select 1 from public.slot_conflicts_v2(v_session_id, p_chair, p_start, p_end, p_patient, p_supervisor, v_all, p_placing_doctor, null)
  );
  if v_clash and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id,
                                    placing_doctor_id, override_reason, notes, setting)
  values (v_session_id, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, p_placing_doctor,
          case when v_clash then trim(coalesce(p_override_reason, '')) else '' end, coalesce(p_notes, ''), p_setting)
  returning id into v_slot;

  insert into public.slot_delegates (slot_id, delegate_id, role)
  select v_slot, x, 'placing' from unnest(v_placing) x
  union all
  select v_slot, x, 'assisting' from unnest(v_assisting) x;

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
      set slot_id = v_slot, session_id = v_session_id, course_id = v_session.course_id,
          product_id = coalesce(v_product, product_id), technique = coalesce(v_technique, technique)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id, technique)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, v_session_id, v_slot, v_technique)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
    insert into public.slot_spare_implants (slot_id, tooth, product_id, position)
    select v_slot, v_tooth, s.id, s.n::smallint from unnest(v_spare_ids) with ordinality as s(id, n);
  end loop;
  return v_slot;
end $$;

-- ── pull_list_v2: 0017's pull_list, plus the spares ─────────────────────────────────────────────────
-- A spare counts while its tooth's site is still planned on that live booking, as "needed" does.
create function public.pull_list_v2(p_date date)
returns table (
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text, needed int, spares int, available int
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
  spare as (
    select ss.product_id, count(*)::int as spares
    from public.surgery_slots s
    join public.slot_spare_implants ss on ss.slot_id = s.id
    join public.slot_planned_implants spi on spi.slot_id = s.id and spi.tooth = ss.tooth
    join public.implant_sites site on site.id = spi.implant_site_id and site.slot_id = s.id
    where s.status <> 'cancelled'
      and (s.starts_at at time zone 'Africa/Cairo')::date = p_date
      and site.state = 'planned'
    group by ss.product_id
  ),
  items as (
    -- A planned tooth without a product stays one row with a null product, as in pull_list.
    select coalesce(n.product_id, sp.product_id) as product_id,
           coalesce(n.needed, 0) as needed, coalesce(sp.spares, 0) as spares
    from need n
    full join spare sp on sp.product_id = n.product_id
  ),
  have as (
    select h.product_id, sum(h.on_hand)::int as available
    from public.stock_on_hand h
    where h.on_hand > 0 and (h.expiry is null or h.expiry >= p_date)
    group by h.product_id
  )
  select i.product_id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.description,
         i.needed, i.spares, coalesce(h.available, 0)
  from items i
  left join public.products p on p.id = i.product_id
  left join have h on h.product_id = i.product_id
  order by p.brand nulls last, p.system, p.diameter_mm, p.length_mm;
$$;

-- ── Owner and grants ─────────────────────────────────────────────────────────────────────────────────
-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0122. pull_list_v2 is a reader
-- (security invoker), so RLS and the inventory gate on stock (0111) apply as they do to pull_list.
grant create on schema public, app_private to tenant_definer;
alter function public.create_surgery_slot_v4(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date)
  owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function
  public.create_surgery_slot_v4(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date),
  public.pull_list_v2(date)
  from public, anon;
grant execute on function
  public.create_surgery_slot_v4(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date),
  public.pull_list_v2(date)
  to authenticated;
