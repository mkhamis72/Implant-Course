import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), recordFollowup: vi.fn() }));
import { PlaceForm } from './implant-forms';

const implant = { id: 'p1', type: 'implant', brand: 'Brand', system: 'S', platform: null, diameter_mm: 4, length_mm: 10, description: '' };
const lot = { stock_lot_id: 'l1', product_id: 'p1', lot_no: 'OLD', expiry: '2030-06-09', received_on: '2030-01-01', qty_received: 1, on_hand: 1 };
const data = {
  today: '2030-06-10', me: 'u1', editable: true, implants: [implant], lots: [lot], delegates: [], organizers: [], supervisors: [], componentProducts: [],
} as unknown as ChartData;

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

describe('<PlaceForm> torque', () => {
  it('fills the torque from a quick chip', () => {
    placeForm();
    fireEvent.click(screen.getByRole('button', { name: '35 Ncm' }));
    expect(screen.getByLabelText('Insertion torque (Ncm, optional)')).toHaveValue('35');
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
