// The variables Statistics → Explore can analyse: factors (what the user compares by) and outcomes. Adding a column
// to a reader means adding one entry here. Kinds drive the chart and test choice (choose.ts).

import { FLAP_LABELS, HEALING_LABELS, PHENOTYPE_LABELS, PLACEMENT_TIMING_LABELS, YES_NO_LABELS } from '@/lib/implants/surgery'
import { TECHNIQUE_LABELS } from '@/lib/inventory/types'
import { BONE_TYPES } from '@/lib/inventory/schemas'
import type { ImplantRow, Measure } from './rows'

export type Kind = 'categorical' | 'binary' | 'ordinal' | 'continuous' | 'count' | 'survival' | 'longitudinal'
export type Group = 'Patient' | 'Implant' | 'Site' | 'Surgical' | 'People' | 'Outcome'
export type Level = { value: string; label: string }

export type Variable = {
  key: string
  label: string
  group: Group
  kind: Kind
  role: 'factor' | 'outcome' | 'both'
  unit?: string
  /** Fixed levels in display order. */
  levels?: Level[]
  /** Levels come from the data (brands, people, courses); the page supplies their labels. */
  dynamicLevels?: boolean
  source: 'implant' | 'visit' | 'radiograph'
  /** For visit and X-ray outcomes: the observation to read per follow-up window (observations.ts). */
  measure?: Measure
  get: (row: ImplantRow) => string | number | null
}

const fromLabels = (labels: Record<string, string>): Level[] => Object.entries(labels).map(([value, label]) => ({ value, label }))
const YES_NO = fromLabels(YES_NO_LABELS)
const yes = (flag: boolean) => (flag ? 'yes' : 'no')
const none = () => null

const AGE_BANDS = ['<30', '30-39', '40-49', '50-59', '60-69', '70+']
function ageBand(age: number | null): string | null {
  if (age === null) return null
  if (age < 30) return '<30'
  if (age >= 70) return '70+'
  return AGE_BANDS[Math.floor(age / 10) - 2]
}
// FDI: quadrants 1–2 upper, 3–4 lower; canine to canine (13–23, 33–43) is anterior.
const jaw = (tooth: number) => (Math.floor(tooth / 10) <= 2 ? 'maxilla' : 'mandible')
const region = (tooth: number) => (tooth % 10 <= 3 ? 'anterior' : 'posterior')

type Spec = Omit<Variable, 'role' | 'source' | 'get'> & Partial<Pick<Variable, 'source' | 'get'>>
const factor = (v: Spec): Variable => ({ role: 'factor', source: 'implant', get: none, ...v })
const outcome = (v: Spec): Variable => ({ role: 'outcome', source: 'implant', get: none, ...v })
const visit = (key: Measure, label: string, kind: Kind, unit?: string): Variable =>
  outcome({ key, label, group: 'Outcome', kind, unit, source: 'visit', measure: key, levels: kind === 'binary' ? YES_NO : undefined })

