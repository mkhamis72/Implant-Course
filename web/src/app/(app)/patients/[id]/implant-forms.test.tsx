import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({
  fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn(),
}));
import { ComponentForm, PlaceForm } from './implant-forms';

const implant = { id: 'p1', type: 'implant', brand: 'Brand', system: 'S', platform: null, diameter_mm: 4, length_mm: 10, description: '' };
const lot = { stock_lot_id: 'l1', product_id: 'p1', lot_no: 'OLD', expiry: '2030-06-09', received_on: '2030-01-01', qty_received: 1, on_hand: 1 };
const data = {
  today: '2030-06-10', me: 'u1', editable: true, canReceive: true, inventoryOn: true, teachingOn: true, doctors: [], cases: [], implants: [implant], lots: [lot], delegates: [], enrollments: [], organizers: [], supervisors: [], componentProducts: [],
  courses: [
    { id: 'c1', name: 'June course', start_date: '2030-06-08', end_date: '2030-06-12' },
    { id: 'c2', name: 'Earlier course', start_date: '2030-01-01', end_date: '2030-01-05' },
  ],
} as unknown as ChartData;

describe('<PlaceForm> implant picker', () => {
  const oxy = (id: string, system: string, d: number, l: number) =>
    ({ id, type: 'implant', brand: 'Oxy Implant', system, platform: '', diameter_mm: d, length_mm: l, description: '' });
  const stocked = {
    ...data,
    implants: [oxy('m10', 'PSK-MDK · PSK Micro', 4, 10), oxy('n10', 'PSK-MDK · PSK Normo', 4.5, 10), oxy('x', 'MD EXT · Standard', 4.1, 11.5)],
    lots: [{ ...lot, stock_lot_id: 'lm', product_id: 'm10', lot_no: 'M', expiry: null, on_hand: 3 }],
  } as unknown as ChartData;

  it('chooses line, type and size, listing only sizes in stock until the box is unticked', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={stocked} onDone={() => {}} plannedProductId={null} />);
    // Only one line and one type have stock, so they are filled in.
    expect(screen.getByRole('combobox', { name: 'Implant line' })).toHaveValue('PSK-MDK');
    expect(screen.getByRole('combobox', { name: 'Implant type' })).toHaveValue('PSK Micro');
    const size = screen.getByRole('combobox', { name: 'Implant size' });
    expect(within(size).getAllByRole('option').map((o) => o.textContent)).toEqual(['Size…', 'Ø4.0 × 10 mm · 3 in stock']);
    fireEvent.change(size, { target: { value: 'm10' } });
    expect(within(screen.getByRole('radiogroup', { name: 'Stock batch' })).getByRole('radio', { name: /Lot M/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'In stock only' }));
    expect(within(screen.getByRole('combobox', { name: 'Implant line' })).getAllByRole('option')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox', { name: 'Implant type' }), { target: { value: 'PSK Normo' } });
    expect(screen.getByRole('combobox', { name: 'Implant size' })).toHaveValue(''); // the Micro no longer fits
    expect(screen.getByRole('option', { name: 'Ø4.5 × 10 mm · none in stock' })).toBeInTheDocument();
  });
});

