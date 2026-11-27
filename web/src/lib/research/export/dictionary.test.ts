import { describe, expect, it } from 'vitest';
import {
  DERIVED_COLUMNS, DICTIONARY, DROPPED_COLUMNS, MERGED_COLUMNS, TABLE_NAMES, TEACHING_COLUMNS, assertAllowlisted, exportOrder,
  mergeColumns, readerColumns, type ExportTables, type TableName,
} from './dictionary';
import { MERGE_READER_COLUMNS, READER_COLUMNS } from './reader-columns.fixture';

/** Columns a table gets from somewhere other than its own reader. */
const added = (t: TableName) => [...(MERGED_COLUMNS[t] ?? []), ...(DERIVED_COLUMNS[t] ?? [])];

describe('exportOrder', () => {
  it('reads each file chronologically: its date column first, then every other column (a total order)', () => {
    const first = { implants: 'placed_on', visits: 'date', radiographs: 'taken_on', complications: 'noticed_on', restorations: 'fitted_on', restoration_problems: 'noticed_on', grafts: 'performed_on', patients: 'patient_code', full_arch_cases: 'first_placed_on' };
    for (const t of TABLE_NAMES) {
      const order = exportOrder(t);
      expect(order[0], t).toBe(first[t]);
      // Merged and derived columns don't come from the table's own reader, so it can't order by them.
      expect([...order].sort()).toEqual(Object.keys(DICTIONARY[t]).filter((c) => !added(t).includes(c)).sort());
    }
  });
});

describe('DICTIONARY', () => {
  it('covers exactly the nine tables', () => {
    expect([...TABLE_NAMES]).toEqual(Object.keys(READER_COLUMNS));
    expect(Object.keys(DICTIONARY)).toEqual(Object.keys(READER_COLUMNS));
  });

  it.each(Object.entries(READER_COLUMNS))('has an entry for every column of %s, and no extras', (table, cols) => {
    const t = table as TableName;
    const d = DICTIONARY[t];
    const kept = cols.filter((c) => !(DROPPED_COLUMNS[t] ?? []).includes(c));
    // Reader columns in reader order; merged and derived ones may sit between them.
    expect(Object.keys(d).filter((c) => !added(t).includes(c))).toEqual(kept);
    expect(readerColumns(t)).toEqual(kept);
    expect(Object.keys(d).sort()).toEqual([...kept, ...added(t)].sort());
    for (const c of Object.keys(d)) {
      expect(d[c].label.length).toBeGreaterThan(0);
      expect(d[c].source.length).toBeGreaterThan(0);
    }
  });

  it('merges the implant type, geometry and case columns into implants, after the reader columns', () => {
    expect(MERGED_COLUMNS.implants).toEqual(MERGE_READER_COLUMNS.implant_rehab.filter((c) => c !== 'implant_code'));
    expect(Object.keys(DICTIONARY.implants).slice(-6)).toEqual(MERGED_COLUMNS.implants);
    expect(DICTIONARY.implants.case_code.notes).toMatch(/Prefix A-/);
    expect(DICTIONARY.implants.angulation_deg.unit).toBe('°');
  });

  it('lists full_arch_cases in order, its status and final bridge date derived, sites and bridges dropped', () => {
    expect(Object.keys(DICTIONARY.full_arch_cases)).toEqual([
      'case_code', 'patient_code', 'arch', 'configuration', 'status', 'first_placed_on', 'final_bridge_on', 'closed_on',
      'scan_on', 'lab_design_on', 'try_in_on', 'implants_placed', 'implants_failed', 'bridge_problems',
    ]);
    expect(DERIVED_COLUMNS).toEqual({ full_arch_cases: ['status', 'final_bridge_on'] });
    expect(DROPPED_COLUMNS).toEqual({ full_arch_cases: ['sites', 'bridges'] });
    for (const t of TABLE_NAMES) for (const c of ['sites', 'bridges']) expect(Object.hasOwn(DICTIONARY[t], c), `${t}.${c}`).toBe(false);
    expect(DICTIONARY.full_arch_cases.case_code.notes).toMatch(/Prefix A-/);
    expect(TEACHING_COLUMNS.full_arch_cases).toBeUndefined();
  });

  it('lists the coded values of the new columns', () => {
    const values = (t: TableName, c: string) => Object.keys(DICTIONARY[t][c].values ?? {});
    expect(values('implants', 'implant_type')).toEqual(['conventional', 'tilted', 'zygomatic', 'pterygoid']);
    expect(values('implants', 'angulation_direction')).toEqual(['mesial', 'distal', 'buccal', 'palatal_lingual']);
    expect(values('implants', 'anchorage')).toEqual(['zygoma', 'pterygoid_plate', 'tuberosity', 'other']);
    expect(values('implants', 'case_configuration')).toEqual(['all_on_4', 'all_on_6', 'all_on_x', 'other']);
    expect(values('full_arch_cases', 'arch')).toEqual(['upper', 'lower']);
    expect(values('full_arch_cases', 'configuration')).toEqual(['all_on_4', 'all_on_6', 'all_on_x', 'other']);
    expect(values('full_arch_cases', 'status')).toEqual(['planned', 'in_treatment', 'completed', 'closed']);
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
    expect(MERGED_COLUMNS.patients).toEqual(['research_consent']);
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
    restorations: [], restoration_problems: [], grafts: [], full_arch_cases: [],
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

  it('refuses the raw sites and bridges of a full-arch case', () => {
    const t = ok();
    t.full_arch_cases = [{ case_code: 'A-ABC234', sites: [] }];
    expect(() => assertAllowlisted(t)).toThrow(/full_arch_cases\.sites/);
  });
});

describe('mergeColumns', () => {
  it('adds the named columns by key, null when the other reader has no row', () => {
    const rows = [{ implant_code: 'I-A', tooth: 11 }, { implant_code: 'I-B', tooth: 12 }];
    const extra = [{ implant_code: 'I-A', implant_type: 'zygomatic', anchorage: 'zygoma', ignored: 'x' }];
    expect(mergeColumns(rows, extra, 'implant_code', ['implant_type', 'anchorage'])).toEqual([
      { implant_code: 'I-A', tooth: 11, implant_type: 'zygomatic', anchorage: 'zygoma' },
      { implant_code: 'I-B', tooth: 12, implant_type: null, anchorage: null },
    ]);
  });
});
