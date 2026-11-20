import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoctorRow } from './doctor-row';

const { setDoctorLogin } = vi.hoisted(() => ({ setDoctorLogin: vi.fn(async (_prev: unknown, _f: FormData) => ({ ok: 'Saved.' })) }));
vi.mock('./actions', () => ({ addDoctor: vi.fn(), updateDoctor: vi.fn(), setDoctorLogin }));

const doctor = { id: 'doc1', name: 'Dr Nabil', active: true, user_id: null as string | null };
const logins = [{ user_id: 'u2', full_name: 'Dr Sara', email: 'sara@example.com' }];
const sent = () => Object.fromEntries((setDoctorLogin.mock.calls.at(-1)![1] as FormData).entries());

beforeEach(() => setDoctorLogin.mockClear());

describe('DoctorRow login', () => {
  it('shows the linked login and unlinks it', async () => {
    render(<DoctorRow doctor={{ ...doctor, user_id: 'u1' }} login={{ full_name: 'Dr Nabil Login', email: 'nabil@example.com' }} logins={logins} />);
    expect(screen.getByText('Login: Dr Nabil Login (nabil@example.com)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink the login of Dr Nabil' }));
    await waitFor(() => expect(setDoctorLogin).toHaveBeenCalled());
    expect(sent()).toEqual({ id: 'doc1', user_id: '' });
  });

  it('links one of the offered logins', async () => {
    render(<DoctorRow doctor={doctor} login={null} logins={logins} />);
    expect(screen.getByText('No login')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Login for Dr Nabil' }), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link login' }));
    await waitFor(() => expect(setDoctorLogin).toHaveBeenCalled());
    expect(sent()).toEqual({ id: 'doc1', user_id: 'u2' });
  });

  it('offers no link without a free login', () => {
    render(<DoctorRow doctor={doctor} login={null} logins={[]} />);
    expect(screen.queryByRole('button', { name: 'Link login' })).not.toBeInTheDocument();
  });
});
