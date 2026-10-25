// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { deleteAnalysis, saveAnalysis } from './actions';
import { requirePermission } from '@/lib/auth/session';

const ID = '00000000-0000-4000-8000-000000000001';
const COURSE = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: ID, error: null });
  vi.mocked(requirePermission).mockClear();
});

describe('saved analysis actions', () => {
  it('saves with the trimmed title and the course of the query', async () => {
    const res = await saveAnalysis(null, '  Smoking and failure ', { version: 1, query: { course: COURSE, f: 'smoking', o: 'failed' } });
    expect(res).toEqual({ id: ID });
    expect(requirePermission).toHaveBeenCalledWith('research', 'edit');
    expect(rpc).toHaveBeenCalledWith('save_analysis', {
      p_id: null, p_title: 'Smoking and failure', p_config: { version: 1, query: { course: COURSE, f: 'smoking', o: 'failed' } }, p_course: COURSE,
    });
  });

  it('shows business errors verbatim', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only the person who saved this analysis or an admin can change it.', hint: 'user' } });
    expect(await saveAnalysis(ID, 'Mine', { version: 1, query: { o: 'failed' } }))
      .toEqual({ error: 'Only the person who saved this analysis or an admin can change it.' });
  });

  it('refuses an invalid config without calling the database', async () => {
    expect(await saveAnalysis(null, 'Bad', { version: 1, query: { colour: 'red' } })).toEqual({ error: 'Could not save this analysis.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('deletes', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await deleteAnalysis(ID)).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('research', 'edit');
    expect(rpc).toHaveBeenCalledWith('delete_analysis', { p_id: ID });
  });
});
