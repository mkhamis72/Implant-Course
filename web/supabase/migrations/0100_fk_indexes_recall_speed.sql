-- 1. An index on every link between tables that had none (Supabase advisor: unindexed foreign keys). Each leads
--    with company_id, like the link itself, so it also serves the company-scoped lookups. Who-did-it columns
--    (created_by, voided_by …) stay unindexed: profiles are almost never deleted. tests/db/fk-indexes.test.ts
--    keeps new links covered.
-- 2. The recall list worked out visits patient by patient (one implant_visits call each, ~1.4 ms apiece). A null
--    p_patient now means every patient, and recall_list reads them in one pass. Same signatures, same rows.

create index checklists_template_id_idx on public.checklists (company_id, template_id);
create index enrollments_delegate_id_idx on public.enrollments (company_id, delegate_id);
create index implant_complications_followup_id_idx on public.implant_complications (company_id, followup_id);
create index implant_sites_assisting_delegate_id_idx on public.implant_sites (company_id, assisting_delegate_id);
create index implant_sites_course_id_idx on public.implant_sites (company_id, course_id);
create index implant_sites_placing_delegate_id_idx on public.implant_sites (company_id, placing_delegate_id);
create index implant_sites_product_id_idx on public.implant_sites (company_id, product_id);
create index implant_sites_session_id_idx on public.implant_sites (company_id, session_id);
create index implant_sites_slot_id_idx on public.implant_sites (company_id, slot_id);
create index implant_sites_stock_lot_id_idx on public.implant_sites (company_id, stock_lot_id);
create index implant_sites_supervisor_id_idx on public.implant_sites (company_id, supervisor_id);
create index restorations_course_id_idx on public.restorations (company_id, course_id);
create index restorations_delegate_id_idx on public.restorations (company_id, delegate_id);
create index restorations_supervisor_id_idx on public.restorations (company_id, supervisor_id);
create index saved_analyses_course_id_idx on public.saved_analyses (company_id, course_id);
create index sessions_course_id_idx on public.sessions (company_id, course_id);
create index sessions_lead_organizer_id_idx on public.sessions (lead_organizer_id);
create index site_components_fitted_by_delegate_id_idx on public.site_components (company_id, fitted_by_delegate_id);
create index site_components_fitted_by_organizer_id_idx on public.site_components (fitted_by_organizer_id);
create index site_components_product_id_idx on public.site_components (company_id, product_id);
create index site_components_stock_lot_id_idx on public.site_components (company_id, stock_lot_id);
create index slot_delegates_delegate_id_idx on public.slot_delegates (company_id, delegate_id);
create index slot_planned_implants_implant_site_id_idx on public.slot_planned_implants (company_id, implant_site_id);
create index slot_planned_implants_product_id_idx on public.slot_planned_implants (company_id, product_id);
create index stock_movements_implant_site_id_idx on public.stock_movements (company_id, implant_site_id);
create index stock_movements_reverses_movement_id_idx on public.stock_movements (company_id, reverses_movement_id);
create index stock_movements_site_component_id_idx on public.stock_movements (company_id, site_component_id);
create index surgery_slots_chair_id_idx on public.surgery_slots (company_id, chair_id);
create index surgery_slots_patient_id_idx on public.surgery_slots (company_id, patient_id);
create index surgery_slots_session_id_idx on public.surgery_slots (company_id, session_id);
create index surgery_slots_supervisor_id_idx on public.surgery_slots (company_id, supervisor_id);

create or replace function public.implant_visits(p_patient uuid)
returns table (site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_start date,
  window_end date, status text, followup_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.tooth::smallint, v.visit_key, v.label,
         s.placed_on + v.target_day, s.placed_on + v.window_start, s.placed_on + v.window_end,
         case
           when f.id is not null then
             case f.attendance when 'did_not_attend' then 'did_not_attend' when 'not_needed' then 'not_needed' else 'done' end
           when public.cairo_today() < s.placed_on + v.window_start then 'upcoming'
           when public.cairo_today() <= s.placed_on + v.target_day then 'due'
           when public.cairo_today() <= s.placed_on + v.window_end then 'overdue'
           else 'missed'
         end,
         f.id
  from public.implant_sites s
  cross join lateral public.visit_schedule(((public.cairo_today() - s.placed_on) + 60) / 365 + 1) v
  left join public.implant_followups f
    on f.site_id = s.id and f.visit_key = v.visit_key and f.voided_at is null
  -- No patient: every patient the caller can see (recall_list).
  where (p_patient is null or s.patient_id = p_patient)
    and s.placed_on is not null
    and (select public.can('patients', 'view'))
    -- A failed (or removed) implant expects nothing more; what was recorded still shows.
    and (s.state in ('placed', 'restored') or f.id is not null
         -- A failed implant keeps the visits whose window closed before it failed.
         or (s.failed_on is not null and s.placed_on + v.window_end < s.failed_on))
  order by s.tooth, s.placed_on + v.target_day;
$$;

create or replace function public.recall_list()
returns table (patient_id uuid, full_name text, phone text, site_id uuid, tooth smallint, visit_key text, label text,
  target_date date, window_end date, status text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.phone, v.site_id, v.tooth, v.visit_key, v.label, v.target_date, v.window_end, v.status
  from public.implant_visits(null) v
  join public.implant_sites s on s.id = v.site_id and s.state in ('placed', 'restored')
  join public.patients p on p.id = s.patient_id and not p.archived
  where v.status in ('due', 'overdue') or (v.status = 'missed' and v.window_end >= public.cairo_today() - 60)
  order by v.target_date, p.full_name, v.tooth;
$$;
