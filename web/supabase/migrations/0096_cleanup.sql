set local lock_timeout = '5s';

-- Release 5 cleanup (one database, plan 3 task 11). Runs while release 4's app is live, so it drops only
-- what release 4 no longer touches (each grep-checked against web/src, web/scripts and 0089-0095):
--  * profiles.role / active / delegate_id / mfa_setup_required: the company's membership holds them since
--    0090 (company_members); release 4 reads them there and never writes them on profiles.
--  * public.branding_public() / branding_logo(): replaced by branding_for(company) / branding_logo_for(company).
--  * the boolean `id` of the singletons settings, branding, branding_logos: their key is company_id since
--    0091, and every query filters by company_id (settings actions) or relies on RLS.
--  * patients_file_no_seq: file numbers come from app_private.file_no_counters since 0091.
--  * _company_id_idx wherever another index on the table already leads with company_id.
-- The five global uniques 0091 replaced (patients_file_no_key, patients_file_no_upper_key, chairs_name_key,
-- consent_form_versions_label_key, checklist_templates_one_default) went in 0095 already.

-- The profile columns, with the constraints that name them.
alter table public.profiles drop constraint profiles_delegate_link;
alter table public.profiles drop constraint profiles_delegate_id_key;
alter table public.profiles
  drop column role,
  drop column active,
  drop column delegate_id,
  drop column mfa_setup_required;

-- The previous pre-login readers (academy only). Same signatures as created in 0040/0091.
drop function public.branding_public();
drop function public.branding_logo();

-- The singletons' boolean keys (their checks go with them). Their audit triggers named 'id' as the audited
-- row's key (row_id 'true'); the row is the company's now, so they log company_id.
drop trigger settings_audit on public.settings;
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function app_private.audit_row('company_id');
drop trigger branding_audit on public.branding;
create trigger branding_audit after insert or update or delete on public.branding
  for each row execute function app_private.audit_row('company_id');
alter table public.settings drop column id;
alter table public.branding drop column id;
alter table public.branding_logos drop column id;

drop sequence public.patients_file_no_seq;

-- Plain company_id indexes that another index on the same table already covers (it leads with company_id):
-- the (company_id, id) unique every parent has for composite foreign keys, or the primary / unique key.
-- Tables whose only company_id index is the plain one keep it: app.session_companies, implant_surgery,
-- medical_history, radiograph_bone_levels, restoration_sites, study_courses.
drop index public.admin_events_company_id_idx;
drop index app_private.research_codes_company_id_idx;
drop index public.audit_log_company_id_idx;
drop index public.branding_company_id_idx;
drop index public.branding_logos_company_id_idx;
drop index public.chairs_company_id_idx;
drop index public.checklist_items_company_id_idx;
drop index public.checklist_templates_company_id_idx;
drop index public.checklists_company_id_idx;
drop index public.consent_form_versions_company_id_idx;
drop index public.courses_company_id_idx;
drop index public.delegates_company_id_idx;
drop index public.enrollments_company_id_idx;
drop index public.implant_complications_company_id_idx;
drop index public.implant_followups_company_id_idx;
drop index public.implant_grafts_company_id_idx;
drop index public.implant_sites_company_id_idx;
drop index public.lecturers_company_id_idx;
drop index public.patient_consents_company_id_idx;
drop index public.patients_company_id_idx;
drop index public.products_company_id_idx;
drop index public.radiographs_company_id_idx;
drop index public.research_exports_company_id_idx;
drop index public.restoration_problems_company_id_idx;
drop index public.restorations_company_id_idx;
drop index public.saved_analyses_company_id_idx;
drop index public.sessions_company_id_idx;
drop index public.settings_company_id_idx;
drop index public.site_components_company_id_idx;
drop index public.slot_delegates_company_id_idx;
drop index public.slot_planned_implants_company_id_idx;
drop index public.stock_lots_company_id_idx;
drop index public.stock_movements_company_id_idx;
drop index public.stored_files_company_id_idx;
drop index public.studies_company_id_idx;
drop index public.supervisors_company_id_idx;
drop index public.surgery_slots_company_id_idx;
drop index public.talks_company_id_idx;
drop index public.template_items_company_id_idx;
drop index public.tooth_status_company_id_idx;
drop index public.user_permissions_company_id_idx;
drop index public.visit_notes_company_id_idx;
