import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { saveComplication, saveFailure, voidComplication } from './outcome-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
const comp = { ...ids, category: 'biological', type: 'mucositis', otherType: '', noticedOn: '2026-09-01', severity: '', treatment: '', resolvedOn: '', followupId: '', notes: '' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('outcome actions', () => {
  it('records a new complication, updates an existing one with its version', async () => {
    await saveComplication({ ...comp, complicationId: '', expectedUpdatedAt: '' });
    expect(rpc).toHaveBeenCalledWith('record_complication', { p_site: ids.siteId, p_details: expect.objectContaining({ category: 'biological', type: 'mucositis', severity: null }) });
    const id = '00000000-0000-4000-8000-000000000009';
    await saveComplication({ ...comp, complicationId: id, expectedUpdatedAt: '2026-09-01T10:00:00.5+00:00', resolvedOn: '2026-09-10' });
    expect(rpc).toHaveBeenLastCalledWith('update_complication', {
      p_complication: id, p_details: expect.objectContaining({ resolved_on: '2026-09-10' }), p_expected_updated_at: '2026-09-01T10:00:00.5+00:00',
    });
  });

  it('voids a complication with a reason', async () => {
    await voidComplication({ patientId: ids.patientId, complicationId: '00000000-0000-4000-8000-000000000009', reason: 'Wrong tooth' });
    expect(rpc).toHaveBeenCalledWith('void_complication', { p_complication: '00000000-0000-4000-8000-000000000009', p_reason: 'Wrong tooth' });
  });

  it('records failure details when none exist, corrects them otherwise', async () => {
    const f = { ...ids, failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' };
    await saveFailure({ ...f, expectedUpdatedAt: '' });
    expect(rpc).toHaveBeenCalledWith('record_failure', { p_site: ids.siteId, p_failed_on: '2026-05-01', p_type: 'lost', p_reason: 'fracture', p_notes: '' });
    await saveFailure({ ...f, expectedUpdatedAt: '2026-05-02T00:00:00Z' });
    expect(rpc).toHaveBeenLastCalledWith('correct_failure', {
      p_site: ids.siteId, p_failed_on: '2026-05-01', p_type: 'lost', p_reason: 'fracture', p_notes: '', p_expected_updated_at: '2026-05-02T00:00:00Z',
    });
  });

  it('shows business errors verbatim and validates before calling the database', async () => {
    rpc.mockResolvedValue({ error: { message: 'This complication was changed by someone else. Reload to see it.', hint: 'user' } });
    expect(await saveComplication({ ...comp, complicationId: '00000000-0000-4000-8000-000000000009', expectedUpdatedAt: 'x' }))
      .toEqual({ error: 'This complication was changed by someone else. Reload to see it.' });
    rpc.mockClear();
    expect(await saveComplication({ ...comp, type: 'screw_loosening' })).toEqual({ error: 'Choose the complication type.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
