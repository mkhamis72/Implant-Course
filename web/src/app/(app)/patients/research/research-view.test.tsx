import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NoPatientsNote, ResearchView } from './research-view';
import type { DetailRow, ResearchFilters } from '@/lib/research/view';
import { formatPct, kaplanMeier, type CrownRow } from '@/lib/research/summary';
import { CLUSTER_NOTE, type GroupVars } from '@/lib/research/groups';

const filters: ResearchFilters = { course: 'c1', from: '2025-01-01', to: '', delegate: '', brand: '', system: '' };

const row = (i: number, over: Partial<DetailRow> = {}): DetailRow => ({
  site_id: `s${i}`, patient_id: `p${i}`, tooth: 11, placed_on: '2024-01-01', year_1: 'survived', year_2: 'survived',
  latest_grade: 'I', latest_grade_reason: null, biological_complications: 0, mechanical_complications: 0,
  follow_up_days: 800, event: false, event_time_unknown: false, product_id: 'x', brand: 'Oxy', system: 'PSK',
  patient_name: `P${i}`, file_no: `${i}`, ...over,
});

// 88 survived, 2 failed at 1 year; 10 not yet graded, 1 not assessable.
const big: DetailRow[] = Array.from({ length: 90 }, (_, i) =>
  row(i, {
    year_1: i < 2 ? 'failed' : 'survived',
    event: i < 2,
    follow_up_days: i < 2 ? 100 : 800,
    latest_grade: i < 2 ? 'IV' : i < 12 ? null : i === 12 ? 'not_assessable' : 'I',
    year_2: i < 2 ? 'failed' : i < 70 ? 'not_reached' : 'survived',
  }),
);
const crowns: CrownRow[] = [{ remade: true, problems: 0 }, { remade: false, problems: 1 }];

function tile(name: string) {
  return screen.getByRole('region', { name });
}

describe('<ResearchView>', () => {
  it('shows the KM survival with its 95% CI, the number at risk and the milestone status, without a warning at 88 at risk', () => {
    render(<ResearchView rows={big} crowns={crowns} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('97.8%')).toBeInTheDocument();
    expect(within(y1).getByText(/^95% CI \d+\.\d–\d+\.\d%$/)).toBeInTheDocument();
    expect(within(y1).getByText('at risk 88')).toBeInTheDocument();
    expect(within(y1).getByText(/Status at the milestone/)).toBeInTheDocument();
    expect(within(y1).getByRole('link', { name: '88 survived' })).toBeInTheDocument();
    expect(within(y1).queryByText(/Not enough data/)).toBeNull();
    expect(within(y1).queryByText('small sample')).toBeNull();
    expect(within(tile('Survival at 2 years')).getByText(/68 not reached/)).toBeInTheDocument();
    expect(within(tile('Implants')).getByText('90')).toBeInTheDocument();
    expect(within(tile('Crowns remade')).getByText('1')).toBeInTheDocument();
  });

  it('shows the same survival at 1 year as the curve at day 365', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(i, { event: i % 7 === 0, follow_up_days: i % 7 === 0 ? 30 + i * 9 : 50 + i * 20 }),
    );
    const { points } = kaplanMeier(rows);
    const atTwelve = points.filter((p) => p.month <= 365 / 30.4375).at(-1)!.survival;
    render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    expect(within(tile('Survival at 1 year')).getByText(formatPct(atTwelve * 100))).toBeInTheDocument();
    expect(atTwelve).toBeLessThan(1);
  });

  it('warns when data is thin and still shows the numbers', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i, { event: i === 0, follow_up_days: i === 0 ? 100 : 400 }));
    render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('90.0%')).toBeInTheDocument();
    expect(within(y1).getByText(/^95% CI/)).toBeInTheDocument();
    expect(within(y1).getByText('⚠ Not enough data — interpret with caution (n = 9, 1 failure)')).toBeInTheDocument();
  });

  it('shows a dash for the CI when there are no failures yet', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(i, { year_2: 'not_reached', follow_up_days: 400 }));
    render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('100.0%')).toBeInTheDocument();
    expect(within(y1).getByText('No failures yet, so this can\'t be estimated')).toBeInTheDocument();
  });

  it('shows only a dash when nobody was followed that long', () => {
    const rows = [row(1, { year_1: 'not_reached', year_2: 'not_reached', follow_up_days: 100 })];
    render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('—')).toBeInTheDocument();
    expect(within(y1).queryByText(/Not enough data/)).toBeNull();
  });

  it('draws a CI band and notes the failures with an unknown date', () => {
    const rows = [...big, row(99, { event: true, event_time_unknown: true, follow_up_days: 0 })];
    const { container } = render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    const curve = tile('Survival curve');
    expect(container.querySelector('[data-testid="ci-band"]')).not.toBeNull();
    expect(within(curve).getByText(/failure with unknown date not included/)).toHaveTextContent('1 failure with unknown date not included');
    expect(within(curve).getByText(CLUSTER_NOTE)).toBeInTheDocument();
  });

  it('draws one line per group with a legend when comparing, and none for loading', () => {
    const groups: GroupVars[] = big.map((r, i) => ({
      site_id: r.site_id, technique: i % 2 ? 'guided' : 'free_hand', bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null,
    }));
    const { unmount } = render(<ResearchView rows={big} crowns={[]} filters={{ ...filters, compare: 'technique' }} groups={groups} noProduct={0} />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Guided')).toBeInTheDocument();
    expect(within(legend).getByText('Free hand')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Compare groups' })).toBeInTheDocument();
    unmount();
    render(<ResearchView rows={big} crowns={[]} filters={{ ...filters, compare: 'loading' }} groups={[]} noProduct={0} />);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });

  it('shows Not assessable and Not yet graded in the ICOI breakdown', () => {
    render(<ResearchView rows={big} crowns={crowns} filters={filters} noProduct={0} />);
    const icoi = tile('ICOI success');
    expect(within(icoi).getByText('Not assessable')).toBeInTheDocument();
    expect(within(icoi).getByText('Not yet graded')).toBeInTheDocument();
    expect(within(icoi).getByRole('link', { name: /^10\b/ })).toHaveAttribute('href', expect.stringContaining('list=icoi_not_graded'));
  });

  it('links each number to its drill-down with the filters', () => {
    render(<ResearchView rows={big} crowns={crowns} filters={filters} noProduct={0} />);
    const link = within(tile('Survival at 1 year')).getByRole('link', { name: '2 failed' });
    expect(link).toHaveAttribute('href', '/patients/research/drilldown?list=year_1_failed&course=c1&from=2025-01-01');
  });

  it('shows the no-product note and the number at risk', () => {
    render(<ResearchView rows={big} crowns={crowns} filters={filters} noProduct={3} />);
    expect(screen.getByText(/implants have no product recorded/)).toHaveTextContent('3 implants have no product recorded');
    expect(screen.getByText('Number at risk')).toBeInTheDocument();
  });
});

describe('<NoPatientsNote>', () => {
  it('explains why there is nothing to show', () => {
    render(<NoPatientsNote />);
    expect(screen.getByText('Research needs View on Patients to read the records')).toBeInTheDocument();
  });
});
