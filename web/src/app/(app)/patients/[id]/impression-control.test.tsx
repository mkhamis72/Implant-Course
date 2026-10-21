import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayIso } from '@/lib/dates';
import type { ImplantSite } from '@/lib/inventory/types';

const recordImpression = vi.fn(async (_prev: unknown, _fd: FormData) => ({}));
vi.mock('./implant-actions', () => ({ recordImpression: (prev: unknown, fd: FormData) => recordImpression(prev, fd) }));

import { ImpressionControl } from './impression-control';

const site = { id: 's1', updated_at: '2026-10-21T10:00:00Z', impression_type: null, impression_taken_on: null } as unknown as ImplantSite;

describe('ImpressionControl', () => {
  it('shows the badge but no select to viewers', () => {
    render(<ImpressionControl site={site} patientId="p1" editable={false} />);
    expect(screen.getByText('Not taken')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('saves the chosen type and today as the date', async () => {
    const user = userEvent.setup();
    render(<ImpressionControl site={site} patientId="p1" editable />);
    await user.selectOptions(screen.getByRole('combobox', { name: /scan \/ impression/i }), 'digital_scan');
    expect(screen.getByLabelText(/date/i)).toHaveValue(todayIso());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const fd = recordImpression.mock.calls[0][1];
    expect(fd.get('type')).toBe('digital_scan');
    expect(fd.get('takenOn')).toBe(todayIso());
    expect(fd.get('expectedUpdatedAt')).toBe('2026-10-21T10:00:00Z');
  });
});
