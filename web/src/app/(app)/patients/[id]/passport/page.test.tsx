import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { requirePermission, tables, rpc } = vi.hoisted(() => ({
  requirePermission: vi.fn(), tables: {} as Record<string, unknown>, rpc: vi.fn(),
}));
/** from(table): a chain whose every step returns itself and which resolves to tables[table]. */
const from = vi.fn((table: string) => {
  const result = () => Promise.resolve(tables[table]);
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
    maybeSingle: result, then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad),
  };
  return chain;
});
vi.mock('@/lib/auth/session', () => ({ requirePermission }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ from, rpc })) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, useRouter: () => ({ refresh: vi.fn() }) }));
import PassportPage from './page';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const staff = (patients: 'view' | 'edit') => ({ active: true, role: 'organizer', permissions: { patients } });
const v = (version: number, generated_at: string, medical_level = 'allergies_medications') => ({
  id: `p${version}`, version, generated_at, size_bytes: 86_000, medical_level, generator: { full_name: 'Dr Maker', email: 'm@x' },
});

async function show(patients: 'view' | 'edit', history: { table_name: string; at: string }[] = []) {
  requirePermission.mockResolvedValue(staff(patients));
  rpc.mockResolvedValue({ data: history, error: null });
  render(await PassportPage({ params: Promise.resolve({ id: PATIENT }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  tables.patients = { data: { file_no: 'P00123' }, error: null };
  tables.patient_passports = {
    data: [v(2, '2026-11-24T09:00:00+00:00', 'none'), v(1, '2026-11-20T09:00:00+00:00')], error: null,
  };
  tables.passport_downloads = {
    data: [
      { passport_id: 'p1', downloaded_at: '2026-11-21T10:00:00+00:00', downloader: { full_name: 'Dr A', email: 'a@x' } },
      { passport_id: 'p1', downloaded_at: '2026-11-22T10:00:00+00:00', downloader: { full_name: null, email: 'b@x' } },
    ],
    error: null,
  };
});

describe('Implant passport page', () => {
  it('lists versions latest first with number, generator, size, medical content and downloads', async () => {
    await show('edit');
    const rows = screen.getAllByTestId('passport-version');
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['P00123-2', 'P00123-1']);
    expect(rows[0]).toHaveTextContent('Dr Maker');
    expect(rows[0]).toHaveTextContent('84 KB');
    expect(rows[0]).toHaveTextContent('Nothing medical');
    expect(rows[0]).toHaveTextContent('Not downloaded yet');
    expect(rows[1]).toHaveTextContent('Allergies and medications only');
    expect(rows[1]).toHaveTextContent('Downloaded 2 times, last by b@x on 22 Nov 2026');
    expect(within(rows[1]).getByRole('link', { name: 'Download passport P00123-1' }))
      .toHaveAttribute('href', `/patients/${PATIENT}/passport/p1/download`);
  });

  it('Edit on Patients can generate; View can only download', async () => {
    await show('edit');
    expect(screen.getByRole('button', { name: 'Generate new passport' })).toBeEnabled();
    document.body.innerHTML = '';
    await show('view');
    expect(screen.queryByRole('button', { name: 'Generate new passport' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Download passport/ })).toHaveLength(2);
  });

  it('marks only the latest version stale when a record changed after it (passport rows ignored)', async () => {
    await show('view', [
      { table_name: 'patient_passports', at: '2026-11-24T09:00:01+00:00' },
      { table_name: 'site_components', at: '2026-11-24T10:00:00+00:00' },
    ]);
    const rows = screen.getAllByTestId('passport-version');
    expect(rows[0]).toHaveTextContent('Records changed since this version');
    expect(rows[1]).not.toHaveTextContent('Records changed since this version');
  });

  it('is not stale when only the passports themselves are newer', async () => {
    await show('view', [{ table_name: 'patient_passports', at: '2026-11-24T09:00:01+00:00' }]);
    expect(screen.queryByText('Records changed since this version')).toBeNull();
  });

  it('with no version yet says so and reads no downloads or history', async () => {
    tables.patient_passports = { data: [], error: null };
    await show('edit');
    expect(screen.getByText('No passport generated yet.')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('guards itself: without Patients view nothing is read', async () => {
    requirePermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(PassportPage({ params: Promise.resolve({ id: PATIENT }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(from).not.toHaveBeenCalled();
  });
});
