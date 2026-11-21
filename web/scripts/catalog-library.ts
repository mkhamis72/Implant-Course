// The catalogue library's CSV (docs/catalog/*.csv, the oxy-catalog.csv columns) and what loading it would change.
import { PRODUCT_TYPE_LABELS, type ProductType } from '../src/lib/inventory/types';

export type LibraryRow = {
  type: ProductType; brand: string; system: string; platform: string;
  diameter_mm: number | null; length_mm: number | null; ref_code: string; description: string; source: string;
};
export type ExistingItem = LibraryRow & { id: string; retired: boolean };
export type LibraryDiff = { add: LibraryRow[]; update: { id: string; row: LibraryRow }[]; retire: string[] };

const HEADER = ['Type', 'Brand', 'System', 'Platform', 'Diameter (mm)', 'Length (mm)', 'Ref code', 'Description', 'Source'];
const TYPE_BY_LABEL = new Map(Object.entries(PRODUCT_TYPE_LABELS).map(([type, label]) => [label, type as ProductType]));

/** RFC 4180 fields: quoted fields may hold commas, newlines and doubled quotes. */
function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) out.push(row);
  return out;
}

const size = (s: string | undefined) => (s === undefined || s.trim() === '' ? null : Number(s));

export function parseCatalogCsv(text: string): LibraryRow[] {
  const [header, ...rows] = records(text.replace(/^﻿/, ''));
  if (!header || HEADER.some((h, i) => header[i]?.trim() !== h)) {
    throw new Error(`The file needs the catalogue header: ${HEADER.join(',')},Check`);
  }
  return rows.map((f, i) => {
    const type = TYPE_BY_LABEL.get(f[0].trim());
    if (!type) throw new Error(`Row ${i + 2}: unknown type "${f[0].trim()}"`);
    return {
      type, brand: f[1].trim(), system: (f[2] ?? '').trim(), platform: (f[3] ?? '').trim(),
      diameter_mm: size(f[4]), length_mm: size(f[5]), ref_code: (f[6] ?? '').trim(),
      description: (f[7] ?? '').trim(), source: (f[8] ?? '').trim(),
    };
  });
}

/** The library's unique key (0128 catalog_items_key). */
const keyOf = (r: LibraryRow) => JSON.stringify([r.brand, r.ref_code, r.type, r.diameter_mm, r.length_mm]);
const sameDetails = (a: LibraryRow, b: LibraryRow) =>
  a.system === b.system && a.platform === b.platform && a.description === b.description && a.source === b.source;

/** Rows to add, items to update (changed details, or retired and back in the file), and the file's brands' items
 *  missing from it to retire. Other brands are left alone. */
export function diffLibrary(existing: ExistingItem[], incoming: LibraryRow[]): LibraryDiff {
  const byKey = new Map(existing.map((e) => [keyOf(e), e]));
  const seen = new Set<string>();
  const diff: LibraryDiff = { add: [], update: [], retire: [] };
  for (const row of incoming) {
    const key = keyOf(row);
    seen.add(key);
    const e = byKey.get(key);
    if (!e) diff.add.push(row);
    else if (e.retired || !sameDetails(e, row)) diff.update.push({ id: e.id, row });
  }
  const brands = new Set(incoming.map((r) => r.brand));
  for (const e of existing) {
    if (!e.retired && brands.has(e.brand) && !seen.has(keyOf(e))) diff.retire.push(e.id);
  }
  return diff;
}
