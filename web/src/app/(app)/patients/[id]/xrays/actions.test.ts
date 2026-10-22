import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { saveRadiograph, voidRadiograph } from './actions';
import { requirePermission } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const input = {
  patientId: uuid(1), id: '', expectedUpdatedAt: '', takenOn: '2026-01-10', type: 'periapical', purpose: 'baseline',
  teeth: [36], link: '', notes: '', [`mesial_${uuid(2)}`]: '0.5', [`distal_${uuid(2)}`]: '', [`mesial_${uuid(3)}`]: '', [`distal_${uuid(3)}`]: '',
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('radiograph actions', () => {
  it('saves with p_levels as an array and null for blank values', async () => {
    expect(await saveRadiograph(input)).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('patients', 'edit');
    expect(rpc).toHaveBeenCalledWith('save_radiograph', {
      p_id: null, p_patient: uuid(1), p_taken_on: '2026-01-10', p_type: 'periapical', p_purpose: 'baseline', p_teeth: [36],
      p_link: null, p_notes: '', p_levels: [{ site: uuid(2), mesial_mm: 0.5, distal_mm: null }], p_expected_updated_at: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${uuid(1)}/xrays`);
  });

  it('sends the version when editing', async () => {
    await saveRadiograph({ ...input, id: uuid(4), expectedUpdatedAt: '2026-01-10T10:00:00.5+00:00' });
    const args = rpc.mock.calls[0][1];
    expect(args.p_id).toBe(uuid(4));
    expect(args.p_expected_updated_at).toBe('2026-01-10T10:00:00.5+00:00');
  });

  it('returns a validation message without calling the database', async () => {
    const r = await saveRadiograph({ ...input, teeth: [] });
    expect(r.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('removes with a reason', async () => {
    await voidRadiograph({ patientId: uuid(1), id: uuid(4), reason: 'Wrong patient' });
    expect(rpc).toHaveBeenCalledWith('void_radiograph', { p_id: uuid(4), p_reason: 'Wrong patient' });
  });
});
