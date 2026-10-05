# Lecture & Workshop Schedule (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers fill lecture and workshop sessions with talks, each with a time, a lecturer from an admin-maintained Lecturers list, and a topic. Sessions get an optional room.

**Architecture:**
- **Migration `0028_lectures.sql`** adds:
  - a `lecturers` table, managed like `supervisors`;
  - a `sessions.room` column;
  - a `talks` table that is written only through RPCs (`create_talk`, `update_talk`, `delete_talk`). These RPCs enforce the hours, overlap and active-lecturer rules.
- **UI:**
  - a Schedule section with tabs (Surgery / Lectures / Workshops);
  - a per-day talks view, plus new and edit forms. These are shared between lectures and workshops through a private `_talks` folder;
  - an Admin → Lecturers page.

**Tech Stack:** Next.js 15 App Router (server components and server actions), React 19 `useActionState`, Zod v4, Supabase RPC with plpgsql, Vitest (unit and DB tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-lectures-and-course-reports-design.md` (section "PR A").

**Run every command from `web/`.**

## Global Constraints

- SQL functions:
  - Use `security definer set search_path = ''`.
  - The first statement is `perform app_private.require_active();`.
  - Raise business errors with `app_private.fail('…')`.
  - End the file with explicit `revoke execute … from public, anon` and `grant execute … to authenticated`.
- New public tables get no privileges by default (0019). Grant exactly what is needed. Every table gets an `app_private.audit_row('id')` trigger and an `app_private.set_updated_at()` trigger.
- Migrations are additive only. The previous app version must keep working against the new schema.
- Never edit `0028` once `npm run test:db` has applied it to the dev project. A correction goes into a new migration created with `create or replace`.
- Dates are Cairo dates:
  - TS uses `todayIso()` (`src/lib/dates.ts`) and `formatDate` / `formatTime` (`src/lib/format.ts`).
  - SQL uses `public.cairo_ts(date, time)` to build timestamps.
- Every page and every server action calls `requireActiveUser()` or `requireAdmin()` (`src/lib/auth/session.ts`). Read `searchParams` with `readParams()`.
- Styling:
  - Use the token classes only (`text-muted`, `text-bad`, `text-accent`, `border-line`, `.btn`, `.btn-secondary`, `.input`, `.label`, `.card`, `.page-header`); no raw Tailwind palette colours.
  - Forms keep their values after an error: inputs are uncontrolled, with `defaultValue={valueOf(state, …)}`.
- Copy:
  - The UI says "Lecturer", "Topic", "Room" and "Talk".
  - Error strings are exactly as written in this plan; the tests match them.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A talk whose end equals the next talk's start** (09:00–10:00, then 10:00–11:00) must be accepted. `tstzrange` uses `[)` bounds. Pinned in Task 1, test "back-to-back talks are allowed".
2. **Editing a talk without changing anything** must not clash with itself. Pinned in Task 1, test "update excludes the talk itself".
3. **A lecturer deactivated after being booked** stays valid on edit, but can't be chosen for a new talk. Pinned in Task 1, test "inactive lecturer…". Also pinned in Task 5: the edit page must still list the lecturer.
4. **A form rejected by the DB** (overlap error) keeps every typed value. Pinned in the Task 5 E2E: after the overlap error, the Topic field still holds the typed text.
5. **Room left blank** is stored as `null`, not `''`, which the check constraint would reject. Pinned in Task 2 (`sessionSchema` turns blank into null) and Task 1 (a blank room is refused by the DB).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0028_lectures.sql` (create) | `lecturers`, `sessions.room`, `talks`, `app_private.check_talk`, `create_talk` / `update_talk` / `delete_talk` |
| `tests/db/fixtures.ts` (modify) | `makeLecturer`, `addTalk` |
| `tests/db/talks.test.ts` (create) | DB rules and privileges |
| `src/lib/schedule/types.ts` (modify) | `Session.room`, `Lecturer` |
| `src/lib/schedule/schemas.ts` (+ test) (modify) | `sessionSchema.room`, `lecturerSchema`, `talkSchema`, `updateTalkSchema` |
| `src/lib/schedule/talks.ts` (+ `talks.test.ts`) (create) | `TALK_KINDS`, `isTalkKind`, `talkKindOf`, `TalkRow`, `DaySessionRow`, `DAY_SESSION_SELECT`, `TALK_SELECT` |
| `src/app/(app)/admin/lecturers/{page.tsx,actions.ts,lecturer-row.tsx}` (create) | Admin list of lecturers |
| `src/app/(app)/admin/layout.tsx` (modify) | Lecturers tab |
| `src/app/(app)/courses/[id]/session-form.tsx`, `courses/[id]/page.tsx` (modify) | Room field, room display, links to the talks schedule |
| `src/app/(app)/schedule/layout.tsx` (create) | Surgery / Lectures / Workshops tabs |
| `src/app/(app)/schedule/_talks/actions.ts` (create) | `createTalk`, `updateTalk`, `deleteTalk` |
| `src/app/(app)/schedule/_talks/day-view.tsx` (create) | Server component: one day's sessions and talks |
| `src/app/(app)/schedule/_talks/talk-form.tsx` (create) | Client form for new and edit |
| `src/app/(app)/schedule/_talks/delete-talk.tsx` (create) | Client delete button with confirmation |
| `src/app/(app)/schedule/_talks/new-talk-page.tsx`, `edit-talk-page.tsx` (create) | Server pages shared by both kinds |
| `src/app/(app)/schedule/{lectures,workshops}/page.tsx`, `…/new/page.tsx`, `…/[id]/edit/page.tsx` (create) | Thin route files that pass the kind |
| `tests/e2e/api.ts`, `tests/e2e/patients.ts` (modify) | `seedLecturer`, `seedSession({ room })`, deactivate E2E lecturers in teardown |
| `tests/e2e/lectures.spec.ts` (create) | Admin lecturers, talk lifecycle, workshops tab |

Underscore folders (`_talks`) are private in the App Router: they create no route. `lectures` and `workshops` are static segments, so they win over the existing `schedule/[id]/edit` route.

---

### Task 1: Migration 0028 + DB tests

**Files:**
- Create: `supabase/migrations/0028_lectures.sql`
- Modify: `tests/db/fixtures.ts` (append at the end)
- Create: `tests/db/talks.test.ts`

**Interfaces:**
- Produces:
  - Tables `public.lecturers (id, full_name, active, created_at, updated_at)` and `public.talks (id, session_id, starts_at, ends_at, lecturer_id, topic, notes, created_at, created_by, updated_at)`.
  - Column `public.sessions.room text null`.
  - FK name `talks_lecturer_id_fkey`.
  - `public.create_talk(p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default '') returns uuid`
  - `public.update_talk(p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default '') returns void`
  - `public.delete_talk(p_talk uuid) returns void`
  - Fixtures `makeLecturer(c, name?) → id`, which must run while acting as admin, and `addTalk(c, {session, lecturer, start?, end?, topic?}) → id`.

- [ ] **Step 1: Add fixtures.** Append to `tests/db/fixtures.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing DB tests.** Create `tests/db/talks.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { addTalk, makeCourse, makeLecturer, makeSession } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function world(c: Client) {
  await actAs(c, users.admin);
  const l1 = await makeLecturer(c, 'Zz Prof One');
  const l2 = await makeLecturer(c, 'Zz Prof Two');
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const lecture = await makeSession(c, course, 'lecture'); // 2030-03-02 08:00–17:00
  const lecture2 = await makeSession(c, course, 'lecture');
  const workshop = await makeSession(c, course, 'workshop');
  const surgery = await makeSession(c, course, 'surgery');
  return { l1, l2, course, lecture, lecture2, workshop, surgery };
}

const update = (c: Client, talk: string, a: { start: string; end: string; lecturer: string; topic?: string }) =>
  c.query('select public.update_talk($1, $2::time, $3::time, $4, $5, $6)', [talk, a.start, a.end, a.lecturer, a.topic ?? 'Updated topic', '']);

describe('talks', () => {
  it('stores a talk in Cairo time in lecture and workshop sessions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:30', topic: '  Bone grafting  ' });
      await addTalk(c, { session: w.workshop, lecturer: w.l2 });
      const { rows } = await c.query(
        `select to_char(starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as at,
                to_char(ends_at at time zone 'Africa/Cairo', 'HH24:MI') as till, topic, lecturer_id
         from public.talks where id = $1`,
        [t],
      );
      expect(rows[0]).toEqual({ at: '2030-03-02 09:00', till: '10:30', topic: 'Bone grafting', lecturer_id: w.l1 });
    });
  });

  it('refuses surgery sessions, bad times, times outside the session and a blank topic', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => addTalk(c, { session: w.surgery, lecturer: w.l1 }), /Choose a lecture or workshop session/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '10:00', end: '10:00' }), /End time must be after the start time/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '07:30', end: '09:00' }), /must fit within the session \(08:00–17:00\)/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '16:30', end: '17:30' }), /must fit within the session/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, topic: ' x ' }), /Enter a topic/);
    });
  });

  it('refuses overlapping talks in one session; back-to-back talks are allowed', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00', topic: 'Flap design' });
      await refused(
        c,
        () => addTalk(c, { session: w.lecture, lecturer: w.l2, start: '09:30', end: '10:30' }),
        /Another talk in this session overlaps \(09:00–10:00, Flap design\)/,
      );
      await addTalk(c, { session: w.lecture, lecturer: w.l2, start: '10:00', end: '11:00' });
    });
  });

  it('refuses a lecturer booked in two places at once', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00' });
      await refused(
        c,
        () => addTalk(c, { session: w.lecture2, lecturer: w.l1, start: '09:30', end: '10:00' }),
        /Zz Prof One is already giving a talk at 09:00–10:00/,
      );
      await addTalk(c, { session: w.lecture2, lecturer: w.l2, start: '09:30', end: '10:00' });
    });
  });

  it('update excludes the talk itself and keeps the session', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00' });
      await update(c, t, { start: '09:15', end: '10:15', lecturer: w.l1, topic: 'Moved' });
      const { rows } = await c.query(
        `select to_char(starts_at at time zone 'Africa/Cairo', 'HH24:MI') as at, topic, session_id from public.talks where id = $1`,
        [t],
      );
      expect(rows[0]).toEqual({ at: '09:15', topic: 'Moved', session_id: w.lecture });
      const other = await addTalk(c, { session: w.lecture, lecturer: w.l2, start: '11:00', end: '12:00' });
      await refused(c, () => update(c, other, { start: '10:00', end: '11:00', lecturer: w.l2 }), /Another talk in this session overlaps/);
      await refused(c, () => update(c, '00000000-0000-0000-0000-000000000000', { start: '09:00', end: '10:00', lecturer: w.l1 }), /Talk not found/);
    });
  });

  it('inactive lecturer: refused on a new talk, kept when editing a talk that has them', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await asPostgres(c);
      await c.query('update public.lecturers set active = false where id = any($1)', [[w.l1, w.l2]]);
      await actAs(c, users.organizer);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '11:00', end: '12:00' }), /Choose an active lecturer/);
      await update(c, t, { start: '09:00', end: '10:00', lecturer: w.l1 });
      await refused(c, () => update(c, t, { start: '09:00', end: '10:00', lecturer: w.l2 }), /Choose an active lecturer/);
    });
  });

  it('delete_talk removes a talk; deleting the course removes its talks', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await c.query('select public.delete_talk($1)', [t]);
      await refused(c, () => c.query('select public.delete_talk($1)', [t]), /Talk not found/);
      await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await c.query('select public.delete_course($1)', [w.course]);
      await asPostgres(c);
      const { rows } = await c.query('select count(*)::int as n from public.talks t join public.sessions s on s.id = t.session_id where s.course_id = $1', [w.course]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('privileges: only admins write lecturers; talks are written only through the functions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => c.query(`insert into public.lecturers (full_name) values ('Zz Nope')`), /row-level security/);
      await refused(
        c,
        () => c.query(`insert into public.talks (session_id, starts_at, ends_at, lecturer_id, topic) values ($1, now(), now() + interval '1 hour', $2, 'Direct')`, [w.lecture, w.l1]),
        /permission denied/,
      );
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await refused(c, () => c.query(`update public.talks set topic = 'Hack' where id = $1`, [t]), /permission denied/);
      const read = await c.query('select count(*)::int as n from public.talks where id = $1', [t]);
      expect(read.rows[0].n).toBe(1);
      await actAs(c, null);
      await refused(c, () => c.query('select * from public.talks'), /permission denied/);
      await refused(c, () => c.query('select public.create_talk($1, $2::time, $3::time, $4, $5)', [w.lecture, '11:00', '12:00', w.l1, 'Anon']), /permission denied/);
    });
  });

  it('sessions take an optional room; a blank room is refused', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.query(`update public.sessions set room = 'Hall A' where id = $1`, [w.lecture]);
      const { rows } = await c.query('select room from public.sessions where id = $1', [w.lecture]);
      expect(rows[0].room).toBe('Hall A');
      await refused(c, () => c.query(`update public.sessions set room = '   ' where id = $1`, [w.lecture]), /sessions_room_check/);
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `npm run test:db -- talks`
Expected: FAIL. The failures mention `relation "public.lecturers" does not exist` or a missing function.

- [ ] **Step 4: Write the migration.** Create `supabase/migrations/0028_lectures.sql`:

```sql
-- Lectures and workshops: an admin-maintained list of lecturers, a room on sessions,
-- and talks (time, lecturer, topic) inside lecture and workshop sessions.

create table public.lecturers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lecturers_set_updated_at before update on public.lecturers
  for each row execute function app_private.set_updated_at();
create trigger lecturers_audit after insert or update or delete on public.lecturers
  for each row execute function app_private.audit_row('id');

revoke all on public.lecturers from public, anon, authenticated;
grant select on public.lecturers to authenticated;
grant insert (full_name, active) on public.lecturers to authenticated;
grant update (full_name, active) on public.lecturers to authenticated;
alter table public.lecturers enable row level security;
create policy lecturers_select on public.lecturers for select to authenticated using (public.is_active_user());
create policy lecturers_insert on public.lecturers for insert to authenticated with check (public.is_admin());
create policy lecturers_update on public.lecturers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.sessions add column room text
  constraint sessions_room_check check (room is null or length(trim(room)) between 1 and 120);
grant insert (room) on public.sessions to authenticated;
grant update (room) on public.sessions to authenticated;

create table public.talks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lecturer_id uuid not null constraint talks_lecturer_id_fkey references public.lecturers (id),
  topic text not null check (length(trim(topic)) between 2 and 200),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint talks_times check (ends_at > starts_at)
);
create index talks_session_idx on public.talks (session_id);
create index talks_starts_at_idx on public.talks (starts_at);
create index talks_lecturer_idx on public.talks (lecturer_id);
create trigger talks_set_updated_at before update on public.talks
  for each row execute function app_private.set_updated_at();
create trigger talks_audit after insert or update or delete on public.talks
  for each row execute function app_private.audit_row('id');

revoke all on public.talks from public, anon, authenticated;
grant select on public.talks to authenticated;
alter table public.talks enable row level security;
create policy talks_select on public.talks for select to authenticated using (public.is_active_user());

-- Shared checks for create/update: times, topic, then clashes under a per-day lock.
create function app_private.check_talk(
  p_session public.sessions, p_start time, p_end time, p_lecturer uuid, p_topic text, p_exclude uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := public.cairo_ts(p_session.date, p_start);
  v_end timestamptz := public.cairo_ts(p_session.date, p_end);
  v_clash record;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('End time must be after the start time.');
  end if;
  if p_start < p_session.start_time or p_end > p_session.end_time then
    perform app_private.fail(format('The talk must fit within the session (%s–%s).',
      left(p_session.start_time::text, 5), left(p_session.end_time::text, 5)));
  end if;
  if length(trim(coalesce(p_topic, ''))) < 2 then
    perform app_private.fail('Enter a topic.');
  end if;

  perform pg_advisory_xact_lock(hashtext('talk-day:' || p_session.date::text));

  select t.starts_at, t.ends_at, t.topic into v_clash
  from public.talks t
  where t.session_id = p_session.id
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('Another talk in this session overlaps (%s–%s, %s).',
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI'), v_clash.topic));
  end if;

  select t.starts_at, t.ends_at, l.full_name as lecturer into v_clash
  from public.talks t join public.lecturers l on l.id = t.lecturer_id
  where t.lecturer_id = p_lecturer
    and t.id is distinct from p_exclude
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_start, v_end)
  order by t.starts_at limit 1;
  if found then
    perform app_private.fail(format('%s is already giving a talk at %s–%s.', v_clash.lecturer,
      to_char(v_clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Cairo', 'HH24:MI')));
  end if;
end $$;

create function public.create_talk(
  p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_session from public.sessions where id = p_session;
  if not found or v_session.type not in ('lecture', 'workshop') then
    perform app_private.fail('Choose a lecture or workshop session.');
  end if;
  if not exists (select 1 from public.lecturers where id = p_lecturer and active) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, null);
  insert into public.talks (session_id, starts_at, ends_at, lecturer_id, topic, notes)
  values (p_session, public.cairo_ts(v_session.date, p_start), public.cairo_ts(v_session.date, p_end),
          p_lecturer, trim(p_topic), trim(coalesce(p_notes, '')))
  returning id into v_id;
  return v_id;
end $$;

-- The session stays fixed; an inactive lecturer is kept if already on the talk.
create function public.update_talk(
  p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_talk public.talks;
  v_session public.sessions;
begin
  perform app_private.require_active();
  select * into v_talk from public.talks where id = p_talk for update;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
  select * into v_session from public.sessions where id = v_talk.session_id;
  if not exists (select 1 from public.lecturers where id = p_lecturer and (active or id = v_talk.lecturer_id)) then
    perform app_private.fail('Choose an active lecturer.');
  end if;
  perform app_private.check_talk(v_session, p_start, p_end, p_lecturer, p_topic, p_talk);
  update public.talks
  set starts_at = public.cairo_ts(v_session.date, p_start), ends_at = public.cairo_ts(v_session.date, p_end),
      lecturer_id = p_lecturer, topic = trim(p_topic), notes = trim(coalesce(p_notes, ''))
  where id = p_talk;
end $$;

create function public.delete_talk(p_talk uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  delete from public.talks where id = p_talk;
  if not found then
    perform app_private.fail('Talk not found.');
  end if;
end $$;

revoke execute on function app_private.check_talk(public.sessions, time, time, uuid, text, uuid) from public, anon;
revoke execute on function public.create_talk(uuid, time, time, uuid, text, text) from public, anon;
revoke execute on function public.update_talk(uuid, time, time, uuid, text, text) from public, anon;
revoke execute on function public.delete_talk(uuid) from public, anon;
grant execute on function public.create_talk(uuid, time, time, uuid, text, text) to authenticated;
grant execute on function public.update_talk(uuid, time, time, uuid, text, text) to authenticated;
grant execute on function public.delete_talk(uuid) to authenticated;
```

Notes for the implementer:
- `app_private.fail` raises an exception, so a `perform app_private.fail(...)` call never returns.
- The spec listed a `talks_on(date)` function. It is **dropped**: the day view reads sessions with embedded talks, so nothing would call it. The spec was updated in Step 7.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npm run test:db -- talks`. This applies 0028 to the dev project first.
Expected: all 9 tests PASS.

If a test fails because of the migration, the migration has already been applied. Fix it by adding `0029_lectures_fix.sql` with `create or replace` (and renumber PR B's migration). Do not edit 0028.

- [ ] **Step 6: Run the full DB suite.**

Run: `npm run test:db`
Expected: PASS. The `courses`, `slots` and `delete` suites are unaffected.

- [ ] **Step 7: Note the dropped function in the spec, then commit.**

In the spec's PR A RPC list, replace the `talks_on(...)` paragraph with: "`talks_on` is not needed: the day view reads sessions with their talks embedded."

```bash
git add supabase/migrations/0028_lectures.sql tests/db/fixtures.ts tests/db/talks.test.ts ../docs/superpowers/specs/2026-10-05-lectures-and-course-reports-design.md
git commit -m "feat(db): lecturers, session room and talks with clash checks (0028)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schemas, types and talk helpers

**Files:**
- Modify: `src/lib/schedule/types.ts`
- Modify: `src/lib/schedule/schemas.ts`
- Modify: `src/lib/schedule/schemas.test.ts`
- Create: `src/lib/schedule/talks.ts`
- Create: `src/lib/schedule/talks.test.ts`

**Interfaces:**
- Produces:
  - `Session.room: string | null`
  - `type Lecturer = { id: string; full_name: string; active: boolean }`
  - `lecturerSchema` with `{ full_name }`
  - `talkSchema` with `{ session_id, start, end, lecturer_id, topic, notes }`
  - `updateTalkSchema` with `{ talk_id, start, end, lecturer_id, topic, notes }`
  - `sessionSchema` now also outputs `room: string | null`
  - `TALK_KINDS`, `type TalkKind = 'lectures' | 'workshops'`, `isTalkKind(v: unknown): v is TalkKind`, `talkKindOf(type: SessionType): TalkKind | null`
  - `type TalkRow`, `type DaySessionRow`, `DAY_SESSION_SELECT: string`, `TALK_SELECT: string`

- [ ] **Step 1: Write the failing tests.**

In `src/lib/schedule/schemas.test.ts`, extend the import to add `lecturerSchema, talkSchema, updateTalkSchema`. Inside `describe('course and session schemas')`, add:

```ts
  it('stores a blank room as null and trims a given one', () => {
    const s = { course_id: id, type: 'lecture', title: 'Day 1 lectures', date: '2030-03-02', start_time: '09:00', end_time: '13:00' };
    expect(sessionSchema.parse({ ...s, room: '  ' })).toMatchObject({ room: null });
    expect(sessionSchema.parse(s)).toMatchObject({ room: null });
    expect(sessionSchema.parse({ ...s, room: ' Hall A ' })).toMatchObject({ room: 'Hall A' });
    expect(err(sessionSchema.safeParse({ ...s, room: 'x'.repeat(121) }))).toBe('Keep the room under 120 characters.');
  });
```

Append at the end of the file:

```ts
describe('talk schemas', () => {
  const talk = { session_id: id, start: '09:00', end: '10:00', lecturer_id: id, topic: '  Sinus lift  ', notes: '' };
  it('normalizes a talk', () => {
    expect(talkSchema.parse(talk)).toEqual({ ...talk, topic: 'Sinus lift' });
  });
  it('explains what is missing', () => {
    expect(err(talkSchema.safeParse({ ...talk, session_id: '' }))).toBe('Choose a session.');
    expect(err(talkSchema.safeParse({ ...talk, lecturer_id: '' }))).toBe('Choose a lecturer.');
    expect(err(talkSchema.safeParse({ ...talk, topic: 'x' }))).toBe('Enter a topic.');
    expect(err(talkSchema.safeParse({ ...talk, start: '9am' }))).toBe('Enter the start time (HH:MM).');
    expect(err(talkSchema.safeParse({ ...talk, end: '09:00' }))).toBe('The end time must be after the start time.');
  });
  it('updates by talk id', () => {
    const { session_id: _s, ...rest } = talk;
    expect(updateTalkSchema.parse({ ...rest, talk_id: id })).toMatchObject({ talk_id: id, topic: 'Sinus lift' });
    expect(err(updateTalkSchema.safeParse({ ...rest, talk_id: 'x' }))).toBe('Talk not found.');
  });
  it('requires a lecturer name', () => {
    expect(err(lecturerSchema.safeParse({ full_name: ' A ' }))).toBe('Enter the lecturer’s name.');
    expect(lecturerSchema.parse({ full_name: ' Prof. Laila Samir ' })).toEqual({ full_name: 'Prof. Laila Samir' });
  });
});
```

Create `src/lib/schedule/talks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isTalkKind, talkKindOf, TALK_KINDS } from './talks';

describe('talk kinds', () => {
  it('maps route segments to session types and back', () => {
    expect(TALK_KINDS.lectures.type).toBe('lecture');
    expect(TALK_KINDS.workshops.type).toBe('workshop');
    expect(talkKindOf('lecture')).toBe('lectures');
    expect(talkKindOf('workshop')).toBe('workshops');
    expect(talkKindOf('surgery')).toBeNull();
  });
  it('accepts only known kinds', () => {
    expect(isTalkKind('lectures')).toBe(true);
    expect(isTalkKind('workshops')).toBe(true);
    expect(isTalkKind('surgery')).toBe(false);
    expect(isTalkKind(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npm test -- schedule/`
Expected: FAIL. `lecturerSchema` / `talkSchema` are not exported and `./talks` cannot be resolved.

- [ ] **Step 3: Implement.**

In `src/lib/schedule/types.ts`:
- Change `Session` so it ends with `lead_organizer_id: string | null; room: string | null;`.
- After `Supervisor`, add:

```ts
export type Lecturer = { id: string; full_name: string; active: boolean };
```

In `src/lib/schedule/schemas.ts`, add `room` to `sessionSchema`'s object, after `lead_organizer_id`:

```ts
    room: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
      z.string().trim().max(120, { message: 'Keep the room under 120 characters.' }).nullable(),
    ),
```

Add after `supervisorSchema`:

```ts
export const lecturerSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the lecturer’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});

const talkFields = {
  start: time('Enter the start time (HH:MM).'),
  end: time('Enter the end time (HH:MM).'),
  lecturer_id: requiredId('Choose a lecturer.'),
  topic: z.string().trim().min(2, { message: 'Enter a topic.' }).max(200, { message: 'Keep the topic under 200 characters.' }),
  notes: text(1000),
};
const endsAfterStart = { message: 'The end time must be after the start time.' };

export const talkSchema = z
  .object({ session_id: requiredId('Choose a session.'), ...talkFields })
  .refine((t) => t.end > t.start, endsAfterStart);

export const updateTalkSchema = z
  .object({ talk_id: requiredId('Talk not found.'), ...talkFields })
  .refine((t) => t.end > t.start, endsAfterStart);
```

Create `src/lib/schedule/talks.ts`:

```ts
import type { SessionType } from './types';

/** Route segment → session type. Lectures and workshops share one set of pages. */
export const TALK_KINDS = {
  lectures: { type: 'lecture', title: 'Lectures', noun: 'lecture' },
  workshops: { type: 'workshop', title: 'Workshops', noun: 'workshop' },
} as const satisfies Record<string, { type: SessionType; title: string; noun: string }>;
export type TalkKind = keyof typeof TALK_KINDS;

export function isTalkKind(v: unknown): v is TalkKind {
  return v === 'lectures' || v === 'workshops';
}

export function talkKindOf(type: SessionType): TalkKind | null {
  return type === 'lecture' ? 'lectures' : type === 'workshop' ? 'workshops' : null;
}

export type TalkRow = {
  id: string; session_id: string; starts_at: string; ends_at: string; topic: string; notes: string;
  lecturer_id: string; lecturer: { full_name: string } | null;
};

export type DaySessionRow = {
  id: string; title: string; date: string; start_time: string; end_time: string; room: string | null;
  course: { name: string } | null; talks: TalkRow[];
};

export const TALK_SELECT = `
  id, session_id, starts_at, ends_at, topic, notes, lecturer_id,
  lecturer:lecturers!talks_lecturer_id_fkey(full_name)
`;

export const DAY_SESSION_SELECT = `
  id, title, date, start_time, end_time, room,
  course:courses(name),
  talks(${TALK_SELECT})
`;
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npm test -- schedule/` and `npx tsc --noEmit`
Expected: PASS. tsc reports no errors; `Session` gained `room`, and the existing users only read it.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/schedule
git commit -m "feat(schedule): talk and lecturer schemas, session room, talk kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin → Lecturers

**Files:**
- Create: `src/app/(app)/admin/lecturers/actions.ts`
- Create: `src/app/(app)/admin/lecturers/lecturer-row.tsx`
- Create: `src/app/(app)/admin/lecturers/page.tsx`
- Modify: `src/app/(app)/admin/layout.tsx` (add a tab after Supervisors)
- Modify: `tests/e2e/patients.ts` (`deactivateE2eCatalog`)
- Modify: `tests/e2e/api.ts` (`seedLecturer`; `room` on `seedSession`)
- Create: `tests/e2e/lectures.spec.ts` (first test)

**Interfaces:**
- Consumes: `lecturerSchema`, `Lecturer` (from Task 2) and the `lecturers` table (from Task 1).
- Produces:
  - `seedLecturer(adminApi, name) → Promise<string>`
  - `seedSession(api, { …, room?: string })`
  - test ids `lecturer-row-<name>`

- [ ] **Step 1: Write the failing E2E test.** Create `tests/e2e/lectures.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a lecturer', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/lecturers');
  const name = uniqueName('Lecturer');
  await page.getByLabel('New lecturer').fill(name);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  const row = page.getByTestId(`lecturer-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`lecturer-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open lecturer settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/lecturers');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx playwright test lectures`
Expected: FAIL. The page 404s and the "New lecturer" label is not found.

- [ ] **Step 3: Implement.**

`src/app/(app)/admin/lecturers/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { lecturerSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function addLecturer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = lecturerSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('lecturers').insert({ full_name: parsed.data.full_name });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/admin/lecturers');
  return { ok: 'Lecturer added.' };
}

export async function updateLecturer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = lecturerSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lecturers')
    .update({ full_name: parsed.data.full_name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? userMessage(error)! : 'Lecturer not found.', formData);
  revalidatePath('/admin/lecturers');
  return { ok: 'Saved.' };
}
```

`src/app/(app)/admin/lecturers/lecturer-row.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { Lecturer } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addLecturer, updateLecturer } from './actions';

export function LecturerRow({ lecturer }: { lecturer: Lecturer }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateLecturer, {});
  return (
    <li data-testid={`lecturer-row-${lecturer.full_name}`} className="border-t border-line py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={lecturer.id} readOnly />
        <input className="input max-w-xs" name="full_name" aria-label="Name" defaultValue={lecturer.full_name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={lecturer.active} />
          Active
        </label>
        <span className="text-sm text-muted">{lecturer.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddLecturer() {
  const [state, action, pending] = useActionState<FormState, FormData>(addLecturer, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New lecturer</span>
        <input className="input" name="full_name" placeholder="e.g. Prof. Laila Samir" />
      </label>
      <button className="btn" disabled={pending}>
        Add lecturer
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
```

`src/app/(app)/admin/lecturers/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import type { Lecturer } from '@/lib/schedule/types';
import { AddLecturer, LecturerRow } from './lecturer-row';

export default async function LecturersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from('lecturers').select('id, full_name, active').order('full_name');
  if (error) throw new Error('Could not load lecturers');
  return (
    <div className="space-y-6">
      <h1>Lecturers</h1>
      <p className="text-muted">The names offered as lecturer on lecture and workshop talks. Inactive lecturers stay on past talks.</p>
      <AddLecturer />
      <ul className="card">
        {((data ?? []) as Lecturer[]).map((l) => (
          <LecturerRow key={l.id} lecturer={l} />
        ))}
      </ul>
    </div>
  );
}
```

In `src/app/(app)/admin/layout.tsx`, add `{ href: '/admin/lecturers', label: 'Lecturers' },` after the Supervisors item.

In `tests/e2e/patients.ts` `deactivateE2eCatalog`, add after the supervisors line:

```ts
    await pg.query('update public.lecturers set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
```

In `tests/e2e/api.ts`:
- Change `seedSession`'s parameter type to `{ courseId: string; type: string; title: string; date: string; start?: string; end?: string; room?: string }`.
- Add `room: s.room ?? null` to the inserted object.
- Append:

```ts
export async function seedLecturer(adminApi: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await adminApi.from('lecturers').insert({ full_name: name }).select('id').single();
  if (error) throw error;
  return data.id;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx playwright test lectures` and `npx playwright test admin supervisors`
Expected: PASS. The second command checks that the admin tabs still work.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(app)/admin" tests/e2e
git commit -m "feat(admin): Lecturers list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Room on sessions and course page links

**Files:**
- Modify: `src/app/(app)/courses/[id]/session-form.tsx`
- Modify: `src/app/(app)/courses/[id]/page.tsx:44-60`
- Test: `tests/e2e/courses.spec.ts` (add one test)

**Interfaces:**
- Consumes: `sessionSchema.room` and `talkKindOf` / `TALK_KINDS` (from Task 2). No action change is needed: `addSession` already inserts `parsed.data`, which now includes `room`.

- [ ] **Step 1: Write the failing E2E test.** Read `tests/e2e/courses.spec.ts` for its imports and seeding style, then append:

```ts
test('a lecture session shows its room and links to the lectures schedule', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const date = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/courses/${courseId}`);
  await page.getByLabel('Session title').fill('Morning lectures');
  await page.getByRole('combobox', { name: 'Session type' }).selectOption('lecture');
  await page.getByLabel('Session date').fill(date);
  await page.getByLabel('Room (optional)').fill('Hall A');
  await page.getByRole('button', { name: 'Add session' }).click();
  const row = page.getByTestId('session-row').filter({ hasText: 'Morning lectures' });
  await expect(row).toContainText('Hall A');
  await row.getByRole('link', { name: 'Talks' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule/lectures\\?date=${date}`));
});
```

Add whichever of `apiAs`, `seedCourse`, `randomFutureDate` (from `./api`) and `uniqueName` (from `./patients`) the spec does not already import. This test only passes after Task 5 adds the route. Until then, assert only up to the URL; the page itself may 404.

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx playwright test courses -g "room"`
Expected: FAIL. The label "Room (optional)" is not found.

- [ ] **Step 3: Implement.**

In `session-form.tsx`, insert after the "Ends" label block:

```tsx
      <label className="block">
        <span className="label">Room (optional)</span>
        <input className="input" name="room" defaultValue={valueOf(state, 'room', '')} placeholder="e.g. Hall A" />
      </label>
```

Change the lead organizer label's `className` from `"block sm:col-span-2"` to `"block sm:col-span-3"` so the grid stays tidy.

In `courses/[id]/page.tsx`:
- Import `{ talkKindOf } from '@/lib/schedule/talks'`.
- In the session `<li>`, after the date/time span, add:

```tsx
              {s.room && <span className="text-muted">{s.room}</span>}
```

- After the existing surgery `Schedule` link, add:

```tsx
              {talkKindOf(s.type) && (
                <Link href={`/schedule/${talkKindOf(s.type)}?date=${s.date}`} className="text-accent hover:underline">Talks</Link>
              )}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx playwright test courses`
Expected: PASS. The URL assertion passes even while the target route is a 404.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(app)/courses" tests/e2e/courses.spec.ts
git commit -m "feat(courses): optional room on sessions; lecture/workshop sessions link to their talks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Schedule tabs, talks day view, new/edit/delete

**Files:**
- Create: `src/app/(app)/schedule/layout.tsx`
- Create: `src/app/(app)/schedule/_talks/actions.ts`
- Create: `src/app/(app)/schedule/_talks/day-view.tsx`
- Create: `src/app/(app)/schedule/_talks/talk-form.tsx`
- Create: `src/app/(app)/schedule/_talks/delete-talk.tsx`
- Create: `src/app/(app)/schedule/_talks/new-talk-page.tsx`
- Create: `src/app/(app)/schedule/_talks/edit-talk-page.tsx`
- Create: `src/app/(app)/schedule/lectures/page.tsx`, `lectures/new/page.tsx`, `lectures/[id]/edit/page.tsx`
- Create: `src/app/(app)/schedule/workshops/page.tsx`, `workshops/new/page.tsx`, `workshops/[id]/edit/page.tsx`
- Create: `src/app/(app)/schedule/_talks/talk-form.test.tsx`
- Test: `tests/e2e/lectures.spec.ts` (add tests)

**Interfaces:**
- Consumes:
  - From Task 2: `talkSchema`, `updateTalkSchema`, `TALK_KINDS`, `isTalkKind`, `TalkKind`, `TalkRow`, `DaySessionRow`, `DAY_SESSION_SELECT`, `TALK_SELECT`.
  - From Task 1: the RPCs `create_talk`, `update_talk`, `delete_talk`.
  - From Task 3: `seedLecturer` and `seedSession({ room })`.
- Produces:
  - Routes `/schedule/{lectures,workshops}[?date=]`, `/schedule/{kind}/new[?session=&date=]` and `/schedule/{kind}/[id]/edit`.
  - Test ids `talk-session-<sessionId>` and `talk-<id>`.

- [ ] **Step 1: Write the failing component test.** Create `src/app/(app)/schedule/_talks/talk-form.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TalkForm } from './talk-form';

vi.mock('./actions', () => ({ createTalk: vi.fn(), updateTalk: vi.fn(), deleteTalk: vi.fn() }));

const base = { kind: 'lectures' as const, lecturers: [{ id: 'l1', label: 'Prof One' }] };
const initial = { sessionId: 's1', start: '09:00', end: '10:00', lecturerId: '', topic: '', notes: '' };

describe('TalkForm', () => {
  it('offers sessions when adding', () => {
    render(<TalkForm {...base} sessions={[{ id: 's1', label: '02 Mar 2030 · Course · Morning' }]} initial={initial} />);
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('s1');
    expect(screen.getByRole('combobox', { name: 'Lecturer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save talk' })).toBeInTheDocument();
  });
  it('shows the session as text when editing', () => {
    render(<TalkForm {...base} sessionLabel="02 Mar 2030 · Course · Morning" initial={{ ...initial, talkId: 't1', topic: 'Flaps' }} />);
    expect(screen.queryByRole('combobox', { name: 'Session' })).toBeNull();
    expect(screen.getByText('02 Mar 2030 · Course · Morning')).toBeInTheDocument();
    expect(screen.getByLabelText('Topic')).toHaveValue('Flaps');
  });
  it('points to Admin → Lecturers when the list is empty', () => {
    render(<TalkForm kind="workshops" lecturers={[]} sessions={[]} initial={initial} />);
    expect(screen.getByText(/No lecturers yet/)).toBeInTheDocument();
  });
});
```

Check an existing component test (for example `src/components/confirm-delete.test.tsx`) for how `@testing-library/jest-dom` matchers are set up, and match it.

- [ ] **Step 2: Write the failing E2E tests.** Append to `tests/e2e/lectures.spec.ts`. Extend the imports with `import { apiAs, randomFutureDate, seedCourse, seedLecturer, seedSession } from './api';`, then add:

```ts
test('organizer adds, edits and deletes a talk in a lecture session', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const lecturer = uniqueName('Lecturer');
  const lecturer2 = uniqueName('Lecturer');
  await seedLecturer(admin, lecturer);
  await seedLecturer(admin, lecturer2);
  const api = await apiAs(TEST_USERS.organizer.email);
  const date = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const sessionId = await seedSession(api, { courseId, type: 'lecture', title: 'Morning lectures', date, start: '09:00', end: '13:00', room: 'Hall A' });

  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/lectures?date=${date}`);
  const card = page.getByTestId(`talk-session-${sessionId}`);
  await expect(card).toContainText('Hall A');
  await expect(card).toContainText('09:00–13:00');

  await card.getByRole('link', { name: 'Add talk' }).click();
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('End').fill('10:00');
  await page.getByRole('combobox', { name: 'Lecturer' }).selectOption({ label: lecturer });
  await page.getByLabel('Topic').fill('Sinus lift basics');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule/lectures\\?date=${date}`));
  await expect(card).toContainText('Sinus lift basics');
  await expect(card).toContainText(lecturer);

  // An overlap is refused and the typed values survive.
  await card.getByRole('link', { name: 'Add talk' }).click();
  await page.getByLabel('Start').fill('09:30');
  await page.getByLabel('End').fill('10:30');
  await page.getByRole('combobox', { name: 'Lecturer' }).selectOption({ label: lecturer2 });
  await page.getByLabel('Topic').fill('Flap design');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(page.getByRole('alert')).toContainText('Another talk in this session overlaps');
  await expect(page.getByLabel('Topic')).toHaveValue('Flap design');
  await page.getByLabel('Start').fill('10:00');
  await page.getByLabel('End').fill('11:00');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(card).toContainText('Flap design');

  await card.getByRole('link', { name: 'Edit Sinus lift basics' }).click();
  await page.getByLabel('Topic').fill('Sinus lift: crestal approach');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(card).toContainText('Sinus lift: crestal approach');

  const talk = card.getByTestId(/^talk-/).filter({ hasText: 'Flap design' });
  await talk.getByText('Delete', { exact: true }).click();
  await talk.getByRole('button', { name: 'Delete talk' }).click();
  await expect(card).not.toContainText('Flap design');
});

