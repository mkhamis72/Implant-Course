# Lecture & workshop schedule + course reports — design

Date: 2026-10-05 · Status: approved in chat, awaiting spec review

## Goal

1. Organizers fill lecture and workshop sessions with **talks**. Each talk has a time, a lecturer and a topic, the same way surgery sessions are filled with bookings.
2. Every course has a **report** for data analysis:
   - every implant placed in the course: who placed it, who assisted, the supervisor, the implant (brand, system, diameter, length, lot), torque, ISQ, bone type, technique, tooth and graft;
   - a summary for each surgery session and for the whole course.

## Decisions (from the brainstorm)

1. **Several talks per session.** A lecture or workshop session (for example 09:00–13:00) holds several talks, each with its own start/end, lecturer and topic.
2. **A separate Lecturers list**, maintained by admins on **Admin → Lecturers**. It is not shared with Supervisors.
3. **Room / location** is an optional field on the session, not on each talk. Workshops have the same fields as lectures.
4. The report is shown **on screen**, exported as **CSV** and has a **print view** (save as PDF from the browser).
5. **ISQ and bone type (D1–D4)** become optional fields when placing an implant, so they appear in the reports.

## Today

- `sessions.type` is already `lecture | workshop | surgery`, and all three can be created on the course page. Only surgery sessions have children (`surgery_slots`) and a schedule screen.
- `implant_sites` already holds:
  - `placing_delegate_id`, `assisting_delegate_id`, `supervisor_id`;
  - `product_id`, `stock_lot_id`;
  - `torque_ncm`, `technique`, `graft`, `placed_on`;
  - `course_id`, `session_id`, `slot_id`.
- ISQ and bone type are not recorded anywhere.
- `delegate_report` (latest: 0027) and `delegates/[id]/report.csv` are the template for the course report.

## Delivery

Two independent PRs, each with an additive migration (the previous app version runs against the new schema for a few minutes during a release).

- **PR A:** lectures and workshops, migration `0028_lectures.sql`.
- **PR B:** course report plus ISQ and bone type, migration `0029_course_report.sql`.

---

## PR A — Lectures & workshops

### Database (`0028_lectures.sql`)

**`public.lecturers`**
- Columns:
  - `id uuid pk default gen_random_uuid()`
  - `full_name text not null check (length(trim(full_name)) between 2 and 120)`
  - `active boolean not null default true`
  - `created_at`, `updated_at`
- Triggers: `set_updated_at` and `audit_row('id')`.
- Privileges are the same as `supervisors` (0024):
  - `grant select` to authenticated;
  - `grant insert (full_name, active)` and `grant update (full_name, active)`;
  - RLS: select needs `is_active_user()`, insert and update need `is_admin()`;
  - no delete; lecturers are deactivated instead.

**`sessions.room`**
- `text`, nullable, `check (room is null or length(trim(room)) between 1 and 120)`.
- Add `room` to the existing insert/update column grants on `sessions`.

**`public.talks`**
- Columns:
  - `id uuid pk`
  - `session_id → sessions on delete cascade`
  - `starts_at` / `ends_at timestamptz not null`, built from the session date with `cairo_ts` as for slots, with `check (ends_at > starts_at)`
  - `lecturer_id → lecturers not null`
  - `topic text not null`, 2–200 characters
  - `notes text`, at most 1000 characters
  - `created_at`, `created_by → profiles`, `updated_at`
- Triggers: `set_updated_at`, `audit_row('id')`.
- Indexes on `session_id`, `starts_at` and `lecturer_id`.
- Privileges: `grant select` to authenticated, with RLS select needing `is_active_user()`. There are no write grants; writes go only through the RPCs.

**RPCs**

All use `security definer set search_path = ''`, open with `perform app_private.require_active();`, raise business errors with `app_private.fail(...)`, and revoke from `public, anon` / grant to `authenticated`.

`create_talk(p_session uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default '') returns uuid` checks, in order:

| Rule | Error |
|---|---|
| Session exists and its type is `lecture` or `workshop` | "Choose a lecture or workshop session." |
| End is after start | "End time must be after the start time." |
| `p_start >= session.start_time` and `p_end <= session.end_time` | "The talk must fit within the session (HH:MM–HH:MM)." |
| Lecturer exists and is active | "Choose an active lecturer." |
| Topic is 2–200 characters after trimming | "Enter a topic." |

