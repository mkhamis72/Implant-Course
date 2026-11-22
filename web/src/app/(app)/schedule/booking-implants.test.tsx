import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Product } from '@/lib/inventory/types';
import { BookingImplants } from './booking-implants';

const implant = (d: number, l: number) =>
  ({ id: `p${d}`, type: 'implant', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: d, length_mm: l, description: '' }) as Product;
const planned = (tooth: number, product: Product | null) => ({ tooth, product, site: null });

describe('BookingImplants', () => {
  it('shows the planned implant and the spares per tooth, in tooth order', () => {
    const { container } = render(
      <BookingImplants
        implants={[planned(22, implant(3.5, 10)), planned(14, implant(4, 10)), planned(15, null)]}
        spares={[
          { tooth: 15, position: 1, product: implant(5, 10) },
          { tooth: 14, position: 2, product: implant(4.5, 10) },
          { tooth: 14, position: 1, product: implant(4, 11.5) },
        ]}
      />,
    );
    expect(screen.getByText('Tooth 14 · Implant: Oxy PSK Ø4.0 × 10 mm · Spares: Oxy PSK Ø4.0 × 11.5 mm, Oxy PSK Ø4.5 × 10 mm')).toBeInTheDocument();
    expect(screen.getByText('Tooth 15 · Spares: Oxy PSK Ø5.0 × 10 mm')).toBeInTheDocument();
    expect(screen.getByText('Tooth 22 · Implant: Oxy PSK Ø3.5 × 10 mm')).toBeInTheDocument();
    const text = container.textContent!;
    expect(text.indexOf('Tooth 14')).toBeLessThan(text.indexOf('Tooth 15'));
    expect(text.indexOf('Tooth 15')).toBeLessThan(text.indexOf('Tooth 22'));
  });

  it('shows nothing when no tooth has an implant or spares', () => {
    const { container } = render(<BookingImplants implants={[planned(22, null)]} spares={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
