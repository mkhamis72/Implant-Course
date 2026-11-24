-- Implant passport (spec docs/superpowers/specs/2026-11-24-implant-passport-design.md; plan
-- docs/superpowers/plans/2026-11-24-implant-passport.md, task 2): stored PDF versions of a patient's passport,
-- their bytes in a closed table, a download log, and the company's choice of medical content.
-- Additive: the previous app version never reads these. Nothing is seeded (no restore TRUNCATE entry).
set local lock_timeout = '5s';

-- ── Passports ───────────────────────────────────────────────────────────────────────────────────────
-- One row per generated version (1, 2, … per patient). The company pattern of 0114 (doctors): company_id
-- default, (company_id, id) key, composite foreign keys. A stored passport never changes; it goes only with
-- its patient (delete_patient's cascade). medical_level is the setting used when it was generated.
create table public.patient_passports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  patient_id uuid not null,
  version int not null check (version >= 1),
  generated_at timestamptz not null default now(),
  generated_by uuid default app.current_user_id() references public.profiles (user_id),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  medical_level text not null check (medical_level in ('allergies_medications', 'full', 'none')),
  constraint patient_passports_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint patient_passports_company_id_key unique (company_id, id),
  constraint patient_passports_patient_id_fkey foreign key (company_id, patient_id)
    references public.patients (company_id, id) on delete cascade,
  constraint patient_passports_version_key unique (company_id, patient_id, version)
);
-- Audited (no bytes here): the patient's History shows "Implant passport generated (version N)".
create trigger patient_passports_audit after insert or update or delete on public.patient_passports
  for each row execute function app_private.audit_row('id');

-- ── Passport bytes ──────────────────────────────────────────────────────────────────────────────────
-- Like stored_files (0072): no audit trigger, so audit_log never holds the PDF; closed to every role and read
-- only through patient_passport_file. One file per passport, deleted with it.
create table public.patient_passport_files (
  company_id uuid not null default app.current_company_id(),
  passport_id uuid not null,
  bytes bytea not null check (octet_length(bytes) between 5 and 5242880
                              and substring(bytes from 1 for 5) = '\x255044462d'::bytea),
  constraint patient_passport_files_pkey primary key (company_id, passport_id),
  constraint patient_passport_files_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint patient_passport_files_passport_id_fkey foreign key (company_id, passport_id)
    references public.patient_passports (company_id, id) on delete cascade
);

-- ── Downloads ───────────────────────────────────────────────────────────────────────────────────────
-- Append-only log written by patient_passport_file; goes with its passport. Not audited: it is a log itself.
create table public.passport_downloads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  passport_id uuid not null,
  downloaded_at timestamptz not null default now(),
  downloaded_by uuid default app.current_user_id() references public.profiles (user_id),
  constraint passport_downloads_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint passport_downloads_company_id_key unique (company_id, id),
  constraint passport_downloads_passport_id_fkey foreign key (company_id, passport_id)
    references public.patient_passports (company_id, id) on delete cascade
);
create index passport_downloads_passport_id_idx on public.passport_downloads (company_id, passport_id);

-- ── Settings ────────────────────────────────────────────────────────────────────────────────────────
-- One row per company (no row = allergies_medications), written by admins through set_passport_settings.
create table public.passport_settings (
  company_id uuid primary key default app.current_company_id(),
  medical text not null default 'allergies_medications'
    check (medical in ('allergies_medications', 'full', 'none')),
  updated_at timestamptz not null default now(),
  constraint passport_settings_company_id_fkey foreign key (company_id) references public.companies (id)
);
create trigger passport_settings_set_updated_at before update on public.passport_settings
  for each row execute function app_private.set_updated_at();
create trigger passport_settings_audit after insert or update or delete on public.passport_settings
  for each row execute function app_private.audit_row('company_id');

-- ── Grants and policies ─────────────────────────────────────────────────────────────────────────────
-- Passports, downloads and the setting: read by active staff with Patients view (admins pass can()).
-- Only the definers below write. The file table: no access at all.
-- tenant_definer gets its table privileges from 0092's default privileges.
revoke all on public.patient_passports, public.patient_passport_files, public.passport_downloads,
  public.passport_settings from public, anon, authenticated;
grant select on public.patient_passports, public.passport_downloads, public.passport_settings to authenticated;

alter table public.patient_passports enable row level security;
alter table public.patient_passports force row level security;
create policy patient_passports_select on public.patient_passports for select to authenticated
  using (public.is_active_user());
create policy patient_passports_area_read on public.patient_passports as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy patient_passports_tenant_definer on public.patient_passports for all to tenant_definer
  using (true) with check (true);
create policy patient_passports_company_select on public.patient_passports as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy patient_passports_company_insert on public.patient_passports as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy patient_passports_company_update on public.patient_passports as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy patient_passports_company_delete on public.patient_passports as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

alter table public.patient_passport_files enable row level security;
alter table public.patient_passport_files force row level security;
create policy patient_passport_files_tenant_definer on public.patient_passport_files for all to tenant_definer
  using (true) with check (true);
create policy patient_passport_files_company_select on public.patient_passport_files as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy patient_passport_files_company_insert on public.patient_passport_files as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy patient_passport_files_company_update on public.patient_passport_files as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy patient_passport_files_company_delete on public.patient_passport_files as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

alter table public.passport_downloads enable row level security;
alter table public.passport_downloads force row level security;
create policy passport_downloads_select on public.passport_downloads for select to authenticated
  using (public.is_active_user());
create policy passport_downloads_area_read on public.passport_downloads as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy passport_downloads_tenant_definer on public.passport_downloads for all to tenant_definer
  using (true) with check (true);
