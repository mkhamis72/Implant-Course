import type { Client } from 'pg';
import { actAs, asPostgres } from './helpers';

export async function makePatient(c: Client, name = 'Inventory Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeDelegate(c: Client, name = 'Test Delegate'): Promise<string> {
  const { rows } = await c.query('insert into public.delegates (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeProduct(c: Client, type = 'implant', brand = 'Test Brand'): Promise<string> {
  const implant = type === 'implant';
  const { rows } = await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm)
     values ($1, $2, 'T1', $3, $4) returning id`,
    [type, brand, implant ? 4.0 : null, implant ? 10 : null],
  );
  return rows[0].id;
}

export async function receive(
  c: Client,
  product: string,
  qty: number,
  lot: string | null = 'L1',
  expiry: string | null = null,
): Promise<string> {
  const { rows } = await c.query(
    'select public.receive_stock(p_product => $1, p_qty => $2, p_lot_no => $3, p_expiry => $4) as id',
    [product, qty, lot, expiry],
  );
  return rows[0].id;
}

export async function onHand(c: Client, lot: string): Promise<number> {
  const { rows } = await c.query('select on_hand from public.stock_on_hand where stock_lot_id = $1', [lot]);
  return rows[0].on_hand;
}

/** Runs fn as the connection's own role (bypassing RLS and column grants), then returns to the role in use. */
async function asOwner<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  const role = (await c.query('select current_user as u')).rows[0].u as string;
  await c.query('reset role');
  try {
    return await fn();
  } finally {
    if (role !== 'postgres') await c.query(`set local role ${role}`);
  }
}

/** Places through place_implant_v4 in the given course (the booking's, else a new one, when omitted); torque / ISQ / bone type are set directly. */
export async function place(
  c: Client,
  a: {
    patient: string; tooth: number; product: string; lot: string; delegate: string; supervisor: string;
    assistant?: string; placedOn?: string; slot?: string; technique?: string; course?: string;
    torque?: number; isq?: number; boneType?: string;
  },
): Promise<string> {
  const course = a.course
    ?? (a.slot
      ? (await asOwner(c, () => c.query('select s.course_id from public.surgery_slots w join public.sessions s on s.id = w.session_id where w.id = $1', [a.slot]))).rows[0]?.course_id
      : null)
    ?? (await asOwner(c, () => makeCourse(c)));
  // A placement needs its delegates enrolled in the course (0081).
  for (const delegate of [a.delegate, a.assistant]) {
    if (delegate) {
      await asOwner(c, () => c.query(
        'insert into public.enrollments (course_id, delegate_id) values ($1, $2) on conflict (course_id, delegate_id) do nothing',
        [course, delegate],
      ));
    }
  }
  const { rows } = await c.query(
    `select public.place_implant_v4(
       p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4,
       p_placed_on => coalesce($5::date, current_date), p_placing_delegate => $6, p_supervisor => $7,
       p_assisting_delegate => $8, p_graft => '', p_notes => '', p_slot => $9, p_technique => $10, p_course => $11, p_placing_doctor => null) as id`,
    [a.patient, a.tooth, a.product, a.lot, a.placedOn ?? null, a.delegate, a.supervisor, a.assistant ?? null, a.slot ?? null,
     a.technique ?? null, course],
  );
  const id = rows[0].id as string;
  if (a.torque !== undefined || a.isq !== undefined || a.boneType !== undefined) {
    await asOwner(c, () => c.query(
      'update public.implant_sites set torque_ncm = $2, isq = $3, bone_type = $4 where id = $1',
      [id, a.torque ?? null, a.isq ?? null, a.boneType ?? null],
    ));
  }
  return id;
}

export async function makeCourse(c: Client, start = '2030-03-01', end = '2030-03-05'): Promise<string> {
  const { rows } = await c.query(
    "insert into public.courses (name, start_date, end_date) values ('Test Course', $1, $2) returning id",
    [start, end],
  );
  return rows[0].id;
}

export async function makeSession(c: Client, course: string, type = 'surgery', date = '2030-03-02'): Promise<string> {
  const { rows } = await c.query(
    `insert into public.sessions (course_id, type, title, date, start_time, end_time)
     values ($1, $2, 'Test Session', $3, '08:00', '17:00') returning id`,
    [course, type, date],
  );
  return rows[0].id;
}

export async function enroll(c: Client, course: string, delegate: string): Promise<void> {
  await c.query('insert into public.enrollments (course_id, delegate_id) values ($1, $2)', [course, delegate]);
}

export async function makeChair(c: Client, name = `Chair ${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  const { rows } = await c.query('insert into public.chairs (name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function book(
  c: Client,
  a: {
    session: string; chair: string; patient: string; supervisor: string; placing: string[];
    assisting?: string[]; implants?: { tooth: number; product_id?: string | null; technique?: string }[];
    start?: string; end?: string; override?: string;
  },
): Promise<string> {
  const { rows } = await c.query(
    `select public.create_surgery_slot_v4(
       p_session => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_patient => $5,
       p_supervisor => $6, p_placing => $7::uuid[], p_assisting => $8::uuid[], p_implants => $9::jsonb,
       p_override_reason => $10, p_notes => '', p_placing_doctor => null, p_setting => null, p_date => null) as id`,
    [
      a.session, a.chair, a.start ?? '09:00', a.end ?? '10:00', a.patient, a.supervisor, a.placing,
      a.assisting ?? [], JSON.stringify(a.implants ?? []), a.override ?? '',
    ],
  );
  return rows[0].id;
}

export type Perms = Partial<Record<'patients' | 'schedule' | 'courses' | 'checklists' | 'inventory' | 'delegates' | 'research', 'view' | 'edit' | null>>;

/** Sets a user's area permissions in the company (academy by default) directly (bypasses RLS; call as
 *  postgres). Unlisted areas become None there; other companies' rows stay. */
export async function setPerms(
  c: Client, user: string, perms: Perms, company = 'a7c0de00-0000-4000-8000-000000000001',
): Promise<void> {
  await c.query('reset role');
  await c.query('delete from public.user_permissions where company_id = $1 and user_id = $2', [company, user]);
  for (const [area, level] of Object.entries(perms)) {
    if (level) {
      await c.query('insert into public.user_permissions (company_id, user_id, area, level) values ($1, $2, $3, $4)',
        [company, user, area, level]);
    }
  }
}

export async function makeLecturer(c: Client, name = `Zz Lecturer ${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  const { rows } = await c.query('insert into public.lecturers (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function addTalk(
  c: Client,
  a: { session: string; lecturer: string; start?: string; end?: string; topic?: string },
): Promise<string> {
  const { rows } = await c.query(
    `select public.create_talk(p_session => $1, p_start => $2::time, p_end => $3::time, p_lecturer => $4, p_topic => $5) as id`,
    [a.session, a.start ?? '09:00', a.end ?? '10:00', a.lecturer, a.topic ?? 'Sinus lift basics'],
  );
  return rows[0].id;
}

/**
 * A failure recorded before failure details existed (the removed record_followup): a failed follow-up and a
 * failed implant and tooth, no details. Writes as postgres, then acts as `user` again.
 */
export async function legacyFailure(c: Client, site: string, date: string, user: string): Promise<void> {
  await asPostgres(c);
  await c.query(`insert into public.implant_followups (site_id, date, check_type, outcome) values ($1, $2::date, '3-month', 'failed')`, [site, date]);
  const { rows } = await c.query(`update public.implant_sites set state = 'failed' where id = $1 returning patient_id, tooth`, [site]);
  await c.query(`select app_private.set_tooth($1, $2::smallint, 'failed')`, [rows[0].patient_id, rows[0].tooth]);
  await actAs(c, user);
}

/**
 * A component as fit_component_v2 (dropped in 0144) recorded it, for tests of the rows it left behind (a legacy
 * `final_restoration` above all, which fit_component_v3 refuses): closes every current part on the implant that day,
 * linked to the new row by replaced_by, and a final restoration marks the implant and tooth restored. No product or
 * stock. Writes as postgres, then restores the caller's role and claims. `fittedOn` is a SQL date expression.
 */
export async function legacyFit(
  c: Client, site: string, type: string,
  opts: { fittedOn?: string; delegate?: string | null; organizer?: string | null; course?: string | null } = {},
): Promise<string> {
  const saved = (await c.query(
    `select current_user as role, coalesce(current_setting('request.jwt.claims', true), '') as claims`)).rows[0];
  await c.query('reset role');
  const s = (await c.query(
    `select gen_random_uuid() as id, (${opts.fittedOn ?? 'public.cairo_today()'})::date::text as on_date, company_id, patient_id, tooth
     from public.implant_sites where id = $1`, [site])).rows[0];
  const closed = (await c.query(
    `update public.site_components set removed_on = $2 where site_id = $1 and removed_on is null returning id`,
    [site, s.on_date])).rows.map((r) => r.id as string);
  await c.query(
    `insert into public.site_components (id, company_id, site_id, component_type, fitted_on, fitted_by_delegate_id,
       fitted_by_organizer_id, notes, course_id)
     values ($1, $2, $3, $4::public.component_type, $5, $6, $7, '', $8)`,
    [s.id, s.company_id, site, type, s.on_date, opts.delegate ?? null, opts.organizer ?? null, opts.course ?? null],
  );
  if (closed.length) {
    await c.query('update public.site_components set replaced_by = $1 where id = any($2::uuid[])', [s.id, closed]);
  }
  if (type === 'final_restoration') {
    await c.query(`update public.implant_sites set state = 'restored' where id = $1`, [site]);
    await c.query(`select app_private.set_tooth($1, $2::smallint, 'restored')`, [s.patient_id, s.tooth]);
  }
  if (saved.role !== 'postgres') {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [saved.claims]);
    await c.query(`set local role ${saved.role === 'anon' ? 'anon' : 'authenticated'}`);
  }
  return s.id as string;
}

/** A pending login for the email (as postgres), so an auth.users insert creates its membership (0088):
 *  without one, handle_new_user refuses the sign-up (0090). Academy and an active organizer by default. */
export async function pendingLogin(
  c: Client,
  email: string,
  opts: { company?: string; role?: 'admin' | 'organizer' | 'delegate'; fullName?: string; delegateId?: string | null } = {},
): Promise<void> {
  await asPostgres(c);
  await c.query(
    `insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
     values ($1, lower($2), $3, $4, $5, '00000000-0000-0000-0000-000000000000')`,
    [opts.company ?? 'a7c0de00-0000-4000-8000-000000000001', email, opts.fullName ?? '', opts.role ?? 'organizer', opts.delegateId ?? null],
  );
}

/**
 * A self_auth.user row on the test's own connection (as postgres), so a rollback removes it. The Self-Auth
 * package commits on its own pool connection and cannot join a test transaction or see its uncommitted
 * pending login, so rows that live inside withTx are written here. For users that must really sign in, use
 * createTestUser (tests/support/self-auth.ts), which goes through the package.
 * The insert fires the provisioning trigger (0101): it needs a pending login for the email in `companyId`,
 * unless a profile with `id` already exists. `email` is the real address. The login key is a placeholder, as
 * nothing signs in with these rows. `totpSecret` adds a confirmed 2FA factor.
 */
export async function insertSelfAuthUser(
  c: Client,
  a: { id?: string; companyId?: string; email: string; totpSecret?: string },
): Promise<string> {
  await asPostgres(c);
  const email = a.email.trim().toLowerCase();
  const companyId = a.companyId ?? 'a7c0de00-0000-4000-8000-000000000001';
  const { rows } = await c.query(
    `insert into self_auth."user" (id, name, email, "emailVerified", "companyId", "realEmail")
     values (coalesce($1::uuid, gen_random_uuid()), $2, 'zz-' || gen_random_uuid() || '@' || $3 || '.tenant.invalid', true, $3, $2)
     returning id`,
    [a.id ?? null, email, companyId]);
  const id = rows[0].id as string;
  if (a.totpSecret) await insertSelfAuthFactor(c, id);
  return id;
}

/** A confirmed 2FA factor for an existing self_auth user (a later call replaces it: one factor per user).
 *  `createdAt` is SQL, as 0101's mfa_setup_done compares it with the admin's reset time. */
export async function insertSelfAuthFactor(c: Client, userId: string, createdAt = 'clock_timestamp()'): Promise<void> {
  await asPostgres(c);
  await c.query(
    `insert into self_auth.totp_factor (user_id, secret_enc, confirmed, created_at) values ($1, 'x', true, ${createdAt})
     on conflict (user_id) do update set confirmed = true, created_at = excluded.created_at`,
    [userId]);
}

/** A live self_auth.session row (as postgres); returns its id. Pass an id to choose it. */
export async function insertSelfAuthSession(c: Client, userId: string, id?: string): Promise<string> {
  await asPostgres(c);
  return (await c.query(
    `insert into self_auth.session (id, "expiresAt", token, "updatedAt", "userId")
     values (coalesce($2::uuid, gen_random_uuid()), now() + interval '1 day', gen_random_uuid()::text, now(), $1) returning id`,
    [userId, id ?? null])).rows[0].id as string;
}
