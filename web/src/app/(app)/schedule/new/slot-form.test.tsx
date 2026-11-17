import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SlotForm } from './slot-form';
import { bookSurgery } from '../actions';

vi.mock('../actions', () => ({ bookSurgery: vi.fn(async () => ({ error: 'stop' })), updateBooking: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const props = {
  chairs: [], patients: [], enrolled: {}, implants: [], supervisors: [], me: '', teaching: true, doctors: [],
  initial: { sessionId: '', chairId: '', start: '09:00', fileNo: '' },
};

describe('SlotForm', () => {
  it('explains where to add a session when there are no upcoming surgery sessions', () => {
    render(<SlotForm {...props} sessions={[]} />);
    expect(screen.getByText(/No upcoming surgery sessions/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
    expect(screen.getByRole('link', { name: 'Add surgery day' })).toHaveAttribute('href', '/schedule');
  });

  it('links Add surgery day to the Schedule page for the chosen date', () => {
    render(<SlotForm {...props} sessions={[]} initial={{ ...props.initial, date: '2030-03-02' }} />);
    expect(screen.getByRole('link', { name: 'Add surgery day' })).toHaveAttribute('href', '/schedule?date=2030-03-02');
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
          implants: [{ siteId: 'site1', tooth: 36, label: 'Oxy 4.0 × 10', technique: 'guided' }], notes: 'Bring guide', placingDoctorId: '',
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


describe('SlotForm: placed by', () => {
  const people = {
    ...props,
    sessions: [{ id: 's1', label: 'Day 1', courseId: 'c1' }],
    initial: { ...props.initial, sessionId: 's1' },
    enrolled: { c1: [{ id: 'd1', label: 'Dr One' }, { id: 'd2', label: 'Dr Two' }] },
    supervisors: [{ id: 'sup1', label: 'Prof. Laila Samir' }],
    me: 'sup1',
    doctors: [{ id: 'doc1', label: 'Dr Hany Fouad' }],
  };

  it('is placed by a delegate by default, with the supervisor required', () => {
    render(<SlotForm {...people} />);
    expect(screen.getByRole('radio', { name: 'Delegate' })).toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Doctor' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('sup1');
    expect(screen.getAllByRole('option', { name: 'Placing' })).toHaveLength(2);
  });

  it('with a doctor: no placing delegates, the supervisor optional, and the doctor submitted', async () => {
    render(<SlotForm {...people} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Role of Dr One' }), { target: { value: 'placing' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Role of Dr Two' }), { target: { value: 'assisting' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor' }));
    expect(screen.getByRole('combobox', { name: 'Supervisor (optional)' })).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Placing' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Doctor' }), { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book surgery' }));
    await waitFor(() => expect(bookSurgery).toHaveBeenCalled());
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).toMatchObject({
      placedBy: 'doctor', placingDoctorId: 'doc1', placing: [], assisting: ['d2'], supervisorId: '',
    });
  });

  it('edits a doctor booking with the doctor chosen and its supervisor kept', () => {
    render(
      <SlotForm
        {...people}
        edit={{
          slotId: 'slot1', sessionId: 's1', sessionLabel: 'Day 1', patientLabel: 'Amal', chairId: '', supervisorId: 'sup1',
          start: '09:00', end: '10:00', roles: {}, implants: [], notes: '', placingDoctorId: 'doc1',
        }}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Doctor' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveValue('doc1');
    expect(screen.getByRole('combobox', { name: 'Supervisor (optional)' })).toHaveValue('sup1');
  });
});

describe('SlotForm: clinic', () => {
  const clinic = {
    ...props,
    teaching: false,
    sessions: [{ id: 's1', label: '05 Oct 2026 · Clinic day', courseId: '' }],
    doctors: [{ id: 'doc1', label: 'Dr Hany Fouad' }],
  };

  it('asks only for the doctor: no supervisor, delegates or Placed by', async () => {
    const { container } = render(<SlotForm {...clinic} />);
    expect(container.textContent).not.toMatch(/supervisor/i);
    expect(container.textContent).not.toMatch(/delegate/i);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Doctor' }), { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book surgery' }));
    await waitFor(() => expect(bookSurgery).toHaveBeenCalled());
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).toMatchObject({ placedBy: 'doctor', placingDoctorId: 'doc1', placing: [], assisting: [] });
  });

  it('points to Add clinic day, not Courses, when there are no sessions', () => {
    render(<SlotForm {...clinic} sessions={[]} />);
    expect(screen.getByRole('link', { name: 'Add clinic day' })).toHaveAttribute('href', '/schedule');
    expect(screen.queryByRole('link', { name: 'Courses' })).not.toBeInTheDocument();
  });
});
