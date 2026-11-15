/** Pure helpers for adding a company from the console (multi-tenant part 5). */

/** A slug suggested from the company name: "OSDIC Dental Centre" → "osdic-dental-centre" (2–40 of a-z 0-9 -). */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Companies get addresses under the console's parent domain: console.imploid.net → imploid.net. */
export function baseDomain(consoleHost: string | null): string | null {
  if (!consoleHost) return null;
  const dot = consoleHost.indexOf('.');
  return dot > 0 ? consoleHost.slice(dot + 1) : null;
}
