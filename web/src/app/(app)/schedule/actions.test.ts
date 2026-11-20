import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each table answers with what `tables` holds, whether awaited directly or through maybeSingle().
const { rpc, from, tables, features } = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'ilike', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = async () => tables[table] ?? { data: null, error: null };
    chain.then = (resolve: (v: unknown) => unknown) => resolve(tables[table] ?? { data: [], error: null });
    return chain;
  };
  return {
    rpc: vi.fn(async (..._args: unknown[]) => ({ data: [] as unknown, error: null })),
    from: vi.fn(chainFor),
    tables,
    features: { list: ['teaching'] as string[] },
  };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({ features: features.list })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { bookSurgery, updateBooking } from './actions';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edit = {
  slotId: uuid(1), chairId: uuid(2), start: '09:00', end: '10:00', placedBy: 'doctor', placingDoctorId: uuid(8),
  supervisorId: '', placing: [], assisting: [], implants: [], overrideReason: '', notes: 'n',
};
const recorded = (supervisor: string | null, doctor: string | null) => {
  tables.surgery_slots = {
    data: { patient_id: uuid(3), session_id: uuid(4), supervisor_id: supervisor, placing_doctor_id: doctor, session: { date: '2030-03-02' } },
    error: null,
  };
};
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  rpc.mockClear();
  for (const k of Object.keys(tables)) delete tables[k];
  features.list = ['teaching'];
});

describe('updateBooking in a clinic', () => {
  beforeEach(() => { features.list = []; });

  it('a pre-switch booking placed by delegates keeps its supervisor and delegates, and takes no doctor', async () => {
    recorded(uuid(5), null);
    expect(await updateBooking({ ...edit, placingDoctorId: '', date: '2030-03-02', setting: 'clinic' })).toEqual({ slotId: uuid(1), date: '2030-03-02' });
    expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v3', expect.objectContaining({
      p_slot: uuid(1), p_supervisor: uuid(5), p_placing: [], p_assisting: [], p_placing_doctor: null, p_notes: 'n',
    }));
  });

  it('a doctor booking keeps its recorded supervisor, whatever the input says', async () => {
    recorded(uuid(5), uuid(8));
    await updateBooking({ ...edit, supervisorId: uuid(9), placing: [uuid(6)], date: '2030-03-02' });
    expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v3', expect.objectContaining({
      p_supervisor: uuid(5), p_placing: [], p_assisting: [], p_placing_doctor: uuid(8),
    }));
  });

  it('a clinic booking needs its doctor', async () => {
    recorded(null, uuid(8));
    expect(await updateBooking({ ...edit, placingDoctorId: '', date: '2030-03-02' })).toEqual({ error: 'Choose the doctor.' });
  });

  it('sends the date and where; an empty Where clears it; a new date checks clashes on that day', async () => {
    recorded(null, uuid(8));
    tables.sessions = { data: { id: uuid(7) }, error: null };
    expect(await updateBooking({ ...edit, date: '2030-03-05', setting: '' })).toEqual({ slotId: uuid(1), date: '2030-03-05' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(7), p_exclude: uuid(1) });
    expect(calls('update_surgery_slot_v3')[0]).toMatchObject({ p_date: '2030-03-05', p_setting: null });
  });

  it('the same date checks clashes on the booking’s own day', async () => {
    recorded(null, uuid(8));
    await updateBooking({ ...edit, date: '2030-03-02', setting: 'hospital_ga' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(4) });
    expect(calls('update_surgery_slot_v3')[0]).toMatchObject({ p_date: '2030-03-02', p_setting: 'hospital_ga' });
  });

  it('needs a date', async () => {
    recorded(null, uuid(8));
    expect(await updateBooking({ ...edit, date: '' })).toEqual({ error: 'Choose a date.' });
  });
});

