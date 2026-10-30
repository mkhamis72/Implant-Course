# Course Overview (Statistics → Courses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Statistics tab at `/statistics/courses` listing every course by start date with its aggregates, a side-by-side comparison for ticked courses, and links into Explore.

**Architecture:** No migration. The page reads the existing Explore readers (0078, unfiltered) and `course_options()` on the server; a pure TS module in `src/lib/analysis/` turns the rows into per-course summaries and metric rows. The page is a server component; ticking is a GET form (`c=<id>` repeated), so no client code and no chart.

**Tech Stack:** Next.js 15 server components, TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-explore-clinical-data-design.md` (Screens → Courses; Anti-goals; Access). Read `web/src/app/(app)/statistics/CLAUDE.md` first.

## Global Constraints

- Branch from `master`: `feat/explore-courses`. Run commands from `web/`.
- "per course by start date — implants, patients, systems, dimension mix, follow-up completion, prosthetic completion, complication counts, measurement availability; side-by-side for ticked courses; "N of M", no ranking; link into Explore."
- No "best/worst" wording and no ordering by outcome: courses stay in `course_options` order (start date, newest first).
- No percentage without its denominator. This page shows "k of n" and no percentages. "—" only when n = 0.
- Never hide a number because data is thin: show it and warn. Thin = under 30 implants (the Results "small sample" rule).
- Access as Explore: `requirePermission('research')`; without Patients view show `<NoPatientsNote />` and read nothing. Delegates never.
- Don't change Results, Studies, Recent exports or Explore behaviour. `loadExplore` keeps its result.
- Styling: `.card`, `.table` with `data-label` on every `<td>`, `.btn`, `.rule-warn`/`.text-warn`; no raw palette colours. Dates through `formatDate`, today through `todayIso()`.

## Metric definitions (builder's calls; the owner confirms in plan review)

| Metric | k | n |
|---|---|---|
| Follow-up, per window `early`, `m3`, `m6`, `m12`, `m24` | implants with an `attended` visit in the window | implants whose window has closed (`today - placed_on > to`) and that had not failed before it (`failedOn < from` excluded, as `observations.ts`). Open or future windows count as `pending`, shown separately. |
| Prosthetic completion | implants with `final_restoration_on` | implants that have not failed, plus failed ones that already had a final restoration |
| Complications | event counts: biological, mechanical, restoration problems; plus implants with any of them, as k of all implants | |
| Measurement availability | implants with: torque, ISQ at placement, bone type, an X-ray with a mesial or distal level, attended-visit probing, attended-visit recession (any of the three) | all implants of the course |

Implants with no course (`course_id` null) get a final row "No course recorded" using the `NONE` id, so no implant disappears.

## Review Focus

- A course with no implants yet (new or future course): the row shows 0 implants and "—" for every ratio, never "0 of 0" or a crash. Test: Task 1.
- A hand-edited or stale `c=` value, or the same id twice: dropped or deduplicated, the page still renders. Test: Task 1.
- Only one course ticked: no comparison table, a prompt to tick another; its numbers stay in the list. Test: Task 2.
- A long course name or many ticked courses on a 360px phone: the comparison stacks by `data-label` and the page has no horizontal overflow. Test: Task 2 (markup), manual check at 360px in Task 3.
- A missed visit or a voided visit in a window does not count as completed (`attendance` other than `attended`; voided rows are never returned by the reader). Test: Task 1.

---

### Task 1: Pure course summaries

**Files:**
- Create: `web/src/lib/analysis/course-overview.ts`
- Test: `web/src/lib/analysis/course-overview.test.ts`

**Interfaces:**
- Consumes: `AnalysisData` (`rows.ts`); `TIMEPOINTS`, `daysBetween` (`timepoints.ts`); `NONE` (`filters.ts`); `implantRow`, `visitRow`, `radiographRow` (`test-rows.ts`).
- Produces:
```ts
export type CourseOption = { id: string; name: string; start_date: string | null }
export type Share = { label: string; count: number }
export type MeasurementKey = 'torque' | 'isq_placement' | 'bone_type' | 'bone_level' | 'probing' | 'recession'
export type FollowUpWindow = { key: TimepointKey; label: string; attended: number; due: number; pending: number }
export type CourseSummary = {
  id: string; name: string; startDate: string | null; implants: number; patients: number; thin: boolean
  systems: Share[]; dimensions: Share[]; followUp: FollowUpWindow[]
  prosthetic: { done: number; eligible: number }
  complications: { biological: number; mechanical: number; restorationProblems: number; implantsAffected: number }
  measurements: { key: MeasurementKey; label: string; recorded: number }[]
}
export type MetricRow = { group: string; label: string; values: string[] }
export function courseOverview(data: AnalysisData, courses: CourseOption[], today: string): CourseSummary[]
export function metricRows(summaries: CourseSummary[]): MetricRow[]
export function selectedCourses(raw: string | string[] | undefined, summaries: CourseSummary[]): CourseSummary[]
export function courseExploreHref(ids: string[]): string
```

- [ ] **Step 1: Write the failing tests** (`today = '2026-01-01'`, placed `2025-01-10` unless stated)

```ts
it('groups by course in the given order, with No course recorded last', () => {
  const s = courseOverview({ implants: [implantRow({ site_id: 'a', course_id: 'c2' }), implantRow({ site_id: 'b', course_id: null })], visits: [], radiographs: [] },
    [{ id: 'c1', name: 'New', start_date: '2025-06-01' }, { id: 'c2', name: 'Old', start_date: '2025-01-01' }], today)
  expect(s.map((x) => x.name)).toEqual(['New', 'Old', 'No course recorded'])
  expect(s[2].id).toBe(NONE)
})
it('leaves out the No course row when every implant has a course')
it('counts implants, distinct patients and flags under 30 implants as thin') // 2 implants, 1 patient → implants 2, patients 1, thin true; 30 → thin false; 0 implants → thin false (nothing to warn about)
it('splits systems and dimensions with Not recorded for nulls') // brand Oxy/system PSK → label 'Oxy PSK'; 4.1 × 10 → 'Ø4.1 × 10 mm'; null → 'Not recorded'
it('counts an attended visit as follow-up and a missed one as not', () => {
  // two implants; m3 visit attended on one, attendance 'missed' on the other
  expect(m3).toEqual(expect.objectContaining({ attended: 1, due: 2, pending: 0 }))
})
it('counts an open window as pending, not due') // placed 2025-11-20, today 2026-01-01 (42 d): m3 → due 0, pending 1
it('leaves an implant that failed before the window out of it') // event_on 30 d after placement: m6 → due 0, pending 0
it('counts prosthetic completion among implants that have not failed') // ok + final; ok no final; failed no final; failed with final → done 2, eligible 3
it('sums complications and counts implants with any') // biological 2 + mechanical 1 on one, restoration_problems 1 on another, one clean → 2,1,1, affected 2
it('counts each measurement once per implant') // two recession visits on one implant → recorded 1; X-ray with both levels null → bone_level 0
it('shows — for every ratio of a course without implants', () => {
  const rows = metricRows(courseOverview({ implants: [], visits: [], radiographs: [] }, [{ id: 'c1', name: 'New', start_date: null }], today))
  expect(rows.find((r) => r.label === 'Implants')!.values).toEqual(['0'])
  expect(rows.find((r) => r.label === 'Final restoration')!.values).toEqual(['—'])
  expect(rows.flatMap((r) => r.values).join()).not.toContain('0 of 0')
})
it('lines courses up in metricRows, with 0 of n for a level only another course has') // Oxy only in c1 → values ['2 of 2', '0 of 1']
it('shows pending beside a follow-up ratio') // '1 of 2 · 1 pending'
it('selectedCourses keeps list order, drops unknown ids and duplicates', () => {
  expect(selectedCourses(['c2', 'bad', 'c1', 'c2'], summaries).map((s) => s.id)).toEqual(['c1', 'c2'])
  expect(selectedCourses(undefined, summaries)).toEqual([])
})
it('courseExploreHref opens one course, or compares several by course', () => {
  expect(courseExploreHref(['c1'])).toBe('/statistics/explore?course=c1')
  const href = courseExploreHref(['c1', NONE])
  const q = new URL(href, 'http://x').searchParams
  expect(Object.fromEntries(q)).toEqual({ course: 'all', f: 'course', w: 'all', x_course: `c1,${NONE}` })
  expect(parseExplore(Object.fromEntries(q)).config.filters).toEqual([{ key: 'course', values: ['c1', NONE] }])
})
it('courseExploreHref filters No course recorded in Explore, because course=__none would read as all courses', () => {
  expect(new URL(courseExploreHref([NONE]), 'http://x').searchParams.get('x_course')).toBe(NONE)
})
it('uses no ranking words', () => { /* labels joined: not /best|worst|top|rank/i */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- course-overview`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `course-overview.ts`**

Group rows by `site_id` once (implants → course, as `observations.ts` `index`), so the page stays linear on ~550 implants. Windows: the five in the metric table, labels from `TIMEPOINTS`. Metric groups in order: `Course` (Implants, Patients), `Systems`, `Dimensions`, `Follow-up visits attended`, `Prosthetic` (Final restoration), `Complications` (Biological, Mechanical, Restoration problems, Implants with any), `Measurements recorded`. `Share` rows and dimensions sort by label (numeric-aware `localeCompare`), never by count. Ratios `k of n`, "—" when n = 0; follow-up appends ` · p pending` when p > 0.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- course-overview`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/analysis/course-overview.ts web/src/lib/analysis/course-overview.test.ts
git commit -m "feat(statistics): per-course summaries for the course overview"
```

### Task 2: The Courses tab

**Files:**
- Modify: `web/src/app/(app)/statistics/explore/data.ts` (extract and export `loadAnalysisRows(filters): Promise<AnalysisData>`; `loadExplore` calls it, same result)
- Modify: `web/src/app/(app)/statistics/layout.tsx` (tab `{ href: '/statistics/courses', label: 'Courses' }` after Explore)
- Create: `web/src/app/(app)/statistics/courses/page.tsx`
- Create: `web/src/app/(app)/statistics/courses/course-view.tsx`
- Test: `web/src/app/(app)/statistics/courses/course-view.test.tsx`

**Interfaces:**
- Consumes: everything Task 1 produces; `requirePermission`, `canView`; `NoPatientsNote` (`../research-view`); `ALL_COURSES`.
- Produces: `CourseView({ summaries, selected }: { summaries: CourseSummary[]; selected: CourseSummary[] })`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists courses with a tick box and an Explore link, implants in the summary line')
// getByRole('checkbox', { name: 'Compare Old' }); link 'Explore Old' href courseExploreHref(['c1'])
it('warns on a thin course but still shows its numbers') // text 'Small sample' and '2 implants'
it('shows a side-by-side table for two ticked courses, one column each', () => {
  // getByRole('table', { name: 'Side-by-side comparison' }); column headers Old, New in list order
  // every <td> has data-label; link 'Explore these courses' href courseExploreHref(ids)
  // note text: 'Counts describe each course; they are not a ranking. Later courses have had less time for follow-up.'
})
it('asks for another course when one is ticked, with no table') // text 'Tick at least two courses to compare them.'
it('keeps ticked boxes checked')
it('says so when there are no courses') // 'No courses yet.'
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- course-view`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`page.tsx`: `requirePermission('research')`, heading "Courses" with a one-line description, `NoPatientsNote` branch as `explore/page.tsx`, then `loadAnalysisRows` with all six filters empty (`course: ALL_COURSES`) and `course_options`; throw on error as `explore/data.ts`. Pass `sp.c` raw to `selectedCourses`.

`course-view.tsx` (server component, no `'use client'`): a GET `<form>` with a Compare button; the comparison table first when two or more are ticked (wrapper `overflow-x-auto`, metric group as a sub-heading row, `data-label={course name}`); then one `<details className="card">` per course, summary "name · start date · n implants · m patients", checkbox `name="c"` outside `<summary>` with `aria-label`, and inside a single-course metric table from `metricRows([summary])` plus its Explore link.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- course-view` and `npm test -- explore`
Expected: PASS, Explore tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/(app)/statistics"
git commit -m "feat(statistics): Courses tab with side-by-side comparison"
```

### Task 3: E2E, docs, verification

**Files:**
- Create: `web/tests/e2e/statistics-courses.spec.ts`
- Modify: `web/src/app/(app)/statistics/CLAUDE.md` (a **Courses** bullet: no migration, definitions, `c=` GET form), root `CLAUDE.md` (Statistics pointer lists Courses)

**Interfaces:**
- Consumes: `seedCourse`, `seedImplantStock`, `seedDelegate`, `placeImplant` (`tests/e2e/api.ts`); `createPatientViaUi`, `uniqueName`; `login`.

- [ ] **Step 1: Write the spec**

```ts
test('Courses compares two ticked courses and opens them in Explore', async ({ page }) => {
  // Seed courses A and B with uniqueName; place 2 implants in A on one patient and 1 in B on another (brand from uniqueName).
  // Admin: /statistics/courses → tab 'Courses' current; find the details for A: '2 implants'.
  // Tick A and B, click Compare. URL has c= twice.
  // table 'Side-by-side comparison': header A and B; row 'Implants' has 2 and 1; row 'Final restoration' has '0 of 2' and '0 of 1'.
  // 'Explore these courses' → URL has f=course and x_course; heading 'Explore clinical data'; Compare by = course.
});
test('A delegate cannot open Courses', async ({ page }) => {
  // login TEST_USERS.delegate; goto /statistics/courses → URL ends in /my; no 'Courses' heading
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test statistics-courses --project=chromium`
Expected: 2 passed. Then open `/statistics/courses?c=<a>&c=<b>` at 360px wide: no horizontal page overflow.

- [ ] **Step 3: Update the two `CLAUDE.md` files**

- [ ] **Step 4: Full verification**

Run: `./scripts/ship.sh verify statistics-courses explore`
Expected: tsc, lint, unit, test:db and both specs pass. Leftover-data `search_patients` failures in `test:db`: compare against a stash before debugging (root `CLAUDE.md` → Gotchas).

- [ ] **Step 5: Commit**

```bash
git add web/tests/e2e/statistics-courses.spec.ts CLAUDE.md "web/src/app/(app)/statistics/CLAUDE.md"
git commit -m "test(statistics): Courses E2E; docs"
```
