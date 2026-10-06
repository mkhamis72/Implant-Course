# Course Reports + ISQ / Bone Type (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every course gets a report for data analysis, shown on screen, as a print view and as a CSV.
- One row per implant placed in the course: who placed it, who assisted, the supervisor, the implant and lot, torque, ISQ, bone type, technique and graft.
- A summary for each surgery session and for the whole course.
- ISQ and bone type (D1–D4) are recorded when an implant is placed.

**Architecture:**
- **Migration `0035_course_report.sql`:**
  - adds `implant_sites.isq` and `implant_sites.bone_type`;
  - adds `place_implant_v2` (the latest `place_implant` plus the two fields), and turns `place_implant` into a thin wrapper around it so the previous app version keeps working;
  - adds `course_report(p_course)`, a security-invoker reader, so panel permissions apply through RLS.
- **Pure TypeScript** (`src/lib/reports/course-report.ts`) builds the summaries and the CSV.
- **App:** `/courses/[id]/report` (with `@media print`), `/courses/[id]/report.csv`, and two new place-form fields.

**Tech Stack:** Postgres/plpgsql (Supabase), Next.js 15 server components, Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-lectures-and-course-reports-design.md`, section "PR B". The changes from it are listed under Global Constraints.

**Run every command from `web/`.** Branch: `course-reports`, cut from `master` after #24.

## Global Constraints

- The migration number is **0035** (0028–0034 are taken).
- **Changed from the spec: a `v2` function, not an overload.** The spec proposed an overload of `place_implant` with two trailing defaulted parameters. The app calls it by parameter name through PostgREST, and two functions that both accept the 13 named arguments are **ambiguous** ("function is not unique"). So the new function is `public.place_implant_v2(...)`, and `place_implant` (same 13-argument signature) becomes a wrapper that calls v2 with null ISQ and bone type. A later PR can drop the wrapper.
- **Every write function starts with `perform app_private.require_perm('patients', 'edit');`.** The guard-rail test in `tests/db/permissions.test.ts` checks every security-definer function. `course_report` is `security invoker`, so it isn't checked and needs no guard.
- **Report visibility:**
  - The page needs Courses view: `requirePermission('courses')`.
  - Its rows come through RLS, so implants show only for users with Patients or Schedule view, and follow-ups only with Patients view.
  - The page shows `reportAccessNote(profile)` from `src/lib/auth/permissions.ts` when rows may be hidden.
  - The CSV route returns 403 without Courses view.
- **Copy:**
  - `ISQ (optional)` and `Bone type (optional)`.
  - Errors: `Enter an ISQ between 0 and 100.` and `Choose a bone type from D1 to D4.`
- **Dates** use `formatDate` / `formatTime`. CSV dates are ISO (`YYYY-MM-DD`) and numbers are unformatted.
- **Write with the Write/Edit tools** any file content containing `\` (Git Bash heredocs mangle it). No prettier: the repo has no prettier config.
- **Never edit an applied migration.**
  - Dry-run 0035 in a rolled-back transaction (`.superpowers/sdd/<plan>/dry-run-0035.ts`, run with `NODE_PATH="$PWD/node_modules" ALLOW_TEST_FIXTURES=1 npx tsx …`) **before** the first `npm run test:db`.
  - `npm run test:db` applies pending migrations on its first run.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The previous app version calls `place_implant` with 13 named arguments during the release window.** It must still work, storing null ISQ and bone type.
   - Task 1 test: "the old 13-argument call still works".
2. **A course with implants but no surgery sessions** (all placements unlinked) shows them under "Not linked to a session", not an empty report.
   - Task 1: the fallback test. Task 2: `bySession` puts the unlinked group last.
3. **Statistics with no values** (no torque recorded anywhere) show "—", not `NaN` or 0.
   - Task 2: `stats([null, null])` returns nulls.
4. **An organizer with Courses view only** opens the report and sees the access note, not "0 implants" presented as fact.
   - Task 3 E2E uses the `viewer`. It has Patients view, so add an assertion that the note is absent. The note-present path is covered by the existing `reportAccessNote` unit tests.
5. **Patient names with commas or a leading `=`** in the CSV stay one cell and are never treated as a spreadsheet formula.
   - Task 2: a `courseReportCsv` test with `'=Ali, Omar'`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0035_course_report.sql` (create) | columns, `place_implant_v2`, the `place_implant` wrapper, `course_report` |
| `tests/db/course-report.test.ts` (create) | DB rules |
| `tests/db/fixtures.ts` (modify) | `place()` gains `isq` and `boneType` and calls v2 |
| `src/lib/reports/course-report.ts` (+ `.test.ts`) (create) | `CourseReportRow`, `stats`, `summarise`, `bySession`, `courseReportCsv`, `implantLabel` |
| `src/lib/inventory/schemas.ts` (+ test) (modify) | `placeSchema.isq`, `placeSchema.boneType`, `BONE_TYPES` |
| `src/lib/inventory/types.ts` (modify) | `ImplantSite.isq`, `ImplantSite.bone_type` |
| `src/app/(app)/patients/[id]/implant-actions.ts` (modify) | call `place_implant_v2` |
| `src/app/(app)/patients/[id]/implant-forms.tsx` (+ test) (modify) | ISQ and Bone type fields |
| `src/app/(app)/patients/[id]/chart-data.ts`, `implant-section.tsx` (modify) | select and show ISQ and bone type |
| `src/app/(app)/courses/[id]/report/page.tsx` (create) | the report page |
| `src/app/(app)/courses/[id]/report.csv/route.ts` (create) | the CSV |
| `src/app/(app)/courses/[id]/page.tsx` (modify) | "Report" link |
| `tests/e2e/course-report.spec.ts` (create) | E2E |

---

### Task 1: Migration 0035 + DB tests

**Files:**
- Create: `supabase/migrations/0035_course_report.sql`
- Create: `tests/db/course-report.test.ts`
- Modify: `tests/db/fixtures.ts`

