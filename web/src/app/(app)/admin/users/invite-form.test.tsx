import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InviteForm } from './invite-form';

const { inviteUser } = vi.hoisted(() => ({ inviteUser: vi.fn(async (_prev: unknown, _f: FormData) => ({ ok: 'Invitation sent.' })) }));
vi.mock('./actions', () => ({ inviteUser }));

const doctors = [{ id: 'doc1', name: 'Dr Nabil' }];
const sent = () => Object.fromEntries((inviteUser.mock.calls.at(-1)![1] as FormData).entries());

function fill() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dr New' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
}

describe('InviteForm in a clinic', () => {
  it('offers Admin and Doctor, and a doctor choice that starts on a new doctor', () => {
    render(<InviteForm emailOn clinic doctors={doctors} />);
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect([...(role as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Admin', 'Doctor']);
    expect(role).toHaveValue('organizer');
    const choice = screen.getByRole('combobox', { name: 'Doctor' });
    expect([...(choice as HTMLSelectElement).options].map((o) => o.text)).toEqual(['New doctor named after the user', 'Dr Nabil']);
    expect(choice).toHaveValue('new');
    expect(screen.queryByRole('checkbox', { name: 'Also a doctor' })).not.toBeInTheDocument();
  });

  it('submits the chosen doctor for a Doctor', async () => {
    render(<InviteForm emailOn clinic doctors={doctors} />);
    fill();
    fireEvent.change(screen.getByRole('combobox', { name: 'Doctor' }), { target: { value: 'doc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(inviteUser).toHaveBeenCalled());
    expect(sent()).toMatchObject({ role: 'organizer', doctor: 'doc1' });
  });

  it('shows Also a doctor only for Admin, and the doctor choice once ticked', async () => {
    render(<InviteForm emailOn clinic doctors={doctors} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'admin' } });
    expect(screen.queryByRole('combobox', { name: 'Doctor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also a doctor' }));
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveValue('new');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(inviteUser).toHaveBeenCalled());
    expect(sent()).toMatchObject({ role: 'admin', also_doctor: 'on', doctor: 'new' });
  });
});

describe('InviteForm in a course organizer company', () => {
  it('keeps Organizer and Admin with no doctor choice', () => {
    render(<InviteForm emailOn={false} clinic={false} doctors={doctors} />);
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect([...(role as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Organizer', 'Admin']);
    expect(screen.queryByRole('combobox', { name: 'Doctor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Also a doctor' })).not.toBeInTheDocument();
  });
});
