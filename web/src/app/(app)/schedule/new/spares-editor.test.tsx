import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Product } from '@/lib/inventory/types';
import { SparesEditor } from './spares-editor';

const implant = (id: string, d: number, l: number) =>
  ({ id, type: 'implant', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: d, length_mm: l, description: '' }) as Product;
const products = [implant('p1', 4, 10), implant('p2', 4.5, 11.5)];

function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SparesEditor tooth="14" value={value} products={products} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
const value = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('SparesEditor', () => {
  it('add and remove spares', () => {
    render(<Harness />);
    expect(screen.getByText('Spares')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'Oxy PSK Ø4.0 × 10 mm' })).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: 'p1' } });
    fireEvent.change(selects[1], { target: { value: 'p2' } });
    expect(value()).toEqual(['p1', 'p2']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove spare 1 for tooth 14' }));
    expect(value()).toEqual(['p2']);
    expect(screen.getByRole('combobox', { name: 'Spare 1 for tooth 14' })).toHaveValue('p2');
  });

  it('no more than 5', () => {
    render(<Harness initial={['p1', 'p2', '', '']} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add spare' }));
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '+ Add spare' })).not.toBeInTheDocument();
  });
});
