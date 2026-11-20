import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Product } from '@/lib/inventory/types';
import { BookingSpares } from './booking-spares';

const implant = (d: number, l: number) =>
  ({ id: `p${d}`, type: 'implant', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: d, length_mm: l, description: '' }) as Product;

describe('BookingSpares', () => {
  it('shows Spares: <labels> per tooth, nothing when none', () => {
    const { container, rerender } = render(
      <BookingSpares
        spares={[
          { tooth: 15, position: 1, product: implant(5, 10) },
          { tooth: 14, position: 2, product: implant(4.5, 10) },
          { tooth: 14, position: 1, product: implant(4, 11.5) },
        ]}
      />,
    );
    expect(screen.getByText('Tooth 14 · Spares: Oxy PSK Ø4.0 × 11.5 mm, Oxy PSK Ø4.5 × 10 mm')).toBeInTheDocument();
    expect(screen.getByText('Tooth 15 · Spares: Oxy PSK Ø5.0 × 10 mm')).toBeInTheDocument();
    expect(container.textContent!.indexOf('Tooth 14')).toBeLessThan(container.textContent!.indexOf('Tooth 15'));

    rerender(<BookingSpares spares={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
