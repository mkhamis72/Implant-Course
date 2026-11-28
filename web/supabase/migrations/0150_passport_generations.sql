-- Passport generation log (plan docs/superpowers/plans/2026-11-28-filters-screws-passport-admin.md, task 5): the
-- passport is now built in the user's browser from data the server prepares; only a small row per generation is kept.
-- Additive: the stored-passport tables and functions of 0145 stay for the previous app version (a later clean-up
-- drops them). Nothing is seeded (no restore TRUNCATE entry).
set local lock_timeout = '5s';

-- ── Generations ─────────────────────────────────────────────────────────────────────────────────────
-- One row each time the passport data was handed out (a failed download in the browser still leaves the row).
-- Company pattern of 0145; goes with its patient (delete_patient's cascade). medical_level is the setting used.
create table public.passport_generations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  patient_id uuid not null,
  generated_at timestamptz not null default now(),
  generated_by uuid default app.current_user_id() references public.profiles (user_id),
  medical_level text not null check (medical_level in ('allergies_medications', 'full', 'none')),
  constraint passport_generations_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint passport_generations_company_id_key unique (company_id, id),
  constraint passport_generations_patient_id_fkey foreign key (company_id, patient_id)
    references public.patients (company_id, id) on delete cascade
);
create index passport_generations_patient_id_idx on public.passport_generations (company_id, patient_id, generated_at desc);
-- Audited: the patient's History shows the generation.
create trigger passport_generations_audit after insert or update or delete on public.passport_generations
  for each row execute function app_private.audit_row('id');

-- Read by active staff with Patients view; only log_passport_generation writes.
-- tenant_definer gets its table privileges from 0092's default privileges.
revoke all on public.passport_generations from public, anon, authenticated;
grant select on public.passport_generations to authenticated;

alter table public.passport_generations enable row level security;
alter table public.passport_generations force row level security;
create policy passport_generations_select on public.passport_generations for select to authenticated
  using (public.is_active_user());
create policy passport_generations_area_read on public.passport_generations as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy passport_generations_tenant_definer on public.passport_generations for all to tenant_definer
  using (true) with check (true);
create policy passport_generations_company_select on public.passport_generations as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy passport_generations_company_insert on public.passport_generations as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy passport_generations_company_update on public.passport_generations as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy passport_generations_company_delete on public.passport_generations as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- ── log_passport_generation ─────────────────────────────────────────────────────────────────────────
-- Patients view (anyone who may read the patient may take a passport). The patient must be in the bound company
-- (the company policies hide others' rows from tenant_definer). The app passes the medical level it used.
create function public.log_passport_generation(p_patient uuid, p_medical_level text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'view');
  perform 1 from public.patients where id = p_patient;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  if p_medical_level is null or p_medical_level not in ('allergies_medications', 'full', 'none') then
    perform app_private.fail('Choose the medical content of the passport: allergies and medications, full or none.');
  end if;
  insert into public.passport_generations (patient_id, medical_level) values (p_patient, p_medical_level)
  returning id into v_id;
  return v_id;
end $$;

grant create on schema public, app_private to tenant_definer;
alter function public.log_passport_generation(uuid, text) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function public.log_passport_generation(uuid, text) from public, anon;
grant execute on function public.log_passport_generation(uuid, text) to authenticated;

-- ── History ─────────────────────────────────────────────────────────────────────────────────────────
-- patient_history (latest definition: 0145) adds the passport generations; same signature.
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
                          'patient_passports', 'passport_generations')
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

-- Patients view reads the generations' audit rows too (latest definition: 0145).
drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts',
                           'implant_complications', 'restorations', 'restoration_sites', 'restoration_problems',
                           'radiographs', 'radiograph_bone_levels', 'full_arch_cases', 'full_arch_stages',
                           'patient_passports', 'passport_generations'))
  );
