// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { analysisScript } from './analysis';
import { buildZip } from './zip';
import { DICTIONARY, TABLE_NAMES, type ExportTables } from './dictionary';
import { LOADING_EARLY_MONTHS, LOADING_IMMEDIATE_DAYS } from '@/lib/restorations/restorations';
import { THIN_AT_RISK, THIN_EVENTS, THIN_GROUP } from '@/lib/research/stats';

const script = analysisScript();
// The script works on implants.csv merged with patients.csv.
const EXPORTED = new Set([...Object.keys(DICTIONARY.implants), ...Object.keys(DICTIONARY.patients)]);
const all = (re: RegExp) => [...script.matchAll(re)];
const tokens = (s: string) => s.match(/\b[a-z_]+\b/g) ?? [];
const constant = (name: string) => Number(script.match(new RegExp(`^${name} <- (\\d+)`, 'm'))?.[1]);

const derived = (() => {
  const m = script.match(/^DERIVED <- c\(([^)]*)\)/m);
  return new Set(m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : []);
})();
const allowed = (t: string) => EXPORTED.has(t) || derived.has(t);

describe('analysis.R', () => {
  it('declares its derived columns, none of which shadows an exported column', () => {
    expect(derived.size).toBeGreaterThan(0);
    for (const d of derived) expect(EXPORTED.has(d), d).toBe(false);
  });

  it('uses only exported (or declared derived) columns on its data frames', () => {
    const used = all(/\b(?:implants|patients|km|d|tested)\$([A-Za-z_.]+)/g).map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const c of used) expect(allowed(c), `$${c}`).toBe(true);
  });

  it('uses only exported (or derived) columns in Surv(), strata(), cluster and the model variable lists', () => {
    const inSurv = all(/Surv\(([^)]*)\)/g).flatMap((m) => tokens(m[1]));
    expect(inSurv).toContain('follow_up_days');
    expect(inSurv).toContain('event');
    const inStrata = all(/strata\(([^)]*)\)/g).flatMap((m) => tokens(m[1]));
    expect(inStrata).toEqual(expect.arrayContaining(['course_code']));
    const cluster = all(/cluster = ([a-z_]+)/g).map((m) => m[1]);
    expect([...new Set(cluster)]).toEqual(['patient_code']);
    const formulas = all(/~ ?([a-z_ +]+)/g).flatMap((m) => tokens(m[1]));
    const lists = ['GROUP_VARS', 'COX_VARS', 'ADJUST'].flatMap((name) => {
      const m = script.match(new RegExp(`^${name} <- ([\\s\\S]*?)\\n\\S`, 'm'));
      expect(m, name).not.toBeNull();
      // names of c(name = "Label") and quoted strings
      return [...m![1].matchAll(/(?:^|[(,\s])([a-z_]+) =|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2])
        .concat(name === 'ADJUST' ? tokens(m![1].replace(/strata\(/g, '(')) : []);
    });
    expect(lists).toEqual(expect.arrayContaining(['technique', 'bone_type', 'smoking', 'diabetes_status', 'periodontitis_history', 'placing_delegate_code']));
    for (const c of [...inSurv, ...inStrata, ...cluster, ...formulas, ...lists]) expect(allowed(c), c).toBe(true);
  });

  it('uses only exported (or derived) columns where it names them as strings: row filters and the merge key', () => {
    const lines = script.split(/\r?\n/).filter((l) => /complete\.cases\(|merge\(/.test(l));
    expect(lines).toHaveLength(2);
    const named = lines.flatMap((l) => [...l.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    expect(named).toEqual(expect.arrayContaining(['patient_code', 'follow_up_days', 'placing_delegate_code']));
    for (const c of named) expect(allowed(c), c).toBe(true);
  });

  it('tabulates the ICOI grade distribution overall and per group', () => {
    expect(script).toContain('d$latest_grade');
    expect(script).toContain('table(grade_of(implants))');
    expect(script).toContain('table(d$group, grade_of(d)');
  });

  it('states the app loading thresholds and thin-data limits', () => {
    expect(constant('LOADING_IMMEDIATE_DAYS')).toBe(LOADING_IMMEDIATE_DAYS);
    expect(constant('LOADING_EARLY_MONTHS')).toBe(LOADING_EARLY_MONTHS);
    expect(constant('THIN_AT_RISK')).toBe(THIN_AT_RISK);
    expect(constant('THIN_EVENTS')).toBe(THIN_EVENTS);
    expect(constant('THIN_GROUP')).toBe(THIN_GROUP);
  });

  it('reads the BOM CSVs, uses base R plus survival only, and fits the clustered Cox model', () => {
    expect(script).toContain('fileEncoding = "UTF-8-BOM"');
    expect(all(/\b(?:library|require|requireNamespace)\(([^)]*)\)/g).map((m) => m[1])).toEqual(['survival']);
    expect(script).not.toMatch(/\b[a-zA-Z.]+::/);
    expect(script).toContain('conf.type = "log-log"');
    expect(script).toContain('survdiff(');
    expect(script).toContain('coxph(');
    expect(script).toMatch(/Not assessed/);
  });

  it('is plain ASCII, so it sources the same on any locale', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(script)).toBe(true);
  });
});

describe('buildZip', () => {
  it('ships analysis.R with the CSVs', () => {
    const tables = Object.fromEntries(TABLE_NAMES.map((t) => [t, []])) as unknown as ExportTables;
    const meta = { exportedAt: '2026-10-23T10:00:00Z', filters: {}, version: 'outcomes-v1', rowCounts: Object.fromEntries(TABLE_NAMES.map((t) => [t, 0])) } as never;
    const files = unzipSync(buildZip(tables, meta));
    expect(Object.keys(files)).toContain('analysis.R');
    expect(strFromU8(files['analysis.R'])).toBe(script);
  });
});
