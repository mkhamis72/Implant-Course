import { describe, it, expect } from 'vitest';
import { sessionLabel } from './labels';

describe('sessionLabel', () => {
  it('names the date, the course and the session', () => {
    expect(sessionLabel({ date: '2026-10-05', title: 'Day 1', course: { name: 'Course 12' } })).toBe('05 Oct 2026 · Course 12 · Day 1');
  });

  it('leaves out the course of a clinic day', () => {
    expect(sessionLabel({ date: '2026-10-05', title: 'Clinic day', course: null })).toBe('05 Oct 2026 · Clinic day');
  });
});
