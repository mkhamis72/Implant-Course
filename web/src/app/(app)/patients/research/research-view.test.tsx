import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NoPatientsNote, ResearchView } from './research-view';
import type { DetailRow, ResearchFilters } from '@/lib/research/view';
import type { CrownRow } from '@/lib/research/summary';

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
  it('shows survival as a % with its count, and no small-sample flag at 90', () => {
    render(<ResearchView rows={big} crowns={crowns} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('97.8%')).toBeInTheDocument();
    expect(within(y1).getByText(/88 of 90/)).toBeInTheDocument();
    expect(within(y1).queryByText('small sample')).toBeNull();
    // year 2: 20 survived + 2 failed = 22 < 30
    expect(within(tile('Survival at 2 years')).getByText('small sample')).toBeInTheDocument();
    expect(within(tile('Survival at 2 years')).getByText(/68 not reached/)).toBeInTheDocument();
    expect(within(tile('Implants')).getByText('90')).toBeInTheDocument();
    expect(within(tile('Crowns remade')).getByText('1')).toBeInTheDocument();
  });

  it('shows only a dash, without small sample, when nobody reached the milestone', () => {
    const rows = [row(1, { year_1: 'not_reached', year_2: 'not_reached' })];
    render(<ResearchView rows={rows} crowns={[]} filters={filters} noProduct={0} />);
    const y1 = tile('Survival at 1 year');
    expect(within(y1).getByText('—')).toBeInTheDocument();
    expect(within(y1).queryByText('small sample')).toBeNull();
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
