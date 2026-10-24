import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
vi.mock('./actions', () => ({ saveRadiograph: vi.fn(), voidRadiograph: vi.fn() }));
import { RadiographForm, type XraySite } from './radiograph-form';
import { saveRadiograph } from './actions';
import { todayIso } from '@/lib/dates';

const sites: XraySite[] = [
  { id: 's36', tooth: 36, state: 'placed', placed_on: '2026-01-10' },
  { id: 's21', tooth: 21, state: 'planned', placed_on: null },
];

beforeEach(() => {
  vi.mocked(saveRadiograph).mockReset().mockResolvedValue({});
});

const tick = (tooth: number) => fireEvent.click(screen.getByRole('checkbox', { name: String(tooth) }));

describe('RadiographForm', () => {
  it('keeps a stored date that is now outside the limits when editing', () => {
    const old = { id: 'x1', taken_on: '2025-12-01', type: 'periapical', purpose: 'baseline', teeth: [36], link: null, notes: '', levels: [], updated_at: 't' };
    render(<RadiographForm patientId="p1" sites={sites} radiograph={old as never} onDone={() => {}} />);
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2025-12-01');
    expect(screen.getByLabelText(/^Date/)).toHaveAttribute('min', '2026-01-10');
  });


  it('limits a non-planning X-ray to the first placement on its teeth; a planning one only to today', () => {
    render(<RadiographForm patientId="p1" sites={sites} onDone={() => {}} />);
    const date = screen.getByLabelText(/^Date/);
    const purpose = screen.getByRole('combobox', { name: /Purpose/ });
    tick(36);
    fireEvent.change(purpose, { target: { value: 'baseline' } });
    expect(date).toHaveAttribute('min', '2026-01-10');
    expect(date).toHaveAttribute('max', todayIso());
    fireEvent.change(purpose, { target: { value: 'planning' } });
    expect(date).not.toHaveAttribute('min');
    expect(date).toHaveAttribute('max', todayIso());
  });


  it('shows a bone-level row only for ticked teeth with an implant', () => {
    render(<RadiographForm patientId="p1" sites={sites} onDone={() => {}} />);
    expect(screen.queryByLabelText('Mesial 36')).toBeNull();
    tick(35);
    expect(screen.queryByLabelText('Mesial 36')).toBeNull();
    tick(36);
    expect(screen.getByLabelText('Mesial 36')).toBeTruthy();
    tick(21);
    expect(screen.queryByLabelText('Mesial 21')).toBeNull();
  });

  it('pre-ticks prefillTeeth', () => {
    render(<RadiographForm patientId="p1" sites={sites} prefillTeeth={[36]} onDone={() => {}} />);
    expect((screen.getByRole('checkbox', { name: '36' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Mesial 36')).toBeTruthy();
  });

  it('saves teeth and measurement fields', async () => {
    const onDone = vi.fn();
    render(<RadiographForm patientId="p1" sites={sites} prefillTeeth={[36]} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'periapical' } });
    fireEvent.change(screen.getByLabelText(/^Purpose/), { target: { value: 'baseline' } });
    fireEvent.change(screen.getByLabelText('Mesial 36'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save X-ray' }));
    await waitFor(() => expect(saveRadiograph).toHaveBeenCalled());
    const input = vi.mocked(saveRadiograph).mock.calls[0][0];
    expect(input).toMatchObject({ patientId: 'p1', teeth: [36], type: 'periapical', purpose: 'baseline', mesial_s36: '0.5', distal_s36: '' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('sends the version when editing', async () => {
    const r = { id: 'x1', taken_on: '2026-02-01', type: 'cbct', purpose: 'planning', teeth: [36], link: null, notes: '', updated_at: 'v1', levels: [] } as never;
    render(<RadiographForm patientId="p1" sites={sites} radiograph={r} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save X-ray' }));
    await waitFor(() => expect(saveRadiograph).toHaveBeenCalled());
    expect(vi.mocked(saveRadiograph).mock.calls[0][0]).toMatchObject({ id: 'x1', expectedUpdatedAt: 'v1', takenOn: '2026-02-01' });
  });
  it('refuses to untick a tooth that still has a bone level', async () => {
    const r = { id: 'x1', taken_on: '2026-02-01', type: 'periapical', purpose: 'baseline', teeth: [36], link: null, notes: '', updated_at: 'v1',
      levels: [{ site: 's36', mesial_mm: 0.5, distal_mm: null }] } as never;
    render(<RadiographForm patientId="p1" sites={sites} radiograph={r} onDone={() => {}} />);
    tick(36);
    fireEvent.click(screen.getByRole('button', { name: 'Save X-ray' }));
    expect(await screen.findByText('Clear the bone level for tooth 36 before removing it from the X-ray.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('tooth 36');
    expect(saveRadiograph).not.toHaveBeenCalled();
  });

  it('caps the date at today', () => {
    render(<RadiographForm patientId="p1" sites={sites} onDone={() => {}} />);
    expect(screen.getByLabelText(/^Date/).getAttribute('max')).toBe(todayIso());
  });

  it('labels a failed implant apart from its replacement on the same tooth', () => {
    const two: XraySite[] = [
      { id: 'old', tooth: 36, state: 'failed', placed_on: '2025-01-10' },
      { id: 'new', tooth: 36, state: 'placed', placed_on: '2026-01-10' },
    ];
    render(<RadiographForm patientId="p1" sites={two} prefillTeeth={[36]} onDone={() => {}} />);
    expect(screen.getByLabelText('Mesial 36 (failed)')).toBeTruthy();
    expect(screen.getByLabelText('Mesial 36')).toBeTruthy();
    expect(screen.getByText('36 (failed)')).toBeTruthy();
  });
});
