# Statistics for zygomatic and full-arch work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statistics answers the owner's two questions: zygomatic implants vs tilted implants in All-on-4, and All-on-4 vs All-on-6 cases.

**Architecture:** One migration (0146) adds security-invoker readers next to the existing ones (nothing changed or dropped). Pure TS in `src/lib/research/` groups implants by implant type / case type and summarises cases per case type, reusing the C2 completion rule (`caseBridges`). Results (Compare by), Explore (factors), a new Full arch tab and the export consume them.

**Tech Stack:** Next.js 15 App Router, Supabase Postgres (plpgsql/sql readers), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-statistics-advanced-rehab-design.md`

## Global Constraints
- Migration `web/supabase/migrations/0146_statistics_full_arch.sql` only; additive; never edit applied migrations; dry-run in a rolled-back transaction before the first `test:db`.
- Every new reader: `security invoker set search_path = ''`, takes the six research filters `(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text)`, reads its implant set from `public.implant_outcomes_detail(...)`, returns nothing unless `(select public.can('research','view')) and (select public.can('patients','view'))`, `revoke … from public, anon` / `grant … to authenticated`. Page with `fetchAll` (1000-row cap).
- Copy (exact): Compare-by labels "Implant type", "Full-arch case type", "Zygomatic vs tilted (All-on-4)"; groups "Conventional", "Tilted", "Zygomatic", "Pterygoid", "Not recorded"; "All-on-4", "All-on-6", "All-on-X", "Other", "Not in a case"; "Zygomatic", "Tilted in All-on-4"; left-out note "N implants that are neither zygomatic nor tilted in an All-on-4 case are left out."; tab "Full arch"; planned note "N planned cases without a placed implant are not included."
- "k of n"; "—" when n = 0; under 30 implants (Compare) or under 30 cases (Full arch) → existing thin-data warning, numbers still shown. Months = days / 30.4375 (`DAYS_PER_MONTH`). Cairo dates.
- No free text anywhere (entry point, trajectory, case name/notes, close reason are never read). Clinic companies: same screens, no course/delegate columns.
- No change to existing comparisons' numbers or existing export columns.

## Review Focus
1. An implant moved from a closed case to a newer case counts only under its current case → Task 1 DB test + Task 2 unit test.
2. A case whose final bridge was later ended (remade) is not Completed until a new final covers every implant → Task 2 test (`caseOutcome`).
3. A failed implant in a case does not block completion (C2 rule) but counts as "lost an implant" → Task 2 test.
4. Filters by course/date leave a case in when at least one of its implants is in the set, and its status still uses all its implants → Task 1 DB test.
5. A user with Research view but no Patients view, or another company, gets no rows from every new reader → Task 1 DB tests.

---

### Task 1: Database (0146)

**Files:** Create `web/supabase/migrations/0146_statistics_full_arch.sql`, `web/tests/db/statistics-full-arch.test.ts`; modify `web/tests/db/module-guards.test.ts` / `permissions.test.ts` only if they require listing the new readers.

**Interfaces — Produces:**
- `public.implant_rehab_vars(<6 filters>) returns table (site_id uuid, implant_type text, angulation_deg numeric, angulation_direction text, anchorage text, case_id uuid, case_configuration text)` — one row per implant of the set; `case_configuration` null when not in a case.
- `public.analysis_full_arch_cases(<6 filters>) returns table (case_id uuid, patient_id uuid, file_no text, arch text, configuration text, closed_at timestamptz, first_placed_on date, implants_placed int, implants_failed int, bridge_problems int, sites jsonb, bridges jsonb)` — one row per case with ≥ 1 implant in the set. `sites` = **all** the case's implant sites `[{id, tooth, state}]`; `bridges` = the case's non-voided restorations `[{id, type, stage, fitted_on, ended_on, site_ids}]`; `implants_placed` / `implants_failed` over the case's sites in state placed/restored/failed (failed = state failed); `bridge_problems` = non-voided `restoration_problems` on the case's restorations; `first_placed_on` = min placement date of its sites.
- `public.full_arch_planned_cases() returns int` — open cases of the company with no site in state placed/restored/failed (unfiltered).
- `public.research_export_implant_rehab(<6 filters>) returns table (implant_code text, implant_type text, angulation_deg numeric, angulation_direction text, anchorage text, case_code text, case_configuration text)`.
- `public.research_export_full_arch_cases(<6 filters>) returns table (case_code text, patient_code text, arch text, configuration text, first_placed_on date, closed_on date, scan_on date, lab_design_on date, try_in_on date, implants_placed int, implants_failed int, bridge_problems int, sites jsonb, bridges jsonb)` — stage dates = latest `done_on` per stage; `closed_on` = Cairo date of `closed_at`.
- Study codes: `create or replace` the latest `app_private.research_code_draw` / `public.research_code` (0094) adding entity `'full_arch_case'` with prefix `'A-'`.

- [ ] Step 1: Write `statistics-full-arch.test.ts` (withTx, actAs organizer with Research view + Patients view): seed a patient with an All-on-4 upper case (2 conventional + 2 tilted implants, one failed), a zygomatic implant in an "other" case, an implant moved from a closed case to a newer one, and a planned-only case. Assert: `implant_rehab_vars` types/configs per site and the moved implant's current case; `analysis_full_arch_cases` returns 2 in-set cases (not the planned one; the closed case only if it still has an implant), counts placed 4 / failed 1, `sites` holds all 4 when a date filter covers only 1 of them; `full_arch_planned_cases()` = 1; export readers return `A-` codes stable across two calls and no column outside the list above; every reader returns 0 rows with Research None, with Patients None, and for another company's user.
- [ ] Step 2: Run `npm run test:db -- statistics-full-arch` → FAIL (functions missing).
- [ ] Step 3: Write the migration per the interfaces; dry-run it in a rolled-back transaction (`pgConfig()` tsx script in the scratchpad).
- [ ] Step 4: `npm run test:db -- statistics-full-arch module-guards permissions tenant-isolation` → PASS.
- [ ] Step 5: Commit "Statistics: full-arch and implant-type readers (0146)".

### Task 2: Domain logic (pure TS)

**Files:** Modify `web/src/lib/full-arch/cases.ts` (+ its test), `web/src/lib/research/groups.ts` (+ `groups.test.ts`); create `web/src/lib/research/rehab.ts`, `web/src/lib/research/full-arch.ts`, `web/src/lib/research/full-arch.test.ts`.

**Interfaces:**
- Consumes: Task 1 row shapes.
- Produces:
  - `rehab.ts`: `type RehabVars = { site_id: string; implant_type: 'conventional'|'tilted'|'zygomatic'|'pterygoid'|null; angulation_deg: number|null; angulation_direction: string|null; anchorage: string|null; case_id: string|null; case_configuration: Configuration|null }` (numeric strings coerced on load).
  - `cases.ts`: `caseBridges` / `caseStatus` accept structural subsets — sites `Pick<ImplantSite,'id'|'tooth'|'state'|'case_id'>`, restorations `Pick<Restoration,'id'|'case_id'|'type'|'stage'|'fitted_on'|'ended_on'|'site_ids'> & { voided_at?: string|null }` — behaviour unchanged (existing tests stay green).
  - `groups.ts`: `COMPARE_KEYS` += `'implant_type' | 'case_type' | 'zyg_vs_tilted'` with the exact labels; `needsRehabVars(key): boolean`; `groupRows(rows, groups, key, rehab: RehabVars[] = [])`; `zygVsTiltedLeftOut(rows, rehab): number`. Zyg-vs-tilted groups: "Zygomatic" = implant_type zygomatic (any case or none); "Tilted in All-on-4" = tilted with case_configuration all_on_4; others excluded (not a "not assessed" group). Case-type "Not in a case" is a real group (in the test); implant-type missing = "Not recorded" (notAssessed).
  - `full-arch.ts`: `type FullArchCaseRow` (reader row, Task 1); `caseOutcome(row): { status: CaseStatus; finalBridgeOn: string|null; monthsToBridge: number|null }` (via `caseBridges`/`caseStatus`); `type CaseColumn = { configuration: Configuration; cases: number; completed: number; closedIncomplete: number; monthsToBridge: { median: number|null; min: number|null; max: number|null }; withBridgeProblem: number; bridgeProblems: number; lostImplant: number; implantsFailed: number; implantsPlaced: number; medianImplants: number|null; survival12: KmFigure|null; survival24: KmFigure|null }` where `KmFigure` is what Results tiles already use from `kmEstimate`; `summariseCases(cases: FullArchCaseRow[], implants: GroupableRow[], rehab: RehabVars[]): CaseColumn[]` — one column per configuration in order All-on-4, All-on-6, All-on-X, Other, empty ones kept with zeros (shown as "—").

- [ ] Step 1: Tests: `groups.test.ts` — implant_type groups order and "Not recorded"; case_type with "Not in a case"; zyg_vs_tilted keeps only the two groups and `zygVsTiltedLeftOut` counts the rest; existing keys unchanged. `full-arch.test.ts` — completed case months = (deliveredOn − first_placed_on)/30.4375; ended final → not completed; failed implant doesn't block completion and counts in `lostImplant`; closed case → `closedIncomplete`; median of even/odd counts; empty configuration all zeros/null; 12/24-month survival uses only that configuration's implants. `cases.test.ts` untouched and green.
- [ ] Step 2: `npm test -- groups full-arch cases` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Same command → PASS; `npx tsc --noEmit`.
- [ ] Step 5: Commit "Statistics: implant type and case type groups, full-arch case summary".

### Task 3: Results and Explore

**Files:** Modify `web/src/app/(app)/statistics/data.ts`, `page.tsx`, `compare-panel.tsx` (+ tests), `research-view.tsx`; `web/src/app/(app)/statistics/explore/data.ts`; `web/src/lib/analysis/rows.ts`, `variables.ts` (+ `variables.test.ts`, `url.test.ts` if keys are validated).

**Interfaces:** Consumes Task 2 (`needsRehabVars`, `groupRows`, `zygVsTiltedLeftOut`, `RehabVars`) and Task 1 `implant_rehab_vars`. Produces: `loadResearch(filters, withGroups, withRehab = false)` returning `rehab: RehabVars[]`; `ImplantRow` (analysis) gains `implant_type`, `angulation_deg`, `angulation_direction`, `anchorage`, `case_configuration` (null when absent); Explore factor keys `implant_type`, `angulation`, `tilt_direction`, `anchorage`, `case_type` in a group "Full arch".

- [ ] Step 1: Tests: compare panel renders the three new options; with `compare=zyg_vs_tilted` it shows the two groups and the exact left-out note; `variables.test.ts` — new factors read their values (angulation continuous, unit "°"), an old saved URL without them still parses.
- [ ] Step 2: `npm test -- compare-panel variables url research-view` → FAIL.
- [ ] Step 3: Implement: page loads rehab vars only when `needsRehabVars(compare)`; Explore `loadAnalysisRows` fetches `implant_rehab_vars` with the same args and merges by `site_id`.
- [ ] Step 4: Same tests → PASS; `npx tsc --noEmit`; `npm run lint`.
- [ ] Step 5: Commit "Statistics: compare by implant type and case type; Explore full-arch factors".

### Task 4: Full arch tab

**Files:** Create `web/src/app/(app)/statistics/full-arch/page.tsx`, `full-arch/data.ts`, `full-arch/page.test.tsx`; modify `web/src/lib/research/tabs.ts` (+ `tabs.test.ts`).

**Interfaces:** Consumes Task 1 (`analysis_full_arch_cases`, `full_arch_planned_cases`, `implant_rehab_vars`, `implant_outcomes_detail`) and Task 2 (`summariseCases`, `caseOutcome`). Produces `loadFullArch(filters): Promise<{ columns: CaseColumn[]; cases: (FullArchCaseRow & ReturnType<typeof caseOutcome>)[]; planned: number }>`.

- [ ] Step 1: Tests: `tabs.test.ts` — "Full arch" after Courses (after Explore in a clinic); page test (mock `loadFullArch`): one column per case type with the rows of the spec (cases; reached the final bridge k of n; median months with min–max; closed without completion; cases with a bridge problem + total problems; cases that lost an implant + failed/placed; implants per case; survival 1 y / 2 y; link "Implant survival curves" → `/statistics?compare=case_type&<filters>`); thin-data warning under 30 cases; the planned note; case list links to `/patients/<id>?view=arch` with file no., arch, status, first placement, final bridge date.
- [ ] Step 2: `npm test -- tabs full-arch` → FAIL.
- [ ] Step 3: Implement; the page guards with `requirePermission('research')` (and Patients view as the other Statistics pages), reads filters with `readParams()`, reuses `FilterForm`.
- [ ] Step 4: Same → PASS; tsc; lint.
- [ ] Step 5: Commit "Statistics: Full arch tab".

### Task 5: Export, E2E, docs

**Files:** Modify `web/src/lib/research/export/dictionary.ts` (+ test), `reader-columns.fixture.ts`, `web/src/app/(app)/statistics/export/route.ts` (+ `route.test.ts`), `web/src/app/(app)/statistics/analysis.R` only if it enumerates tables; create `web/tests/e2e/statistics-full-arch.spec.ts`; docs `web/src/app/(app)/statistics/CLAUDE.md` (one paragraph "Full arch and implant types (0146)"), root `CLAUDE.md` one line.

**Interfaces:** Consumes Task 1 export readers and Task 2 `caseOutcome`. Produces: `TABLE_NAMES` += `'full_arch_cases'`; implants table gains merged columns `implant_type, angulation_deg, angulation_direction, anchorage, case_code, case_configuration` (merged by `implant_code`, like `research_consent` by `patient_code`); `full_arch_cases` columns: `case_code, patient_code, arch, configuration, status, first_placed_on, final_bridge_on, closed_on, scan_on, lab_design_on, try_in_on, implants_placed, implants_failed, bridge_problems` (`status`/`final_bridge_on` from `caseOutcome`; `sites`/`bridges` dropped before `assertAllowlisted`); date-first column `first_placed_on`.

- [ ] Step 1: Tests: dictionary has an entry for every new column (coded values listed); route test — workbook has a `full_arch_cases` sheet and the implants sheet has the merged columns; a reader returning an extra column still throws; no `sites`/`bridges` in the file. E2E: seed (API) an All-on-4 case with 2 tilted + 2 straight implants and a final bridge over all four, plus a zygomatic implant, unique brand; Results `compare=zyg_vs_tilted` shows "Zygomatic" and "Tilted in All-on-4"; Full arch tab shows All-on-4 "1 of 1" reached the final bridge; export xlsx contains `full_arch_cases` with an `A-` code.
- [ ] Step 2: `npm test -- dictionary export` → FAIL.
- [ ] Step 3: Implement; write the docs.
- [ ] Step 4: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`, `npx playwright test statistics-full-arch research research-export --project=chromium`, `npm run build` → all pass.
- [ ] Step 5: Commit "Statistics: export full-arch columns and cases; E2E and docs".
