import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import type { Restoration } from '@/lib/restorations/restorations';
import { todayIso } from '@/lib/dates';

vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
vi.mock('./restoration-actions', () => ({ addRestoration: vi.fn(), updateRestoration: vi.fn(), voidRestoration: vi.fn(),
  recordRestorationProblem: vi.fn(), updateRestorationProblem: vi.fn(), voidRestorationProblem: vi.fn(),
}));
import { Restorations } from './restorations';
import {
  addRestoration, recordRestorationProblem, updateRestoration, updateRestorationProblem, voidRestoration, voidRestorationProblem,
} from './restoration-actions';

const s36 = { id: 's36', tooth: 36, state: 'placed', placed_on: '2026-01-10' } as unknown as ImplantSite;
const s34 = { id: 's34', tooth: 34, state: 'placed', placed_on: '2026-01-10' } as unknown as ImplantSite;
const s16 = { id: 's16', tooth: 16, state: 'placed', placed_on: '2026-01-10' } as unknown as ImplantSite;

const temp: Restoration = {
  id: 'r1', stage: 'temporary', type: 'single_crown', teeth: [36], fitted_on: '2026-01-12', retention: 'screw', material: 'pmma_acrylic',
  delegate_id: null, supervisor_id: null, course_id: null, notes: '', ended_on: null, end_kind: null, end_reason: null,
  updated_at: '2026-01-12T10:00:00.5+00:00', site_ids: ['s36'], problems: [],
};
const final: Restoration = { ...temp, id: 'r2', stage: 'final', material: 'zirconia', fitted_on: '2026-04-01', updated_at: '2026-04-01T10:00:00+00:00' };

const data = (restorations: Restoration[], editable = true) =>
  ({
    statuses: {}, sites: [s36, s34, s16], visits: [], implants: [], componentProducts: [], lots: [], organizers: [],
    delegates: [{ id: 'd1', label: 'Dr Delegate' }], supervisors: [{ id: 'v1', label: 'Dr Supervisor' }],
    courses: [{ id: 'c1', name: 'Autumn course', start_date: '2026-10-01', end_date: '2026-10-30' }],
    restorations, today: '2026-10-21', me: 'u1', editable, canReceive: false,
  }) as unknown as ChartData;

beforeEach(() => {
  vi.mocked(addRestoration).mockReset().mockResolvedValue({});
  vi.mocked(updateRestoration).mockReset().mockResolvedValue({});
  vi.mocked(voidRestoration).mockReset().mockResolvedValue({});
  vi.mocked(recordRestorationProblem).mockReset().mockResolvedValue({});
  vi.mocked(updateRestorationProblem).mockReset().mockResolvedValue({});
  vi.mocked(voidRestorationProblem).mockReset().mockResolvedValue({});
});

