/** A server error the app recorded in public.error_log (0107; masked before it was written). */
export type ErrorEntry = { at: string; message: string; path: string | null };
export type ErrorGroup = { message: string; count: number; first: string; last: string };

/** Equal messages grouped, with how often and when each was first and last seen; the most recent kind first. */
export function groupErrors(rows: ErrorEntry[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const g = groups.get(r.message);
    if (!g) {
      groups.set(r.message, { message: r.message, count: 1, first: r.at, last: r.at });
      continue;
    }
    g.count += 1;
    if (r.at < g.first) g.first = r.at;
    if (r.at > g.last) g.last = r.at;
  }
  return [...groups.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}
