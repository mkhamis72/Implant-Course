# Research page (part 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/patients/research` page showing 5a's outcome numbers (tiles, survival curve, ICOI breakdown, complications, drill-down lists), filterable by course, placement dates, placing delegate and brand / type, behind a new View-only "Research" permission.

**Architecture:**
- Migration 0069 adds the `research` permission area and two filtering wrappers, `implant_outcomes_detail` and `crown_outcomes_detail`, over the 5a readers.
- A pure TS module computes the summaries and the Kaplan–Meier points from reader rows (display only).
- A server page renders tiles, inline SVG and the drill-downs.

**Tech Stack:** Supabase SQL (security invoker), Next.js 15 server components, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-research-page-design.md`

## Global Constraints

**Process**
- Work from `web/`. Migration 0069 is additive. Dry-run it before `test:db`.

**Permission**
- Area key `research`, label `'Research'`. Levels are None / View only, and `set_user_permissions` refuses `edit` for research.
- Admins always have it. New organizers default to None: `default_permissions()` does not insert `research`. Existing organizers are untouched. Delegates never have it.
- Readers are `security invoker` and gate on `(select public.can('research','view'))`. The underlying 5a readers also need Patients view.

**Calculations**
- Survival % = survived / (survived + failed). It is always shown as "N of M", with "n not reached" and "n lost to follow-up" (`unknown`) underneath. M < 30 shows "small sample".
- Denominators are all placed implants in the filter.
- ICOI groups: I, II, III, IV, "Not assessable", "Not yet graded" (`latest_grade` null).
- Complication % = implants with ≥ 1 complication (biological / mechanical) out of all placed implants in the filter.
- Crown tile: remade / final restorations, using crowns with at least one implant in the filtered set.
- Kaplan–Meier: time is `follow_up_days` converted to months (days / 30.4375), the event is `event`, and rows with `event_time_unknown` are excluded (their count is shown under the chart).

**Copy**
- Page title "Research", with the version from `outcomes_version()` in the header.
- No-patients-view note: "Research needs View on Patients to read the records".
- No-product note: "N implants have no product recorded".

**Display**
- Inline SVG with design tokens, no chart dependency.
- Tables use `className="table"` and `data-label`. The layout is phone-friendly.

## Review Focus
1. **A filter with zero implants** shows tiles with "0 of 0" and "—", not NaN or a division by zero. (Task 2 test.)
2. **Survival denominators:** not_reached and unknown are never in the denominator. (Task 2 test.)
3. **A crown on two implants** where only one matches the brand filter is still counted, once. (Task 1 test.)
4. **Research View without Patients View** shows the note, not empty tiles. (Task 3 test.)
5. **A Kaplan–Meier step at a tied time** (an event and a censoring on the same day) handles events before censoring at that time. (Task 2 test.)

---

### Task 1: Migration 0069 — research permission + filtered readers

**Files:**
- Create: `supabase/migrations/0069_research.sql`
- Modify: `src/lib/auth/permissions.ts`: `AREAS` gains `'research'`, `AREA_LABELS.research = 'Research'`, and research is View-only (the permission grid hides Edit for it). Also the admin permission grid (`src/app/(app)/admin/users/permission-grid.tsx` and its test).
- Test: `tests/db/research.test.ts`; update `tests/db/permissions.test.ts` only as it requires.

**Interfaces:**
- Produces:
  - **Permission plumbing:** the area check on `user_permissions` widened to include `research` (via a new check constraint, replacing the 0030 one), and `set_user_permissions` accepting `research` (view / none only). Copy the latest bodies from 0030 / 0034.
  - `public.implant_outcomes_detail(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text)`
    - Returns every column of `implant_outcomes`, plus `placing_delegate_id uuid, placing_delegate text, brand text, system text, product_id uuid, patient_name text, file_no text`.
    - Null params mean no filter. `p_brand` / `p_system` match `products.brand` / `products.system` exactly. Implants with no product appear only when both are null.
  - `public.crown_outcomes_detail(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text)`
    - Returns every `crown_outcomes` column, plus `patient_name text, file_no text`.
    - Includes a crown when at least one implant under it is in `implant_outcomes_detail(...)` with the same params (distinct per crown).
  - Both are security invoker, gated by `can('research','view')`, with grants to authenticated.

- [ ] **Step 1: Write the failing tests:**
  - DB:
    - an admin can read both readers;
    - an organizer with Patients view but no research row gets 0 rows;
    - granting research view returns rows;
    - `set_user_permissions` with research edit is refused;
    - a new organizer has no research row;
    - the filters: delegate, brand, system, course and date;
    - Review Focus 3 (a crown on two implants, one matching).
  - Unit: the permission grid shows Research with None / View only.
- [ ] **Step 2: Run** `npm run test:db -- research` and `npm test -- permission`. Expected: FAIL.
- [ ] **Step 3: Write 0069** (dry-run it) and the TS changes.
- [ ] **Step 4: Run** `npm run test:db -- research permissions outcomes crown-outcomes` and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: research permission and filtered outcome readers (0069)`