**Interfaces:**
- Produces:
  - `implant_sites.isq numeric(4,1)` (0–100, nullable)
  - `implant_sites.bone_type text` (`'D1'`–`'D4'`, nullable)
  - `public.place_implant_v2(...)`: the same 13 parameters with the same defaults, plus `p_isq numeric default null`, `p_bone_type text default null`; returns uuid
  - `public.course_report(p_course uuid)` returning `(site_id uuid, session_id uuid, session_title text, session_date date, slot_start timestamptz, patient_name text, file_no text, tooth smallint, state public.site_state, placed_on date, placing_delegate text, assisting_delegate text, supervisor text, brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text, lot_no text, torque_ncm numeric, isq numeric, bone_type text, technique text, graft text, last_outcome public.followup_outcome)`
  - fixture `place(c, {..., isq?, boneType?})`, which now calls v2

- [ ] **Step 1: Update the fixture.** In `tests/db/fixtures.ts`, change `place`:
  - Its parameter type gains `isq?: number; boneType?: string;`.
  - The SQL becomes:

```ts
  const { rows } = await c.query(
    `select public.place_implant_v2(
       p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4,
       p_placed_on => coalesce($5::date, current_date), p_placing_delegate => $6, p_supervisor => $7,
       p_assisting_delegate => $8, p_slot => $9, p_technique => $10, p_torque => $11, p_isq => $12, p_bone_type => $13) as id`,
    [a.patient, a.tooth, a.product, a.lot, a.placedOn ?? null, a.delegate, a.supervisor, a.assistant ?? null, a.slot ?? null,
     a.technique ?? null, a.torque ?? null, a.isq ?? null, a.boneType ?? null],
  );
```

  Also add `torque?: number;` to its parameter type.

- [ ] **Step 2: Write the failing DB tests.** Create `tests/db/course-report.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c, '2030-03-01', '2030-03-05');
  const session = await makeSession(c, course, 'surgery', '2030-03-02');
  const d1 = await makeDelegate(c, 'Zz Report Placer');
  const d2 = await makeDelegate(c, 'Zz Report Assistant');
  await enroll(c, course, d1);
  await enroll(c, course, d2);
  const product = await makeProduct(c);
  const lot = await receive(c, product, 10, 'ZZREP');
  return { chair, course, session, d1, d2, product, lot };
}

describe('ISQ and bone type at placement', () => {
  it('place_implant_v2 stores ISQ and bone type; out-of-range values are refused', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const patient = await makePatient(c, 'Zz Report Isq');
      const site = await place(c, { patient, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer,
        technique: 'guided', torque: 35, isq: 72.5, boneType: 'D2', placedOn: '2026-01-10' });
      const { rows } = await c.query('select torque_ncm::float as t, isq::float as isq, bone_type from public.implant_sites where id = $1', [site]);
      expect(rows[0]).toEqual({ t: 35, isq: 72.5, bone_type: 'D2' });
      await refused(c, () => place(c, { patient, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, isq: 150, placedOn: '2026-01-10' }), /Enter an ISQ between 0 and 100/);
      await refused(c, () => place(c, { patient, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, boneType: 'D5', placedOn: '2026-01-10' }), /Choose a bone type from D1 to D4/);
    });
  });

  it('the old 13-argument place_implant call still works and stores no ISQ', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const patient = await makePatient(c, 'Zz Report Old Call');
      const { rows } = await c.query(
        `select public.place_implant(p_patient => $1, p_tooth => 36::smallint, p_product => $2, p_lot => $3,
           p_placed_on => '2026-01-10', p_placing_delegate => $4, p_supervisor => $5, p_torque => 30, p_technique => 'free_hand') as id`,
        [patient, w.product, w.lot, w.d1, users.organizer],
      );
      const s = await c.query('select torque_ncm::float as t, isq, bone_type from public.implant_sites where id = $1', [rows[0].id]);
      expect(s.rows[0]).toEqual({ t: 30, isq: null, bone_type: null });
    });
  });
});

describe('course_report', () => {
  it('lists placed implants with delegates, supervisor, product and measurements; skips planned ones', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const p1 = await makePatient(c, 'Zz Report One');
      const p2 = await makePatient(c, 'Zz Report Two');
      const slot = await book(c, { session: w.session, chair: w.chair, patient: p1, supervisor: users.organizer, placing: [w.d1], assisting: [w.d2], implants: [{ tooth: 36 }, { tooth: 46 }] });
      await place(c, { patient: p1, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, assistant: w.d2, supervisor: users.organizer,
        slot, technique: 'guided', torque: 40, isq: 70, boneType: 'D3', placedOn: '2026-01-10' });
      await book(c, { session: w.session, chair: w.chair, patient: p2, supervisor: users.organizer, placing: [w.d2], implants: [{ tooth: 11 }], start: '11:00', end: '12:00' });
      const { rows } = await c.query('select * from public.course_report($1)', [w.course]);
      expect(rows).toHaveLength(1); // tooth 46 of p1 and tooth 11 of p2 are still planned
      expect(rows[0]).toMatchObject({
        session_title: 'Test Session', patient_name: 'Zz Report One', tooth: 36, state: 'placed',
        placing_delegate: 'Zz Report Placer', assisting_delegate: 'Zz Report Assistant', supervisor: 'Test Organizer',
        brand: 'Test Brand', lot_no: 'ZZREP', technique: 'guided', bone_type: 'D3',
      });
      expect(Number(rows[0].torque_ncm)).toBe(40);
      expect(Number(rows[0].isq)).toBe(70);
    });
  });

  it('includes unlinked placements by enrolled delegates within the course dates only', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const outsider = await makeDelegate(c, 'Zz Report Outsider');
      const p = await makePatient(c, 'Zz Report Unlinked');
      // place_implant validates "today or earlier", so the course must be in the past for unlinked placements.
      const past = await makeCourse(c, '2026-01-05', '2026-01-15');
      await enroll(c, past, w.d1);
      await place(c, { patient: p, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, placedOn: '2026-01-10' });
      await place(c, { patient: p, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, placedOn: '2026-01-20' });
      await place(c, { patient: p, tooth: 11, product: w.product, lot: w.lot, delegate: outsider, supervisor: users.organizer, placedOn: '2026-01-10' });
      const { rows } = await c.query('select tooth, session_id from public.course_report($1) order by tooth', [past]);
      expect(rows).toEqual([{ tooth: 36, session_id: null }]);
    });
  });

  it('shows nothing to an organizer without Patients or Schedule view', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const p = await makePatient(c, 'Zz Report Hidden');
      const slot = await book(c, { session: w.session, chair: w.chair, patient: p, supervisor: users.organizer, placing: [w.d1], implants: [{ tooth: 36 }] });
      await place(c, { patient: p, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, slot, placedOn: '2026-01-10' });
      await c.query('reset role');
      await c.query('delete from public.user_permissions where user_id = $1', [users.target]);
      await c.query(`insert into public.user_permissions values ($1, 'courses', 'view')`, [users.target]);
      await actAs(c, users.target);
      const { rows } = await c.query('select count(*)::int as n from public.course_report($1)', [w.course]);
      expect(rows[0].n).toBe(0);
    });
  });
});
```

