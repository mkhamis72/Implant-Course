# Explore Clinical Data: the Explore page (PR 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new **Explore** tab at `/statistics/explore`. The user picks a factor, an outcome, a timepoint and filters, and at once sees the key numbers, the suggested chart (with a switcher between the valid charts), the statistics, plain-language findings, data-quality warnings, the included and missing counts, and the underlying rows.

**Architecture:**
- **Data:** a server page loads the three live readers (0078) with the six existing SQL filters, plus the names of delegates, supervisors and courses, and passes them to one client workspace.
- **Instant updates:** the workspace runs `runAnalysis()` (`src/lib/analysis/run.ts`, live) in the browser. Its state lives in the URL through `window.history.replaceState`, so changes need no server round trip and links can be shared. The six SQL filters stay a normal GET form, which reloads the data.
- **Charts:** Apache ECharts, loaded only on this page, drawn from pure option builders that are unit-tested.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 tokens, `echarts@5.5.1` (exact, new dependency), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-explore-clinical-data-design.md` (Screens → Explore). Engine plan: `docs/superpowers/plans/2026-10-25-explore-analysis-engine.md`.

## Global Constraints

- Branch `feat/explore-ui` from `origin/master`. Work in `web/`. No migration in this PR.
- **Access:**
  - Pages are guarded by the existing `statistics/layout.tsx` (`requirePermission('research')`), and the page calls it again itself, as every page must.
  - Without Patients view the page shows the existing `NoPatientsNote` (from `../research-view`) and loads nothing.
  - No server actions in this PR.
- **Dependency:** `npm install echarts@5.5.1 --save-exact`. Import only from `echarts/core` plus the needed charts and components (`BoxplotChart`, `ScatterChart`, `BarChart`, `LineChart`, `GridComponent`, `TooltipComponent`, `LegendComponent`, `DataZoomComponent`, `MarkLineComponent`, `SVGRenderer`). Load it through `next/dynamic(..., { ssr: false })` so other routes don't ship it. No CSP change is needed (no external origin, no eval): the E2E checks that the console has no CSP violation.
- **Colours:**
  - Series colours are the `--color-series-1…6` tokens (`globals.css`), read once with `getComputedStyle(document.documentElement)`. Text and lines use `--color-muted` / `--color-line`.
  - Never use status colours (ok/warn/bad) for groups. Warnings use the existing `.rule-warn` / `.badge-warn` classes.
  - Load the `dataviz` skill before writing chart code.
- **Styling:**
  - Use the shared classes: `.card`, `.page-header`, `.btn`/`.btn-secondary`, `.input`, `.label`, `.badge*`, `.rule*`, and tables with `className="table"` plus `data-label` on every `<td>`.
  - No raw Tailwind palette colours. The layout stacks on phones (360 px, no sideways scroll).
- **Copy:**
  - Page heading `Explore clinical data`; subtitle `Compare clinical variables and outcomes for the implants in the filter.`
  - Question heading `What would you like to understand?`
  - Factor select label `Compare by`, with first option `Nothing — describe the outcome`. Outcome select label `Outcome`. Timepoint select label `Timepoint`, options = `TIMEPOINTS` labels plus `All timepoints (trend)`.
  - View tab labels: box `Box plot`, strip `Distribution`, scatter `Scatter`, bar_stacked `Stacked bars`, bar_grouped `Grouped bars`, km `Survival curve`, trend `Trend`, trajectories `Each implant`, summary `Summary`, table `Table`.
  - Missing reasons use `MISSING_LABELS`; `factor_not_assessed` shows as `Factor not assessed`. P-values use `formatP` (`src/lib/research/stats.ts`). Numbers use `fmt` (`src/lib/analysis/wording.ts`).
- **Defaults:**
  - Explore opens on **All courses** (`course=all`), because analyses need sample size, unlike Results, which opens on the latest course.
  - With no factor and no outcome in the URL, show the question card and five example buttons: `Smoking → Marginal bone change`, `Implant diameter → Implant survival`, `ISQ at placement → Marginal bone change`, `Periodontitis history → Biological complication`, `Course → Final restoration fitted`.
- **Owner rules:** always show numbers and warn when thin; people and courses are ordered by name; no causal wording. All three are enforced by the engine and must not be overridden in the UI.
- Dates: `todayIso()` is passed from the server to the client as a prop. Never use `new Date()` for "today" in the client.

## Review Focus

1. **A shared or bookmarked URL with a stale or hand-edited value** (unknown factor key, `w=d500-100`, a filter on a removed level). The page must not crash: unknown parts are dropped and the rest still applies. Test in Task 2.
2. **Switching the outcome when the current view isn't valid for the new pair** (from a box plot to a survival outcome). The view resets to the new default, never an empty chart. Test in Task 5.
3. **An analysis with zero included implants** (filters exclude everyone). It shows "No implants match these filters." with the missing counts, and no chart and no test. Test in Task 5.
4. **A delegate or supervisor id with no name** (deleted person, or old data). The group shows `Unknown (deleted)`, not a raw uuid. Test in Task 1.
5. **A long group label or many groups (20 brands) on a phone.** Axis labels truncate with a tooltip; the chart scrolls inside its card, not the page. Test in Task 6 (mobile E2E) and Task 3 (`axisLabel` width set).

---

### Task 1: Engine additions — points for every method, filter choices, unknown names

**Files:**
- Modify: `web/src/lib/analysis/run.ts`
- Create: `web/src/lib/analysis/choices.ts`
- Test: `web/src/lib/analysis/run.test.ts`, `web/src/lib/analysis/choices.test.ts`

**Interfaces:**
- Produces:
  - `AnalysisResult.points` is filled for every method except `trend`: `{ siteId, x: <group label>, y: <outcome value> }`. For `correlation` it stays numeric `x`. For `survival`, `y` = follow-up months.
  - `levelChoices(rows: ImplantRow[], key: string, labels: LevelLabels): Level[]` (`choices.ts`): the levels present in the rows for a categorical, binary or ordinal variable, in the same order `runAnalysis` uses. Fixed levels keep their order; data-driven ones are sorted by label. Not assessed (`NONE`) comes last when present.
  - `UNKNOWN_NAME = 'Unknown (deleted)'`: used by `runAnalysis` / `levelChoices` for a data-driven people/course value with no entry in `labels` (only for `delegate`, `supervisor`, `course`; brands and teeth show their value).

- [ ] **Step 1: Write the failing tests:**
  - `run.test.ts`: the smoking → bone change result has `points.length === included` (9), with `x` in `['Never', 'Current', 'Not assessed']`. The survival result's points have numeric `y` = `follow_up_days / 30.4375`. A delegate id missing from `labels` is grouped under `Unknown (deleted)`.
  - `choices.test.ts`:
    - smoking over rows with never, current and null gives `[{never, 'Never'}, {current, 'Current'}, {'__none', 'Not assessed'}]`.
    - brand levels are sorted by label.
    - delegate with `labels.delegate = { d2: 'Amy' }` and ids d1, d2 gives `[Amy, Unknown (deleted)]`.
    - a continuous key throws `Not a categorical variable: torque`.
- [ ] **Step 2: Run and see them fail** — `npm test -- src/lib/analysis`.
- [ ] **Step 3: Implement**, reusing `groupBy` (export it from `run.ts`, or move it to `choices.ts` and import it into `run.ts`).
- [ ] **Step 4: Run and see them pass; commit** — `feat(statistics): points, filter choices and unknown names in the analysis engine`

### Task 2: URL state

**Files:**
- Create: `web/src/lib/analysis/url.ts`, `web/src/lib/analysis/url.test.ts`

**Interfaces:**
- Consumes: `AnalysisConfig`, `Filter`, `Window`, `View`, `variable()`.
- Produces:
  - `type ExploreState = { config: AnalysisConfig; view: View | null }`
  - `parseExplore(params: Record<string, string | undefined>): ExploreState`
  - `exploreQuery(state: ExploreState, base: Record<string, string>): string`. It returns `?…`. `base` holds the six SQL filters, which are kept unchanged.
- Parameter format:
  - `f` = factor key; `o` = outcome key.
  - `w` = window: a timepoint key, `all`, or `d<from>-<to>`.
  - `v` = view.
  - One `x_<key>` per filter: comma-separated values (`__none` allowed), or `<min>..<max>` with either side optional, for example `x_torque=30..` or `x_smoking=current,__none`.

- [ ] **Step 1: Write the failing tests:**
  - Round trip: `parseExplore` of `exploreQuery(state)` deep-equals `state` for a full example (factor smoking, outcome bone_change, `w=m12`, filters smoking current + torque 30..45, view strip).
  - Defaults: `{}` gives `{ config: { factor: null, outcome: '', window: 'm12', filters: [] }, view: null }`.
  - **Bad input is dropped, not fatal:** `f=colour` gives factor null; `o=nope` gives outcome `''`; `w=d500-100` and `w=x` give window `m12`; `x_colour=a` is dropped; `x_torque=abc..` is dropped; `v=pie` gives null.
  - A custom window `w=d300-400` gives `{ from: 300, to: 400 }`.
  - `exploreQuery` keeps `course=all&brand=Oxy` from `base` and omits empty parts.
- [ ] **Step 2: Run and see them fail; Step 3: implement; Step 4: run and see them pass; Step 5: commit** — `feat(statistics): Explore URL state`

### Task 3: ECharts option builders

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (`npm install echarts@5.5.1 --save-exact`)
- Create: `web/src/app/(app)/statistics/explore/chart-options.ts`, `chart-options.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult`, `View`, `trajectories()`.
- Produces:
  - `type Palette = { series: string[]; ink: string; muted: string; line: string }`
  - `chartOption(view: View, result: AnalysisResult, ctx: { palette: Palette; unit?: string; outcomeLabel: string; factorLabel: string | null; trajectories?: { label: string; points: { window: TimepointKey; value: number }[] }[] }): EChartsOption | null`. It returns null for `summary` and `table`.
  - `chartSummary(view, result, labels): string`: a one-sentence text for the chart's `aria-label`.

- [ ] **Step 1: Write the failing tests** (one per view, with fixtures built by running `runAnalysis` on `test-rows` data):
  - `box`: one `boxplot` series whose data per tested group is `[min, q1, median, q3, max]`.
  - `strip`: a `scatter` series with one point per included implant.
  - `scatter`: points plus a `markLine` (or second `line` series) from `result.line`, and `dataZoom` with `type: 'inside'`.
  - `bar_stacked`: `stack` set, with values as percentages of each group's `n`; tooltip text contains `of {n} implants`.
  - `bar_grouped`: the same without `stack`.
  - `km`: one `line` series per curve with `step: 'end'`, first point `[0, 100]`, y in percent.
  - `trend`: one `line` per group with x = timepoint labels.
  - `trajectories`: one thin line per implant, colour `palette.muted`.
  - `summary` / `table` give `null`.
  - **Every option is free of NaN and Infinity** (deep walk, as `hasNaN` in `run.test.ts`).
  - Series colours come from `palette.series` in group order. With more than 6 groups the colours cycle.
  - Category axes set `axisLabel: { width: 96, overflow: 'truncate' }` and `tooltip.confine: true`.
  - `chartSummary('box', …)` reads like `Box plot of Marginal bone change by Smoking: 2 groups, 9 implants.`
- [ ] **Step 2: Run and see them fail; Step 3: implement**, importing ECharts types only (`import type { EChartsOption } from 'echarts'`); **Step 4: run and see them pass.**
- [ ] **Step 5: Commit** — `feat(statistics): ECharts option builders for Explore`

### Task 4: Chart component

**Files:**
- Create: `web/src/app/(app)/statistics/explore/explore-chart.tsx` (client) and `explore-chart-loader.tsx` (`next/dynamic` wrapper, `ssr: false`, with a `.card` placeholder of the same height while it loads)
- Test: `web/src/app/(app)/statistics/explore/explore-chart.test.tsx`

**Interfaces:**
- Consumes: `chartOption`, `chartSummary`, `Palette`.
- Produces: `<ExploreChart option={EChartsOption} summary={string} height={number} />`. It renders `<div role="img" aria-label={summary}>`, initialises ECharts with `renderer: 'svg'`, resizes on container resize (`ResizeObserver`) and disposes on unmount. `readPalette(): Palette` reads the CSS tokens.

- [ ] **Step 1: Write the failing test**, with `echarts/core` mocked (`init` returns `{ setOption, resize, dispose }` spies):
  - It renders `role="img"` with the summary.
  - It calls `setOption` with the option, and again when the option changes.
  - It calls `dispose` on unmount.
- [ ] **Step 2: Fail; Step 3: implement; Step 4: pass; Step 5: commit** — `feat(statistics): Explore chart component`

### Task 5: The workspace

**Files:**
- Create in `web/src/app/(app)/statistics/explore/`:
  - `workspace.tsx` (client, owns `ExploreState`)
  - `question-card.tsx` (factor, outcome and timepoint selects, example buttons)
  - `filter-chips.tsx` (chips plus an "Add filter" panel: pick a variable, then levels as checkboxes from `levelChoices`, or Min/Max inputs for continuous)
  - `results.tsx` (key numbers, view tabs, chart, findings, statistics table, data quality, included/excluded, underlying data)
- Test: `web/src/app/(app)/statistics/explore/workspace.test.tsx` (mock `./explore-chart-loader` with a stub that renders its `summary`)

**Interfaces:**
- Consumes: `runAnalysis`, `parseExplore`, `exploreQuery`, `levelChoices`, `factorChoices`, `outcomeChoices`, `describeFilters`, `MISSING_LABELS`, `TIMEPOINTS`, `chartOption`, `chartSummary`, `trajectories`.
- Produces: `<ExploreWorkspace data={AnalysisData} labels={LevelLabels} today={string} initial={ExploreState} base={Record<string, string>} patients={Record<string, { patientId: string; fileNo: string; tooth: number }>} />`. On every state change it calls `window.history.replaceState(null, '', exploreQuery(state, base))`. `runAnalysis` runs in `useMemo` keyed on the config.
- Layout, top to bottom (cards):
  1. Question card.
  2. Filter chips.
  3. The "Current analysis" line: `Compare by · Outcome · Timepoint · {implants} implants, {patients} patients · filters…` (from `describeFilters`).
  4. Key numbers: `Implants`, `With a valid value` (`{included} of {eligible}`), `Patients`, `Result` (`test.name` + `formatP`, or `No test`), `Effect` (`effect.name` `fmt(value)` with CI).
  5. View tabs (`.tabs` / `.tab`, `aria-pressed`), showing only `result.views`.
  6. The chart card, or the summary/table view.
  7. Findings (each `findings` line; `explain` in `text-muted`).
  8. Statistics table, one row per group: numeric `n`, patients, median (IQR), mean (SD), min–max; categorical `k of n (pct%)` per outcome level.
  9. Data quality: `warnings` as `.rule-warn` items, group name first when set.
  10. Included / excluded: `MISSING_LABELS` counts.
  11. A "Show underlying data" toggle with a table of `points` joined to `patients` (file no linking to `/patients/{patientId}?tooth={tooth}`, tooth, group, value).

- [ ] **Step 1: Write the failing component tests** (fixture data from `test-rows`):
  - **Empty state:** no factor and no outcome shows the question heading and the five example buttons. Clicking `Smoking → Marginal bone change` selects both, and the URL (spied `history.replaceState`) contains `f=smoking&o=bone_change`.
  - Selecting factor `Smoking` and outcome `Marginal bone change` at `12 months` shows key numbers `9 of`, the findings line from the engine, a `Mann–Whitney U` result, tabs `Box plot`, `Distribution`, `Table` only, and the chart stub's summary.
  - **View reset:** with view `strip` selected, switching the outcome to `Implant survival` shows tabs `Survival curve`, `Table` and selects `Survival curve`.
  - **Filter chips:** adding `Jaw: Mandible` shows the chip `Jaw: Mandible` and changes the implant count. Removing the chip restores it.
  - **Zero included:** a filter that matches nothing shows `No implants match these filters.`, no chart stub and no `Result` value.
  - The included/excluded list shows `No record in this window` with its count. A warning text from the engine is visible. People groups use names from `labels`.
  - The underlying-data table links each row to `/patients/<id>?tooth=<n>`.
  - The timepoint select is hidden for implant-level outcomes (`Implant failure`).
- [ ] **Step 2: Fail; Step 3: implement.** Controlled selects are fine (no server action is involved). **Step 4: pass.**
- [ ] **Step 5: Commit** — `feat(statistics): Explore workspace`

### Task 6: Page, tab, docs, E2E

**Files:**
- Create: `web/src/app/(app)/statistics/explore/page.tsx`, `web/src/app/(app)/statistics/explore/data.ts`
- Modify:
  - `web/src/app/(app)/statistics/layout.tsx`: add `{ href: '/statistics/explore', label: 'Explore' }` after Results.
  - `web/src/app/(app)/statistics/filter-form.tsx`: an optional `keep?: Record<string, string>` prop rendered as hidden inputs, so the six-filter GET keeps the Explore params.
  - `web/src/app/(app)/statistics/CLAUDE.md`: an **Explore page** bullet.
  - `web/tests/e2e/mobile.spec.ts`
- Create: `web/tests/e2e/explore.spec.ts`

**Interfaces:**
- `loadExplore(filters: ResearchFilters): Promise<{ data: AnalysisData; labels: LevelLabels }>` in `data.ts`:
  - It runs `fetchAll` over `analysis_implants` (order `['site_id']`), `analysis_visits` (`['visit_id']`) and `analysis_radiographs` (`['site_id', 'radiograph_id']`) with `rpcArgs(filters)`, in parallel.
  - Labels come from `delegates (id, full_name)`, `supervisors (id, full_name)` and `course_options()`.
  - Numeric columns are coerced with `Number()` where PostgREST returns strings (`numeric` type).

- [ ] **Step 1: Write the failing E2E** (`explore.spec.ts`; admin login, since admins always have Research; seed as in `research.spec.ts`):
  - Seed two implants of a unique brand at teeth 16 and 36 for two new patients. The tooth-36 implant gets a lost failure through `record_visit`.
  - Go to `/statistics/explore?course=all&brand=<brand>`. The heading `Explore clinical data` and the example buttons are visible.
  - Choose `Compare by` = `Jaw` and `Outcome` = `Implant failure`. Expect tabs `Stacked bars`, `Grouped bars`, `Table`, and the findings text `Implant failure: 0 of 1 implants (Maxilla) vs 1 of 1 implants (Mandible).`.
  - Click `Table` and expect the statistics table rows `Maxilla` and `Mandible`.
  - Reload the page: the same selection is restored from the URL.
  - No console message contains `Content Security Policy`.
  - `mobile.spec.ts`: a new test logs in as admin, opens `/statistics/explore?course=all&f=smoking&o=bone_change` and checks `expectNoSideways`.
- [ ] **Step 2: Run and see it fail** — `npx playwright test explore --project=chromium` → FAIL (404 / no tab).
- [ ] **Step 3: Implement** the page:
  - Call `requirePermission('research')`; show `NoPatientsNote` without Patients view.
  - Read the six filters with `readParams`, defaulting `course` to `ALL_COURSES`. Read the Explore params with `readParams(searchParams, 'f', 'o', 'w', 'v')` plus every `x_*` key.
  - Render the `page-header`, `FilterForm` with `keep` = the Explore params, then `ExploreWorkspace`.
  - Docs bullet: the route, the URL format, All courses by default, ECharts only here, and `replaceState` for instant changes.
- [ ] **Step 4: Run and see it pass** — `npx playwright test explore --project=chromium` and `npx playwright test mobile --project=phone`.
- [ ] **Step 5: Verify** — `./scripts/ship.sh verify explore research mobile` → green, except the known `search_patients` leftover-data failure (name it if it appears). Check the first-load bundle of `/statistics` is unchanged (ECharts only in the explore chunk) with `npm run build` output.
- [ ] **Step 6: Commit** — `feat(statistics): Explore page`
