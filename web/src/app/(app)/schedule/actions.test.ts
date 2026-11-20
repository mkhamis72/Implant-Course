import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each table answers with what `tables` holds, whether awaited directly or through maybeSingle().
const { rpc, from, tables, features, queries } = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const queries: { table: string; method: string; args: unknown[] }[] = [];
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'ilike', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => { queries.push({ table, method: m, args }); return chain; };
    }
    chain.maybeSingle = async () => tables[table] ?? { data: null, error: null };
    chain.then = (resolve: (v: unknown) => unknown) => resolve(tables[table] ?? { data: [], error: null });
    return chain;
  };
  return {
    rpc: vi.fn(async (..._args: unknown[]) => ({ data: [] as unknown, error: null })),
    from: vi.fn(chainFor),
    tables,
    queries,
    features: { list: ['teaching'] as string[] },
  };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({ features: features.list })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { addSurgeryDay, bookSurgery, searchBookingPatients, updateBooking } from './actions';

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
  queries.length = 0;
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

describe('updateBooking: the implants', () => {
  const people = { supervisorId: uuid(5), placedBy: 'delegate', placing: [uuid(6)], placingDoctorId: '' };
  const implants = [
    { tooth: '36', productId: uuid(10), technique: 'guided', spares: [uuid(11)], placed: false },
    // Placed, an older row with no technique: sent back as recorded.
    { tooth: '46', productId: uuid(12), technique: '', spares: [], placed: true },
  ];
  const order = () => rpc.mock.calls.map((c) => c[0]);

  it('updateBooking calls set_booking_implants then update_surgery_slot_v3', async () => {
    recorded(uuid(5), null);
    expect(await updateBooking({ ...edit, ...people, implants })).toEqual({ slotId: uuid(1), date: '2030-03-02' });
    expect(order()).toEqual(['slot_conflicts_v2', 'set_booking_implants', 'update_surgery_slot_v3']);
    expect(calls('set_booking_implants')[0]).toEqual({
      p_slot: uuid(1),
      p_implants: [
        { tooth: 36, product_id: uuid(10), technique: 'guided', spares: [uuid(11)] },
        { tooth: 46, product_id: uuid(12), technique: null, spares: [] },
      ],
    });
    expect(calls('set_implant_technique')).toHaveLength(0);
  });

  it('a tooth still to be placed needs its technique', async () => {
    recorded(uuid(5), null);
    expect(await updateBooking({ ...edit, ...people, implants: [{ ...implants[0], technique: '' }] }))
      .toEqual({ error: 'Choose Guided or Free hand for each implant.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('implants refused → no second call', async () => {
    recorded(uuid(5), null);
    rpc.mockImplementation(async (name: unknown) => (name === 'set_booking_implants'
      ? { data: null, error: { message: 'Tooth 46 is already placed; change it in Corrections.', hint: 'user' } }
      : { data: [], error: null }) as never);
    try {
      expect(await updateBooking({ ...edit, ...people, implants })).toEqual({ error: 'Tooth 46 is already placed; change it in Corrections.' });
      expect(calls('update_surgery_slot_v3')).toHaveLength(0);
    } finally {
      rpc.mockImplementation(async () => ({ data: [], error: null }));
    }
  });

  it('the rest refused after the implants were saved says so', async () => {
    recorded(uuid(5), null);
    vi.mocked(revalidatePath).mockClear();
    rpc.mockImplementation(async (name: unknown) => (name === 'update_surgery_slot_v3'
      ? { data: null, error: { message: 'This chair is booked.', hint: 'user' } }
      : { data: [], error: null }) as never);
    try {
      expect(await updateBooking({ ...edit, ...people, implants }))
        .toEqual({ error: 'The implants were saved, but the other changes were not: This chair is booked.' });
      expect(revalidatePath).toHaveBeenCalledWith('/schedule');
      expect(revalidatePath).toHaveBeenCalledWith(`/patients/${uuid(3)}`, 'layout');
    } finally {
      rpc.mockImplementation(async () => ({ data: [], error: null }));
    }
  });
});

describe('addSurgeryDay', () => {
  const day = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ date: '2030-03-02', title: 'Surgery day', start_time: '08:00', end_time: '17:00', room: '', ...o })) f.set(k, v);
    return f;
  };

  it('a course organizer adds a surgery day for a course', async () => {
    expect(await addSurgeryDay({}, day({ course_id: uuid(4) }))).toEqual({ ok: 'Surgery day added.' });
    expect(calls('add_surgery_session')[0]).toMatchObject({ p_course: uuid(4), p_date: '2030-03-02' });
  });

  it('a clinic has no surgery days to add: refused before the database (it books surgery directly)', async () => {
    features.list = [];
    const r = await addSurgeryDay({}, day({}));
    expect(r.error).toBe('A clinic books surgery directly; there are no surgery days to add.');
    expect(calls('add_surgery_session')).toHaveLength(0);
  });
});

