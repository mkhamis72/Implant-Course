import { describe, it, expect } from 'vitest';
import { cancelSlotSchema, correctionSchema, courseSchema, sessionSchema, slotSchema } from './schemas';

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('course and session schemas', () => {
  it('validates course dates', () => {
    expect(courseSchema.parse({ name: ' Implant Course 12 ', start_date: '2030-03-01', end_date: '2030-03-05' })).toMatchObject({
      name: 'Implant Course 12', venue: '',
    });
    expect(err(courseSchema.safeParse({ name: 'X Y', start_date: '2030-03-05', end_date: '2030-03-01' }))).toBe(
      'The course must end on or after its start date.',
    );
  });
  it('validates session times', () => {
    const s = { course_id: id, type: 'surgery', title: 'Day 1 surgery', date: '2030-03-02', start_time: '08:00', end_time: '17:00' };
    expect(sessionSchema.parse(s)).toMatchObject({ lead_organizer_id: null });
    expect(err(sessionSchema.safeParse({ ...s, end_time: '07:00' }))).toBe('The session must end after it starts.');
  });
});

describe('slotSchema', () => {
  const slot = {
    sessionId: id, chairId: id, start: '09:00', end: '10:30', patientFileNo: ' P00012 ', supervisorId: id,
    placing: [id], assisting: [], implants: [{ tooth: '36', productId: '' }], overrideReason: '', notes: '',
  };
  it('normalizes the booking', () => {
    expect(slotSchema.parse(slot)).toMatchObject({ patientFileNo: 'P00012', implants: [{ tooth: 36, productId: null }] });
  });
  it('explains what is missing', () => {
    expect(err(slotSchema.safeParse({ ...slot, end: '08:00' }))).toBe('The end time must be after the start time.');
    expect(err(slotSchema.safeParse({ ...slot, placing: [] }))).toBe('Choose at least one placing delegate.');
    expect(err(slotSchema.safeParse({ ...slot, patientFileNo: '' }))).toBe('Choose the patient.');
    expect(err(slotSchema.safeParse({ ...slot, implants: [{ tooth: '19', productId: '' }] }))).toBe('Unknown tooth number.');
  });
});

describe('reasons', () => {
  it('require at least 3 characters', () => {
    expect(err(cancelSlotSchema.safeParse({ slotId: id, reason: 'no' }))).toBe('Explain why (at least 3 characters).');
    expect(err(correctionSchema.safeParse({ siteId: id, patientId: id, newLotId: id, reason: ' ' }))).toBe(
      'Explain the correction (at least 3 characters).',
    );
  });
});
