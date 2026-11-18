import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanForm } from './plan-form';

const savePlan = vi.hoisted(() => vi.fn());
vi.mock('../actions', () => ({ savePlan }));

describe('console PlanForm', () => {
  beforeEach(() => savePlan.mockClear());
  it('shows Inventory as an enabled checkbox ticked from the saved modules', () => {
    render(<PlanForm plan={{ id: 'p1', name: 'Full', kind: 'course_organizer', modules: ['inventory', 'statistics'] }} />);
    const inv = screen.getByRole('checkbox', { name: /Inventory/ });
    expect(inv).toBeEnabled();
    expect(inv).toBeChecked();
    expect(inv).toHaveAttribute('name', 'module_inventory');
  });

  it('saving an unchanged plan keeps inventory', async () => {
    savePlan.mockResolvedValue({ ok: 'Saved' });
    render(<PlanForm plan={{ id: 'p1', name: 'Full', kind: 'course_organizer', modules: ['inventory', 'statistics'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePlan).toHaveBeenCalled());
    const fd = savePlan.mock.calls[0][1] as FormData;
    expect(fd.get('module_inventory')).toBe('on');
    expect(fd.get('module_statistics')).toBe('on');
  });

  it('unticking Inventory submits without module_inventory', async () => {
    savePlan.mockResolvedValue({ ok: 'Saved' });
    render(<PlanForm plan={{ id: 'p1', name: 'Full', kind: 'course_organizer', modules: ['inventory'] }} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Inventory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    const fd = savePlan.mock.calls.at(-1)![1] as FormData;
    expect(fd.get('module_inventory')).toBeNull();
  });
});
