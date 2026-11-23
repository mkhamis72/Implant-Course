import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import type { FullArchCase } from '@/lib/full-arch/cases';
import type { Restoration } from '@/lib/restorations/restorations';

vi.mock('./case-actions', () => ({
  createCase: vi.fn(), updateCase: vi.fn(), setCaseSites: vi.fn(), setCaseRestoration: vi.fn(), recordCaseStage: vi.fn(),
  clearCaseStage: vi.fn(), closeCase: vi.fn(), reopenCase: vi.fn(),
}));
import { FullArchCasePanel, caseCaptions } from './full-arch-case';
import { clearCaseStage, closeCase, createCase, recordCaseStage, reopenCase, setCaseSites, updateCase } from './case-actions';

const site = (id: string, tooth: number, state: string, placed_on: string | null, case_id: string | null = null) =>
  ({ id, tooth, state, placed_on, case_id, implant_type: placed_on ? 'conventional' : null, angulation_deg: null,
    angulation_direction: null, anchorage: null }) as unknown as ImplantSite;

const CASE: FullArchCase = {
  id: 'c1', arch: 'upper', configuration: 'all_on_4', name: '', notes: '', closed_at: null, close_reason: null,
  updated_at: '2030-05-01T10:00:00+00:00',
  stages: [{ stage: 'scan', done_on: '2030-05-03', lab: null, passive_fit: null, occlusion: null, notes: '' }],
};

const data = (over: Partial<ChartData> = {}) =>
  ({
    statuses: {}, visits: [], implants: [], componentProducts: [], lots: [], delegates: [], organizers: [], supervisors: [],
    restorations: [], courses: [], radiographs: [], today: '2030-06-10', me: 'u1', editable: true, inventoryOn: true,
    teachingOn: true, doctors: [], cases: [],
    sites: [
      site('s14', 14, 'placed', '2030-05-01'), site('s24', 24, 'planned', null), site('s16', 16, 'removed', null),
      site('s12', 12, 'failed', '2030-04-01'), site('s36', 36, 'placed', '2030-05-01'),
    ],
    ...over,
  }) as unknown as ChartData;

const inCase = (over: Partial<ChartData> = {}) => data({
  cases: [CASE],
  sites: [site('s14', 14, 'placed', '2030-05-02', 'c1'), site('s24', 24, 'placed', '2030-05-01', 'c1'), site('s36', 36, 'placed', '2030-05-01')],
  ...over,
});

beforeEach(() => {
  for (const fn of [createCase, updateCase, setCaseSites, recordCaseStage, clearCaseStage, closeCase, reopenCase]) {
    vi.mocked(fn).mockReset().mockResolvedValue({});
  }
});

