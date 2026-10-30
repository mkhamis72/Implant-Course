import { describe, it, expect } from 'vitest';
import { delegatesForCourse, keepIfEnrolled, withRecordedDelegate } from './enrolled';

const delegates = [{ id: 'd1', label: 'Amira' }, { id: 'd2', label: 'Omar' }];
const enrollments = [{ course_id: 'c1', delegate_id: 'd1' }, { course_id: 'c2', delegate_id: 'd2' }];

describe('delegatesForCourse', () => {
  it('lists only those enrolled in the course', () => {
    expect(delegatesForCourse(delegates, enrollments, 'c1')).toEqual([delegates[0]]);
    expect(delegatesForCourse(delegates, enrollments, 'c3')).toEqual([]);
  });

  it('lists everyone with no course', () => {
    expect(delegatesForCourse(delegates, enrollments, '')).toEqual(delegates);
  });

  it('leaves out an enrolled delegate who is inactive', () => {
    expect(delegatesForCourse([delegates[1]], enrollments, 'c1')).toEqual([]);
  });
});

describe('keepIfEnrolled', () => {
  it('keeps an enrolled delegate and clears any other', () => {
    expect(keepIfEnrolled(enrollments, 'c1', 'd1')).toBe('d1');
    expect(keepIfEnrolled(enrollments, 'c1', 'd2')).toBe('');
  });

  it('keeps the delegate when the course is emptied, and nobody stays nobody', () => {
    expect(keepIfEnrolled(enrollments, '', 'd2')).toBe('d2');
    expect(keepIfEnrolled(enrollments, 'c1', '')).toBe('');
  });
});

describe('withRecordedDelegate', () => {
  it('adds a recorded delegate and says why they are not listed', () => {
    const list = [delegates[0]];
    expect(withRecordedDelegate(list, delegates, 'd2', 'Omar')).toEqual([delegates[0], { id: 'd2', label: 'Omar (not enrolled)' }]);
    expect(withRecordedDelegate(list, delegates, 'gone', 'Salma')).toEqual([delegates[0], { id: 'gone', label: 'Salma (inactive)' }]);
  });

  it('adds nothing when already listed or nobody is chosen', () => {
    expect(withRecordedDelegate(delegates, delegates, 'd1', 'Amira')).toEqual(delegates);
    expect(withRecordedDelegate(delegates, delegates, '', null)).toEqual(delegates);
  });
});
