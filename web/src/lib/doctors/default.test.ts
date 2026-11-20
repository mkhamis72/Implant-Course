import { describe, it, expect } from 'vitest';
import { defaultDoctorId } from './default';

const doctors = [
  { id: 'doc1', user_id: 'other', active: true },
  { id: 'doc2', user_id: 'me', active: true },
  { id: 'doc3', user_id: null, active: true },
];

describe('defaultDoctorId', () => {
  it('is the active doctor linked to my login', () => {
    expect(defaultDoctorId(doctors, 'me')).toBe('doc2');
  });
  it('inactive linked doctor is not the default', () => {
    expect(defaultDoctorId([{ id: 'doc2', user_id: 'me', active: false }], 'me')).toBe('');
  });
  it('is empty when my login is not linked to a doctor', () => {
    expect(defaultDoctorId(doctors, 'someone-else')).toBe('');
    expect(defaultDoctorId([], 'me')).toBe('');
  });
});
