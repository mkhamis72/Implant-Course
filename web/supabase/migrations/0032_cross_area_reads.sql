-- Panels show each other's data: the schedule needs courses, sessions, enrolled delegates and implant
-- techniques to show and book surgeries and talks; a patient's chart shows their bookings.
-- Reads only; writes still need the owning area (0030).

alter policy courses_area_read on public.courses
  using (public.can('courses', 'view') or public.can('schedule', 'view'));
alter policy sessions_area_read on public.sessions
  using (public.can('courses', 'view') or public.can('schedule', 'view'));
alter policy enrollments_area_read on public.enrollments
  using (public.can('courses', 'view') or public.can('schedule', 'view'));
alter policy implant_sites_area_read on public.implant_sites
  using (public.can('patients', 'view') or public.can('schedule', 'view'));
alter policy surgery_slots_area_read on public.surgery_slots
  using (public.can('schedule', 'view') or public.can('patients', 'view'));
alter policy slot_delegates_area_read on public.slot_delegates
  using (public.can('schedule', 'view') or public.can('patients', 'view'));
alter policy slot_planned_implants_area_read on public.slot_planned_implants
  using (public.can('schedule', 'view') or public.can('patients', 'view'));