create policy passport_downloads_company_select on public.passport_downloads as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy passport_downloads_company_insert on public.passport_downloads as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy passport_downloads_company_update on public.passport_downloads as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy passport_downloads_company_delete on public.passport_downloads as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

alter table public.passport_settings enable row level security;
alter table public.passport_settings force row level security;
create policy passport_settings_select on public.passport_settings for select to authenticated
  using (public.is_active_user());
create policy passport_settings_area_read on public.passport_settings as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy passport_settings_tenant_definer on public.passport_settings for all to tenant_definer
  using (true) with check (true);
create policy passport_settings_company_select on public.passport_settings as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy passport_settings_company_insert on public.passport_settings as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy passport_settings_company_update on public.passport_settings as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy passport_settings_company_delete on public.passport_settings as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- ── save_patient_passport ───────────────────────────────────────────────────────────────────────────
-- Stores a generated PDF as the patient's next version. The patient lock serialises two saves, so each gets
-- its own version. The app passes the medical level it rendered with (passport_settings_current at the time).
create function public.save_patient_passport(p_patient uuid, p_file bytea, p_medical_level text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_version int;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform 1 from public.patients where id = p_patient for update;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  if p_medical_level is null or p_medical_level not in ('allergies_medications', 'full', 'none') then
    perform app_private.fail('Choose the medical content of the passport: allergies and medications, full or none.');
  end if;
  if p_file is null or octet_length(p_file) < 5 or substring(p_file from 1 for 5) <> '\x255044462d'::bytea then
    perform app_private.fail('That is not a PDF file.');
  end if;
  if octet_length(p_file) > 5242880 then
    perform app_private.fail('The passport is too large to store.');
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.patient_passports where patient_id = p_patient;
  insert into public.patient_passports (patient_id, version, size_bytes, sha256, medical_level)
  values (p_patient, v_version, octet_length(p_file), encode(sha256(p_file), 'hex'), p_medical_level)
  returning id into v_id;
  insert into public.patient_passport_files (passport_id, bytes) values (v_id, p_file);
  return v_id;
end $$;

-- ── patient_passport_file ───────────────────────────────────────────────────────────────────────────
-- A stored passport's bytes, for a download; logs who downloaded it. Company-scoped by the company policies
-- (tenant_definer sees only the bound company's rows).
create function public.patient_passport_file(p_passport uuid) returns bytea
language plpgsql security definer set search_path = '' as $$
declare
  v_bytes bytea;
begin
  perform app_private.require_perm('patients', 'view');
  select f.bytes into v_bytes from public.patient_passport_files f where f.passport_id = p_passport;
  if not found then
    perform app_private.fail('Passport not found.');
  end if;
  insert into public.passport_downloads (passport_id) values (p_passport);
  return v_bytes;
end $$;

-- ── Settings ────────────────────────────────────────────────────────────────────────────────────────
-- Admin only, no area (as save_catalogue, 0132): Admin -> Settings -> Implant passport.
create function public.set_passport_settings(p_medical text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can change the passport settings.', false);
  if p_medical is null or p_medical not in ('allergies_medications', 'full', 'none') then
    perform app_private.fail('Choose the medical content of the passport: allergies and medications, full or none.');
  end if;
  insert into public.passport_settings (company_id, medical) values (v_company, p_medical)
  on conflict (company_id) do update set medical = excluded.medical;
end $$;

-- The bound company's setting, or the default. Security invoker: it obeys the table's RLS (staff with
-- Patients view); anyone else gets the default.
create function public.passport_settings_current() returns text
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select s.medical from public.passport_settings s where s.company_id = (select app.current_company_id())),
    'allergies_medications');
$$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it).
grant create on schema public, app_private to tenant_definer;
alter function public.save_patient_passport(uuid, bytea, text) owner to tenant_definer;
alter function public.patient_passport_file(uuid) owner to tenant_definer;
alter function public.set_passport_settings(text) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function public.save_patient_passport(uuid, bytea, text) from public, anon;
revoke execute on function public.patient_passport_file(uuid) from public, anon;
revoke execute on function public.set_passport_settings(text) from public, anon;
revoke execute on function public.passport_settings_current() from public, anon;
grant execute on function public.save_patient_passport(uuid, bytea, text) to authenticated;
grant execute on function public.patient_passport_file(uuid) to authenticated;
grant execute on function public.set_passport_settings(text) to authenticated;
grant execute on function public.passport_settings_current() to authenticated;

-- ── History ─────────────────────────────────────────────────────────────────────────────────────────
-- patient_history (latest definition: 0143) adds the patient's passports; same signature.
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites', 'restorations', 'radiographs', 'full_arch_cases',
                          'patient_passports')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts', 'implant_complications',
                          'restoration_sites')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
     or (a.table_name = 'restoration_problems'
         and coalesce(a.after ->> 'restoration_id', a.before ->> 'restoration_id') in
             (select r.id::text from public.restorations r where r.patient_id = p_patient))
     or (a.table_name = 'radiograph_bone_levels'
         and coalesce(a.after ->> 'radiograph_id', a.before ->> 'radiograph_id') in
             (select x.id::text from public.radiographs x where x.patient_id = p_patient))
     or (a.table_name = 'full_arch_stages'
         and coalesce(a.after ->> 'case_id', a.before ->> 'case_id') in
             (select fc.id::text from public.full_arch_cases fc where fc.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

-- Patients view reads the passports' audit rows too (latest definition: 0143).
drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems',
                           'radiographs', 'radiograph_bone_levels', 'full_arch_cases', 'full_arch_stages',
                           'patient_passports'))
  );