describe('<Restorations>', () => {
  it('shows loading and the restorations newest first, the ended one muted; viewers get no Add', () => {
    const ended = { ...temp, ended_on: '2026-04-01', end_kind: 'replaced' as const };
    render(<Restorations site={s36} patientId="pt" data={data([ended, final], false)} />);
    expect(screen.getByText('Loading: Immediate')).toBeInTheDocument();
    const cards = screen.getAllByTestId('restoration');
    expect(cards[0]).toHaveTextContent('Final · Single crown');
    expect(cards[0]).toHaveTextContent('Zirconia');
    expect(cards[1]).toHaveTextContent('Temporary · Single crown');
    expect(cards[1]).toHaveTextContent('Replaced on');
    expect(cards[1]).toHaveClass('text-muted');
    expect(screen.queryByRole('button', { name: 'Add restoration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('adds a bridge: ticking 34 pre-ticks teeth 34–36, and Save sends sites, teeth, stage and type', () => {
    render(<Restorations site={s36} patientId="pt" data={data([])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add restoration' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Stage/ }), { target: { value: 'final' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Type/ }), { target: { value: 'bridge' } });
    const implants = screen.getByRole('group', { name: 'Implants' });
    expect(within(implants).getByRole('checkbox', { name: '36' })).toBeChecked();
    expect(within(implants).queryByRole('checkbox', { name: '16' })).toBeNull();
    fireEvent.click(within(implants).getByRole('checkbox', { name: '34' }));
    const teeth = screen.getByRole('group', { name: 'Teeth covered' });
    const ticked = within(teeth).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked);
    expect(ticked.map((c) => c.getAttribute('aria-label'))).toEqual(['34', '35', '36']);
    // A cantilever beyond the last implant.
    fireEvent.click(within(teeth).getByRole('checkbox', { name: '37' }));
    expect(within(teeth).getByRole('checkbox', { name: '37' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save restoration' }));
    expect(vi.mocked(addRestoration)).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'pt', stage: 'final', type: 'bridge', sites: ['s34', 's36'], teeth: [34, 35, 36, 37],
    }));
  });

  it('limits the date fitted to the latest placement of the ticked implants, and today', () => {
    const later = { ...s34, placed_on: '2026-02-20' } as ImplantSite;
    render(<Restorations site={s36} patientId="pt" data={{ ...data([]), sites: [s36, later, s16] } as ChartData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add restoration' }));
    const fitted = screen.getByLabelText(/Date fitted/);
    expect(fitted).toHaveAttribute('min', '2026-01-10');
    expect(fitted).toHaveAttribute('max', todayIso());
    const implants = screen.getByRole('group', { name: 'Implants' });
    fireEvent.click(within(implants).getByRole('checkbox', { name: '34' }));
    expect(fitted).toHaveAttribute('min', '2026-02-20');
    fireEvent.click(within(implants).getByRole('checkbox', { name: '34' }));
    expect(fitted).toHaveAttribute('min', '2026-01-10');
  });

  it('limits a problem date to the fitting date and today', () => {
    render(<Restorations site={s36} patientId="pt" data={data([final])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a problem' }));
    const noticed = screen.getByLabelText(/Noticed on/);
    expect(noticed).toHaveAttribute('min', final.fitted_on);
    expect(noticed).toHaveAttribute('max', todayIso());
  });

  it('asks for a remake reason only when a current final is covered, and says what it replaces', () => {
    const { unmount } = render(<Restorations site={s36} patientId="pt" data={data([temp])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add restoration' }));
    expect(screen.getByText('Replaces the temporary on 36')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Why was the final remade/)).toBeNull();
    unmount();

    render(<Restorations site={s36} patientId="pt" data={data([final])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add restoration' }));
    expect(screen.getByText('Replaces the final on 36')).toBeInTheDocument();
    expect(screen.getByLabelText(/Why was the final remade/)).toBeInTheDocument();
  });

  it('edits the details of the newest with the version it opened with, and undoes it with a reason', async () => {
    render(<Restorations site={s36} patientId="pt" data={data([final])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Supervisor' }), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(updateRestoration)).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'pt', restorationId: 'r2', expectedUpdatedAt: '2026-04-01T10:00:00+00:00', supervisorId: 'v1', material: 'zirconia',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    fireEvent.change(screen.getByLabelText('Reason for undoing'), { target: { value: 'Wrong tooth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo restoration' }));
    expect(vi.mocked(voidRestoration)).toHaveBeenCalledWith({ patientId: 'pt', restorationId: 'r2', reason: 'Wrong tooth' });
  });

  it('records a problem with type, date, action and notes', () => {
    render(<Restorations site={s36} patientId="pt" data={data([final])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a problem' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Problem/ }), { target: { value: 'debonding' } });
    fireEvent.change(screen.getByLabelText(/^Noticed on/), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Action taken/ }), { target: { value: 'recemented' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Loose after a month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
    expect(vi.mocked(recordRestorationProblem)).toHaveBeenCalledWith({
      patientId: 'pt', restorationId: 'r2', type: 'debonding', noticedOn: '2026-06-01', action: 'recemented', notes: 'Loose after a month',
    });
  });

  it('edits a problem with the version it opened with, and removes it with a reason; viewers get neither', async () => {
    const withProblem: Restoration = { ...final, problems: [{ id: 'p1', noticed_on: '2026-06-01', type: 'chipping', action: 'none', notes: '', updated_at: '2026-06-01T10:00:00+00:00' }] };
    const { unmount } = render(<Restorations site={s36} patientId="pt" data={data([withProblem], false)} />);
    expect(screen.queryByRole('button', { name: 'Record a problem' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit problem' })).toBeNull();
    unmount();
    render(<Restorations site={s36} patientId="pt" data={data([withProblem])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit problem' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Action taken/ }), { target: { value: 'repaired' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
    expect(vi.mocked(updateRestorationProblem)).toHaveBeenCalledWith({
      patientId: 'pt', restorationId: 'r2', problemId: 'p1', expectedUpdatedAt: '2026-06-01T10:00:00+00:00',
      type: 'chipping', noticedOn: '2026-06-01', action: 'repaired', notes: '',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove problem' }));
    fireEvent.change(screen.getByLabelText('Reason for removing'), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from record' }));
    expect(vi.mocked(voidRestorationProblem)).toHaveBeenCalledWith({ patientId: 'pt', problemId: 'p1', reason: 'Duplicate' });
  });

  it('offers Record a problem on an ended (remade) restoration to editors, not viewers', () => {
    const remade = { ...final, id: 'r3', ended_on: '2026-06-01', end_kind: 'remade' as const, end_reason: 'Chipped' };
    const newer = { ...final, id: 'r4', fitted_on: '2026-06-01' };
    const { unmount } = render(<Restorations site={s36} patientId="pt" data={data([remade, newer])} />);
    expect(screen.getAllByRole('button', { name: 'Record a problem' })).toHaveLength(2);
    unmount();
    render(<Restorations site={s36} patientId="pt" data={data([remade, newer], false)} />);
    expect(screen.queryByRole('button', { name: 'Record a problem' })).toBeNull();
  });
});