test('schedule tabs reach the workshops day view', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/schedule?date=2099-01-05');
  await page.getByRole('navigation', { name: 'Schedule sections' }).getByRole('link', { name: 'Workshops' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Workshops');
  await expect(page.getByText('No workshop sessions on this day')).toBeVisible();
});
```

The tab test relies on the tabs carrying `?date=` across (Step 4, `ScheduleTabs`). 2099-01-05 is outside `randomFutureDate()`'s range (2031–2034), so no seeded workshop lands on it.

In `day-view.tsx`, `.order('starts_at', { referencedTable: 'talks' })` needs a supabase-js version that supports `referencedTable`. Check `node_modules/@supabase/postgrest-js` for it; older versions call the option `foreignTable`.

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `npm test -- talk-form` and `npx playwright test lectures`
Expected: FAIL. `./talk-form` is not found, and the `/schedule/lectures` route 404s.

- [ ] **Step 4: Implement.**

`src/app/(app)/schedule/layout.tsx`:
- `SectionNav` compares the pathname exactly, so the hrefs must not include a query string.
- A small client wrapper keeps the date when switching tabs.

```tsx
import { ScheduleTabs } from './schedule-tabs';

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ScheduleTabs />
      {children}
    </div>
  );
}
```

Create `src/app/(app)/schedule/schedule-tabs.tsx`. It mirrors `SectionNav` (`src/components/section-nav.tsx`) but carries `?date=` across tabs:

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/schedule', label: 'Surgery' },
  { href: '/schedule/lectures', label: 'Lectures' },
  { href: '/schedule/workshops', label: 'Workshops' },
];

/** Schedule tabs; the selected day carries over when switching. */
export function ScheduleTabs() {
  const pathname = usePathname();
  const date = useSearchParams().get('date');
  return (
    <nav aria-label="Schedule sections" className="tabs print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={date ? `${t.href}?date=${encodeURIComponent(date)}` : t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className="tab"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

Using `useSearchParams` in a client component under a dynamic page needs no Suspense here, because every schedule page reads `searchParams`, which makes it dynamic. If `next build` reports "useSearchParams() should be wrapped in a suspense boundary", wrap `<ScheduleTabs />` in `<Suspense fallback={null}>` in the layout.

`src/app/(app)/schedule/_talks/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { talkSchema, updateTalkSchema } from '@/lib/schedule/schemas';
import { isTalkKind, type TalkKind } from '@/lib/schedule/talks';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

