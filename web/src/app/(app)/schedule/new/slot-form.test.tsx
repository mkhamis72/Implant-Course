import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotForm } from './slot-form';

vi.mock('../actions', () => ({ bookSurgery: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const props = {
  chairs: [], patients: [], enrolled: {}, implants: [], organizers: [], me: '',
  initial: { sessionId: '', chairId: '', start: '09:00', fileNo: '' },
};

describe('SlotForm', () => {
  it('explains where to add a session when there are no upcoming surgery sessions', () => {
    render(<SlotForm {...props} sessions={[]} />);
    expect(screen.getByText(/No upcoming surgery sessions/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
  });

  it('lists the upcoming sessions without the hint', () => {
    render(<SlotForm {...props} sessions={[{ id: 's1', label: '05 Oct 2026 · Course · Day 1', courseId: 'c1' }]} />);
    expect(screen.getByRole('option', { name: '05 Oct 2026 · Course · Day 1' })).toBeInTheDocument();
    expect(screen.queryByText(/No upcoming surgery sessions/)).not.toBeInTheDocument();
  });
});
