import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotForm } from './slot-form';

vi.mock('../actions', () => ({ bookSurgery: vi.fn(), updateBooking: vi.fn() }));
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

  it('asks for a technique on each implant row', () => {
    render(<SlotForm {...props} sessions={[]} />);
    expect(screen.getByRole('combobox', { name: 'Technique 1' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Guided' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Free hand' })).toBeInTheDocument();
  });

  it('edits a booking with its day and patient fixed and its people prefilled', () => {
    render(
      <SlotForm
        {...props}
        sessions={[{ id: 's1', label: '', courseId: 'c1' }]}
        chairs={[{ id: 'ch1', label: 'Chair A' }]}
        supervisors={[{ id: 'sup1', label: 'Prof. Laila Samir' }]}
        enrolled={{ c1: [{ id: 'd1', label: 'Dr One' }, { id: 'd2', label: 'Dr Two' }] }}
        edit={{
          slotId: 'slot1', sessionId: 's1', sessionLabel: '05 Oct 2026 · Course · Day 1', patientLabel: 'Amal Hassan (P00012)',
          chairId: 'ch1', supervisorId: 'sup1', start: '09:00', end: '10:00', roles: { d1: 'placing', d2: 'assisting' },
          implants: [{ siteId: 'site1', tooth: 36, label: 'Oxy 4.0 × 10', technique: 'guided' }], notes: 'Bring guide',
        }}
      />,
    );
    expect(screen.getByText('Amal Hassan (P00012)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Surgery session' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Patient (file number)')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role of Dr One' })).toHaveValue('placing');
    expect(screen.getByRole('combobox', { name: 'Role of Dr Two' })).toHaveValue('assisting');
    expect(screen.getByRole('combobox', { name: 'Technique 1' })).toHaveValue('guided');
    expect(screen.getByLabelText('End')).toHaveValue('10:00');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
