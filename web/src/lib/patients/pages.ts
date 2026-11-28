/** Patients list in pages (search_patients_v3 / search_patients_count_v2, 0147). */
export const PAGE_SIZE = 50;

/** The page asked for in the URL; anything but a whole number of 1 or more means page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  // At most 7 digits, so the row offset stays well inside Postgres's int range.
  if (!v || !/^[1-9]\d{0,6}$/.test(v)) return 1;
  return Number(v);
}

/** The last page for this many matches (1 when there are none). */
export function lastPage(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** The pages the pager links to: the first, the last and two either side of the current one, with '…'
 *  where pages are left out (a single left-out page is shown instead). */
export function pageList(current: number, last: number): (number | '…')[] {
  const shown = new Set([1, last]);
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= last) shown.add(p);
  const pages = [...shown].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (const p of pages) {
    const prev = out.length ? (out[out.length - 1] as number) : 0;
    if (prev && p - prev === 2) out.push(prev + 1);
    else if (prev && p - prev > 2) out.push('…');
    out.push(p);
  }
  return out;
}

export type ListFilters = { q: string; archived: string; stages: string[]; course: string; supervisor: string;
  /** is-not flags (0147): stage_not, course_not, supervisor_not */
  stagesNot: boolean; courseNot: boolean; supervisorNot: boolean;
};

/** The Patients list URL for a page, keeping every filter (stage repeated). */
export function pageHref(f: ListFilters, page: number): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.archived) sp.set('archived', f.archived);
  for (const s of f.stages) sp.append('stage', s);
  if (f.course) sp.set('course', f.course);
  if (f.supervisor) sp.set('supervisor', f.supervisor);
  if (f.stagesNot) sp.set('stage_not', '1');
  if (f.courseNot) sp.set('course_not', '1');
  if (f.supervisorNot) sp.set('supervisor_not', '1');
  if (page > 1) sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/patients?${qs}` : '/patients';
}

/** "Patients 51–100 of 312". */
export function pageSummary(page: number, total: number): string {
  const from = (page - 1) * PAGE_SIZE + 1;
  return `Patients ${from}–${Math.min(page * PAGE_SIZE, total)} of ${total}`;
}
