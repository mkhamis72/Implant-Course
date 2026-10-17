import type { MedicalHistory } from './types';

type AlertInput = Pick<
  MedicalHistory,
  'allergies' | 'bisphosphonates_status' | 'anticoagulants_status' | 'radiotherapy_status' | 'diabetes_status' | 'osteoporosis_status' | 'smoking'
>;

const NO_ALLERGY = /^(none|nil|no|nkda|n\/a|-)$/i;
const MAX_ALLERGY = 40;

/** Implant-relevant alerts, most serious first. */
export function medicalAlerts(h: AlertInput | null): string[] {
  if (!h) return [];
  const alerts: string[] = [];
  const allergies = h.allergies.trim();
  if (allergies && !NO_ALLERGY.test(allergies)) {
    alerts.push(`Allergy: ${allergies.length > MAX_ALLERGY ? `${allergies.slice(0, MAX_ALLERGY - 1)}…` : allergies}`);
  }
  if (h.bisphosphonates_status === 'yes') alerts.push('Bisphosphonates');
  if (h.anticoagulants_status === 'yes') alerts.push('Anticoagulants');
  if (h.radiotherapy_status === 'yes') alerts.push('Head/neck radiotherapy');
  if (h.diabetes_status === 'yes') alerts.push('Diabetes');
  if (h.osteoporosis_status === 'yes') alerts.push('Osteoporosis');
  if (h.smoking === 'current') alerts.push('Smoker');
  return alerts;
}