describe('<PlaceForm> receiving missing stock in place', () => {
  it('receives a delivery and selects its batch, keeping what was typed', async () => {
    const { receiveStockForPlacement, placeImplant } = await import('./implant-actions');
    vi.mocked(receiveStockForPlacement).mockResolvedValue({ lotId: 'new-lot' });
    vi.mocked(placeImplant).mockResolvedValue({});
    render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId="p1" />);
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: 'Typed before receiving' } });

    fireEvent.click(screen.getByRole('button', { name: 'Receive stock here' }));
    const box = screen.getByRole('group', { name: 'Receive stock' });
    fireEvent.change(within(box).getByLabelText(/^Quantity/), { target: { value: '5' } });
    fireEvent.change(within(box).getByLabelText(/^Lot number/), { target: { value: 'NEW1' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Receive' }));
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Receive stock' })).not.toBeInTheDocument());
    expect(vi.mocked(receiveStockForPlacement)).toHaveBeenCalledWith('pt', {
      product_id: 'p1', quantity: '5', lot_no: 'NEW1', expiry: '', received_on: '2030-06-10',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    expect(vi.mocked(placeImplant).mock.calls.at(-1)?.[0]).toMatchObject({
      productId: 'p1', lotId: 'new-lot', notes: 'Typed before receiving',
    });
  });

  it('without Inventory edit, says who can receive and offers no box', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, canReceive: false }} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByText(/Ask someone with Inventory access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive stock here' })).not.toBeInTheDocument();
  });
});

const placeForm = () => render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId="p1" />);

describe('<PlaceForm> batch choice', () => {
  it('offers a batch that was in date on the placement date as a tappable card, and drops it when the date moves past its expiry', () => {
    placeForm();
    expect(screen.getByText(/No usable stock/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Placement date/), { target: { value: '2030-06-01' } });
    const batches = screen.getByRole('radiogroup', { name: 'Stock batch' });
    const card = within(batches).getByRole('radio', { name: /Lot OLD/ });
    fireEvent.click(card);
    expect(card).toBeChecked();

    fireEvent.change(screen.getByLabelText(/^Placement date/), { target: { value: '2030-06-10' } });
    expect(screen.queryByRole('radiogroup', { name: 'Stock batch' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Placement date/), { target: { value: '2030-06-02' } });
    expect(within(screen.getByRole('radiogroup', { name: 'Stock batch' })).getByRole('radio', { name: /Lot OLD/ })).not.toBeChecked();
  });
});

describe('<PlaceForm> stability', () => {
  it('leaves torque, ISQ and bone type to the surgical details', () => {
    placeForm();
    expect(screen.queryByLabelText(/Insertion torque/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ISQ/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Bone type/ })).not.toBeInTheDocument();
  });
});

describe('<PlaceForm> supervisor', () => {
  it('offers the supervisors list and starts empty when the current user is not on it', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, me: 'u1', supervisors: [{ id: 'sup1', label: 'Prof. Laila Samir' }] }} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Prof. Laila Samir' })).toBeInTheDocument();
  });
});

describe('<PlaceForm> booked supervisor', () => {
  it('does not pre-fill a booking supervisor who is no longer on the list', () => {
    const slot = { id: 's1', starts_at: '2030-06-10T08:00:00Z', supervisor_id: 'gone', chair: null, delegates: [] };
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, supervisors: [{ id: 'sup1', label: 'Prof. Laila Samir' }] }} onDone={() => {}} plannedProductId="p1" slot={slot} />);
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('');
  });
});

describe('<PlaceForm> graft', () => {
  it('no longer asks for a free-text graft (grafts go in Surgical details)', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId={null} />);
    expect(screen.queryByLabelText('Graft (optional)')).not.toBeInTheDocument();
  });
});

const enrolledData = {
  ...data,
  delegates: [{ id: 'd1', label: 'Dr June' }, { id: 'd2', label: 'Dr Earlier' }], organizers: [{ id: 'u1', label: 'Org' }],
  enrollments: [{ course_id: 'c1', delegate_id: 'd1' }, { course_id: 'c2', delegate_id: 'd2' }],
} as unknown as ChartData;
const optionsOf = (name: RegExp) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent);

