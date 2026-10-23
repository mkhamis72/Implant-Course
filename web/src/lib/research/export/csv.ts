const BOM = '﻿';

/** One cell as text: null and undefined are empty, arrays join with ";", dates stay as the ISO text they arrive as. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(cellText).join(';');
  return String(v);
}

function quote(v: unknown): string {
  // Only text a spreadsheet would read as a formula gets a leading apostrophe; numbers (including negative ones) don't.
  const text = cellText(v);
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with a UTF-8 BOM, a header row and CRLF line ends. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map((c) => quote(c)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => quote(row[c])).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
