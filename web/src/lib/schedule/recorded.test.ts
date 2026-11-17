import { describe, it, expect } from 'vitest';
import { placedByRecordedDelegates } from './recorded';

describe('placedByRecordedDelegates', () => {
  it('is a booking with a supervisor and no doctor', () => {
    expect(placedByRecordedDelegates({ supervisor_id: 's', placing_doctor_id: null })).toBe(true);
    expect(placedByRecordedDelegates({ supervisor_id: 's', placing_doctor_id: 'd' })).toBe(false);
    expect(placedByRecordedDelegates({ supervisor_id: null, placing_doctor_id: 'd' })).toBe(false);
  });
});
