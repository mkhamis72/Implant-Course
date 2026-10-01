import { describe, it, expect } from 'vitest';
import { medicalAlerts } from './alerts';

const none = {
  allergies: '', bisphosphonates: false, anticoagulants: false, radiotherapy_head_neck: false,
  diabetes: false, osteoporosis: false, smoker: false,
};

describe('medicalAlerts', () => {
  it('is empty for a healthy history or no history', () => {
    expect(medicalAlerts(none)).toEqual([]);
    expect(medicalAlerts(null)).toEqual([]);
  });
  it('lists alerts most serious first', () => {
    expect(
      medicalAlerts({ ...none, allergies: 'Penicillin', smoker: true, bisphosphonates: true, diabetes: true }),
    ).toEqual(['Allergy: Penicillin', 'Bisphosphonates', 'Diabetes', 'Smoker']);
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
