import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { courseExploreHref, courseOverview } from '@/lib/analysis/course-overview';
import { implantRow } from '@/lib/analysis/test-rows';
import { CourseView } from './course-view';

const summaries = courseOverview(
  {
    visits: [],
    radiographs: [],
    implants: [
      implantRow({ site_id: 'a', course_id: 'c1', patient_id: 'p1' }),
      implantRow({ site_id: 'b', course_id: 'c1', patient_id: 'p1' }),
      implantRow({ site_id: 'c', course_id: 'c2', patient_id: 'p2' }),
    ],
  },
  [{ id: 'c1', name: 'Old', start_date: '2025-01-01' }, { id: 'c2', name: 'New', start_date: '2024-01-01' }],
  '2026-01-01',
);
const [old, recent] = summaries;

describe('CourseView', () => {
  it('lists courses with a tick box, implants and an Explore link', () => {
    render(<CourseView summaries={summaries} selected={[]} />);
    expect(screen.getByRole('checkbox', { name: 'Compare Old' })).not.toBeChecked();
    expect(screen.getByText(/Old · .* · 2 implants · 1 patient/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore Old' })).toHaveAttribute('href', courseExploreHref(['c1']));
    expect(screen.queryByRole('table', { name: 'Side-by-side comparison' })).toBeNull();
  });

  it('warns on a thin course but still shows its numbers', () => {
    render(<CourseView summaries={[old]} selected={[]} />);
    expect(screen.getByText(/Small sample/)).toBeInTheDocument();
    expect(screen.getByText(/2 implants/)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Old in detail' })).getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('shows a side-by-side table for two ticked courses, one column each', () => {
    render(<CourseView summaries={summaries} selected={[old, recent]} />);
    const table = screen.getByRole('table', { name: 'Side-by-side comparison' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Measure', 'Old', 'New']);
    for (const cell of within(table).getAllByRole('cell')) expect(cell).toHaveAttribute('data-label');
    expect(screen.getByRole('link', { name: 'Explore these courses' })).toHaveAttribute('href', courseExploreHref(['c1', 'c2']));
    expect(screen.getByText('Counts describe each course; they are not a ranking. Later courses have had less time for follow-up.')).toBeInTheDocument();
  });

  it('asks for another course when one is ticked, with no table', () => {
    render(<CourseView summaries={summaries} selected={[old]} />);
    expect(screen.getByText('Tick at least two courses to compare them.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Side-by-side comparison' })).toBeNull();
  });

  it('keeps ticked boxes checked', () => {
    render(<CourseView summaries={summaries} selected={[recent]} />);
    expect(screen.getByRole('checkbox', { name: 'Compare New' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Compare Old' })).not.toBeChecked();
  });

  it('says so when there are no courses', () => {
    render(<CourseView summaries={[]} selected={[]} />);
    expect(screen.getByText('No courses yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  });
});
