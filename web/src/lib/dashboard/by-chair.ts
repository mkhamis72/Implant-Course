export type ChairGroup<T> = { chair: string; slots: T[] };

/** Today's surgeries grouped by chair (chairs by name, unknown chairs last), each chair's surgeries by start time. */
export function groupByChair<T extends { starts_at: string; chair: { name: string } | null }>(slots: readonly T[]): ChairGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const s of [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const key = s.chair?.name ?? '';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    .map(([chair, list]) => ({ chair: chair || 'Chair', slots: list }));
}
