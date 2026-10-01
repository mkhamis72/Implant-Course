# Plan 4 — Courses, Surgery Schedule & Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers run courses (sessions, enrolled delegates), book surgery slots on chairs
(patient, supervisor, placing/assisting delegates, implants needed) with double-booking
warnings, see a printable daily pull list, place implants from a booking (pre-filled; the
booking closes when all its implants are placed), get a per-delegate implant report with CSV
export — and can correct a wrong stock batch, a mistaken follow-up or a mistaken component
without ever editing the ledger.

**Architecture:** New tables `courses`, `enrollments`, `sessions`, `chairs` (direct writes via
column grants), `surgery_slots`, `slot_delegates`, `slot_planned_implants` (written only by
SECURITY DEFINER functions), plus `course_id/session_id/slot_id` on `implant_sites` and
`voided_*` columns on components/follow-ups. Booking, cancelling, placement-from-booking and
corrections are single-transaction functions with `hint = 'user'` errors. Times are entered as
Cairo clock times on the session's date and converted in SQL.

**Tech Stack:** as Plans 1–3.

**Spec:** `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md` (§4.3, §4.4, §5.2,
§5.3, §5.4 pre-fill, §5.8, §6 Schedule / Courses & Delegates / Admin chairs; §4.6 "corrections =
reversing movement")
**Roadmap:** `docs/superpowers/plans/2026-10-01-roadmap.md` (Plan 4 of 5 + correction workflow)

## Global Constraints

- All Plan 1–3 constraints apply (RLS, column grants, audit triggers on new tables, no anon
  privileges, hint='user' business errors through `userMessage`, Cairo "today", E2E rows named
  `E2E …`, alerts asserted inside `main`, lock order site → batch).
- Session types: `lecture`, `workshop`, `surgery`. Surgeries can only be booked in a surgery
  session; the booking date is the session's date; start/end are Cairo clock times.
- Booking requires: active chair, end after start, existing non-archived patient, active
  supervisor, ≥1 placing delegate; every delegate active and enrolled in the session's course;
  nobody both placing and assisting; implants listed by FDI tooth (each once) with optional product.
- Double-booking (overlapping non-cancelled bookings sharing chair, patient, supervisor or any
  delegate) is refused unless an override reason (≥3 characters) is given; the reason is stored.
- Booking an implant creates a planned implant (tooth → `implant_planned`) or links an existing
  planned one; a tooth with a placed/restored implant cannot be booked.
- Cancelling a booking keeps its planned implants (they stay planned, unlinked); reason required.
- Placement from a booking records course/session/booking on the implant; the booking becomes
  `done` when none of its planned implants remain planned.
- Corrections (reason ≥3 characters, all audited):
  - wrong batch (implant or stock component) → `+1` reversing movement on the old batch
    (`reverses_movement_id` set) and a new `use` on the new batch; recall stops listing the old batch;
  - void a follow-up; voiding the failure that failed an implant restores it (unless a new implant
    is already on the tooth);
  - undo the current component (stock returned; previous component becomes current; undoing a
    final restoration puts the implant and tooth back to placed).
- Chairs are managed by Admins only.
- The surgery-checklist auto-attach in spec §5.2 step 4 ships with Plan 5 (checklists).

## Review Focus

1. **Two bookings at the same time sharing a chair, patient, supervisor or delegate** → listed
   clearly, refused without a reason, stored with the reason when overridden. Pinned in Task 2
   (`clashes are detected per kind`, `override needs a reason`) and Task 8 (E2E).
2. **Booking a delegate not enrolled in the course, the same delegate twice, a tooth listed twice,
   or a tooth that already has an implant** → specific refusal. Pinned in Task 2.
3. **Correcting a batch to an expired/empty/wrong-product batch, or correcting twice** → refused or
   correct; on-hand and recall always match reality. Pinned in Task 3.
4. **Voiding a failure after the tooth was re-planned, or undoing a component that isn't current**
   → refused. Pinned in Task 3.
5. **CSV export with names containing commas, quotes, newlines, or starting with `=`** → opens
   correctly in Excel without formula execution. Pinned in Task 5 (`toCsv`).

---

## File Structure (Plan 4)

```
web/supabase/migrations/
  0013_courses.sql            courses, enrollments, sessions (+ in-course date check), chairs
  0014_surgery_slots.sql      slots, slot_delegates, slot_planned_implants, implant_sites links,
                              cairo_ts(), slot_conflicts(), create/cancel_surgery_slot(), slots_on()
  0015_corrections.sql        voided_* columns, correct_batch(), void_followup(), void_component(),
                              lot_usage() ignores reversed uses
  0016_slot_placement.sql     place_implant(+p_slot), pull_list(), delegate_report()
web/tests/db/
  courses.test.ts, slots.test.ts, corrections.test.ts, slot-placement.test.ts, fixtures.ts (+)
web/tests/e2e/
  api.ts (+ seedCourse, seedSession, enroll, seedChair, randomFutureDate)
  chairs.spec.ts, courses.spec.ts, schedule.spec.ts, pull-list.spec.ts, slot-placement.spec.ts,
  delegate-report.spec.ts, corrections.spec.ts
web/src/lib/
  csv.ts (+test)                     toCsv
  schedule/time.ts (+test)           GRID_START/END, SLOT_MINUTES, minutesOfDay, gridPlacement
  schedule/types.ts                  SessionType, Course, Session, Chair, Slot, PullRow, ReportRow
  schedule/schemas.ts (+test)        courseSchema, sessionSchema, chairSchema, slotSchema,
                                     cancelSlotSchema, correctionSchema, voidSchema
  inventory/types.ts                 + slot on ImplantSite, voided fields
  inventory/schemas.ts               placeSchema + slotId
web/src/components/nav-items.ts      + Schedule, Courses
web/src/app/(app)/
  admin/layout.tsx (+Chairs), admin/chairs/{page,chair-row,actions}.tsx|ts
  courses/{page,course-form,actions}.tsx|ts, courses/[id]/{page,session-form,enrollment,actions}.tsx|ts
  schedule/{page,actions}.tsx|ts, schedule/new/{page,slot-form}.tsx, schedule/cancel-booking.tsx,
  schedule/pull-list/{page,print-button}.tsx
  delegates/[id]/page.tsx (+report), delegates/[id]/report.csv/route.ts
  patients/[id]/chart-data.ts, implant-actions.ts, implant-forms.tsx, implant-section.tsx (modified),
  patients/[id]/corrections.tsx
```

---

### Task 1: Courses, enrollments, sessions and chairs (migration 0013)

**Files:**
- Create: `web/supabase/migrations/0013_courses.sql`
- Modify: `web/tests/db/fixtures.ts` (append `makeCourse`, `makeSession`, `enroll`, `makeChair`)
- Test: `web/tests/db/courses.test.ts`

**Interfaces:**
- Produces (SQL): `courses(id, name, start_date, end_date, venue, notes, …)`;
  `enrollments(id, course_id, delegate_id)` unique pair; enum `session_type`;
  `sessions(id, course_id, type, title, date, start_time, end_time, lead_organizer_id, …)` with
  date inside the course; `chairs(id, name unique, active)` admin-writable.
- Produces (fixtures): `makeCourse(c, start = '2030-03-01', end = '2030-03-05'): Promise<string>`,
  `makeSession(c, course, type = 'surgery', date = '2030-03-02'): Promise<string>`,
  `enroll(c, course, delegate)`, `makeChair(c, name?): Promise<string>` (call as admin).

- [ ] **Step 1: Fixtures** — append to `web/tests/db/fixtures.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/courses.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { enroll, makeChair, makeCourse, makeDelegate, makeSession } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('courses and sessions', () => {
  it('organizers create courses, sessions and enrollments', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const delegate = await makeDelegate(c);
      await enroll(c, course, delegate);
      const { rows } = await c.query('select type, created_by from public.sessions where id = $1', [session]);
      expect(rows[0]).toEqual({ type: 'surgery', created_by: users.organizer });
      await refused(c, 'insert into public.enrollments (course_id, delegate_id) values ($1, $2)', [course, delegate], /duplicate key/);
      await c.query('delete from public.enrollments where course_id = $1 and delegate_id = $2', [course, delegate]);
    });
  });

  it('refuses inverted dates and sessions outside the course', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, "insert into public.courses (name, start_date, end_date) values ('Bad', '2030-03-05', '2030-03-01')", [], /courses_dates/);
      const course = await makeCourse(c);
      await expect(makeSession(c, course, 'surgery', '2030-04-01')).rejects.toThrow(/must fall within the course dates/);
    });
  });

  it('courses and sessions cannot be deleted; creator cannot be forged', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      await refused(c, 'delete from public.courses where id = $1', [course], /permission denied/);
      await refused(c, "insert into public.courses (name, start_date, end_date, created_by) values ('X', '2030-01-01', '2030-01-02', $1)", [users.admin], /permission denied/);
    });
  });
});

describe('chairs', () => {
  it('only admins add or change chairs; organizers can see them', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const chair = await makeChair(c, 'Zz Chair A');
      await actAs(c, users.organizer);
      expect((await c.query('select name from public.chairs where id = $1', [chair])).rows).toEqual([{ name: 'Zz Chair A' }]);
      await refused(c, "insert into public.chairs (name) values ('Zz Chair B')", [], /row-level security/);
      const r = await c.query("update public.chairs set name = 'Hacked' where id = $1", [chair]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('inactive users see no courses or chairs', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.courses limit 1')).rows).toHaveLength(0);
      expect((await c.query('select id from public.chairs limit 1')).rows).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- courses` → FAIL (`relation "public.courses" does not exist`).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0013_courses.sql`:

```sql
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  start_date date not null,
  end_date date not null,
  venue text not null default '' check (length(venue) <= 200),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint courses_dates check (end_date >= start_date)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  delegate_id uuid not null references public.delegates (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (course_id, delegate_id)
);

create type public.session_type as enum ('lecture', 'workshop', 'surgery');

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  type public.session_type not null,
  title text not null check (length(trim(title)) between 2 and 120),
  date date not null,
  start_time time not null,
  end_time time not null,
  lead_organizer_id uuid references public.profiles (user_id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint sessions_times check (end_time > start_time)
);
create index sessions_date_idx on public.sessions (date);

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function app_private.check_session_in_course() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id and new.date between c.start_date and c.end_date
  ) then
    perform app_private.fail('The session date must fall within the course dates.');
  end if;
  return new;
end $$;

create trigger sessions_in_course before insert or update on public.sessions
  for each row execute function app_private.check_session_in_course();

create trigger courses_set_updated_at before update on public.courses for each row execute function app_private.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions for each row execute function app_private.set_updated_at();
create trigger chairs_set_updated_at before update on public.chairs for each row execute function app_private.set_updated_at();
create trigger courses_audit after insert or update or delete on public.courses for each row execute function app_private.audit_row('id');
create trigger enrollments_audit after insert or update or delete on public.enrollments for each row execute function app_private.audit_row('id');
create trigger sessions_audit after insert or update or delete on public.sessions for each row execute function app_private.audit_row('id');
create trigger chairs_audit after insert or update or delete on public.chairs for each row execute function app_private.audit_row('id');

revoke all on public.courses, public.enrollments, public.sessions, public.chairs from anon;
revoke insert, update, delete, truncate on public.courses, public.enrollments, public.sessions, public.chairs from authenticated;
grant insert (name, start_date, end_date, venue, notes) on public.courses to authenticated;
grant update (name, start_date, end_date, venue, notes) on public.courses to authenticated;
grant insert (course_id, delegate_id) on public.enrollments to authenticated;
grant delete on public.enrollments to authenticated;
grant insert (course_id, type, title, date, start_time, end_time, lead_organizer_id) on public.sessions to authenticated;
grant update (type, title, date, start_time, end_time, lead_organizer_id) on public.sessions to authenticated;
grant insert (name, active) on public.chairs to authenticated;
grant update (name, active) on public.chairs to authenticated;

alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.sessions enable row level security;
alter table public.chairs enable row level security;

create policy courses_select on public.courses for select to authenticated using (public.is_active_user());
create policy courses_insert on public.courses for insert to authenticated with check (public.is_active_user());
create policy courses_update on public.courses for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy enrollments_select on public.enrollments for select to authenticated using (public.is_active_user());
create policy enrollments_insert on public.enrollments for insert to authenticated with check (public.is_active_user());
create policy enrollments_delete on public.enrollments for delete to authenticated using (public.is_active_user());
create policy sessions_select on public.sessions for select to authenticated using (public.is_active_user());
create policy sessions_insert on public.sessions for insert to authenticated with check (public.is_active_user());
create policy sessions_update on public.sessions for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy chairs_select on public.chairs for select to authenticated using (public.is_active_user());
create policy chairs_insert on public.chairs for insert to authenticated with check (public.is_admin());
create policy chairs_update on public.chairs for update to authenticated using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0013_courses.sql web/tests/db/fixtures.ts web/tests/db/courses.test.ts
git commit -m "feat(db): courses, enrollments, sessions and chairs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Surgery bookings (migration 0014)

**Files:**
- Create: `web/supabase/migrations/0014_surgery_slots.sql`
- Modify: `web/tests/db/fixtures.ts` (append `book`)
- Test: `web/tests/db/slots.test.ts`

**Interfaces:**
- Produces (SQL):
  - enum `slot_status` (scheduled, done, cancelled); tables `surgery_slots(id, session_id, chair_id,
    starts_at, ends_at, patient_id, supervisor_id, status, override_reason, cancel_reason, notes, …)`,
    `slot_delegates(id, slot_id, delegate_id, role 'placing'|'assisting')`,
    `slot_planned_implants(id, slot_id, tooth, product_id, implant_site_id)`; `implant_sites` gains
    `course_id`, `session_id`, `slot_id`.
  - `public.cairo_ts(p_date date, p_time time) returns timestamptz`.
  - `public.slot_conflicts(p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid,
    p_supervisor uuid, p_delegates uuid[], p_exclude uuid = null) returns table (kind text, message text)`.
  - `public.create_surgery_slot(p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid,
    p_supervisor uuid, p_placing uuid[], p_assisting uuid[] = '{}', p_implants jsonb = '[]',
    p_override_reason text = '', p_notes text = '') returns uuid` (`p_implants` = `[{"tooth": 36, "product_id": "…"|null}]`).
  - `public.cancel_surgery_slot(p_slot uuid, p_reason text) returns void`.
  - `public.slots_on(p_date date) returns setof public.surgery_slots` (Cairo day; embeddable from PostgREST).
- Produces (fixture): `book(c, a: { session; chair; patient; supervisor; placing: string[]; assisting?: string[];
  implants?: { tooth: number; product_id?: string | null }[]; start?: string; end?: string; override?: string }): Promise<string>`.

- [ ] **Step 1: Fixture** — append to `web/tests/db/fixtures.ts`:

