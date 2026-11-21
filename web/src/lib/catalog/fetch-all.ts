// PostgREST caps every response at max_rows (1000), silently (as src/lib/research/export/fetch-all.ts does for
// readers). The catalogue library grows with every catalogue loaded, so Admin → Catalogue pages through its tables.
type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Every row, reading `page(from, to)` until a short page comes back. The query must have a total order. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Page<T>>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < size) return out;
  }
}
