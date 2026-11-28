// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Font, renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { passportModel, type PassportData, type PassportModel } from './model';
import { PASSPORT_LABELS as L, type MedicalLevel } from './labels';
import { PassportDocument } from './document';
import { registerPassportFonts, PASSPORT_ARABIC_FONT } from './fonts';
import { chartView } from './chart';
import { ARCH_VIEWBOX, HEAD_Y } from '@/components/full-arch/model';
import { ARABIC_LAB, ARABIC_NAME, emptyPassportData, history, largePassportData, site } from './test-fixtures';

const GENERATED = '2026-11-24T09:00:00Z';
const model = (d: PassportData, version = 3) => passportModel(d, GENERATED, version);
/** The PDF bytes, as the browser's pdf(…).toBlob() makes them. */
const renderPassport = (m: PassportModel) =>
  renderToBuffer(<PassportDocument model={m} /> as unknown as ReactElement<DocumentProps>);

/**
 * Every string the document tree prints, in order, without laying out a PDF: function components are called,
 * react-pdf primitives are walked, and `render` props (page numbers) are called with page 1 of 2.
 */
function documentText(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(documentText);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ children?: ReactNode; render?: (p: { pageNumber: number; totalPages: number }) => ReactNode }>;
  if (typeof el.type === 'function') return documentText((el.type as (p: unknown) => ReactNode)(el.props));
  const out: string[] = [];
  if (typeof el.props.render === 'function') out.push(...documentText(el.props.render({ pageNumber: 1, totalPages: 2 })));
  out.push(...documentText(el.props.children));
  return out;
}

const textOf = (d: PassportData, version = 3) => documentText(<PassportDocument model={model(d, version)} />);

/** Pages in a PDF written by pdfkit (no object streams): one `/Type /Page` object each. */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe('PassportDocument: the document tree', () => {
  it('prints the exact copy, the passport number and the generation date', () => {
    const text = textOf(largePassportData(), 3);
    expect(text).toContain('Implant Passport');
    expect(text).toContain('P00123-3');
    expect(text).toContain('24 Nov 2026');
    expect(text).toContain('Kaleidoscope Dental Academy');
    expect(text).toContain("This passport summarises the clinic's records on the date shown. It is not a manufacturer warranty or guarantee. Values not recorded are shown as 'Not recorded'.");
    expect(text).toContain('Schematic drawing — not a substitute for CBCT or 3D planning.');
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('Not recorded');
  });

  it('prints every section of the large patient, with the Arabic name and lab unchanged', () => {
    const text = textOf(largePassportData());
    expect(text).toContain(ARABIC_NAME);
    expect(text.some((t) => t.includes(ARABIC_LAB))).toBe(true);
    for (const heading of [L.patientHeading, L.medicalHeading, L.overviewHeading, L.implantsHeading, L.implantDetailsHeading,
      L.componentsHeading, L.restorationsHeading, L.fullArchHeading]) {
      expect(text).toContain(heading);
    }
    for (const tooth of [18, 16, 12, 22, 26, 28, 45, 42, 32, 35, 36, 37, 46, 47, 38, 48]) expect(text).toContain(`${L.implantOnTooth} ${tooth}`);
    expect(text).toContain('OXY-PS14');
    expect(text).toContain('L-IMP-16');
    expect(text).toContain(L.replacedParts);
  });

  it('a patient with nothing recorded prints None recorded sections and no chart', () => {
    const text = textOf(emptyPassportData(), 1);
    expect(text).toContain('P00007-1');
    expect(text.filter((t) => t === 'None recorded').length).toBeGreaterThanOrEqual(4);
    expect(text).not.toContain(L.chartNote);
    expect(text).not.toContain(L.implantDetailsHeading);
  });

  it.each<[MedicalLevel, string[], string[]]>([
    ['allergies_medications', [L.medicalHeading, L.allergies, L.medications], [L.otherConditions, L.hba1c]],
    ['full', [L.medicalHeading, L.allergies, L.medications, L.otherConditions, L.hba1c], []],
    ['none', [], [L.medicalHeading, L.allergies, L.medications, 'Penicillin (rash); latex']],
  ])('the medical section follows the setting: %s', (medicalLevel, present, absent) => {
    const text = textOf(largePassportData({ medicalLevel }));
    for (const s of present) expect(text).toContain(s);
    for (const s of absent) expect(text).not.toContain(s);
  });

  it('no medical history prints the medical section with None recorded', () => {
    const text = textOf(emptyPassportData({ medicalHistory: null }));
    const at = text.indexOf(L.medicalHeading);
    expect(at).toBeGreaterThan(-1);
    expect(text[at + 1]).toBe(L.noneRecorded);
    expect(textOf(emptyPassportData({ medicalHistory: history({ allergies: 'Latex' }) }))).toContain('Latex');
  });
});

