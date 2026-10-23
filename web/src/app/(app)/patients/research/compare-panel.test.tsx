import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ComparePanel } from './compare-panel';
import { CLUSTER_NOTE, LOADING_BIAS_NOTE, NO_FAILURES_NOTE, OPERATOR_NOTE, groupRows, type GroupVars } from '@/lib/research/groups';
import type { DetailRow, ResearchFilters } from '@/lib/research/view';

const base: ResearchFilters = { course: 'c1', from: '', to: '', delegate: '', brand: '', system: '' };

const row = (i: number, over: Partial<DetailRow> = {}): DetailRow => ({
  site_id: `s${i}`, patient_id: `p${i}`, tooth: 11, placed_on: '2024-01-01', loaded_on: null, year_1: 'survived', year_2: 'survived',
  latest_grade: 'I', latest_grade_reason: null, biological_complications: 0, mechanical_complications: 0,
  follow_up_days: 800, event: false, event_time_unknown: false, product_id: 'x', brand: 'Oxy', system: 'PSK',
  patient_name: `P${i}`, file_no: `${i}`, ...over,
});

// 20 guided (2 failures), 20 free hand (8 failures), 3 not assessed (2 failures).
const rows: DetailRow[] = Array.from({ length: 43 }, (_, i) => {
  const failed = (i < 20 && i < 2) || (i >= 20 && i < 40 && i < 28) || (i >= 40 && i < 42);
  return row(i, { event: failed, follow_up_days: failed ? 60 + i * 5 : 800, loaded_on: i % 2 ? '2024-01-03' : '2024-05-01' });
});
const vars: GroupVars[] = rows.map((r, i) => ({
  site_id: r.site_id, technique: i < 20 ? 'guided' : i < 40 ? 'free_hand' : null, bone_type: null, smoking: null,
  diabetes_status: null, periodontitis_history: null,
}));

function panel(compare: 'technique' | 'loading') {
  render(<ComparePanel compare={compare} groups={groupRows(rows, vars, compare)} filters={{ ...base, compare }} />);
  return screen.getByRole('region', { name: 'Compare groups' });
}

describe('<ComparePanel>', () => {
  it('compares by technique with a log-rank p and both notes', () => {
    const p = panel('technique');
    expect(within(p).getByText(/^p (=|<) /)).toBeInTheDocument();
    expect(within(p).getByText(CLUSTER_NOTE)).toBeInTheDocument();
    expect(within(p).getByText(OPERATOR_NOTE)).toBeInTheDocument();
    expect(within(p).getAllByText(/95% CI/).length).toBeGreaterThan(0);
    // 40 tested implants, 10 failures: not thin overall, but each group has under 30 implants.
    expect(within(p).getByText('⚠ Not enough data — interpret with caution (n = 20, 2 failures)')).toBeInTheDocument();
  });

  it('shows the Not assessed group and leaves it out of the test', () => {
    const p = panel('technique');
    const table = within(p).getByRole('table');
    expect(within(table).getByText('Not assessed')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(p).getByText('Not assessed is shown but not included in the test.')).toBeInTheDocument();
    expect(within(p).getByText(/Log-rank test on 40 implants, 10 failures/)).toBeInTheDocument();
  });

  it('compares by loading as a table only, with the bias warning and no p', () => {
    const p = panel('loading');
    expect(within(p).getByText(LOADING_BIAS_NOTE)).toBeInTheDocument();
    expect(within(p).queryByText(/^p (=|<) /)).toBeNull();
    expect(within(p).queryByText(/Log-rank/)).toBeNull();
    expect(within(p).getByText('Immediate')).toBeInTheDocument();
    expect(within(p).getByText('Conventional')).toBeInTheDocument();
    expect(within(p).getByText(CLUSTER_NOTE)).toBeInTheDocument();
    expect(within(p).getByText(OPERATOR_NOTE)).toBeInTheDocument();
  });

  it('warns on an estimate with fewer than 30 at risk even in a large group', () => {
    // 40 guided: 1 failure at 100 days, 34 followed 400 days, 5 followed 800 days. 40 free hand followed 800 days.
    const big = Array.from({ length: 80 }, (_, i) =>
      row(i, { event: i === 0, follow_up_days: i === 0 ? 100 : i < 35 ? 400 : 800 }));
    const v = big.map((r, i) => ({ site_id: r.site_id, technique: i < 40 ? 'guided' : 'free_hand', bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null }));
    render(<ComparePanel compare="technique" groups={groupRows(big, v, 'technique')} filters={base} />);
    const guided = screen.getByRole('cell', { name: /^Guided/ }).closest('tr')!;
    expect(within(guided).getByText('⚠ Not enough data — interpret with caution (n = 5, 1 failure)')).toBeInTheDocument();
    expect(within(guided).queryByText(/n = 40/)).toBeNull();
    const free = screen.getByRole('cell', { name: /^Free hand/ }).closest('tr')!;
    expect(within(free).queryByText(/Not enough data/)).toBeNull();
  });

  it('counts only implants with a known failure date in a group warning', () => {
    const few = [row(1), row(2, { event: true, follow_up_days: 100 }), row(3, { event: true, event_time_unknown: true, follow_up_days: 0 })];
    const v = few.map((r) => ({ site_id: r.site_id, technique: 'guided', bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null }));
    render(<ComparePanel compare="technique" groups={groupRows(few, v, 'technique')} filters={base} />);
    const guided = screen.getByRole('cell', { name: /^Guided/ });
    expect(within(guided).getByText('⚠ Not enough data — interpret with caution (n = 2, 1 failure)')).toBeInTheDocument();
  });

  it('shows 100% with the CI not estimable for a group with no failures', () => {
    // Followed 400 days: the 1-year estimate is 100%, the 2-year one is past follow-up.
    const none = [row(1, { follow_up_days: 400 }), row(2, { follow_up_days: 400 })];
    const v = none.map((r) => ({ site_id: r.site_id, technique: 'free_hand', bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null }));
    render(<ComparePanel compare="technique" groups={groupRows(none, v, 'technique')} filters={base} />);
    const cell = screen.getByRole('cell', { name: /^100\.0%/ });
    expect(within(cell).getByText(NO_FAILURES_NOTE)).toBeInTheDocument();
  });

  it('keeps the filters in the compare form', () => {
    render(<ComparePanel compare={null} groups={[]} filters={base} />);
    const form = screen.getByRole('form', { name: 'Compare by' });
    const hidden = Array.from(form.querySelectorAll('input[type=hidden]')).map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(hidden).toEqual([['course', 'c1']]);
    expect(screen.getByRole('combobox', { name: 'Compare by' })).toHaveValue('');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
