import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CaseColumn } from '@/lib/research/full-arch';

const { loadFullArch, rpc, from } = vi.hoisted(() => ({ loadFullArch: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  requirePermission: vi.fn(async () => ({ role: 'admin', features: ['inventory', 'statistics', 'teaching'], permissions: { patients: 'edit', research: 'edit' } })),
}));
vi.mock('@/lib/auth/permissions', () => ({ canView: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc, from })) }));
vi.mock('./data', () => ({ loadFullArch }));
import FullArchPage from './page';

const km = (surv: number, nRisk: number, defined = true) => ({
  surv, lower: surv - 0.05, upper: Math.min(1, surv + 0.02), nRisk, events: 1, n: 10, defined,
});
const col = (configuration: CaseColumn['configuration'], over: Partial<CaseColumn> = {}): CaseColumn => ({
  configuration, cases: 0, completed: 0, closedIncomplete: 0,
  monthsToBridge: { median: null, min: null, max: null },
  withBridgeProblem: 0, bridgeProblems: 0, lostImplant: 0, implantsFailed: 0, implantsPlaced: 0, medianImplants: null,
  survival12: null, survival24: null, ...over,
});
const caseRow = (id: string, over: Record<string, unknown> = {}) => ({
  case_id: id, patient_id: `pt-${id}`, file_no: `F-${id}`, arch: 'upper', configuration: 'all_on_4', closed_at: null,
  first_placed_on: '2026-01-05', implants_placed: 4, implants_failed: 0, bridge_problems: 0, sites: [], bridges: [],
  status: 'in_treatment', finalBridgeOn: null, monthsToBridge: null, ...over,
});
const columns = [
  col('all_on_4', {
    cases: 12, completed: 8, closedIncomplete: 1, monthsToBridge: { median: 6.2, min: 4.1, max: 9.8 },
    withBridgeProblem: 2, bridgeProblems: 3, lostImplant: 1, implantsFailed: 2, implantsPlaced: 50, medianImplants: 4,
    survival12: km(0.96, 20), survival24: km(0.9, 5, false),
  }),
  col('all_on_6'), col('all_on_x'), col('other'),
];
const page = async (sp: Record<string, string> = {}) => render(await FullArchPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  rpc.mockResolvedValue({ data: [], error: null });
  const chain = { select: () => chain, order: async () => ({ data: [], error: null }) };
  from.mockReturnValue(chain);
  loadFullArch.mockResolvedValue({
    columns,
    cases: [caseRow('1', { status: 'completed', finalBridgeOn: '2026-07-20' }), caseRow('2', { arch: 'lower', first_placed_on: null })],
    planned: 0,
  });
});

describe('Full arch page', () => {
  it('has one column per configuration and the spec rows', async () => {
    await page();
    const table = screen.getByRole('table', { name: 'Case types side by side' });
    for (const h of ['All-on-4', 'All-on-6', 'All-on-X', 'Other']) expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(name) });
    expect(within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[1]).toHaveTextContent('12');
    expect(row('Reached the final bridge')).toHaveTextContent('8 of 12');
    expect(row('Months to final bridge')).toHaveTextContent('6.2 (4.1–9.8)');
    expect(row('Closed without completion')).toHaveTextContent('1 of 12');
    expect(row('Cases with a bridge problem')).toHaveTextContent('2 of 12');
    expect(row('Cases with a bridge problem')).toHaveTextContent('3 problems in total');
    expect(row('Cases that lost an implant')).toHaveTextContent('1 of 12');
    expect(row('Cases that lost an implant')).toHaveTextContent('2 failed of 50 placed');
    expect(row('Implants per case')).toHaveTextContent('4');
    expect(row('Survival at 1 year')).toHaveTextContent('96.0%');
    expect(row('Survival at 1 year')).toHaveTextContent('at risk 20');
  });

  it('shows a dash for an empty column and for survival that is not usable', async () => {
    await page();
    const table = screen.getByRole('table', { name: 'Case types side by side' });
    const reached = within(table).getByRole('row', { name: /Reached the final bridge/ });
    expect(within(reached).getAllByRole('cell')[2]).toHaveTextContent('—');
    expect(within(table).getByRole('row', { name: /Survival at 2 years/ })).not.toHaveTextContent('90.0%');
  });

  it('warns under 30 cases but still shows the numbers, and only names columns with cases', async () => {
    await page();
    // Counted in cases only: the column has 12 cases and 2 implant failures, which are not cases.
    expect(screen.getByText('All-on-4: ⚠ Not enough data — interpret with caution (12 cases)')).toBeInTheDocument();
    expect(screen.queryByText(/All-on-4: ⚠.*failure/)).toBeNull();
    expect(screen.queryByText(/All-on-6: ⚠/)).toBeNull();
  });

  it('shows the planned note only when there are planned cases', async () => {
    await page();
    expect(screen.queryByText(/planned cases? without a placed implant/)).toBeNull();
    loadFullArch.mockResolvedValue({ columns, cases: [], planned: 3 });
    await page();
    expect(screen.getByText('3 planned cases without a placed implant are not included.')).toBeInTheDocument();
  });

  it('links to the survival curves with the filters', async () => {
    await page({ from: '2026-01-01' });
    const href = screen.getByRole('link', { name: 'Implant survival curves' }).getAttribute('href') as string;
    expect(href.startsWith('/statistics?compare=case_type&')).toBe(true);
    expect(href).toContain('from=2026-01-01');
  });

  it('lists cases linking to the arch view, without free text', async () => {
    await page();
    const list = screen.getByRole('table', { name: 'Cases' });
    const link = within(list).getByRole('link', { name: 'F-1' });
    expect(link).toHaveAttribute('href', '/patients/pt-1?view=arch');
    const r1 = link.closest('tr') as HTMLElement;
    expect(r1).toHaveTextContent('Upper arch');
    expect(r1).toHaveTextContent('Completed');
    expect(r1).toHaveTextContent('05 Jan 2026');
    expect(r1).toHaveTextContent('20 Jul 2026');
    expect(within(list.querySelectorAll('tr')[2] as HTMLElement).getAllByText('—').length).toBeGreaterThan(0);
  });
});
