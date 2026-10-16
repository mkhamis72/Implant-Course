import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('surgery actions', () => {
  it('saves surgical details with the version the form was rendered from', async () => {
    expect(await saveSurgery({ ...ids, expectedUpdatedAt: '2026-10-17T10:00:00.123456+00:00', flap: 'crestal', keratinizedMucosaMm: '2' })).toEqual({});
    expect(rpc).toHaveBeenCalledWith('save_implant_surgery', {
      p_site: ids.siteId, p_extraction_date: null, p_placement_timing: null, p_soft_tissue_phenotype: null, p_keratinized_mucosa_mm: 2,
      p_flap: 'crestal', p_torque_type: null, p_healing: null, p_primary_closure: null, p_grafting_performed: null,
      p_expected_updated_at: '2026-10-17T10:00:00.123456+00:00',
    });
  });

  it('shows a database business error verbatim and never calls the database for an invalid form', async () => {
    rpc.mockResolvedValue({ error: { message: 'These surgical details were changed by someone else. Reload to see them.', hint: 'user' } });
    expect(await saveSurgery({ ...ids })).toEqual({ error: 'These surgical details were changed by someone else. Reload to see them.' });
    rpc.mockClear();
    expect(await saveSurgery({ ...ids, keratinizedMucosaMm: '99' })).toEqual({ error: 'Enter the keratinized mucosa width from 0 to 15 mm.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('adds a new graft, dropping a date left over from "staged"', async () => {
    await saveGraft({ ...ids, graftId: '', procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-01-01', material: 'xenograft', product: '', membrane: '', notes: '' });
    expect(rpc).toHaveBeenCalledWith('add_implant_graft', {
      p_site: ids.siteId, p_procedure: 'gbr', p_timing: 'simultaneous', p_performed_on: null, p_material: 'xenograft',
      p_product: '', p_membrane: null, p_notes: '',
    });
  });

  it('updates an existing graft and deletes one', async () => {
    const graftId = '00000000-0000-4000-8000-000000000009';
    await saveGraft({ ...ids, graftId, procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01' });
    expect(rpc).toHaveBeenCalledWith('update_implant_graft', {
      p_graft: graftId, p_procedure: 'sinus_lateral', p_timing: 'staged', p_performed_on: '2025-12-01', p_material: null,
      p_product: '', p_membrane: null, p_notes: '',
    });
    await deleteGraft({ patientId: ids.patientId, graftId });
    expect(rpc).toHaveBeenLastCalledWith('delete_implant_graft', { p_graft: graftId });
  });
});
