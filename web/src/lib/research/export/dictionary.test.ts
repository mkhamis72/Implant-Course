import { describe, expect, it } from 'vitest';
import { DICTIONARY, MERGED_COLUMNS, TABLE_NAMES, assertAllowlisted, exportOrder, type ExportTables } from './dictionary';
import { READER_COLUMNS } from './reader-columns.fixture';

describe('exportOrder', () => {
  it('reads each file chronologically: its date column first, then every other column (a total order)', () => {
    const first = { implants: 'placed_on', visits: 'date', radiographs: 'taken_on', complications: 'noticed_on', restorations: 'fitted_on', restoration_problems: 'noticed_on', grafts: 'performed_on', patients: 'patient_code' };
    for (const t of TABLE_NAMES) {
      const order = exportOrder(t);
      expect(order[0], t).toBe(first[t]);
      // Merged columns come from another reader, so the table's own reader can't order by them.
      expect([...order].sort()).toEqual(Object.keys(DICTIONARY[t]).filter((c) => !(MERGED_COLUMNS[t] ?? []).includes(c)).sort());
    }
  });
});

describe('DICTIONARY', () => {
  it('covers exactly the eight tables', () => {
    expect([...TABLE_NAMES]).toEqual(Object.keys(READER_COLUMNS));
    expect(Object.keys(DICTIONARY)).toEqual(Object.keys(READER_COLUMNS));
  });

  it.each(Object.entries(READER_COLUMNS))('has an entry for every column of %s, and no extras', (table, cols) => {
    const d = DICTIONARY[table as keyof typeof DICTIONARY];
    expect(Object.keys(d)).toEqual([...cols, ...(MERGED_COLUMNS[table as keyof typeof DICTIONARY] ?? [])]);
    for (const c of cols) {
      expect(d[c].label.length).toBeGreaterThan(0);
      expect(d[c].source.length).toBeGreaterThan(0);
    }
  });

  it('gives coded columns their allowed values with labels', () => {
    for (const t of TABLE_NAMES) {
      for (const [col, e] of Object.entries(DICTIONARY[t])) {
        // brand and system are catalogue values, not a fixed list.
        if (e.kind === 'coded' && !/catalogue/i.test(e.notes ?? '')) expect(Object.keys(e.values ?? {}).length, `${t}.${col}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses units for measurements', () => {
    expect(DICTIONARY.implants.diameter_mm.unit).toBe('mm');
    expect(DICTIONARY.implants.torque_ncm.unit).toBe('Ncm');
    expect(DICTIONARY.implants.isq.unit).toBe('ISQ');
    expect(DICTIONARY.implants.follow_up_days.unit).toBe('days');
    expect(DICTIONARY.patients.age_at_first_placement.unit).toBe('years');
  });

  it('marks only latest_grade_reason as text-derived and lists its criteria', () => {
    const derived = TABLE_NAMES.flatMap((t) => Object.entries(DICTIONARY[t]).filter(([, e]) => e.kind === 'text-derived').map(([c]) => `${t}.${c}`));
    expect(derived).toEqual(['implants.latest_grade_reason']);
    expect(DICTIONARY.implants.latest_grade_reason.notes).toMatch(/no baseline X-ray/);
  });

  it('notes the outcome rule version on outcome columns', () => {
    for (const c of ['event', 'at_loading', 'year_1', 'latest_grade', 'follow_up_days']) {
      expect(DICTIONARY.implants[c].notes, c).toMatch(/outcomes-v1/);
    }
  });

  it('codes research_consent with exactly yes, no and not_recorded, merged into patients only', () => {
    const e = DICTIONARY.patients.research_consent;
    expect(e.kind).toBe('coded');
    expect(Object.keys(e.values ?? {})).toEqual(['yes', 'no', 'not_recorded']);
    expect(MERGED_COLUMNS).toEqual({ patients: ['research_consent'] });
  });

  it('never lists a file, bytes or form-text column', () => {
    for (const t of TABLE_NAMES) {
      for (const col of Object.keys(DICTIONARY[t])) expect(col, t).not.toMatch(/file|bytes|text_en|text_ar/);
    }
  });

  it('labels brand and system as catalogue values', () => {
    expect(DICTIONARY.implants.brand.notes).toMatch(/catalogue/i);
    expect(DICTIONARY.implants.system.notes).toMatch(/catalogue/i);
  });
});

describe('assertAllowlisted', () => {
  const ok = (): ExportTables => ({
    implants: [{ implant_code: 'I-ABC234' }], patients: [], visits: [], radiographs: [], complications: [],
    restorations: [], restoration_problems: [], grafts: [],
  });

  it('passes known columns, including tables with no rows', () => {
    expect(() => assertAllowlisted(ok())).not.toThrow();
  });

  it('throws on a column that is not in the dictionary', () => {
    const t = ok();
    t.visits = [{ implant_code: 'I-ABC234', notes: 'free text' }];
    expect(() => assertAllowlisted(t)).toThrow(/visits\.notes/);
  });

  it('checks every row, not just the first', () => {
    const t = ok();
    t.grafts = [{ procedure: 'gbr' }, { procedure: 'gbr', notes: 'x' }];
    expect(() => assertAllowlisted(t)).toThrow(/grafts\.notes/);
  });
});
