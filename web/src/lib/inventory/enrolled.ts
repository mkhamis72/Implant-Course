import type { Option } from './types';

export type Enrollment = { course_id: string; delegate_id: string };

/** The delegates who can be picked for a course: those enrolled in it, or everyone when no course is chosen. */
export function delegatesForCourse(delegates: Option[], enrollments: Enrollment[], courseId: string): Option[] {
  if (!courseId) return delegates;
  const enrolled = new Set(enrollments.filter((e) => e.course_id === courseId).map((e) => e.delegate_id));
  return delegates.filter((d) => enrolled.has(d.id));
}

/** The chosen delegate if they can stay on the newly chosen course, otherwise nobody. */
export function keepIfEnrolled(enrollments: Enrollment[], courseId: string, delegateId: string): string {
  if (!courseId || !delegateId) return delegateId;
  return enrollments.some((e) => e.course_id === courseId && e.delegate_id === delegateId) ? delegateId : '';
}

/** A delegate already on the record stays choosable, named for why they aren't in the list. */
export function withRecordedDelegate(list: Option[], active: Option[], id: string, name: string | null | undefined): Option[] {
  if (!id || list.some((o) => o.id === id)) return list;
  const known = active.find((o) => o.id === id);
  return [...list, { id, label: known ? `${known.label} (not enrolled)` : `${name ?? 'Unknown'} (inactive)` }];
}
