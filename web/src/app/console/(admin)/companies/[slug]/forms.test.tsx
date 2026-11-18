import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanForm } from './forms';

const setCompanyPlan = vi.hoisted(() => vi.fn());
vi.mock('../../actions', () => ({
  addDomain: vi.fn(), firstAdmin: vi.fn(), setCompanyPlan, setCompanyStatus: vi.fn(), updateCompany: vi.fn(),
}));

const plans = [{ id: 'p1', name: 'Core', kind: 'course_organizer' as const }];
const bothPlans = [...plans, { id: 'p2', name: 'Solo', kind: 'clinic' as const }];

describe('company PlanForm type change', () => {
  it('offers Clinic, and asks for confirmation only when the type differs', () => {
    render(<PlanForm slug="a" kind="course_organizer" planId="p1" extras={[]} plans={bothPlans} />);
    expect(screen.getByRole('option', { name: 'Clinic' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: /I understand/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'clinic' } });
    const box = screen.getByRole('checkbox', { name: /switching to Clinic hides courses/ });
    expect(box).toHaveAttribute('name', 'confirm_kind_change');
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'course_organizer' } });
    expect(screen.queryByRole('checkbox', { name: /I understand/ })).toBeNull();
  });

  it('the Course organizer confirmation shows them again', () => {
    render(<PlanForm slug="a" kind="clinic" planId="p2" extras={[]} plans={bothPlans} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'course_organizer' } });
    expect(screen.getByRole('checkbox', { name: 'I understand: switching to Course organizer shows them again.' })).toBeInTheDocument();
  });

  it('with no plan of the chosen kind, hints and disables Save', () => {
    render(<PlanForm slug="a" kind="course_organizer" planId="p1" extras={[]} plans={plans} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'clinic' } });
    expect(screen.getByText('Create a Clinic plan on the Plans page first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

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
