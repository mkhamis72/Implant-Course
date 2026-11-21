import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { diffLibrary, parseCatalogCsv, type LibraryRow } from './catalog-library';

const OXY = readFileSync(join(process.cwd(), '..', 'docs', 'catalog', 'oxy-catalog.csv'), 'utf8');
const HEADER = 'Type,Brand,System,Platform,Diameter (mm),Length (mm),Ref code,Description,Source,Check';

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  type: 'implant', brand: 'B', system: 'S', platform: 'P', diameter_mm: 4, length_mm: 10, ref_code: 'R1',
  description: '', source: 'p.1', ...over,
});

describe('parseCatalogCsv', () => {
  it('parses the Oxy catalogue', () => {
    const rows = parseCatalogCsv(OXY);
    expect(rows).toHaveLength(OXY.split(/\r?\n/).filter((l) => l.trim()).length - 1);
    expect(rows[0]).toEqual({
      type: 'implant', brand: 'Oxy Implant', system: 'PSK-MDK · MDK Medium Narrow', platform: 'Mini conical',
      diameter_mm: 3, length_mm: 10, ref_code: 'OMKN30100', description: '', source: 'PSK-MDK p.11',
    });
  });

  it('reads quoted fields and empty sizes', () => {
    const rows = parseCatalogCsv(`${HEADER}\nHealing abutment,B,"S, wide",P,,,R9,"Say ""hi""",p.2,`);
    expect(rows[0]).toMatchObject({ type: 'healing_abutment', system: 'S, wide', diameter_mm: null, length_mm: null,
      description: 'Say "hi"' });
  });

  it('refuses an unknown type with its row number', () => {
    expect(() => parseCatalogCsv(`${HEADER}\nImplant,B,S,P,4,10,R1,,,\nWidget,B,S,P,,,R2,,,`)).toThrow('Row 3: unknown type "Widget"');
  });

  it('refuses a file without the catalogue header', () => {
    expect(() => parseCatalogCsv('a,b\n1,2')).toThrow(/header/);
  });
});

describe('diffLibrary', () => {
  const existing = (over: Partial<LibraryRow> = {}, retired = false, id = 'i1') => ({ ...row(over), id, retired });

  it('adds new rows', () => {
    expect(diffLibrary([], [row()])).toEqual({ add: [row()], update: [], retire: [] });
  });

  it('changes nothing for the same rows', () => {
    expect(diffLibrary([existing()], [row()])).toEqual({ add: [], update: [], retire: [] });
  });

  it('updates descriptive fields', () => {
    expect(diffLibrary([existing()], [row({ description: 'new' })]).update).toEqual([{ id: 'i1', row: row({ description: 'new' }) }]);
  });

  it('retires rows of the same brand missing from the file, and leaves other brands', () => {
    const other = existing({ brand: 'Other' }, false, 'i2');
    expect(diffLibrary([existing(), other], [row({ ref_code: 'R2' })])).toEqual({
      add: [row({ ref_code: 'R2' })], update: [], retire: ['i1'],
    });
  });

  it('brings a retired row back', () => {
    expect(diffLibrary([existing({}, true)], [row()]).update).toEqual([{ id: 'i1', row: row() }]);
  });

  it('does not retire a row that is already retired', () => {
    expect(diffLibrary([existing({}, true)], [row({ ref_code: 'R2' })]).retire).toEqual([]);
  });
});
