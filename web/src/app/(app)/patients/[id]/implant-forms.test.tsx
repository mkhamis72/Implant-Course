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
  today: '2030-06-10', me: 'u1', editable: true, canReceive: true, implants: [implant], lots: [lot], delegates: [], enrollments: [], organizers: [], supervisors: [], componentProducts: [],
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
