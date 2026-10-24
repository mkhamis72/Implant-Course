import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayIso } from '@/lib/dates';
import type { ImplantSite } from '@/lib/inventory/types';

const recordImpression = vi.fn<(prev: unknown, fd: FormData) => Promise<object>>(async () => ({}));
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

  it('keeps a missing date blank on a legacy row that has a type', () => {
    const legacy = { ...site, impression_type: 'conventional', impression_taken_on: null } as unknown as ImplantSite;
    render(<ImpressionControl site={legacy} patientId="p1" editable />);
    expect(screen.getByLabelText(/date/i)).toHaveValue('');
  });

  it('shows the saved date when one is recorded', () => {
    const saved = { ...site, impression_type: 'digital_scan', impression_taken_on: '2026-10-01' } as unknown as ImplantSite;
    render(<ImpressionControl site={saved} patientId="p1" editable />);
    expect(screen.getByLabelText(/date/i)).toHaveValue('2026-10-01');
  });
});

describe('scan date limits', () => {
  it('from placement to today', () => {
    const saved = { ...site, placed_on: '2026-03-10', impression_type: 'digital_scan', impression_taken_on: '2026-10-01' } as unknown as ImplantSite;
    render(<ImpressionControl site={saved} patientId="p1" editable />);
    expect(screen.getByLabelText(/date/i)).toHaveAttribute('min', '2026-03-10');
    expect(screen.getByLabelText(/date/i)).toHaveAttribute('max', todayIso());
  });
});
