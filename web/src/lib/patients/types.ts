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

export const STATE_LABELS: Record<ToothState, string> = {
  present: 'Present',
  missing: 'Missing',
  extracted: 'Extracted',
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
  diabetes: boolean;
  smoker: boolean;
  bisphosphonates: boolean;
  anticoagulants: boolean;
  radiotherapy_head_neck: boolean;
  osteoporosis: boolean;
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
