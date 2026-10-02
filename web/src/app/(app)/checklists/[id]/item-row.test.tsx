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