export const VARIABLES: Variable[] = [
  factor({ key: 'age', label: 'Age at placement', group: 'Patient', kind: 'continuous', unit: 'years', get: (r) => r.age_at_placement }),
  factor({ key: 'age_band', label: 'Age group', group: 'Patient', kind: 'ordinal', levels: AGE_BANDS.map((b) => ({ value: b, label: b })),
    get: (r) => ageBand(r.age_at_placement) }),
  factor({ key: 'sex', label: 'Sex', group: 'Patient', kind: 'binary', levels: fromLabels({ female: 'Female', male: 'Male' }), get: (r) => r.sex }),
  factor({ key: 'smoking', label: 'Smoking', group: 'Patient', kind: 'categorical',
    levels: fromLabels({ never: 'Never', former: 'Former', current: 'Current' }), get: (r) => r.smoking }),
  factor({ key: 'diabetes', label: 'Diabetes', group: 'Patient', kind: 'binary', levels: YES_NO, get: (r) => r.diabetes_status }),
  factor({ key: 'periodontitis', label: 'Periodontitis history', group: 'Patient', kind: 'binary', levels: YES_NO, get: (r) => r.periodontitis_history }),
  factor({ key: 'bruxism', label: 'Bruxism', group: 'Patient', kind: 'binary', levels: YES_NO, get: (r) => r.bruxism }),
  factor({ key: 'previous_failure', label: 'Previous implant failure', group: 'Patient', kind: 'binary', levels: YES_NO,
    get: (r) => r.previous_implant_failure }),

  factor({ key: 'brand', label: 'Brand / line', group: 'Implant', kind: 'categorical', dynamicLevels: true, get: (r) => r.brand }),
  factor({ key: 'system', label: 'System', group: 'Implant', kind: 'categorical', dynamicLevels: true, get: (r) => r.system }),
  factor({ key: 'platform', label: 'Platform / connection', group: 'Implant', kind: 'categorical', dynamicLevels: true, get: (r) => r.platform }),
  factor({ key: 'diameter', label: 'Implant diameter', group: 'Implant', kind: 'continuous', unit: 'mm', get: (r) => r.diameter_mm }),
  factor({ key: 'length', label: 'Implant length', group: 'Implant', kind: 'continuous', unit: 'mm', get: (r) => r.length_mm }),

  factor({ key: 'jaw', label: 'Jaw', group: 'Site', kind: 'binary', levels: fromLabels({ maxilla: 'Maxilla', mandible: 'Mandible' }),
    get: (r) => jaw(r.tooth) }),
  factor({ key: 'region', label: 'Anterior / posterior', group: 'Site', kind: 'binary',
    levels: fromLabels({ anterior: 'Anterior', posterior: 'Posterior' }), get: (r) => region(r.tooth) }),
  factor({ key: 'tooth', label: 'Tooth (FDI)', group: 'Site', kind: 'categorical', dynamicLevels: true, get: (r) => String(r.tooth) }),

  factor({ key: 'technique', label: 'Guided / free hand', group: 'Surgical', kind: 'binary', levels: fromLabels(TECHNIQUE_LABELS),
    get: (r) => r.technique }),
  factor({ key: 'bone_type', label: 'Bone type', group: 'Surgical', kind: 'ordinal', levels: BONE_TYPES.map((b) => ({ value: b, label: b })),
    get: (r) => r.bone_type }),
  factor({ key: 'torque', label: 'Insertion torque', group: 'Surgical', kind: 'continuous', unit: 'Ncm', get: (r) => r.torque_ncm }),
  factor({ key: 'isq_placement', label: 'ISQ at placement', group: 'Surgical', kind: 'continuous', unit: 'ISQ', get: (r) => r.isq }),
  factor({ key: 'placement_timing', label: 'Placement timing', group: 'Surgical', kind: 'categorical', levels: fromLabels(PLACEMENT_TIMING_LABELS),
    get: (r) => r.placement_timing }),
  factor({ key: 'grafting', label: 'Grafting', group: 'Surgical', kind: 'binary', levels: YES_NO, get: (r) => r.grafting_performed }),
  factor({ key: 'membrane', label: 'Membrane', group: 'Surgical', kind: 'binary', levels: YES_NO, get: (r) => r.membrane_used }),
  factor({ key: 'sinus', label: 'Sinus procedure', group: 'Surgical', kind: 'binary', levels: YES_NO, get: (r) => r.sinus_procedure }),
  factor({ key: 'phenotype', label: 'Soft-tissue phenotype', group: 'Surgical', kind: 'binary', levels: fromLabels(PHENOTYPE_LABELS),
    get: (r) => r.soft_tissue_phenotype }),
  factor({ key: 'keratinized', label: 'Keratinized mucosa', group: 'Surgical', kind: 'continuous', unit: 'mm', get: (r) => r.keratinized_mucosa_mm }),
  factor({ key: 'flap', label: 'Flap', group: 'Surgical', kind: 'categorical', levels: fromLabels(FLAP_LABELS), get: (r) => r.flap }),
  factor({ key: 'healing', label: 'Healing', group: 'Surgical', kind: 'categorical', levels: fromLabels(HEALING_LABELS), get: (r) => r.healing }),

  factor({ key: 'delegate', label: 'Placing delegate', group: 'People', kind: 'categorical', dynamicLevels: true, get: (r) => r.placing_delegate_id }),
  factor({ key: 'supervisor', label: 'Supervisor', group: 'People', kind: 'categorical', dynamicLevels: true, get: (r) => r.supervisor_id }),
  factor({ key: 'course', label: 'Course', group: 'People', kind: 'categorical', dynamicLevels: true, get: (r) => r.course_id }),

  outcome({ key: 'survival', label: 'Implant survival', group: 'Outcome', kind: 'survival' }),
  outcome({ key: 'failed', label: 'Implant failure', group: 'Outcome', kind: 'binary', levels: YES_NO, get: (r) => yes(r.event) }),
  outcome({ key: 'latest_grade', label: 'Latest ICOI grade', group: 'Outcome', kind: 'ordinal',
    levels: ['I', 'II', 'III', 'IV'].map((g) => ({ value: g, label: `Grade ${g}` })), get: (r) => r.latest_grade }),
  outcome({ key: 'biological_complication', label: 'Biological complication', group: 'Outcome', kind: 'binary', levels: YES_NO,
    get: (r) => yes(r.biological_complications > 0) }),
  outcome({ key: 'mechanical_complication', label: 'Mechanical complication', group: 'Outcome', kind: 'binary', levels: YES_NO,
    get: (r) => yes(r.mechanical_complications > 0) }),
  outcome({ key: 'prosthetic_problem', label: 'Prosthetic problem', group: 'Outcome', kind: 'binary', levels: YES_NO,
    get: (r) => yes(r.restoration_problems > 0) }),
  outcome({ key: 'final_restoration', label: 'Final restoration fitted', group: 'Outcome', kind: 'binary', levels: YES_NO,
    get: (r) => yes(r.final_restoration_on !== null) }),
  { ...visit('bone_change', 'Marginal bone change', 'continuous', 'mm'), source: 'radiograph' },
  { ...visit('bone_mesial', 'Bone level, mesial', 'continuous', 'mm'), source: 'radiograph' },
  { ...visit('bone_distal', 'Bone level, distal', 'continuous', 'mm'), source: 'radiograph' },
  visit('isq', 'ISQ at follow-up', 'continuous', 'ISQ'),
  visit('isq_change', 'ISQ change since placement', 'continuous', 'ISQ'),
  visit('probing_max', 'Deepest probing depth', 'continuous', 'mm'),
  visit('bop', 'Bleeding on probing', 'binary'),
  visit('suppuration', 'Suppuration', 'binary'),
  visit('mobility', 'Mobility', 'binary'),
  visit('plaque', 'Plaque', 'binary'),
  visit('pain', 'Pain score', 'continuous', '/10'),
  visit('recession_facial', 'Recession, facial', 'continuous', 'mm'),
  visit('recession_mesial', 'Recession, mesial', 'continuous', 'mm'),
  visit('recession_distal', 'Recession, distal', 'continuous', 'mm'),
  visit('recession_max', 'Recession, deepest site', 'continuous', 'mm'),
]

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]))

export function variable(key: string): Variable | undefined {
  return BY_KEY.get(key)
}

export function factorChoices(): Variable[] {
  return VARIABLES.filter((v) => v.role !== 'outcome')
}

export function outcomeChoices(): Variable[] {
  return VARIABLES.filter((v) => v.role !== 'factor')
}

/** People and courses are listed by name, never by result (spec: no rankings). */
export function sortsByLabel(v: Variable): boolean {
  return v.key === 'delegate' || v.key === 'supervisor' || v.key === 'course'
}
