import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PatientPicker } from './patient-picker';
import { searchBookingPatients } from '../actions';
import type { BookingPatient } from '@/lib/schedule/types';

vi.mock('../actions', () => ({ searchBookingPatients: vi.fn(async () => []) }));

const amal: BookingPatient = { id: 'p1', file_no: 'P00012', full_name: 'Amal Hassan', dob: '1980-01-15', phone: '0100 111 2222' };
const many = (n: number): BookingPatient[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, file_no: `F${i}`, full_name: `Zz Many ${i}`, dob: null, phone: null }));

function Harness({ canOpenFile = true, onChange = () => {} }: { canOpenFile?: boolean; onChange?: (p: BookingPatient | null) => void }) {
  const [value, setValue] = useState<BookingPatient | null>(null);
  return <PatientPicker canOpenFile={canOpenFile} value={value} onChange={(p) => { setValue(p); onChange(p); }} />;
}

const box = () => screen.getByRole('combobox', { name: 'Patient' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

beforeEach(() => {
  vi.mocked(searchBookingPatients).mockReset();
  vi.mocked(searchBookingPatients).mockResolvedValue([amal]);
});

describe('PatientPicker', () => {
  it('searches after 2 characters', async () => {
    render(<Harness />);
    type('A');
    await new Promise((r) => setTimeout(r, 350));
    expect(searchBookingPatients).not.toHaveBeenCalled();
    type('Am');
    await waitFor(() => expect(searchBookingPatients).toHaveBeenCalledWith('Am'));
    expect(searchBookingPatients).toHaveBeenCalledTimes(1);
    const option = await screen.findByRole('option', { name: /Amal Hassan/ });
    expect(option).toHaveTextContent('P00012');
    expect(option).toHaveTextContent('0100 111 2222');
    expect(box()).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows at most 10', async () => {
    vi.mocked(searchBookingPatients).mockResolvedValue(many(12));
    render(<Harness />);
    type('Zz Many');
    await screen.findByRole('option', { name: /Zz Many 0/ });
    expect(screen.getAllByRole('option')).toHaveLength(10);
  });

  it('choose shows the card', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type('Amal');
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    expect(onChange).toHaveBeenLastCalledWith(amal);
    expect(screen.getByText(/^P00012 · Amal Hassan · \d+ · 0100 111 2222$/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Patient' })).not.toBeInTheDocument();
  });

  it('Open file links to the patient in a new tab', async () => {
    render(<Harness />);
    type('Amal');
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    const link = screen.getByRole('link', { name: /Open file/ });
    expect(link).toHaveAttribute('href', '/patients/p1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
  });

  it('no Open file without Patients view', async () => {
    render(<Harness canOpenFile={false} />);
    type('Amal');
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    expect(screen.queryByRole('link', { name: /Open file/ })).not.toBeInTheDocument();
    expect(screen.getByText('File: no access')).toBeInTheDocument();
  });

  it('Change clears the choice', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type('Amal');
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(box()).toHaveValue('');
    expect(screen.queryByText(/P00012 · Amal Hassan/)).not.toBeInTheDocument();
  });

  it('keyboard: arrows and Enter choose', async () => {
    const second: BookingPatient = { ...amal, id: 'p2', file_no: 'P00013', full_name: 'Amal Second' };
    vi.mocked(searchBookingPatients).mockResolvedValue([amal, second]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type('Amal');
    await screen.findByRole('option', { name: /Amal Second/ });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Amal Hassan/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const active = screen.getByRole('option', { name: /Amal Second/ });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(box()).toHaveAttribute('aria-activedescendant', active.id);
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(second);
    expect(screen.getByText(/^P00013 · Amal Second/)).toBeInTheDocument();
  });

  it('choosing moves focus to Change', async () => {
    render(<Harness />);
    type('Amal');
    fireEvent.click(await screen.findByRole('option', { name: /Amal Hassan/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus());
  });

  it('Enter with text and nothing highlighted does not submit', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Harness /></form>);
    type('Amal');
    await screen.findByRole('option', { name: /Amal Hassan/ });
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    box().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('a failed search shows no matches, quietly', async () => {
    vi.mocked(searchBookingPatients).mockRejectedValue(new Error('network'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness />);
    type('Amal');
    await waitFor(() => expect(searchBookingPatients).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    errors.mockRestore();
  });

  it('the status region is always there', async () => {
    vi.mocked(searchBookingPatients).mockResolvedValue([]);
    render(<Harness />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    type('Nobody');
    await waitFor(() => expect(status).toHaveTextContent('No patients match.'));
    expect(screen.getByRole('status')).toBe(status);
  });

  it('Escape closes the list', async () => {
    render(<Harness />);
    type('Amal');
    await screen.findByRole('option', { name: /Amal Hassan/ });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  });
});
