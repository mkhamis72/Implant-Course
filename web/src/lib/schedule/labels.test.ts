import { describe, it, expect } from 'vitest';
import { sessionLabel, whereLine } from './labels';

describe('sessionLabel', () => {
  it('names the date, the course and the session', () => {
    expect(sessionLabel({ date: '2026-10-05', title: 'Day 1', course: { name: 'Course 12' } })).toBe('05 Oct 2026 · Course 12 · Day 1');
  });

  it('leaves out the course of a clinic day', () => {
    expect(sessionLabel({ date: '2026-10-05', title: 'Clinic day', course: null })).toBe('05 Oct 2026 · Clinic day');
  });
});

describe('whereLine', () => {
  it('names where a clinic booking happens', () => {
    expect(whereLine('hospital_ga', false)).toBe('Where: GA in hospital');
    expect(whereLine('clinic', false)).toBe('Where: In clinic');
  });

  it('says nothing when unset, or for a course organizer', () => {
    expect(whereLine(null, false)).toBeNull();
    expect(whereLine('clinic', true)).toBeNull();
  });
});
