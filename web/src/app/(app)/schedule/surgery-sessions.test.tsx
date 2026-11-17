import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurgerySessions } from './surgery-sessions';

vi.mock('./actions', () => ({ addSurgeryDay: vi.fn() }));

const base = { date: '2030-03-02', courses: [], editable: true, coursesVisible: true };

describe('SurgerySessions', () => {
  it('a course organizer adds a surgery day only for a running course', () => {
    render(<SurgerySessions {...base} sessions={[]} teaching />);
    expect(screen.queryByText('Add surgery day')).not.toBeInTheDocument();
    expect(screen.getByText(/No course runs on this day/)).toBeInTheDocument();
  });

  it('a clinic adds a clinic day on any day and sees no course names', () => {
    render(
      <SurgerySessions
        {...base}
        teaching={false}
        sessions={[{ id: 's1', title: 'Clinic day', start_time: '08:00:00', end_time: '17:00:00', room: null, course: null }]}
      />,
    );
    expect(screen.getByText('Add clinic day', { selector: 'summary' })).toBeInTheDocument();
    expect(screen.queryByText(/course/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Course' })).not.toBeInTheDocument();
  });
});