```ts
export async function book(
  c: Client,
  a: {
    session: string; chair: string; patient: string; supervisor: string; placing: string[];
    assisting?: string[]; implants?: { tooth: number; product_id?: string | null }[];
    start?: string; end?: string; override?: string;
  },
): Promise<string> {
  const { rows } = await c.query(
    `select public.create_surgery_slot(
       p_session => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_patient => $5,
       p_supervisor => $6, p_placing => $7::uuid[], p_assisting => $8::uuid[], p_implants => $9::jsonb,
       p_override_reason => $10) as id`,
    [
      a.session, a.chair, a.start ?? '09:00', a.end ?? '10:00', a.patient, a.supervisor, a.placing,
      a.assisting ?? [], JSON.stringify(a.implants ?? []), a.override ?? '',
    ],
  );
  return rows[0].id;
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/slots.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  const chair2 = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const d1 = await makeDelegate(c, 'Dr One');
  const d2 = await makeDelegate(c, 'Dr Two');
  await enroll(c, course, d1);
  await enroll(c, course, d2);
  const patient = await makePatient(c, 'Slot Patient');
  const product = await makeProduct(c);
  return { chair, chair2, course, session, d1, d2, patient, product, supervisor: users.organizer };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('booking a surgery', () => {
  it('stores times in Cairo, delegates with roles, and plans the implants on the chart', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], assisting: [w.d2], implants: [{ tooth: 36, product_id: w.product }, { tooth: 46 }] });
      const s = await c.query(
        "select to_char(starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as at, status from public.surgery_slots where id = $1",
        [slot],
      );
      expect(s.rows[0]).toEqual({ at: '2030-03-02 09:00', status: 'scheduled' });
      const d = await c.query('select delegate_id, role from public.slot_delegates where slot_id = $1 order by role desc', [slot]);
      expect(d.rows).toEqual([{ delegate_id: w.d1, role: 'placing' }, { delegate_id: w.d2, role: 'assisting' }]);
      const sites = await c.query(
        'select tooth, state, product_id, slot_id, session_id, course_id from public.implant_sites where patient_id = $1 order by tooth',
        [w.patient],
      );
      expect(sites.rows).toEqual([
        { tooth: 36, state: 'planned', product_id: w.product, slot_id: slot, session_id: w.session, course_id: w.course },
        { tooth: 46, state: 'planned', product_id: null, slot_id: slot, session_id: w.session, course_id: w.course },
      ]);
      const teeth = await c.query("select tooth from public.tooth_status where patient_id = $1 and status = 'implant_planned' order by tooth", [w.patient]);
      expect(teeth.rows.map((r) => r.tooth)).toEqual([36, 46]);
    });
  });

  it('links an implant already planned from the chart', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const planned = (await c.query('select public.plan_implant($1, 36::smallint) as id', [w.patient])).rows[0].id;
      const slot = await book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36, product_id: w.product }] });
      const s = await c.query('select slot_id, product_id from public.implant_sites where id = $1', [planned]);
      expect(s.rows[0]).toEqual({ slot_id: slot, product_id: w.product });
    });
  });

  it('refuses bad bookings with specific messages', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const outsider = await makeDelegate(c, 'Dr Outsider');
      const lecture = await makeSession(c, w.course, 'lecture');
      await refused(c, () => book(c, { ...w, session: lecture, placing: [w.d1] }), /only be booked in a surgery session/);
      await refused(c, () => book(c, { ...w, placing: [] }), /at least one placing delegate/);
      await refused(c, () => book(c, { ...w, placing: [outsider] }), /Dr Outsider is not enrolled in this course/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], assisting: [w.d1] }), /both placing and assisting/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], start: '10:00', end: '09:00' }), /end time must be after/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36 }, { tooth: 36 }] }), /Tooth 36 is listed twice/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], implants: [{ tooth: 19 }] }), /19 is not a tooth number/);
    });
  });

  it('clashes are detected per kind', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { ...w, placing: [w.d1] });
      const other = await makePatient(c, 'Other Patient');
      const { rows } = await c.query(
        `select kind from public.slot_conflicts($1, $2, '09:30', '10:30', $3, $4, $5::uuid[]) order by kind`,
        [w.session, w.chair, other, w.supervisor, [w.d1]],
      );
      expect(rows.map((r) => r.kind)).toEqual(['chair', 'delegate', 'supervisor']);
      const none = await c.query(
        `select kind from public.slot_conflicts($1, $2, '10:00', '11:00', $3, $4, $5::uuid[])`,
        [w.session, w.chair, other, w.supervisor, [w.d1]],
      );
      expect(none.rows).toEqual([]);
    });
  });

  it('override needs a reason, which is stored', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { ...w, placing: [w.d1] });
      const other = await makePatient(c, 'Other Patient');
      await refused(c, () => book(c, { ...w, patient: other, chair: w.chair2, placing: [w.d2] }), /clashes with another surgery/);
      const slot = await book(c, { ...w, patient: other, chair: w.chair2, placing: [w.d2], override: 'Supervisor covers both chairs' });
      const s = await c.query('select override_reason from public.surgery_slots where id = $1', [slot]);
      expect(s.rows[0].override_reason).toBe('Supervisor covers both chairs');
    });
  });

  it('cancelling keeps the planned implants (unlinked) and needs a reason', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36 }] });
      await refused(c, () => c.query("select public.cancel_surgery_slot($1, ' ')", [slot]), /Explain why/);
      await c.query("select public.cancel_surgery_slot($1, 'Patient unwell')", [slot]);
      const s = await c.query('select status, cancel_reason from public.surgery_slots where id = $1', [slot]);
      expect(s.rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'Patient unwell' });
      const site = await c.query('select state, slot_id from public.implant_sites where patient_id = $1', [w.patient]);
      expect(site.rows).toEqual([{ state: 'planned', slot_id: null }]);
      const clash = await c.query(
        `select kind from public.slot_conflicts($1, $2, '09:00', '10:00', $3, $4, $5::uuid[])`,
        [w.session, w.chair, w.patient, w.supervisor, [w.d1]],
      );
      expect(clash.rows).toEqual([]);
    });
  });

  it('slots_on returns the Cairo day', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], start: '00:30', end: '01:30' });
      const { rows } = await c.query("select id from public.slots_on('2030-03-02') where id = $1", [slot]);
      expect(rows).toHaveLength(1);
    });
  });

  it('users cannot write booking tables directly', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(
        c,
        () =>
          c.query(
            `insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id)
             values ($1, $2, now(), now() + interval '1 hour', $3, $4)`,
            [w.session, w.chair, w.patient, w.supervisor],
          ),
        /permission denied/,
      );
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- slots` → FAIL (`relation "public.surgery_slots" does not exist` / missing function).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0014_surgery_slots.sql`:

```sql
create type public.slot_status as enum ('scheduled', 'done', 'cancelled');

create table public.surgery_slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  chair_id uuid not null references public.chairs (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  patient_id uuid not null references public.patients (id) on delete cascade,
  supervisor_id uuid not null references public.profiles (user_id),
  status public.slot_status not null default 'scheduled',
  override_reason text not null default '' check (length(override_reason) <= 300),
  cancel_reason text not null default '' check (length(cancel_reason) <= 300),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint surgery_slots_times check (ends_at > starts_at)
);
create index surgery_slots_starts_idx on public.surgery_slots (starts_at);

create table public.slot_delegates (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.surgery_slots (id) on delete cascade,
  delegate_id uuid not null references public.delegates (id),
  role text not null check (role in ('placing', 'assisting')),
  unique (slot_id, delegate_id)
);

create table public.slot_planned_implants (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.surgery_slots (id) on delete cascade,
  tooth public.fdi_tooth not null,
  product_id uuid references public.products (id),
  implant_site_id uuid references public.implant_sites (id) on delete cascade,
  unique (slot_id, tooth)
);

alter table public.implant_sites
  add column course_id uuid references public.courses (id),
  add column session_id uuid references public.sessions (id),
  add column slot_id uuid references public.surgery_slots (id) on delete set null;

create trigger surgery_slots_set_updated_at before update on public.surgery_slots for each row execute function app_private.set_updated_at();
create trigger surgery_slots_audit after insert or update or delete on public.surgery_slots for each row execute function app_private.audit_row('id');
create trigger slot_delegates_audit after insert or update or delete on public.slot_delegates for each row execute function app_private.audit_row('id');
create trigger slot_planned_implants_audit after insert or update or delete on public.slot_planned_implants for each row execute function app_private.audit_row('id');

revoke all on public.surgery_slots, public.slot_delegates, public.slot_planned_implants from anon;
revoke insert, update, delete, truncate on public.surgery_slots, public.slot_delegates, public.slot_planned_implants from authenticated;
alter table public.surgery_slots enable row level security;
alter table public.slot_delegates enable row level security;
alter table public.slot_planned_implants enable row level security;
create policy surgery_slots_select on public.surgery_slots for select to authenticated using (public.is_active_user());
create policy slot_delegates_select on public.slot_delegates for select to authenticated using (public.is_active_user());
create policy slot_planned_implants_select on public.slot_planned_implants for select to authenticated using (public.is_active_user());

create function public.cairo_ts(p_date date, p_time time) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_date + p_time) at time zone 'Africa/Cairo';
$$;

create function public.slot_conflicts(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_delegates uuid[], p_exclude uuid default null
) returns table (kind text, message text)
language sql stable security invoker set search_path = '' as $$
  with me as (
    select public.cairo_ts(s.date, p_start) as s_at, public.cairo_ts(s.date, p_end) as e_at
    from public.sessions s where s.id = p_session
  ),
  other as (
    select o.id, o.chair_id, o.patient_id, o.supervisor_id, c.name as chair_name, p.full_name as patient_name,
           to_char(o.starts_at at time zone 'Africa/Cairo', 'HH24:MI') || '–' ||
           to_char(o.ends_at at time zone 'Africa/Cairo', 'HH24:MI') as span
    from public.surgery_slots o
    cross join me
    join public.chairs c on c.id = o.chair_id
    join public.patients p on p.id = o.patient_id
    where o.status <> 'cancelled'
      and (p_exclude is null or o.id <> p_exclude)
      and tstzrange(o.starts_at, o.ends_at) && tstzrange(me.s_at, me.e_at)
  )
  select 'chair', format('%s is already booked %s (%s).', chair_name, span, patient_name) from other where chair_id = p_chair
  union all
  select 'patient', format('%s already has a surgery %s.', patient_name, span) from other where patient_id = p_patient
  union all
  select 'supervisor', format('%s is already supervising %s (%s).',
           (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.user_id = p_supervisor),
           span, patient_name)
  from other where supervisor_id = p_supervisor
  union all
  select 'delegate', format('%s is already booked %s (%s).', d.full_name, o.span, o.patient_name)
  from other o
  join public.slot_delegates sd on sd.slot_id = o.id
  join public.delegates d on d.id = sd.delegate_id
  where sd.delegate_id = any (p_delegates);
$$;

create function public.create_surgery_slot(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_placing uuid[], p_assisting uuid[] default '{}', p_implants jsonb default '[]',
  p_override_reason text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_slot uuid;
  v_all uuid[] := coalesce(p_placing, '{}') || coalesce(p_assisting, '{}');
  v_missing text;
  v_item jsonb;
  v_tooth int;
  v_product uuid;
  v_site public.implant_sites;
  v_site_id uuid;
  v_seen int[] := '{}';
begin
  perform app_private.require_active();
  select * into v_session from public.sessions where id = p_session;
  if not found then
    perform app_private.fail('Choose a surgery session.');
  end if;
  if v_session.type <> 'surgery' then
    perform app_private.fail('Surgeries can only be booked in a surgery session.');
  end if;
  if not exists (select 1 from public.chairs where id = p_chair and active) then
    perform app_private.fail('Choose an active chair.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The end time must be after the start time.');
  end if;
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if exists (select 1 from public.patients where id = p_patient and archived) then
    perform app_private.fail('This patient is archived. Restore the patient first.');
  end if;
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if coalesce(array_length(p_placing, 1), 0) = 0 then
    perform app_private.fail('Choose at least one placing delegate.');
  end if;
  if exists (select 1 from unnest(p_placing) x where x = any (coalesce(p_assisting, '{}'))) then
    perform app_private.fail('A delegate cannot be both placing and assisting.');
  end if;
  select d.full_name into v_missing
  from unnest(v_all) as x(id)
  left join public.delegates d on d.id = x.id
  where d.id is null or not d.active
     or not exists (select 1 from public.enrollments e where e.course_id = v_session.course_id and e.delegate_id = x.id)
  limit 1;
  if found then
    perform app_private.fail(format('%s is not enrolled in this course.', coalesce(v_missing, 'A delegate')));
  end if;
  if exists (
    select 1 from public.slot_conflicts(p_session, p_chair, p_start, p_end, p_patient, p_supervisor, v_all)
  ) and length(trim(coalesce(p_override_reason, ''))) < 3 then
    perform app_private.fail('This booking clashes with another surgery. Give a reason to book anyway.');
  end if;

  insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id, override_reason, notes)
  values (p_session, p_chair, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_patient, p_supervisor, trim(coalesce(p_override_reason, '')), coalesce(p_notes, ''))
  returning id into v_slot;

  insert into public.slot_delegates (slot_id, delegate_id, role)
  select v_slot, x, 'placing' from unnest(p_placing) x
  union all
  select v_slot, x, 'assisting' from unnest(coalesce(p_assisting, '{}')) x;

  for v_item in select * from jsonb_array_elements(coalesce(p_implants, '[]'::jsonb)) loop
    v_tooth := (v_item ->> 'tooth')::int;
    if v_tooth is null or v_tooth / 10 not between 1 and 4 or v_tooth % 10 not between 1 and 8 then
      perform app_private.fail(format('%s is not a tooth number. Use FDI numbers 11–48.', coalesce(v_item ->> 'tooth', '?')));
    end if;
    if v_tooth = any (v_seen) then
      perform app_private.fail(format('Tooth %s is listed twice.', v_tooth));
    end if;
    v_seen := v_seen || v_tooth;
    v_product := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product is not null and not exists (select 1 from public.products where id = v_product and type = 'implant' and active) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;

    select * into v_site from public.implant_sites
    where patient_id = p_patient and tooth = v_tooth and state not in ('failed', 'removed')
    for update;
    if found and v_site.state <> 'planned' then
      perform app_private.fail(format('Tooth %s already has an implant.', v_tooth));
    end if;
    if found then
      update public.implant_sites
      set slot_id = v_slot, session_id = p_session, course_id = v_session.course_id,
          product_id = coalesce(v_product, product_id)
      where id = v_site.id
      returning id into v_site_id;
    else
      insert into public.implant_sites (patient_id, tooth, state, product_id, course_id, session_id, slot_id)
      values (p_patient, v_tooth, 'planned', v_product, v_session.course_id, p_session, v_slot)
      returning id into v_site_id;
      perform app_private.set_tooth(p_patient, v_tooth::smallint, 'implant_planned');
    end if;
    insert into public.slot_planned_implants (slot_id, tooth, product_id, implant_site_id)
    values (v_slot, v_tooth, v_product, v_site_id);
  end loop;
  return v_slot;
