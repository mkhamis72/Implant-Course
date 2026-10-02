export const SLOT_SELECT = `
  id, starts_at, ends_at, status, override_reason, cancel_reason, chair_id,
  chair:chairs(name),
  patient:patients(id, full_name, file_no),
  supervisor:profiles!surgery_slots_supervisor_id_fkey(full_name, email),
  session:sessions(title, course:courses(name)),
  delegates:slot_delegates(role, delegate:delegates(full_name)),
  implants:slot_planned_implants(tooth, product:products(*)),
  checklists(id, items:checklist_items(done_at))
`;
