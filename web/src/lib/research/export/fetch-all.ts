// PostgREST caps every response at max_rows (1000), silently. These readers are set-returning functions, so order and
// range work on the rpc; page until a short page comes back.
export const PAGE_SIZE = 1000;

type Page = { data: unknown[] | null; error: { message: string } | null };
type Paged = PromiseLike<Page> & { order(column: string): Paged; range(from: number, to: number): Paged };
type Rpc = { rpc(fn: string, args?: Record<string, unknown>): unknown };

/** Every row of a reader, in a deterministic order. `orderBy` must be a total order (for rows that tie on all of it, identical rows are interchangeable). */
export async function fetchAll<T = Record<string, unknown>>(
  supabase: unknown,
  fn: string,
  args: Record<string, unknown>,
  orderBy: string[],
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = (supabase as Rpc).rpc(fn, args) as Paged;
    for (const c of orderBy) q = q.order(c);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) return { data: out, error: null };
  }
}
