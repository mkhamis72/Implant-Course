/** A query parameter repeated in the URL (?q=a&q=b) arrives as an array; pages use the first value. */
export function firstParam(value: string | string[] | undefined, fallback = ''): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? fallback;
}

export type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Reads the named parameters as single strings ('' when absent). */
export async function readParams<K extends string>(searchParams: PageSearchParams, ...keys: K[]): Promise<Record<K, string>> {
  const sp = await searchParams;
  return Object.fromEntries(keys.map((k) => [k, firstParam(sp[k])])) as Record<K, string>;
}
