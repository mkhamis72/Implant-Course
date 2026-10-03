import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotForm } from './slot-form';

vi.mock('../actions', () => ({ bookSurgery: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const props = {
  chairs: [], patients: [], enrolled: {}, implants: [], supervisors: [], me: '',
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

  it('starts with no supervisor when the current user is not on the list', () => {
    render(<SlotForm {...props} me="u-me" supervisors={[{ id: 'sup1', label: 'Prof. Laila Samir' }]} sessions={[]} />);
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('');
  });

  it('selects the current user when they are on the list', () => {
    render(<SlotForm {...props} me="sup1" supervisors={[{ id: 'sup1', label: 'Dr Me' }]} sessions={[]} />);
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('sup1');
  });

  it('points to Admin → Supervisors when the list is empty', () => {
    render(<SlotForm {...props} sessions={[]} />);
    expect(screen.getByText(/No supervisors yet/)).toBeInTheDocument();
  });
});
