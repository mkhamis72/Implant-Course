import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import type { VisitRow } from '@/lib/visits/visits';

vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));
vi.mock('./implant-actions', () => ({
  fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn(),
}));
import { formatDate } from '@/lib/format';
import { RecordVisitForm, Visits } from './visits';
import { recordVisit } from './visit-actions';

const visits: VisitRow[] = [
  { site_id: 's1', tooth: 36, visit_key: 'early_review', label: 'Early review (suture removal)', target_date: '2026-03-20',
    window_start: '2026-03-17', window_end: '2026-03-31', status: 'missed', followup_id: null },
  { site_id: 's1', tooth: 36, visit_key: 'osseointegration', label: 'Osseointegration check', target_date: '2026-06-08',
    window_start: '2026-05-19', window_end: '2026-06-30', status: 'due', followup_id: null },
  { site_id: 's1', tooth: 36, visit_key: 'month_6', label: '6-month review', target_date: '2026-09-08',
    window_start: '2026-08-09', window_end: '2026-10-08', status: 'upcoming', followup_id: null },
];
const oldFollowup = {
  id: 'f1', date: '2026-03-25', check_type: '2-week', outcome: 'ok', notes: '', voided_at: null, voided_reason: '',
  visit_key: null, attendance: null, pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null,
  mobility: null, probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null, bop_mesial: null,
  bop_buccal: null, bop_distal: null, bop_lingual: null, isq: null, prosthesis_status: null, radiograph_taken: null, recommended_treatment: '',
};
const site = { id: 's1', tooth: 36, state: 'placed', placed_on: '2026-03-10', followups: [oldFollowup] } as unknown as ImplantSite;
const data = { today: '2026-06-01', visits, editable: true } as unknown as ChartData;

beforeEach(() => vi.mocked(recordVisit).mockReset().mockResolvedValue({}));

describe('<Visits>', () => {
  it('lists each expected visit with its status, and every visit record', () => {
    render(<Visits site={site} visits={visits} />);
    const rows = within(screen.getByTestId('visit-schedule')).getAllByTestId('visit-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Early review \(suture removal\).*Missed/),
      expect.stringMatching(/Osseointegration check.*Due/),
      expect.stringMatching(/6-month review.*Upcoming/),
    ]);
    expect(within(rows[0]).getByText('Missed')).toHaveClass('badge-bad');
    expect(screen.getByTestId('visit-records')).toHaveTextContent('2-week · OK');
  });
});

describe('<Visits> done rows', () => {
  it('shows the date of the record, not the target date', () => {
    const done = [{ ...visits[0], status: 'done', followup_id: 'f1' } as VisitRow];
    render(<Visits site={site} visits={done} />);
    const row = screen.getByTestId('visit-row');
    expect(row.textContent).toContain(formatDate('2026-03-25'));
    expect(row.textContent).not.toContain(formatDate('2026-03-20'));
  });
});

describe('<RecordVisitForm>', () => {
  it('pre-picks the due visit over an older missed one and records an attended visit with probing and bleeding', async () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Visit' })).toHaveValue('osseointegration');
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Pain (0–10)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Probing depth buccal'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Bleeding buccal'));
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    expect(vi.mocked(recordVisit)).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 's1', patientId: 'pt', date: '2026-06-01', visitKey: 'osseointegration', attendance: 'attended', outcome: 'ok',
      painScore: '1', probingBuccal: '4', bopBuccal: 'yes', probingMesial: '', bopMesial: '',
    }));
  });

  it('hides findings when the patient did not attend, and asks for a reason when not needed', () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    const attendance = screen.getByRole('radiogroup', { name: 'Attendance' });
    fireEvent.click(within(attendance).getByLabelText('Did not attend'));
    expect(screen.queryByLabelText('Probing depth mesial')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Outcome' })).not.toBeInTheDocument();
    fireEvent.click(within(attendance).getByLabelText('Not needed'));
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
  });

  it('asks what an unscheduled visit was for', () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.queryByLabelText('Visit for')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Visit' }), { target: { value: '' } });
    expect(screen.getByLabelText('Visit for')).toBeInTheDocument();
  });

  it('keeps the form and shows the error when saving fails', async () => {
    vi.mocked(recordVisit).mockResolvedValue({ error: 'Choose the outcome.' });
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the outcome.');
  });
});
