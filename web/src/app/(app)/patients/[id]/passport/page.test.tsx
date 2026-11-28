import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
vi.mock('@/lib/passport/client', () => ({ downloadPassport: vi.fn(), PASSPORT_FAILED: 'x' }));
import PassportPage from './page';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const staff = (patients: 'view' | 'edit') => ({ active: true, role: 'organizer', permissions: { patients } });
const g = (id: string, generated_at: string, medical_level = 'allergies_medications', generator: unknown = { full_name: 'Dr Maker', email: 'm@x' }) => ({
  id, generated_at, medical_level, generator,
});

async function show(patients: 'view' | 'edit', history: { table_name: string; at: string }[] = []) {
  requirePermission.mockResolvedValue(staff(patients));
  rpc.mockResolvedValue({ data: history, error: null });
  render(await PassportPage({ params: Promise.resolve({ id: PATIENT }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  tables.patients = { data: { file_no: 'P00123' }, error: null };
  tables.passport_generations = {
    data: [g('g2', '2026-11-24T09:00:00+00:00', 'none'), g('g1', '2026-11-20T09:00:00+00:00', 'full', { full_name: null, email: 'b@x' })],
    error: null,
  };
});

describe('Implant passport page', () => {
  it('lists the generations latest first: when, who and the medical content', async () => {
    await show('view');
    const rows = screen.getAllByTestId('passport-generation');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('24 Nov 2026');
    expect(rows[0]).toHaveTextContent('Dr Maker');
    expect(rows[0]).toHaveTextContent('Nothing medical');
    expect(rows[1]).toHaveTextContent('b@x');
    expect(rows[1]).toHaveTextContent('Full medical summary');
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
  });

  it('View on Patients can generate', async () => {
    await show('view');
    expect(screen.getByRole('button', { name: 'Generate passport' })).toBeEnabled();
  });

  it('marks only the latest generation when a record changed after it (passport rows ignored)', async () => {
    await show('view', [
      { table_name: 'passport_generations', at: '2026-11-24T09:00:01+00:00' },
      { table_name: 'site_components', at: '2026-11-24T10:00:00+00:00' },
    ]);
    const rows = screen.getAllByTestId('passport-generation');
    expect(rows[0]).toHaveTextContent('Records changed since this version');
    expect(rows[1]).not.toHaveTextContent('Records changed since this version');
  });

  it('is not marked when only the passport log itself is newer', async () => {
    await show('view', [{ table_name: 'passport_generations', at: '2026-11-24T09:00:01+00:00' }]);
    expect(screen.queryByText('Records changed since this version')).toBeNull();
  });

  it('with no generation yet says so and reads no history', async () => {
    tables.passport_generations = { data: [], error: null };
    await show('view');
    expect(screen.getByText('No passport generated yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate passport' })).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('guards itself: without Patients view nothing is read', async () => {
    requirePermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(PassportPage({ params: Promise.resolve({ id: PATIENT }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(from).not.toHaveBeenCalled();
  });
});
