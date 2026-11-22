// The catalogue library's CSV (docs/catalog/*.csv, the oxy-catalog.csv columns) and what loading it would change.
import { PRODUCT_TYPE_LABELS, type ProductType } from '../src/lib/inventory/types';

/** The specification columns (0133): optional trailing columns of the file, found by their header name. */
export type Specs = {
  connection: string; gingival_height_mm: number | null; angle_deg: number | null; material: string;
  driver_interface: string; driver_size: string; driver_ref: string; torque_ncm: number | null;
};
export const EMPTY_SPECS: Specs = {
  connection: '', gingival_height_mm: null, angle_deg: null, material: '',
  driver_interface: '', driver_size: '', driver_ref: '', torque_ncm: null,
};
export const SPEC_COLUMNS = ['connection', 'gingival_height_mm', 'angle_deg', 'material', 'driver_interface', 'driver_size',
  'driver_ref', 'torque_ncm'] as const satisfies readonly (keyof Specs)[];
const SPEC_HEADERS: Record<keyof Specs, string> = {
  connection: 'Connection', gingival_height_mm: 'Gingival height (mm)', angle_deg: 'Angle (°)', material: 'Material',
  driver_interface: 'Driver interface', driver_size: 'Driver size', driver_ref: 'Driver ref', torque_ncm: 'Torque (Ncm)',
};

export type LibraryRow = {
  type: ProductType; brand: string; system: string; platform: string;
  diameter_mm: number | null; length_mm: number | null; ref_code: string; description: string; source: string;
} & Specs;
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

/** An empty size is null; anything else must be a positive number (a decimal point, not a comma). */
function size(s: string | undefined, row: number, column: string): number | null {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Row ${row}: ${column} is not a number: "${s.trim()}"`);
  return n;
}

/** A specification number: empty is null, 0 is allowed, and it must lie within the database bounds. */
function specNumber(s: string | undefined, row: number, column: string, max: number): number | null {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s.trim());
  if (!Number.isFinite(n)) throw new Error(`Row ${row}: ${column} is not a number: "${s.trim()}"`);
  if (n < 0 || n > max) throw new Error(`Row ${row}: ${column} must be between 0 and ${max}: "${s.trim()}"`);
  return n;
}

export function parseCatalogCsv(text: string): LibraryRow[] {
  const [header, ...rows] = records(text.replace(/^﻿/, ''));
  if (!header || HEADER.some((h, i) => header[i]?.trim() !== h)) {
    throw new Error(`The file needs the catalogue header: ${HEADER.join(',')},Check`);
  }
  const col = Object.fromEntries(SPEC_COLUMNS.map((k) => [k, header.findIndex((h) => h.trim() === SPEC_HEADERS[k])])) as Record<keyof Specs, number>;
  return rows.map((f, i) => {
    const type = TYPE_BY_LABEL.get(f[0].trim());
    if (!type) throw new Error(`Row ${i + 2}: unknown type "${f[0].trim()}"`);
    const str = (key: keyof Specs) => (col[key] < 0 ? '' : (f[col[key]] ?? '').trim());
    const num = (key: keyof Specs, max: number) => (col[key] < 0 ? null : specNumber(f[col[key]], i + 2, SPEC_HEADERS[key], max));
    return {
      type, brand: f[1].trim(), system: (f[2] ?? '').trim(), platform: (f[3] ?? '').trim(),
      diameter_mm: size(f[4], i + 2, 'Diameter (mm)'), length_mm: size(f[5], i + 2, 'Length (mm)'), ref_code: (f[6] ?? '').trim(),
      description: (f[7] ?? '').trim(), source: (f[8] ?? '').trim(),
      connection: str('connection'), gingival_height_mm: num('gingival_height_mm', 10), angle_deg: num('angle_deg', 45),
      material: str('material'), driver_interface: str('driver_interface'), driver_size: str('driver_size'),
      driver_ref: str('driver_ref'), torque_ncm: num('torque_ncm', 150),
    };
  });
}

/** The library's unique key (0128 catalog_items_key). */
const keyOf = (r: LibraryRow) => JSON.stringify([r.brand, r.ref_code, r.type, r.diameter_mm, r.length_mm]);
const sameDetails = (a: LibraryRow, b: LibraryRow) =>
  a.system === b.system && a.platform === b.platform && a.description === b.description && a.source === b.source &&
  SPEC_COLUMNS.every((k) => a[k] === b[k]);

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
