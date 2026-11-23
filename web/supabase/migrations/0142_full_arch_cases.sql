-- Full-arch cases (C2, spec docs/superpowers/specs/2026-11-23-full-arch-design.md; plan
-- docs/superpowers/plans/2026-11-24-full-arch-cases.md): a case groups one arch's implants and restorations,
-- with three lab stages (scan, lab and design, try-in). This migration adds the tables, the case links on
-- implants and restorations, their RLS and the trigger that links a new restoration to its arch's open case.
-- The functions that write cases come in 0143. Additive: the previous app version never reads these.
set local lock_timeout = '5s';

-- ── Cases ───────────────────────────────────────────────────────────────────────────────────────────
-- The company pattern of 0114 (doctors): company_id default, (company_id, id) key, composite foreign keys.
-- upper = FDI quadrants 1–2, lower = 3–4. A case is closed (closed_at, close_reason), never reopened here.
create table public.full_arch_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  patient_id uuid not null,
  arch text not null check (arch in ('upper', 'lower')),
  configuration text not null check (configuration in ('all_on_4', 'all_on_6', 'all_on_x', 'other')),
  name text not null default '' check (length(name) <= 60),
  notes text not null default '' check (length(notes) <= 1000),
  closed_at timestamptz,
  close_reason text check (length(trim(close_reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid default app.current_user_id() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint full_arch_cases_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint full_arch_cases_company_id_key unique (company_id, id),
  constraint full_arch_cases_patient_id_fkey foreign key (company_id, patient_id)
    references public.patients (company_id, id) on delete cascade
);
create index full_arch_cases_patient_id_idx on public.full_arch_cases (company_id, patient_id);
-- One open case per patient and arch.
create unique index full_arch_cases_one_open on public.full_arch_cases (company_id, patient_id, arch)
  where closed_at is null;

create trigger full_arch_cases_set_updated_at before update on public.full_arch_cases
  for each row execute function app_private.set_updated_at();
create trigger full_arch_cases_audit after insert or update or delete on public.full_arch_cases
  for each row execute function app_private.audit_row('id');

-- ── Stages ──────────────────────────────────────────────────────────────────────────────────────────
-- One row per stage and case. Delivery is not a stage: it is the linked restorations' fitted dates.
create table public.full_arch_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  case_id uuid not null,
  stage text not null check (stage in ('scan', 'lab_design', 'try_in')),
  done_on date not null,
  lab text check (length(lab) <= 120),
  passive_fit boolean,
  occlusion text check (length(occlusion) <= 500),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default app.current_user_id() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint full_arch_stages_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint full_arch_stages_company_id_key unique (company_id, id),
  constraint full_arch_stages_case_id_fkey foreign key (company_id, case_id)
    references public.full_arch_cases (company_id, id) on delete cascade,
  constraint full_arch_stages_case_id_stage_key unique (case_id, stage),
  constraint full_arch_stages_lab_design_only check (lab is null or stage = 'lab_design'),
  constraint full_arch_stages_try_in_only check ((passive_fit is null and occlusion is null) or stage = 'try_in')
);

create trigger full_arch_stages_set_updated_at before update on public.full_arch_stages
  for each row execute function app_private.set_updated_at();
create trigger full_arch_stages_audit after insert or update or delete on public.full_arch_stages
  for each row execute function app_private.audit_row('id');

-- ── Grants and policies ─────────────────────────────────────────────────────────────────────────────
-- Read like restorations (0057): active staff with Patients view. Only the definers of 0143 write.
-- tenant_definer gets its table privileges from 0092's default privileges.
revoke all on public.full_arch_cases from public, anon, authenticated;
grant select on public.full_arch_cases to authenticated;
alter table public.full_arch_cases enable row level security;
alter table public.full_arch_cases force row level security;
create policy full_arch_cases_select on public.full_arch_cases for select to authenticated
  using (public.is_active_user());
create policy full_arch_cases_area_read on public.full_arch_cases as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy full_arch_cases_tenant_definer on public.full_arch_cases for all to tenant_definer
  using (true) with check (true);
create policy full_arch_cases_company_select on public.full_arch_cases as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy full_arch_cases_company_insert on public.full_arch_cases as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy full_arch_cases_company_update on public.full_arch_cases as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy full_arch_cases_company_delete on public.full_arch_cases as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

revoke all on public.full_arch_stages from public, anon, authenticated;
grant select on public.full_arch_stages to authenticated;
alter table public.full_arch_stages enable row level security;
alter table public.full_arch_stages force row level security;
create policy full_arch_stages_select on public.full_arch_stages for select to authenticated
  using (public.is_active_user());
create policy full_arch_stages_area_read on public.full_arch_stages as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy full_arch_stages_tenant_definer on public.full_arch_stages for all to tenant_definer
  using (true) with check (true);
create policy full_arch_stages_company_select on public.full_arch_stages as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy full_arch_stages_company_insert on public.full_arch_stages as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy full_arch_stages_company_update on public.full_arch_stages as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy full_arch_stages_company_delete on public.full_arch_stages as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- ── Case links ──────────────────────────────────────────────────────────────────────────────────────
-- Composite keys (0091): a row names only a case of its own company. Deleting a case unlinks its implants
-- and restorations and keeps company_id (set null (case_id)). No column grant: only definers write case_id.
alter table public.implant_sites add column case_id uuid,
  add constraint implant_sites_case_id_fkey foreign key (company_id, case_id)
    references public.full_arch_cases (company_id, id) on delete set null (case_id);
create index implant_sites_case_id_idx on public.implant_sites (company_id, case_id);

alter table public.restorations add column case_id uuid,
  add constraint restorations_case_id_fkey foreign key (company_id, case_id)
    references public.full_arch_cases (company_id, id) on delete set null (case_id);
create index restorations_case_id_idx on public.restorations (company_id, case_id);

-- ── New restorations join their arch's open case ────────────────────────────────────────────────────
-- After a restoration's site is linked (add_restoration and the other restoration definers insert
-- restoration_sites), an unlinked restoration whose site is in an open case of the same patient joins that
-- case when every tooth of the restoration is on the case's arch. Security invoker: it runs as the writer,
-- which is tenant_definer inside the definers (table privileges from 0092, its policies, the company
-- policies), so it acts only within the bound company. Scripts as postgres pass too.
create function app_private.link_restoration_to_case() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_resto record;
  v_case uuid;
begin
  select r.id, r.patient_id, r.teeth, r.case_id into v_resto
  from public.restorations r where r.id = new.restoration_id;
  if v_resto.id is null or v_resto.case_id is not null then
    return null;
  end if;

  select fc.id into v_case
  from public.implant_sites s
  join public.full_arch_cases fc on fc.company_id = s.company_id and fc.id = s.case_id
  where s.id = new.site_id
    and fc.closed_at is null
    and fc.patient_id = v_resto.patient_id
    and not exists (
      select 1 from unnest(v_resto.teeth) t
      where (t / 10) not in (case when fc.arch = 'upper' then 1 else 3 end,
                             case when fc.arch = 'upper' then 2 else 4 end)
    );

  if v_case is not null then
    update public.restorations set case_id = v_case where id = new.restoration_id;
  end if;
  return null;
end $$;
revoke all on function app_private.link_restoration_to_case() from public;

create trigger restoration_sites_case_link after insert on public.restoration_sites
  for each row execute function app_private.link_restoration_to_case();
