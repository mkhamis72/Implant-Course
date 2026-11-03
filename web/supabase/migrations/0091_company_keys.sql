-- One database (plan 3, release 4): company keys. A row can no longer point at another company's row,
-- companies can reuse names and numbers, and the singletons hold one row per company. The global uniques
-- that the per-company ones replace stay until release 5 (0095); with academy alone they block nothing.
-- The previous app version is suspended while this release migrates.
set local lock_timeout = '5s';


-- ── Composite foreign keys ──────────────────────────────────────────────────────────────────────────
-- Every foreign key from one company table to another becomes (company_id, col) → (company_id, id),
-- under the same name (PostgREST embeds name them) and with the same actions. "on delete set null"
-- keeps company_id (not null) by naming the column: set null (col), Postgres 15+. Foreign keys to
-- profiles and companies stay single-column. Every referenced table has <relname>_company_id_key (0084).

do $$
declare
  k record;
  v_delete text;
  v_update text;
begin
  for k in
    select c.conname, c.conrelid::regclass as tbl, c.confrelid::regclass as ref, c.confdeltype, c.confupdtype,
           c.condeferrable, a.attname as col, ra.attname as ref_col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_catalog.pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.contype = 'f' and cardinality(c.conkey) = 1
      and c.conrelid in (select app.company_tables()) and c.confrelid in (select app.company_tables())
    order by 2::text, 1
  loop
    if k.ref_col <> 'id' or k.condeferrable then
      raise exception 'unexpected foreign key %.%: references %, deferrable %', k.tbl, k.conname, k.ref_col, k.condeferrable;
    end if;
    v_delete := case k.confdeltype
      when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
      when 'n' then format('set null (%I)', k.col) end;
    v_update := case k.confupdtype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' end;
    if v_delete is null or v_update is null then
      raise exception 'unexpected actions on %.%: delete %, update %', k.tbl, k.conname, k.confdeltype, k.confupdtype;
    end if;
    execute format(
      'alter table %s drop constraint %I, add constraint %I foreign key (company_id, %I) references %s (company_id, id) on delete %s on update %s',
      k.tbl, k.conname, k.conname, k.col, k.ref, v_delete, v_update);
  end loop;
end $$;


-- A new patient's medical history (0004) goes to the patient's company, which the composite key now checks.
create or replace function app_private.create_medical_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.medical_history (company_id, patient_id) values (new.company_id, new.id);
  return new;
end $$;


-- ── Per-company uniques ─────────────────────────────────────────────────────────────────────────────

create unique index patients_company_file_no_key on public.patients (company_id, upper(file_no));
alter table public.chairs add constraint chairs_company_name_key unique (company_id, name);
alter table public.consent_form_versions add constraint consent_form_versions_company_label_key unique (company_id, label);
create unique index checklist_templates_company_one_default on public.checklist_templates (company_id, applies_to)
  where is_default;


-- ── Singletons: one row per company ─────────────────────────────────────────────────────────────────
-- company_id becomes the primary key, which replaces unique (company_id) from 0084 (<rel>_company_id_key).
-- The boolean id column stays until release 5, still defaulting to true.

alter table public.settings drop constraint settings_pkey, drop constraint settings_company_id_key,
  add constraint settings_pkey primary key (company_id);
alter table public.branding drop constraint branding_pkey, drop constraint branding_company_id_key,
  add constraint branding_pkey primary key (company_id);
alter table public.branding_logos drop constraint branding_logos_pkey, drop constraint branding_logos_company_id_key,
  add constraint branding_logos_pkey primary key (company_id);

-- The old pre-login readers (0040), kept for the previous app version until 0095, read academy's row:
-- that version served academy alone, and with several rows "where id" would match them all.
create or replace function public.branding_public()
returns table (name text, brand_color text, nav_color text, logo_version int, has_logo boolean)
language sql stable security definer set search_path = '' as $$
  select b.name, b.brand_color, b.nav_color, b.logo_version,
         exists (select 1 from public.branding_logos l where l.company_id = b.company_id)
  from public.branding b where b.company_id = 'a7c0de00-0000-4000-8000-000000000001'
$$;

