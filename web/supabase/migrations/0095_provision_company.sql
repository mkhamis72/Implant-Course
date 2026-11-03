set local lock_timeout = '5s';

-- The global uniques that 0091 replaced with per-company ones (patients_company_file_no_key,
-- chairs_company_name_key, consent_form_versions_company_label_key, checklist_templates_company_one_default):
-- a second company reuses file numbers, chair names, consent labels and a default template. Release 4
-- runs with the previous app suspended, and dropping a unique never breaks it.
alter table public.patients drop constraint patients_file_no_key;
drop index public.patients_file_no_upper_key;
alter table public.chairs drop constraint chairs_name_key;
alter table public.consent_form_versions drop constraint consent_form_versions_label_key;
drop index public.checklist_templates_one_default;

-- provision_company: a new company in the shared database with what its signed-in pages need from the
-- start: settings (every page reads them), branding with its name, a file-number counter, academy's
-- active catalogue and academy's consent form versions (new ids, unsigned). Returns the company id, which
-- the console and tenant:register --provision save on the control project's tenants row (for a slug that
-- exists already, the existing company's id while it has no members, so a lost save can be retried).
-- Service role only and owned by postgres (scripts/definer-allowlist.ts), like 0093's console functions:
-- it writes a named company's rows with no bound session, so every insert names company_id (the column
-- defaults resolve to null without one). The audit trigger on these tables is postgres-owned too.
create function public.provision_company(p_slug text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := trim(coalesce(p_slug, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_academy constant uuid := 'a7c0de00-0000-4000-8000-000000000001';
  v_id uuid;
begin
  if v_slug !~ '^[a-z0-9-]{2,40}$' then
    perform app_private.fail('Use a slug of 2–40 lower-case letters, digits or hyphens.');
  end if;
  if length(v_name) < 2 then
    perform app_private.fail('The company needs a name.');
  end if;
  insert into public.companies (slug, name) values (v_slug, v_name)
  on conflict (slug) do nothing
  returning id into v_id;
  if v_id is null then
    -- A retried registration (the registry never saved the id): a company nobody belongs to yet is that
    -- earlier call's, seeded in its transaction, so hand back its id. One with members is someone else's.
    select c.id into v_id from public.companies c where c.slug = v_slug for update;
    if exists (select 1 from public.company_members m where m.company_id = v_id) then
      perform app_private.fail('A company with this slug already exists.');
    end if;
    return v_id;
  end if;

  insert into public.settings (company_id) values (v_id);
  -- Branding names are 2–60 characters (0040); the company keeps its full name.
  insert into public.branding (company_id, name) values (v_id, left(v_name, 60));
  insert into app_private.file_no_counters (company_id, last_no) values (v_id, 0);

  insert into public.products (company_id, type, brand, system, platform, diameter_mm, length_mm,
    ref_code, description, reorder_level, active, is_sample)
  select v_id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm,
    p.ref_code, p.description, p.reorder_level, p.active, p.is_sample
  from public.products p
  where p.company_id = v_academy and p.active and not p.is_sample
  order by p.created_at, p.id;

  -- In academy's order: created_at defaults to clock_timestamp(), evaluated per row, so the copies keep it.
  insert into public.consent_form_versions (company_id, label, effective_on, text_en, text_ar)
  select v_id, v.label, v.effective_on, v.text_en, v.text_ar
  from public.consent_form_versions v
  where v.company_id = v_academy
  order by v.created_at, v.id;

  return v_id;
end $$;

alter function public.provision_company(text, text) owner to postgres;
-- 0092's default privileges give tenant_definer execute on every new postgres-owned function: take it back.
revoke all on function public.provision_company(text, text) from public, anon, authenticated, tenant_definer;
grant execute on function public.provision_company(text, text) to service_role;
