import { DICTIONARY, TABLE_NAMES, type TableName } from './dictionary';
import { consentLine, type ConsentCounts } from '@/lib/research/consent';

export type ExportMeta = {
  exportedAt: string;
  filters: Record<string, string | null>;
  version: string;
  rowCounts: Record<TableName, number>;
  /** Research consent of the exported patients. */
  consent: ConsentCounts;
  /** The study the export is for (a label only: it doesn't change the implants), or null. */
  study: StudyAbout | null;
};

/** The study fields that may go into the file. Notes are free text and never exported. */
export type StudyAbout = { title: string; committee: string | null; approval_number: string | null; protocol_version: string | null };

const orDash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

/** The about sheet / README study rows; every field '—' when empty or without a study. */
export function studyAboutRows(study: StudyAbout | null): [string, string][] {
  return [
    ['Study', orDash(study?.title)],
    ['Ethics committee', orDash(study?.committee)],
    ['Approval number', orDash(study?.approval_number)],
    ['Protocol version', orDash(study?.protocol_version)],
  ];
}

export const CONFIDENTIALITY_NOTE =
  'Exact dates combined with tooth, sex and age can identify a patient in a small course. Handle this file as confidential.';

export const DICTIONARY_COLUMNS = ['table', 'column', 'label', 'kind', 'unit', 'allowed_values', 'source', 'notes'];

/** One row per column of every table, in table order: the data_dictionary sheet / file. */
export function dictionaryRows(): Record<string, string>[] {
  return TABLE_NAMES.flatMap((table) =>
    Object.entries(DICTIONARY[table]).map(([column, e]) => ({
      table,
      column,
      label: e.label,
      kind: e.kind,
      unit: e.unit ?? '',
      allowed_values: e.values ? Object.entries(e.values).map(([v, l]) => `${v} = ${l}`).join('; ') : '',
      source: e.source,
      notes: e.notes ?? '',
    })),
  );
}

/** The about sheet / README lines as [label, value] pairs: confidentiality note, export time, outcomes version, study, filters, row counts, research consent. */
export function aboutLines(meta: ExportMeta): [string, string][] {
  // Course and delegate filters must arrive as study codes: raw ids stay in the export log.
  for (const [k, v] of Object.entries(meta.filters)) {
    if (v && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v)) throw new Error(`Export filter ${k} is a raw id`);
  }
  return [
    ['Research export', 'Anonymised implant research data: study codes replace names and ids; free text is never exported.'],
    ['Confidentiality', CONFIDENTIALITY_NOTE],
    ['Exported at', meta.exportedAt],
    ['Outcomes version', meta.version],
    ...studyAboutRows(meta.study),
    ...Object.entries(meta.filters).map(([k, v]): [string, string] => [`Filter: ${k}`, v ?? 'all']),
    ...TABLE_NAMES.map((t): [string, string] => [`Rows: ${t}`, String(meta.rowCounts[t] ?? 0)]),
    ['Research consent', consentLine(meta.consent)],
    ['Data dictionary', 'See the data_dictionary sheet / data_dictionary.csv for every column, its unit and its allowed values.'],
  ];
}

export function readmeText(meta: ExportMeta): string {
  return aboutLines(meta).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
}

/** research-export-YYYY-MM-DD.xlsx, or .zip for the CSV format. */
export function exportFileName(format: 'xlsx' | 'csv', todayIso: string): string {
  return `research-export-${todayIso}.${format === 'xlsx' ? 'xlsx' : 'zip'}`;
}
