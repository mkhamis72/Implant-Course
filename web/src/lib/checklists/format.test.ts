import { describe, it, expect } from 'vitest';
import { doneLabel, progressOf, scopeLabel, sessionHref } from './format';

describe('checklist format', () => {
  it('summarises progress', () => {
    expect(progressOf([{ done_at: 'x' }, { done_at: null }, { done_at: 'y' }])).toEqual({ done: 2, total: 3, label: '2/3 done' });
    expect(progressOf([])).toEqual({ done: 0, total: 0, label: 'No items' });
  });
  it('labels who ticked and when (time today, date otherwise, Cairo)', () => {
    expect(doneLabel('Dr Amira', '2026-01-15T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 12:05');
    expect(doneLabel('Dr Amira', '2026-01-14T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 14 Jan 2026, 12:05');
  });
});

describe('clinic checklists', () => {
  it('links a session with a course to the course, when teaching', () => {
    expect(sessionHref({ date: '2026-12-01', course_id: 'c1' }, true)).toBe('/courses/c1');
  });
  it('links a clinic day, or any session when teaching is off, to the schedule date', () => {
    expect(sessionHref({ date: '2026-12-01', course_id: null }, true)).toBe('/schedule?date=2026-12-01');
    expect(sessionHref({ date: '2026-12-01', course_id: 'c1' }, false)).toBe('/schedule?date=2026-12-01');
  });
  it('calls the surgery-day template scope Clinic day only when teaching is off', () => {
    expect(scopeLabel('surgery', true)).toBe('Surgery session');
    expect(scopeLabel('surgery', false)).toBe('Clinic day');
    expect(scopeLabel('lecture', false)).toBe('Lecture');
  });
});
