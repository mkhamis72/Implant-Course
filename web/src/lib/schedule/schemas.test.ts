import { describe, it, expect } from 'vitest';
import {
  cancelSlotSchema, correctionSchema, courseSchema, lecturerSchema, sessionSchema, slotSchema, slotStatusSchema, supervisorSchema,
  talkSchema, updateSlotSchema, updateTalkSchema,
} from './schemas';

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
  it('stores a blank room as null and trims a given one', () => {
    const s = { course_id: id, type: 'lecture', title: 'Day 1 lectures', date: '2030-03-02', start_time: '09:00', end_time: '13:00' };
    expect(sessionSchema.parse({ ...s, room: '  ' })).toMatchObject({ room: null });
    expect(sessionSchema.parse(s)).toMatchObject({ room: null });
    expect(sessionSchema.parse({ ...s, room: ' Hall A ' })).toMatchObject({ room: 'Hall A' });
    expect(err(sessionSchema.safeParse({ ...s, room: 'x'.repeat(121) }))).toBe('Keep the room under 120 characters.');
  });
});

describe('slotSchema', () => {
  const slot = {
    sessionId: id, chairId: id, start: '09:00', end: '10:30', patientFileNo: ' P00012 ', supervisorId: id,
    placing: [id], assisting: [], implants: [{ tooth: '36', productId: '', technique: 'guided' }], overrideReason: '', notes: '',
  };
  it('normalizes the booking', () => {
    expect(slotSchema.parse(slot)).toMatchObject({ patientFileNo: 'P00012', implants: [{ tooth: 36, productId: null, technique: 'guided' }] });
  });
  it('explains what is missing', () => {
    expect(err(slotSchema.safeParse({ ...slot, end: '08:00' }))).toBe('The end time must be after the start time.');
    expect(err(slotSchema.safeParse({ ...slot, placing: [] }))).toBe('Choose at least one placing delegate.');
    expect(err(slotSchema.safeParse({ ...slot, patientFileNo: '' }))).toBe('Choose the patient.');
    expect(err(slotSchema.safeParse({ ...slot, implants: [{ tooth: '19', productId: '', technique: 'guided' }] }))).toBe('Unknown tooth number.');
    expect(err(slotSchema.safeParse({ ...slot, implants: [{ tooth: '36', productId: '' }] }))).toBe(
      'Choose Guided or Free hand for each implant.',
    );
  });
});

describe('updateSlotSchema', () => {
  const edit = {
    slotId: id, chairId: id, start: '11:00', end: '12:00', supervisorId: id, placing: [id], assisting: [],
    implants: [{ siteId: id, technique: 'free_hand' }], overrideReason: '', notes: ' moved ',
  };
  it('normalizes the edit', () => {
    expect(updateSlotSchema.parse(edit)).toMatchObject({ notes: 'moved', implants: [{ siteId: id, technique: 'free_hand' }] });
  });
  it('explains what is wrong', () => {
    expect(err(updateSlotSchema.safeParse({ ...edit, end: '10:00' }))).toBe('The end time must be after the start time.');
    expect(err(updateSlotSchema.safeParse({ ...edit, placing: [] }))).toBe('Choose at least one placing delegate.');
  });
});

describe('slotStatusSchema', () => {
  it('only allows scheduled and done', () => {
    expect(slotStatusSchema.parse({ slotId: id, status: 'done' })).toEqual({ slotId: id, status: 'done' });
    expect(err(slotStatusSchema.safeParse({ slotId: id, status: 'cancelled' }))).toBe('Unknown status.');
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

describe('supervisorSchema', () => {
  it('trims the name and requires 2–120 characters', () => {
    expect(supervisorSchema.parse({ full_name: '  Prof. Laila Samir ' })).toEqual({ full_name: 'Prof. Laila Samir' });
    expect(supervisorSchema.safeParse({ full_name: '   ' }).success).toBe(false);
    expect(supervisorSchema.safeParse({ full_name: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('talk schemas', () => {
  const talk = { session_id: id, start: '09:00', end: '10:00', lecturer_id: id, topic: '  Sinus lift  ', notes: '' };
  it('normalizes a talk', () => {
    expect(talkSchema.parse(talk)).toEqual({ ...talk, topic: 'Sinus lift' });
  });
  it('explains what is missing', () => {
    expect(err(talkSchema.safeParse({ ...talk, session_id: '' }))).toBe('Choose a session.');
    expect(err(talkSchema.safeParse({ ...talk, lecturer_id: '' }))).toBe('Choose a lecturer.');
    expect(err(talkSchema.safeParse({ ...talk, topic: 'x' }))).toBe('Enter a topic.');
    expect(err(talkSchema.safeParse({ ...talk, start: '9am' }))).toBe('Enter the start time (HH:MM).');
    expect(err(talkSchema.safeParse({ ...talk, end: '09:00' }))).toBe('The end time must be after the start time.');
  });
  it('updates by talk id', () => {
    const { session_id: _s, ...rest } = talk;
    expect(updateTalkSchema.parse({ ...rest, talk_id: id })).toMatchObject({ talk_id: id, topic: 'Sinus lift' });
    expect(err(updateTalkSchema.safeParse({ ...rest, talk_id: 'x' }))).toBe('Talk not found.');
  });
  it('requires a lecturer name', () => {
    expect(err(lecturerSchema.safeParse({ full_name: ' A ' }))).toBe('Enter the lecturer’s name.');
    expect(lecturerSchema.parse({ full_name: ' Prof. Laila Samir ' })).toEqual({ full_name: 'Prof. Laila Samir' });
  });
});
