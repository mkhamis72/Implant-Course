import { describe, it, expect } from 'vitest';
import { medicalAlerts } from './alerts';

const none = {
  allergies: '', bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  diabetes_status: null, osteoporosis_status: null, smoking: null,
} as const;

describe('medicalAlerts', () => {
  it('is empty for a healthy history or no history', () => {
    expect(medicalAlerts(none)).toEqual([]);
    expect(medicalAlerts(null)).toEqual([]);
  });
  it('lists alerts most serious first, only for yes answers and current smokers', () => {
    expect(
      medicalAlerts({ ...none, allergies: 'Penicillin', smoking: 'current', bisphosphonates_status: 'yes', diabetes_status: 'yes' }),
    ).toEqual(['Allergy: Penicillin', 'Bisphosphonates', 'Diabetes', 'Smoker']);
    expect(medicalAlerts({ ...none, smoking: 'former', diabetes_status: 'no', osteoporosis_status: 'no' })).toEqual([]);
  });
  it.each(['none', 'NKDA', 'nil', 'No', 'n/a', '-'])('ignores "%s" as an allergy', (text) => {
    expect(medicalAlerts({ ...none, allergies: text })).toEqual([]);
  });
  it('shortens long allergy text', () => {
    const [alert] = medicalAlerts({ ...none, allergies: 'a'.repeat(60) });
    expect(alert).toHaveLength('Allergy: '.length + 40);
    expect(alert.endsWith('…')).toBe(true);
  });
});
