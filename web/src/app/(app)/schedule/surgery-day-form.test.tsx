import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurgeryDayForm } from './surgery-day-form';

vi.mock('./actions', () => ({ addSurgeryDay: vi.fn() }));

const courses = [
  { id: 'c1', label: 'Implant Course 12' },
  { id: 'c2', label: 'Implant Course 13' },
];

describe('SurgeryDayForm', () => {
  it('fills in the day, the first course covering it and the usual defaults', () => {
    const { container } = render(<SurgeryDayForm date="2030-03-02" courses={courses} />);
    expect(container.querySelector('input[name="date"]')).toHaveValue('2030-03-02');
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveValue('c1');
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Surgery day');
    expect(screen.getByLabelText('Starts')).toHaveValue('08:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('17:00');
    expect(screen.getByRole('button', { name: 'Add surgery day' })).toBeInTheDocument();
  });

  it('has no session type choice: it always adds a surgery session', () => {
    render(<SurgeryDayForm date="2030-03-02" courses={courses} />);
    expect(screen.queryByRole('combobox', { name: /type/i })).not.toBeInTheDocument();
  });
});