describe('chartView: the chart is cut to what is drawn', () => {
  const drawing = (d: PassportData) => model(d).overview.chart!.drawing;

  it('keeps the whole height when zygomatics and long implants fill both arches', () => {
    const v = chartView(drawing(largePassportData()));
    expect(v.x).toBe(ARCH_VIEWBOX.x);
    expect(v.width).toBe(ARCH_VIEWBOX.width);
    expect(v.y).toBeGreaterThanOrEqual(ARCH_VIEWBOX.y);
    expect(v.y).toBeLessThan(HEAD_Y.upper - 56);
  });

  it('a lower implant only: no upper implant zone, the lower zone ends past its apex', () => {
    const v = chartView(drawing(emptyPassportData({ sites: [site({ id: 'a', tooth: 36 })] })));
    expect(v.y).toBe(HEAD_Y.upper - 24);
    expect(v.y + v.height).toBeGreaterThanOrEqual(HEAD_Y.lower + 56);
    expect(v.y + v.height).toBeLessThan(ARCH_VIEWBOX.y + ARCH_VIEWBOX.height);
  });
});

describe('the model as JSON (sent to the browser by the data route)', () => {
  it('survives a JSON round trip unchanged, logo included', () => {
    const m = model(largePassportData());
    expect(typeof m.header.logo).toBe('string');
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('renderPassport: the PDF', () => {
  // The browser registers them by URL (/passport-fonts/…); here the same files from disk.
  beforeAll(() => registerPassportFonts((file) => path.join(process.cwd(), 'public', 'passport-fonts', file)));

  it('returns PDF bytes for a patient with nothing recorded, on one page', async () => {
    const pdf = await renderPassport(model(emptyPassportData(), 1));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  }, 30_000);

  it('grows with the implants, and the large patient stays small and fast (Review Focus 2)', async () => {
    const one = await renderPassport(model(emptyPassportData({ sites: [site({ id: 'a', tooth: 36 })] })));
    const started = performance.now();
    const large = await renderPassport(model(largePassportData()));
    const ms = performance.now() - started;
    expect(large.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(large)).toBeGreaterThan(pageCount(one));
    expect(large.length).toBeLessThan(1.5 * 1024 * 1024);
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it('shapes Arabic with letters that carry their own dots (no mark glyphs; Review Focus 1)', async () => {
    const source = Font.getFont({ fontFamily: PASSPORT_ARABIC_FONT, fontWeight: 400 });
    await source.load();
    const font = source.data as unknown as { layout: (s: string) => { glyphs: { id: number; isMark: boolean }[] } };
    for (const word of ['حسن', 'علي', ...ARABIC_NAME.split(' ')]) {
      const { glyphs } = font.layout(word);
      expect(glyphs.length).toBeGreaterThan(0);
      expect(glyphs.some((g) => g.id === 0)).toBe(false);
      expect(glyphs.some((g) => g.isMark)).toBe(false);
    }
  });
});