create or replace function public.branding_logo()
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select l.bytes, l.content_type from public.branding_logos l
  where l.company_id = 'a7c0de00-0000-4000-8000-000000000001'
$$;

-- The writers (0040) act on the bound company's row, creating it when the company has none yet.
create or replace function public.update_branding(p_name text, p_brand_color text, p_nav_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  insert into public.branding (company_id, name, brand_color, nav_color)
  values (v_company,
          nullif(trim(coalesce(p_name, '')), ''),
          lower(nullif(trim(coalesce(p_brand_color, '')), '')),
          lower(nullif(trim(coalesce(p_nav_color, '')), '')))
  on conflict (company_id) do update set
    name = excluded.name, brand_color = excluded.brand_color, nav_color = excluded.nav_color;
end $$;

create or replace function public.set_branding_logo(p_bytes bytea, p_content_type text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  insert into public.branding_logos (company_id, bytes, content_type) values (v_company, p_bytes, p_content_type)
  on conflict (company_id) do update set bytes = excluded.bytes, content_type = excluded.content_type;
  insert into public.branding as b (company_id, logo_version) values (v_company, 1)
  on conflict (company_id) do update set logo_version = b.logo_version + 1;
end $$;

create or replace function public.clear_branding_logo() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  delete from public.branding_logos where company_id = v_company;
  insert into public.branding as b (company_id, logo_version) values (v_company, 1)
  on conflict (company_id) do update set logo_version = b.logo_version + 1;
end $$;


-- ── The file number counter, per company ────────────────────────────────────────────────────────────
-- next_file_no (0006) drew from one global sequence. It now continues the bound company's own numbers:
-- the highest P-number in that company (typed ones included, any case) plus one, so it never meets a
-- number already used there. One draw at a time per company: the lock is held until the insert commits.
-- Without a bound company (scripts, service role) it counts across every company, so the number is free
-- in any of them. patients_file_no_seq is no longer used.

create or replace function public.next_file_no() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('file-no:' || coalesce(v_company::text, 'any')));
  select coalesce(max(substring(upper(p.file_no) from '^P([0-9]{1,18})$')::bigint), 0) + 1 into n
  from public.patients p
  where (v_company is null or p.company_id = v_company) and upper(p.file_no) ~ '^P[0-9]{1,18}$';
  return 'P' || lpad(n::text, greatest(5, length(n::text)), '0');
end $$;


-- ── Advisory locks gain the company ─────────────────────────────────────────────────────────────────
-- The per-day booking and talk locks (one booking or talk at a time per day) now key on the session's
-- company and date, so one company's bookings never wait for another's. Bodies as in 0030 / 0028
-- apart from the lock key.

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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
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
  perform pg_advisory_xact_lock(hashtext('surgery-day:' || v_session.company_id::text || ':' || v_session.date::text));
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

create or replace function app_private.check_talk(
  p_session public.sessions, p_start time, p_end time, p_lecturer uuid, p_topic text, p_exclude uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := public.cairo_ts(p_session.date, p_start);
  v_end timestamptz := public.cairo_ts(p_session.date, p_end);
  v_clash record;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('End time must be after the start time.');
  end if;
  if p_start < p_session.start_time or p_end > p_session.end_time then
    perform app_private.fail(format('The talk must fit within the session (%s–%s).',
      left(p_session.start_time::text, 5), left(p_session.end_time::text, 5)));
  end if;
  if length(trim(coalesce(p_topic, ''))) < 2 then
    perform app_private.fail('Enter a topic.');
  end if;

  perform pg_advisory_xact_lock(hashtext('talk-day:' || p_session.company_id::text || ':' || p_session.date::text));

  select t.starts_at, t.ends_at, t.topic into v_clash
  from public.talks t
  where t.session_id = p_session.id
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('Another talk in this session overlaps (%s–%s, %s).',
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI'), v_clash.topic));
  end if;

  select t.starts_at, t.ends_at, l.full_name as lecturer into v_clash
  from public.talks t join public.lecturers l on l.id = t.lecturer_id
  where t.lecturer_id = p_lecturer
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('%s is already giving a talk at %s–%s.', v_clash.lecturer,
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI')));
  end if;
end $$;