end $$;

create function public.cancel_surgery_slot(p_slot uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform app_private.fail('Explain why the surgery is cancelled (at least 3 characters).');
  end if;
  if not exists (select 1 from public.surgery_slots where id = p_slot and status = 'scheduled') then
    perform app_private.fail('Only scheduled surgeries can be cancelled.');
  end if;
  update public.surgery_slots set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_slot;
  update public.implant_sites set slot_id = null, session_id = null, course_id = null
  where slot_id = p_slot and state = 'planned';
end $$;

create function public.slots_on(p_date date) returns setof public.surgery_slots
language sql stable security invoker set search_path = '' as $$
  select * from public.surgery_slots
  where (starts_at at time zone 'Africa/Cairo')::date = p_date
  order by starts_at;
$$;

revoke execute on function public.cairo_ts(date, time) from public, anon;
revoke execute on function public.slot_conflicts(uuid, uuid, time, time, uuid, uuid, uuid[], uuid) from public, anon;
revoke execute on function public.create_surgery_slot(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text) from public, anon;
revoke execute on function public.cancel_surgery_slot(uuid, text) from public, anon;
revoke execute on function public.slots_on(date) from public, anon;
grant execute on function public.cairo_ts(date, time) to authenticated;
grant execute on function public.slot_conflicts(uuid, uuid, time, time, uuid, uuid, uuid[], uuid) to authenticated;
grant execute on function public.create_surgery_slot(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text) to authenticated;
grant execute on function public.cancel_surgery_slot(uuid, text) to authenticated;
grant execute on function public.slots_on(date) to authenticated;
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0014_surgery_slots.sql web/tests/db/fixtures.ts web/tests/db/slots.test.ts
git commit -m "feat(db): surgery bookings with clash detection, planned implants and cancellation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Corrections (migration 0015)

**Files:**
- Create: `web/supabase/migrations/0015_corrections.sql`
- Test: `web/tests/db/corrections.test.ts`

**Interfaces:**
- Produces (SQL): `site_components` and `implant_followups` gain `voided_at timestamptz`,
  `voided_by uuid → profiles`, `voided_reason text`; functions
  `public.correct_batch(p_site uuid, p_new_lot uuid, p_reason text, p_component uuid = null, p_new_product uuid = null) returns void`,
  `public.void_followup(p_followup uuid, p_reason text) returns void`,
  `public.void_component(p_component uuid, p_reason text) returns void`;
  `public.lot_usage()` no longer lists uses that were reversed.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/corrections.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function placed(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const implant = await makeProduct(c);
  const wrongLot = await receive(c, implant, 2, 'WRONG');
  const rightLot = await receive(c, implant, 2, 'RIGHT');
  const delegate = await makeDelegate(c);
  const site = await place(c, { patient, tooth: 36, product: implant, lot: wrongLot, delegate, supervisor: users.organizer });
  return { patient, implant, wrongLot, rightLot, delegate, site };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('correcting the batch used', () => {
  it('moves the unit back to the old batch and takes it from the right one; recall follows', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await c.query("select public.correct_batch($1, $2, 'Wrong sticker scanned')", [s.site, s.rightLot]);
      expect(await onHand(c, s.wrongLot)).toBe(2);
      expect(await onHand(c, s.rightLot)).toBe(1);
      expect((await c.query('select stock_lot_id from public.implant_sites where id = $1', [s.site])).rows[0].stock_lot_id).toBe(s.rightLot);
      expect((await c.query('select * from public.lot_usage($1)', [s.wrongLot])).rows).toHaveLength(0);
      expect((await c.query('select * from public.lot_usage($1)', [s.rightLot])).rows).toHaveLength(1);
      const rev = await c.query(
        "select delta, note, reverses_movement_id is not null as reverses from public.stock_movements where stock_lot_id = $1 and reason = 'adjust'",
        [s.wrongLot],
      );
      expect(rev.rows).toEqual([{ delta: 1, note: 'Correction: Wrong sticker scanned', reverses: true }]);
    });
  });

  it('can be corrected twice, and refuses bad targets or no reason', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const expired = await receive(c, s.implant, 1, 'OLD', '2020-01-01');
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'x')", [s.site, s.rightLot]), /Explain the correction/);
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'Wrong one')", [s.site, s.wrongLot]), /Choose a different batch/);
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'Wrong one')", [s.site, expired]), /expired on 2020-01-01/);
      await c.query("select public.correct_batch($1, $2, 'First fix')", [s.site, s.rightLot]);
      await c.query("select public.correct_batch($1, $2, 'Back again')", [s.site, s.wrongLot]);
      expect(await onHand(c, s.wrongLot)).toBe(1);
      expect(await onHand(c, s.rightLot)).toBe(2);
    });
  });

  it('corrects a component batch too', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haWrong = await receive(c, ha, 1, 'HA-W');
      const haRight = await receive(c, ha, 1, 'HA-R');
      const comp = (
        await c.query(
          "select public.fit_component(p_site => $1, p_type => 'healing_abutment', p_fitted_on => current_date, p_product => $2, p_lot => $3, p_by_delegate => $4) as id",
          [s.site, ha, haWrong, s.delegate],
        )
      ).rows[0].id;
      await c.query("select public.correct_batch($1, $2, 'Wrong HA batch', $3)", [s.site, haRight, comp]);
      expect(await onHand(c, haWrong)).toBe(1);
      expect(await onHand(c, haRight)).toBe(0);
    });
  });
});

describe('voiding follow-ups', () => {
  it('voiding the failure restores the implant and tooth', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const f = (await c.query("select public.record_followup($1, current_date, '3-month', 'failed') as id", [s.site])).rows[0].id;
      await c.query("select public.void_followup($1, 'Wrong patient clicked')", [f]);
      expect((await c.query('select state from public.implant_sites where id = $1', [s.site])).rows[0].state).toBe('placed');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('implant_placed');
      const v = await c.query('select voided_reason, voided_by from public.implant_followups where id = $1', [f]);
      expect(v.rows[0]).toEqual({ voided_reason: 'Wrong patient clicked', voided_by: users.organizer });
    });
  });

  it('refuses to undo a failure once the tooth was re-planned', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const f = (await c.query("select public.record_followup($1, current_date, '3-month', 'failed') as id", [s.site])).rows[0].id;
      await c.query('select public.plan_implant($1, 36::smallint)', [s.patient]);
      await refused(c, () => c.query("select public.void_followup($1, 'Oops oops')", [f]), /new implant is already recorded/);
    });
  });
});

describe('undoing a component', () => {
  it('returns stock, makes the previous component current, and undoing a crown restores "placed"', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 1, 'HA');
      const fit = async (type: string, product: string | null, lot: string | null) =>
        (
          await c.query(
            'select public.fit_component(p_site => $1, p_type => $2, p_fitted_on => current_date, p_product => $3, p_lot => $4, p_by_delegate => $5) as id',
            [s.site, type, product, lot, s.delegate],
          )
        ).rows[0].id as string;
      const haId = await fit('healing_abutment', ha, haLot);
      const crown = await fit('final_restoration', null, null);
      await refused(c, () => c.query("select public.void_component($1, 'Not current')", [haId]), /Only the current component/);
      await c.query("select public.void_component($1, 'Crown not fitted yet')", [crown]);
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('placed');
      const current = await c.query('select id from public.site_components where site_id = $1 and removed_on is null', [s.site]);
      expect(current.rows).toEqual([{ id: haId }]);
      await c.query("select public.void_component($1, 'HA was never fitted')", [haId]);
      expect(await onHand(c, haLot)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm run test:db -- corrections` → FAIL (missing functions).

- [ ] **Step 3: Migration** — `web/supabase/migrations/0015_corrections.sql`:

```sql
alter table public.site_components
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (user_id),
  add column voided_reason text not null default '' check (length(voided_reason) <= 300);
alter table public.implant_followups
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (user_id),
  add column voided_reason text not null default '' check (length(voided_reason) <= 300);

create function app_private.require_reason(p_reason text, p_what text) returns void
language plpgsql as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform app_private.fail(format('Explain the %s (at least 3 characters).', p_what));
  end if;
end $$;

create function app_private.unreversed_use(p_site uuid, p_component uuid, p_lot uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.stock_movements m
  where m.implant_site_id = p_site and m.reason = 'use'
    and m.site_component_id is not distinct from p_component
    and m.stock_lot_id = p_lot
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by m.created_at desc
  limit 1;
$$;

create function app_private.reverse_use(p_use uuid, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.stock_movements (stock_lot_id, delta, reason, implant_site_id, site_component_id, patient_id, note, reverses_movement_id)
  select m.stock_lot_id, 1, 'adjust', m.implant_site_id, m.site_component_id, m.patient_id, p_note, m.id
  from public.stock_movements m where m.id = p_use;
$$;

create function public.correct_batch(
  p_site uuid, p_new_lot uuid, p_reason text, p_component uuid default null, p_new_product uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_comp public.site_components;
  v_product uuid;
  v_type public.product_type;
  v_old_lot uuid;
  v_use uuid;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'correction');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has a batch to correct.');
  end if;
  if p_component is null then
    v_product := coalesce(p_new_product, v_site.product_id);
    if not exists (select 1 from public.products where id = v_product and type = 'implant' and active) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_old_lot := v_site.stock_lot_id;
  else
    select * into v_comp from public.site_components where id = p_component and site_id = p_site and voided_at is null;
    if not found then
      perform app_private.fail('Component not found.');
    end if;
    if v_comp.stock_lot_id is null then
      perform app_private.fail('This component was not taken from stock.');
    end if;
    v_product := coalesce(p_new_product, v_comp.product_id);
    select type into v_type from public.products where id = v_product and active;
    if not found or not app_private.component_accepts(v_comp.component_type, v_type) then
      perform app_private.fail(format('That product is not a %s.', replace(v_comp.component_type::text, '_', ' ')));
    end if;
    v_old_lot := v_comp.stock_lot_id;
  end if;
  if p_new_lot = v_old_lot then
    perform app_private.fail('Choose a different batch.');
  end if;
  v_use := app_private.unreversed_use(p_site, p_component, v_old_lot);
  if v_use is null then
    perform app_private.fail('The original stock entry was not found.');
  end if;

  perform app_private.lock_lot(p_new_lot, v_product);
  perform app_private.reverse_use(v_use, 'Correction: ' || trim(p_reason));
  perform app_private.insert_use(p_new_lot, v_site.patient_id, p_site, p_component);
  if p_component is null then
    update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product where id = p_site;
  else
    update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
  end if;
end $$;

create function public.void_followup(p_followup uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.implant_followups;
  v_site public.implant_sites;
  v_state public.site_state;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'reason for removing this follow-up');
  select * into v_f from public.implant_followups where id = p_followup and voided_at is null;
  if not found then
    perform app_private.fail('Follow-up not found.');
  end if;
  select * into v_site from public.implant_sites where id = v_f.site_id for update;
  update public.implant_followups
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_followup;

  if v_f.outcome = 'failed' and v_site.state = 'failed'
     and not exists (select 1 from public.implant_followups where site_id = v_site.id and outcome = 'failed' and voided_at is null) then
    if exists (
      select 1 from public.implant_sites
      where patient_id = v_site.patient_id and tooth = v_site.tooth and state not in ('failed', 'removed')
    ) then
      perform app_private.fail('A new implant is already recorded on this tooth, so the failure cannot be undone.');
    end if;
    v_state := case when exists (
      select 1 from public.site_components
      where site_id = v_site.id and removed_on is null and voided_at is null and component_type = 'final_restoration'
    ) then 'restored' else 'placed' end;
    update public.implant_sites set state = v_state where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
      case when v_state = 'restored' then 'restored' else 'implant_placed' end::public.tooth_state);
  end if;
end $$;

create function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
  v_prev uuid;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null or v_c.removed_on is not null then
    perform app_private.fail('Only the current component can be undone.');
  end if;
  select * into v_site from public.implant_sites where id = v_c.site_id for update;
  if v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be changed on a placed implant.');
  end if;
  if v_c.stock_lot_id is not null then
    v_use := app_private.unreversed_use(v_site.id, p_component, v_c.stock_lot_id);
    if v_use is not null then
      perform app_private.reverse_use(v_use, 'Undone: ' || trim(p_reason));
    end if;
  end if;
  update public.site_components
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason), removed_on = fitted_on
  where id = p_component;
  select id into v_prev from public.site_components
  where site_id = v_site.id and id <> p_component and voided_at is null
  order by fitted_on desc, created_at desc
  limit 1;
  if v_prev is not null then
    update public.site_components set removed_on = null where id = v_prev;
  end if;
  if v_c.component_type = 'final_restoration' and v_site.state = 'restored' then
    update public.implant_sites set state = 'placed' where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'implant_placed');
  end if;
end $$;

create or replace function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         d.full_name, coalesce(nullif(pr.full_name, ''), pr.email)
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.profiles pr on pr.user_id = s.supervisor_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by 2 desc, p.full_name;
$$;

revoke execute on function public.correct_batch(uuid, uuid, text, uuid, uuid) from public, anon;
revoke execute on function public.void_followup(uuid, text) from public, anon;
revoke execute on function public.void_component(uuid, text) from public, anon;
grant execute on function public.correct_batch(uuid, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.void_followup(uuid, text) to authenticated;
grant execute on function public.void_component(uuid, text) to authenticated;
```

Note: `fit_component` (0012) closes "the current component" with
`where site_id = … and removed_on is null`; voided components always have `removed_on` set, so
they are never "current".

- [ ] **Step 4: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0015_corrections.sql web/tests/db/corrections.test.ts
git commit -m "feat(db): corrections for batches, follow-ups and components via reversing entries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Placement from a booking, pull list and delegate report (migration 0016)

**Files:**
- Create: `web/supabase/migrations/0016_slot_placement.sql`
- Modify: `web/tests/db/fixtures.ts` (`place` gains optional `slot`)
- Test: `web/tests/db/slot-placement.test.ts`

**Interfaces:**
- Produces (SQL):
  - `public.place_implant(... same 11 params ..., p_slot uuid = null)` (old 11-argument version dropped);
  - `public.pull_list(p_date date) returns table (product_id uuid, type product_type, brand text, system text,
    platform text, diameter_mm numeric, length_mm numeric, description text, needed int, available int)`
    (a `null` product row = implants not chosen yet);
  - `public.delegate_report(p_delegate uuid) returns table (site_id uuid, role text, course_id uuid,
    course_name text, patient_id uuid, patient_name text, file_no text, tooth smallint, state site_state,
    placed_on date, product_id uuid, type product_type, brand text, system text, platform text,
    diameter_mm numeric, length_mm numeric, description text, lot_no text, last_outcome followup_outcome)`.
- Modifies (fixture): `place(c, { …, slot?: string })`.

- [ ] **Step 1: Fixture** — in `web/tests/db/fixtures.ts`, change `place`'s parameter type to add
  `slot?: string`, change the SQL to add `, p_slot => $9` before `) as id`, and append
  `a.slot ?? null` to the params array.

- [ ] **Step 2: Write the failing tests** — `web/tests/db/slot-placement.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function booked(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const delegate = await makeDelegate(c, 'Dr Report');
  await enroll(c, course, delegate);
  const patient = await makePatient(c, 'Booked Patient');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 5, 'PL-1', '2031-01-01');
  const slot = await book(c, {
    session, chair, patient, supervisor: users.organizer, placing: [delegate],
    implants: [{ tooth: 36, product_id: product }, { tooth: 46, product_id: product }, { tooth: 11 }],
  });
  return { course, session, delegate, patient, product, lot, slot };
}

describe('placing from a booking', () => {
  it('records course, session and booking; the booking is done when nothing is left planned', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const args = { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, slot: b.slot };
      const site = await place(c, { ...args, tooth: 36 });
      const s = await c.query('select course_id, session_id, slot_id from public.implant_sites where id = $1', [site]);
      expect(s.rows[0]).toEqual({ course_id: b.course, session_id: b.session, slot_id: b.slot });
      await place(c, { ...args, tooth: 46 });
      expect((await c.query('select status from public.surgery_slots where id = $1', [b.slot])).rows[0].status).toBe('scheduled');
      await place(c, { ...args, tooth: 11 });
      expect((await c.query('select status from public.surgery_slots where id = $1', [b.slot])).rows[0].status).toBe('done');
    });
  });

  it('a planned implant linked to a booking keeps the link when placed from the chart', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const site = await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36 });
      const s = await c.query('select slot_id, course_id from public.implant_sites where id = $1', [site]);
      expect(s.rows[0]).toEqual({ slot_id: b.slot, course_id: b.course });
    });
  });

  it('refuses a booking of another patient', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const other = await makePatient(c, 'Other');
      await expect(
        place(c, { patient: other, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36, slot: b.slot }),
      ).rejects.toThrow(/booking is for another patient/);
    });
  });

  it('a tooth with a placed implant cannot be booked', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36 });
      await actAs(c, users.admin);
      const chair2 = await makeChair(c);
      await actAs(c, users.organizer);
      await expect(
        book(c, { session: b.session, chair: chair2, patient: b.patient, supervisor: users.organizer, placing: [b.delegate], implants: [{ tooth: 36 }], start: '14:00', end: '15:00' }),
      ).rejects.toThrow(/Tooth 36 already has an implant/);
    });
  });
});