describe('<PlaceForm> enrolled delegates', () => {
  it('waits for a course, then lists only those enrolled in it for both roles', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={enrolledData} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('combobox', { name: /Placed by/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /Assisted by/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'c1' } });
    expect(screen.getByRole('combobox', { name: /Placed by/ })).toBeEnabled();
    expect(optionsOf(/Placed by/)).toEqual(['Choose the delegate…', 'Dr June']);
    expect(optionsOf(/Assisted by/)).toEqual(['Nobody', 'Dr June']);
  });

  it('clears a delegate who is not enrolled in the newly chosen course', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={enrolledData} onDone={() => {}} plannedProductId="p1" />);
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'c1' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Placed by/ }), { target: { value: 'd1' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'c2' } });
    expect(screen.getByRole('combobox', { name: /Placed by/ })).toHaveValue('');
  });

  it('says so when a course has nobody enrolled, with a link to it', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...enrolledData, enrollments: [] }} onDone={() => {}} plannedProductId="p1" />);
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'c1' } });
    expect(screen.getByText(/No delegates are enrolled in this course/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Enrol them/ })).toHaveAttribute('href', '/courses/c1');
  });
});

describe('<ComponentForm> course', () => {
  const site = { id: 's1', tooth: 36, state: 'placed', course_id: 'c1', components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];

  it('defaults to the implant course and lists its delegates', () => {
    render(<ComponentForm patientId="pt" site={site} data={enrolledData} onDone={() => {}} />);
    expect(screen.getByRole('combobox', { name: /^Course/ })).toHaveValue('c1');
    expect(optionsOf(/Fitted by \(delegate\)/)).toEqual(['—', 'Dr June']);
  });

  it('follows a later course, clears the delegate, and sends the course', async () => {
    const { fitComponent } = await import('./implant-actions');
    vi.mocked(fitComponent).mockResolvedValue({});
    render(<ComponentForm patientId="pt" site={site} data={enrolledData} onDone={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: /Fitted by \(delegate\)/ }), { target: { value: 'd1' } });
    fireEvent.change(screen.getByRole('combobox', { name: /^Course/ }), { target: { value: 'c2' } });
    expect(screen.getByRole('combobox', { name: /Fitted by \(delegate\)/ })).toHaveValue('');
    expect(optionsOf(/Fitted by \(delegate\)/)).toEqual(['—', 'Dr Earlier']);
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await vi.waitFor(() => expect(vi.mocked(fitComponent)).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c2' })));
  });

  it('lists every active delegate with no course', () => {
    render(<ComponentForm patientId="pt" site={{ ...site, course_id: null }} data={enrolledData} onDone={() => {}} />);
    expect(screen.getByRole('combobox', { name: /^Course/ })).toHaveValue('');
    expect(optionsOf(/Fitted by \(delegate\)/)).toEqual(['—', 'Dr June', 'Dr Earlier']);
  });
});