describe('updateBooking for a course organizer', () => {
  it('sends what the form chose; "recorded" is not theirs to send', async () => {
    recorded(uuid(5), null);
    await updateBooking({ ...edit, supervisorId: uuid(5), placedBy: 'delegate', placing: [uuid(6)], placingDoctorId: '' });
    expect(rpc).toHaveBeenCalledWith('update_surgery_slot_v3', expect.objectContaining({ p_supervisor: uuid(5), p_placing: [uuid(6)], p_placing_doctor: null }));
    expect(await updateBooking({ ...edit, placedBy: 'recorded', placingDoctorId: '' })).toEqual({ error: 'Choose a supervisor.' });
  });

  it('sends no date or setting, whatever the input says', async () => {
    recorded(uuid(5), null);
    await updateBooking({ ...edit, supervisorId: uuid(5), placedBy: 'delegate', placing: [uuid(6)], date: '2030-03-05', setting: 'clinic' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(4) });
    expect(calls('update_surgery_slot_v3')[0]).toMatchObject({ p_date: null, p_setting: null });
  });
});

describe('bookSurgery', () => {
  const book = {
    chairId: uuid(2), start: '09:00', end: '10:00', patientFileNo: 'P1', placedBy: 'doctor', placingDoctorId: uuid(8),
    implants: [], overrideReason: '', notes: '',
  };
  const ok = () => {
    tables.patients = { data: [{ id: uuid(3), file_no: 'P1' }], error: null };
    rpc.mockImplementation(async (name: unknown) => ({ data: name === 'create_surgery_slot_v3' ? uuid(1) : [], error: null }));
  };

  it('a clinic books by date and where, with no session', async () => {
    features.list = [];
    ok();
    expect(await bookSurgery({ ...book, sessionId: uuid(4), date: '2030-03-02', setting: 'hospital_ga' })).toEqual({ slotId: uuid(1), date: '2030-03-02' });
    expect(calls('create_surgery_slot_v3')[0]).toEqual({
      p_session: null, p_chair: uuid(2), p_start: '09:00', p_end: '10:00', p_patient: uuid(3), p_supervisor: null,
      p_placing: [], p_assisting: [], p_implants: [], p_override_reason: '', p_notes: '', p_placing_doctor: uuid(8),
      p_setting: 'hospital_ga', p_date: '2030-03-02',
    });
  });

  it('a clinic checks clashes on that date’s clinic day when there is one', async () => {
    features.list = [];
    ok();
    tables.sessions = { data: { id: uuid(7) }, error: null };
    await bookSurgery({ ...book, date: '2030-03-02' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(7), p_doctor: uuid(8) });
    expect(calls('create_surgery_slot_v3')[0]).toMatchObject({ p_setting: null });
  });

  it('a clinic skips the clash check on a date with no clinic day yet (the database still refuses clashes)', async () => {
    features.list = [];
    ok();
    await bookSurgery({ ...book, date: '2030-03-02' });
    expect(calls('slot_conflicts_v2')).toHaveLength(0);
    expect(calls('create_surgery_slot_v3')).toHaveLength(1);
  });

  it('a clinic needs a date', async () => {
    features.list = [];
    ok();
    expect(await bookSurgery({ ...book, date: '' })).toEqual({ error: 'Choose a date.' });
  });

  it('a course organizer books into the session, with no date or setting', async () => {
    ok();
    tables.sessions = { data: { date: '2030-03-04' }, error: null };
    expect(await bookSurgery({ ...book, sessionId: uuid(4), date: '2030-03-02', setting: 'clinic' })).toEqual({ slotId: uuid(1), date: '2030-03-04' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(4) });
    expect(calls('create_surgery_slot_v3')[0]).toMatchObject({ p_session: uuid(4), p_date: null, p_setting: null });
  });

  it('a course organizer needs a session', async () => {
    ok();
    expect(await bookSurgery({ ...book })).toEqual({ error: 'Choose a surgery session.' });
  });
});
