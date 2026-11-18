import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, from, maybeSingle, features } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const chain: { select: () => unknown; eq: () => unknown; maybeSingle: typeof maybeSingle } = { select: () => chain, eq: () => chain, maybeSingle };
  return { rpc: vi.fn(async () => ({ data: [], error: null })), from: vi.fn(() => chain), maybeSingle, features: { list: ['teaching'] as string[] } };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({ features: features.list })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { updateBooking } from './actions';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edit = {
  slotId: uuid(1), chairId: uuid(2), start: '09:00', end: '10:00', placedBy: 'doctor', placingDoctorId: uuid(8),
  supervisorId: '', placing: [], assisting: [], implants: [], overrideReason: '', notes: 'n',
};
const recorded = (supervisor: string | null, doctor: string | null) =>
  maybeSingle.mockResolvedValue({
    data: { patient_id: uuid(3), session_id: uuid(4), supervisor_id: supervisor, placing_doctor_id: doctor, session: { date: '2030-03-02' } },
    error: null,
  });

describe('updateBooking in a clinic', () => {
  beforeEach(() => { rpc.mockClear(); features.list = []; });

  it('a pre-switch booking placed by delegates keeps its supervisor and delegates, and takes no doctor', async () => {
    recorded(uuid(5), null);
    try {
      expect(await updateBooking({ ...edit, placingDoctorId: '' })).toEqual({ slotId: uuid(1), date: '2030-03-02' });
      expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v2', expect.objectContaining({
        p_slot: uuid(1), p_supervisor: uuid(5), p_placing: [], p_assisting: [], p_placing_doctor: null, p_notes: 'n',
      }));
    } finally {
      features.list = ['teaching'];
    }
  });

  it('a doctor booking keeps its recorded supervisor, whatever the input says', async () => {
    recorded(uuid(5), uuid(8));
    try {
      await updateBooking({ ...edit, supervisorId: uuid(9), placing: [uuid(6)] });
      expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v2', expect.objectContaining({
        p_supervisor: uuid(5), p_placing: [], p_assisting: [], p_placing_doctor: uuid(8),
      }));
    } finally {
      features.list = ['teaching'];
    }
  });

  it('a clinic booking needs its doctor', async () => {
    recorded(null, uuid(8));
    try {
      expect(await updateBooking({ ...edit, placingDoctorId: '' })).toEqual({ error: 'Choose the doctor.' });
    } finally {
      features.list = ['teaching'];
    }
  });
});

describe('updateBooking for a course organizer', () => {
  it('sends what the form chose; "recorded" is not theirs to send', async () => {
    recorded(uuid(5), null);
    rpc.mockClear();
    await updateBooking({ ...edit, supervisorId: uuid(5), placedBy: 'delegate', placing: [uuid(6)], placingDoctorId: '' });
    expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v2', expect.objectContaining({ p_supervisor: uuid(5), p_placing: [uuid(6)], p_placing_doctor: null }));
    expect(await updateBooking({ ...edit, placedBy: 'recorded', placingDoctorId: '' })).toEqual({ error: 'Choose a supervisor.' });
  });
});