Notes for the implementer:
- `makeCourse(c, start, end)` and `makeSession(c, course, type, date)` exist (`tests/db/fixtures.ts`).
- The booked session is dated 2030, but placement validates "today or earlier", so tests use `placedOn: '2026-01-10'`. Booking only needs the session date in the course, and placing on a slot doesn't check that the dates match. If `place_implant` refuses because the slot's date is in the future, take the placement date from the session check and record a Ruling.
- `book` sets `course_id` and `session_id` on the planned sites.

- [ ] **Step 3: Run the tests to verify they fail, without applying a migration.** 0035 doesn't exist yet, so `npm run test:db -- course-report` only runs tests. Expected: FAIL, with `function public.place_implant_v2 … does not exist` or a missing `course_report`.

- [ ] **Step 4: Write `0035_course_report.sql`.**

```sql
-- Course reports: ISQ and bone type at placement, and one row per implant placed in a course.

alter table public.implant_sites add column isq numeric(4,1) check (isq is null or isq between 0 and 100);
alter table public.implant_sites add column bone_type text check (bone_type is null or bone_type in ('D1', 'D2', 'D3', 'D4'));
```

Then **`place_implant_v2`**:
- Copy `create or replace function public.place_implant(` … `$$;` from `0030_permissions.sql` (its latest definition), verbatim.
- Rename it to `create function public.place_implant_v2(`.
- Add `, p_isq numeric default null, p_bone_type text default null` after `p_technique text default null`.
- After the torque check, add:

```sql
  if p_isq is not null and (p_isq < 0 or p_isq > 100) then
    perform app_private.fail('Enter an ISQ between 0 and 100.');
  end if;
  if p_bone_type is not null and p_bone_type not in ('D1', 'D2', 'D3', 'D4') then
    perform app_private.fail('Choose a bone type from D1 to D4.');
  end if;
```

- In the `update public.implant_sites set …`, add `isq = p_isq, bone_type = p_bone_type,` after `torque_ncm = p_torque,`.
- In the `insert … (…, torque_ncm, graft, …)`, add the columns `isq, bone_type` after `torque_ncm`, and the values `p_isq, p_bone_type` after `p_torque`.

Then the wrapper, with the same signature as before, so `create or replace` keeps its grants:

```sql
-- The previous app version (and anything else) still calls the 13-argument function: delegate to v2.
create or replace function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default '', p_slot uuid default null,
  p_technique text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  return public.place_implant_v2(
    p_patient => p_patient, p_tooth => p_tooth, p_product => p_product, p_lot => p_lot, p_placed_on => p_placed_on,
    p_placing_delegate => p_placing_delegate, p_supervisor => p_supervisor, p_assisting_delegate => p_assisting_delegate,
    p_torque => p_torque, p_graft => p_graft, p_notes => p_notes, p_slot => p_slot, p_technique => p_technique);
end $$;
```

Then **`course_report`**:

```sql
-- Security invoker: panel permissions apply through RLS (implants need Patients or Schedule view).
create function public.course_report(p_course uuid)
returns table (
  site_id uuid, session_id uuid, session_title text, session_date date, slot_start timestamptz,
  patient_name text, file_no text, tooth smallint, state public.site_state, placed_on date,
  placing_delegate text, assisting_delegate text, supervisor text,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text, lot_no text,
  torque_ncm numeric, isq numeric, bone_type text, technique text, graft text, last_outcome public.followup_outcome
)
language sql stable security invoker set search_path = '' as $$
  select s.id, se.id, se.title, se.date, o.starts_at,
         p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pd.full_name, ad.full_name, sv.full_name,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         s.torque_ncm, s.isq, s.bone_type, s.technique, s.graft,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null order by f.date desc, f.created_at desc limit 1)
  from public.courses c
  join public.implant_sites s on s.course_id = c.id
    or (s.course_id is null and s.placed_on between c.start_date and c.end_date
        and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = s.placing_delegate_id))
  join public.patients p on p.id = s.patient_id
  left join public.sessions se on se.id = s.session_id
  left join public.surgery_slots o on o.id = s.slot_id
  left join public.delegates pd on pd.id = s.placing_delegate_id
  left join public.delegates ad on ad.id = s.assisting_delegate_id
  left join public.supervisors sv on sv.id = s.supervisor_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where c.id = p_course and s.state not in ('planned', 'removed')
  order by se.date nulls last, o.starts_at nulls last, p.file_no, s.tooth;
$$;

revoke execute on function public.place_implant_v2(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric, text) from public, anon;
grant execute on function public.place_implant_v2(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric, text) to authenticated;
revoke execute on function public.course_report(uuid) from public, anon;
grant execute on function public.course_report(uuid) to authenticated;
```

- [ ] **Step 5: Dry-run 0035.**
  - Write `dry-run-0035.ts` in the plan's workspace (the pattern is in `.superpowers/sdd/…/dry-run-0034.ts` from PR C, or the template in the scratchpad). It runs `begin`, the file, a check, then `rollback`.
  - The check: as `icm-test-organizer`, `select count(*) from public.course_report(<any course id>)` runs, and `select proname from pg_proc where proname like 'place_implant%'` returns both functions.
  - Expected: it applies and both checks print.

