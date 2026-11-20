import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Product } from '@/lib/inventory/types';
import { SlotForm } from './slot-form';
import { bookSurgery, updateBooking } from '../actions';

vi.mock('../actions', () => ({
  bookSurgery: vi.fn(async () => ({ error: 'stop' })),
  updateBooking: vi.fn(async () => ({ error: 'stop' })),
  searchBookingPatients: vi.fn(async () => [{ id: 'pt1', file_no: 'P00012', full_name: 'Amal Hassan', dob: null, phone: null }]),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const props = {
  chairs: [], canOpenFile: true, enrolled: {}, implants: [], supervisors: [], me: '', teaching: true, doctors: [],
  initial: { sessionId: '', chairId: '', start: '09:00' },
};
const amal = { id: 'pt1', file_no: 'P00012', full_name: 'Amal Hassan', dob: null, phone: null };
const implant = (id: string, d: number) =>
  ({ id, type: 'implant', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: d, length_mm: 10, description: '' }) as Product;

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

  it('submitting sends patientId', async () => {
    render(<SlotForm {...props} sessions={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Patient' }), { target: { value: 'Amal' } });
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Book surgery' }));
    await waitFor(() => expect(bookSurgery).toHaveBeenCalled());
    const sent = vi.mocked(bookSurgery).mock.calls.at(-1)![0];
    expect(sent).toMatchObject({ patientId: 'pt1' });
    expect(sent).not.toHaveProperty('patientFileNo');
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

  it('payload carries spares per tooth', async () => {
    render(<SlotForm {...props} sessions={[]} implants={[implant('p1', 4), implant('p2', 4.5), implant('p3', 5)]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Tooth 1' }), { target: { value: '14' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Implant 1' }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Spare 1 for tooth 14' }), { target: { value: 'p2' } });
    // The second spare stays unchosen: it is not sent.
    fireEvent.click(screen.getByRole('button', { name: '+ Add another implant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tooth 2' }), { target: { value: '15' } });
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add spare' })[1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Spare 1 for tooth 15' }), { target: { value: 'p3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book surgery' }));
    await waitFor(() => expect(bookSurgery).toHaveBeenCalled());
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).toMatchObject({
      implants: [
        { tooth: '14', productId: 'p1', technique: '', spares: ['p2'] },
        { tooth: '15', productId: '', technique: '', spares: ['p3'] },
      ],
    });
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
          slotId: 'slot1', sessionId: 's1', sessionLabel: '05 Oct 2026 · Course · Day 1', patient: amal,
          chairId: 'ch1', supervisorId: 'sup1', start: '09:00', end: '10:00', roles: { d1: 'placing', d2: 'assisting' },
          implants: [{ tooth: '36', productId: '', technique: 'guided', spares: [], placed: false }], notes: 'Bring guide', placingDoctorId: '',
        }}
      />,
    );
    expect(screen.getByText(/P00012 · Amal Hassan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Surgery session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Patient' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role of Dr One' })).toHaveValue('placing');
    expect(screen.getByRole('combobox', { name: 'Role of Dr Two' })).toHaveValue('assisting');
    expect(screen.getByRole('combobox', { name: 'Technique 1' })).toHaveValue('guided');
    expect(screen.getByLabelText('End')).toHaveValue('10:00');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});

