import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, from, maybeSingle, features } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const chain: { select: () => unknown; eq: () => unknown; maybeSingle: typeof maybeSingle } = { select: () => chain, eq: () => chain, maybeSingle };
  return { rpc: vi.fn(), from: vi.fn(() => chain), maybeSingle, features: { list: ['teaching'] as string[] } };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({ features: features.list })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { correctPlacement, fitComponent, placeImplant } from './implant-actions';

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

  it('placeImplant calls place_implant_v4 with p_course and no doctor', async () => {
    expect(await placeImplant(place)).toEqual({});
    expect(rpc).toHaveBeenCalledWith('place_implant_v4', expect.objectContaining({ p_course: uuid(6), p_slot: null, p_placing_doctor: null }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_torque');
  });

  it('placeImplant refuses a missing course before calling the database', async () => {
    expect(await placeImplant({ ...place, courseId: '' })).toEqual({ error: 'Choose the course.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('correctPlacement calls correct_placement_v3 with p_course', async () => {
    const r = await correctPlacement({
      siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placingDelegateId: uuid(4), assistingDelegateId: '',
      supervisorId: uuid(5), courseId: uuid(6), graft: '', notes: '',
    });
    expect(r).toEqual({});
    expect(rpc).toHaveBeenCalledWith('correct_placement_v3', expect.objectContaining({ p_site: uuid(7), p_course: uuid(6), p_placing_doctor: null }));
  });

  it('placeImplant by a doctor sends the doctor and no delegate; a clinic sends no course or supervisor', async () => {
    const byDoctor = { ...place, placedBy: 'doctor', placingDoctorId: uuid(8), placingDelegateId: null, supervisorId: null, courseId: null };
    expect(await placeImplant(byDoctor)).toEqual({});
    expect(rpc).toHaveBeenCalledWith('place_implant_v4', expect.objectContaining({
      p_placing_doctor: uuid(8), p_placing_delegate: null, p_supervisor: null, p_course: null,
    }));
  });

  it('correctPlacement by a doctor sends the doctor', async () => {
    const r = await correctPlacement({
      siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placedBy: 'doctor', placingDoctorId: uuid(8), placingDelegateId: '',
      assistingDelegateId: '', supervisorId: '', courseId: uuid(6), graft: '', notes: '',
    });
    expect(r).toEqual({});
    expect(rpc).toHaveBeenCalledWith('correct_placement_v3', expect.objectContaining({ p_placing_doctor: uuid(8), p_placing_delegate: null, p_supervisor: null }));
  });
});

describe('correctPlacement in a clinic', () => {
  it('sends the recorded delegate, assistant, supervisor, course and (no) doctor, whatever the input says', async () => {
    features.list = [];
    maybeSingle.mockResolvedValue({
      data: { placing_delegate_id: uuid(4), assisting_delegate_id: uuid(9), supervisor_id: uuid(5), course_id: uuid(6), placing_doctor_id: null },
      error: null,
    });
    try {
      const r = await correctPlacement({
        siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placedBy: 'doctor', placingDoctorId: uuid(8),
        placingDelegateId: null, assistingDelegateId: null, supervisorId: null, courseId: null, graft: '', notes: 'n',
      });
      expect(r).toEqual({});
      expect(from).toHaveBeenCalledWith('implant_sites');
      expect(rpc).toHaveBeenCalledWith('correct_placement_v3', expect.objectContaining({
        p_site: uuid(7), p_placing_doctor: null, p_notes: 'n',
        p_placing_delegate: uuid(4), p_assisting_delegate: uuid(9), p_supervisor: uuid(5), p_course: uuid(6),
      }));
    } finally {
      features.list = ['teaching'];
    }
  });

  it('an implant a doctor placed sends the chosen doctor (0121)', async () => {
    features.list = [];
    maybeSingle.mockResolvedValue({
      data: { placing_delegate_id: null, assisting_delegate_id: null, supervisor_id: null, course_id: null, placing_doctor_id: uuid(3) },
      error: null,
    });
    try {
      await correctPlacement({
        siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placedBy: 'doctor', placingDoctorId: uuid(8),
        placingDelegateId: null, assistingDelegateId: null, supervisorId: null, courseId: null, graft: '', notes: '',
      });
      expect(rpc).toHaveBeenCalledWith('correct_placement_v3', expect.objectContaining({
        p_placing_doctor: uuid(8), p_placing_delegate: null, p_course: null,
      }));
    } finally {
      features.list = ['teaching'];
    }
  });

  it('a course organizer sends what the form chose, reading nothing', async () => {
    from.mockClear();
    await correctPlacement({
      siteId: uuid(7), patientId: uuid(1), placedOn: '2026-01-10', placedBy: 'doctor', placingDoctorId: uuid(8),
      placingDelegateId: uuid(4), assistingDelegateId: '', supervisorId: '', courseId: uuid(6), graft: '', notes: '',
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('correct_placement_v3', expect.objectContaining({ p_placing_delegate: null, p_supervisor: null }));
  });
});

describe('fitComponent', () => {
  it('calls fit_component_v3 with the torque and what the screw holds', async () => {
    const r = await fitComponent({
      siteId: uuid(7), patientId: uuid(1), componentType: 'prosthetic_screw', fittedOn: '2026-01-10', productId: '', lotId: '',
      byDelegateId: '', byOrganizerId: uuid(4), courseId: '', torque: '15', holdsComponentId: null, holdsRestorationId: uuid(9), notes: '',
    });
    expect(r).toEqual({});
    expect(rpc).toHaveBeenCalledWith('fit_component_v3', expect.objectContaining({
      p_site: uuid(7), p_type: 'prosthetic_screw', p_torque: 15, p_holds_component: null, p_holds_restoration: uuid(9),
    }));
  });
});
