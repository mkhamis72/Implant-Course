/** Patients list: the course and supervisor filters (0098; search_patients_v3, 0147). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A course or supervisor id from the URL, or '' (= all) for anything that isn't one. */
export function idParam(value: string): string {
  const v = value.trim().toLowerCase();
  return UUID.test(v) ? v : '';
}

/** An is-not flag from the URL (stage_not, course_not, supervisor_not, 0147): true only for 1; a repeated value uses the first. */
export function parseNot(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === '1';
}

export type SupervisorRow = { id: string; full_name: string; active: boolean };

/** Active supervisors first, then inactive ones (past implants still name them), each group by name. */
export function supervisorChoices(rows: SupervisorRow[]): { id: string; label: string }[] {
  const byName = (a: SupervisorRow, b: SupervisorRow) => a.full_name.localeCompare(b.full_name);
  return [
    ...rows.filter((r) => r.active).sort(byName).map((r) => ({ id: r.id, label: r.full_name })),
    ...rows.filter((r) => !r.active).sort(byName).map((r) => ({ id: r.id, label: `${r.full_name} (inactive)` })),
  ];
}
