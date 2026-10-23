import { TECHNIQUE_LABELS, OUTCOME_LABELS } from '@/lib/inventory/types';
import {
  FLAP_LABELS, GRAFT_MATERIAL_LABELS, GRAFT_PROCEDURE_LABELS, GRAFT_TIMING_LABELS, HEALING_LABELS, MEMBRANE_LABELS,
  PHENOTYPE_LABELS, PLACEMENT_TIMING_LABELS, TORQUE_TYPE_LABELS, YES_NO_LABELS,
} from '@/lib/implants/surgery';
import { IMPRESSION_LABELS } from '@/lib/implants/impression';
import { FAILURE_TYPE_LABELS } from '@/lib/implants/failure';
import { CATEGORY_LABELS, SEVERITY_LABELS, TYPE_LABELS } from '@/lib/implants/complications';
import { ATTENDANCE_LABELS, PROSTHESIS_LABELS } from '@/lib/visits/visits';
import { RADIOGRAPH_PURPOSE_LABELS, RADIOGRAPH_TYPE_LABELS } from '@/lib/radiographs/radiographs';
import {
  MATERIAL_LABELS, PROBLEM_ACTION_LABELS, PROBLEM_TYPE_LABELS, RESTORATION_TYPE_LABELS, RETENTION_LABELS, STAGE_LABELS,
} from '@/lib/restorations/restorations';
import { RISK_QUESTIONS } from '@/lib/patients/risk-factors';
import { GRADE_LABELS, MILESTONE_LABELS } from '@/lib/research/view';

