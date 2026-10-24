type Cell = string | number | null | undefined;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Prevent spreadsheet formula execution (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for Excel: UTF-8 BOM (Arabic names display correctly), CRLF line endings. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Download names: an ASCII-only fallback (HTTP headers reject non-Latin-1) and the full Unicode name. */
export function csvFilename(name: string, fallbackId: string): { ascii: string; utf8: string } {
  const unicode = name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const ascii = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    ascii: `implants-${ascii && ascii === unicode ? ascii : fallbackId}.csv`,
    utf8: `implants-${unicode || fallbackId}.csv`,
  };
}

export function contentDisposition(f: { ascii: string; utf8: string }): string {
  return `attachment; filename="${f.ascii}"; filename*=UTF-8''${encodeURIComponent(f.utf8)}`;
}
