import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { addRestoration, updateRestoration, voidRestoration } from './restoration-actions';
import { requirePermission } from '@/lib/auth/session';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const add = {
  patientId: uuid(1), stage: 'final', type: 'bridge', sites: [uuid(2), uuid(3)], teeth: [34, 35, 36], fittedOn: '2026-01-10',
  retention: 'screw', material: '', delegateId: uuid(6), supervisorId: '', courseId: '', remakeReason: '', notes: 'n',
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('restoration actions', () => {
  it('adds a restoration with the named parameters', async () => {
    expect(await addRestoration(add)).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('patients', 'edit');
    expect(rpc).toHaveBeenCalledWith('add_restoration', {
      p_patient: uuid(1), p_stage: 'final', p_type: 'bridge', p_sites: [uuid(2), uuid(3)], p_teeth: [34, 35, 36], p_fitted_on: '2026-01-10',
      p_retention: 'screw', p_material: null, p_delegate: uuid(6), p_supervisor: null, p_course: null, p_remake_reason: null, p_notes: 'n',
    });
  });

  it('updates the details with the version the form opened with', async () => {
    await updateRestoration({
      patientId: uuid(1), restorationId: uuid(4), expectedUpdatedAt: '2026-01-10T10:00:00.5+00:00',
      retention: '', material: 'zirconia', delegateId: '', supervisorId: uuid(5), courseId: uuid(7), notes: '',
    });
    expect(rpc).toHaveBeenCalledWith('update_restoration', {
      p_restoration: uuid(4), p_retention: null, p_material: 'zirconia', p_delegate: null, p_supervisor: uuid(5), p_course: uuid(7),
      p_notes: '', p_expected_updated_at: '2026-01-10T10:00:00.5+00:00',
    });
  });

  it('undoes a restoration with a reason', async () => {
    await voidRestoration({ patientId: uuid(1), restorationId: uuid(4), reason: 'Wrong patient' });
    expect(rpc).toHaveBeenCalledWith('void_restoration', { p_restoration: uuid(4), p_reason: 'Wrong patient' });
  });

  it('shows business errors verbatim and validates before calling the database', async () => {
    rpc.mockResolvedValue({ error: { message: 'Say why the final restoration was remade.', hint: 'user' } });
    expect(await addRestoration(add)).toEqual({ error: 'Say why the final restoration was remade.' });
    rpc.mockClear();
    expect(await addRestoration({ ...add, stage: 'interim' })).toEqual({ error: 'Choose temporary or final.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