describe('bookSurgery', () => {
  const book = {
    chairId: uuid(2), start: '09:00', end: '10:00', patientId: uuid(3), placedBy: 'doctor', placingDoctorId: uuid(8),
    implants: [], overrideReason: '', notes: '',
  };
  const ok = () => {
    tables.patients = { data: { id: uuid(3) }, error: null };
    rpc.mockImplementation(async (name: unknown) => ({ data: name === 'create_surgery_slot_v4' ? uuid(1) : [], error: null }));
  };

  it('a clinic books by date and where, with no session', async () => {
    features.list = [];
    ok();
    expect(await bookSurgery({ ...book, sessionId: uuid(4), date: '2030-03-02', setting: 'hospital_ga' })).toEqual({ slotId: uuid(1), date: '2030-03-02' });
    expect(calls('create_surgery_slot_v4')[0]).toEqual({
      p_session: null, p_chair: uuid(2), p_start: '09:00', p_end: '10:00', p_patient: uuid(3), p_supervisor: null,
      p_placing: [], p_assisting: [], p_implants: [], p_override_reason: '', p_notes: '', p_placing_doctor: uuid(8),
      p_setting: 'hospital_ga', p_date: '2030-03-02',
    });
  });

  it('a clinic checks clashes through any session on that date, the course-less one first (clashes span all slots)', async () => {
    features.list = [];
    ok();
    tables.sessions = { data: { id: uuid(7) }, error: null };
    await bookSurgery({ ...book, date: '2030-03-02' });
    const q = queries.filter((x) => x.table === 'sessions');
    expect(q).toContainEqual({ table: 'sessions', method: 'eq', args: ['date', '2030-03-02'] });
    expect(q.filter((x) => x.method === 'is' || (x.method === 'eq' && x.args[0] === 'type'))).toEqual([]);
    expect(q.find((x) => x.method === 'order')).toEqual({ table: 'sessions', method: 'order', args: ['course_id', { nullsFirst: true }] });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(7) });
  });

  it('a clinic checks clashes on that date’s clinic day when there is one', async () => {
    features.list = [];
    ok();
    tables.sessions = { data: { id: uuid(7) }, error: null };
    await bookSurgery({ ...book, date: '2030-03-02' });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_session: uuid(7), p_doctor: uuid(8) });
    expect(calls('create_surgery_slot_v4')[0]).toMatchObject({ p_setting: null });
  });

  it('a clinic skips the clash check only on a date with no session at all (the database still refuses clashes)', async () => {
    features.list = [];
    ok();
    await bookSurgery({ ...book, date: '2030-03-02' });
    expect(calls('slot_conflicts_v2')).toHaveLength(0);
    expect(calls('create_surgery_slot_v4')).toHaveLength(1);
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
    expect(calls('create_surgery_slot_v4')[0]).toMatchObject({ p_session: uuid(4), p_date: null, p_setting: null });
  });

  it('a course organizer needs a session', async () => {
    ok();
    expect(await bookSurgery({ ...book })).toEqual({ error: 'Choose a surgery session.' });
  });

  it('bookSurgery calls create_surgery_slot_v4', async () => {
    ok();
    tables.sessions = { data: { date: '2030-03-04' }, error: null };
    const implants = [
      { tooth: '14', productId: uuid(10), technique: 'guided', spares: [uuid(11), uuid(12)] },
      { tooth: '15', productId: '', technique: 'free_hand', spares: [] },
    ];
    await bookSurgery({ ...book, sessionId: uuid(4), implants });
    expect(calls('create_surgery_slot_v3')).toHaveLength(0);
    expect(calls('create_surgery_slot_v4')[0]).toEqual({
      p_session: uuid(4), p_chair: uuid(2), p_start: '09:00', p_end: '10:00', p_patient: uuid(3), p_supervisor: null,
      p_placing: [], p_assisting: [], p_override_reason: '', p_notes: '', p_placing_doctor: uuid(8),
      p_setting: null, p_date: null,
      p_implants: [
        { tooth: 14, product_id: uuid(10), technique: 'guided', spares: [uuid(11), uuid(12)] },
        { tooth: 15, product_id: null, technique: 'free_hand', spares: [] },
      ],
    });
  });

  it('refuses more than 5 spares on a tooth, or the same implant twice', async () => {
    ok();
    tables.sessions = { data: { date: '2030-03-04' }, error: null };
    const six = [11, 12, 13, 14, 15, 16].map(uuid);
    expect(await bookSurgery({ ...book, sessionId: uuid(4), implants: [{ tooth: '14', productId: '', technique: 'guided', spares: six }] }))
      .toEqual({ error: 'Tooth 14 has more than 5 spares.' });
    expect(await bookSurgery({ ...book, sessionId: uuid(4), implants: [{ tooth: '14', productId: uuid(10), technique: 'guided', spares: [uuid(10)] }] }))
      .toEqual({ error: 'Tooth 14 lists the same implant twice.' });
    expect(await bookSurgery({ ...book, sessionId: uuid(4), implants: [{ tooth: '14', productId: '', technique: 'guided', spares: [uuid(11), uuid(11)] }] }))
      .toEqual({ error: 'Tooth 14 lists the same implant twice.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('bookSurgery sends p_patient from patientId', async () => {
    ok();
    tables.sessions = { data: { date: '2030-03-04' }, error: null };
    await bookSurgery({ ...book, sessionId: uuid(4) });
    expect(calls('create_surgery_slot_v4')[0]).toMatchObject({ p_patient: uuid(3) });
    expect(calls('slot_conflicts_v2')[0]).toMatchObject({ p_patient: uuid(3) });
  });

  it('a patient id that is not a uuid is refused before the database', async () => {
    ok();
    expect(await bookSurgery({ ...book, sessionId: uuid(4), patientId: 'P1' })).toEqual({ error: 'Choose the patient.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  // Unknown, archived and other-company ids all come back empty from the re-read (by id, not archived, through the
  // user's client, so RLS keeps it to the company): each is refused before any RPC.
  it.each(['unknown', 'archived', 'other-company'])('forged patient id refused (%s)', async () => {
    ok();
    tables.patients = { data: null, error: null };
    tables.sessions = { data: { date: '2030-03-04' }, error: null };
    expect(await bookSurgery({ ...book, sessionId: uuid(4), patientId: uuid(99) })).toEqual({ error: 'Choose the patient.' });
    const q = queries.filter((x) => x.table === 'patients');
    expect(q).toContainEqual({ table: 'patients', method: 'eq', args: ['id', uuid(99)] });
    expect(q).toContainEqual({ table: 'patients', method: 'eq', args: ['archived', false] });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('searchBookingPatients', () => {
  const row = { id: uuid(3), file_no: 'P1', full_name: 'Amal', dob: '1980-01-01', phone: '0100', archived: false, notes: 'x' };

  it('searchBookingPatients needs schedule edit', async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(searchBookingPatients('Amal')).rejects.toThrow('NEXT_REDIRECT');
    expect(requirePermission).toHaveBeenLastCalledWith('schedule', 'edit');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('short query returns nothing', async () => {
    expect(await searchBookingPatients(' a ')).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('searches non-archived patients, 10 at most, and returns only the picker fields', async () => {
    rpc.mockImplementation(async () => ({ data: [row], error: null }));
    expect(await searchBookingPatients('Amal')).toEqual([
      { id: uuid(3), file_no: 'P1', full_name: 'Amal', dob: '1980-01-01', phone: '0100' },
    ]);
    expect(rpc).toHaveBeenCalledWith('search_patients_v2', {
      q: 'Amal', include_archived: false, stages: [], course: null, supervisor: null, p_offset: 0, p_limit: 10,
    });
  });
});
