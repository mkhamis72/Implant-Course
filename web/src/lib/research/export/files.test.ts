// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { toCsv } from './csv';
import { buildXlsx } from './xlsx';
import { buildZip } from './zip';
import { CONFIDENTIALITY_NOTE, exportFileName, type ExportMeta } from './assemble';
import { TABLE_NAMES, type ExportTables } from './dictionary';

const BOM = '﻿';

describe('toCsv', () => {
  it('starts with a BOM and a header row', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['a', 'b']).startsWith(BOM + 'a,b\r\n1,2')).toBe(true);
  });
  it('quotes commas, doubles quotes and quotes newlines', () => {
    const out = toCsv([{ a: 'a,b', b: 'a"b', c: 'x\ny' }], ['a', 'b', 'c']);
    expect(out).toContain('"a,b","a""b","x\ny"');
  });
  it('writes null and undefined as empty', () => {
    expect(toCsv([{ a: null, b: undefined, c: 0, d: false }], ['a', 'b', 'c', 'd'])).toContain('\r\n,,0,false');
  });
  it('keeps Arabic text', () => {
    expect(toCsv([{ a: 'زرعة' }], ['a'])).toContain('زرعة');
  });
  it('joins arrays with semicolons and writes dates as given', () => {
    expect(toCsv([{ a: ['I-AAA222', 'I-BBB333'], b: '2026-10-23' }], ['a', 'b'])).toContain('I-AAA222;I-BBB333,2026-10-23');
  });
  it('writes only the header for no rows', () => {
    expect(toCsv([], ['a'])).toBe(BOM + 'a\r\n');
  });
});

const tables = (): ExportTables => {
  const t = Object.fromEntries(TABLE_NAMES.map((n) => [n, []])) as unknown as ExportTables;
  t.implants = [{ implant_code: 'I-ABC234', patient_code: 'P-ABC234', tooth: 36, placed_on: '2026-01-05', event: false }];
  t.grafts = [{ implant_code: 'I-ABC234', patient_code: 'P-ABC234', procedure: 'gbr' }];
  return t;
};
const meta = (): ExportMeta => ({
  exportedAt: '2026-10-23T10:00:00Z', filters: { course: null, brand: 'Oxy' }, version: 'outcomes-v1',
  rowCounts: Object.fromEntries(TABLE_NAMES.map((n) => [n, n === 'implants' || n === 'grafts' ? 1 : 0])) as ExportMeta['rowCounts'],
});

describe('buildXlsx', () => {
  it('has the table sheets, data_dictionary and about, with a bold frozen header', async () => {
    const buf = await buildXlsx(tables(), meta());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([...TABLE_NAMES, 'data_dictionary', 'about']);
    const ws = wb.getWorksheet('implants')!;
    expect(ws.getRow(1).getCell(1).value).toBe('implant_code');
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getRow(2).getCell(4).value).toBe(36);
    const about: string[] = [];
    wb.getWorksheet('about')!.eachRow((r) => about.push((r.values as unknown[]).slice(1).join(' ')));
    const text = about.join('\n');
    expect(text).toContain(CONFIDENTIALITY_NOTE);
    expect(text).toContain('outcomes-v1');
    expect(text).toMatch(/brand\s*:?\s*Oxy/);
  });
  it('refuses a column outside the dictionary', async () => {
    const t = tables();
    t.visits = [{ notes: 'x' }];
    await expect(buildXlsx(t, meta())).rejects.toThrow(/visits\.notes/);
  });
});

describe('buildZip', () => {
  it('holds one CSV per table, the dictionary and a README', () => {
    const files = unzipSync(buildZip(tables(), meta()));
    expect(Object.keys(files).sort()).toEqual(
      [...TABLE_NAMES.map((n) => `${n}.csv`), 'data_dictionary.csv', 'README.txt'].sort(),
    );
    expect(strFromU8(files['README.txt'])).toContain(CONFIDENTIALITY_NOTE);
    expect([...files['implants.csv'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // strFromU8 would strip the BOM
    expect(strFromU8(files['implants.csv'])).toContain('I-ABC234');
    expect(strFromU8(files['data_dictionary.csv'])).toContain('latest_grade_reason');
  });
  it('refuses a column outside the dictionary', () => {
    const t = tables();
    t.visits = [{ notes: 'x' }];
    expect(() => buildZip(t, meta())).toThrow(/visits\.notes/);
  });
});

describe('exportFileName', () => {
  it('names files by Cairo date', () => {
    expect(exportFileName('xlsx', '2026-10-23')).toBe('research-export-2026-10-23.xlsx');
    expect(exportFileName('csv', '2026-10-23')).toBe('research-export-2026-10-23.zip');
  });
});