describe('<FullArchCasePanel>', () => {
  it('starts a case with the chosen configuration and the arch planned/placed implants pre-ticked', async () => {
    render(<FullArchCasePanel patientId="pt" data={data()} arch="upper" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start upper case' }));
    expect(screen.getByRole('checkbox', { name: /14/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /24/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /12/ })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /16/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /36/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: /Configuration/ }), { target: { value: 'all_on_6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start case' }));
    await vi.waitFor(() => expect(createCase).toHaveBeenCalled());
    expect(createCase).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'pt', arch: 'upper', configuration: 'all_on_6', sites: ['s14', 's24'],
    }));
  });

  it('read-only: shows the case without buttons, and no Start button', () => {
    render(<FullArchCasePanel patientId="pt" data={inCase({ editable: false })} arch="upper" />);
    const panel = screen.getByRole('region', { name: 'Upper arch · All-on-4' });
    expect(within(panel).getByText('In treatment')).toBeInTheDocument();
    expect(within(panel).queryByRole('button')).toBeNull();
    render(<FullArchCasePanel patientId="pt" data={data({ editable: false })} arch="lower" />);
    expect(screen.queryByRole('button', { name: 'Start lower case' })).toBeNull();
  });

  it('no Start button while the arch has an open case', () => {
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    expect(screen.queryByRole('button', { name: 'Start upper case' })).toBeNull();
  });

  it('lists the stages; the stage form sends lab only for lab design, with date min/max', async () => {
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    expect(screen.getByTestId('stage-scan')).toHaveTextContent('03 May 2030');
    expect(screen.getByTestId('stage-try_in')).toHaveTextContent('Not recorded');
    expect(screen.getByTestId('stage-delivery')).toHaveTextContent('Not yet');
    fireEvent.click(within(screen.getByTestId('stage-lab_design')).getByRole('button', { name: 'Record' }));
    const date = screen.getByLabelText(/Date/);
    expect(date).toHaveAttribute('min', '2030-05-01');
    expect(date).toHaveAttribute('max', '2030-06-10');
    expect(screen.queryByLabelText(/Passive fit/)).toBeNull();
    fireEvent.change(date, { target: { value: '2030-05-20' } });
    fireEvent.change(screen.getByLabelText(/Lab name/), { target: { value: 'Smile Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await vi.waitFor(() => expect(recordCaseStage).toHaveBeenCalled());
    expect(recordCaseStage).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'c1', stage: 'lab_design', doneOn: '2030-05-20', lab: 'Smile Lab', passiveFit: null, occlusion: null,
    }));
  });

  it('the try-in form sends passive fit and occlusion, no lab', async () => {
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    fireEvent.click(within(screen.getByTestId('stage-try_in')).getByRole('button', { name: 'Record' }));
    expect(screen.queryByLabelText(/Lab name/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2030-06-01' } });
    fireEvent.change(screen.getByLabelText(/Passive fit/), { target: { value: 'no' } });
    fireEvent.change(screen.getByLabelText(/Occlusion/), { target: { value: 'High on 24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stage' }));
    await vi.waitFor(() => expect(recordCaseStage).toHaveBeenCalled());
    expect(recordCaseStage).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'try_in', lab: null, passiveFit: false, occlusion: 'High on 24',
    }));
  });

  it('clears a recorded stage', async () => {
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    fireEvent.click(within(screen.getByTestId('stage-scan')).getByRole('button', { name: 'Clear' }));
    await vi.waitFor(() => expect(clearCaseStage).toHaveBeenCalledWith({ patientId: 'pt', caseId: 'c1', stage: 'scan' }));
  });

  it('saves the case implants', async () => {
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    fireEvent.click(screen.getByRole('button', { name: 'Change implants' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /24/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save implants' }));
    await vi.waitFor(() => expect(setCaseSites).toHaveBeenCalledWith({
      patientId: 'pt', caseId: 'c1', sites: ['s14'], expectedUpdatedAt: CASE.updated_at,
    }));
  });

  it('closing needs a reason: the action error is shown', async () => {
    vi.mocked(closeCase).mockResolvedValue({ error: 'Give a reason to close the case.' });
    render(<FullArchCasePanel patientId="pt" data={inCase()} arch="upper" />);
    fireEvent.click(screen.getByRole('button', { name: 'Close case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close the case' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason to close the case.');
    expect(closeCase).toHaveBeenCalledWith({ patientId: 'pt', caseId: 'c1', reason: '', expectedUpdatedAt: CASE.updated_at });
  });

  it('a closed case shows its reason and Reopen', async () => {
    const closed = { ...CASE, closed_at: '2030-06-01T10:00:00+00:00', close_reason: 'Patient moved' };
    render(<FullArchCasePanel patientId="pt" data={inCase({ cases: [closed] })} arch="upper" />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText(/Patient moved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await vi.waitFor(() => expect(reopenCase).toHaveBeenCalledWith({ patientId: 'pt', caseId: 'c1', expectedUpdatedAt: CASE.updated_at }));
  });

  it('shows the bridges from linked restorations', () => {
    const temp = { id: 'r1', stage: 'temporary', fitted_on: '2030-05-02', ended_on: null, case_id: 'c1' } as unknown as Restoration;
    render(<FullArchCasePanel patientId="pt" data={inCase({ restorations: [temp] })} arch="upper" />);
    expect(screen.getByTestId('bridge-temporary')).toHaveTextContent('Delivered 02 May 2030');
    expect(screen.getByTestId('bridge-final')).toHaveTextContent('Not yet');
  });
});

describe('caseCaptions', () => {
  it('gives each arch case its title, status and progress', () => {
    expect(caseCaptions(inCase())).toEqual([
      { arch: 'upper', title: 'Upper arch · All-on-4 · In treatment', progress: 'Scan ✓ · Lab — · Try-in — · Delivery —' },
    ]);
  });
});
