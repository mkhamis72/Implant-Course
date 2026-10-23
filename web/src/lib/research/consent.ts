// Research consent of the patients in the Research filter: research_consent_counts / research_export_consent (0072).

export type ConsentCounts = { patients: number; yes: number; no: number; not_recorded: number };
export type ResearchConsent = 'yes' | 'no' | 'not_recorded';

export const RESEARCH_CONSENT_LABELS: Record<ResearchConsent, string> = {
  yes: 'Yes',
  no: 'No',
  not_recorded: 'Not recorded',
};

/** The Research page warning, or null when every patient in the filter consented to research. */
export function consentWarning(c: ConsentCounts): string | null {
  const missing = c.no + c.not_recorded;
  if (missing === 0) return null;
  return `⚠ ${missing} of ${c.patients} patients have no research consent on file (${c.not_recorded} not recorded, ${c.no} refused)`;
}

/** The value of the export's "Research consent" about line. */
export function consentLine(c: ConsentCounts): string {
  return `${c.yes} yes, ${c.no} no, ${c.not_recorded} not recorded (of ${c.patients} patients)`;
}

/** Adds research_consent to each patients row by patient_code; a patient without a consent row is not_recorded. */
export function mergeConsent(
  patients: Record<string, unknown>[],
  consent: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byCode = new Map(consent.map((r) => [r.patient_code, r.research_consent]));
  return patients.map((p) => ({ ...p, research_consent: byCode.get(p.patient_code) ?? 'not_recorded' }));
}

export function consentCounts(patients: Record<string, unknown>[]): ConsentCounts {
  const count = (v: ResearchConsent) => patients.filter((p) => p.research_consent === v).length;
  return { patients: patients.length, yes: count('yes'), no: count('no'), not_recorded: count('not_recorded') };
}
