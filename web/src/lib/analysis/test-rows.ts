// Row builders for the analysis tests (test-only; imported by *.test.ts).
import type { ImplantRow, RadiographRow, VisitRow } from './rows'

export const implantRow = (over: Partial<ImplantRow> = {}): ImplantRow => ({
  site_id: 's1', patient_id: 'p1', file_no: 'F1', tooth: 36, course_id: 'c1', placing_delegate_id: 'd1', supervisor_id: 'v1',
  placed_on: '2025-01-10', age_at_placement: 44, sex: 'female', smoking: null, cigarettes_per_day: null, diabetes_status: 'no',
  hba1c: null, periodontitis_history: 'no', bruxism: null, previous_implant_failure: null, brand: 'Oxy', system: 'PSK',
  platform: null, diameter_mm: 4.1, length_mm: 10, technique: 'guided', bone_type: 'D2', torque_ncm: 35, isq: 70,
  placement_timing: 'delayed', grafting_performed: 'no', membrane_used: 'no', sinus_procedure: 'no',
  soft_tissue_phenotype: 'thick', keratinized_mucosa_mm: 3, flap: 'crestal', healing: 'submerged', event: false, event_on: null,
  event_time_unknown: false, follow_up_days: 400, latest_grade: 'I', biological_complications: 0, mechanical_complications: 0,
  restoration_problems: 0, final_restoration_on: null, ...over,
})

export const visitRow = (over: Partial<VisitRow> = {}): VisitRow => ({
  site_id: 's1', visit_id: 'v', date: '2025-02-01', days_since_placement: 22, attendance: 'attended', pain_score: null,
  swelling: null, suppuration: null, plaque: null, mobility: null, probing_max: null, bop_any: null, isq: null,
  recession_facial_mm: null, recession_mesial_mm: null, recession_distal_mm: null, ...over,
})

export const radiographRow = (over: Partial<RadiographRow> = {}): RadiographRow => ({
  site_id: 's1', radiograph_id: 'r', taken_on: '2025-01-20', days_since_placement: 10, purpose: 'follow_up', mesial_mm: null,
  distal_mm: null, is_baseline: false, bone_change_mm: null, ...over,
})