- [ ] **Step 6: Apply and verify GREEN.**
  - Run `npm run test:db -- course-report permissions`. Expected: PASS. The guard rail still passes because both functions contain `require_perm(`.
  - Then run `npm run test:db` (full). Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add supabase/migrations/0035_course_report.sql tests/db/course-report.test.ts tests/db/fixtures.ts
git commit -m "feat(db): ISQ and bone type at placement; course_report (0035)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure report library

**Files:**
- Create: `src/lib/reports/course-report.ts`
- Create: `src/lib/reports/course-report.test.ts`

**Interfaces:**
- Produces:

```ts
export type CourseReportRow = {
  site_id: string; session_id: string | null; session_title: string | null; session_date: string | null; slot_start: string | null;
  patient_name: string; file_no: string; tooth: number; state: string; placed_on: string | null;
  placing_delegate: string | null; assisting_delegate: string | null; supervisor: string | null;
  brand: string | null; system: string | null; platform: string | null; diameter_mm: number | string | null; length_mm: number | string | null;
  description: string | null; lot_no: string | null;
  torque_ncm: number | string | null; isq: number | string | null; bone_type: string | null; technique: string | null; graft: string;
  last_outcome: string | null;
};
export type Stats = { n: number; mean: number | null; median: number | null; min: number | null; max: number | null };
export type Summary = {
  implants: number; patients: number;
  byTechnique: Record<string, number>; byState: Record<string, number>; byBoneType: Record<string, number>; bySize: Record<string, number>;
  torque: Stats; isq: Stats;
  delegates: { name: string; placed: number; assisted: number; meanTorque: number | null }[];
  supervisors: { name: string; count: number }[];
};
export type SessionGroup = { sessionId: string | null; title: string; date: string | null; rows: CourseReportRow[]; summary: Summary };
export function stats(values: (number | string | null)[]): Stats;
export function implantLabel(r: CourseReportRow): string;   // "Oxy PSK Ø4.0 × 10 mm" or "—"
export function summarise(rows: CourseReportRow[]): Summary;
export function bySession(rows: CourseReportRow[]): SessionGroup[]; // dated sessions first by date, unlinked group last ("Not linked to a session")
export function courseReportCsv(rows: CourseReportRow[]): string;
```

PostgREST returns `numeric` as a JSON number, but treat strings defensively by passing them through `Number()`.

- [ ] **Step 1: Failing tests.** Create `src/lib/reports/course-report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bySession, courseReportCsv, implantLabel, stats, summarise, type CourseReportRow } from './course-report';

const base: CourseReportRow = {
  site_id: 's1', session_id: 'se1', session_title: 'Day 1 surgery', session_date: '2030-03-02', slot_start: '2030-03-02T07:00:00Z',
  patient_name: 'Amal Hassan', file_no: 'P00012', tooth: 36, state: 'placed', placed_on: '2030-03-02',
  placing_delegate: 'Dr One', assisting_delegate: 'Dr Two', supervisor: 'Prof Laila',
  brand: 'Oxy', system: 'PSK', platform: null, diameter_mm: 4, length_mm: 10, description: '', lot_no: 'L1',
  torque_ncm: 35, isq: 70, bone_type: 'D2', technique: 'guided', graft: '', last_outcome: null,
};
const row = (over: Partial<CourseReportRow>): CourseReportRow => ({ ...base, ...over });

describe('stats', () => {
  it('ignores missing values and handles odd and even counts', () => {
    expect(stats([35, null, 45, 40])).toEqual({ n: 3, mean: 40, median: 40, min: 35, max: 45 });
    expect(stats([30, '40'])).toEqual({ n: 2, mean: 35, median: 35, min: 30, max: 40 });
  });
  it('returns nulls when nothing was recorded', () => {
    expect(stats([null, null])).toEqual({ n: 0, mean: null, median: null, min: null, max: null });
  });
});

describe('summarise', () => {
  it('counts implants, patients, techniques, bone types, sizes, people', () => {
    const s = summarise([
      base,
      row({ site_id: 's2', tooth: 46, technique: 'free_hand', bone_type: null, torque_ncm: null, isq: 80, placing_delegate: 'Dr Two', assisting_delegate: null }),
      row({ site_id: 's3', patient_name: 'Omar', file_no: 'P00013', state: 'failed', length_mm: 11.5 }),
    ]);
    expect(s.implants).toBe(3);
    expect(s.patients).toBe(2);
    expect(s.byTechnique).toEqual({ guided: 2, free_hand: 1 });
    expect(s.byState).toEqual({ placed: 2, failed: 1 });
    expect(s.byBoneType).toEqual({ D2: 2, 'Not recorded': 1 });
    expect(s.bySize).toEqual({ 'Oxy PSK Ø4.0 × 10 mm': 2, 'Oxy PSK Ø4.0 × 11.5 mm': 1 });
    expect(s.torque).toEqual({ n: 2, mean: 35, median: 35, min: 35, max: 35 });
    expect(s.delegates).toEqual([
      { name: 'Dr One', placed: 2, assisted: 0, meanTorque: 35 },
      { name: 'Dr Two', placed: 1, assisted: 2, meanTorque: null },
    ]);
    expect(s.supervisors).toEqual([{ name: 'Prof Laila', count: 3 }]);
  });
});

describe('bySession', () => {
  it('orders sessions by date and puts unlinked placements last', () => {
    const groups = bySession([
      row({ site_id: 'a', session_id: null, session_title: null, session_date: null, slot_start: null }),
      row({ site_id: 'b', session_id: 'se2', session_title: 'Day 2', session_date: '2030-03-03' }),
      base,
    ]);
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([['Day 1 surgery', 1], ['Day 2', 1], ['Not linked to a session', 1]]);
    expect(groups[0].summary.implants).toBe(1);
  });
});

describe('courseReportCsv', () => {
  it('writes one analysis-friendly row per implant', () => {
    const csv = courseReportCsv([row({ patient_name: '=Ali, Omar', torque_ncm: null })]).replace(/^﻿/, '');
    const [head, line] = csv.trim().split(/\r?\n/);
    expect(head).toBe(
      'Session,Session date,Patient,File,Tooth,Placed on,State,Placed by,Assisted by,Supervisor,Brand,System,Diameter (mm),Length (mm),Implant,Lot,Torque (Ncm),ISQ,Bone type,Technique,Graft,Last follow-up',
    );
    expect(line).toBe(
      `Day 1 surgery,2030-03-02,"'=Ali, Omar",P00012,36,2030-03-02,Placed,Dr One,Dr Two,Prof Laila,Oxy,PSK,4,10,Oxy PSK Ø4.0 × 10 mm,L1,,70,D2,Guided,,`,
    );
  });
  it('labels a site without a product as —', () => {
    expect(implantLabel(row({ brand: null }))).toBe('—');
  });
});
```

