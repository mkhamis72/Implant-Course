import type { Smoking, YesNo } from './risk-factors';
export const TOOTH_STATES = [
  'present', 'missing', 'extracted', 'implant_planned', 'implant_placed', 'restored', 'failed',
] as const;
export type ToothState = (typeof TOOTH_STATES)[number];

/** States a user may set by hand; implant states come from implant workflows (Plans 3–4). */
export const MANUAL_STATES = ['present', 'missing', 'extracted'] as const;
export type ManualState = (typeof MANUAL_STATES)[number];

export function isManualState(state: string): state is ManualState {
  return (MANUAL_STATES as readonly string[]).includes(state);
}

/** A tooth whose implant failed can be set to a manual state (e.g. missing); active implant states cannot. */
export function canSetByHand(state: string): boolean {
  return isManualState(state) || state === 'failed';
}

export const STATE_LABELS: Record<ToothState, string> = {
  present: 'Present',
  missing: 'Missing',
  extracted: 'To be extracted',
  implant_planned: 'Implant planned',
  implant_placed: 'Implant placed',
  restored: 'Restored',
  failed: 'Failed implant',
};

export type Patient = {
  id: string;
  file_no: string;
  full_name: string;
  dob: string | null;
  sex: 'female' | 'male' | null;
  phone: string;
  email: string;
  address: string;
  archived: boolean;
  updated_at: string;
};

export type MedicalHistory = {
  patient_id: string;
  allergies: string;
  medications: string;
  smoking: Smoking | null;
  cigarettes_per_day: number | null;
  diabetes_status: YesNo | null;
  hba1c: number | null;
  hba1c_date: string | null;
  bisphosphonates_status: YesNo | null;
  anticoagulants_status: YesNo | null;
  radiotherapy_status: YesNo | null;
  osteoporosis_status: YesNo | null;
  periodontitis_history: YesNo | null;
  bruxism: YesNo | null;
  previous_implant_failure: YesNo | null;
  other_conditions: string;
  notes: string;
  updated_at: string;
};

export type VisitNote = {
  id: string;
  visit_date: string;
  text: string;
  teeth: number[];
  created_at: string;
  author: { full_name: string; email: string } | null;
};

export type HistoryEntry = {
  id: number;
  at: string;
  table_name: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
