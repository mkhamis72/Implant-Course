import { describe, expect, it } from 'vitest';
import { consentCounts, consentLine, consentWarning, mergeConsent } from './consent';

describe('consentWarning', () => {
  it('counts refused and not recorded as missing', () => {
    expect(consentWarning({ patients: 40, yes: 28, no: 4, not_recorded: 8 })).toBe(
      '⚠ 12 of 40 patients have no research consent on file (8 not recorded, 4 refused)',
    );
  });

  it('is null when every patient consented, or there are none', () => {
    expect(consentWarning({ patients: 3, yes: 3, no: 0, not_recorded: 0 })).toBeNull();
    expect(consentWarning({ patients: 0, yes: 0, no: 0, not_recorded: 0 })).toBeNull();
  });
});

describe('consentLine', () => {
  it('gives the about-sheet value', () => {
    expect(consentLine({ patients: 40, yes: 28, no: 4, not_recorded: 8 })).toBe('28 yes, 4 no, 8 not recorded (of 40 patients)');
  });
});

describe('mergeConsent / consentCounts', () => {
  it('adds research_consent by patient code; a patient without a consent row is not_recorded', () => {
    const patients = [{ patient_code: 'P-AAAAAA', sex: 'female' }, { patient_code: 'P-BBBBBB', sex: 'male' }, { patient_code: 'P-CCCCCC', sex: null }];
    const merged = mergeConsent(patients, [
      { patient_code: 'P-BBBBBB', research_consent: 'no' },
      { patient_code: 'P-AAAAAA', research_consent: 'yes' },
    ]);
    expect(merged).toEqual([
      { patient_code: 'P-AAAAAA', sex: 'female', research_consent: 'yes' },
      { patient_code: 'P-BBBBBB', sex: 'male', research_consent: 'no' },
      { patient_code: 'P-CCCCCC', sex: null, research_consent: 'not_recorded' },
    ]);
    expect(consentCounts(merged)).toEqual({ patients: 3, yes: 1, no: 1, not_recorded: 1 });
  });
});
