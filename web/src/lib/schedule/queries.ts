export const SLOT_SELECT = `
  id, starts_at, ends_at, status, override_reason, cancel_reason, chair_id, notes, supervisor_id, session_id,
  chair:chairs(name),
  patient:patients(id, full_name, file_no),
  supervisor:supervisors!surgery_slots_supervisor_ref_fkey(full_name),
  session:sessions(title, course:courses(name)),
  delegates:slot_delegates(role, delegate:delegates(full_name)),
  implants:slot_planned_implants(tooth, product:products(*), site:implant_sites(id, technique)),
  checklists(id, items:checklist_items(done_at))
`;
