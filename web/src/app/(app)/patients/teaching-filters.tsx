import { NotSelect } from './filter-menu';

/** The patient list's course and supervisor filters (0098), each with an is / is not switch (0147); a clinic (no Teaching) has neither. */
export function TeachingFilters({ teachingOn, courses, supervisors, course, supervisor, courseNot = false, supervisorNot = false }: {
  teachingOn: boolean;
  courses: { id: string; name: string }[];
  supervisors: { id: string; label: string }[];
  course: string;
  supervisor: string;
  courseNot?: boolean;
  supervisorNot?: boolean;
}) {
  if (!teachingOn) return null;
  return (
    <>
      <div className="flex items-end gap-1">
        <NotSelect name="course_not" label="Course filter mode" value={courseNot} />
        <label className="block w-full sm:w-44">
          <span className="label">Course</span>
          <select className="input" name="course" defaultValue={course}>
            <option value="">All courses</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-1">
        <NotSelect name="supervisor_not" label="Supervisor filter mode" value={supervisorNot} />
        <label className="block w-full sm:w-44">
          <span className="label">Supervisor</span>
          <select className="input" name="supervisor" defaultValue={supervisor}>
            <option value="">All supervisors</option>
            {supervisors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}
