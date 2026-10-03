/** Implant stages the patient list can filter by (see public.implant_stage). */
export const IMPLANT_STAGES = ['planned', 'cover_screw', 'healing_abutment', 'prosthetic', 'restored', 'failed'] as const;
export type ImplantStage = (typeof IMPLANT_STAGES)[number];

export const IMPLANT_STAGE_LABELS: Record<ImplantStage, string> = {
  planned: 'Planned', cover_screw: 'Placed · cover screw', healing_abutment: 'Placed · healing abutment',
  prosthetic: 'Prosthetic stage', restored: 'Restored', failed: 'Failed / cancelled',
};

const SHORT_LABELS: Record<ImplantStage, string> = {
  planned: 'Planned', cover_screw: 'Placed·CS', healing_abutment: 'Placed·HA',
  prosthetic: 'Prosthetic', restored: 'Restored', failed: 'Failed',
};

/** The known stages in a (possibly repeated) query parameter, once each, in list order. */
export function parseStages(value: string | string[] | undefined): ImplantStage[] {
  const given = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return IMPLANT_STAGES.filter((s) => given.has(s));
}

export type StageSite = { patient_id: string; tooth: number; stage: string };

/** Per patient, the teeth in the chosen stages, e.g. "36 Placed·HA · 46 Placed·CS". */
export function teethByPatient(rows: StageSite[], stages: ImplantStage[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!stages.includes(r.stage as ImplantStage)) continue;
    const item = `${r.tooth} ${SHORT_LABELS[r.stage as ImplantStage]}`;
    out[r.patient_id] = out[r.patient_id] ? `${out[r.patient_id]} · ${item}` : item;
  }
  return out;
}
