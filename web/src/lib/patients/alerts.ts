import type { MedicalHistory } from './types';

type AlertInput = Pick<
  MedicalHistory,
  'allergies' | 'bisphosphonates' | 'anticoagulants' | 'radiotherapy_head_neck' | 'diabetes' | 'osteoporosis' | 'smoker'
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
  if (h.bisphosphonates) alerts.push('Bisphosphonates');
  if (h.anticoagulants) alerts.push('Anticoagulants');
  if (h.radiotherapy_head_neck) alerts.push('Head/neck radiotherapy');
  if (h.diabetes) alerts.push('Diabetes');
  if (h.osteoporosis) alerts.push('Osteoporosis');
  if (h.smoker) alerts.push('Smoker');
  return alerts;
}