const kindOf = (formData: FormData): TalkKind => {
  const k = formData.get('kind');
  return isTalkKind(k) ? k : 'lectures';
};

export async function createTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = talkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data: session } = await supabase.from('sessions').select('date').eq('id', t.session_id).maybeSingle();
  if (!session) return failed('Choose a session.', formData);
  const { error } = await supabase.rpc('create_talk', {
    p_session: t.session_id, p_start: t.start, p_end: t.end, p_lecturer: t.lecturer_id, p_topic: t.topic, p_notes: t.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  const kind = kindOf(formData);
  revalidatePath(`/schedule/${kind}`);
  redirect(`/schedule/${kind}?date=${session.date}`);
}

export async function updateTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = updateTalkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data: talk } = await supabase.from('talks').select('session:sessions(date)').eq('id', t.talk_id).maybeSingle();
  const date = (talk?.session as { date: string } | null)?.date;
  if (!date) return failed('Talk not found.', formData);
  const { error } = await supabase.rpc('update_talk', {
    p_talk: t.talk_id, p_start: t.start, p_end: t.end, p_lecturer: t.lecturer_id, p_topic: t.topic, p_notes: t.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  const kind = kindOf(formData);
  revalidatePath(`/schedule/${kind}`);
  redirect(`/schedule/${kind}?date=${date}`);
}

export async function deleteTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_talk', { p_talk: String(formData.get('talk_id') ?? '') });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/schedule/${kindOf(formData)}`);
  return { ok: 'Talk deleted.' };
}
```

`src/app/(app)/schedule/_talks/talk-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import type { TalkKind } from '@/lib/schedule/talks';
import { createTalk, updateTalk } from './actions';