The `﻿` and `\r?\n` contain backslashes, so **create this file with the Write tool**.

- [ ] **Step 2: Run it and verify RED.** `npm test -- reports/course-report`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** `src/lib/reports/course-report.ts`:

```ts
import { toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';

export type CourseReportRow = {
  site_id: string; session_id: string | null; session_title: string | null; session_date: string | null; slot_start: string | null;
  patient_name: string; file_no: string; tooth: number; state: string; placed_on: string | null;
  placing_delegate: string | null; assisting_delegate: string | null; supervisor: string | null;
  brand: string | null; system: string | null; platform: string | null; diameter_mm: number | string | null; length_mm: number | string | null;
  description: string | null; lot_no: string | null;
  torque_ncm: number | string | null; isq: number | string | null; bone_type: string | null; technique: string | null; graft: string;
  last_outcome: string | null;
};
export type Stats = { n: number; mean: number | null; median: number | null; min: number | null; max: number | null };
export type Summary = {
  implants: number; patients: number;
  byTechnique: Record<string, number>; byState: Record<string, number>; byBoneType: Record<string, number>; bySize: Record<string, number>;
  torque: Stats; isq: Stats;
  delegates: { name: string; placed: number; assisted: number; meanTorque: number | null }[];
  supervisors: { name: string; count: number }[];
};
export type SessionGroup = { sessionId: string | null; title: string; date: string | null; rows: CourseReportRow[]; summary: Summary };

const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function stats(values: (number | string | null)[]): Stats {
  const xs = values.map(num).filter((v): v is number => v !== null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, mean: null, median: null, min: null, max: null };
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { n: xs.length, mean: round1(xs.reduce((a, b) => a + b, 0) / xs.length), median, min: xs[0], max: xs[xs.length - 1] };
}

export function implantLabel(r: CourseReportRow): string {
  if (!r.brand) return '—';
  return productLabel({
    type: 'implant', brand: r.brand, system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '',
    diameter_mm: num(r.diameter_mm), length_mm: num(r.length_mm),
  });
}

const tally = (keys: string[]) => keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

export function summarise(rows: CourseReportRow[]): Summary {
  const people = new Map<string, { placed: number; assisted: number; torques: (number | string | null)[] }>();
  const person = (name: string) => people.get(name) ?? people.set(name, { placed: 0, assisted: 0, torques: [] }).get(name)!;
  for (const r of rows) {
    if (r.placing_delegate) {
      const p = person(r.placing_delegate);
      p.placed += 1;
      p.torques.push(r.torque_ncm);
    }
    if (r.assisting_delegate) person(r.assisting_delegate).assisted += 1;
  }
  const sup = tally(rows.map((r) => r.supervisor).filter((s): s is string => Boolean(s)));
  return {
    implants: rows.length,
    patients: new Set(rows.map((r) => r.file_no)).size,
    byTechnique: tally(rows.map((r) => r.technique ?? 'not_set')),
    byState: tally(rows.map((r) => r.state)),
    byBoneType: tally(rows.map((r) => r.bone_type ?? 'Not recorded')),
    bySize: tally(rows.map(implantLabel)),
    torque: stats(rows.map((r) => r.torque_ncm)),
    isq: stats(rows.map((r) => r.isq)),
    delegates: [...people.entries()]
      .map(([name, p]) => ({ name, placed: p.placed, assisted: p.assisted, meanTorque: stats(p.torques).mean }))
      .sort((a, b) => b.placed - a.placed || a.name.localeCompare(b.name)),
    supervisors: Object.entries(sup).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export const UNLINKED = 'Not linked to a session';

export function bySession(rows: CourseReportRow[]): SessionGroup[] {
  const groups = new Map<string, { sessionId: string | null; title: string; date: string | null; rows: CourseReportRow[] }>();
  for (const r of rows) {
    const key = r.session_id ?? '__unlinked';
    if (!groups.has(key)) groups.set(key, { sessionId: r.session_id, title: r.session_title ?? UNLINKED, date: r.session_date, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => (a.sessionId === null ? 1 : b.sessionId === null ? -1 : (a.date ?? '').localeCompare(b.date ?? '')))
    .map((g) => ({ ...g, summary: summarise(g.rows) }));
}

export function courseReportCsv(rows: CourseReportRow[]): string {
  return toCsv(
    ['Session', 'Session date', 'Patient', 'File', 'Tooth', 'Placed on', 'State', 'Placed by', 'Assisted by', 'Supervisor',
      'Brand', 'System', 'Diameter (mm)', 'Length (mm)', 'Implant', 'Lot', 'Torque (Ncm)', 'ISQ', 'Bone type', 'Technique', 'Graft', 'Last follow-up'],
    rows.map((r) => [
      r.session_title ?? UNLINKED, r.session_date ?? '', r.patient_name, r.file_no, r.tooth, r.placed_on ?? '',
      SITE_STATE_LABELS[r.state as SiteState] ?? r.state, r.placing_delegate ?? '', r.assisting_delegate ?? '', r.supervisor ?? '',
      r.brand ?? '', r.system ?? '', num(r.diameter_mm), num(r.length_mm), r.brand ? implantLabel(r) : '', r.lot_no ?? '',
      num(r.torque_ncm), num(r.isq), r.bone_type ?? '', r.technique ? TECHNIQUE_LABELS[r.technique as Technique] : '', r.graft,
      r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '',
    ]),
  );
}
```