export const TABLE_NAMES = [
  'implants', 'patients', 'visits', 'radiographs', 'complications', 'restorations', 'restoration_problems', 'grafts',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export type DictionaryEntry = {
  label: string;
  kind: 'code' | 'coded' | 'number' | 'date' | 'boolean' | 'text-derived';
  unit?: string;
  values?: Record<string, string>;
  source: string;
  notes?: string;
};

export type ExportTables = Record<TableName, Record<string, unknown>[]>;

const OUTCOMES = 'outcomes-v1';
const outcome = (rule: string) => `Rule version ${OUTCOMES}: ${rule}`;

const labels = (m: Record<string, string>): Record<string, string> => ({ ...m });
const YES_NO = labels(YES_NO_LABELS);
const risk = (key: string): Record<string, string> =>
  Object.fromEntries((RISK_QUESTIONS.find((q) => q.key === key)?.options ?? []).filter((o) => o.value !== '').map((o) => [o.value, o.label]));
const RISK_NOTE = 'Empty means not assessed, not "no".';

const code = (label: string, source: string, notes?: string): DictionaryEntry => ({ label, kind: 'code', source, notes });
const date = (label: string, source: string, notes?: string): DictionaryEntry => ({ label, kind: 'date', source, notes });
const num = (label: string, unit: string | undefined, source: string, notes?: string): DictionaryEntry => ({ label, kind: 'number', unit, source, notes });
const bool = (label: string, source: string, notes?: string): DictionaryEntry => ({ label, kind: 'boolean', source, notes });
const coded = (label: string, values: Record<string, string>, source: string, notes?: string): DictionaryEntry =>
  ({ label, kind: 'coded', values, source, notes });

const IMPLANT = 'Implant record';
const SURGERY = 'Implant surgery details';
const VISITS = 'Follow-up visit';
const PATIENT_HISTORY = 'Patient record and medical history';
const CALC = `Calculated (${OUTCOMES})`;
const STUDY_CODE = 'Study code: random, stable between exports, unrelated to any database id or name.';

const MILESTONE = labels(MILESTONE_LABELS);
const SURVIVAL = Object.fromEntries(Object.entries(MILESTONE).filter(([k]) => k !== 'not_loaded'));
const MILESTONE_NOTE = (n: string) => outcome(`survival at ${n}: failed, survived, not reached yet, or lost to follow-up (never surviving past the last contact).`);

const IMPLANT_DICTIONARY: Record<string, DictionaryEntry> = {
  implant_code: code('Implant study code', IMPLANT, `${STUDY_CODE} Prefix I-.`),
  patient_code: code('Patient study code', IMPLANT, `${STUDY_CODE} Prefix P-.`),
  course_code: code('Course study code', IMPLANT, `${STUDY_CODE} Prefix C-. Empty when the implant has no course.`),
  tooth: num('Tooth (FDI number)', undefined, IMPLANT, 'Two-digit FDI notation, for example 36.'),
  jaw: coded('Jaw', { maxilla: 'Maxilla (upper)', mandible: 'Mandible (lower)' }, 'Derived from the FDI tooth number', 'Quadrants 1 and 2 are maxilla; 3 and 4 are mandible.'),
  placed_on: date('Placement date', IMPLANT),
  technique: coded('Surgical technique', labels(TECHNIQUE_LABELS), IMPLANT, 'Empty on older records.'),
  brand: { label: 'Implant brand', kind: 'coded', source: 'Product catalogue (Admin, product list)', notes: 'A catalogue value entered by the administrator, not a fixed list. Empty when no product is recorded.' },
  system: { label: 'Implant system', kind: 'coded', source: 'Product catalogue (Admin, product list)', notes: 'A catalogue value entered by the administrator, not a fixed list. Line and type are separated by " · ". Empty when no product is recorded.' },
  diameter_mm: num('Implant diameter', 'mm', 'Product catalogue'),
  length_mm: num('Implant length', 'mm', 'Product catalogue'),
  placing_delegate_code: code('Placing delegate study code', IMPLANT, `${STUDY_CODE} Prefix D-.`),
  supervisor_code: code('Supervisor study code', IMPLANT, `${STUDY_CODE} Prefix S-.`),
  extraction_date: date('Extraction date', SURGERY, 'Empty when not recorded.'),
  placement_timing: coded('Placement timing (ITI type)', labels(PLACEMENT_TIMING_LABELS), SURGERY, 'Empty when not recorded.'),
  soft_tissue_phenotype: coded('Soft-tissue phenotype', labels(PHENOTYPE_LABELS), SURGERY, 'Empty when not recorded.'),
  keratinized_mucosa_mm: num('Keratinised mucosa width', 'mm', SURGERY, 'Empty when not recorded.'),
  flap: coded('Flap design', labels(FLAP_LABELS), SURGERY, 'Empty when not recorded.'),
  torque_type: coded('Torque type', labels(TORQUE_TYPE_LABELS), SURGERY, 'Empty when not recorded.'),
  healing: coded('Healing protocol', labels(HEALING_LABELS), SURGERY, 'Empty when not recorded.'),
  primary_closure: coded('Primary closure achieved', YES_NO, SURGERY, 'Empty when not recorded.'),
  grafting_performed: coded('Grafting performed', YES_NO, SURGERY, 'Empty when not recorded. See the grafts table.'),
  torque_ncm: num('Insertion torque', 'Ncm', IMPLANT, 'Empty when not recorded.'),
  isq: num('ISQ at placement', 'ISQ', IMPLANT, 'Implant stability quotient. Empty when not recorded.'),
  bone_type: coded('Bone type (Lekholm and Zarb)', { D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4' }, IMPLANT, 'Empty when not recorded.'),
  impression_type: coded('Impression type', labels(IMPRESSION_LABELS), IMPLANT, 'Empty when no impression has been taken.'),
  impression_taken_on: date('Impression date', IMPLANT),
  failure_type: coded('Failure type', labels(FAILURE_TYPE_LABELS), IMPLANT, 'Empty when the implant has not failed, or for an old failure recorded without details. The failure reason and notes are not exported.'),
  failed_on: date('Failure date', IMPLANT, 'Empty when not failed or the date is unknown.'),
  loaded_on: date('Loading date', CALC, outcome('the date of the earliest restoration, temporary or final.')),
  last_contact: date('Last contact date', CALC, outcome('the latest attended visit, measured X-ray of the implant, or event date.')),
  follow_up_days: num('Follow-up time', 'days', CALC, outcome('days from placement to the event date for an event, otherwise to the last contact (0 when never seen).')),
  event: bool('Implant lost or removed', CALC, outcome('true when the implant was lost, removed, or failed without details; failed in place does not count as an event.')),
  event_on: date('Event date', CALC, outcome('the failure date, or the earliest failed visit when an old failure has no date.')),
  event_time_unknown: bool('Event date unknown', CALC, outcome('true for an event with no known date; such implants are unknown at every milestone.')),
  at_loading: coded('Survival at loading', MILESTONE, CALC, outcome('failed before or at loading, survived after it, or not loaded yet when there is no event and no restoration.')),
  year_1: coded('Survival at 1 year', SURVIVAL, CALC, MILESTONE_NOTE('the 12-month review window')),
  year_2: coded('Survival at 2 years', SURVIVAL, CALC, MILESTONE_NOTE('the 2-year review window')),
  year_3: coded('Survival at 3 years', SURVIVAL, CALC, MILESTONE_NOTE('the 3-year review window')),
  year_5: coded('Survival at 5 years', SURVIVAL, CALC, MILESTONE_NOTE('the 5-year review window')),
  latest_grade: coded('Latest ICOI health grade', labels(GRADE_LABELS), CALC, outcome('ICOI 2008 (Misch) scale of the latest assessable attended visit; the worst criterion wins and missing data never gives a better grade.')),
  latest_grade_on: date('Latest grade date', CALC, outcome('the date of the visit that gave the latest assessable grade.')),
  latest_grade_reason: {
    label: 'Reason for the latest grade',
    kind: 'text-derived',
    source: CALC,
    notes: outcome('generated by the database from a fixed list, never typed by a person. Values: "bone loss N mm", "mobility", "pain N", "suppuration", "probing N mm" (the criterion that gave the grade); "implant lost", "implant removed", "failed in place", "implant failed"; and for not assessable visits "no baseline X-ray", "no follow-up X-ray", "no comparable bone level", "pain not recorded", "mobility not recorded", "suppuration not recorded", "implant length unknown". N is a number.'),
  },
  ungraded_later: num('Not-assessable visits after the latest grade', 'visits', CALC, outcome('count of attended visits after the latest assessable grade that could not be graded.')),
  biological_complications: num('Biological complications', 'complications', CALC, outcome('count of non-voided biological complications.')),
  mechanical_complications: num('Mechanical complications', 'complications', CALC, outcome('count of non-voided mechanical complications.')),
  version: { label: 'Outcome rule version', kind: 'code', source: CALC, notes: `Identifies the rules used for every calculated column; currently ${OUTCOMES}.` },
};

const PATIENTS_DICTIONARY: Record<string, DictionaryEntry> = {
  patient_code: code('Patient study code', PATIENT_HISTORY, `${STUDY_CODE} Prefix P-.`),
  sex: coded('Sex', { female: 'Female', male: 'Male' }, PATIENT_HISTORY, 'Empty when not recorded.'),
  age_at_first_placement: num('Age at the first exported placement', 'years', PATIENT_HISTORY, 'Whole years between the date of birth and the patient\'s earliest placement in this export. Empty when the date of birth is not recorded. The date of birth itself is never exported.'),
  smoking: coded('Smoking', risk('smoking'), PATIENT_HISTORY, RISK_NOTE),
  cigarettes_per_day: num('Cigarettes per day', 'cigarettes/day', PATIENT_HISTORY, 'Empty when not recorded.'),
  diabetes_status: coded('Diabetes', risk('diabetes_status'), PATIENT_HISTORY, RISK_NOTE),
  hba1c: num('HbA1c', '%', PATIENT_HISTORY, 'Empty when not recorded.'),
  hba1c_date: date('HbA1c date', PATIENT_HISTORY),
  bisphosphonates_status: coded('Bisphosphonates', risk('bisphosphonates_status'), PATIENT_HISTORY, RISK_NOTE),
  anticoagulants_status: coded('Anticoagulants', risk('anticoagulants_status'), PATIENT_HISTORY, RISK_NOTE),
  radiotherapy_status: coded('Head and neck radiotherapy', risk('radiotherapy_status'), PATIENT_HISTORY, RISK_NOTE),
  osteoporosis_status: coded('Osteoporosis', risk('osteoporosis_status'), PATIENT_HISTORY, RISK_NOTE),
  periodontitis_history: coded('Periodontitis history', risk('periodontitis_history'), PATIENT_HISTORY, RISK_NOTE),
  bruxism: coded('Bruxism or parafunction', risk('bruxism'), PATIENT_HISTORY, RISK_NOTE),
  previous_implant_failure: coded('Previous implant failure', risk('previous_implant_failure'), PATIENT_HISTORY, RISK_NOTE),
};

const BOP = (site: string): DictionaryEntry => coded(`Bleeding on probing, ${site}`, YES_NO, VISITS, 'Empty when not recorded or not attended.');
const PROBING = (site: string): DictionaryEntry => num(`Probing depth, ${site}`, 'mm', VISITS, 'Empty when not recorded.');
const FINDING = (label: string): DictionaryEntry => coded(label, YES_NO, VISITS, 'Empty when not recorded.');

const VISIT_KEYS: Record<string, string> = {
  early_review: 'Early review (suture removal)', osseointegration: 'Osseointegration check', month_6: '6-month review',
  month_12: '12-month review',
  ...Object.fromEntries(Array.from({ length: 98 }, (_, i) => [`year_${i + 2}`, `Year-${i + 2} review`])),
};

const VISITS_DICTIONARY: Record<string, DictionaryEntry> = {
  implant_code: code('Implant study code', VISITS, `${STUDY_CODE} Prefix I-.`),
  patient_code: code('Patient study code', VISITS, `${STUDY_CODE} Prefix P-.`),
  date: date('Visit date', VISITS),
  visit_key: coded('Scheduled visit', VISIT_KEYS, VISITS, 'Empty for an unscheduled visit. Yearly reviews are year_N, listed here from year_2 up to year_99.'),
  attendance: coded('Attendance', labels(ATTENDANCE_LABELS), VISITS, 'Empty on old visits recorded before attendance existed; the outcome rules count those as attended.'),
  outcome: coded('Visit outcome', labels(OUTCOME_LABELS), VISITS, 'Empty when not attended.'),
  pain_score: num('Pain score', 'score 0-10', VISITS, 'Numeric rating 0 to 10. Empty when not recorded.'),
  swelling: FINDING('Swelling'),
  suppuration: FINDING('Suppuration'),
  plaque: FINDING('Plaque'),
  mobility: FINDING('Mobility'),
  probing_mesial: PROBING('mesial'),
  probing_buccal: PROBING('buccal'),
  probing_distal: PROBING('distal'),
  probing_lingual: PROBING('lingual'),
  bop_mesial: BOP('mesial'),
  bop_buccal: BOP('buccal'),
  bop_distal: BOP('distal'),
  bop_lingual: BOP('lingual'),
  isq: num('ISQ at the visit', 'ISQ', VISITS, 'Empty when not recorded.'),
  prosthesis_status: coded('Prosthesis status', labels(PROSTHESIS_LABELS), VISITS, 'Empty when not recorded.'),
  radiograph_taken: coded('Radiograph taken at the visit', YES_NO, VISITS, 'Empty when not recorded.'),
};

const XRAY = 'X-ray record';
const RADIOGRAPHS_DICTIONARY: Record<string, DictionaryEntry> = {
  implant_code: code('Implant study code', XRAY, `${STUDY_CODE} Prefix I-.`),
  patient_code: code('Patient study code', XRAY, `${STUDY_CODE} Prefix P-.`),
  tooth: num('Tooth (FDI number)', undefined, XRAY, 'One row per X-ray and implant: an X-ray covering several implants gives several rows.'),
  taken_on: date('X-ray date', XRAY),
  type: coded('X-ray type', labels(RADIOGRAPH_TYPE_LABELS), XRAY),
  purpose: coded('X-ray purpose', labels(RADIOGRAPH_PURPOSE_LABELS), XRAY),
  mesial_mm: num('Bone level, mesial', 'mm', 'X-ray bone levels', 'Empty when this implant was not measured on the X-ray.'),
  distal_mm: num('Bone level, distal', 'mm', 'X-ray bone levels', 'Empty when this implant was not measured on the X-ray.'),
};

const COMPLICATION = 'Implant complication';
const COMPLICATIONS_DICTIONARY: Record<string, DictionaryEntry> = {
  implant_code: code('Implant study code', COMPLICATION, `${STUDY_CODE} Prefix I-.`),
  patient_code: code('Patient study code', COMPLICATION, `${STUDY_CODE} Prefix P-.`),
  category: coded('Category', labels(CATEGORY_LABELS), COMPLICATION),
  type: coded('Type', labels(TYPE_LABELS), COMPLICATION, 'The name given to an "other" type is free text and is not exported.'),
  noticed_on: date('Date noticed', COMPLICATION),
  resolved_on: date('Date resolved', COMPLICATION, 'Empty while the complication is open.'),
  severity: coded('Severity', labels(SEVERITY_LABELS), COMPLICATION, 'Empty when not recorded.'),
};

const RESTORATION = 'Restoration record';
const RESTORATIONS_DICTIONARY: Record<string, DictionaryEntry> = {
  restoration_code: code('Restoration study code', RESTORATION, `${STUDY_CODE} Prefix R-.`),
  patient_code: code('Patient study code', RESTORATION, `${STUDY_CODE} Prefix P-.`),
  implant_codes: { label: 'Implant study codes', kind: 'code', source: RESTORATION, notes: `Exported implants carrying this restoration, ordered by tooth, separated by ";". ${STUDY_CODE} Prefix I-.` },
  stage: coded('Stage', labels(STAGE_LABELS), RESTORATION),
  type: coded('Restoration type', labels(RESTORATION_TYPE_LABELS), RESTORATION),
  teeth: { label: 'Teeth (FDI numbers)', kind: 'number', source: RESTORATION, notes: 'Separated by ";".' },
  fitted_on: date('Fitting date', RESTORATION),
  retention: coded('Retention', labels(RETENTION_LABELS), RESTORATION, 'Empty when not recorded.'),
  material: coded('Material', labels(MATERIAL_LABELS), RESTORATION, 'Empty when not recorded.'),
  delegate_code: code('Delegate study code', RESTORATION, `${STUDY_CODE} Prefix D-.`),
  supervisor_code: code('Supervisor study code', RESTORATION, `${STUDY_CODE} Prefix S-.`),
  ended_on: date('Date the restoration ended', RESTORATION, 'Empty while the restoration is current.'),
  end_kind: coded('How it ended', { replaced: 'Replaced (temporary)', remade: 'Remade (final)' }, RESTORATION, 'Empty while current. The reason is free text and is not exported.'),
};

const PROBLEM = 'Restoration problem';
const RESTORATION_PROBLEMS_DICTIONARY: Record<string, DictionaryEntry> = {
  restoration_code: code('Restoration study code', PROBLEM, `${STUDY_CODE} Prefix R-.`),
  patient_code: code('Patient study code', PROBLEM, `${STUDY_CODE} Prefix P-.`),
  noticed_on: date('Date noticed', PROBLEM),
  type: coded('Problem type', labels(PROBLEM_TYPE_LABELS), PROBLEM),
  action: coded('Action taken', labels(PROBLEM_ACTION_LABELS), PROBLEM),
};

const GRAFT = 'Implant graft';
const GRAFTS_DICTIONARY: Record<string, DictionaryEntry> = {
  implant_code: code('Implant study code', GRAFT, `${STUDY_CODE} Prefix I-.`),
  patient_code: code('Patient study code', GRAFT, `${STUDY_CODE} Prefix P-.`),
  procedure: coded('Procedure', labels(GRAFT_PROCEDURE_LABELS), GRAFT),
  timing: coded('Timing', labels(GRAFT_TIMING_LABELS), GRAFT),
  performed_on: date('Date performed', GRAFT),
  material: coded('Graft material', labels(GRAFT_MATERIAL_LABELS), GRAFT),
  membrane: coded('Membrane', labels(MEMBRANE_LABELS), GRAFT),
};

/** The data dictionary and the column allowlist of the research export: a reader column without an entry here is refused. */
export const DICTIONARY: Record<TableName, Record<string, DictionaryEntry>> = {
  implants: IMPLANT_DICTIONARY,
  patients: PATIENTS_DICTIONARY,
  visits: VISITS_DICTIONARY,
  radiographs: RADIOGRAPHS_DICTIONARY,
  complications: COMPLICATIONS_DICTIONARY,
  restorations: RESTORATIONS_DICTIONARY,
  restoration_problems: RESTORATION_PROBLEMS_DICTIONARY,
  grafts: GRAFTS_DICTIONARY,
};

const DATE_FIRST: Partial<Record<TableName, string>> = {
  implants: 'placed_on', visits: 'date', radiographs: 'taken_on', complications: 'noticed_on',
  restorations: 'fitted_on', restoration_problems: 'noticed_on', grafts: 'performed_on',
};

/** The paging order of a table's reader: its date column first (so files read chronologically), then every other column, so the order is total. */
export function exportOrder(table: TableName): string[] {
  const cols = Object.keys(DICTIONARY[table]);
  const first = DATE_FIRST[table];
  return first ? [first, ...cols.filter((c) => c !== first)] : cols;
}

/** Throws when any row of any table has a column that is not in DICTIONARY (so free text can never be exported by accident). */
export function assertAllowlisted(tables: ExportTables): void {
  for (const t of TABLE_NAMES) {
    const allowed = DICTIONARY[t];
    for (const row of tables[t] ?? []) {
      for (const col of Object.keys(row)) {
        if (!Object.hasOwn(allowed, col)) throw new Error(`Research export: column ${t}.${col} is not in the data dictionary.`);
      }
    }
  }
}
