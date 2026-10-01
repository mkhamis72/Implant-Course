import { describe, it, expect, vi } from 'vitest';
import { patientSaveError } from './save-errors';

describe('patientSaveError', () => {
  it('names a typed duplicate file number (case-insensitive clash included)', () => {
    expect(patientSaveError({ code: '23505', message: 'dup' }, 'F-9')).toBe('File number F-9 is already used by another patient.');
  });
  it('never shows a blank number when the automatic number clashed', () => {
    expect(patientSaveError({ code: '23505', message: 'dup' }, '')).toBe(
      'The automatic file number was just taken by another patient. Click Save again.',
    );
  });
  it('hides other database errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(patientSaveError({ code: '42501', message: 'permission denied' }, '')).toBe(
      'The patient could not be saved. Please try again.',
    );
  });
});
