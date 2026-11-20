import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookingLink, SurgerySessions } from './surgery-sessions';

vi.mock('./actions', () => ({ addSurgeryDay: vi.fn() }));

const base = { date: '2030-03-02', courses: [], editable: true, coursesVisible: true };

describe('SurgerySessions', () => {
  it('a course organizer adds a surgery day only for a running course', () => {
    render(<SurgerySessions {...base} sessions={[]} teaching />);
    expect(screen.queryByText('Add surgery day')).not.toBeInTheDocument();
    expect(screen.getByText(/No course runs on this day/)).toBeInTheDocument();
  });

  it('a clinic has no surgery-day list and no Add clinic day', () => {
    const { container } = render(
      <SurgerySessions
        {...base}
        teaching={false}
        sessions={[{ id: 's1', title: 'Clinic day', start_time: '00:00:00', end_time: '23:59:00', room: null, course: null }]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Add clinic day')).not.toBeInTheDocument();
  });
});

describe('BookingLink', () => {
  it('a clinic books a surgery directly on the chosen date', () => {
    render(<BookingLink date="2030-03-02" teaching={false} />);
    expect(screen.getByRole('link', { name: 'Book surgery' })).toHaveAttribute('href', '/schedule/new?date=2030-03-02');
  });

  it('a course organizer keeps New booking', () => {
    render(<BookingLink date="2030-03-02" teaching />);
    expect(screen.getByRole('link', { name: 'New booking' })).toHaveAttribute('href', '/schedule/new?date=2030-03-02');
  });
});
