import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartData } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), recordFollowup: vi.fn() }));
import { PlaceForm } from './implant-forms';

const implant = { id: 'p1', type: 'implant', brand: 'Brand', system: 'S', platform: null, diameter_mm: 4, length_mm: 10, description: '' };
const lot = { stock_lot_id: 'l1', product_id: 'p1', lot_no: 'OLD', expiry: '2030-06-09', received_on: '2030-01-01', qty_received: 1, on_hand: 1 };
const data = {
  today: '2030-06-10', me: 'u1', implants: [implant], lots: [lot], delegates: [], organizers: [], componentProducts: [],
} as unknown as ChartData;

describe('<PlaceForm> batch choice', () => {
  it('offers a batch that was in date on the placement date, and drops it when the date moves past its expiry', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId="p1" />);
    expect(screen.getByText(/No usable stock/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Placement date'), { target: { value: '2030-06-01' } });
    const batch = screen.getByRole('combobox', { name: 'Stock batch' });
    fireEvent.change(batch, { target: { value: 'l1' } });
    expect(batch).toHaveValue('l1');

    fireEvent.change(screen.getByLabelText('Placement date'), { target: { value: '2030-06-10' } });
    expect(screen.queryByRole('combobox', { name: 'Stock batch' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Placement date'), { target: { value: '2030-06-02' } });
    expect(screen.getByRole('combobox', { name: 'Stock batch' })).toHaveValue('');
  });
});