- [ ] **Step 4: Verify GREEN.** `npm test -- reports/course-report`. Expected: PASS.
  - If the `bySize` label for 11.5 renders differently (`fmtMm`), adjust **the test** to `productLabel`'s real output and record a Ruling. The label format belongs to `productLabel`, not this module.

- [ ] **Step 5: Commit.** `feat(reports): course report summaries and CSV`.

---

### Task 3: Report page, print view, CSV route, course link

**Files:**
- Create: `src/app/(app)/courses/[id]/report/page.tsx`
- Create: `src/app/(app)/courses/[id]/report.csv/route.ts`
- Modify: `src/app/(app)/courses/[id]/page.tsx` (add the Report link next to the `<h1>`)
- Create: `tests/e2e/course-report.spec.ts`

**Interfaces:**
- Consumes: `course_report` (Task 1); `bySession`, `summarise`, `stats`, `implantLabel`, `courseReportCsv`, `CourseReportRow`, `UNLINKED` (Task 2); `requirePermission`, `getCurrentProfile` (`src/lib/auth/session.ts`); `canView`, `reportAccessNote` (`src/lib/auth/permissions.ts`); `PrintButton` (`src/app/(app)/schedule/pull-list/print-button.tsx`); `csvFilename`, `contentDisposition` (`src/lib/csv.ts`).

- [ ] **Step 1: Failing E2E.** Create `tests/e2e/course-report.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, enroll, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

test('course report shows each placed implant, a session summary, and downloads a CSV', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const api = await apiAs(TEST_USERS.organizer.email);
  const supervisor = (await api.auth.getUser()).data.user!.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const courseName = uniqueName('Report course');
  const courseId = await seedCourse(api, { name: courseName, start: today, end: today });
  const session = await seedSession(api, { courseId, type: 'surgery', title: 'Report surgery', date: today });
  const chair = await seedChair(admin, uniqueName('Chair'));
  const placer = uniqueName('Dr Placer');
  const assistant = uniqueName('Dr Assist');
  const d1 = await seedDelegate(api, placer);
  const d2 = await seedDelegate(api, assistant);
  await enroll(api, courseId, d1);
  await enroll(api, courseId, d2);
  const { productId, lotId } = await seedImplantStock(api, uniqueName('Brand'));
  const patient = uniqueName('Report patient');
  const { data: p } = await api.from('patients').insert({ full_name: patient }).select('id').single();
  const { data: slot, error: bookError } = await api.rpc('create_surgery_slot', {
    p_session: session, p_chair: chair, p_start: '23:00', p_end: '23:30', p_patient: p!.id, p_supervisor: supervisor,
    p_placing: [d1], p_assisting: [d2], p_implants: [{ tooth: 36, technique: 'guided' }], p_override_reason: 'E2E report',
  });
  expect(bookError).toBeNull();
  const { error: placeError } = await api.rpc('place_implant_v2', {
    p_patient: p!.id, p_tooth: 36, p_product: productId, p_lot: lotId, p_placed_on: today, p_placing_delegate: d1,
    p_supervisor: supervisor, p_assisting_delegate: d2, p_slot: slot, p_technique: 'guided', p_torque: 35, p_isq: 72, p_bone_type: 'D2',
  });
  expect(placeError).toBeNull();

  await login(page, TEST_USERS.viewer.email);
  await page.goto(`/courses/${courseId}`);
  await page.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(courseName);
  await expect(page.getByText(/only shown to users with access to Patients/)).toHaveCount(0);
  const section = page.getByTestId('report-session').filter({ hasText: 'Report surgery' });
  await expect(section).toContainText('1 implant');
  const implant = section.getByTestId('report-implant').filter({ hasText: patient });
  await expect(implant).toContainText(placer);
  await expect(implant).toContainText(assistant);
  await expect(implant).toContainText('35');
  await expect(implant).toContainText('72');
  await expect(implant).toContainText('D2');
  await expect(page.getByTestId('report-delegates')).toContainText(placer);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const text = await (await file.createReadStream())!.toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(text).toContain('Session,Session date,Patient,File');
  expect(text).toContain(patient);
});
```

- Check `seedImplantStock`'s real return shape in `tests/e2e/api.ts` (lines 35–43) and adapt the destructuring. If it returns something else, use `seedProduct` + `receiveStock`.
- The booking at 23:00 avoids clashes with other specs.

Run `npx playwright test course-report`. Expected: FAIL. The rpc `place_implant_v2` exists once Task 1 is applied, but the "Report" link doesn't exist yet.