describe('pull list', () => {
  it('sums still-planned implants per product for the Cairo day against usable stock', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const { rows } = await c.query("select product_id, needed, available from public.pull_list('2030-03-02') order by product_id nulls last");
      expect(rows).toEqual([
        { product_id: b.product, needed: 2, available: 5 },
        { product_id: null, needed: 1, available: 0 },
      ]);
      await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36 });
      const after = await c.query("select needed, available from public.pull_list('2030-03-02') where product_id = $1", [b.product]);
      expect(after.rows).toEqual([{ needed: 1, available: 4 }]);
    });
  });
});

describe('delegate report', () => {
  it('lists placed and assisted implants with course and last outcome', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const assistant = await makeDelegate(c, 'Dr Assistant');
      const site = await place(c, {
        patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer,
        tooth: 36, slot: b.slot, assistant,
      });
      await c.query("select public.record_followup($1, current_date, '2-week', 'ok')", [site]);
      const mine = await c.query('select role, course_name, tooth, state, lot_no, last_outcome from public.delegate_report($1)', [b.delegate]);
      expect(mine.rows).toEqual([{ role: 'placing', course_name: 'Test Course', tooth: 36, state: 'placed', lot_no: 'PL-1', last_outcome: 'ok' }]);
      const theirs = await c.query('select role from public.delegate_report($1)', [assistant]);
      expect(theirs.rows).toEqual([{ role: 'assisting' }]);
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- slot-placement` → FAIL
  (`function public.place_implant(... p_slot ...) does not exist`).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0016_slot_placement.sql`:

```sql
drop function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text);

create function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_slot public.surgery_slots;
  v_slot_id uuid;
  v_course uuid;
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > current_date + 1 then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if p_placing_delegate is null or not exists (select 1 from public.delegates where id = p_placing_delegate and active) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;
  if p_slot is not null then
    select * into v_slot from public.surgery_slots where id = p_slot;
    if not found or v_slot.status = 'cancelled' then
      perform app_private.fail('That surgery booking was not found or is cancelled.');
    end if;
    if v_slot.patient_id <> p_patient then
      perform app_private.fail('That surgery booking is for another patient.');
    end if;
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  v_slot_id := coalesce(p_slot, v_site.slot_id);
  if v_slot_id is not null and v_slot.id is null then
    select * into v_slot from public.surgery_slots where id = v_slot_id;
  end if;
  if v_slot.id is not null then
    select course_id into v_course from public.sessions where id = v_slot.session_id;
  end if;

  perform app_private.lock_lot(p_lot, p_product);

  if v_site.id is not null then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes),
        slot_id = coalesce(v_slot.id, slot_id), session_id = coalesce(v_slot.session_id, session_id),
        course_id = coalesce(v_course, course_id)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes, slot_id, session_id, course_id
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, ''),
      v_slot.id, v_slot.session_id, v_course
    ) returning id into v_id;
  end if;

  perform app_private.insert_use(p_lot, p_patient, v_id, null);
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');

  if v_slot.id is not null then
    update public.surgery_slots set status = 'done'
    where id = v_slot.id and status = 'scheduled'
      and not exists (
        select 1 from public.slot_planned_implants spi
        join public.implant_sites s on s.id = spi.implant_site_id
        where spi.slot_id = v_slot.id and s.state = 'planned'
      );
  end if;
  return v_id;
end $$;

create function public.pull_list(p_date date)
returns table (
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text, needed int, available int
)
language sql stable security invoker set search_path = '' as $$
  with need as (
    select site.product_id, count(*)::int as needed
    from public.surgery_slots s
    join public.slot_planned_implants spi on spi.slot_id = s.id
    join public.implant_sites site on site.id = spi.implant_site_id
    where s.status <> 'cancelled'
      and (s.starts_at at time zone 'Africa/Cairo')::date = p_date
      and site.state = 'planned'
    group by site.product_id
  ),
  have as (
    select h.product_id, sum(h.on_hand)::int as available
    from public.stock_on_hand h
    where h.on_hand > 0 and (h.expiry is null or h.expiry >= p_date)
    group by h.product_id
  )
  select n.product_id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.description,
         n.needed, coalesce(h.available, 0)
  from need n
  left join public.products p on p.id = n.product_id
  left join have h on h.product_id = n.product_id
  order by p.brand nulls last, p.system, p.diameter_mm, p.length_mm;
$$;

create function public.delegate_report(p_delegate uuid)
returns table (
  site_id uuid, role text, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text,
  tooth smallint, state public.site_state, placed_on date, product_id uuid, type public.product_type,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text,
  lot_no text, last_outcome public.followup_outcome
)
language sql stable security invoker set search_path = '' as $$
  select s.id,
         case when s.placing_delegate_id = p_delegate then 'placing' else 'assisting' end,
         c.id, c.name, p.id, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.id, pr.type, pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null
          order by f.date desc, f.created_at desc limit 1)
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = p_delegate or s.assisting_delegate_id = p_delegate)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
$$;

revoke execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid) from public, anon;
revoke execute on function public.pull_list(date) from public, anon;
revoke execute on function public.delegate_report(uuid) from public, anon;
grant execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.pull_list(date) to authenticated;
grant execute on function public.delegate_report(uuid) to authenticated;
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS (Plan 3's placement tests still pass:
  `p_slot` defaults to null).

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0016_slot_placement.sql web/tests/db/fixtures.ts web/tests/db/slot-placement.test.ts
git commit -m "feat(db): placement from bookings, daily pull list and delegate report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Scheduling domain logic (TypeScript)

**Files:**
- Create: `web/src/lib/csv.ts`, `web/src/lib/schedule/{time,types,schemas}.ts`
- Modify: `web/src/lib/inventory/types.ts` (slot + voided fields), `web/src/lib/inventory/schemas.ts` (`placeSchema.slotId`)
- Test: `web/src/lib/csv.test.ts`, `web/src/lib/schedule/{time,schemas}.test.ts`

**Interfaces:**
- Produces:
  - `toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string` (UTF-8 BOM, CRLF,
    quoting, formula-injection guard) — `@/lib/csv`.
  - `GRID_START = 7 * 60`, `GRID_END = 20 * 60`, `SLOT_MINUTES = 15`, `minutesOfDay(hhmm)`,
    `gridPlacement(startHHMM, endHHMM): { row: number; span: number }`, `timeLabels(): string[]` — `@/lib/schedule/time`.
  - `SESSION_TYPES`, `SessionType`, `SESSION_TYPE_LABELS`, `Course`, `Session`, `Chair`, `SlotRow`,
    `PullRow`, `ReportRow` — `@/lib/schedule/types`.
  - `courseSchema`, `sessionSchema`, `chairSchema`, `slotSchema`, `cancelSlotSchema`,
    `correctionSchema`, `voidSchema` — `@/lib/schedule/schemas`.
  - `ImplantSite.slot`, `SiteComponent.voided_at/voided_reason`, `Followup.voided_at/voided_reason`;
    `placeSchema.slotId` (optional uuid).

- [ ] **Step 1: Write the failing tests**

`web/src/lib/csv.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and quotes only when needed', () => {
    expect(toCsv(['Name', 'Tooth'], [['Amira', 36], ['Omar', null]])).toBe('﻿Name,Tooth\r\nAmira,36\r\nOmar,\r\n');
  });
  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['A'], [['Hassan, Ali'], ['Say "hi"'], ['two\nlines']])).toBe(
      '﻿A\r\n"Hassan, Ali"\r\n"Say ""hi"""\r\n"two\nlines"\r\n',
    );
  });
  it('neutralizes spreadsheet formulas', () => {
    expect(toCsv(['A'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@cmd']])).toBe(
      '﻿A\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@cmd\r\n',
    );
  });
});
```

`web/src/lib/schedule/time.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GRID_END, GRID_START, SLOT_MINUTES, gridPlacement, minutesOfDay, timeLabels } from './time';

describe('schedule grid', () => {
  it('converts clock times', () => {
    expect(minutesOfDay('07:00')).toBe(420);
    expect(minutesOfDay('13:45')).toBe(825);
  });
  it('places bookings on 15-minute rows (row 1 = 07:00)', () => {
    expect(gridPlacement('07:00', '08:00')).toEqual({ row: 1, span: 4 });
    expect(gridPlacement('09:15', '10:00')).toEqual({ row: 10, span: 3 });
    expect(gridPlacement('09:10', '09:20')).toEqual({ row: 9, span: 2 });
  });
  it('clamps bookings outside the grid', () => {
    expect(gridPlacement('05:00', '07:30')).toEqual({ row: 1, span: 2 });
    expect(gridPlacement('19:30', '22:00')).toEqual({ row: 51, span: 2 });
  });
  it('labels each hour', () => {
    const labels = timeLabels();
    expect(labels).toHaveLength((GRID_END - GRID_START) / SLOT_MINUTES);
    expect(labels[0]).toBe('07:00');
    expect(labels[1]).toBe('');
    expect(labels[4]).toBe('08:00');
  });
});
```

`web/src/lib/schedule/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cancelSlotSchema, correctionSchema, courseSchema, sessionSchema, slotSchema } from './schemas';

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('course and session schemas', () => {
  it('validates course dates', () => {
    expect(courseSchema.parse({ name: ' Implant Course 12 ', start_date: '2030-03-01', end_date: '2030-03-05' })).toMatchObject({
      name: 'Implant Course 12', venue: '',
    });
    expect(err(courseSchema.safeParse({ name: 'X Y', start_date: '2030-03-05', end_date: '2030-03-01' }))).toBe(
      'The course must end on or after its start date.',
    );
  });
  it('validates session times', () => {
    const s = { course_id: id, type: 'surgery', title: 'Day 1 surgery', date: '2030-03-02', start_time: '08:00', end_time: '17:00' };
    expect(sessionSchema.parse(s)).toMatchObject({ lead_organizer_id: null });
    expect(err(sessionSchema.safeParse({ ...s, end_time: '07:00' }))).toBe('The session must end after it starts.');
  });
});

describe('slotSchema', () => {
  const slot = {
    sessionId: id, chairId: id, start: '09:00', end: '10:30', patientFileNo: ' P00012 ', supervisorId: id,
    placing: [id], assisting: [], implants: [{ tooth: '36', productId: '' }], overrideReason: '', notes: '',
  };
  it('normalizes the booking', () => {
    expect(slotSchema.parse(slot)).toMatchObject({ patientFileNo: 'P00012', implants: [{ tooth: 36, productId: null }] });
  });
  it('explains what is missing', () => {
    expect(err(slotSchema.safeParse({ ...slot, end: '08:00' }))).toBe('The end time must be after the start time.');
    expect(err(slotSchema.safeParse({ ...slot, placing: [] }))).toBe('Choose at least one placing delegate.');
    expect(err(slotSchema.safeParse({ ...slot, patientFileNo: '' }))).toBe('Choose the patient.');
    expect(err(slotSchema.safeParse({ ...slot, implants: [{ tooth: '19', productId: '' }] }))).toBe('Unknown tooth number.');
  });
});

