import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { recordVisit } from './visit-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('recordVisit', () => {
  it('sends the visit with its findings object', async () => {
    expect(await recordVisit({
      ...ids, date: '2026-05-01', visitKey: 'early_review', checkType: '', attendance: 'attended', outcome: 'ok',
      painScore: '1', probingMesial: '3', bopMesial: '', notes: '',
    })).toEqual({});
    expect(rpc).toHaveBeenCalledWith('record_visit', {
      p_site: ids.siteId, p_date: '2026-05-01', p_visit_key: 'early_review', p_check_type: '', p_attendance: 'attended',
      p_outcome: 'ok', p_findings: { pain_score: 1, probing_mesial: 3, bop_mesial: 'no' }, p_notes: '',
    });
  });

  it('sends no findings for a missed appointment, and shows business errors verbatim', async () => {
    rpc.mockResolvedValue({ error: { message: 'Early review (suture removal) is already recorded for this implant. Remove it first to record it again.', hint: 'user' } });
    const result = await recordVisit({ ...ids, date: '2026-05-01', visitKey: 'early_review', attendance: 'did_not_attend', painScore: '5' });
    expect(result.error).toMatch(/already recorded/);
    expect(rpc).toHaveBeenCalledWith('record_visit', expect.objectContaining({ p_outcome: null, p_findings: {} }));
  });

  it('never calls the database for an invalid form', async () => {
    expect(await recordVisit({ ...ids, date: '2026-05-01', visitKey: 'early_review', attendance: 'attended', outcome: '' }))
      .toEqual({ error: 'Choose the outcome.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