- [ ] **Step 2: The page.** Create `src/app/(app)/courses/[id]/report/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { reportAccessNote } from '@/lib/auth/permissions';
import { formatDate, formatTime } from '@/lib/format';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';
import type { Course } from '@/lib/schedule/types';
import { bySession, implantLabel, summarise, type CourseReportRow, type Stats, type Summary } from '@/lib/reports/course-report';
import { PrintButton } from '../../../schedule/pull-list/print-button';

const dash = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));
const statLine = (label: string, s: Stats, unit = '') =>
  s.n === 0 ? `${label}: not recorded` : `${label}: mean ${s.mean}${unit} · median ${s.median}${unit} · range ${s.min}–${s.max}${unit} (n=${s.n})`;
const counts = (rec: Record<string, number>, label: (k: string) => string = (k) => k) =>
  Object.entries(rec).map(([k, n]) => `${label(k)} ${n}`).join(' · ') || '—';
const techniqueLabel = (k: string) => (k === 'not_set' ? 'Not set' : TECHNIQUE_LABELS[k as Technique] ?? k);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function SummaryLine({ s }: { s: Summary }) {
  return (
    <p className="text-sm">
      {plural(s.implants, 'implant')} · {plural(s.patients, 'patient')} · {counts(s.byTechnique, techniqueLabel)}
      {s.torque.n > 0 && <> · torque {s.torque.mean} Ncm mean</>}
      {s.isq.n > 0 && <> · ISQ {s.isq.mean} mean</>}
    </p>
  );
}

export default async function CourseReportPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('courses');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: course }, { data, error }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('course_report', { p_course: id }),
  ]);
  if (!course) notFound();
  if (error) throw new Error('Could not load the course report');
  const c = course as Course;
  const rows = (data ?? []) as CourseReportRow[];
  const all = summarise(rows);
  const sessions = bySession(rows);
  const note = reportAccessNote(profile);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="page-header">
        <div>
          <h1>Report · {c.name}</h1>
          <p className="text-muted">
            {formatDate(c.start_date)} – {formatDate(c.end_date)}
            {c.venue && <> · {c.venue}</>}
          </p>
        </div>
        <div className="flex items-center gap-3 print:hidden">
          <Link href={`/courses/${c.id}`} className="text-accent hover:underline">Back to course</Link>
          <a href={`/courses/${c.id}/report.csv`} className="btn-secondary btn" download>Download CSV</a>
          <PrintButton />
        </div>
      </div>
      {note && <p className="rounded-md bg-warn-soft p-3 text-sm text-warn">{note}</p>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        <div className="card space-y-1">
          <h2 className="font-semibold">Totals</h2>
          <p className="text-sm">{plural(all.implants, 'implant')} · {plural(all.patients, 'patient')}</p>
          <p className="text-sm text-muted">{counts(all.byState, (k) => SITE_STATE_LABELS[k as SiteState] ?? k)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Technique</h2>
          <p className="text-sm">{counts(all.byTechnique, techniqueLabel)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Stability</h2>
          <p className="text-sm">{statLine('Torque', all.torque, ' Ncm')}</p>
          <p className="text-sm">{statLine('ISQ', all.isq)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Bone type</h2>
          <p className="text-sm">{counts(all.byBoneType)}</p>
        </div>
        <div className="card space-y-1 sm:col-span-2">
          <h2 className="font-semibold">Implant sizes</h2>
          <p className="text-sm">{counts(all.bySize)}</p>
        </div>
      </section>

      <section className="card space-y-2 break-inside-avoid" data-testid="report-delegates">
        <h2 className="font-semibold">Implants by delegate</h2>
        {all.delegates.length === 0 ? (
          <p className="text-sm text-muted">No implants placed yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Delegate</th><th>Placed</th><th>Assisted</th><th>Mean torque (Ncm)</th></tr></thead>
            <tbody>
              {all.delegates.map((d) => (
                <tr key={d.name}>
                  <td data-label="Delegate">{d.name}</td>
                  <td data-label="Placed">{d.placed}</td>
                  <td data-label="Assisted">{d.assisted}</td>
                  <td data-label="Mean torque (Ncm)">{dash(d.meanTorque)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {sessions.map((g) => (
        <section key={g.sessionId ?? 'unlinked'} data-testid="report-session" className="card space-y-2 break-inside-avoid">
          <h2 className="font-semibold">
            {g.title}
            {g.date && <span className="font-normal text-muted"> · {formatDate(g.date)}</span>}
          </h2>
          <SummaryLine s={g.summary} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th><th>Patient</th><th>Tooth</th><th>Implant</th><th>Lot</th><th>Placed by</th><th>Assisted by</th>
                  <th>Supervisor</th><th>Torque</th><th>ISQ</th><th>Bone</th><th>Technique</th><th>State</th><th>Last follow-up</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.site_id} data-testid="report-implant">
                    <td data-label="Time">{r.slot_start ? formatTime(r.slot_start) : r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                    <td data-label="Patient">{r.patient_name} ({r.file_no})</td>
                    <td data-label="Tooth">{r.tooth}</td>
                    <td data-label="Implant">{implantLabel(r)}</td>
                    <td data-label="Lot">{dash(r.lot_no)}</td>
                    <td data-label="Placed by">{dash(r.placing_delegate)}</td>
                    <td data-label="Assisted by">{dash(r.assisting_delegate)}</td>
                    <td data-label="Supervisor">{dash(r.supervisor)}</td>
                    <td data-label="Torque">{dash(r.torque_ncm)}</td>
                    <td data-label="ISQ">{dash(r.isq)}</td>
                    <td data-label="Bone">{dash(r.bone_type)}</td>
                    <td data-label="Technique">{r.technique ? TECHNIQUE_LABELS[r.technique as Technique] : '—'}</td>
                    <td data-label="State">{SITE_STATE_LABELS[r.state as SiteState] ?? r.state}</td>
                    <td data-label="Last follow-up">{r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {sessions.length === 0 && <p className="card text-muted">No implants placed in this course yet.</p>}
    </div>
  );
}
```

Check:
- `PrintButton`'s export name and props in `schedule/pull-list/print-button.tsx`.
- Whether `break-inside-avoid` exists in Tailwind v4; it does, as `break-inside-avoid`.
- The nav and `SectionNav` already carry `print:hidden`.

- [ ] **Step 3: The CSV route.** Create `src/app/(app)/courses/[id]/report.csv/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { contentDisposition, csvFilename } from '@/lib/csv';
import { courseReportCsv, type CourseReportRow } from '@/lib/reports/course-report';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.active || !canView(profile, 'courses')) return new NextResponse('Not allowed', { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [{ data: course }, { data, error }] = await Promise.all([
    supabase.from('courses').select('name').eq('id', id).maybeSingle(),
    supabase.rpc('course_report', { p_course: id }),
  ]);
  if (!course || error) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(courseReportCsv((data ?? []) as CourseReportRow[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(csvFilename(`${course.name} report`, id)),
    },
  });
}
```

- [ ] **Step 4: The course page link.** In `courses/[id]/page.tsx`, replace `<h1>{c.name}</h1>` with:

```tsx
      <div className="page-header">
        <h1>{c.name}</h1>
        <Link href={`/courses/${c.id}/report`} className="btn-secondary btn">Report</Link>
      </div>
```

- [ ] **Step 5: Verify GREEN.** Run `npx tsc --noEmit`, `npm run lint` and `npx playwright test course-report courses permissions`. Expected: PASS.

- [ ] **Step 6: Commit.** `feat(courses): course report page, print view and CSV`.

---

### Task 4: ISQ and bone type on the place form, and on the chart

