import { describe, it, expect, vi } from 'vitest';
import { medicalHistorySchema, noteSchema, patientSchema, toPatientRow, toothStatusSchema } from './schemas';

const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('patientSchema', () => {
  it('trims and normalizes, turning empty optionals into nulls / omitting file_no', () => {
    const parsed = patientSchema.parse({ full_name: '  Amira Fathy ', email: ' A@B.COM ', phone: ' 0100 ' });
    expect(parsed).toMatchObject({ full_name: 'Amira Fathy', email: 'a@b.com', phone: '0100', dob: '', sex: '' });
    expect(toPatientRow(parsed)).toEqual({
      full_name: 'Amira Fathy', dob: null, sex: null, phone: '0100', email: 'a@b.com', address: '',
    });
    expect(toPatientRow({ ...parsed, file_no: 'F-9' })).toMatchObject({ file_no: 'F-9' });
  });
  it('rejects a short name', () => {
    expect(firstError(patientSchema.safeParse({ full_name: 'A' }))).toBe(
      'Enter the patient’s full name (at least 2 characters).',
    );
  });
  it.each(['2999-01-01', '1899-12-31', '2026-02-30', '01/02/1990'])('rejects date of birth %s', (dob) => {
    expect(firstError(patientSchema.safeParse({ full_name: 'Amira', dob }))).toBe(
      'Enter a real date of birth (not in the future, after 1900).',
    );
  });
  it('rejects a bad email', () => {
    expect(firstError(patientSchema.safeParse({ full_name: 'Amira', email: 'nope' }))).toBe(
      'Enter a valid email address or leave it empty.',
    );
  });
});

describe('medicalHistorySchema', () => {
  it('reads checkboxes ("on" or missing) as booleans', () => {
    const parsed = medicalHistorySchema.parse({ diabetes: 'on', allergies: ' Latex ' });
    expect(parsed).toMatchObject({ diabetes: true, smoker: false, allergies: 'Latex' });
  });
});

describe('noteSchema', () => {
  it('parses teeth and trims text', () => {
    expect(noteSchema.parse({ visit_date: '2026-01-10', text: ' Sutures out ', teeth: '46, 36' })).toEqual({
      visit_date: '2026-01-10', text: 'Sutures out', teeth: [36, 46],
    });
  });
  it('rejects an empty note, a future date and bad teeth', () => {
    expect(firstError(noteSchema.safeParse({ visit_date: '2026-01-10', text: '  ' }))).toBe('Write the note.');
    expect(firstError(noteSchema.safeParse({ visit_date: '2999-01-01', text: 'x' }))).toBe(
      'Enter the visit date (today or earlier).',
    );
    expect(firstError(noteSchema.safeParse({ visit_date: '2026-01-10', text: 'x', teeth: '19' }))).toMatch(
      /"19" is not a tooth number/,
    );
  });
});

describe('toothStatusSchema', () => {
  const patient_id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('accepts manual statuses for valid teeth', () => {
    expect(toothStatusSchema.parse({ patient_id, teeth: [36, 46], status: 'missing' })).toEqual({
      patient_id, teeth: [36, 46], status: 'missing',
    });
  });
  it('refuses implant statuses, no teeth and invalid teeth', () => {
    expect(toothStatusSchema.safeParse({ patient_id, teeth: [36], status: 'implant_placed' }).success).toBe(false);
    expect(firstError(toothStatusSchema.safeParse({ patient_id, teeth: [], status: 'missing' }))).toBe(
      'Select at least one tooth.',
    );
    expect(toothStatusSchema.safeParse({ patient_id, teeth: [19], status: 'missing' }).success).toBe(false);
  });
});

describe('dates use Cairo "today" (I3)', () => {
  it('accepts today’s Cairo date just after midnight Cairo, while UTC is still yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T22:30:00Z')); // 01:30 on 2 Oct in Cairo (UTC+3)
    try {
      expect(noteSchema.safeParse({ visit_date: '2026-10-02', text: 'x' }).success).toBe(true);
      expect(noteSchema.safeParse({ visit_date: '2026-10-03', text: 'x' }).success).toBe(false);
      expect(patientSchema.safeParse({ full_name: 'Newborn', dob: '2026-10-02' }).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
