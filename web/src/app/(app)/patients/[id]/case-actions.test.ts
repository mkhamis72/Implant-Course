import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import {
  clearCaseStage, closeCase, createCase, recordCaseStage, reopenCase, setCaseRestoration, setCaseSites, updateCase,
} from './case-actions';
import { requirePermission } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const TS = '2026-11-01T10:00:00.5+00:00';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  vi.mocked(requirePermission).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe('case actions', () => {
  it('creates a case', async () => {
    expect(await createCase({ patientId: uuid(1), arch: 'upper', configuration: 'all_on_4', name: ' ', notes: '', sites: [uuid(2)] })).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('patients', 'edit');
    expect(rpc).toHaveBeenCalledWith('create_full_arch_case', {
      p_patient: uuid(1), p_arch: 'upper', p_configuration: 'all_on_4', p_name: '', p_notes: '', p_sites: [uuid(2)],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${uuid(1)}`, 'layout');
  });

  it('updates a case with the version the form opened with', async () => {
    await updateCase({ patientId: uuid(1), caseId: uuid(3), configuration: 'other', name: 'n', notes: 'x', expectedUpdatedAt: TS });
    expect(rpc).toHaveBeenCalledWith('update_full_arch_case', {
      p_case: uuid(3), p_configuration: 'other', p_name: 'n', p_notes: 'x', p_updated_at: TS,
    });
  });

  it('sets the implants of a case', async () => {
    await setCaseSites({ patientId: uuid(1), caseId: uuid(3), sites: [uuid(2), uuid(4)], expectedUpdatedAt: TS });
    expect(rpc).toHaveBeenCalledWith('set_case_sites', { p_case: uuid(3), p_sites: [uuid(2), uuid(4)], p_updated_at: TS });
  });

  it('links and unlinks a restoration', async () => {
    await setCaseRestoration({ patientId: uuid(1), restorationId: uuid(5), caseId: uuid(3) });
    expect(rpc).toHaveBeenLastCalledWith('set_case_restoration', { p_restoration: uuid(5), p_case: uuid(3) });
    await setCaseRestoration({ patientId: uuid(1), restorationId: uuid(5), caseId: '' });
    expect(rpc).toHaveBeenLastCalledWith('set_case_restoration', { p_restoration: uuid(5), p_case: null });
  });

  it('records a stage, sending only what the stage takes', async () => {
    await recordCaseStage({ patientId: uuid(1), caseId: uuid(3), stage: 'lab_design', doneOn: '2026-01-10', lab: ' Lab A ', passiveFit: '', occlusion: '', notes: 'n' });
    expect(rpc).toHaveBeenLastCalledWith('record_case_stage', {
      p_case: uuid(3), p_stage: 'lab_design', p_done_on: '2026-01-10', p_lab: 'Lab A', p_passive_fit: null, p_occlusion: null, p_notes: 'n',
    });
    await recordCaseStage({ patientId: uuid(1), caseId: uuid(3), stage: 'try_in', doneOn: '2026-01-10', lab: '', passiveFit: false, occlusion: 'Even', notes: '' });
    expect(rpc).toHaveBeenLastCalledWith('record_case_stage', {
      p_case: uuid(3), p_stage: 'try_in', p_done_on: '2026-01-10', p_lab: null, p_passive_fit: false, p_occlusion: 'Even', p_notes: '',
    });
  });

  it('clears a stage', async () => {
    await clearCaseStage({ patientId: uuid(1), caseId: uuid(3), stage: 'scan' });
    expect(rpc).toHaveBeenCalledWith('clear_case_stage', { p_case: uuid(3), p_stage: 'scan' });
  });

  it('closes and reopens a case', async () => {
    await closeCase({ patientId: uuid(1), caseId: uuid(3), reason: ' Moved ', expectedUpdatedAt: TS });
    expect(rpc).toHaveBeenLastCalledWith('close_full_arch_case', { p_case: uuid(3), p_reason: 'Moved', p_updated_at: TS });
    await reopenCase({ patientId: uuid(1), caseId: uuid(3), expectedUpdatedAt: TS });
    expect(rpc).toHaveBeenLastCalledWith('reopen_full_arch_case', { p_case: uuid(3), p_updated_at: TS });
  });

  it('refuses invalid input before calling the database', async () => {
    expect(await closeCase({ patientId: uuid(1), caseId: uuid(3), reason: '', expectedUpdatedAt: TS })).toEqual({ error: 'Give a reason to close the case.' });
    expect((await createCase({ patientId: uuid(1), arch: 'x', configuration: 'all_on_4', name: '', notes: '', sites: [] })).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the message of a business error and hides others', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'This arch already has an open full-arch case.', hint: 'user' } });
    expect(await createCase({ patientId: uuid(1), arch: 'upper', configuration: 'all_on_4', name: '', notes: '', sites: [] }))
      .toEqual({ error: 'This arch already has an open full-arch case.' });
    expect(revalidatePath).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ error: { message: 'connection reset', code: '08006' } });
    const r = await reopenCase({ patientId: uuid(1), caseId: uuid(3), expectedUpdatedAt: TS });
    expect(r.error).toBeTruthy();
    expect(r.error).not.toContain('connection reset');
  });
});