After those checks it:
- takes `pg_advisory_xact_lock(hashtext('talk-day:' || session.date))`;
- refuses an overlap with another talk in the same session: "Another talk in this session overlaps (HH:MM–HH:MM, topic).";
- refuses an overlap with the same lecturer's talk in any session: "<Lecturer> is already giving a talk at HH:MM–HH:MM.";
- inserts the talk.

Clashes are **hard errors**, with no override. Surgery uses an override because of chair pressure, but talks don't need one.

`update_talk(p_talk uuid, p_start time, p_end time, p_lecturer uuid, p_topic text, p_notes text default '') returns void`
- Same checks, excluding the talk itself.
- The session stays fixed.
- An inactive lecturer is accepted if they are already on the talk.

`delete_talk(p_talk uuid) returns void`
- A hard delete; talks carry no traceability.

`talks_on` is not needed: the day view reads sessions with their talks embedded.

`delete_course` needs no change: deleting a session cascades to its talks.

### App

**Admin → Lecturers**
- `admin/lecturers/` is a copy of `admin/supervisors/`: list, add, rename, deactivate.
- Add a tab in `admin/layout.tsx`.

**Schedule tabs**
- New `schedule/layout.tsx` with a `SectionNav`: Surgery `/schedule`, Lectures `/schedule/lectures`, Workshops `/schedule/workshops`.

**`/schedule/lectures` and `/schedule/workshops`**
- One shared server component, parameterised by type.
- `?date=`, read with `readParams()`, defaults to `todayIso()`. Previous/Next day links.
- One `.card` per session of that type on that date. Each card shows:
  - the course name and session title, the room, and the time range;
  - the talks in time order: time, lecturer, topic, then Edit and Delete (`ConfirmDelete`);
  - an "Add talk" link (`new?session=<id>`).
- Empty state: "No lecture sessions on this day — add one on the course page."

**New and edit pages**
- Routes: `…/new` and `…/[id]/edit`, sharing a client `talk-form.tsx`.
- Fields:
  - Session: this type, dated today or later, labelled "date · course · title". It is read-only when editing.
  - Start and End.
  - Lecturer: active lecturers plus the current one when editing. When the list is empty, it shows the hint "No lecturers yet — Admin → Lecturers".
  - Topic and Notes.
- Inputs are uncontrolled with `defaultValue={valueOf(state, …)}`.

**Actions**
- `createTalk`, `updateTalk` and `deleteTalk` each call `requireActiveUser()`, parse with Zod, call the RPC, and return `userMessage(error)` on failure.
- On success they redirect to the day view.

**Lib**
- `src/lib/schedule/talks.ts` holds `talkSchema`, a `TalkRow` type and `TALK_SELECT`, which embeds `lecturers!talks_lecturer_id_fkey(full_name)` and `sessions(...)`.

**Courses**
- `sessionSchema` and `session-form.tsx` get an optional Room field.
- The course page shows each session's room, and links lecture and workshop sessions to their schedule day, the way it already does for surgery.

### Tests

**DB** — `tests/db/talks.test.ts`, with a `makeLecturer` fixture:
- A talk in a surgery session is refused.
- A talk outside the session hours is refused.
- Overlapping talks in the same session are refused.
- Back-to-back talks are allowed.
- A lecturer double-booked across two sessions is refused.
- An inactive lecturer is refused on create but kept on edit.
- An organizer cannot insert into `lecturers`; an admin can.
- `talks` cannot be written directly.
- Deleting a course removes its talks.

**Unit**
- `talkSchema`.

**E2E** — `tests/e2e/lectures.spec.ts`, with a `seedLecturer` helper:
1. Seeds a course and a lecture session.
2. Adds a talk.
3. Sees the talk on the day view.
4. Edits it.
5. Gets the overlap error.
6. Deletes it.

---

## PR B — Course report + ISQ / bone type

### Database (`0029_course_report.sql`)

**New columns on `implant_sites`**
- `isq numeric(4,1) check (isq between 0 and 100)`, nullable.
- `bone_type text check (bone_type in ('D1','D2','D3','D4'))`, nullable.

**`place_implant`**
- Create a **new overload** from the latest definition (0027), with `p_isq numeric default null, p_bone_type text default null` added at the end. It stores both values.
- The existing 13-argument function is replaced by a wrapper that calls the new one with nulls, so the previous app version keeps working during the release.
- A later PR drops the wrapper.
- Grants go on both functions.

