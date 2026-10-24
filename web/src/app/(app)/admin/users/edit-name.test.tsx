import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditName } from './edit-name';

const { editName } = vi.hoisted(() => ({ editName: vi.fn(async () => ({})) }));
vi.mock('./actions', () => ({ editName }));

describe('EditName', () => {
  it('shows the name, then a form prefilled with it', () => {
    render(<EditName userId="u1" name="Dr Org" isSelf />);
    expect(screen.getByText('(you)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit name of Dr Org' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Dr Org');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeInTheDocument();
  });

  it('keeps the typed name after an error', async () => {
    editName.mockResolvedValueOnce({ error: 'Keep the name to 120 characters or fewer.' } as never);
    render(<EditName userId="u1" name="Dr Org" isSelf={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit name of Dr Org' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dr Typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep the name');
    expect(screen.getByLabelText('Name')).toHaveValue('Dr Typed');
  });
});