type Initial = { talkId?: string; sessionId: string; start: string; end: string; lecturerId: string; topic: string; notes: string };

export function TalkForm({
  kind, sessions = [], sessionLabel, lecturers, initial,
}: { kind: TalkKind; sessions?: Option[]; sessionLabel?: string; lecturers: Option[]; initial: Initial }) {
  const editing = Boolean(initial.talkId);
  const [state, action, pending] = useActionState<FormState, FormData>(editing ? updateTalk : createTalk, {});
  return (
    <form action={action} className="card grid max-w-2xl gap-4 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} readOnly />
      {editing ? (
        <>
          <input type="hidden" name="talk_id" value={initial.talkId} readOnly />
          <div className="sm:col-span-2">
            <span className="label">Session</span>
            <p>{sessionLabel}</p>
          </div>
        </>
      ) : (
        <label className="block sm:col-span-2">
          <span className="label">Session</span>
          <select className="input" name="session_id" defaultValue={valueOf(state, 'session_id', initial.sessionId)}>
            <option value="">—</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label">Start</span>
        <input className="input" type="time" name="start" defaultValue={valueOf(state, 'start', initial.start)} />
      </label>
      <label className="block">
        <span className="label">End</span>
        <input className="input" type="time" name="end" defaultValue={valueOf(state, 'end', initial.end)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Lecturer</span>
        <select className="input" name="lecturer_id" defaultValue={valueOf(state, 'lecturer_id', initial.lecturerId)}>
          <option value="">—</option>
          {lecturers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        {lecturers.length === 0 && (
          <span className="mt-1 block text-sm text-muted">
            No lecturers yet — an admin adds them in <Link href="/admin/lecturers" className="text-accent hover:underline">Admin → Lecturers</Link>.
          </span>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Topic</span>
        <input className="input" name="topic" defaultValue={valueOf(state, 'topic', initial.topic)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes (optional)</span>
        <textarea className="input" name="notes" rows={2} defaultValue={valueOf(state, 'notes', initial.notes)} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>Save talk</button>
      </div>
    </form>
  );
}
```

`src/app/(app)/schedule/_talks/delete-talk.tsx`, in the style of `schedule/cancel-booking.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import type { TalkKind } from '@/lib/schedule/talks';
import { deleteTalk } from './actions';

export function DeleteTalk({ talkId, kind }: { talkId: string; kind: TalkKind }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteTalk, {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-bad">Delete</summary>
      <form action={action} className="mt-1">
        <input type="hidden" name="talk_id" value={talkId} readOnly />
        <input type="hidden" name="kind" value={kind} readOnly />
        <button className="btn-danger btn py-0.5 text-xs" disabled={pending}>Delete talk</button>
        {state.error && <p role="alert" className="text-bad">{state.error}</p>}
      </form>
    </details>
  );
}
```

`src/app/(app)/schedule/_talks/day-view.tsx`:

```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { addDays, isRealDate, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { DAY_SESSION_SELECT, TALK_KINDS, type DaySessionRow, type TalkKind } from '@/lib/schedule/talks';
import { DeleteTalk } from './delete-talk';

export async function TalkDayView({ kind, searchParams }: { kind: TalkKind; searchParams: PageSearchParams }) {
  await requireActiveUser();
  const raw = (await readParams(searchParams, 'date')).date;
  const date = raw && isRealDate(raw) ? raw : todayIso();
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select(DAY_SESSION_SELECT)
    .eq('type', k.type)
    .eq('date', date)
    .order('start_time')
    .order('starts_at', { referencedTable: 'talks' });
  if (error) throw new Error(`Could not load the ${k.title.toLowerCase()}`);
  const sessions = (data ?? []) as unknown as DaySessionRow[];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1>{k.title} · {formatDate(date)}</h1>
        <Link href={`/schedule/${kind}/new?date=${date}`} className="btn">New talk</Link>
      </div>
      <nav className="flex gap-4 text-sm" aria-label="Day">
        <Link href={`/schedule/${kind}?date=${addDays(date, -1)}`} className="text-accent hover:underline">← Previous day</Link>
        <Link href={`/schedule/${kind}?date=${todayIso()}`} className="text-accent hover:underline">Today</Link>
        <Link href={`/schedule/${kind}?date=${addDays(date, 1)}`} className="text-accent hover:underline">Next day →</Link>
      </nav>
      {sessions.length === 0 && (
        <p className="card text-muted">No {k.noun} sessions on this day — add one on the course page.</p>
      )}
      {sessions.map((s) => (
        <section key={s.id} data-testid={`talk-session-${s.id}`} className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold">{s.title}</h2>
              <p className="text-sm text-muted">
                {s.course?.name} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                {s.room && <> · {s.room}</>}
              </p>
            </div>
            <Link href={`/schedule/${kind}/new?session=${s.id}`} className="btn-secondary btn">Add talk</Link>
          </div>
          {s.talks.length === 0 ? (
            <p className="text-sm text-muted">No talks yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.talks.map((t) => (
                <li key={t.id} data-testid={`talk-${t.id}`} className="flex flex-wrap items-start gap-x-6 gap-y-1 py-2 text-sm">
                  <span className="w-28 font-medium tabular-nums">{formatTime(t.starts_at)}–{formatTime(t.ends_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.topic}</span>
                    <span className="block text-muted">{t.lecturer?.full_name}</span>
                    {t.notes && <span className="block text-muted">{t.notes}</span>}
                  </span>
                  <span className="flex items-start gap-3">
                    <Link href={`/schedule/${kind}/${t.id}/edit`} aria-label={`Edit ${t.topic}`} className="text-accent hover:underline">Edit</Link>
                    <DeleteTalk talkId={t.id} kind={kind} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
```

`src/app/(app)/schedule/_talks/new-talk-page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { TALK_KINDS, type TalkKind } from '@/lib/schedule/talks';
import { TalkForm } from './talk-form';

export async function NewTalkPage({ kind, searchParams }: { kind: TalkKind; searchParams: PageSearchParams }) {
  await requireActiveUser();
  const q = await readParams(searchParams, 'session', 'date');
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const results = await Promise.all([
    supabase.from('sessions').select('id, title, date, start_time, end_time, course:courses(name)')
      .eq('type', k.type).gte('date', todayIso()).order('date').order('start_time'),
    supabase.from('lecturers').select('id, full_name').eq('active', true).order('full_name'),
  ]);
  if (results.some((r) => r.error)) throw new Error('Could not load the talk form');
  const [{ data: sessions }, { data: lecturers }] = results;
  const rows = (sessions ?? []) as unknown as { id: string; title: string; date: string; start_time: string; end_time: string; course: { name: string } | null }[];
  const initialSession = q.session || rows.find((s) => s.date === q.date)?.id || '';
  const first = rows.find((s) => s.id === initialSession);

  return (
    <div className="space-y-6">
      <h1>New {k.noun} talk</h1>
      <TalkForm
        kind={kind}
        sessions={rows.map((s) => ({
          id: s.id,
          label: `${formatDate(s.date)} · ${s.course?.name ?? ''} · ${s.title} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`,
        }))}
        lecturers={(lecturers ?? []).map((l) => ({ id: l.id as string, label: l.full_name as string }))}
        initial={{ sessionId: initialSession, start: first?.start_time.slice(0, 5) ?? '09:00', end: '', lecturerId: '', topic: '', notes: '' }}
      />
    </div>
  );
}
```

`src/app/(app)/schedule/_talks/edit-talk-page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { formatDate, formatTime } from '@/lib/format';
import { TALK_KINDS, TALK_SELECT, type TalkKind, type TalkRow } from '@/lib/schedule/talks';
import { TalkForm } from './talk-form';

type EditRow = TalkRow & { session: { type: string; title: string; date: string; course: { name: string } | null } | null };

export async function EditTalkPage({ kind, params }: { kind: TalkKind; params: Promise<{ id: string }> }) {
  await requireActiveUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const { data } = await supabase
    .from('talks')
    .select(`${TALK_SELECT}, session:sessions(type, title, date, course:courses(name))`)
    .eq('id', id)
    .maybeSingle();
  const talk = data as unknown as EditRow | null;
  if (!talk || talk.session?.type !== k.type) notFound();
  // The talk's current lecturer stays selectable even if deactivated since.
  const { data: lecturers, error } = await supabase
    .from('lecturers')
    .select('id, full_name')
    .or(`active.eq.true,id.eq.${talk.lecturer_id}`)
    .order('full_name');
  if (error) throw new Error('Could not load lecturers');

  return (
    <div className="space-y-6">
      <h1>Edit {k.noun} talk</h1>
      <TalkForm
        kind={kind}
        sessionLabel={`${formatDate(talk.session.date)} · ${talk.session.course?.name ?? ''} · ${talk.session.title}`}
        lecturers={(lecturers ?? []).map((l) => ({ id: l.id as string, label: l.full_name as string }))}
        initial={{
          talkId: talk.id, sessionId: talk.session_id, start: formatTime(talk.starts_at), end: formatTime(talk.ends_at),
          lecturerId: talk.lecturer_id, topic: talk.topic, notes: talk.notes,
        }}
      />
    </div>
  );
}
```

Thin route files, six in total. Each uses one of these exact patterns.

`schedule/lectures/page.tsx`:

```tsx
import type { PageSearchParams } from '@/lib/search-params';
import { TalkDayView } from '../_talks/day-view';

export default function LecturesPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <TalkDayView kind="lectures" searchParams={searchParams} />;
}
```

`schedule/lectures/new/page.tsx`:

```tsx
import type { PageSearchParams } from '@/lib/search-params';
import { NewTalkPage } from '../../_talks/new-talk-page';

export default function NewLectureTalkPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <NewTalkPage kind="lectures" searchParams={searchParams} />;
}
```

`schedule/lectures/[id]/edit/page.tsx`:

```tsx
import { EditTalkPage } from '../../../_talks/edit-talk-page';

export default function EditLectureTalkPage({ params }: { params: Promise<{ id: string }> }) {
  return <EditTalkPage kind="lectures" params={params} />;
}
```

The `workshops/...` files are identical, with `kind="workshops"` and the component names `WorkshopsPage`, `NewWorkshopTalkPage` and `EditWorkshopTalkPage`.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npm test -- talk-form`, then `npx playwright test lectures courses schedule`
Expected: PASS. The `schedule` spec confirms the surgery grid still works under the new layout.

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/schedule" tests/e2e/lectures.spec.ts
git commit -m "feat(schedule): lectures and workshops tabs with talks (time, lecturer, topic)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification and PR

- [ ] **Step 1: Run the static checks and unit tests.**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all three pass, with 0 errors.

- [ ] **Step 2: Run the DB tests.**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 3: Run the full E2E suite (about 12 minutes).**

First check that nothing stale is listening on :3000 (`Get-NetTCPConnection -LocalPort 3000`).

Run: `npm run test:e2e`
Expected: PASS. Pay particular attention to `mobile.spec.ts` (phone project) and `schedule.spec.ts`. If `slot-placement` flakes on a leftover booking, rerun it once before investigating.

- [ ] **Step 4: Check the production build.**

Run: `npx next build`
Expected: success, with no Suspense or `useSearchParams` error from `schedule-tabs.tsx`. If that error appears, apply the Suspense wrap described in Task 5.

- [ ] **Step 5: Do a manual check at phone width.**

Run `npm run dev`. At 360px wide, check that `/schedule/lectures?date=<a seeded date>` has no horizontal scroll and that the talk rows wrap.

- [ ] **Step 6: Push the branch and open the PR.**

```bash
git push -u origin lectures-and-course-reports
"/c/Program Files/GitHub CLI/gh.exe" pr create --base master --title "Lecture & workshop schedule: talks with lecturer and topic" --body "<summary of tables, RPCs, screens, tests; note 0028 is additive>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Pushing and opening the PR is outward-facing, so confirm with the user before this step.
