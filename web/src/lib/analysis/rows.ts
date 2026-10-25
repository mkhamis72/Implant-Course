// Rows of the Explore readers (0078). Numeric columns arrive from PostgREST as numbers; dates as ISO strings.

export type YesNo = 'yes' | 'no'

export type ImplantRow = {
  site_id: string
  patient_id: string
  file_no: string
  tooth: number
  course_id: string | null
  placing_delegate_id: string | null
  supervisor_id: string | null
  placed_on: string
  age_at_placement: number | null
  sex: string | null
  smoking: string | null
  cigarettes_per_day: number | null
  diabetes_status: string | null
  hba1c: number | null
  periodontitis_history: string | null
  bruxism: string | null
  previous_implant_failure: string | null
  brand: string | null
  system: string | null
  platform: string | null
  diameter_mm: number | null
  length_mm: number | null
  technique: string | null
  bone_type: string | null
  torque_ncm: number | null
  isq: number | null
  placement_timing: string | null
  grafting_performed: string | null
  membrane_used: string | null
  sinus_procedure: string | null
  soft_tissue_phenotype: string | null
  keratinized_mucosa_mm: number | null
  flap: string | null
  healing: string | null
  event: boolean
  event_on: string | null
  event_time_unknown: boolean
  follow_up_days: number
  latest_grade: string | null
  biological_complications: number
  mechanical_complications: number
  restoration_problems: number
  final_restoration_on: string | null
}

export type VisitRow = {
  site_id: string
  visit_id: string
  date: string
  days_since_placement: number
  attendance: string
  pain_score: number | null
  swelling: string | null
  suppuration: string | null
  plaque: string | null
  mobility: string | null
  probing_max: number | null
  bop_any: string | null
  isq: number | null
  recession_facial_mm: number | null
  recession_mesial_mm: number | null
  recession_distal_mm: number | null
}

export type RadiographRow = {
  site_id: string
  radiograph_id: string
  taken_on: string
  days_since_placement: number
  purpose: string
  mesial_mm: number | null
  distal_mm: number | null
  is_baseline: boolean
  bone_change_mm: number | null
}

export type AnalysisData = { implants: ImplantRow[]; visits: VisitRow[]; radiographs: RadiographRow[] }

/** Measurements recorded over time (visits and X-rays), analysed per follow-up window. */
export type Measure =
  | 'bone_change' | 'bone_mesial' | 'bone_distal' | 'isq' | 'isq_change' | 'probing_max' | 'bop' | 'suppuration'
  | 'mobility' | 'plaque' | 'pain' | 'recession_facial' | 'recession_mesial' | 'recession_distal' | 'recession_max'
