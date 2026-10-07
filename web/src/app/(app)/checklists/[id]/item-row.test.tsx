import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChecklistItem } from '@/lib/checklists/types';

vi.mock('../actions', () => ({ toggleItem: vi.fn(), moveItem: vi.fn(), editItem: vi.fn(), deleteItem: vi.fn() }));
import { ItemRow } from './item-row';

const base: ChecklistItem = {
  id: 'i1', position: 1, text: 'Call the lab', assignee_id: null, due_date: null, done_at: null, done_by_profile: null, assignee: null,
};
const organizers = [{ id: 'u1', label: 'Dr X' }];

describe('<ItemRow> edit form (I3)', () => {
  it('opens with the latest saved assignee and due date, not the values from first render', () => {
    const { rerender } = render(<ul><ItemRow item={base} checklistId="c1" organizers={organizers} first last /></ul>);
    rerender(
      <ul>
        <ItemRow item={{ ...base, assignee_id: 'u1', due_date: '2031-01-15', assignee: { full_name: 'Dr X', email: 'x@x' } }} checklistId="c1" organizers={organizers} first last />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('combobox', { name: 'Assigned to' })).toHaveValue('u1');
    expect(screen.getByLabelText('Due date')).toHaveValue('2031-01-15');
  });
});

describe('<ItemRow> inactive assignee', () => {
  it('keeps an assignee who is no longer active, labelled "(inactive)"', () => {
    const item = { ...base, assignee_id: 'gone', assignee: { full_name: 'Dr Gone', email: 'g@x' } };
    render(<ul><ItemRow item={item} checklistId="c1" organizers={organizers} first last /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('combobox', { name: 'Assigned to' })).toHaveValue('gone');
    expect(screen.getByRole('option', { name: 'Dr Gone (inactive)' })).toBeInTheDocument();
  });
});

describe('<ItemRow> email warning', () => {
  it('closes the edit form after saving and shows a warning when the email failed', async () => {
    const { editItem } = await import('../actions');
    vi.mocked(editItem).mockResolvedValueOnce({ warning: "Saved, but the email to Dr X couldn't be sent." });
    render(<ul><ItemRow item={base} checklistId="c1" organizers={organizers} first last /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Assigned to' }), { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Saved, but the email to Dr X couldn't be sent.");
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(editItem).toHaveBeenCalledWith({ id: 'i1', checklistId: 'c1', text: 'Call the lab', assignee_id: 'u1', due_date: '' });
  });
});
