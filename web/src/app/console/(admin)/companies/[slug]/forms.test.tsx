import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanForm } from './forms';

const setCompanyPlan = vi.hoisted(() => vi.fn());
vi.mock('../../actions', () => ({
  addDomain: vi.fn(), firstAdmin: vi.fn(), setCompanyPlan, setCompanyStatus: vi.fn(), updateCompany: vi.fn(),
}));

const plans = [{ id: 'p1', name: 'Core', kind: 'course_organizer' as const }];

describe('company PlanForm', () => {
  it('Inventory is an enabled extra, ticked from the saved extras', () => {
    render(<PlanForm slug="a" kind="course_organizer" planId="p1" extras={['inventory']} plans={plans} />);
    const inv = screen.getByRole('checkbox', { name: /Inventory/ });
    expect(inv).toBeEnabled();
    expect(inv).toBeChecked();
    expect(inv).toHaveAttribute('name', 'extra_inventory');
  });

  it('unticking Inventory submits without extra_inventory', async () => {
    setCompanyPlan.mockResolvedValue({ ok: 'Saved' });
    render(<PlanForm slug="a" kind="course_organizer" planId="p1" extras={['inventory']} plans={plans} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Inventory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setCompanyPlan).toHaveBeenCalled());
    expect((setCompanyPlan.mock.calls[0][1] as FormData).get('extra_inventory')).toBeNull();
  });
});
