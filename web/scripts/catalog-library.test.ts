import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EMPTY_SPECS, diffLibrary, parseCatalogCsv, type LibraryRow } from './catalog-library';

const OXY = readFileSync(join(process.cwd(), '..', 'docs', 'catalog', 'oxy-catalog.csv'), 'utf8');
const HEADER = 'Type,Brand,System,Platform,Diameter (mm),Length (mm),Ref code,Description,Source,Check';

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  type: 'implant', brand: 'B', system: 'S', platform: 'P', diameter_mm: 4, length_mm: 10, ref_code: 'R1',
  description: '', source: 'p.1', ...EMPTY_SPECS, ...over,
});

describe('parseCatalogCsv', () => {
  it('parses the Oxy catalogue', () => {
    const rows = parseCatalogCsv(OXY);
    expect(rows).toHaveLength(OXY.split(/\r?\n/).filter((l) => l.trim()).length - 1);
    expect(rows[0]).toEqual({
      type: 'implant', brand: 'Oxy Implant', system: 'PSK-MDK · MDK Medium Narrow', platform: 'Mini conical',
      diameter_mm: 3, length_mm: 10, ref_code: 'OMKN30100', description: '', source: 'PSK-MDK p.11', ...EMPTY_SPECS,
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

  it('refuses a size that is not a positive number, with its row and column', () => {
    expect(() => parseCatalogCsv(`${HEADER}\nImplant,B,S,P,"4,5",10,R1,,,`)).toThrow('Row 2: Diameter (mm) is not a number: "4,5"');
    expect(() => parseCatalogCsv(`${HEADER}\nImplant,B,S,P,4,ten,R1,,,`)).toThrow('Row 2: Length (mm) is not a number: "ten"');
    expect(() => parseCatalogCsv(`${HEADER}\nImplant,B,S,P,4,-10,R1,,,`)).toThrow('Row 2: Length (mm) is not a number: "-10"');
    expect(parseCatalogCsv(`${HEADER}\nImplant,B,S,P, 4.5 ,10,R1,,,`)[0]).toMatchObject({ diameter_mm: 4.5, length_mm: 10 });
  });

  const SPEC_HEAD = `${HEADER},Connection,Gingival height (mm),Angle (°),Material,Driver interface,Driver size,Driver ref,Torque (Ncm)`;

  it('reads the optional Implant kind column, in any case; empty or missing is conventional', () => {
    const head = `${HEADER},Implant kind`;
    const kinds = parseCatalogCsv(`${head}\nImplant,B,S,P,4,50,R1,,p.1,,Zygomatic\nImplant,B,S,P,4,60,R2,,p.1,,pterygoid\nImplant,B,S,P,4,10,R3,,p.1,,\nImplant,B,S,P,4,10,R4,,p.1,,CONVENTIONAL`);
    expect(kinds.map((r) => r.implant_kind)).toEqual(['zygomatic', 'pterygoid', 'conventional', 'conventional']);
    expect(kinds[1].length_mm).toBe(60);
    expect(parseCatalogCsv(`${HEADER}\nImplant,B,S,P,4,10,R1,,p.1,`)[0].implant_kind).toBe('conventional');
  });

  it('refuses an unknown implant kind with its row', () => {
    expect(() => parseCatalogCsv(`${HEADER},Implant kind\nImplant,B,S,P,4,10,R1,,p.1,,Tilted`)).toThrow(
      'Row 2: Implant kind must be Conventional, Zygomatic or Pterygoid: "Tilted"',
    );
  });

  it('reads the optional trailing specification columns', () => {
    const rows = parseCatalogCsv(
      `${SPEC_HEAD}\nHealing abutment,B,S,P,,,R1,,p.1,,Internal hex,2.5,17,Titanium,Hex,1.25 mm,DRV1,25\nImplant,B,S,P,4,10,R2,,p.1,,,,,,,,,`,
    );
    expect(rows[0]).toMatchObject({ connection: 'Internal hex', gingival_height_mm: 2.5, angle_deg: 17, material: 'Titanium',
      driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'DRV1', torque_ncm: 25 });
    expect(rows[1]).toMatchObject({ ...EMPTY_SPECS });
  });

  it('finds specification columns by name, also in a file without the Check column', () => {
    const head = 'Type,Brand,System,Platform,Diameter (mm),Length (mm),Ref code,Description,Source,Torque (Ncm)';
    expect(parseCatalogCsv(`${head}\nImplant,B,S,P,4,10,R1,,p.1,35`)[0].torque_ncm).toBe(35);
  });

  it('accepts the old 9-column header', () => {
    const head = 'Type,Brand,System,Platform,Diameter (mm),Length (mm),Ref code,Description,Source';
    expect(parseCatalogCsv(`${head}\nImplant,B,S,P,4,10,R1,,p.1`)[0]).toMatchObject({ ref_code: 'R1', ...EMPTY_SPECS });
  });

  it('refuses a specification number that is not a number, with its row and column', () => {
    expect(() => parseCatalogCsv(`${SPEC_HEAD}\nImplant,B,S,P,4,10,R1,,p.1,,,,,,,,,abc`)).toThrow(
      'Row 2: Torque (Ncm) is not a number: "abc"',
    );
  });

  it('keeps 0 as a specification value and refuses one out of range, with its row', () => {
    expect(parseCatalogCsv(`${SPEC_HEAD}\nImplant,B,S,P,4,10,R1,,p.1,,,,0,,,,,`)[0].angle_deg).toBe(0);
    expect(() => parseCatalogCsv(`${SPEC_HEAD}\nImplant,B,S,P,4,10,R1,,p.1,,,,,,,,,200`)).toThrow(
      'Row 2: Torque (Ncm) must be between 0 and 150: "200"',
    );
    expect(() => parseCatalogCsv(`${SPEC_HEAD}\nImplant,B,S,P,4,10,R1,,p.1,,,,60,,,,,`)).toThrow(
      'Row 2: Angle (°) must be between 0 and 45: "60"',
    );
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

  it('updates specification changes', () => {
    expect(diffLibrary([existing()], [row({ torque_ncm: 25 })]).update).toEqual([{ id: 'i1', row: row({ torque_ncm: 25 }) }]);
  });

  it('retires rows of the same brand missing from the file, and leaves other brands', () => {
    const other = existing({ brand: 'Other' }, false, 'i2');
    expect(diffLibrary([existing(), other], [row({ ref_code: 'R2' })])).toEqual({
      add: [row({ ref_code: 'R2' })], update: [], retire: ['i1'],
    });
  });

  it('updates an item whose implant kind changed', () => {
    expect(diffLibrary([existing()], [row({ implant_kind: 'zygomatic' })]).update).toEqual([{ id: 'i1', row: row({ implant_kind: 'zygomatic' }) }]);
  });

  it('brings a retired row back', () => {
    expect(diffLibrary([existing({}, true)], [row()]).update).toEqual([{ id: 'i1', row: row() }]);
  });

  it('does not retire a row that is already retired', () => {
    expect(diffLibrary([existing({}, true)], [row({ ref_code: 'R2' })]).retire).toEqual([]);
  });
});