describe('reasons', () => {
  it('require at least 3 characters', () => {
    expect(err(cancelSlotSchema.safeParse({ slotId: id, reason: 'no' }))).toBe('Explain why (at least 3 characters).');
    expect(err(correctionSchema.safeParse({ siteId: id, patientId: id, newLotId: id, reason: ' ' }))).toBe(
      'Explain the correction (at least 3 characters).',
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (unresolved imports).

- [ ] **Step 3: Implement**

`web/src/lib/csv.ts`:
```ts
type Cell = string | number | null | undefined;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Prevent spreadsheet formula execution (CSV injection).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for Excel: UTF-8 BOM (Arabic names display correctly), CRLF line endings. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
```

`web/src/lib/schedule/time.ts`:
```ts
export const GRID_START = 7 * 60;
export const GRID_END = 20 * 60;
export const SLOT_MINUTES = 15;
const ROWS = (GRID_END - GRID_START) / SLOT_MINUTES;

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 1-based CSS grid row and span for a booking; partial quarters round outward; clamped to the grid. */
export function gridPlacement(start: string, end: string): { row: number; span: number } {
  const s = Math.max(GRID_START, Math.min(GRID_END - SLOT_MINUTES, minutesOfDay(start)));
  const e = Math.min(GRID_END, Math.max(s + SLOT_MINUTES, minutesOfDay(end)));
  const first = Math.floor((s - GRID_START) / SLOT_MINUTES);
  const lastExclusive = Math.ceil((e - GRID_START) / SLOT_MINUTES);
  return { row: first + 1, span: Math.max(1, Math.min(ROWS, lastExclusive) - first) };
}

export function timeLabels(): string[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const m = GRID_START + i * SLOT_MINUTES;
    return m % 60 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : '';
  });
}
```

A booking that straddles two quarters (09:10–09:20) occupies both rows (span 2).

`web/src/lib/schedule/types.ts`:
```ts
import type { Product } from '@/lib/inventory/types';

export const SESSION_TYPES = ['lecture', 'workshop', 'surgery'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_TYPE_LABELS: Record<SessionType, string> = { lecture: 'Lecture', workshop: 'Workshop', surgery: 'Surgery' };

export type Course = { id: string; name: string; start_date: string; end_date: string; venue: string; notes: string };
export type Session = {
  id: string; course_id: string; type: SessionType; title: string; date: string;
  start_time: string; end_time: string; lead_organizer_id: string | null;
};
export type Chair = { id: string; name: string; active: boolean };

export type SlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'done' | 'cancelled';
  override_reason: string;
  cancel_reason: string;
  chair_id: string;
  patient: { id: string; full_name: string; file_no: string } | null;
  supervisor: { full_name: string; email: string } | null;
  session: { title: string; course: { name: string } | null } | null;
  delegates: { role: 'placing' | 'assisting'; delegate: { full_name: string } | null }[];
  implants: { tooth: number; product: Product | null }[];
};

export type PullRow = Pick<Product, 'type' | 'brand' | 'system' | 'platform' | 'diameter_mm' | 'length_mm' | 'description'> & {
  product_id: string | null;
  needed: number;
  available: number;
};

export type ReportRow = {
  site_id: string; role: 'placing' | 'assisting'; course_id: string | null; course_name: string | null;
  patient_id: string; patient_name: string; file_no: string; tooth: number; state: string; placed_on: string | null;
  product_id: string | null; type: Product['type'] | null; brand: string | null; system: string | null; platform: string | null;
  diameter_mm: number | null; length_mm: number | null; description: string | null; lot_no: string | null;
  last_outcome: string | null;
};
```

`web/src/lib/schedule/schemas.ts`:
```ts
import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { SESSION_TYPES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const date = (message: string) => z.string().refine(isRealDate, { message });
const time = (message: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message });
const reason = (message: string) => z.string().trim().min(3, { message }).max(300);

export const courseSchema = z
  .object({
    name: z.string().trim().min(2, { message: 'Enter the course name (at least 2 characters).' }).max(120),
    start_date: date('Enter the start date.'),
    end_date: date('Enter the end date.'),
    venue: text(200),
    notes: text(1000),
  })
  .refine((c) => c.end_date >= c.start_date, { message: 'The course must end on or after its start date.' });

export const sessionSchema = z
  .object({
    course_id: requiredId('Course not found.'),
    type: z.enum(SESSION_TYPES, { message: 'Choose the session type.' }),
    title: z.string().trim().min(2, { message: 'Enter the session title.' }).max(120),
    date: date('Enter the session date.'),
    start_time: time('Enter the start time (HH:MM).'),
    end_time: time('Enter the end time (HH:MM).'),
    lead_organizer_id: optionalId,
  })
  .refine((s) => s.end_time > s.start_time, { message: 'The session must end after it starts.' });

export const chairSchema = z.object({ name: z.string().trim().min(1, { message: 'Enter the chair name.' }).max(40) });

export const slotSchema = z
  .object({
    sessionId: requiredId('Choose a surgery session.'),
    chairId: requiredId('Choose a chair.'),
    start: time('Enter the start time (HH:MM).'),
    end: time('Enter the end time (HH:MM).'),
    patientFileNo: z.string().trim().min(1, { message: 'Choose the patient.' }),
    supervisorId: requiredId('Choose the supervising organizer.'),
    placing: z.array(z.string().uuid()).min(1, { message: 'Choose at least one placing delegate.' }),
    assisting: z.array(z.string().uuid()).default([]),
    implants: z
      .array(
        z.object({
          tooth: z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }),
          productId: optionalId,
        }),
      )
      .default([]),
    overrideReason: text(300),
    notes: text(1000),
  })
  .refine((s) => s.end > s.start, { message: 'The end time must be after the start time.' });

export const cancelSlotSchema = z.object({
  slotId: requiredId('Booking not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});

export const correctionSchema = z.object({
  siteId: requiredId('Implant not found.'),
  patientId: requiredId('Patient not found.'),
  componentId: optionalId,
  newProductId: optionalId,
  newLotId: requiredId('Choose the correct batch.'),
  reason: reason('Explain the correction (at least 3 characters).'),
});

export const voidSchema = z.object({
  id: requiredId('Record not found.'),
  patientId: requiredId('Patient not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});
```

In `web/src/lib/inventory/types.ts`:
- add to `SiteComponent`: `voided_at: string | null; voided_reason: string;`
- add to `Followup`: `voided_at: string | null; voided_reason: string;`
- add to `ImplantSite`:
  `slot: { id: string; starts_at: string; supervisor_id: string; chair: { name: string } | null; delegates: { delegate_id: string; role: 'placing' | 'assisting' }[] } | null;`

In `web/src/lib/inventory/schemas.ts` add to `placeSchema`: `slotId: optionalId,`.

In `web/src/lib/inventory/components.test.ts` add the new fields to the test factories
(`voided_at: null, voided_reason: ''` in `comp`, `slot: null` in `site`) so they type-check.

- [ ] **Step 4: Run unit tests** — `npm test` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "feat(schedule): CSV export, schedule grid and validation for courses, bookings and corrections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin — chairs

**Files:**
- Create: `web/src/app/(app)/admin/chairs/{page,chair-row,actions}.tsx|ts`, `web/tests/e2e/chairs.spec.ts`
- Modify: `web/src/app/(app)/admin/layout.tsx` (+ Chairs link), `web/tests/e2e/api.ts` (seed helpers)

**Interfaces:**
- Produces: actions `addChair(prev, fd)`, `updateChair(prev, fd)`; E2E helpers
  `seedChair(adminApi, name)`, `seedCourse(api, { name, start, end })`, `seedSession(api, { courseId, type, title, date })`,
  `enroll(api, courseId, delegateId)`, `randomFutureDate(): string` (a random day in 2031–2035).

- [ ] **Step 1: E2E helpers** — append to `web/tests/e2e/api.ts`:

```ts
export function randomFutureDate(): string {
  const day = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 365 * 4) * 86400000);
  return day.toISOString().slice(0, 10);
}

export async function seedChair(adminApi: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await adminApi.from('chairs').insert({ name }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function seedCourse(api: SupabaseClient, c: { name: string; start: string; end: string }): Promise<string> {
  const { data, error } = await api.from('courses').insert({ name: c.name, start_date: c.start, end_date: c.end }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function seedSession(
  api: SupabaseClient,
  s: { courseId: string; type: string; title: string; date: string; start?: string; end?: string },
): Promise<string> {
  const { data, error } = await api
    .from('sessions')
    .insert({ course_id: s.courseId, type: s.type, title: s.title, date: s.date, start_time: s.start ?? '08:00', end_time: s.end ?? '17:00' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function enroll(api: SupabaseClient, courseId: string, delegateId: string): Promise<void> {
  const { error } = await api.from('enrollments').insert({ course_id: courseId, delegate_id: delegateId });
  if (error) throw error;
}
```

and in `deactivateE2eCatalog` (`web/tests/e2e/patients.ts`) add:
```ts
    await pg.query('update public.chairs set active = false where name like $1 and active', [`${E2E_PREFIX}%`]);
```

- [ ] **Step 2: Write the failing E2E test** — `web/tests/e2e/chairs.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a chair', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/chairs');
  const name = uniqueName('Chair');
  await page.getByLabel('New chair').fill(name);
  await page.getByRole('button', { name: 'Add chair' }).click();
  const row = page.getByTestId(`chair-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`chair-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open chair settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/chairs');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
```

Run: `npm run test:e2e -- chairs.spec.ts` → FAIL (404).

- [ ] **Step 3: Implement**

In `web/src/app/(app)/admin/layout.tsx` add after the Settings link:
```tsx
        <Link href="/admin/chairs" className="hover:underline">Chairs</Link>
```

`web/src/app/(app)/admin/chairs/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { chairSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

function chairError(error: { code?: string; message: string; hint?: string | null }): string {
  return error.code === '23505' ? 'A chair with this name already exists.' : userMessage(error)!;
}

export async function addChair(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = chairSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('chairs').insert({ name: parsed.data.name });
  if (error) return failed(chairError(error), formData);
  revalidatePath('/admin/chairs');
  return { ok: 'Chair added.' };
}

export async function updateChair(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = chairSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chairs')
    .update({ name: parsed.data.name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? chairError(error) : 'Chair not found.', formData);
  revalidatePath('/admin/chairs');
  return { ok: 'Saved.' };
}
```

`web/src/app/(app)/admin/chairs/chair-row.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { Chair } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addChair, updateChair } from './actions';

export function ChairRow({ chair }: { chair: Chair }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateChair, {});
  return (
    <li data-testid={`chair-row-${chair.name}`} className="border-t border-gray-200 py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={chair.id} readOnly />
        <input className="input max-w-xs" name="name" aria-label="Name" defaultValue={chair.name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={chair.active} />
          Active
        </label>
        <span className="text-sm text-gray-600">{chair.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddChair() {
  const [state, action, pending] = useActionState<FormState, FormData>(addChair, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New chair</span>
        <input className="input" name="name" placeholder="e.g. Chair 3" />
      </label>
      <button className="btn" disabled={pending}>
        Add chair
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
```

`web/src/app/(app)/admin/chairs/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import type { Chair } from '@/lib/schedule/types';
import { AddChair, ChairRow } from './chair-row';

export default async function ChairsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('chairs').select('id, name, active').order('name');
  if (error) throw new Error('Could not load chairs');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Chairs</h1>
      <AddChair />
      <ul className="card">
        {((data ?? []) as Chair[]).map((chair) => (
          <ChairRow key={chair.id} chair={chair} />
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npm run test:e2e -- chairs.spec.ts admin.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(admin): manage surgery chairs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Courses — list, course page, sessions and enrollments

**Files:**
- Create: `web/src/app/(app)/courses/{page,course-form,actions}.tsx|ts`,
  `web/src/app/(app)/courses/[id]/{page,session-form,enrollment}.tsx`, `web/tests/e2e/courses.spec.ts`
- Modify: `web/src/components/nav-items.ts` (+ test)

**Interfaces:**
- Produces: actions `createCourse`, `updateCourse`, `addSession`, `enrollDelegate`, `unenrollDelegate`;
  nav order `Dashboard, Patients, Schedule, Courses, Inventory, Delegates, Admin`.

- [ ] **Step 1: Nav (test first)** — update `nav-items.test.ts` expectations to
  `['Dashboard', 'Patients', 'Schedule', 'Courses', 'Inventory', 'Delegates', 'Admin']` (admin) and the same without
  `'Admin'` (organizer). Run → FAIL. In `nav-items.ts` insert after Patients:
```ts
  { href: '/schedule', label: 'Schedule' },
  { href: '/courses', label: 'Courses' },
```
Run → PASS.

- [ ] **Step 2: Write the failing E2E test** — `web/tests/e2e/courses.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, randomFutureDate, seedDelegate } from './api';

test('creates a course, adds a surgery session and enrolls a delegate', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const delegate = uniqueName('Dr Enrol');
  await seedDelegate(api, delegate);
  const day = randomFutureDate();
  const name = uniqueName('Course');

  await login(page, TEST_USERS.organizer.email);
  await page.getByRole('link', { name: 'Courses' }).click();
  await page.getByLabel('Course name').fill(name);
  await page.getByLabel('Start date').fill(day);
  await page.getByLabel('End date').fill(day);
  await page.getByLabel('Venue').fill('Cairo Training Centre');
  await page.getByRole('button', { name: 'Create course' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.getByLabel('Session title').fill('Live surgery day');
  await page.getByLabel('Session type').selectOption('surgery');
  await page.getByLabel('Session date').fill(day);
  await page.getByLabel('Starts').fill('08:00');
  await page.getByLabel('Ends').fill('16:00');
  await page.getByRole('button', { name: 'Add session' }).click();
  await expect(page.getByTestId('session-row')).toContainText('Live surgery day');
  await expect(page.getByTestId('session-row')).toContainText('Surgery');

  await page.getByLabel('Delegate to enrol').selectOption({ label: delegate });
  await page.getByRole('button', { name: 'Enrol' }).click();
  const enrolled = page.getByTestId(`enrolled-${delegate}`);
  await expect(enrolled).toBeVisible();
  await enrolled.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId(`enrolled-${delegate}`)).toHaveCount(0);
});

test('a session outside the course dates is refused', async ({ page }) => {
  const day = randomFutureDate();
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/courses');
  await page.getByLabel('Course name').fill(uniqueName('Short'));
  await page.getByLabel('Start date').fill(day);
  await page.getByLabel('End date').fill(day);
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByLabel('Session title').fill('Too late');
  await page.getByLabel('Session date').fill('2036-01-01');
  await page.getByLabel('Starts').fill('08:00');
  await page.getByLabel('Ends').fill('09:00');
  await page.getByRole('button', { name: 'Add session' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('The session date must fall within the course dates.');
});
```

Run: `npm run test:e2e -- courses.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

`web/src/app/(app)/courses/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { courseSchema, sessionSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createCourse(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').insert(parsed.data).select('id').single();
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/courses/${data.id}`);
}

export async function updateCourse(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').update(parsed.data).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Course not found.', formData);
  revalidatePath(`/courses/${id}`);
  return { ok: 'Course saved.' };
}

export async function addSession(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = sessionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('sessions').insert(parsed.data);
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/courses/${parsed.data.course_id}`);
  return { ok: 'Session added.' };
}

export async function enrollDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const courseId = String(formData.get('course_id') ?? '');
  const delegateId = String(formData.get('delegate_id') ?? '');
  if (!delegateId) return { error: 'Choose a delegate.' };
  const supabase = await createClient();
  const { error } = await supabase.from('enrollments').insert({ course_id: courseId, delegate_id: delegateId });
  if (error) return { error: error.code === '23505' ? 'This delegate is already enrolled.' : userMessage(error)! };
  revalidatePath(`/courses/${courseId}`);
  return { ok: 'Delegate enrolled.' };
}

export async function unenrollDelegate(formData: FormData): Promise<void> {
  await requireActiveUser();
  const courseId = String(formData.get('course_id') ?? '');
  const supabase = await createClient();
  await supabase.from('enrollments').delete().eq('id', String(formData.get('enrollment_id') ?? ''));
  revalidatePath(`/courses/${courseId}`);
}
```

`web/src/app/(app)/courses/course-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { Course } from '@/lib/schedule/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';

type Props = { action: (prev: FormState, formData: FormData) => Promise<FormState>; course?: Course };

export function CourseForm({ action, course }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Course) => valueOf(state, key, course?.[key] ?? '');
  return (
    <form action={formAction} className="card grid max-w-3xl gap-4 sm:grid-cols-2">
      {course && <input type="hidden" name="id" value={course.id} readOnly />}
      <label className="block sm:col-span-2">
        <span className="label">Course name</span>
        <input className="input" name="name" defaultValue={v('name')} />
      </label>
      <label className="block">
        <span className="label">Start date</span>
        <input className="input" type="date" name="start_date" defaultValue={v('start_date')} />
      </label>
      <label className="block">
        <span className="label">End date</span>
        <input className="input" type="date" name="end_date" defaultValue={v('end_date')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Venue</span>
        <input className="input" name="venue" defaultValue={v('venue')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <input className="input" name="notes" defaultValue={v('notes')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          {course ? 'Save course' : 'Create course'}
        </button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/courses/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import type { Course } from '@/lib/schedule/types';
import { CourseForm } from './course-form';
import { createCourse } from './actions';

export default async function CoursesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select('*').order('start_date', { ascending: false });
  if (error) throw new Error('Could not load courses');
  const courses = (data ?? []) as Course[];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Courses</h1>
      <section className="space-y-2">
        <h2 className="font-semibold">New course</h2>
        <CourseForm action={createCourse} />
      </section>
      <ul className="card divide-y divide-gray-100">
        {courses.length === 0 && <li className="text-gray-600">No courses yet.</li>}
        {courses.map((c) => (
          <li key={c.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
            <Link href={`/courses/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.name}</Link>
            <span>{formatDate(c.start_date)} – {formatDate(c.end_date)}</span>
            <span className="text-gray-600">{c.venue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`web/src/app/(app)/courses/[id]/session-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { SESSION_TYPES, SESSION_TYPE_LABELS } from '@/lib/schedule/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import { addSession } from '../actions';

export function SessionForm({ courseId, defaultDate, organizers }: { courseId: string; defaultDate: string; organizers: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSession, {});
  return (
    <form action={action} className="card grid gap-4 sm:grid-cols-3" key={state.ok}>
      <input type="hidden" name="course_id" value={courseId} readOnly />
      <label className="block sm:col-span-2">
        <span className="label">Session title</span>
        <input className="input" name="title" defaultValue={valueOf(state, 'title', '')} />
      </label>
      <label className="block">
        <span className="label">Session type</span>
        <select className="input" name="type" defaultValue={valueOf(state, 'type', 'surgery')}>
          {SESSION_TYPES.map((t) => <option key={t} value={t}>{SESSION_TYPE_LABELS[t]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Session date</span>
        <input className="input" type="date" name="date" defaultValue={valueOf(state, 'date', defaultDate)} />
      </label>
      <label className="block">
        <span className="label">Starts</span>
        <input className="input" type="time" name="start_time" defaultValue={valueOf(state, 'start_time', '08:00')} />
      </label>
      <label className="block">
        <span className="label">Ends</span>
        <input className="input" type="time" name="end_time" defaultValue={valueOf(state, 'end_time', '17:00')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Lead organizer (optional)</span>
        <select className="input" name="lead_organizer_id" defaultValue={valueOf(state, 'lead_organizer_id', '')}>
          <option value="">—</option>
          {organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>Add session</button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/courses/[id]/enrollment.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import { enrollDelegate } from '../actions';

export function EnrollForm({ courseId, available }: { courseId: string; available: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(enrollDelegate, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="course_id" value={courseId} readOnly />
      <label className="block">
        <span className="label">Delegate to enrol</span>
        <select className="input" name="delegate_id" defaultValue="">
          <option value="">Choose…</option>
          {available.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <button className="btn-secondary btn" disabled={pending}>Enrol</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
```

`web/src/app/(app)/courses/[id]/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { SESSION_TYPE_LABELS, type Course, type Session } from '@/lib/schedule/types';
import { CourseForm } from '../course-form';
import { unenrollDelegate, updateCourse } from '../actions';
import { SessionForm } from './session-form';
import { EnrollForm } from './enrollment';

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: course }, { data: sessions }, { data: enrollments }, { data: delegates }, { data: organizers }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.from('sessions').select('*').eq('course_id', id).order('date').order('start_time'),
    supabase.from('enrollments').select('id, delegate:delegates(id, full_name)').eq('course_id', id),
    supabase.from('delegates').select('id, full_name').eq('active', true).order('full_name'),
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).order('full_name'),
  ]);
  if (!course) notFound();
  const c = course as Course;
  const enrolled = (enrollments ?? []) as unknown as { id: string; delegate: { id: string; full_name: string } }[];
  const enrolledIds = new Set(enrolled.map((e) => e.delegate.id));
  const available = (delegates ?? []).filter((d) => !enrolledIds.has(d.id)).map((d) => ({ id: d.id as string, label: d.full_name as string }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{c.name}</h1>
      <CourseForm action={updateCourse} course={c} />
      <section className="space-y-3">
        <h2 className="font-semibold">Sessions</h2>
        <ul className="card divide-y divide-gray-100">
          {(sessions ?? []).length === 0 && <li className="text-sm text-gray-600">No sessions yet.</li>}
          {((sessions ?? []) as Session[]).map((s) => (
            <li key={s.id} data-testid="session-row" className="flex flex-wrap gap-x-6 py-2 text-sm">
              <span className="font-medium">{s.title}</span>
              <span>{SESSION_TYPE_LABELS[s.type]}</span>
              <span>{formatDate(s.date)} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
              {s.type === 'surgery' && (
                <Link href={`/schedule?date=${s.date}`} className="text-blue-700 hover:underline">Schedule</Link>
              )}
            </li>
          ))}
        </ul>
        <SessionForm
          courseId={c.id}
          defaultDate={c.start_date}
          organizers={(organizers ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string }))}
        />
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Enrolled delegates</h2>
        <ul className="space-y-1 text-sm">
          {enrolled.length === 0 && <li className="text-gray-600">Nobody enrolled yet.</li>}
          {enrolled.map((e) => (
            <li key={e.id} data-testid={`enrolled-${e.delegate.full_name}`} className="flex items-center gap-3">
              <Link href={`/delegates/${e.delegate.id}`} className="text-blue-700 hover:underline">{e.delegate.full_name}</Link>
              <form action={unenrollDelegate}>
                <input type="hidden" name="enrollment_id" value={e.id} />
                <input type="hidden" name="course_id" value={c.id} />
                <button className="text-sm text-red-700 hover:underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        <EnrollForm courseId={c.id} available={available} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npm run test:e2e -- courses.spec.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(courses): courses, sessions and enrollments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Schedule — day view, new booking with clash warnings, cancel

**Files:**
- Create: `web/src/app/(app)/schedule/{page,actions,cancel-booking}.tsx|ts`, `web/src/app/(app)/schedule/new/{page,slot-form}.tsx`,
  `web/tests/e2e/schedule.spec.ts`

**Interfaces:**
- Consumes: `create_surgery_slot`, `slot_conflicts`, `cancel_surgery_slot`, `slots_on`, `slotSchema`, `cancelSlotSchema`,
  `gridPlacement`, `timeLabels`, `formatTime`, `todayIso`, `productLabel`.
- Produces: action `bookSurgery(input): Promise<{ error?: string; warnings?: string[]; slotId?: string; date?: string }>`,
  `cancelBooking(prev, fd)`; booking cards `data-testid="booking-<patient file no>"`.

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/schedule.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

async function world() {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const session = uniqueName('Surgery day');
  await seedSession(api, { courseId, type: 'surgery', title: session, date: day });
  const placing = uniqueName('Dr Place');
  const assisting = uniqueName('Dr Assist');
  await enroll(api, courseId, await seedDelegate(api, placing));
  await enroll(api, courseId, await seedDelegate(api, assisting));
  return { day, chair, session, placing, assisting };
}

async function fillBooking(page: Page, w: Awaited<ReturnType<typeof world>>, fileNo: string, start: string, end: string) {
  await page.goto(`/schedule/new?date=${w.day}`);
  const session = page.getByLabel('Surgery session');
  const value = await session.locator('option', { hasText: w.session }).getAttribute('value');
  await session.selectOption(value!);
  await page.getByLabel('Chair').selectOption({ label: w.chair });
  await page.getByLabel('Start').fill(start);
  await page.getByLabel('End').fill(end);
  await page.getByLabel('Patient (file number)').fill(fileNo);
  await page.getByLabel(`Role of ${w.placing}`).selectOption('placing');
  await page.getByLabel('Tooth 1').fill('36');
}

test('books a surgery that plans the implant and shows on the day view', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Booked'), file_no: `E2E-B${Date.now()}` });
  const fileNo = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, fileNo, '09:00', '10:30');
  await page.getByLabel(`Role of ${w.assisting}`).selectOption('assisting');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${w.day}`));
  const card = page.getByTestId(`booking-${fileNo}`);
  await expect(card).toContainText('09:00–10:30');
  await expect(card).toContainText(w.placing);
  await expect(card).toContainText('36');
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant planned' })).toBeVisible();
});

