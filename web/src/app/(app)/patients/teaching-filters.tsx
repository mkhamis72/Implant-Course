/** The patient list's course and supervisor filters (0098); a clinic (no Teaching) has neither. */
export function TeachingFilters({ teachingOn, courses, supervisors, course, supervisor }: {
  teachingOn: boolean;
  courses: { id: string; name: string }[];
  supervisors: { id: string; label: string }[];
  course: string;
  supervisor: string;
}) {
  if (!teachingOn) return null;
  return (
    <>
      <label className="block w-full sm:w-48">
        <span className="label">Course</span>
        <select className="input" name="course" defaultValue={course}>
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="block w-full sm:w-48">
        <span className="label">Supervisor</span>
        <select className="input" name="supervisor" defaultValue={supervisor}>
          <option value="">All supervisors</option>
          {supervisors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
    </>
  );
}
