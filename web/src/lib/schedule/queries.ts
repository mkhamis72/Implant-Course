export const SLOT_SELECT = `
  id, starts_at, ends_at, status, override_reason, cancel_reason, chair_id, notes, supervisor_id, session_id, placing_doctor_id, setting,
  chair:chairs(name),
  patient:patients(id, full_name, file_no),
  supervisor:supervisors!surgery_slots_supervisor_ref_fkey(full_name),
  doctor:doctors!surgery_slots_placing_doctor_id_fkey(name),
  session:sessions(title, course:courses(name)),
  delegates:slot_delegates(role, delegate:delegates(full_name)),
  implants:slot_planned_implants(tooth, product:products(*), site:implant_sites(id, technique)),
  spares:slot_spare_implants(tooth, position, product:products(*)),
  checklists(id, items:checklist_items(done_at))
`;
