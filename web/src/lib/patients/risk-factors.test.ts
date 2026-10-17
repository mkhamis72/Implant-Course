import { describe, it, expect } from 'vitest';
import { RISK_QUESTIONS, notAssessedCount } from './risk-factors';

const blank = {
  smoking: null, diabetes_status: null, bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
} as const;

describe('risk factors', () => {
  it('asks nine questions, smoking first with its own options', () => {
    expect(RISK_QUESTIONS).toHaveLength(9);
    expect(RISK_QUESTIONS[0]).toMatchObject({ key: 'smoking', label: 'Smoking' });
    expect(RISK_QUESTIONS[0].options.map((o) => o.label)).toEqual(['Never', 'Former', 'Current', 'Not assessed']);
    expect(RISK_QUESTIONS[1].options.map((o) => [o.value, o.label])).toEqual([['yes', 'Yes'], ['no', 'No'], ['', 'Not assessed']]);
  });
  it('counts the questions not assessed; a "no" counts as assessed', () => {
    expect(notAssessedCount(blank)).toBe(9);
    expect(notAssessedCount({ ...blank, smoking: 'never', bruxism: 'no', diabetes_status: 'yes' })).toBe(6);
  });
});
