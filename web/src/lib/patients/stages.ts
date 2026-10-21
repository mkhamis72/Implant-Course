/**
 * What the patient list can filter by: the chart states 'missing' and 'extracted' (public.tooth_status)
 * and the implant stages of public.implant_stage. Any ticked value matches (search_patients, 0041).
 * The 'prosthetic' implant stage still exists in SQL but isn't offered.
 */
export const PATIENT_FILTERS = ['missing', 'extracted', 'planned', 'cover_screw', 'healing_abutment', 'restored', 'failed'] as const;
export type PatientFilter = (typeof PATIENT_FILTERS)[number];

/** The scan / impression filters (0054): they match patients, not teeth, so they never add to the Teeth column. */
export const SCAN_FILTERS = ['digital_scan', 'conventional', 'impression_pending'] as const;
export type ScanFilter = (typeof SCAN_FILTERS)[number];
export type ListFilter = PatientFilter | ScanFilter;

export const SCAN_FILTER_LABELS: Record<ScanFilter, string> = {
  digital_scan: 'Digital scan', conventional: 'Conventional impression', impression_pending: 'Scan / impression not yet taken',
};

export const PATIENT_FILTER_LABELS: Record<ListFilter, string> = {
  ...SCAN_FILTER_LABELS,
  missing: 'Missing', extracted: 'To be extracted',
  planned: 'Planned', cover_screw: 'Placed · cover screw', healing_abutment: 'Placed · healing abutment',
  restored: 'Restored', failed: 'Failed / cancelled',
};

const SHORT_LABELS: Record<PatientFilter, string> = {
  missing: 'Missing', extracted: 'To extract',
  planned: 'Planned', cover_screw: 'Placed·CS', healing_abutment: 'Placed·HA',
  restored: 'Restored', failed: 'Failed',
};

/** The chart states among the filters (read from tooth_status rather than implant_stage_sites). */
export const TOOTH_FILTERS: readonly PatientFilter[] = ['missing', 'extracted'];

/** The known filters in a (possibly repeated) query parameter, once each, in list order. */
export function parseStages(value: string | string[] | undefined): ListFilter[] {
  const given = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return [...PATIENT_FILTERS, ...SCAN_FILTERS].filter((s) => given.has(s));
}

/** The filters that refer to teeth (everything but the scan / impression ones). */
export function toothBoundFilters(stages: readonly ListFilter[]): PatientFilter[] {
  return stages.filter((s): s is PatientFilter => !(SCAN_FILTERS as readonly string[]).includes(s));
}

export type StageSite = { patient_id: string; tooth: number; stage: string };

/** Per patient, the teeth in the chosen filters in tooth order, e.g. "14 Missing · 36 Placed·HA". */
export function teethByPatient(rows: StageSite[], stages: PatientFilter[]): Record<string, string> {
  const out: Record<string, string> = {};
  const chosen = rows.filter((r) => stages.includes(r.stage as PatientFilter)).sort((a, b) => a.tooth - b.tooth);
  for (const r of chosen) {
    const item = `${r.tooth} ${SHORT_LABELS[r.stage as PatientFilter]}`;
    out[r.patient_id] = out[r.patient_id] ? `${out[r.patient_id]} · ${item}` : item;
  }
  return out;
}