describe('<ComponentForm>', () => {
  it('no longer offers a final restoration (restorations are recorded on the Restoration tab)', () => {
    const site = { id: 's1', tooth: 36, state: 'placed', components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
    render(<ComponentForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    const select = screen.getByRole('combobox', { name: 'Component' });
    expect(within(select).queryByRole('option', { name: 'Final restoration' })).toBeNull();
    expect(within(select).getByRole('option', { name: 'Abutment' })).toBeInTheDocument();
  });
});

describe('<PlaceForm> course', () => {
  const full = {
    ...data,
    delegates: [{ id: 'd1', label: 'Dr Right' }], supervisors: [{ id: 'sup1', label: 'Prof A' }],
    enrollments: [{ course_id: 'c1', delegate_id: 'd1' }, { course_id: 'c2', delegate_id: 'd1' }],
  } as unknown as ChartData;
  const fill = () => {
    fireEvent.change(screen.getByRole('combobox', { name: /Placed by/ }), { target: { value: 'd1' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Supervisor/ }), { target: { value: 'sup1' } });
  };

  it('has a required Course select listing courses running on the placement date first', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={full} onDone={() => {}} plannedProductId="p1" />);
    const course = screen.getByRole('combobox', { name: /Course/ });
    expect(course).toHaveAttribute('aria-required', 'true');
    expect(course).toHaveValue('');
    expect(within(course).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose the course…', 'June course', 'Earlier course']);
  });

  it('pre-selects the course of the booking and sends it', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockResolvedValue({});
    const slot = { id: 's1', starts_at: '2030-06-10T08:00:00Z', supervisor_id: 'sup1', chair: null, delegates: [{ delegate_id: 'd1', role: 'placing' as const }] };
    render(<PlaceForm patientId="pt" tooth={36} data={full} onDone={() => {}} plannedProductId="p1" slot={slot} plannedCourseId="c2" />);
    expect(screen.getByRole('combobox', { name: /Course/ })).toHaveValue('c2');
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    await vi.waitFor(() => expect(vi.mocked(placeImplant)).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c2', slotId: 's1' })));
  });

  it('sends an empty course when none is chosen, which the schema refuses', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockClear();
    render(<PlaceForm patientId="pt" tooth={36} data={full} onDone={() => {}} plannedProductId="p1" />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    await vi.waitFor(() => expect(vi.mocked(placeImplant)).toHaveBeenCalledWith(expect.objectContaining({ courseId: '' })));
  });
});

describe('implant date limits', () => {
  it('placement no later than today; a component from placement to today', () => {
    const { unmount } = render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByLabelText(/Placement date/)).toHaveAttribute('max', data.today);
    unmount();
    const site = { id: 's1', tooth: 36, state: 'placed', placed_on: '2026-03-10', components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
    render(<ComponentForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.getByLabelText(/Fitted on/)).toHaveAttribute('min', '2026-03-10');
    expect(screen.getByLabelText(/Fitted on/)).toHaveAttribute('max', data.today);
  });
});

describe('without Inventory', () => {
  const off = { ...data, inventoryOn: false, canReceive: false, lots: [] } as unknown as ChartData;

  it('places from the catalogue: no batch group, no stock filter, lotId null', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockResolvedValue({});
    render(<PlaceForm patientId='pt' tooth={36} data={off} onDone={() => {}} plannedProductId='p1' />);
    expect(screen.queryByRole('radiogroup', { name: 'Stock batch' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No usable stock/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive stock here' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'In stock only' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ø4.0 × 10 mm' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    expect(vi.mocked(placeImplant).mock.calls.at(-1)?.[0]).toMatchObject({ productId: 'p1', lotId: null });
  });

  it('says No product recorded instead of Not from stock', () => {
    const site = { id: 's1', tooth: 36, state: 'placed', components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
    render(<ComponentForm patientId='pt' site={site} data={off} onDone={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Component' }), { target: { value: 'ti_base' } });
    expect(screen.getByRole('option', { name: 'No product recorded' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Not from stock' })).not.toBeInTheDocument();
  });

  it('fits a component with no batch group and lotId null', async () => {
    const { fitComponent } = await import('./implant-actions');
    vi.mocked(fitComponent).mockResolvedValue({});
    const abutment = { id: 'a1', type: 'ti_base', brand: 'Brand', system: 'S', platform: null, diameter_mm: null, length_mm: null, description: '', connection: '', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '', driver_ref: '', torque_ncm: null };
    const site = { id: 's1', tooth: 36, state: 'placed', components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
    render(<ComponentForm patientId='pt' site={site} data={{ ...off, componentProducts: [abutment] } as unknown as ChartData} onDone={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Component' }), { target: { value: 'ti_base' } });
    fireEvent.change(screen.getByRole('combobox', { name: /^Product/ }), { target: { value: 'a1' } });
    expect(screen.queryByRole('radiogroup', { name: 'Stock batch' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No usable stock/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    expect(vi.mocked(fitComponent).mock.calls.at(-1)?.[0]).toMatchObject({ productId: 'a1', lotId: null });
  });
});

describe('<PlaceForm> placed by', () => {
  const org = {
    ...data,
    delegates: [{ id: 'd1', label: 'Dr Right' }], supervisors: [{ id: 'sup1', label: 'Prof A' }],
    enrollments: [{ course_id: 'c1', delegate_id: 'd1' }], doctors: [{ id: 'doc1', name: 'Dr Nabil' }],
  } as unknown as ChartData;

  it('a course organizer places by a delegate by default, or by a doctor with the supervisor optional', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockClear().mockResolvedValue({});
    render(<PlaceForm patientId="pt" tooth={36} data={org} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('radio', { name: 'Delegate' })).toBeChecked();
    expect(screen.queryByRole('combobox', { name: /^Doctor/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor' }));
    expect(screen.queryByRole('combobox', { name: /Placed by \(delegate\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Assisted by/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Supervisor \(optional\)/ })).not.toHaveAttribute('aria-required');
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'c1' } });
    fireEvent.change(screen.getByRole('combobox', { name: /^Doctor/ }), { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    await vi.waitFor(() => expect(vi.mocked(placeImplant)).toHaveBeenCalledWith(expect.objectContaining({
      placedBy: 'doctor', placingDoctorId: 'doc1', placingDelegateId: null, courseId: 'c1',
    })));
  });

  it('starts on Doctor with the booking’s doctor', () => {
    const slot = { id: 's1', starts_at: '2030-06-10T08:00:00Z', supervisor_id: null, placing_doctor_id: 'doc1', chair: null, delegates: [] };
    render(<PlaceForm patientId="pt" tooth={36} data={org} onDone={() => {}} plannedProductId="p1" slot={slot} />);
    expect(screen.getByTestId('booked-people')).toHaveTextContent('Placed by Dr Nabil');
    expect(screen.getByRole('radio', { name: 'Doctor', hidden: true })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /^Doctor/, hidden: true })).toHaveValue('doc1');
  });

  it('a clinic asks only for the doctor: no course, delegate or supervisor', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockClear().mockResolvedValue({});
    const clinic = { ...org, teachingOn: false, delegates: [], supervisors: [], courses: [], enrollments: [] } as unknown as ChartData;
    const { container } = render(<PlaceForm patientId="pt" tooth={36} data={clinic} onDone={() => {}} plannedProductId="p1" />);
    expect(container).not.toHaveTextContent(/Supervisor|Course|Delegate/i);
    expect(screen.queryByRole('radio', { name: 'Doctor' })).not.toBeInTheDocument();
    const doctor = screen.getByRole('combobox', { name: /Placed by/ });
    expect(doctor).toHaveAttribute('aria-required', 'true');
    fireEvent.change(doctor, { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    await vi.waitFor(() => expect(vi.mocked(placeImplant)).toHaveBeenCalledWith(expect.objectContaining({
      placedBy: 'doctor', placingDoctorId: 'doc1', placingDelegateId: null, assistingDelegateId: null, supervisorId: null, courseId: null,
    })));
  });
});

describe('<PlaceForm> Placed by defaults to me', () => {
  const doctors = [{ id: 'doc1', name: 'Dr Nabil', user_id: 'other', active: true }, { id: 'doc2', name: 'Dr Me', user_id: 'u1', active: true }];
  it('a clinic starts the doctor select on the doctor linked to my login', () => {
    const clinic = { ...data, me: 'u1', teachingOn: false, doctors, delegates: [], supervisors: [], courses: [], enrollments: [] } as unknown as ChartData;
    render(<PlaceForm patientId="pt" tooth={36} data={clinic} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('combobox', { name: /Placed by/ })).toHaveValue('doc2');
  });
  it('a course organizer gets it once Doctor is chosen', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, me: 'u1', doctors } as unknown as ChartData} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('radio', { name: 'Delegate' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor' }));
    expect(screen.getByRole('combobox', { name: /^Doctor/ })).toHaveValue('doc2');
  });
});

describe('<ComponentForm> in a clinic', () => {
  it('has no course and no fitted-by-delegate field', () => {
    const site = { id: 's1', tooth: 36, state: 'placed', course_id: null, components: [] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
    const { container } = render(<ComponentForm patientId="pt" site={site} data={{ ...data, teachingOn: false } as ChartData} onDone={() => {}} />);
    expect(container).not.toHaveTextContent(/Course|delegate/i);
    expect(screen.getByRole('combobox', { name: /Fitted by/ })).toBeInTheDocument();
  });
});

describe('<PlaceForm> supervisor default with a doctor', () => {
  const meSupervises = {
    ...data, me: 'u1', supervisors: [{ id: 'u1', label: 'Me' }, { id: 'sup1', label: 'Prof A' }], doctors: [{ id: 'doc1', name: 'Dr Nabil' }],
  } as unknown as ChartData;

  it('empties the supervisor on Doctor and restores it on Delegate, keeping one chosen by hand', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={meSupervises} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('u1');
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor' }));
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('');
    fireEvent.click(screen.getByRole('radio', { name: 'Delegate' }));
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('u1');
    fireEvent.change(screen.getByRole('combobox', { name: /Supervisor/ }), { target: { value: 'sup1' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor' }));
    expect(screen.getByRole('combobox', { name: /Supervisor/ })).toHaveValue('sup1');
  });

  it('a booking with a doctor and no supervisor starts with none', () => {
    const slot = { id: 's1', starts_at: '2030-06-10T08:00:00Z', supervisor_id: null, placing_doctor_id: 'doc1', chair: null, delegates: [] };
    render(<PlaceForm patientId="pt" tooth={36} data={meSupervises} onDone={() => {}} plannedProductId="p1" slot={slot} />);
    expect(screen.getByRole('combobox', { name: /Supervisor/, hidden: true })).toHaveValue('');
    expect(screen.getByTestId('booked-people')).toHaveTextContent('Placed by Dr Nabil');
    expect(screen.getByTestId('booked-people')).not.toHaveTextContent(/supervised/);
  });
});

describe('<PlaceForm> switched-off planned implant (0128)', () => {
  it('still offers and preselects the planned implant switched off in Admin → Catalogue', () => {
    const off = { ...implant, id: 'off', diameter_mm: 4.5, length_mm: 11.5 };
    const offLot = { ...lot, stock_lot_id: 'loff', product_id: 'off', lot_no: 'OFF' };
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, lots: [lot, offLot] } as ChartData} onDone={() => {}}
      plannedProductId="off" recordedProducts={[off as never]} />);
    expect(screen.getByRole('combobox', { name: 'Implant size' })).toHaveValue('off');
  });
});

describe('<PlaceForm> with no implants switched on (0128)', () => {
  it('says an admin switches products on in Admin → Catalogue', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, implants: [], lots: [] } as ChartData} onDone={() => {}} plannedProductId={null} />);
    expect(screen.getByText('No products switched on yet. An admin chooses them in Admin → Catalogue.')).toBeInTheDocument();
  });
});

describe('<ComponentForm> screws, torque and specs', () => {
  const spec = { connection: '', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '', driver_ref: '', torque_ncm: null };
  const prod = (id: string, type: string, over: Record<string, unknown> = {}) =>
    ({ id, type, brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: null, length_mm: null, ref_code: id, description: '', ...spec, ...over });
  const mua = {
    id: 'mua', component_type: 'multi_unit', fitted_on: '2030-06-01', removed_on: null, voided_at: null, voided_reason: '', product: null,
    torque_ncm: 30, holds_component_id: null, holds_restoration_id: null, replaced_by: null,
  };
  const site = { id: 's1', tooth: 15, state: 'restored', placed_on: '2030-05-01', course_id: null, components: [mua] } as unknown as Parameters<typeof ComponentForm>[0]['site'];
  const arch = { id: 'r1', stage: 'final', type: 'full_arch', teeth: [15, 14, 13, 12, 11, 21, 22, 23, 24, 25], ended_on: null, site_ids: ['s1'] };
  const ended = { ...arch, id: 'r0', stage: 'temporary', ended_on: '2030-05-20' };
  const screwData = {
    ...data, organizers: [{ id: 'u1', label: 'Me' }], restorations: [arch, ended],
    componentProducts: [prod('ps1', 'prosthetic_screw', { driver_interface: 'Hex', driver_size: '1.25 mm' }), prod('mu1', 'multi_unit')],
  } as unknown as ChartData;
  const choose = (name: RegExp | string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

  it('groups the component types by role', () => {
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    const select = screen.getByRole('combobox', { name: 'Component' });
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Healing', 'Abutment', 'Cap', 'Abutment screw', 'Prosthetic screw', 'Scan / impression']);
  });

  it('a prosthetic screw needs Holds, listing the abutment and the current restoration, and sends the restoration', async () => {
    const { fitComponent } = await import('./implant-actions');
    vi.mocked(fitComponent).mockResolvedValue({});
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    expect(screen.queryByRole('combobox', { name: /^Holds/ })).not.toBeInTheDocument();
    choose('Component', 'prosthetic_screw');
    const holds = screen.getByRole('combobox', { name: /^Holds/ });
    expect(holds).toHaveAttribute('aria-required', 'true');
    expect(holds).toBeRequired();
    expect(within(holds).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose what it holds…', 'Multi-unit abutment — 01 Jun 2030', 'Full arch 15–25 (final)',
    ]);
    fireEvent.change(holds, { target: { value: 'restoration:r1' } });
    fireEvent.change(screen.getByLabelText(/^Torque \(Ncm\)/), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await vi.waitFor(() => expect(vi.mocked(fitComponent).mock.calls.at(-1)?.[0]).toMatchObject({
      componentType: 'prosthetic_screw', holdsRestorationId: 'r1', holdsComponentId: null, torque: '15',
    }));
  });

  it('an abutment screw holds only the abutment', () => {
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    choose('Component', 'abutment_screw');
    expect(within(screen.getByRole('combobox', { name: /^Holds/ })).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Choose what it holds…', 'Multi-unit abutment — 01 Jun 2030']);
  });

  it('a healing cap sits on the current abutment only, and sends it', async () => {
    const { fitComponent } = await import('./implant-actions');
    vi.mocked(fitComponent).mockResolvedValue({});
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    choose('Component', 'healing_cap');
    expect(screen.queryByRole('combobox', { name: /^Holds/ })).not.toBeInTheDocument();
    const on = screen.getByRole('combobox', { name: /^Sits on/ });
    expect(on).toBeRequired();
    expect(within(on).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose the abutment…', 'Multi-unit abutment — 01 Jun 2030']);
    fireEvent.change(on, { target: { value: 'component:mua' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    await vi.waitFor(() => expect(vi.mocked(fitComponent).mock.calls.at(-1)?.[0]).toMatchObject({
      componentType: 'healing_cap', holdsComponentId: 'mua', holdsRestorationId: null,
    }));
  });

  it('shows the chosen product specs', () => {
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    choose('Component', 'prosthetic_screw');
    expect(within(screen.getByRole('combobox', { name: /^Product/ })).getAllByRole('option')).toHaveLength(2);
    choose(/^Product/, 'ps1');
    expect(screen.getByText('Screwdriver: Hex 1.25 mm')).toBeInTheDocument();
  });

  it('refuses a torque over 150 Ncm without calling the action', async () => {
    const { fitComponent } = await import('./implant-actions');
    vi.mocked(fitComponent).mockClear();
    render(<ComponentForm patientId="pt" site={site} data={screwData} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Torque \(Ncm\)/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }));
    expect(await screen.findByText('Enter a torque between 0 and 150 Ncm.')).toBeInTheDocument();
    expect(vi.mocked(fitComponent)).not.toHaveBeenCalled();
  });
});