**Files:**
- Modify: `src/lib/inventory/schemas.ts` (+ `schemas.test.ts`), `src/lib/inventory/types.ts`
- Modify: `src/app/(app)/patients/[id]/implant-actions.ts`, `implant-forms.tsx` (+ `implant-forms.test.tsx`), `chart-data.ts`, `implant-section.tsx`

**Interfaces:**
- Consumes: `place_implant_v2` (Task 1).
- Produces:
  - `BONE_TYPES = ['D1','D2','D3','D4'] as const`
  - `placeSchema` gains `isq: number | null` and `boneType: 'D1'|'D2'|'D3'|'D4' | null`
  - `ImplantSite.isq: number | null` and `ImplantSite.bone_type: string | null`

- [ ] **Step 1: Failing tests.**

In `src/lib/inventory/schemas.test.ts`, inside the existing `placeSchema` describe (or a new one if there isn't one), using the file's existing valid placement fixture `place` (create one if absent, with all required fields from `placeSchema`):

```ts
describe('placeSchema ISQ and bone type', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const ok = { patientId: id, tooth: '36', productId: id, lotId: id, placedOn: '2020-01-01', placingDelegateId: id, supervisorId: id, technique: 'guided' };
  it('accepts blanks as not recorded', () => {
    expect(placeSchema.parse({ ...ok, isq: '', boneType: '' })).toMatchObject({ isq: null, boneType: null });
  });
  it('accepts valid values and refuses others', () => {
    expect(placeSchema.parse({ ...ok, isq: '72.5', boneType: 'D2' })).toMatchObject({ isq: 72.5, boneType: 'D2' });
    expect(placeSchema.safeParse({ ...ok, isq: '101' }).error?.issues[0].message).toBe('Enter an ISQ between 0 and 100.');
    expect(placeSchema.safeParse({ ...ok, boneType: 'D5' }).error?.issues[0].message).toBe('Choose a bone type from D1 to D4.');
  });
});
```

In `implant-forms.test.tsx`, add (the file already mocks `./implant-actions` and builds `data`):

```tsx
  it('sends ISQ and bone type with the placement', async () => {
    const { placeImplant } = await import('./implant-actions');
    vi.mocked(placeImplant).mockResolvedValue({});
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, supervisors: [{ id: 'sup1', label: 'Prof' }] }} onDone={() => {}} plannedProductId="p1" />);
    fireEvent.change(screen.getByLabelText(/ISQ/), { target: { value: '72' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Bone type/ }), { target: { value: 'D2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save placement' }));
    expect(vi.mocked(placeImplant).mock.calls.at(-1)?.[0]).toMatchObject({ isq: '72', boneType: 'D2' });
  });
```

Check how `useSubmit` calls the action. If it passes the input as the first argument, the assertion above holds; adapt the index to the real call.

- [ ] **Step 2: Verify RED.** `npm test -- inventory/schemas implant-forms`

- [ ] **Step 3: Implement.**

In `src/lib/inventory/schemas.ts`:
- Add `export const BONE_TYPES = ['D1', 'D2', 'D3', 'D4'] as const;`.
- Add to `placeSchema`, after `torque`:

```ts
  isq: optionalNumber(0, 100, 'Enter an ISQ between 0 and 100.'),
  boneType: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : v),
    z.enum(BONE_TYPES, { message: 'Choose a bone type from D1 to D4.' }).nullable(),
  ),
```

`optionalNumber` already exists in that file and is used by `torque`.

In `types.ts` `ImplantSite`, add `isq: number | null; bone_type: string | null;` after `torque_ncm`.

In `chart-data.ts` `SITE_SELECT`, add `isq, bone_type` after `torque_ncm`.

In `implant-actions.ts` `placeImplant`:
- The RPC name becomes `'place_implant_v2'`.
- Add `p_isq: p.isq, p_bone_type: p.boneType,`.

In `implant-forms.tsx` `PlaceForm`:
- Initial state gains `isq: '', boneType: ''`.
- After `<TorqueField …/>` add:

```tsx
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ISQ (optional)">
          <input className="input" inputMode="decimal" value={v.isq} onChange={(e) => set('isq')(e.target.value)} />
        </Field>
        <Field label="Bone type (optional)">
          <select className="input" value={v.boneType} onChange={(e) => set('boneType')(e.target.value)}>
            <option value="">—</option>
            {BONE_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
      </div>
```

- Import `BONE_TYPES` from `@/lib/inventory/schemas`.
- `Field` renders a `<label>` wrapping its children (check). If not, give the input `aria-label="ISQ"` so `getByLabelText(/ISQ/)` finds it.

In `implant-section.tsx` `SiteDetails` facts, after the torque fact add:

```ts
    site.isq !== null && site.isq !== undefined ? `ISQ ${site.isq}` : null,
    site.bone_type ? `Bone ${site.bone_type}` : null,
```

Add `isq: null, bone_type: null` to any `ImplantSite` literals in tests (`npx tsc --noEmit` will list them).

- [ ] **Step 4: Verify GREEN.** Run `npm test` (all unit tests), `npx tsc --noEmit`, and `npx playwright test implants slot-placement`. The existing placement specs must stay green.

- [ ] **Step 5: Commit.** `feat(patients): record ISQ and bone type when placing an implant`.

---

### Task 5: Docs and full verification

- [ ] **Docs.** Add a CLAUDE.md Architecture bullet:
  - `place_implant_v2` (0035) is what the app calls.
  - `place_implant` is a 13-argument wrapper kept for the release window; a later PR drops it.
  - `course_report(course)` is security invoker; implants show only with Patients or Schedule view.
- [ ] **Verification.**
  - Run `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run test:db`.
  - Run `npx next build`.
  - Run the full E2E in three foreground parts. Check free memory first; the harness kills background runs under memory pressure.
  - Manually: open a course report, print-preview it (the nav is hidden and sessions don't split across pages), and open the CSV in Excel (Arabic names and the Ø sign display correctly).
- [ ] **Final whole-branch review** (fresh reviewer, most capable model), then a fix pass, then ask before pushing and opening the PR.
