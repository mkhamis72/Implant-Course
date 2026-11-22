import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Product } from '@/lib/inventory/types';
import { ProductForm } from './product-form';

const product = {
  id: 'p1', type: 'implant', category: 'surgical', brand: 'Oxy Implant', system: 'PSK-MDK · PSK Normo', platform: 'Standard',
  diameter_mm: 4.5, length_mm: 10, ref_code: 'PSKR45100', description: '', reorder_level: 2, active: true, is_sample: false,
  catalog_item_id: null, connection: '', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '',
  driver_size: '', driver_ref: '', torque_ncm: null,
} as Product;

describe('<ProductForm> from the catalogue library (0128)', () => {
  it('locks the library fields of a linked product, leaving reorder level and Active', () => {
    render(<ProductForm action={vi.fn()} product={{ ...product, catalog_item_id: 'i1' }} />);
    expect(screen.getByText('From the catalogue library.')).toBeInTheDocument();
    for (const name of ['Type', 'Brand', 'System', 'Diameter (mm)', 'Length (mm)', 'Platform', 'Description', 'Reference code']) {
      expect(screen.getByLabelText(name)).toBeDisabled();
    }
    expect(screen.getByLabelText('Reorder level')).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Active/ })).toBeEnabled();
  });

  it('leaves a hand-entered product editable', () => {
    render(<ProductForm action={vi.fn()} product={product} />);
    expect(screen.queryByText('From the catalogue library.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Brand')).toBeEnabled();
  });
});

describe('<ProductForm> specifications (0134)', () => {
  it('renders the eight specification inputs and submits them', async () => {
    const action = vi.fn().mockResolvedValue({});
    render(<ProductForm action={action} />);
    const values: Record<string, string> = {
      Connection: 'Internal hex', 'Gingival height (mm)': '2.5', 'Angle (°)': '17', Material: 'Titanium',
      'Screwdriver interface': 'Hex', 'Screwdriver size': '1.25 mm', 'Screwdriver ref': 'DRV1', 'Recommended torque (Ncm)': '25',
    };
    for (const [label, value] of Object.entries(values)) await userEvent.type(screen.getByLabelText(label), value);
    await userEvent.type(screen.getByLabelText('Brand'), 'B');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    const fd = action.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(fd)).toMatchObject({
      connection: 'Internal hex', gingival_height_mm: '2.5', angle_deg: '17', material: 'Titanium', driver_interface: 'Hex',
      driver_size: '1.25 mm', driver_ref: 'DRV1', torque_ncm: '25',
    });
  });

  it('shows a linked product its specifications read-only', () => {
    render(<ProductForm action={vi.fn()} product={{ ...product, catalog_item_id: 'i1', driver_interface: 'Hex', driver_size: '1.25 mm' }} />);
    expect(screen.getByText('Screwdriver: Hex 1.25 mm')).toBeInTheDocument();
    expect(screen.queryByLabelText('Connection')).not.toBeInTheDocument();
  });

  it('keeps the stored specifications of a hand-entered product', () => {
    render(<ProductForm action={vi.fn()} product={{ ...product, torque_ncm: 35 }} />);
    expect(screen.getByLabelText('Recommended torque (Ncm)')).toHaveValue('35');
  });
});
