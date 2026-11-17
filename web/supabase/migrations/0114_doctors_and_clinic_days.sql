-- Modules, release 3 (spec docs/superpowers/specs/2026-11-16-modular-design.md): the Doctors list and the
-- Clinic type. A clinic's implants are placed by its own doctors, not by course delegates, and its surgery
-- days belong to no course. Additive: every existing company is a Course organizer, whose placements still
-- name a delegate (place_implant_v3 checks it) and whose sessions still need their course (the trigger
-- below). The supervisor requirement on a placed implant moves into the functions (a clinic has none).
set local lock_timeout = '5s';

-- ── Doctors ─────────────────────────────────────────────────────────────────────────────────────────
-- A list of names kept by admins, like supervisors (0024), in its company from the start: the company_id
-- default, foreign key and (company_id, id) key of 0084/0092, the company policies of 0092.
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  name text not null check (length(trim(name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctors_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint doctors_company_id_key unique (company_id, id)
);
create trigger doctors_set_updated_at before update on public.doctors
  for each row execute function app_private.set_updated_at();
create trigger doctors_audit after insert or update or delete on public.doctors
  for each row execute function app_private.audit_row('id');

revoke all on public.doctors from public, anon, authenticated;
grant select on public.doctors to authenticated;
grant insert (name, active) on public.doctors to authenticated;
grant update (name, active) on public.doctors to authenticated;
-- tenant_definer gets its table privileges from 0092's default privileges.

alter table public.doctors enable row level security;
alter table public.doctors force row level security;
create policy doctors_select on public.doctors for select to authenticated using (public.is_active_user());
create policy doctors_insert on public.doctors for insert to authenticated with check (public.is_admin());
create policy doctors_update on public.doctors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy doctors_tenant_definer on public.doctors for all to tenant_definer using (true) with check (true);
create policy doctors_company_select on public.doctors as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy doctors_company_insert on public.doctors as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy doctors_company_update on public.doctors as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy doctors_company_delete on public.doctors as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- ── Placing doctor on implants and bookings ─────────────────────────────────────────────────────────
-- Composite keys (0091): a row can only name a doctor of its own company. Indexed as 0100 does.
alter table public.implant_sites add column placing_doctor_id uuid,
  add constraint implant_sites_placing_doctor_id_fkey foreign key (company_id, placing_doctor_id)
    references public.doctors (company_id, id);
create index implant_sites_placing_doctor_id_idx on public.implant_sites (company_id, placing_doctor_id);

alter table public.surgery_slots add column placing_doctor_id uuid,
  add constraint surgery_slots_placing_doctor_id_fkey foreign key (company_id, placing_doctor_id)
    references public.doctors (company_id, id);
create index surgery_slots_placing_doctor_id_idx on public.surgery_slots (company_id, placing_doctor_id);

-- 0112's constraint: a placed implant names a delegate or a doctor; the supervisor is checked by the
-- functions (a Course organizer's placement still needs one there).
alter table public.implant_sites drop constraint implant_sites_placed_details;
alter table public.implant_sites add constraint implant_sites_placed_details check (
  state in ('planned', 'removed')
  or (product_id is not null and placed_on is not null
      and (placing_delegate_id is not null or placing_doctor_id is not null))
);

-- A clinic's booking may have no supervisor; create_surgery_slot / update_surgery_slot still require one.
alter table public.surgery_slots alter column supervisor_id drop not null;

-- ── Clinic days ─────────────────────────────────────────────────────────────────────────────────────
-- A session without a course: only in a company without teaching (a clinic).
alter table public.sessions alter column course_id drop not null;

-- 0013's body, plus the clinic day. Same signature, so the owner (tenant_definer, 0092) and the trigger stay.
-- The row's own company decides (what module_on('teaching') answers for the bound company), so a write
-- without a bound session (a script as postgres) is held to the same rule.
create or replace function app_private.check_session_in_course() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.course_id is null then
    if 'teaching' = any(app_private.company_features(new.company_id)) then
      perform app_private.fail('Choose the course.');
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id and new.date between c.start_date and c.end_date
  ) then
    perform app_private.fail('The session date must fall within the course dates.');
  end if;
  return new;
end $$;
