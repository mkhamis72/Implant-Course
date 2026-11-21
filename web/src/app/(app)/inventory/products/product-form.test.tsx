import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Product } from '@/lib/inventory/types';
import { ProductForm } from './product-form';

const product = {
  id: 'p1', type: 'implant', category: 'surgical', brand: 'Oxy Implant', system: 'PSK-MDK · PSK Normo', platform: 'Standard',
  diameter_mm: 4.5, length_mm: 10, ref_code: 'PSKR45100', description: '', reorder_level: 2, active: true, is_sample: false,
  catalog_item_id: null,
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