**`course_report(p_course uuid)`**
- `stable`, `security invoker`, modelled on `delegate_report`.
- Returns one row per implant that is neither planned nor removed, with these columns:
  - `site_id`;
  - `session_id`, `session_title`, `session_date`, `slot_start`;
  - `patient_name`, `file_no`, `tooth`, `state`, `placed_on`;
  - `placing_delegate`, `assisting_delegate`, `supervisor`;
  - `brand`, `system`, `platform`, `diameter_mm`, `length_mm`, `description`, `lot_no`;
  - `torque_ncm`, `isq`, `bone_type`, `technique`, `graft`;
  - `last_outcome`, the latest follow-up that isn't voided.
- **Which implants are included:**
  - every implant with `s.course_id = p_course`;
  - plus every implant with `s.course_id is null` whose `placed_on` falls within the course dates and whose placing delegate is enrolled in the course. These come back with a null session, and the UI shows them under "Not linked to a session".
- Ordered by session date, slot start, file number and tooth.

### Pure lib — `src/lib/reports/course-report.ts`

- `summarise(rows)` returns:
  - counts of implants and distinct patients;
  - counts by technique, by state and by bone type;
  - counts by implant size, keyed by `productLabel()`;
  - torque and ISQ statistics: n, mean, median, min and max, ignoring nulls;
  - per delegate: number placed, number assisted, mean torque;
  - per supervisor: count.
- `bySession(rows)` groups the rows by session, ordered by date, and gives each session its rows and `summarise`. The unlinked group comes last.
- `courseReportCsv(rows)`:
  - fixed column order, one row per implant;
  - ISO dates, raw numbers, empty cells for nulls;
  - built with `toCsv`, `csvFilename` and `contentDisposition` from `src/lib/csv.ts`.

### App

**`/courses/[id]/report`**
- `requireActiveUser()`, then the `course_report` RPC.
- **Header:** the course name and dates, with links to Download CSV and Print (reuse `schedule/pull-list/print-button.tsx`).
- **Course summary**, in cards:
  - totals;
  - the technique split;
  - torque and ISQ statistics;
  - bone types;
  - implant sizes.
- **Implants by delegate table:** placed, assisted, mean torque.
- **One section per surgery session:** the title, date and a summary line ("6 implants · 4 patients · torque 35 Ncm mean"). Below it, the implant table (`className="table"`, with `data-label` on every `<td>`) with these columns:
  - time and patient;
  - tooth;
  - implant and lot;
  - placed by, assisted by, supervisor;
  - torque, ISQ, bone type, technique.
- **Print:** `@media print` rules hide the nav and buttons, and avoid page breaks inside a session section.

**`/courses/[id]/report.csv`**
- A route handler copied from the delegate CSV route.

**Course page**
- Add a "Report" link in the header.

**Place-implant form**
- `placeSchema` gets an optional `isq` (0–100) and an optional `boneType` (`D1`–`D4`).
- The form gets two new fields: ISQ (number) and Bone type (select: — / D1 / D2 / D3 / D4).
- `implant-actions.ts` passes `p_isq` and `p_bone_type`.
- The patient's implant details show ISQ and bone type next to torque.

### Tests

**DB** — `tests/db/course-report.test.ts`:
- `place_implant` stores ISQ and bone type.
- `place_implant` rejects ISQ 150 and bone type D5.
- The old 13-argument call still works.
- `course_report` returns the placing and assisting delegates, the supervisor, the product and the torque.
- `course_report` excludes planned and removed implants.
- The unlinked fallback includes an enrolled delegate's placement within the course dates, and excludes one outside them.

**Unit**
- `summarise`: null handling, median with odd and even counts.
- `bySession`: ordering, with the unlinked group last.
- CSV: header order and empty cells.

**Component**
- The place form submits ISQ and bone type, with the action mocked.

**E2E**
1. Place an implant with ISQ and bone type.
2. Open the course report and see the row and the session summary.
3. Download the CSV and check its header.

## Out of scope

- Delegate attendance at lectures and workshops.
- Workshop materials taken from stock.
- Charts in the report.
- Adding ISQ or bone type to the delegate report; this is a possible follow-up.
