import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PermissionGrid } from './permission-grid';

import type { Feature } from '@/lib/modules/modules';
vi.mock('./actions', () => ({ savePermissions: vi.fn() }));

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const ALL: Feature[] = ['inventory', 'statistics', 'teaching'];

describe('PermissionGrid', () => {
  it('offers None / View / Edit for the panels', () => {
    render(<PermissionGrid userId={id} permissions={{ patients: 'edit' }} features={ALL} />);
    const patients = screen.getByRole('group', { name: 'Patients' });
    expect(within(patients).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['none', 'view', 'edit']);
    expect(within(patients).getByRole('radio', { name: 'Edit' })).toBeChecked();
  });

  it('offers Research with None / View / Edit', () => {
    render(<PermissionGrid userId={id} permissions={{ research: 'view' }} features={ALL} />);
    const research = screen.getByRole('group', { name: 'Statistics' });
    expect(within(research).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['none', 'view', 'edit']);
    expect(within(research).getByRole('radio', { name: 'View' })).toBeChecked();
    expect(within(research).getByRole('radio', { name: 'View' })).toHaveAttribute('name', 'perm_research');
  });

  it('defaults Research to None', () => {
    render(<PermissionGrid userId={id} permissions={{}} features={ALL} />);
    expect(within(screen.getByRole('group', { name: 'Statistics' })).getByRole('radio', { name: 'None' })).toBeChecked();
  });

  it('hides a switched-off area', () => {
    render(<PermissionGrid userId={id} permissions={{}} features={['inventory']} />);
    expect(screen.queryByRole('group', { name: 'Statistics' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Patients' })).toBeInTheDocument();
  });

  it("keeps a hidden area's level", () => {
    const { container, rerender } = render(<PermissionGrid userId={id} permissions={{ research: 'edit' }} features={['inventory']} />);
    expect(container.querySelector('input[type="hidden"][name="perm_research"]')).toHaveAttribute('value', 'edit');
    rerender(<PermissionGrid userId={id} permissions={{}} features={['inventory']} />);
    expect(container.querySelector('input[type="hidden"][name="perm_research"]')).toHaveAttribute('value', 'none');
  });
});
