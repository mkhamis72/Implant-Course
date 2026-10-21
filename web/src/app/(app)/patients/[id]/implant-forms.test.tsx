import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({
  fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn(),
}));
import { PlaceForm } from './implant-forms';

const implant = { id: 'p1', type: 'implant', brand: 'Brand', system: 'S', platform: null, diameter_mm: 4, length_mm: 10, description: '' };
const lot = { stock_lot_id: 'l1', product_id: 'p1', lot_no: 'OLD', expiry: '2030-06-09', received_on: '2030-01-01', qty_received: 1, on_hand: 1 };
const data = {
  today: '2030-06-10', me: 'u1', editable: true, canReceive: true, implants: [implant], lots: [lot], delegates: [], organizers: [], supervisors: [], componentProducts: [],
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
