import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PullRow } from '@/lib/schedule/types';
import { PullTable } from './pull-table';

const row = (over: Partial<PullRow>): PullRow => ({
  product_id: 'p1', type: 'implant', brand: 'Oxy', system: 'PSK', platform: '', diameter_mm: 4, length_mm: 10, description: '',
  needed: 0, spares: 0, available: 0, ...over,
});

describe('PullTable', () => {
  it('shows the Spares column', () => {
    render(
      <PullTable
        rows={[
          row({ product_id: 'p1', needed: 2, spares: 1, available: 1 }),
          // Only a spare: nothing needed, so no shortage either.
          row({ product_id: 'p2', diameter_mm: 4.5, needed: 0, spares: 2, available: 0 }),
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Spares' })).toBeInTheDocument();
    const [first, second] = screen.getAllByTestId('pull-row');
    expect(within(first).getByText('1', { selector: '[data-label="Spares"]' })).toBeInTheDocument();
    expect(within(first).getByText('Short by 1')).toBeInTheDocument();
    expect(within(second).getByText('2', { selector: '[data-label="Spares"]' })).toBeInTheDocument();
    expect(within(second).getByText('0', { selector: '[data-label="Needed"]' })).toBeInTheDocument();
    expect(within(second).queryByText(/Short by/)).not.toBeInTheDocument();
  });
});
