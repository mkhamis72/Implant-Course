/** Long lists show a first page; the rest is one "Show all" away. */
export function firstPage<T>(rows: readonly T[], showAll: boolean, size: number): { shown: T[]; hidden: number } {
  if (showAll || rows.length <= size) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, size), hidden: rows.length - size };
}

/** The current page's URL with its non-empty filters kept and every row requested. */
export function showAllHref(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== ''));
  q.set('rows', 'all');
  return `${path}?${q.toString()}`;
}
