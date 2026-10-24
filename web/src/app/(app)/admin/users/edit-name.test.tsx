import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditName } from './edit-name';

vi.mock('./actions', () => ({ editName: vi.fn(async () => ({})) }));

describe('EditName', () => {
  it('shows the name, then a form prefilled with it', () => {
    render(<EditName userId="u1" name="Dr Org" isSelf />);
    expect(screen.getByText('(you)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit name of Dr Org' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Dr Org');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeInTheDocument();
  });
});
