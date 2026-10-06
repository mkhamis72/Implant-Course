-- audit_log holds before/after rows of every audited table, but its area policy (0034) only asked for
-- Patients view: a Patients user could read stock, courses, checklists and permission changes through it.
-- Patients view now covers the patient records the History tab and stale-edit messages read; admins read all.
drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups'))
  );
