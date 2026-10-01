type Cell = string | number | null | undefined;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Prevent spreadsheet formula execution (CSV injection).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for Excel: UTF-8 BOM (Arabic names display correctly), CRLF line endings. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
