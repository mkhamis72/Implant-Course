import type { MedicalHistory } from './types';

export const YES_NO = ['yes', 'no'] as const;
export type YesNo = (typeof YES_NO)[number];
export const SMOKING = ['never', 'former', 'current'] as const;
export type Smoking = (typeof SMOKING)[number];

export type RiskKey =
  | 'smoking' | 'diabetes_status' | 'bisphosphonates_status' | 'anticoagulants_status' | 'radiotherapy_status'
  | 'osteoporosis_status' | 'periodontitis_history' | 'bruxism' | 'previous_implant_failure';

type Option = { value: string; label: string };
const NOT_ASSESSED: Option = { value: '', label: 'Not assessed' };
const YES_NO_OPTIONS: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, NOT_ASSESSED];

/** The risk-factor questions on the medical history, in display order. An empty answer means not assessed. */
export const RISK_QUESTIONS: { key: RiskKey; label: string; options: Option[] }[] = [
  { key: 'smoking', label: 'Smoking', options: [
    { value: 'never', label: 'Never' }, { value: 'former', label: 'Former' }, { value: 'current', label: 'Current' }, NOT_ASSESSED,
  ] },
  { key: 'diabetes_status', label: 'Diabetes', options: YES_NO_OPTIONS },
  { key: 'bisphosphonates_status', label: 'Bisphosphonates', options: YES_NO_OPTIONS },
  { key: 'anticoagulants_status', label: 'Anticoagulants', options: YES_NO_OPTIONS },
  { key: 'radiotherapy_status', label: 'Head/neck radiotherapy', options: YES_NO_OPTIONS },
  { key: 'osteoporosis_status', label: 'Osteoporosis', options: YES_NO_OPTIONS },
  { key: 'periodontitis_history', label: 'Periodontitis history', options: YES_NO_OPTIONS },
  { key: 'bruxism', label: 'Bruxism / parafunction', options: YES_NO_OPTIONS },
  { key: 'previous_implant_failure', label: 'Previous implant failure', options: YES_NO_OPTIONS },
];

export function notAssessedCount(h: Pick<MedicalHistory, RiskKey>): number {
  return RISK_QUESTIONS.filter((q) => h[q.key] === null || h[q.key] === undefined).length;
}
