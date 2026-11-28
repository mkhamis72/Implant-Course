import { describe, expect, it } from 'vitest';
import { statisticsTabs } from './tabs';

describe('statisticsTabs', () => {
  it('has the Courses tab for a course organizer', () => {
    expect(statisticsTabs('organizer', true).map((t) => t.label)).toEqual(['Results', 'Explore', 'Courses', 'Full arch', 'Studies']);
  });
  it('has no Courses tab in a clinic', () => {
    expect(statisticsTabs('admin', false).map((t) => t.label)).toEqual(['Results', 'Explore', 'Full arch', 'Studies', 'Recent exports']);
  });
});
