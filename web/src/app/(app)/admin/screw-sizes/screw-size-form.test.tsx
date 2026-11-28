import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScrewSizeForm } from './screw-size-form';
import { systemKey } from '@/lib/admin/screw-sizes';

const { saveScrewSize } = vi.hoisted(() => ({ saveScrewSize: vi.fn(async (_p: unknown, _f: FormData) => ({ ok: 'Screw size added.' } as { ok?: string; error?: string; values?: Record<string, string> })) }));
vi.mock('./actions', () => ({ saveScrewSize }));

const systems = [{ brand: 'Oxy', system: 'PSK' }, { brand: 'Oxy', system: 'MDK' }];
const sent = () => Object.fromEntries((saveScrewSize.mock.calls.at(-1)![1] as FormData).entries());

beforeEach(() => saveScrewSize.mockClear());

describe('ScrewSizeForm', () => {
  it('sends the chosen system, kind, size, screwdriver and torque', async () => {
    render(<ScrewSizeForm systems={systems} />);
    fireEvent.change(screen.getByLabelText('Implant system'), { target: { value: systemKey('Oxy', 'MDK') } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'prosthetic_screw' } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'M2 x 6' } });
    fireEvent.change(screen.getByLabelText('Driver interface'), { target: { value: 'Hex' } });
    fireEvent.change(screen.getByLabelText('Torque (Ncm)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add screw size' }));
    await waitFor(() => expect(saveScrewSize).toHaveBeenCalled());
    expect(sent()).toMatchObject({
      system: systemKey('Oxy', 'MDK'), kind: 'prosthetic_screw', label: 'M2 x 6', driver_interface: 'Hex', torque: '15',
    });
    expect(sent()).not.toHaveProperty('id');
  });

  it('edits a size: the id is sent and the values start filled', async () => {
    const size = {
      id: 's1', brand: 'Oxy', system: 'PSK', kind: 'abutment_screw' as const, label: 'M1.6 x 5',
      driver_interface: 'Hex', driver_size: '1.25', driver_ref: 'SD-1', torque_ncm: 25, active: true,
    };
    render(<ScrewSizeForm systems={systems} size={size} />);
    expect(screen.getByLabelText('Size')).toHaveValue('M1.6 x 5');
    expect(screen.getByLabelText('Torque (Ncm)')).toHaveValue('25');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveScrewSize).toHaveBeenCalled());
    expect(sent()).toMatchObject({ id: 's1', system: systemKey('Oxy', 'PSK'), label: 'M1.6 x 5' });
  });

  it('shows an error and keeps what was typed', async () => {
    saveScrewSize.mockResolvedValueOnce({ error: 'Torque must be between 0 and 150 Ncm.', values: { label: 'M9', torque: '999' } });
    render(<ScrewSizeForm systems={systems} />);
    fireEvent.change(screen.getByLabelText('Implant system'), { target: { value: systemKey('Oxy', 'PSK') } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'M9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add screw size' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Torque must be between 0 and 150 Ncm.');
    expect(screen.getByLabelText('Size')).toHaveValue('M9');
  });
});
