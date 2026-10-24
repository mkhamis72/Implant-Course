# Statistics Module + Dates Limited at Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Research out of Patients into a top-level **Statistics** module that opens on a course, limit implant-related date pickers to possible dates, close the X-ray gap in SQL, then remove the Data quality page.

**Architecture:** Route move with redirects; no rename of `src/lib/research/` or of the `research` permission area (label only). Date limits are `min`/`max` on uncontrolled `<input type="date">` computed from data the pages already load; the database stays the authority. One additive migration (0075). Data quality removal is a second PR after a one-off read-only prod check.

**Tech Stack:** Next.js 15 App Router, React 19, Vitest + Testing Library, Supabase Postgres (plpgsql), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-statistics-module-design.md`

## Global Constraints

- All commands from `web/`. Work on a new branch `feat/statistics-module` from `master` (the current `docs/claude-md` branch is separate).
- Page title "Statistics & data analysis"; nav label and permission label "Statistics". The SQL area name stays `research`.
- Every filter stays visible on the Results page: course, placed from/to, placing delegate, brand, line/type, Compare by. Nothing collapsed or moved to another tab.
- "All courses" = `course=all`; an absent/empty `course` = the default course.
- Migrations: never edit an applied one; `create or replace` the latest definition, same signature (no new overload). Backward-compatible (the previous app version runs against it for minutes).
- Styling: tokens and shared classes only (`.btn`, `.input`, `.label`, `.card`, `SectionNav`). No Prettier.
- Dates: `todayIso()` (`src/lib/dates.ts`), never `new Date()` formatting.

## Review Focus

1. `course=all` in an old export-log row or drill-down link → Recent exports shows "All courses", not a blank/raw "all" (test in Task 2).
2. An organizer with Research None but Patients View → no Statistics nav item, `/statistics` and `/patients/research` (via redirect) both refuse like today (test in Task 1).
3. A restoration on several implants placed on different days → the fitted-date `min` is the *latest* placement; ticking/unticking updates it (test in Task 3).
4. Editing an existing record whose stored date is now outside `min`/`max` (legacy row) → the form still opens and shows the stored value; the browser only flags it on submit (test in Task 3: `defaultValue` kept even when < min).
5. A planning X-ray dated before placement → still accepted by picker and SQL (tests in Tasks 3 and 4).

---

### Task 1: Move Research to `/statistics` with nav, label and redirects

**Files:**
- Move (git mv): `src/app/(app)/patients/research/` → `src/app/(app)/statistics/` (all 26 files incl. `CLAUDE.md`)
- Delete: `src/app/(app)/patients/research-link.tsx`, `research-link.test.tsx`; its use in `src/app/(app)/patients/page.tsx`
- Modify: `src/components/nav-items.ts`, `src/components/nav-items.test.ts`, `src/lib/auth/permissions.ts:15`, `next.config.ts`, `src/lib/research/view.ts:118,123`, `src/lib/research/studies.ts:17`, `statistics/export-panel.tsx`, `statistics/filter-form.tsx`, `statistics/page.tsx`, `statistics/studies/page.tsx`, `statistics/studies/actions.ts`, moved tests with `/patients/research` strings, `tests/e2e/{research,research-export,studies,consent}.spec.ts`, root `CLAUDE.md` and `src/app/(app)/patients/CLAUDE.md` pointers

**Interfaces:**
- Produces: route base `/statistics`; `researchHref(f)` → `/statistics?…`; `drilldownHref` → `/statistics/drilldown?…`; `studyLetterHref(id)` → `/statistics/studies/${id}/letter`; export form action `/statistics/export`; R script `/statistics/analysis.R`.

- [ ] **Step 1: Branch.** `git switch master && git pull && git switch -c feat/statistics-module`; commit the spec + this plan first.
- [ ] **Step 2: Failing tests.** In `nav-items.test.ts`: admin sees labels `[..., 'Delegates', 'Statistics', 'Admin']`; organizer with `research: 'none'` doesn't see Statistics; with `research: 'view'` does. Update `view.test.ts`, `research-view.test.tsx:119`, `export-panel.test.tsx:12`, `study-list.test.tsx:29` to the new paths.
- [ ] **Step 3: Run** `npm test -- nav-items view research-view export-panel study-list` → FAIL.
- [ ] **Step 4: Implement.** `git mv` the folder; add `{ href: '/statistics', label: 'Statistics', area: 'research' }` after Delegates; `AREA_LABELS.research = 'Statistics'`; replace every `/patients/research` string (grep `src tests next.config.ts` until none remain outside the redirect); `outputFileTracingIncludes` keys → `/statistics/export`, `/statistics/analysis.R`; add to `next.config.ts`:
  ```ts
  async redirects() {
    return [{ source: '/patients/research/:path*', destination: '/statistics/:path*', permanent: false },
            { source: '/patients/research', destination: '/statistics', permanent: false }];
  },
  ```
  `revalidatePath('/statistics')`, `('/statistics/studies')`. Studies page back-link label "Statistics". Remove the Research link from Patients.
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`, `npm run lint` → PASS. Grep `patients/research` → only `next.config.ts` redirects.
- [ ] **Step 6: E2E.** Update the four specs' URLs; add to `research.spec.ts`: `page.goto('/patients/research?course=all')` → `expect(page).toHaveURL(/\/statistics\?course=all/)`. Run `npx playwright test research research-export studies consent` → PASS.
- [ ] **Step 7: Docs + commit.** Update moved `statistics/CLAUDE.md` paths (`/patients/research…` → `/statistics…`), root `CLAUDE.md` feature-rules line (`web/src/app/(app)/statistics/CLAUDE.md`: Statistics page …). `git commit -m "feat: Statistics module replaces Patients → Research"`.

