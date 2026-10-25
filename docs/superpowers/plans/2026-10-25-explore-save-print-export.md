# Explore Clinical Data: saved analyses, print/PDF and exports (PR 5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Explore page, users can save an analysis (shared with everyone who has Statistics access) and reopen it later on the current data. They can open a print-ready report and save it as a PDF from the browser. They can download the chart (SVG or PNG) and the underlying data as an anonymised CSV.

**Architecture:**
- **Saved analysis:** stored as the Explore URL query, which is already the full serialisation (`src/lib/analysis/url.ts`), in a new `saved_analyses` table written only through definer functions.
- **Print page:** a server page that reuses `loadExplore` + `runAnalysis` and renders charts on the server with ECharts SSR, as vector SVG.
- **Data export:** a GET route that, like the research export, assigns study codes, maps implants to codes through a new definer reader, writes a CSV and logs the export.

**Tech Stack:** Postgres (migration 0079), Next.js 15 server actions and route handlers, ECharts 6.1.0 SSR (`ssr: true` + `renderToSVGString`), Zod v4, Vitest (unit, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-explore-clinical-data-design.md` (Data → Saved analyses; Screens → Explore, Print). Earlier plans: `docs/superpowers/plans/2026-10-25-explore-ui.md`.

## Global Constraints

- Branch `feat/explore-save` from `origin/master`. Migration `0079_saved_analyses.sql`. Work in `web/`.
- **Access:**
  - Reading saved analyses, printing and exporting need Research view and Patients view (as on the Explore page).
  - Saving, renaming and deleting need Research **Edit**, and only the creator or an admin may rename or delete an analysis (owner decision: shared, creator or admin manage).
  - Every definer function starts with `perform app_private.require_perm('research', …)` (`tests/db/permissions.test.ts` enforces it).
- **Saved data:**
  - `config` = `{ "version": 1, "query": { <param>: <string> } }`. Allowed keys: `course, from, to, delegate, brand, system, f, o, w, v, alt, x_<variable key>`. At most 40 keys, each value at most 500 characters.
  - The SQL checks the shape; the TS checks the keys (Zod). Opening an analysis goes to `/statistics/explore?<query>`, where `parseExplore` drops anything stale.
  - Title: trimmed, 1–120 characters.
- **Errors:** business errors via `app_private.fail(...)`, shown verbatim through `userMessage` (`src/lib/db-errors.ts`). Copy:
  - `Enter a title for the analysis.`
  - `Only the person who saved this analysis or an admin can change it.`
  - `Saved analysis not found.`
- **Print:**
  - A page under the existing `(app)` layout, using the `@media print` rules and `print:hidden` for controls, and `PrintButton` from `schedule/pull-list/print-button.tsx`.
  - Charts are server-rendered SVG strings inserted with `dangerouslySetInnerHTML`. ECharts escapes text, and a test pins that a `<script>` in a label comes out escaped.
- **Export:**
  - CSV columns, exactly: `implant_code, patient_code, group, value, unit, timepoint, days_since_placement`.
  - No names, file numbers, raw ids, dates of birth or free text.
  - File name `explore-<outcome key>-YYYY-MM-DD.csv` (Cairo date, `todayIso()`), with a first comment line `# Confidential: pseudonymised clinical data. …` (the same wording as the research export's README confidentiality note).
  - Logged with `log_research_export('csv', <filters + {explore: query}>, {points: n})`.
- **Chart download:** SVG straight from the ECharts instance; PNG through an off-screen canvas at 2× scale on a white background. CSP already allows `img-src data: blob:`.
- **Limitations text** on the print page, verbatim: `These figures describe observational data recorded at this centre. An association does not show that one thing causes another. Implants of the same patient are not independent. Small groups and missing measurements limit what can be concluded; formal conclusions need an appropriate study design and statistical advice.`
- **Ruling (deliberate):** `saved_analyses.created_by` references `profiles`, so `delete_user` treats a user with saved analyses as having records, like every other FK (0037). An admin deletes or reassigns their analyses first.

## Review Focus

1. **A saved analysis whose query names something since removed** (a deleted course id, a level no longer used). It opens without error, and the dropped parts are simply absent. Test in Task 2.
2. **Two users editing the same saved analysis** (an organizer renames one that an admin then deletes). Last write wins; renaming a deleted analysis shows `Saved analysis not found.`. Test in Task 1.
3. **Group or level names containing markup** (`<script>`, `&`) in a delegate or brand. They print as text, never run, in both the server SVG and the HTML. Test in Task 5.
4. **Exporting with filters that match no implant.** You get a CSV with just the header and confidentiality line, the export is still logged with `points: 0`, and it is not a 500. Test in Task 6.
5. **Printing a view with no chart** (summary / table, or a survival analysis that can't be split). The report still prints the statistics, warnings and limitations, without an empty chart frame. Test in Task 5.

---

### Task 1: Migration 0079 — saved analyses and implant codes

**Files:**
- Create: `web/supabase/migrations/0079_saved_analyses.sql`
- Test: `web/tests/db/saved-analyses.test.ts`

**Interfaces:**
- Produces:
  - Table `public.saved_analyses (id uuid pk default gen_random_uuid(), title text not null check (length(title) between 1 and 120 and title = trim(title)), config jsonb not null check (jsonb_typeof(config) = 'object' and config->>'version' = '1' and jsonb_typeof(config->'query') = 'object' and pg_column_size(config) < 16384), course_id uuid references public.courses(id) on delete set null, created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default now())`.
    - It gets the `set_updated_at` and `audit_row('id')` triggers.
    - Grants: `revoke all … from public, anon, authenticated; grant select … to authenticated`.
    - RLS: select policy `is_active_user()` plus a restrictive policy `(select public.can('research','view')) and (select public.can('patients','view'))`, as `studies` (0073:80–83).
  - `public.save_analysis(p_id uuid, p_title text, p_config jsonb, p_course uuid) returns uuid`, definer.
    - It starts with `require_perm('research','edit')` and requires Patients view.
    - A blank or too-long title fails with `Enter a title for the analysis.`.
    - `p_id` null inserts with `created_by = auth.uid()`.
    - Otherwise it updates the title, config and course when `created_by = auth.uid()` or `is_admin()`. Any other user gets `Only the person who saved this analysis or an admin can change it.`; a missing row gets `Saved analysis not found.`.
  - `public.delete_analysis(p_id uuid) returns void`: same permission and ownership rules.
  - `public.analysis_codes(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text) returns table (site_id uuid, implant_code text, patient_code text)`, definer.
    - It requires `research` view and Patients view, as `log_research_export` does (0073:283).
    - It returns `research_code('implant', site_id)`, `research_code('patient', patient_id)` for the `implant_outcomes_detail` implant set, ordered by `site_id`.
    - The caller runs `assign_research_codes(...)` first, so this only reads codes.
  - Revoke/grant execute on all three functions.

- [ ] **Step 1: Write the failing DB tests:**
  - **Saves and reads:** an organizer with Research edit + Patients view saves `{version:1, query:{f:'smoking', o:'failed'}}` titled `' Smoking and failure '`. It reads back trimmed, with `created_by` = organizer, and the audit log has the insert.
  - **Shared but owned:** the `viewer` user (give it `setPerms(..., { research: 'edit', patients: 'view' })`) can select it, but `save_analysis` of that id and `delete_analysis` fail with `Only the person who saved this analysis or an admin can change it.`. An admin can rename and delete it.
  - **Refusals:**
    - Research view only gives a permission error on `save_analysis`.
    - Without Patients view, select returns 0 rows.
    - The delegate login can't select.
    - Title `''` or 121 chars → `Enter a title for the analysis.`
    - A config without `version` 1 → check violation.
    - A missing id on update or delete → `Saved analysis not found.`
  - **Deleted course:** deleting the course through `delete_course` sets `course_id` null; the analysis stays.
  - **Codes:** after `assign_research_codes` with a brand filter, `analysis_codes` returns one row per implant of `analysis_implants` for the same filter, with `I-`/`P-` codes matching `research_code`. Without Research view it fails with the permission error.
- [ ] **Step 2: Run them and see them fail** — `npm run test:db -- saved-analyses` → FAIL (`relation "public.saved_analyses" does not exist`).
- [ ] **Step 3: Write the migration.** Dry-run it with the scratchpad `dryrun.ts`, then run `npm run test:db -- saved-analyses permissions` → PASS.
- [ ] **Step 4: Commit** — `feat(statistics): saved analyses and implant codes (0079)`

### Task 2: Saved config in TS

**Files:**
- Create: `web/src/lib/analysis/saved.ts`, `web/src/lib/analysis/saved.test.ts`

**Interfaces:**
- Consumes: `exploreQuery`, `parseExplore`, `ExploreState` (`url.ts`), `RESEARCH_FILTER_KEYS`.
- Produces:
  - `type SavedConfig = { version: 1; query: Record<string, string> }`
  - `savedConfigSchema` (Zod): the allowed keys, limits and version from Global Constraints.
  - `toSavedConfig(state: ExploreState, base: Record<string, string>, alt: boolean): SavedConfig`: built from `exploreQuery`, with `alt: '1'` when set.
  - `savedHref(config: SavedConfig): string` → `/statistics/explore?<query>`.
  - `savedCourse(config: SavedConfig): string | null`: the `course` value when it is a uuid.

- [ ] **Step 1: Write the failing tests:**
  - A round trip: `parseExplore` over the query of `toSavedConfig(state, { course: 'all' }, false)` deep-equals `state`.
  - The schema refuses an unknown key (`colour`), a 501-character value, 41 keys and `version: 2`, and accepts `x_torque`.
  - `savedHref` encodes values: `brand=A&B` becomes `brand=A%26B`.
  - **A stale saved query** (`f: 'removed_var'`, `x_smoking: 'purple'`, course uuid of a deleted course) still parses to a usable state with those parts dropped. The course stays in the base and the page then shows All courses for an unknown id, because `rpcArgs` passes it and the readers return none. Assert: `parseExplore(query)` has factor null and no filters.
- [ ] **Step 2: Fail; Step 3: implement; Step 4: pass; Step 5: commit** — `feat(statistics): saved analysis config`

### Task 3: Server actions

**Files:**
- Create: `web/src/app/(app)/statistics/explore/actions.ts`, `actions.test.ts` (the pattern of `studies/actions.test.ts`: node environment, mocked `createClient` / `requirePermission` / `revalidatePath`)

**Interfaces:**
- Consumes: `savedConfigSchema`, `savedCourse`.
- Produces:
  - `saveAnalysis(id: string | null, title: string, config: SavedConfig): Promise<{ error?: string; id?: string }>`. It checks `requirePermission('research', 'edit')`, validates with the schema (an invalid config gives `Could not save this analysis.`), calls `rpc('save_analysis', { p_id, p_title, p_config, p_course: savedCourse(config) })`, `revalidatePath('/statistics/explore')`, and on an RPC error returns `{ error: userMessage(error) }`.
  - `deleteAnalysis(id: string): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the failing tests:**
  - Calls `save_analysis` with the trimmed title and course.
  - Passes a business error message through verbatim.
  - Refuses an invalid config without calling the RPC.
  - `deleteAnalysis` calls `delete_analysis`.
  - Both call `requirePermission('research', 'edit')`.
- [ ] **Step 2: Fail; Step 3: implement; Step 4: pass; Step 5: commit** — `feat(statistics): save and delete analysis actions`

### Task 4: Saved analyses and the export buttons on the Explore page

**Files:**
- Create: `web/src/app/(app)/statistics/explore/saved-analyses.tsx` (client)
- Modify:
  - `explore/page.tsx`: load `saved_analyses` with `id, title, config, course_id, created_by, created_at, creator:profiles!saved_analyses_created_by_fkey(full_name)`, ordered by `created_at desc`, and pass `canEdit(profile, 'research')`, `profile.id` and `profile.role === 'admin'`.
  - `explore/workspace.tsx`: a `Save analysis` control and the `Saved analyses` card; an actions row with `Print report`, `Include the alternative chart`, `Download data (CSV)`.
  - `explore/results.tsx` (`ChartCard`): `Download SVG` and `Download PNG` buttons.
  - `explore/explore-chart.tsx`: an `onReady(instance)` prop.
- Create: `web/src/app/(app)/statistics/explore/chart-download.ts`:
  - `chartFileName(outcomeKey: string, today: string, ext: 'svg' | 'png'): string` → `explore-<key>-<today>.<ext>`
  - `svgToPng(svg: string, width: number, height: number): Promise<Blob>` (canvas, 2×, white background)
- Test: `web/src/app/(app)/statistics/explore/saved-analyses.test.tsx`, plus additions to `workspace.test.tsx`

**Interfaces:**
- Consumes: `saveAnalysis`, `deleteAnalysis` (mocked in tests with `vi.mock('./actions', …)`), `toSavedConfig`, `savedHref`.
- Produces:
  - `<SavedAnalyses items={SavedRow[]} canEdit={boolean} userId={string} isAdmin={boolean} courses={Record<string, string>} />`, where `type SavedRow = { id: string; title: string; config: SavedConfig; course_id: string | null; created_by: string; created_at: string; creator: { full_name: string } | null }`.
  - Each row shows: the title as a link to `savedHref(config)`, `by <creator>`, `formatDate`, and the course name. `Rename` / `Delete` appear only when `canEdit && (created_by === userId || isAdmin)`.
  - An empty list shows `No saved analyses yet.`
  - The print link is `/statistics/explore/print?<current query>[&alt=1]`. The CSV link is `/statistics/explore/export?<current query>`.

- [ ] **Step 1: Write the failing component tests:**
  - **List:** an empty list shows `No saved analyses yet.`.
  - **Rows:** a row by another user shows no `Rename`/`Delete` for a non-admin, but does for an admin. Its link points to `/statistics/explore?f=smoking&o=failed`.
  - **Save:** with `canEdit`, typing a title and clicking `Save analysis` calls `saveAnalysis(null, 'Smoking and failure', { version: 1, query: expect.objectContaining({ f: 'smoking', o: 'failed', course: 'all' }) })`. A returned `{ error }` is shown in a `role="alert"`.
  - **No Edit:** without `canEdit` there is no `Save analysis` button.
  - **Links:** the `Print report` link carries the current query. Ticking `Include the alternative chart` adds `alt=1`. `Download data (CSV)` points to `/statistics/explore/export?…`.
  - **Chart downloads:** `chartFileName('bone_change', '2026-10-25', 'png')` is `explore-bone_change-2026-10-25.png`.
- [ ] **Step 2: Fail; Step 3: implement; Step 4: pass; Step 5: commit** — `feat(statistics): save, reopen and download from Explore`

### Task 5: Print / PDF report

**Files:**
- Create:
  - `web/src/app/(app)/statistics/explore/print/page.tsx`
  - `web/src/app/(app)/statistics/explore/render-svg.ts` (server-only)
  - `web/src/app/(app)/statistics/explore/report.tsx` (server component: the report body)
- Test: `web/src/app/(app)/statistics/explore/render-svg.test.ts` (node environment), `web/src/app/(app)/statistics/explore/report.test.tsx`

**Interfaces:**
- Consumes: `loadExplore`, `runAnalysis`, `parseExplore`, `chartOption`, `chartSummary`, `DEFAULT_PALETTE`, `describeFilters`, `getBranding()`, `todayIso()`, `formatDate`, `PrintButton`, `KeyNumbers`/`StatsTable`-like markup (the report renders its own server markup; it may not import client components that use hooks).
- Produces:
  - `renderChartSvg(option: EChartsOption, width = 720, height = 340): string`: `init(null, null, { renderer: 'svg', ssr: true, width, height })`, `setOption({ ...option, animation: false })`, `renderToSVGString()`, `dispose()`.
  - `<ExploreReport result labels title company today filters svg altSvg />`.
- Report layout, in order:
  1. Company name and `Explore clinical data — <title or 'Analysis'>`.
  2. `Generated <date>`.
  3. Variables: Compare by, Outcome, Timepoint.
  4. Population: `<n> implants, <p> patients`, with the course, date, delegate, brand and system filters as text, plus `describeFilters`.
  5. Main chart (`role="img"`, `aria-label` = summary).
  6. The alternative chart when `alt=1` and a second chart view exists.
  7. Key numbers: test, effect, Hedges g / ρ.
  8. Statistics table.
  9. Findings.
  10. Missing data by reason.
  11. Warnings.
  12. The limitations text from Global Constraints.

- [ ] **Step 1: Write the failing tests:**
  - `renderChartSvg` of `chartOption('box', …)` starts with `<svg` and contains the group labels.
  - **Markup is escaped:** a group label `<script>alert(1)</script>` appears as `&lt;script&gt;` and never as `<script>`.
  - `report.test.tsx`: the report shows the limitations text verbatim, the findings, the warnings and the missing-data list.
  - **No chart:** with `svg` null (summary view or an unsplittable survival) it renders no `role="img"` and still shows the statistics table.
- [ ] **Step 2: Fail; Step 3: implement.**
  - The page guards with `requirePermission('research')`, shows `NoPatientsNote` without Patients view, and reads the params as `explore/page.tsx` does.
  - A `print:hidden` bar holds `PrintButton` and a `Back to Explore` link.
- [ ] **Step 4: Pass; Step 5: commit** — `feat(statistics): Explore print report`

### Task 6: Data export route

**Files:**
- Create: `web/src/app/(app)/statistics/explore/export/route.ts`, `web/src/lib/analysis/export-csv.ts`, `web/src/lib/analysis/export-csv.test.ts`, `web/src/app/(app)/statistics/explore/export/route.test.ts` (the pattern of `statistics/export/route.test.ts`)

**Interfaces:**
- Consumes: `loadExplore`, `runAnalysis`, `parseExplore`, `toCsv`/`cellText` (`src/lib/research/export/csv.ts`), `fetchAll`, `rpcArgs`.
- Produces:
  - `EXPLORE_COLUMNS` (the seven names from Global Constraints).
  - `exploreCsv(result: AnalysisResult, codes: Map<string, { implant: string; patient: string }>, ctx: { unit?: string; timepoint: string; days: Map<string, number> }): string`. It writes one row per point and skips a point without a code. Group and value are text, with numbers formatted by `fmt` but using an ASCII minus.
  - `GET /statistics/explore/export?…`:
    - 403 without Research view or Patients view (the same checks and messages as `statistics/export/route.ts`).
    - 400 without an outcome.
    - Otherwise: `assign_research_codes(args)` → `fetchAll(analysis_codes, args, ['site_id'])` → `loadExplore` → `runAnalysis` → CSV.
    - It is logged by `log_research_export('csv', { ...filters, explore: query }, { points })` and returned with `Content-Disposition: attachment; filename="explore-<o>-<today>.csv"` and `Cache-Control: no-store`.
    - Errors give 500 `Could not build the export` and a console error, as the research export does.

- [ ] **Step 1: Write the failing tests:**
  - `exploreCsv` header and first line equal the columns exactly.
  - Never a name, file number or uuid: a fixture with `file_no 'F123'` and a uuid site id produces no `F123` and no uuid pattern.
  - **Zero points** → the header plus the confidentiality line only.
  - Route: 403 cases, 400 without `o`, and the log call with `points: 0` on an empty result, with a 200 response.
- [ ] **Step 2: Fail; Step 3: implement; Step 4: pass; Step 5: commit** — `feat(statistics): Explore data export`

### Task 7: Docs, E2E, verify

**Files:**
- Modify: `web/src/app/(app)/statistics/CLAUDE.md`: a **Saved analyses, print, export (0079)** bullet.
- Modify: `web/tests/e2e/explore.spec.ts`: extend the existing test.

- [ ] **Step 1: Extend the E2E**, after the reload step:
  - As admin, type the title `uniqueName('Jaw failure')` and click `Save analysis`. Expect it in `Saved analyses`.
  - Open `/statistics/explore`, click the saved title, and expect `Compare by` = `jaw`.
  - Click `Print report`. Expect the heading containing the title, the limitations text and `role="img"`.
  - Go back and click `Download data (CSV)`. The download's file name matches `/^explore-failed-\d{4}-\d{2}-\d{2}\.csv$/`, and its text starts with `implant_code,patient_code`.
  - Delete the saved analysis; it disappears.
- [ ] **Step 2: Run and see it fail before Tasks 4–6 exist, then pass** — `npx playwright test explore --project=chromium`.
- [ ] **Step 3: Verify** — `./scripts/ship.sh verify explore research` → green, except the known `search_patients` leftover-data failure; then `npm run build` succeeds.
- [ ] **Step 4: Commit** — `docs(statistics): saved analyses, print and export`