describe('SlotForm: editing the implants', () => {
  const products = [implant('p1', 4), implant('p2', 4.5), implant('p3', 5)];
  const base = {
    slotId: 'slot1', sessionId: 's1', sessionLabel: 'Day 1', patient: amal, chairId: 'ch1', supervisorId: '',
    start: '09:00', end: '10:00', roles: {}, notes: '', placingDoctorId: 'doc1',
  };
  const planned = { tooth: '36', productId: 'p1', technique: 'guided' as const, spares: ['p2'], placed: false };
  // An older row: placed with no technique recorded.
  const placed = { tooth: '46', productId: 'p3', technique: '' as const, spares: [], placed: true };
  const renderEdit = (implants: (typeof planned | typeof placed)[]) =>
    render(
      <SlotForm
        {...props}
        sessions={[{ id: 's1', label: '', courseId: 'c1' }]}
        doctors={[{ id: 'doc1', label: 'Dr Hany Fouad' }]}
        implants={products}
        edit={{ ...base, implants }}
      />,
    );
  const sent = () => vi.mocked(updateBooking).mock.calls.at(-1)![0];

  it('edit rows are editable and pre-filled', () => {
    renderEdit([planned]);
    expect(screen.getByRole('textbox', { name: 'Tooth 1' })).toHaveValue('36');
    expect(screen.getByRole('combobox', { name: 'Implant 1' })).toHaveValue('p1');
    expect(screen.getByRole('combobox', { name: 'Technique 1' })).toHaveValue('guided');
    expect(screen.getByRole('combobox', { name: 'Spare 1 for tooth 36' })).toHaveValue('p2');
  });

  it('placed row is read-only with the Corrections note', () => {
    renderEdit([placed]);
    expect(screen.queryByRole('textbox', { name: 'Tooth 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Implant 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Technique 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove implant row 1' })).not.toBeInTheDocument();
    expect(screen.getByText(/Tooth 46 · Oxy/)).toBeInTheDocument();
    expect(screen.getByText('Placed — change it in Corrections')).toBeInTheDocument();
    // Its spares stay editable.
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    expect(screen.getByRole('combobox', { name: 'Spare 1 for tooth 46' })).toBeInTheDocument();
  });

  it('can add and remove a tooth', async () => {
    renderEdit([planned, { ...planned, tooth: '37', spares: [] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove implant row 1' }));
    expect(screen.getByRole('textbox', { name: 'Tooth 1' })).toHaveValue('37');
    fireEvent.click(screen.getByRole('button', { name: '+ Add another implant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tooth 2' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Implant 2' }), { target: { value: 'p2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Technique 2' }), { target: { value: 'free_hand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateBooking).toHaveBeenCalled());
    expect(sent().implants).toEqual([
      { tooth: '37', productId: 'p1', technique: 'guided', spares: [], placed: false },
      { tooth: '35', productId: 'p2', technique: 'free_hand', spares: [], placed: false },
    ]);
  });

  it('payload is the full set including placed rows unchanged', async () => {
    vi.mocked(updateBooking).mockClear();
    renderEdit([planned, placed]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Technique 1' }), { target: { value: 'free_hand' } });
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add spare' })[1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Spare 1 for tooth 46' }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateBooking).toHaveBeenCalled());
    expect(sent()).toMatchObject({
      slotId: 'slot1',
      implants: [
        { tooth: '36', productId: 'p1', technique: 'free_hand', spares: ['p2'], placed: false },
        { tooth: '46', productId: 'p3', technique: '', spares: ['p1'], placed: true },
      ],
    });
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
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Where' })).not.toBeInTheDocument();
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
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).not.toHaveProperty('date');
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).not.toHaveProperty('setting');
  });

  it('edits a doctor booking with the doctor chosen and its supervisor kept', () => {
    render(
      <SlotForm
        {...people}
        edit={{
          slotId: 'slot1', sessionId: 's1', sessionLabel: 'Day 1', patient: amal, chairId: '', supervisorId: 'sup1',
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
    // The Schedule page always passes its day; a clinic's booking date starts on it.
    initial: { ...props.initial, date: '2030-03-02' },
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

  it('starts the doctor select on the doctor linked to my login', () => {
    render(<SlotForm {...clinic} doctors={[...clinic.doctors, { id: 'doc2', label: 'Dr Me' }]} myDoctorId="doc2" />);
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveValue('doc2');
  });

  it('edits a booking placed by its recorded delegates without asking for a doctor or naming anyone', () => {
    const { container } = render(
      <SlotForm
        {...clinic}
        edit={{
          slotId: 'slot1', sessionId: 's1', sessionLabel: '05 Oct 2026 · Day 1', patient: amal, chairId: '', supervisorId: '',
          start: '09:00', end: '10:00', roles: {}, implants: [], notes: '', placingDoctorId: '', placedByRecorded: true,
        }}
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Doctor' })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/supervisor|delegate/i);
  });

  it('books by date and where, with no surgery session', async () => {
    render(<SlotForm {...clinic} initial={{ ...clinic.initial, date: '2030-03-02' }} />);
    expect(screen.queryByRole('combobox', { name: 'Surgery session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No upcoming surgery sessions/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveValue('2030-03-02');
    expect(screen.getByLabelText('Date')).toBeRequired();
    expect(screen.getByLabelText('Date')).not.toHaveAttribute('min');
    const where = screen.getByRole('combobox', { name: 'Where' });
    expect(where).toHaveValue('');
    expect([...(where as HTMLSelectElement).options].map((o) => o.text)).toEqual(['', 'In clinic', 'GA in hospital']);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-03-05' } });
    fireEvent.change(where, { target: { value: 'hospital_ga' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Doctor' }), { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book surgery' }));
    await waitFor(() => expect(bookSurgery).toHaveBeenCalled());
    expect(vi.mocked(bookSurgery).mock.calls.at(-1)![0]).toMatchObject({ date: '2030-03-05', setting: 'hospital_ga' });
  });

  it('edits the date and where, pre-filled from the booking, and sends both', async () => {
    render(
      <SlotForm
        {...clinic}
        edit={{
          slotId: 'slot1', sessionId: 's1', sessionLabel: '05 Oct 2026 · Clinic day', patient: amal, chairId: '', supervisorId: '',
          start: '09:00', end: '10:00', roles: {}, implants: [], notes: '', placingDoctorId: 'doc1', date: '2030-03-02', setting: 'clinic',
        }}
      />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('2030-03-02');
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('clinic');
    expect(screen.queryByText(/cancel it and book again/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-03-04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateBooking).toHaveBeenCalled());
    expect(vi.mocked(updateBooking).mock.calls.at(-1)![0]).toMatchObject({ date: '2030-03-04', setting: 'clinic' });
  });
});