### Task 2: Results / Export & studies tabs and the default course

**Files:**
- Create: `src/app/(app)/statistics/layout.tsx`, `src/app/(app)/statistics/data/page.tsx` (tab href `/statistics/data`; not `/statistics/export`, which is the download route and can't also hold a page)
- Modify: `src/lib/research/view.ts` (+ `view.test.ts`), `statistics/page.tsx`, `statistics/filter-form.tsx` (+ test), `statistics/export-panel.tsx` (+ test)

**Interfaces:**
- Produces: `defaultCourse(courses: { id: string; start_date: string }[], today: string): string` in `src/lib/research/view.ts` — id of the first course (input already ordered start_date desc) with `start_date <= today`, else `'all'`. `ALL_COURSES = 'all'` constant exported from the same file.

- [ ] **Step 1: Failing tests.**
  - `view.test.ts`: `defaultCourse([{id:'b',start_date:'2026-12-01'},{id:'a',start_date:'2026-10-01'}], '2026-10-24') === 'a'`; all future → `'all'`; empty → `'all'`. `rpcArgs({...f, course: 'all'}).p_course === null`; `filterQuery` keeps `course=all`.
  - `filter-form.test.tsx`: the "All courses" option has value `all`; course select is the first field; all six filter fields render.
  - `export-panel.test.tsx`: an ExportLog row with `filters.course = 'all'` shows "All courses".
- [ ] **Step 2: Run** `npm test -- view filter-form export-panel` → FAIL.
- [ ] **Step 3: Implement.** `statistics/page.tsx`: fetch `course_options` (already fetched; select `start_date` too) and, when `requested.course === ''`, set it to `defaultCourse(courses, todayIso())` before `loadResearch` (load courses first, then research). Heading `Statistics & data analysis`; subtitle unchanged; header buttons: none (tabs replace them). Results page drops `ExportForm`/`ExportLog`. `statistics/data/page.tsx`: `requirePermission('research')`, same Patients-view note, renders `ExportForm` (filters from params with the same default course), `ExportLog`, links to Studies and the R script. `layout.tsx`: `<SectionNav label="Statistics" items={[{ href: '/statistics', label: 'Results' }, { href: '/statistics/data', label: 'Export & studies' }]} />` above `children`. "Clear filters" link → `/statistics` (default course).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5: E2E.** In `research.spec.ts`: with a seeded course started yesterday, `/statistics` shows that course selected in the Course combobox; choosing "All courses" + Apply keeps "All courses" after reload. Adjust `research-export.spec.ts` to open `/statistics/data`. Run the two specs → PASS.
- [ ] **Step 6: Commit** `feat(statistics): opens on the latest course; export on its own tab`.

### Task 3: Date pickers limited to possible dates

**Files:**
- Modify: `src/lib/dates.ts` (+ `dates.test.ts`); `src/app/(app)/patients/[id]/` `implant-forms.tsx`, `surgical-details.tsx`, `visits.tsx`, `complications.tsx`, `failure-box.tsx`, `impression-control.tsx`, `restorations.tsx`, `corrections.tsx`, `xrays/radiograph-form.tsx`, `overview/medical-history-form.tsx`, `consent/consent-form.tsx`, `notes/note-form.tsx`; `patients/new/patient-form.tsx`; component tests next to `restorations.tsx` and `radiograph-form.tsx`
- Pages that render these forms pass the reference dates they already have (`placed_on` on site rows, restoration `fitted_on`).

**Interfaces:**
- Produces: `latestDate(dates: (string | null | undefined)[]): string | undefined` and `earliestDate(...)` in `src/lib/dates.ts` (ISO strings compare lexically; ignore empty).

- [ ] **Step 1: Failing tests.**
  - `dates.test.ts`: `latestDate(['2026-01-02', null, '2026-03-01']) === '2026-03-01'`; `latestDate([]) === undefined`; same for `earliestDate`.
  - restorations component test: two implants placed `2026-01-10` and `2026-02-20`; tick both → fitted input `min="2026-02-20"`, `max` = mocked today; untick the second → `min="2026-01-10"`. An existing restoration with stored `fitted_on` `2026-01-01` opens with that value (Review Focus 4).
  - radiograph-form test: teeth with an implant placed `2026-03-01`; purpose Baseline → `min="2026-03-01"`; purpose Planning → no `min`; always `max` = today.
- [ ] **Step 2: Run** `npm test -- dates restorations radiograph-form` → FAIL.
- [ ] **Step 3: Implement** the helpers, then the `min`/`max` per the spec table:
  - placement date: `max` today; extraction date `max` = placement value (live if the field is in the same form, else stored).
  - component fitted, visit/follow-up, complication noticed, failure, scan/impression: `min` = site `placed_on`, `max` today; complication resolved `min` = noticed.
  - restoration fitted: `min` = `latestDate` of ticked sites' `placed_on` (track ticks in state only for this; the input itself stays uncontrolled with `defaultValue`), `max` today; restoration problem `min` = its restoration's `fitted_on`.
  - X-ray: `max` today; when purpose ≠ planning, `min` = `earliestDate` of `placed_on` of implants on the chosen teeth (per tooth, the first implant, as 0068 did).
  - DOB, HbA1c, consent signed, note date, correction dates: `max` today only.
  - Remount keys from the React 19 gotcha stay as they are.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5: E2E smoke.** In the restorations spec: open the fitted-date input of a new restoration → `toHaveAttribute('min', placedOn)`. Run `npx playwright test restorations xrays implants` → PASS.
- [ ] **Step 6: Commit** `feat(patients): date pickers offer only possible dates`.

### Task 4: Migration 0075 — X-ray not before placement

**Files:**
- Create: `web/supabase/migrations/0075_xray_before_placement.sql`
- Modify: `web/tests/db/radiographs.test.ts`, `web/tests/db/placement-course.test.ts` (or wherever `correct_placement_v2` is tested)

**Interfaces:**
- Consumes: latest `public.save_radiograph(p_id, p_patient, p_taken_on, p_type, p_purpose, p_teeth, p_link, p_notes, p_levels, p_expected_updated_at)` from `0065`; latest `public.correct_placement_v2` from `0062`.

- [ ] **Step 1: Failing DB tests.**
  - radiographs: patient with implant on tooth 16 placed `2026-03-01`; `save_radiograph` purpose `baseline`, teeth `{16}`, `2026-02-01` → error `A non-planning X-ray can't be before the placement date (2026-03-01).`; purpose `planning` same date → ok; teeth `{17}` (no implant) → ok.
  - placement: implant with a baseline X-ray on its tooth dated `2026-03-05`; `correct_placement_v2` to `2026-03-10` → error message containing `can't be placed after its first component, restoration, X-ray, follow-up, complication or failure (2026-03-05)`; also an impression (`taken_on`) of `2026-03-04` counts.
- [ ] **Step 2: Dry-run** the migration in a rolled-back tx (scratchpad tsx with `pgConfig()`), then `npm run test:db -- radiographs placement` → the new tests FAIL before the file exists (write the tests first, then the file).
- [ ] **Step 3: Write 0075.** `create or replace` both functions copied from their latest definitions, same signatures. In `save_radiograph`, after the teeth are validated: if `p_purpose <> 'planning'`, take the minimum over chosen teeth of each tooth's earliest `implant_sites.placed_on` for the patient; if `p_taken_on <` it, `app_private.fail(format('A non-planning X-ray can''t be before the placement date (%s).', v_placed))`. In `correct_placement_v2`, add to the `v_first` union: non-voided non-planning radiographs of the patient whose teeth contain the site's tooth, and the site's own impression `taken_on`; update the message to `…first component, restoration, X-ray, scan, follow-up, complication or failure (%s).` Keep grants (same signature).
- [ ] **Step 4: Run** `npm run test:db` (full, includes `permissions.test.ts`) → PASS.
- [ ] **Step 5: Docs + commit.** Add a line to `patients/CLAUDE.md` X-ray rules (0075). `git commit -m "fix(db): X-ray and scan dates checked against placement (0075)"`.

### Task 5: Verify and ship PR 1

- [ ] **Step 1:** `./scripts/ship.sh verify research research-export studies consent restorations xrays implants` → all green.
- [ ] **Step 2:** Remind the owner to make the repo public before the deploy (memory rule), then the owner runs `./scripts/ship.sh ship`. After it's live (1–3 min after the deploy hook): Statistics in nav, `/patients/research` redirects.

### Task 6 (PR 2): One-off prod check, then remove Data quality

**Files:**
- Create (scratchpad, not committed): `dq-check.ts` — reads `select patient_name, file_no, tooth, message from public.data_quality_issues(null)` via `pgConfig()` with `ENV_FILE=.env.prod`, prints a table.
- Delete: `src/app/(app)/patients/data-quality/`, `src/lib/data-quality/`, `tests/e2e/data-quality.spec.ts`
- Modify: `src/app/(app)/patients/page.tsx` (link), `src/app/(app)/patients/[id]/layout.tsx`, `implant-section.tsx`, `chart-data.ts` (badges), `src/lib/inventory/types.ts` (unused type), their tests, `patients/CLAUDE.md` (Outcomes line: "`data_quality_issues` has no UI since 2026-10; kept for one-off checks")

- [ ] **Step 1:** Ask the owner before reading prod; run the script; give them the list. Wait until they say the rows are fixed (or that none need fixing).
- [ ] **Step 2:** New branch `chore/remove-data-quality` from `master`. Delete/modify the files; grep `data-quality|data_quality_issues|Date problem` in `src tests` → only CLAUDE.md mentions remain.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npx playwright test patients implants` → PASS. Keep the SQL function (no migration).
- [ ] **Step 4:** Commit `chore: remove the Data quality page and Date problem badges`; owner ships.