### Task 2: Research summaries + Kaplan–Meier (pure TS)

**Files:**
- Create: `src/lib/research/summary.ts` (+ `.test.ts`)

**Interfaces:**
- Produces:
  - `type ImplantRow` (the `implant_outcomes_detail` columns used) and `type CrownRow`.
  - `survivalAt(rows: ImplantRow[], key: 'year_1' | 'year_2'): { survived: number; failed: number; notReached: number; unknown: number; pct: number | null; small: boolean }`
  - `icoiBreakdown(rows): Record<'I' | 'II' | 'III' | 'IV' | 'not_assessable' | 'not_graded', number>`
  - `complications(rows): { implants: number; biological: number; mechanical: number; biologicalPct: number | null; mechanicalPct: number | null }`
  - `crownSummary(crowns: CrownRow[]): { finals: number; remade: number; problems: number }`
  - `kaplanMeier(rows): { points: { month: number; survival: number }[]; atRisk: { month: 0 | 12 | 24; n: number }[]; excludedUnknownTime: number }`
  - `formatPct(pct: number | null): string`: `'—'` for null, else one decimal place, e.g. `'97.8%'`.

- [ ] **Step 1: Write the failing tests:**
  - `survivalAt`:
    - 88 survived, 2 failed, 41 not reached, 15 unknown → pct 97.8 and small false;
    - with M = 25 → small true;
    - with 0 rows → pct null (Review Focus 1, 2).
  - `icoiBreakdown` counts a null `latest_grade` as not_graded.
  - `complications` percentages and the zero-row case.
  - `kaplanMeier`:
    - 4 rows with events at 6 and 12 months and censoring at 9 → survival steps at 6 (0.75) and 12 (0.5);
    - a tie at month 6 with one event and one censored row → the event is applied first, giving 0.75 (Review Focus 5);
    - an unknown-time row is excluded and counted.
- [ ] **Step 2: Run** `npm test -- research`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- research`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: research summaries and Kaplan–Meier`

### Task 3: Research page

**Files:**
- Create: `src/app/(app)/patients/research/page.tsx`, `research/survival-chart.tsx` (SVG), `research/drilldown/page.tsx` (sub-route listing rows behind a number, e.g. `?list=year_1_failed`) (+ tests)
- Modify: the patients list page (add a "Research" link beside "Data quality", shown only with Research view); `src/lib/auth/session.ts` if `requirePermission` needs the new area typed.

**Interfaces:**
- Consumes: Task 1 readers, Task 2 functions.
- **Page:**
  - `requirePermission('research')`.
  - Reads filters from the URL with `readParams`: `course`, `from`, `to`, `delegate`, `brand`, `system`.
  - The filter form submits by GET. Its options come from courses (`course_options`), delegates, and the brands/systems present in the rows.
  - It renders:
    - the tiles: Implants, Survival at 1 year, Survival at 2 years, Crowns remade;
    - the curve with "Number at risk" under it;
    - the ICOI bars;
    - complications;
    - the no-product note.
  - Each number links to `/patients/research/drilldown?list=<key>&<same filters>`.
- **Drilldown page:** `requirePermission('research')`. A table of patient (link to the chart), tooth, placed, the relevant status, and the grade with its reason.
- **No Patients view:** the page shows the note instead of tiles (Review Focus 4).

- [ ] **Step 1: Write the failing tests** (mock the rpc in component/page tests as other pages do):
  - tiles render "88 of 90", "97.8%" and "small sample" when appropriate;
  - the ICOI shows Not assessable and Not yet graded;
  - a drilldown link carries the filters;
  - the note shows without Patients view;
  - the Research link is hidden without Research view.
- [ ] **Step 2: Run** `npm test -- research`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): research page with tiles, survival curve and drill-down`

### Task 4: E2E + docs

**Files:**
- Create: `tests/e2e/research.spec.ts`
- Modify: `CLAUDE.md`: a **Research page (0069)** bullet covering the permission, the readers, the summaries in `src/lib/research/`, and the drill-down.

- [ ] **Step 1: Write the spec.** As an admin, seed two implants through `placeImplant` with a unique brand. Visit `/patients/research?brand=<brand>`. Expect "Implants" to show 2, and the drilldown of implants to list both names. Then, as the organizer test user without research permission (set through the admin API helper or a DB update), `/patients/research` is refused.
- [ ] **Step 2: Run** `npx playwright test research` (check :3000 and memory first). Expected: PASS.
- [ ] **Step 3: Docs.**
- [ ] **Step 4: Verify** with `./scripts/ship.sh verify research`. Expected: "Verified".
- [ ] **Step 5: Commit** `test(e2e): research page; docs`