test('warns about a clash and books only with a reason', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('First'), file_no: `E2E-F${Date.now()}` });
  const first = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, first, '09:00', '10:00');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);

  await createPatientViaUi(page, { full_name: uniqueName('Second'), file_no: `E2E-S${Date.now()}` });
  const second = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, second, '09:30', '10:30');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  const warnings = page.getByTestId('clash-warnings');
  await expect(warnings).toContainText(`${w.chair} is already booked 09:00–10:00`);
  await expect(warnings).toContainText(`${w.placing} is already booked 09:00–10:00`);
  await page.getByLabel('Reason to book anyway').fill('Two surgeons share the chair');
  await page.getByRole('button', { name: 'Book anyway' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);
  await expect(page.getByTestId(`booking-${second}`)).toContainText('Overridden: Two surgeons share the chair');
});

test('cancels a booking with a reason', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('Cancel'), file_no: `E2E-C${Date.now()}` });
  const fileNo = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, fileNo, '11:00', '12:00');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  const card = page.getByTestId(`booking-${fileNo}`);
  await card.getByText('Cancel booking').click();
  await card.getByLabel('Reason').fill('Patient has a fever');
  await card.getByRole('button', { name: 'Cancel surgery' }).click();
  await expect(card).toContainText('Cancelled: Patient has a fever');
});
```

Run: `npm run test:e2e -- schedule.spec.ts` → FAIL.

- [ ] **Step 2: Actions** — `web/src/app/(app)/schedule/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { cancelSlotSchema, slotSchema } from '@/lib/schedule/schemas';
import type { FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

type BookResult = { error?: string; warnings?: string[]; slotId?: string; date?: string };

export async function bookSurgery(input: Record<string, unknown>): Promise<BookResult> {
  await requireActiveUser();
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();

  const { data: patient } = await supabase.from('patients').select('id').eq('file_no', s.patientFileNo).maybeSingle();
  if (!patient) return { error: `No patient has file number ${s.patientFileNo}. Choose a patient from the list.` };
  const { data: session } = await supabase.from('sessions').select('date').eq('id', s.sessionId).maybeSingle();
  if (!session) return { error: 'Choose a surgery session.' };

  if (s.overrideReason.length < 3) {
    const { data: clashes, error } = await supabase.rpc('slot_conflicts', {
      p_session: s.sessionId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
      p_supervisor: s.supervisorId, p_delegates: [...s.placing, ...s.assisting],
    });
    if (error) return { error: userMessage(error)! };
    if (clashes?.length) return { warnings: (clashes as { message: string }[]).map((c) => c.message) };
  }

  const { data: slotId, error } = await supabase.rpc('create_surgery_slot', {
    p_session: s.sessionId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
    p_supervisor: s.supervisorId, p_placing: s.placing, p_assisting: s.assisting,
    p_implants: s.implants.map((i) => ({ tooth: i.tooth, product_id: i.productId })),
    p_override_reason: s.overrideReason, p_notes: s.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  revalidatePath(`/patients/${patient.id}`, 'layout');
  return { slotId: slotId as string, date: session.date as string };
}

export async function cancelBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = cancelSlotSchema.safeParse({ slotId: formData.get('slot_id'), reason: formData.get('reason') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_surgery_slot', { p_slot: parsed.data.slotId, p_reason: parsed.data.reason });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  return { ok: 'Booking cancelled.' };
}
```

- [ ] **Step 3: Booking form** — `web/src/app/(app)/schedule/new/slot-form.tsx`:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { productLabel } from '@/lib/inventory/labels';
import type { Option, Product } from '@/lib/inventory/types';
import { bookSurgery } from '../actions';

export type SessionOption = { id: string; label: string; courseId: string };

type Props = {
  sessions: SessionOption[];
  chairs: Option[];
  patients: { file_no: string; full_name: string }[];
  enrolled: Record<string, Option[]>;
  implants: Product[];
  organizers: Option[];
  me: string;
  initial: { sessionId: string; chairId: string; start: string; fileNo: string };
};

type Role = '' | 'placing' | 'assisting';

export function SlotForm(p: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(p.initial.sessionId);
  const [chairId, setChairId] = useState(p.initial.chairId);
  const [start, setStart] = useState(p.initial.start);
  const [end, setEnd] = useState('');
  const [fileNo, setFileNo] = useState(p.initial.fileNo);
  const [supervisorId, setSupervisorId] = useState(p.me);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [implants, setImplants] = useState([{ tooth: '', productId: '' }]);
  const [notes, setNotes] = useState('');
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();

  const courseId = p.sessions.find((s) => s.id === sessionId)?.courseId ?? '';
  const delegates = useMemo(() => p.enrolled[courseId] ?? [], [p.enrolled, courseId]);

  function submit(withOverride: boolean) {
    setError(null);
    start_(async () => {
      const result = await bookSurgery({
        sessionId, chairId, start, end, patientFileNo: fileNo, supervisorId,
        placing: delegates.filter((d) => roles[d.id] === 'placing').map((d) => d.id),
        assisting: delegates.filter((d) => roles[d.id] === 'assisting').map((d) => d.id),
        implants: implants.filter((i) => i.tooth.trim() !== ''),
        overrideReason: withOverride ? override : '',
        notes,
      });
      if (result.error) setError(result.error);
      else if (result.warnings) setWarnings(result.warnings);
      else router.push(`/schedule?date=${result.date}`);
    });
  }

  return (
    <form className="card max-w-3xl space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Surgery session</span>
          <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Choose a session…</option>
            {p.sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Chair</span>
          <select className="input" value={chairId} onChange={(e) => setChairId(e.target.value)}>
            <option value="">Choose a chair…</option>
            {p.chairs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Supervisor</span>
          <select className="input" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            {p.organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Start</span>
          <input className="input" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">End</span>
          <input className="input" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Patient (file number)</span>
          <input className="input" list="patients" value={fileNo} onChange={(e) => setFileNo(e.target.value)} />
          <datalist id="patients">
            {p.patients.map((pt) => <option key={pt.file_no} value={pt.file_no}>{pt.full_name}</option>)}
          </datalist>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Delegates (enrolled in this course)</legend>
        {!courseId && <p className="text-sm text-gray-600">Choose a session first.</p>}
        {courseId && delegates.length === 0 && <p className="text-sm text-amber-900">No delegates are enrolled in this course yet.</p>}
        {delegates.map((d) => (
          <label key={d.id} className="flex items-center gap-3 text-sm">
            <span className="w-56">{d.label}</span>
            <select
              className="input max-w-40 py-1"
              aria-label={`Role of ${d.label}`}
              value={roles[d.id] ?? ''}
              onChange={(e) => setRoles((r) => ({ ...r, [d.id]: e.target.value as Role }))}
            >
              <option value="">Not in this surgery</option>
              <option value="placing">Placing</option>
              <option value="assisting">Assisting</option>
            </select>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="label">Implants needed</legend>
        {implants.map((row, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <input
              className="input w-24"
              aria-label={`Tooth ${i + 1}`}
              placeholder="Tooth"
              value={row.tooth}
              onChange={(e) => setImplants((all) => all.map((r, j) => (j === i ? { ...r, tooth: e.target.value } : r)))}
            />
            <select
              className="input flex-1"
              aria-label={`Implant ${i + 1}`}
              value={row.productId}
              onChange={(e) => setImplants((all) => all.map((r, j) => (j === i ? { ...r, productId: e.target.value } : r)))}
            >
              <option value="">Implant not chosen yet</option>
              {p.implants.map((pr) => <option key={pr.id} value={pr.id}>{productLabel(pr)}</option>)}
            </select>
          </div>
        ))}
        <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setImplants((all) => [...all, { tooth: '', productId: '' }])}>
          + Add another implant
        </button>
      </fieldset>

      <label className="block">
        <span className="label">Notes (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {warnings && (
        <div data-testid="clash-warnings" className="space-y-2 rounded bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">This booking clashes with:</p>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <label className="block">
            <span className="label">Reason to book anyway</span>
            <input className="input" value={override} onChange={(e) => setOverride(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={pending} onClick={() => submit(true)}>Book anyway</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn" disabled={pending}>Book surgery</button>
    </form>
  );
}
```

- [ ] **Step 4: New booking page** — `web/src/app/(app)/schedule/new/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { Option, Product } from '@/lib/inventory/types';
import { SlotForm, type SessionOption } from './slot-form';

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; chair?: string; time?: string; session?: string; patient?: string }>;
}) {
  const q = await searchParams;
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [{ data: sessions }, { data: chairs }, { data: patients }, { data: enrollments }, { data: implants }, { data: organizers }] =
    await Promise.all([
      supabase.from('sessions').select('id, title, date, start_time, course_id, course:courses(name)').eq('type', 'surgery')
        .gte('date', todayIso()).order('date'),
      supabase.from('chairs').select('id, name').eq('active', true).order('name'),
      supabase.from('patients').select('file_no, full_name').eq('archived', false).order('full_name').limit(2000),
      supabase.from('enrollments').select('course_id, delegate:delegates(id, full_name, active)'),
      supabase.from('products').select('*').eq('type', 'implant').eq('active', true),
      supabase.from('profiles').select('user_id, full_name, email').eq('active', true).order('full_name'),
    ]);

  const sessionOptions: SessionOption[] = ((sessions ?? []) as unknown as {
    id: string; title: string; date: string; course_id: string; course: { name: string } | null;
  }[]).map((s) => ({ id: s.id, courseId: s.course_id, label: `${formatDate(s.date)} · ${s.course?.name ?? ''} · ${s.title}` }));

  const enrolled: Record<string, Option[]> = {};
  for (const e of (enrollments ?? []) as unknown as { course_id: string; delegate: { id: string; full_name: string; active: boolean } | null }[]) {
    if (!e.delegate?.active) continue;
    (enrolled[e.course_id] ??= []).push({ id: e.delegate.id, label: e.delegate.full_name });
  }
  for (const list of Object.values(enrolled)) list.sort((a, b) => a.label.localeCompare(b.label));

  const initialSession = q.session ?? sessionOptions.find((s) => s.label.startsWith(q.date ? formatDate(q.date) : '\u0000'))?.id ?? '';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Book a surgery</h1>
      <SlotForm
        sessions={sessionOptions}
        chairs={(chairs ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        patients={(patients ?? []) as { file_no: string; full_name: string }[]}
        enrolled={enrolled}
        implants={((implants ?? []) as Product[]).sort((a, b) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true }))}
        organizers={(organizers ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string }))}
        me={me?.user_id ?? ''}
        initial={{ sessionId: initialSession, chairId: q.chair ?? '', start: q.time ?? '09:00', fileNo: q.patient ?? '' }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Cancel control and day view**

`web/src/app/(app)/schedule/cancel-booking.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { cancelBooking } from './actions';

export function CancelBooking({ slotId }: { slotId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelBooking, {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-red-700">Cancel booking</summary>
      <form action={action} className="mt-1 space-y-1">
        <input type="hidden" name="slot_id" value={slotId} readOnly />
        <label className="block">
          <span className="sr-only">Reason</span>
          <input className="input py-1 text-xs" name="reason" aria-label="Reason" placeholder="Reason" />
        </label>
        <button className="btn-secondary btn py-0.5 text-xs" disabled={pending}>Cancel surgery</button>
        {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      </form>
    </details>
  );
}
```

`web/src/app/(app)/schedule/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { addDays, isRealDate, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { gridPlacement, timeLabels } from '@/lib/schedule/time';
import type { Chair, SlotRow } from '@/lib/schedule/types';
import { CancelBooking } from './cancel-booking';

const SLOT_SELECT = `
  id, starts_at, ends_at, status, override_reason, cancel_reason, chair_id,
  patient:patients(id, full_name, file_no),
  supervisor:profiles!surgery_slots_supervisor_id_fkey(full_name, email),
  session:sessions(title, course:courses(name)),
  delegates:slot_delegates(role, delegate:delegates(full_name)),
  implants:slot_planned_implants(tooth, product:products(*))
`;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: raw } = await searchParams;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const [{ data: chairs }, { data: slots, error }] = await Promise.all([
    supabase.from('chairs').select('id, name, active').eq('active', true).order('name'),
    supabase.rpc('slots_on', { p_date: date }).select(SLOT_SELECT),
  ]);
  if (error) throw new Error('Could not load the schedule');
  const chairList = (chairs ?? []) as Chair[];
  const bookings = (slots ?? []) as unknown as SlotRow[];
  const labels = timeLabels();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Schedule · {formatDate(date)}</h1>
        <Link href={`/schedule?date=${addDays(date, -1)}`} className="btn-secondary btn py-1">← Previous day</Link>
        <Link href={`/schedule?date=${addDays(date, 1)}`} className="btn-secondary btn py-1">Next day →</Link>
        <form className="flex items-center gap-2">
          <input className="input py-1" type="date" name="date" defaultValue={date} aria-label="Date" />
          <button className="btn-secondary btn py-1">Go</button>
        </form>
        <Link href={`/schedule/new?date=${date}`} className="btn">New booking</Link>
        <Link href={`/schedule/pull-list?date=${date}`} className="text-blue-700 hover:underline">Pull list</Link>
      </div>
      {chairList.length === 0 ? (
        <p className="card text-gray-600">No chairs yet. An admin can add chairs under Admin → Chairs.</p>
      ) : (
        <div className="card overflow-x-auto">
          <div
            className="grid min-w-[700px] text-xs"
            style={{ gridTemplateColumns: `4rem repeat(${chairList.length}, minmax(12rem, 1fr))`, gridTemplateRows: `2rem repeat(${labels.length}, 1.25rem)` }}
          >
            <div />
            {chairList.map((c, i) => (
              <div key={c.id} className="border-b border-gray-200 px-2 font-semibold" style={{ gridColumn: i + 2, gridRow: 1 }}>{c.name}</div>
            ))}
            {labels.map((label, i) => (
              <div key={i} className="border-t border-gray-100 pr-2 text-right text-gray-500" style={{ gridColumn: 1, gridRow: i + 2 }}>{label}</div>
            ))}
            {bookings.map((b) => {
              const col = chairList.findIndex((c) => c.id === b.chair_id);
              if (col < 0) return null;
              const start = formatTime(b.starts_at);
              const end = formatTime(b.ends_at);
              const { row, span } = gridPlacement(start, end);
              const placing = b.delegates.filter((d) => d.role === 'placing').map((d) => d.delegate?.full_name).join(', ');
              const assisting = b.delegates.filter((d) => d.role === 'assisting').map((d) => d.delegate?.full_name).join(', ');
              return (
                <div
                  key={b.id}
                  data-testid={`booking-${b.patient?.file_no}`}
                  className={`m-0.5 space-y-0.5 overflow-hidden rounded border p-1.5 ${b.status === 'cancelled' ? 'border-gray-300 bg-gray-50 text-gray-500 line-through' : b.status === 'done' ? 'border-green-300 bg-green-50' : 'border-blue-300 bg-blue-50'}`}
                  style={{ gridColumn: col + 2, gridRow: `${row + 1} / span ${span}` }}
                >
                  <div className="font-semibold">{start}–{end}</div>
                  {b.patient && (
                    <Link href={`/patients/${b.patient.id}`} className="block text-blue-800 hover:underline">
                      {b.patient.full_name} ({b.patient.file_no})
                    </Link>
                  )}
                  {b.implants.length > 0 && <div>Teeth: {b.implants.map((i) => i.tooth).join(', ')}</div>}
                  <div>Supervisor: {b.supervisor?.full_name || b.supervisor?.email}</div>
                  {placing && <div>Placing: {placing}</div>}
                  {assisting && <div>Assisting: {assisting}</div>}
                  {b.override_reason && <div className="text-amber-800 no-underline">Overridden: {b.override_reason}</div>}
                  {b.status === 'cancelled' && <div className="no-underline">Cancelled: {b.cancel_reason}</div>}
                  {b.status === 'scheduled' && <CancelBooking slotId={b.id} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run** — `npm run test:e2e -- schedule.spec.ts` → PASS (3).

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(schedule): day view, surgery booking with clash warnings and cancellation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Pull list

**Files:**
- Create: `web/src/app/(app)/schedule/pull-list/{page,print-button}.tsx`, `web/tests/e2e/pull-list.spec.ts`

**Interfaces:**
- Consumes: `pull_list()`, `productLabel`, `PullRow`. Produces rows `data-testid="pull-row"`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/pull-list.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

test('shows what the day needs against usable stock and flags shortages', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chairId = await seedChair(admin, uniqueName('Chair'));
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Pull day', date: day });
  const delegateId = await seedDelegate(api, uniqueName('Dr Pull'));
  await enroll(api, courseId, delegateId);
  const brand = uniqueName('Pull');
  const stock = await seedImplantStock(api, { brand, qty: 1, lot: `E2E-P${Date.now()}`, expiry: null });

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Pull patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '09:00', p_end: '11:00', p_patient: patientId, p_supervisor: me,
    p_placing: [delegateId], p_implants: [{ tooth: 36, product_id: stock.productId }, { tooth: 46, product_id: stock.productId }],
  });
  expect(error).toBeNull();

  await page.goto(`/schedule/pull-list?date=${day}`);
  const row = page.getByTestId('pull-row').filter({ hasText: brand });
  await expect(row).toContainText('2');
  await expect(row).toContainText('1');
  await expect(row).toContainText('Short by 1');
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
});
```

Run → FAIL (404).

- [ ] **Step 2: Implement**

`web/src/app/(app)/schedule/pull-list/print-button.tsx`:
```tsx
'use client';

export function PrintButton() {
  return (
    <button className="btn-secondary btn print:hidden" onClick={() => window.print()}>
      Print
    </button>
  );
}
```

`web/src/app/(app)/schedule/pull-list/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { PullRow } from '@/lib/schedule/types';
import { PrintButton } from './print-button';

export default async function PullListPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: raw } = await searchParams;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pull_list', { p_date: date });
  if (error) throw new Error('Could not load the pull list');
  const rows = (data ?? []) as PullRow[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pull list · {formatDate(date)}</h1>
        <Link href={`/schedule?date=${date}`} className="text-blue-700 hover:underline print:hidden">Back to schedule</Link>
        <PrintButton />
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="text-gray-600">No planned implants on this day.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Implant</th>
                <th className="pb-2 text-right">Needed</th>
                <th className="pb-2 text-right">Usable stock</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const short = r.needed - r.available;
                return (
                  <tr key={r.product_id ?? 'unchosen'} data-testid="pull-row" className="border-t border-gray-200">
                    <td className="py-2 pr-4">{r.product_id ? productLabel(r) : 'Implant not chosen yet'}</td>
                    <td className="py-2 pr-4 text-right">{r.needed}</td>
                    <td className="py-2 pr-4 text-right">{r.product_id ? r.available : '—'}</td>
                    <td className="py-2">
                      {r.product_id && short > 0 && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">Short by {short}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run** — `npm run test:e2e -- pull-list.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(schedule): printable daily pull list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Chart — booking info and placement pre-filled from the booking

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/chart-data.ts` (`SITE_SELECT` + slot, voided fields),
  `implant-section.tsx` (scheduled line), `implant-forms.tsx` (`PlaceForm` pre-fill + `slotId`),
  `implant-actions.ts` (`p_slot`)
- Test: `web/tests/e2e/slot-placement.spec.ts`

**Interfaces:**
- Consumes: `ImplantSite.slot`, `placeSchema.slotId`.
- Produces: planned implants show "Booked: <date> <time> · <chair>"; `PlaceForm` defaults placing/assisting
  delegate and supervisor from the booking.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/slot-placement.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

test('placing a booked implant is pre-filled and closes the booking', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  const chairId = await seedChair(admin, chair);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Booked day', date: day });
  const placingName = uniqueName('Dr Booked');
  const placing = await seedDelegate(api, placingName);
  await enroll(api, courseId, placing);
  const brand = uniqueName('Booked');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-K${Date.now()}`, expiry: null });

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Booked patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { data: slotId, error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '10:00', p_end: '11:00', p_patient: patientId, p_supervisor: me,
    p_placing: [placing], p_implants: [{ tooth: 36, product_id: stock.productId }],
  });
  expect(error).toBeNull();

  await page.goto(`/patients/${patientId}?tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel).toContainText(`Booked: `);
  await expect(panel).toContainText(chair);
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await expect(page.getByLabel('Placed by (delegate)')).toHaveValue(placing);
  await expect(page.getByRole('combobox', { name: 'Implant', exact: true })).toHaveValue(stock.productId);
  await page.getByLabel('Stock batch').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  const { data: slot } = await api.from('surgery_slots').select('status').eq('id', slotId as string).single();
  expect(slot!.status).toBe('done');
  const { data: site } = await api.from('implant_sites').select('course_id').eq('patient_id', patientId).single();
  expect(site!.course_id).toBe(courseId);
});
```

Run → FAIL (no "Booked:" text).

- [ ] **Step 2: Implement**

In `chart-data.ts` `SITE_SELECT`:
- after `followups:implant_followups(id, date, check_type, outcome, notes)` change that line to
  `followups:implant_followups(id, date, check_type, outcome, notes, voided_at, voided_reason),`
- change the components sub-select first line to
  `id, component_type, fitted_on, removed_on, notes, voided_at, voided_reason,`
- add a line:
  `slot:surgery_slots(id, starts_at, supervisor_id, chair:chairs(name), delegates:slot_delegates(delegate_id, role))`

In `implant-actions.ts` `placeImplant`, add `p_slot: p.slotId,` to the RPC arguments.

In `implant-forms.tsx` `PlaceForm`:
- add prop `slot: ImplantSite['slot']` (default `null`) to its props type;
- initialise state from the booking:

```tsx
  const placingFromSlot = slot?.delegates.find((d) => d.role === 'placing')?.delegate_id ?? '';
  const assistingFromSlot = slot?.delegates.find((d) => d.role === 'assisting')?.delegate_id ?? '';
  const [v, setV] = useState({
    productId: plannedProductId ?? '', lotId: '', placedOn: data.today,
    placingDelegateId: placingFromSlot, assistingDelegateId: assistingFromSlot,
    supervisorId: slot?.supervisor_id ?? data.me, torque: '', graft: '', notes: '',
  });
```
- submit with `submit({ patientId, tooth, slotId: slot?.id ?? '', ...v })`.

In `implant-section.tsx`:
- pass `slot={site?.slot ?? null}` to `<PlaceForm>`;
- in the planned branch, after the "Planned…" paragraph add:

```tsx
      {site?.state === 'planned' && site.slot && (
        <p className="text-sm text-gray-700">
          Booked: {formatDateTime(site.slot.starts_at)}{site.slot.chair ? ` · ${site.slot.chair.name}` : ''}
        </p>
      )}
```
  and import `formatDateTime` from `@/lib/format`.

- [ ] **Step 3: Run** — `npm run test:e2e -- slot-placement.spec.ts implants.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(implants): booking info on the chart and placement pre-filled from the booking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Delegate report with CSV export

**Files:**
- Modify: `web/src/app/(app)/delegates/[id]/page.tsx` (+ report)
- Create: `web/src/app/(app)/delegates/[id]/report.csv/route.ts`, `web/tests/e2e/delegate-report.spec.ts`

**Interfaces:**
- Consumes: `delegate_report()`, `ReportRow`, `toCsv`, `productLabel`, `SITE_STATE_LABELS`, `OUTCOME_LABELS`.
- Produces: report rows `data-testid="report-row"`; totals `data-testid="report-totals"`; link "Download CSV".

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/delegate-report.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

test('shows placed and assisted implants with totals, and exports CSV', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const name = uniqueName('Dr Report, Jr.');
  const delegate = await seedDelegate(api, name);
  const helper = await seedDelegate(api, uniqueName('Dr Helper'));
  const stock = await seedImplantStock(api, { brand: uniqueName('Report'), qty: 2, lot: `E2E-R${Date.now()}`, expiry: null });
  await login(page, TEST_USERS.organizer.email);
  const patientName = uniqueName('Report patient');
  const patientId = await createPatientViaUi(page, { full_name: patientName });
  const me = (await api.auth.getUser()).data.user!.id;
  const today = new Date().toISOString().slice(0, 10);
  for (const [tooth, placing, assisting] of [[36, delegate, helper], [46, helper, delegate]] as const) {
    const { error } = await api.rpc('place_implant', {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today,
      p_placing_delegate: placing, p_assisting_delegate: assisting, p_supervisor: me,
    });
    expect(error).toBeNull();
  }

  await page.goto(`/delegates/${delegate}`);
  await expect(page.getByTestId('report-row')).toHaveCount(2);
  await expect(page.getByTestId('report-totals')).toHaveText('Placed 1 · Assisted 1 · Failed 0');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const file = await (await download).path();
  const csv = readFileSync(file!, 'utf8');
  expect(csv.startsWith('﻿Course,Patient,File,Tooth,Role')).toBe(true);
  expect(csv).toContain(patientName);
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`web/src/app/(app)/delegates/[id]/report.csv/route.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, type FollowupOutcome, type SiteState } from '@/lib/inventory/types';
import type { ReportRow } from '@/lib/schedule/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.active) return new NextResponse('Not allowed', { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [{ data: delegate }, { data, error }] = await Promise.all([
    supabase.from('delegates').select('full_name').eq('id', id).maybeSingle(),
    supabase.rpc('delegate_report', { p_delegate: id }),
  ]);
  if (!delegate || error) return new NextResponse('Not found', { status: 404 });
  const rows = (data ?? []) as ReportRow[];
  const csv = toCsv(
    ['Course', 'Patient', 'File', 'Tooth', 'Role', 'Implant', 'Lot', 'Placed on', 'State', 'Last follow-up'],
    rows.map((r) => [
      r.course_name ?? '',
      r.patient_name,
      r.file_no,
      r.tooth,
      r.role === 'placing' ? 'Placed' : 'Assisted',
      r.product_id && r.type ? productLabel({ ...r, type: r.type, brand: r.brand ?? '', system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '' }) : '',
      r.lot_no ?? '',
      r.placed_on ?? '',
      SITE_STATE_LABELS[r.state as SiteState] ?? r.state,
      r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '',
    ]),
  );
  const filename = `implants-${delegate.full_name.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
```

In `web/src/app/(app)/delegates/[id]/page.tsx`:
- fetch the report: add `supabase.rpc('delegate_report', { p_delegate: id })` (run it alongside the delegate query);
- below `<DelegateForm …/>` render:

```tsx
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Implant record</h2>
          <a href={`/delegates/${delegate.id}/report.csv`} className="btn-secondary btn" download>Download CSV</a>
        </div>
        <p data-testid="report-totals" className="text-sm text-gray-700">
          Placed {report.filter((r) => r.role === 'placing').length} · Assisted {report.filter((r) => r.role === 'assisting').length} ·
          Failed {report.filter((r) => r.state === 'failed').length}
        </p>
        {report.length === 0 ? (
          <p className="text-sm text-gray-600">No implants recorded for this delegate yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Course</th><th className="pb-2">Patient</th><th className="pb-2">Tooth</th>
                <th className="pb-2">Role</th><th className="pb-2">Implant</th><th className="pb-2">Placed</th>
                <th className="pb-2">State</th><th className="pb-2">Last follow-up</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={`${r.site_id}-${r.role}`} data-testid="report-row" className="border-t border-gray-200">
                  <td className="py-2 pr-4">{r.course_name ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${r.patient_id}?tooth=${r.tooth}`} className="text-blue-700 hover:underline">{r.patient_name}</Link>
                  </td>
                  <td className="py-2 pr-4">{r.tooth}</td>
                  <td className="py-2 pr-4">{r.role === 'placing' ? 'Placed' : 'Assisted'}</td>
                  <td className="py-2 pr-4">
                    {r.type ? productLabel({ ...r, type: r.type, brand: r.brand ?? '', system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '' }) : '—'}
                  </td>
                  <td className="py-2 pr-4">{r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                  <td className="py-2 pr-4">{SITE_STATE_LABELS[r.state as SiteState] ?? r.state}</td>
                  <td className="py-2">{r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
```

with `const report = (reportData ?? []) as ReportRow[];` and imports `Link`, `formatDate`, `productLabel`,
`OUTCOME_LABELS`, `SITE_STATE_LABELS`, `FollowupOutcome`, `SiteState`, `ReportRow`.

- [ ] **Step 3: Run** — `npm run test:e2e -- delegate-report.spec.ts delegates.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(delegates): per-delegate implant report with CSV export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Corrections on the chart

**Files:**
- Create: `web/src/app/(app)/patients/[id]/corrections.tsx`, `web/tests/e2e/corrections.spec.ts`
- Modify: `implant-actions.ts` (+ `correctBatch`, `voidFollowup`, `voidComponent`), `implant-section.tsx`
  (render `<Corrections>` for placed/restored/failed sites; struck-through voided rows)

**Interfaces:**
- Consumes: `correct_batch`, `void_followup`, `void_component`, `correctionSchema`, `voidSchema`, `availableLots`,
  `lotLabel`, `currentComponent`.
- Produces: `<Corrections patientId site data />` inside a `<details>` titled "Corrections".

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/corrections.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock } from './api';

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Fix');
  const wrong = `E2E-W${Date.now()}`;
  const right = `E2E-R${Date.now()}`;
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: wrong, expiry: null });
  const rightLot = await receiveStock(api, stock.productId, 2, right, null);
  const delegate = await seedDelegate(api, uniqueName('Dr Fix'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Fix patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { data: siteId, error } = await api.rpc('place_implant', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { api, patientId, siteId: siteId as string, wrongLot: stock.lotId, rightLot, wrong, right };
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test('corrects the batch used for an implant; stock and recall follow', async ({ page }) => {
  const s = await placedImplant(page);
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByText('Corrections').click();
  await page.getByLabel('Correct batch').selectOption({ label: `Lot ${s.right} · 2 left` });
  await page.getByLabel('Reason for correction').fill('Wrong sticker scanned');
  await page.getByRole('button', { name: 'Correct batch' }).click();
  await expect(panel(page).getByTestId('site-details')).toContainText(`Lot ${s.right}`);
  await page.goto(`/inventory/lots/${s.wrongLot}`);
  await expect(page.getByTestId('on-hand')).toHaveText('2');
  await expect(page.getByTestId('usage-row')).toHaveCount(0);
  await page.goto(`/inventory/lots/${s.rightLot}`);
  await expect(page.getByTestId('on-hand')).toHaveText('1');
  await expect(page.getByTestId('usage-row')).toHaveCount(1);
});

test('voids a mistaken failure and the tooth goes back to "implant placed"', async ({ page }) => {
  const s = await placedImplant(page);
  const { error } = await s.api.rpc('record_followup', {
    p_site: s.siteId, p_date: new Date().toISOString().slice(0, 10), p_check_type: '3-month', p_outcome: 'failed',
  });
  expect(error).toBeNull();
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByText('Earlier implants on this tooth (1)').click();
  await panel(page).getByText('Corrections').click();
  await page.getByLabel('Reason for removing the follow-up').fill('Recorded on the wrong patient');
  await page.getByRole('button', { name: 'Remove follow-up' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();
});
```

Run → FAIL (no Corrections section).

- [ ] **Step 2: Actions** — append to `implant-actions.ts`:

```ts
import { correctionSchema, voidSchema } from '@/lib/schedule/schemas';

export async function correctBatch(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  return run(c.patientId, 'correct_batch', {
    p_site: c.siteId, p_new_lot: c.newLotId, p_reason: c.reason, p_component: c.componentId, p_new_product: c.newProductId,
  });
}

export async function voidFollowup(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return run(parsed.data.patientId, 'void_followup', { p_followup: parsed.data.id, p_reason: parsed.data.reason });
}

export async function voidComponent(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return run(parsed.data.patientId, 'void_component', { p_component: parsed.data.id, p_reason: parsed.data.reason });
}
```

(Put the `import` line at the top of the file with the other imports.)

- [ ] **Step 3: Corrections component** — `web/src/app/(app)/patients/[id]/corrections.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { availableLots } from '@/lib/inventory/lots';
import { lotLabel } from '@/lib/inventory/labels';
import { currentComponent } from '@/lib/inventory/components';
import { COMPONENT_LABELS, OUTCOME_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { correctBatch, voidComponent, voidFollowup } from './implant-actions';

type Result = { error?: string };

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  };
  return { error, pending, run };
}

export function Corrections({ patientId, site, data }: { patientId: string; site: ImplantSite; data: ChartData }) {
  const { error, pending, run } = useRun();
  const [lotId, setLotId] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [followupReason, setFollowupReason] = useState('');
  const [componentReason, setComponentReason] = useState('');
  const current = currentComponent(site);
  const lots = site.product ? availableLots(data.lots, site.product.id, data.today).filter((l) => l.lot_no !== site.lot?.lot_no) : [];
  const followups = site.followups.filter((f) => !f.voided_at);
  const latest = followups.at(-1);

  return (
    <details className="rounded border border-gray-200 p-2 text-sm">
      <summary className="cursor-pointer font-medium">Corrections</summary>
      <div className="mt-3 space-y-4">
        {site.product && site.state !== 'failed' && (
          <div className="space-y-2">
            <label className="block">
              <span className="label">Correct batch</span>
              <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Choose the batch actually used…</option>
                {lots.map((l) => <option key={l.stock_lot_id} value={l.stock_lot_id}>{lotLabel(l)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Reason for correction</span>
              <input className="input" value={batchReason} onChange={(e) => setBatchReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => correctBatch({ siteId: site.id, patientId, newLotId: lotId, reason: batchReason }))}
            >
              Correct batch
            </button>
          </div>
        )}
        {current && site.state !== 'failed' && (
          <div className="space-y-2">
            <p>Current component: {COMPONENT_LABELS[current.component_type]} ({formatDate(current.fitted_on)})</p>
            <label className="block">
              <span className="label">Reason for undoing the component</span>
              <input className="input" value={componentReason} onChange={(e) => setComponentReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidComponent({ id: current.id, patientId, reason: componentReason }))}
            >
              Undo current component
            </button>
          </div>
        )}
        {latest && (
          <div className="space-y-2">
            <p>
              Latest follow-up: {formatDate(latest.date)} · {latest.check_type} · {OUTCOME_LABELS[latest.outcome]}
            </p>
            <label className="block">
              <span className="label">Reason for removing the follow-up</span>
              <input className="input" value={followupReason} onChange={(e) => setFollowupReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidFollowup({ id: latest.id, patientId, reason: followupReason }))}
            >
              Remove follow-up
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Wire into the implant section** — in `implant-section.tsx`:
- import `{ Corrections } from './corrections'`;
- change `SiteDetails` to take `{ site, patientId, data }` and, at the end of its returned `<div>`, render
  `{site.state !== 'planned' && site.state !== 'removed' && <Corrections patientId={patientId} site={site} data={data} />}`;
  pass `patientId` and `data` at both `SiteDetails` call sites;
- in the component history list render voided rows struck through:
  `<li key={c.id} className={c.voided_at ? 'text-gray-400 line-through' : ''}>` and append
  `{c.voided_at ? ` — undone: ${c.voided_reason}` : ''}`;
- in the follow-ups list do the same with `f.voided_at` / `f.voided_reason` ("removed: …").

- [ ] **Step 5: Run** — `npm run test:e2e -- corrections.spec.ts implants.spec.ts` → PASS.

- [ ] **Step 6: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run test:e2e` → all green.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(implants): correct a batch, undo a component or remove a follow-up from the chart" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
