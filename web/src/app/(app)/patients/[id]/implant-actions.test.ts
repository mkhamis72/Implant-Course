import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { correctPlacement, placeImplant } from './implant-actions';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('placement actions send the course', () => {
  const place = {
    patientId: uuid(1), tooth: 36, productId: uuid(2), lotId: uuid(3), placedOn: '2026-01-10', placingDelegateId: uuid(4),
    supervisorId: uuid(5), courseId: uuid(6), technique: 'guided', slotId: '', assistingDelegateId: '', graft: '', notes: '',
  };

  it('placeImplant calls place_implant_v3 with p_course', async () => {
    expect(await placeImplant(place)).toEqual({});
    expect(rpc).toHaveBeenCalledWith('place_implant_v3', expect.objectContaining({ p_course: uuid(6), p_slot: null }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_torque');
  });

  it('placeImplant refuses a missing course before calling the database', async () => {
    expect(await placeImplant({ ...place, courseId: '' })).toEqual({ error: 'Choose the course.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('correctPlacement calls correct_placement_v2 with p_course', async () => {
    const r = await correctPlacement({
      siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placingDelegateId: uuid(4), assistingDelegateId: '',
      supervisorId: uuid(5), courseId: uuid(6), graft: '', notes: '',
    });
    expect(r).toEqual({});
    expect(rpc).toHaveBeenCalledWith('correct_placement_v2', expect.objectContaining({ p_site: uuid(7), p_course: uuid(6) }));
  });
});
