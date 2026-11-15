import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ErrorsTable } from './errors-table';

describe('ErrorsTable', () => {
  it('one row per kind of error: how often, when first and last seen (Cairo time), and the message', () => {
    render(
      <ErrorsTable
        groups={[
          { message: 'EMAXCONNSESSION', count: 1, first: '2026-11-15T11:00:00Z', last: '2026-11-15T11:00:00Z' },
          { message: 'sendEmail failed: 535', count: 2, first: '2026-11-14T10:00:00Z', last: '2026-11-15T10:05:00Z' },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('sendEmail failed: 535')).toBeTruthy();
    expect(within(rows[1]).getByText('2')).toBeTruthy();
    expect(within(rows[1]).getByText('15 Nov 2026, 12:05')).toBeTruthy();
    expect(within(rows[1]).getByText('14 Nov 2026, 12:00')).toBeTruthy();
  });
  it('says so when nothing was recorded', () => {
    render(<ErrorsTable groups={[]} />);
    expect(screen.getByText('No errors recorded in the last 30 days.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
