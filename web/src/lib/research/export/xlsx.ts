import ExcelJS from 'exceljs';
import { DICTIONARY, TABLE_NAMES, assertAllowlisted, type ExportTables } from './dictionary';
import { DICTIONARY_COLUMNS, aboutLines, dictionaryRows, type ExportMeta } from './assemble';

function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(';');
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function sheet(wb: ExcelJS.Workbook, name: string, columns: string[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 2) }));
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c, cellValue(r[c])])));
  ws.getRow(1).font = { bold: true };
  return ws;
}

/** One sheet per table (dictionary column order), then data_dictionary and about. Throws on a column outside the dictionary. */
export async function buildXlsx(tables: ExportTables, meta: ExportMeta): Promise<Uint8Array> {
  assertAllowlisted(tables);
  const wb = new ExcelJS.Workbook();
  for (const t of TABLE_NAMES) sheet(wb, t, Object.keys(DICTIONARY[t]), tables[t]);
  sheet(wb, 'data_dictionary', DICTIONARY_COLUMNS, dictionaryRows());
  const about = wb.addWorksheet('about', { views: [{ state: 'frozen', ySplit: 1 }] });
  about.columns = [{ header: 'item', key: 'k', width: 24 }, { header: 'value', key: 'v', width: 110 }];
  about.getRow(1).font = { bold: true };
  for (const [k, v] of aboutLines(meta)) about.addRow({ k, v });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
