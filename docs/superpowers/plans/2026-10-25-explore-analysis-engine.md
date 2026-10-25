# Explore Clinical Data: analysis engine (PR 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The data and pure-TS engine behind the Explore tab. Given rows the user may see and an analysis config (factor, outcome, timepoint, filters), it returns the valid views, group summaries, the right basic test, effect sizes, missing-data counts, warnings and plain-language findings. There is no UI yet (that is PR 4).

**Architecture:** Migration 0078 adds three security-invoker readers. They take the same six filter arguments and gate as the existing research readers.
- `analysis_implants`: one row per placed implant.
- `analysis_visits`: one row per non-voided visit.
- `analysis_radiographs`: one row per X-ray × implant on its teeth, with bone change against the `visit_grades` baseline.

Everything else is pure TypeScript in `web/src/lib/analysis/`, tested in isolation: a variable registry, time windows, observations with missing-data reasons, filters, view/test choice, statistics, warnings and wording. One `runAnalysis()` ties them together.

**Tech Stack:** Postgres SQL functions, TypeScript, Vitest (unit + DB). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-25-explore-clinical-data-design.md` (Engine and Data sections). Earlier context: `docs/superpowers/specs/2026-10-23-statistics-design.md`.

## Global Constraints

- Branch `feat/explore-engine`, cut from `perf/outcome-readers` (it carries a docs commit that ships with this PR). Work in `web/`.
- Migration `0078_analysis_readers.sql`.
- Readers:
  - `language sql stable security invoker set search_path = ''`.
  - Arguments `(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text)`.
  - Implant set = `implant_outcomes_detail(...)` with the same arguments.
  - `where (select public.can('research', 'view')) and (select public.can('patients', 'view'))`.
  - `revoke … from public, anon` / `grant … to authenticated`.
  - A deterministic `order by` that ends in a unique key (needed by `fetchAll`).
- No free text in any reader (no notes, reasons, names). `file_no` and `patient_id` are allowed, because the page already requires Patients view, and PR 4 links a point to its patient.
- Owner rules from `statistics/CLAUDE.md`:
  - Always show numbers; warn when thin (`THIN_AT_RISK = 30`, `THIN_EVENTS = 10`, `THIN_GROUP = 5` from `src/lib/research/stats.ts`).
  - "Not assessed" is its own group, shown but never tested.
  - No p-value without the clustering note when implants outnumber patients (`CLUSTER_NOTE` in `src/lib/research/groups.ts`).
- Spec copy, verbatim:
  - Small group: `⚠ This group contains only {n} implants. Results should be interpreted cautiously.`
  - Missing: `⚠ {pct}% of eligible implants have no {outcome} at this timepoint.`
  - Unequal: `⚠ Group sizes are substantially different.`
  - Spread: `⚠ Follow-up timing varies considerably between observations.`
  - Insufficient: `Not enough valid observations to generate a reliable comparison.`
  - Conflicting: `Some records contain inconsistent dates or clinical values.`
  - Causation: `Association does not necessarily imply causation.`
- Wording never contains "cause", "caused", "causes", "best", "worst", "better" or "worse". Denominators are written `{k} of {n} implants`. Delegate, supervisor and course groups are ordered by label, never by result.
- Survival time in months = `follow_up_days / 30.4375`, the same as the existing Statistics page. Rows with `event_time_unknown` are left out of survival and counted.
- Dates: implant-relative days only (`days_since_placement`). No `new Date()` formatting; the caller passes `today` (ISO, from `todayIso()`).
- The R script, the export and the existing Statistics pages are not touched.

## Review Focus

1. **The same implant measured twice in one window** (two 12-month X-rays). Exactly one value is used: the observation closest to the window target, with ties going to the later date. Test in Task 4.
2. **A factor level with no implants after filtering** (all smokers filtered out). The level is absent and no test runs on an empty group; no NaN appears in any number. Test in Task 7.
3. **An outcome where every value is identical** (all bone change 0). SD = 0, so Hedges g and Pearson r are undefined. They come back `null` and show as "—", never NaN or Infinity. Test in Task 2 (`hedgesG`, `pearson`) and Task 7.
4. **An implant that failed before the window.** It is counted as "Not applicable" for a measurement outcome, not as missing. A survival analysis still includes it. Test in Task 4.
5. **A continuous factor with too few distinct values to split at the median** (all torque 35). The survival view says it can't split and runs no test, instead of producing one empty group. Test in Task 7.

---

### Task 1: Migration 0078 — the three analysis readers

**Files:**
- Create: `web/supabase/migrations/0078_analysis_readers.sql`
- Test: `web/tests/db/analysis-readers.test.ts` (build fixtures like `tests/db/research-export.test.ts` `setup()`: unique brand `Zz Analysis <tag>`, two implants for one patient, an X-ray with bone levels, visits)

**Interfaces:**
- Produces, as SQL return columns:
  - `analysis_implants(...)` → `site_id uuid, patient_id uuid, file_no text, tooth smallint, course_id uuid, placing_delegate_id uuid, supervisor_id uuid, placed_on date, age_at_placement int, sex text, smoking text, cigarettes_per_day int, diabetes_status text, hba1c numeric, periodontitis_history text, bruxism text, previous_implant_failure text, brand text, system text, platform text, diameter_mm numeric, length_mm numeric, technique text, bone_type text, torque_ncm numeric, isq numeric, placement_timing text, grafting_performed text, membrane_used text, sinus_procedure text, soft_tissue_phenotype text, keratinized_mucosa_mm numeric, flap text, healing text, event boolean, event_on date, event_time_unknown boolean, follow_up_days int, latest_grade text, biological_complications int, mechanical_complications int, restoration_problems int, final_restoration_on date`.
  - `analysis_visits(...)` → `site_id uuid, visit_id uuid, date date, days_since_placement int, attendance text, pain_score int, swelling text, suppuration text, plaque text, mobility text, probing_max numeric, bop_any text, isq numeric, recession_facial_mm numeric, recession_mesial_mm numeric, recession_distal_mm numeric`.
  - `analysis_radiographs(...)` → `site_id uuid, radiograph_id uuid, taken_on date, days_since_placement int, purpose text, mesial_mm numeric, distal_mm numeric, is_baseline boolean, bone_change_mm numeric`.

- [ ] **Step 1: Write the failing DB tests**, each in `withTx`:
  - `analysis_implants returns the implant set of implant_outcomes_detail`. As admin with `{ brand }`, the site ids equal `implant_outcomes_detail`'s for the same filter, and the outcome columns (`event`, `follow_up_days`, `latest_grade`) are equal row by row.
  - `derives membrane, sinus, age and the final restoration`:
    - A `gbr` graft with `membrane 'resorbable'` gives `membrane_used = 'yes'` and `sinus_procedure = 'no'`.
    - A `sinus_lateral` graft gives `sinus_procedure = 'yes'`.
    - `grafting_performed = 'no'` gives `'no'` / `'no'`.
    - No surgery record gives `null` / `null`.
    - `age_at_placement` = whole years from `dob` to `placed_on`.
    - `final_restoration_on` = `fitted_on` of the earliest non-voided final restoration on the implant; `null` with only a temporary.
  - `analysis_visits summarizes probing and bleeding per visit`:
    - Probing 3/5/null/2 gives `probing_max = 5`.
    - BOP no/yes gives `bop_any = 'yes'`; all no gives `'no'`; all null gives `null`.
    - A did-not-attend visit is returned with `attendance = 'did_not_attend'` and null findings.
    - Voided visits are absent.
    - `days_since_placement` = `date - placed_on`.
  - `analysis_radiographs measures bone change against the visit_grades baseline`:
    - A baseline X-ray (mesial 0.2, distal 0.4), then a follow-up (0.9, 0.6), gives `bone_change_mm = 0.7` on the follow-up, `is_baseline` true on the first, and `bone_change_mm` null on the baseline row.
    - An X-ray of the tooth without bone levels is returned with null mm (the "not measured" case).
    - Planning and voided X-rays are absent.
  - `needs Research view and Patients view`. As `users.organizer`:
    - `setPerms(…, { patients: 'edit' })` without research gives 0 rows from all three.
    - Research view without Patients gives 0 rows.
    - The delegate gives 0 rows.
- [ ] **Step 2: Run them and see them fail** — `npm run test:db -- analysis-readers` → FAIL with `function public.analysis_implants(...) does not exist`.
- [ ] **Step 3: Write the migration**:
  - Join `implant_outcomes_detail(...) o` → `implant_sites s`, `patients p`, `medical_history m` (left), `products pr` (left), `implant_surgery su` (left).
  - Grafts: `exists` over non-voided `implant_grafts` (`membrane <> 'none'`; `procedure in ('sinus_crestal', 'sinus_lateral')`). The result is `null` when there is no surgery record and no graft rows; `'no'` when `grafting_performed = 'no'` or grafts exist but none match.
  - Count restoration problems through `restoration_sites`.
  - Radiographs:
    - Teeth match: `s.tooth = any (r.teeth)`; levels left join `radiograph_bone_levels` on `(radiograph_id, site_id)`.
    - Baseline = the first row of `order by (r.purpose = 'baseline') desc, r.taken_on, r.created_at` among measured, non-voided, non-planning X-rays with `taken_on >= placed_on`. Copy the `b` lateral from `visit_grades` (0066:96–103).
    - `bone_change_mm = greatest(mesial - b.mesial, distal - b.distal)` for measured X-rays dated after the baseline.
  - Order by: implants `placed_on, patient_id, tooth, site_id`; visits `site_id, date, visit_id`; radiographs `site_id, taken_on, radiograph_id`.
  - Dry-run it with the scratchpad `dryrun.ts` first.
- [ ] **Step 4: Run and see them pass** — `npm run test:db -- analysis-readers permissions` → PASS (`permissions.test.ts` checks the new functions are gated).
- [ ] **Step 5: Commit** — `feat(statistics): analysis readers (0078)`

### Task 2: Statistics library

**Files:**
- Create: `web/src/lib/analysis/tests.ts`, `web/src/lib/analysis/tests.test.ts`, `web/src/lib/analysis/tests.fixture.json`, `web/scripts/research/gen-analysis-fixture.R`

**Interfaces:**
- Consumes: `chiSquareP(chisq, df)` from `src/lib/research/stats.ts`.
- Produces:
  - `describe(xs: number[]): Descriptives | null` (null when empty), where `Descriptives = { n, mean, sd: number | null, median, q1, q3, min, max }`. Quantiles use R type 7. `sd` is null when n < 2.
  - `welch(a: number[], b: number[]): { diff: number; lo: number; hi: number; t: number; df: number; p: number } | null`. `diff = mean(b) − mean(a)`; 95% CI. Null when either n < 2 or both variances are 0.
  - `hedgesG(a, b): number | null`
  - `mannWhitney(a, b): { w: number; p: number } | null`. Normal approximation with continuity and tie correction (as R `wilcox.test(correct = TRUE)` with ties). W = rank-sum statistic of `a` (R's W).
  - `kruskalWallis(groups: number[][]): { h: number; df: number; p: number } | null`. Tie-corrected.
  - `chiSquare(table: number[][]): { chisq: number; df: number; p: number; minExpected: number } | null`. No continuity correction.
  - `fisher2x2(table: [[number, number], [number, number]]): { p: number }`. Two-sided, summing tables with probability ≤ observed (as R).
  - `riskDifference(k1, n1, k2, n2): { diff: number; lo: number; hi: number } | null`. Wald.
  - `pearson(x, y): { r: number; lo: number | null; hi: number | null; p: number } | null`. Fisher-z CI when n ≥ 4.
  - `spearman(x, y): { rho: number; p: number | null } | null`. t approximation; `p` null when n < 10.
  - `ols(x, y): { intercept: number; slope: number } | null`
  - `tCdf(t: number, df: number): number`, via the regularized incomplete beta (continued fraction).

- [ ] **Step 1: Write the fixture** from published R output (R isn't installed; same practice as `stats.fixture.json`), with a `source` line. Datasets:
  - `sleep` (`extra` by `group`: g1 `[0.7,-1.6,-0.2,-1.2,-0.1,3.4,3.7,0.8,0.0,2.0]`, g2 `[1.9,0.8,1.1,0.1,-0.1,4.4,5.5,1.6,4.6,3.4]`).
  - `mtcars` `mpg` and `wt` (32 values each, copied from R).
  - TeaTasting `[[3,1],[1,3]]`.
  - The `?chisq.test` table `[[762,327,468],[484,239,477]]`.
  - The `?kruskal.test` Hollander–Wolfe groups `[2.9,3.0,2.5,2.6,3.2]`, `[3.8,2.7,4.0,2.4]`, `[2.8,3.4,3.7,2.2,2.0]`.

  Expected values:

  | Call | Expected |
  |---|---|
  | `welch(g1, g2)` | t −1.8608, df 17.776, p 0.07939, CI 95% −0.2054832 … 3.3654832 (sign follows `diff = b − a`) |
  | `mannWhitney(g1, g2)` | W 25.5, p 0.06933 |
  | `pearson(wt, mpg)` | r −0.8676594, CI −0.9338264 … −0.7440872, p 1.294e-10 |
  | `spearman(wt, mpg)` | rho −0.886422, p 1.488e-11 |
  | `ols(wt, mpg)` | intercept 37.2851, slope −5.3445 |
  | `fisher2x2(tea)` | p 0.4857 |
  | `chiSquare(m)` | X² 30.07, df 2, p 2.954e-07 |
  | `kruskalWallis(hw)` | H 0.7714, df 2, p 0.68 |
  | `hedgesG(g1, g2)` | 0.7970 (hand-computed: d = 0.8322 × (1 − 3/71)) |
  | `describe(g1)` | mean 0.75, sd 1.789010, median 0.35, q1 −0.175, q3 1.70, min −1.6, max 3.7 |

  `gen-analysis-fixture.R` prints the same values when R is available.
- [ ] **Step 2: Write `tests.test.ts`**:
  - One `it` per call above, compared to the fixture at the digits given. The relative tolerance for p-values is 1e-3.
  - Plus: `describe([])` is `null`.
  - `hedgesG([1,1,1], [1,1,1])` and `pearson([1,2,3,4], [5,5,5,5])` are `null`.
  - `welch([1], [2,3])` is `null`.
  - `spearman` of 8 pairs has `p: null`.
  - `fisher2x2([[0,5],[5,0]]).p` ≈ 0.007937.
- [ ] **Step 3: Run and see them fail** — `npm test -- analysis/tests` → FAIL (module not found).
- [ ] **Step 4: Implement** `tests.ts` to the signatures. Use average ranks for ties.
- [ ] **Step 5: Run and see them pass**; commit — `feat(statistics): analysis statistics with R reference values`

### Task 3: Rows and the variable registry

**Files:**
- Create: `web/src/lib/analysis/rows.ts` (row types = the Task 1 columns, plus `AnalysisData = { implants: ImplantRow[]; visits: VisitRow[]; radiographs: RadiographRow[] }`), `web/src/lib/analysis/variables.ts`, `web/src/lib/analysis/variables.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = 'categorical' | 'binary' | 'ordinal' | 'continuous' | 'count' | 'survival' | 'longitudinal'`
  - `type Group = 'Patient' | 'Implant' | 'Site' | 'Surgical' | 'People' | 'Outcome'`
  - `type Variable = { key: string; label: string; group: Group; kind: Kind; role: 'factor' | 'outcome' | 'both'; unit?: string; levels?: { value: string; label: string }[]; source: 'implant' | 'visit' | 'radiograph'; measure?: Measure; get: (row: ImplantRow) => string | number | null }`. For observation outcomes, `get` is unused and `measure` names the observation.
  - `type Measure = 'bone_change' | 'bone_mesial' | 'bone_distal' | 'isq' | 'isq_change' | 'probing_max' | 'bop' | 'suppuration' | 'mobility' | 'plaque' | 'pain' | 'recession_facial' | 'recession_mesial' | 'recession_distal' | 'recession_max'` (in `rows.ts`)
  - `VARIABLES: Variable[]`
  - `variable(key: string): Variable | undefined`
  - `factorChoices(): Variable[]`
  - `outcomeChoices(): Variable[]`
  - `sortsByLabel(v: Variable): boolean` (true for `delegate`, `supervisor`, `course`)

- [ ] **Step 1: Write the failing tests** (`variables.test.ts`):
  - Every key is unique.
  - Every categorical, binary or ordinal variable has `levels`.
  - The factor keys include exactly: `age_band, sex, smoking, diabetes, periodontitis, bruxism, previous_failure, brand, system, platform, diameter, length, jaw, region, tooth, technique, bone_type, torque, isq_placement, placement_timing, grafting, membrane, sinus, phenotype, keratinized, flap, healing, delegate, supervisor, course`.
  - The outcome keys include exactly: `survival, failed, latest_grade, biological_complication, mechanical_complication, prosthetic_problem, final_restoration, bone_change, bone_mesial, bone_distal, isq, isq_change, probing_max, bop, suppuration, mobility, plaque, pain, recession_facial, recession_mesial, recession_distal, recession_max`.
  - `get` derivations on a fixture row:
    - tooth 36 → jaw `mandible`, region `posterior`; tooth 13 → region `anterior`.
    - Age 44 → age band `40–49`.
    - Diameter 4.1 → `4.1` (continuous).
    - `biological_complications 2` → `biological_complication 'yes'`; 0 → `'no'`.
    - A null smoking answer → `null`.
  - Labels reuse the existing maps (`PLACEMENT_TIMING_LABELS`, `PHENOTYPE_LABELS`, `FLAP_LABELS`, `HEALING_LABELS` from `src/lib/implants/surgery.ts`; `GRADE_LABELS` from `src/lib/research/view.ts`). Assert `variable('placement_timing')!.levels` equals the entries of `PLACEMENT_TIMING_LABELS`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
  - Region: anterior = FDI 13–23 and 33–43.
  - Age bands: `<30, 30–39, 40–49, 50–59, 60–69, 70+`.
  - Smoking levels: never/former/current, from `SMOKING` (`src/lib/patients/risk-factors.ts`).
  - Kinds:
    - continuous: torque, isq_placement, diameter, length, keratinized, the observation measures, age (`age` continuous plus `age_band` categorical).
    - binary: the yes/no fields and the outcome flags.
    - ordinal: bone_type D1–D4 and latest_grade.
    - survival: survival.
  - `failed` = `event`.
- [ ] **Step 4: Run and see them pass**; commit — `feat(statistics): analysis variable registry`

### Task 4: Time windows and observations

**Files:**
- Create: `web/src/lib/analysis/timepoints.ts`, `web/src/lib/analysis/observations.ts`, and the tests `timepoints.test.ts`, `observations.test.ts`

**Interfaces:**
- Consumes: `AnalysisData`, `ImplantRow`, `Measure` (Task 3).
- Produces:
  - `type TimepointKey = 'placement' | 'early' | 'm3' | 'm6' | 'm12' | 'm24' | 'later'`
  - `TIMEPOINTS: { key: TimepointKey; label: string; from: number; to: number | null; target: number }[]` with values: placement 0–0 target 0; early 1–60 target 30; m3 61–135 target 90; m6 136–270 target 180; m12 271–545 target 365; m24 546–910 target 730; later 911–null target = latest.
  - `type Window = TimepointKey | { from: number; to: number }` (a custom window's target is its midpoint).
  - `type MissingReason = 'not_applicable' | 'pending' | 'not_attended' | 'not_measured' | 'not_recorded' | 'missing'`
  - `MISSING_LABELS: Record<MissingReason, string>` = `{ not_applicable: 'Not applicable', pending: 'Pending (not due yet)', not_attended: 'Did not attend', not_measured: 'X-ray without measurement', not_recorded: 'Not recorded at the visit', missing: 'No record in this window' }`
  - `type Observation = { siteId: string; value: number | string; on: string; days: number }`
  - `observe(data: AnalysisData, measure: Measure, window: Window, today: string): { values: Map<string, Observation>; missing: Map<string, MissingReason> }`. Every implant in `data.implants` appears in exactly one of the two maps.
  - `trajectories(data: AnalysisData, measure: Measure, today: string): Map<string, Partial<Record<TimepointKey, Observation>>>` (one observation per window per implant).

- [ ] **Step 1: Write the failing tests:**
  - `windowFor(days)`: 0 → placement, 60 → early, 61 → m3, 545 → m12, 546 → m24, 2000 → later.
  - **Closest to target, later wins ties:** visits at day 300 (isq 70) and 400 (isq 74) for m12 (target 365) → 74. Visits at days 330 and 400 → the 400 one (35 days from target each way is a tie).
  - **No pooling:** an implant with ISQ only at day 100 gives nothing for m12.
  - Missing reasons, one implant each, window m12:
    - Placed 100 days before `today` → `pending`.
    - Failed with `event_on` at day 200 → `not_applicable`.
    - Only a did-not-attend visit in the window → `not_attended`.
    - An attended visit with null ISQ → `not_recorded`.
    - An X-ray of the tooth in the window with null mm (measure `bone_change`) → `not_measured`.
    - A bone_change X-ray in the window but no baseline (`bone_change_mm` null, measured) → `not_applicable`.
    - Nothing in the window and the window has passed → `missing`.
  - The placement window: `isq` comes from `ImplantRow.isq`. `isq_change` at m6 = visit isq − placement isq, and is `not_applicable` when the placement ISQ is null.
  - `recession_max` = the max of the three non-null sites. `bop` is the `'yes' | 'no'` string.
  - Today and the windows use day counts from `placed_on`, so 2026-02-28 → 2026-03-01 is 1 day (no timezone maths: parse ISO dates as UTC).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Bone measures come from `radiographs`, the rest from `visits`.
- [ ] **Step 4: Run and see them pass**; commit — `feat(statistics): follow-up windows and missing-data reasons`

### Task 5: Filters

**Files:**
- Create: `web/src/lib/analysis/filters.ts`, `web/src/lib/analysis/filters.test.ts`

**Interfaces:**
- Consumes: `variable(key)`, `ImplantRow`.
- Produces:
  - `type Filter = { key: string; values?: string[]; min?: number; max?: number }`. `values` is for categorical, binary and ordinal variables (keep rows whose value is in the list; the token `'__none'` matches null). `min`/`max` are inclusive bounds for continuous ones.
  - `applyFilters(rows: ImplantRow[], filters: Filter[]): ImplantRow[]` (AND across filters).
  - `describeFilters(filters: Filter[]): string[]`, for example `['Smoking: Current', 'Jaw: Mandible', 'Torque 30–45 Ncm']`.

- [ ] **Step 1: Write the failing tests:**
  - The spec example (smoking current AND mandible AND posterior AND delayed AND grafting no) keeps only the matching fixture row.
  - `min` without `max` works.
  - `'__none'` selects rows with no answer.
  - An unknown key throws `Unknown filter: <key>`.
  - `describeFilters` uses the level labels and units.
- [ ] **Step 2: Run, fail; Step 3: implement; Step 4: run, pass; Step 5: commit** — `feat(statistics): analysis filters`

### Task 6: View and analysis choice

**Files:**
- Create: `web/src/lib/analysis/choose.ts`, `web/src/lib/analysis/choose.test.ts`

**Interfaces:**
- Consumes: `Kind` (Task 3).
- Produces:
  - `type View = 'box' | 'strip' | 'scatter' | 'bar_stacked' | 'bar_grouped' | 'km' | 'trend' | 'trajectories' | 'summary' | 'table'`
  - `type Method = 'numeric_by_group' | 'correlation' | 'categorical_by_group' | 'survival' | 'trend' | 'describe'`
  - `choose(factor: Kind | null, outcome: Kind, longitudinal: boolean): { method: Method; views: View[]; explain: string }`. The first view is the default.

- [ ] **Step 1: Write the failing table test** (`it.each`); `count` is treated as continuous and `ordinal` as categorical:

  | factor | outcome | longitudinal | method | views |
  |---|---|---|---|---|
  | categorical | continuous | false | numeric_by_group | box, strip, table |
  | continuous | continuous | false | correlation | scatter, table |
  | binary | binary | false | categorical_by_group | bar_stacked, bar_grouped, table |
  | continuous | binary | false | numeric_by_group | box, table (groups = outcome levels, values = factor) |
  | categorical | survival | false | survival | km, table |
  | continuous | survival | false | survival | km, table (median split) |
  | categorical | continuous | true | trend | trend, trajectories, table |
  | null | continuous | false | describe | summary, table |
  | null | survival | false | survival | km, table |

  `explain` is plain language. For example, the categorical → continuous row's `explain` contains `compares the distribution of` and none of the banned words.
- [ ] **Step 2: Run, fail; Step 3: implement; Step 4: run, pass; Step 5: commit** — `feat(statistics): choose views and method from variable types`

### Task 7: Quality, wording and `runAnalysis`

**Files:**
- Create: `web/src/lib/analysis/quality.ts`, `web/src/lib/analysis/wording.ts`, `web/src/lib/analysis/run.ts`, and the tests `quality.test.ts`, `wording.test.ts`, `run.test.ts`

**Interfaces:**
- Consumes: everything above; `kmFit`, `survivalAtTime`, `logRank`, `THIN_*` from `src/lib/research/stats.ts`; `CLUSTER_NOTE`, `OPERATOR_NOTE` from `src/lib/research/groups.ts`.
- Produces:
  - `type AnalysisConfig = { factor: string | null; outcome: string; window: Window | 'all'; filters: Filter[] }`
  - `type Warning = { kind: 'small_group' | 'missing' | 'unequal' | 'spread' | 'insufficient' | 'conflicting' | 'cluster' | 'operator'; text: string }`
  - `type GroupSummary = { level: string | null; label: string; n: number; patients: number; stats: Descriptives | null; counts?: Record<string, number>; tested: boolean }`
  - `type AnalysisResult = { method: Method; views: View[]; explain: string; implants: number; patients: number; included: number; missing: Partial<Record<MissingReason | 'factor_not_assessed', number>>; groups: GroupSummary[]; test: { name: string; statistic: string; p: number } | null; effect: { name: string; value: number; lo?: number; hi?: number } | null; survival: { label: string; fit: KmFit; at12: number | null; at24: number | null }[] | null; points: { siteId: string; x: number | string; y: number | string }[]; trend: { label: string; window: TimepointKey; n: number; median: number; q1: number; q3: number }[] | null; warnings: Warning[]; findings: string[] }`
  - `runAnalysis(data: AnalysisData, config: AnalysisConfig, today: string): AnalysisResult`
  - `warningsFor(result: Omit<AnalysisResult, 'warnings' | 'findings'>, context: { eligible: number; spreadDays: number[]; conflicts: number; factorKey: string | null }): Warning[]`
  - `findingsFor(result: Omit<AnalysisResult, 'findings'>, labels: { factor: string | null; outcome: string; unit?: string }): string[]`

- [ ] **Step 1: Write the failing tests:**
  - `quality.test.ts`:
    - A group of 4 → the small-group text with `4`.
    - 38 of 100 eligible without a value → `⚠ 38% of eligible implants have no Marginal bone change at this timepoint.` Threshold: more than 20%.
    - Groups 50 and 10 (ratio > 4:1) → the unequal text.
    - Within-window day IQR greater than half the window width → the spread text.
    - Any tested group < 3 → the insufficient text and `test: null`.
    - `conflicts > 0` → the conflicting text. Conflicts = rows with `on < placed_on`, `event_on < placed_on` or `final_restoration_on < placed_on`.
    - Implants > patients and a p-value present → the `cluster` warning (`CLUSTER_NOTE`).
    - Factor delegate, supervisor or course → the `operator` warning (`OPERATOR_NOTE`).
  - `wording.test.ts`:
    - Two-group numeric where the medians differ → `Marginal bone change was higher in the Current group in this dataset (median 0.9 vs 0.4 mm).` Equal medians → `…was similar…`.
    - Categorical → `Biological complication: 6 of 38 implants (Current) vs 9 of 124 implants (Never).`
    - Correlation → `An association was observed between ISQ at placement and Marginal bone change (Spearman ρ −0.42).` with p < 0.05. Otherwise → `No clear association was observed…`.
    - `findings` ends with `Association does not necessarily imply causation.` whenever a factor is set.
    - No output contains a banned word: check all fixtures with `/\b(cause[sd]?|best|worst|better|worse)\b/i`.
  - `run.test.ts`, with a fixture of 12 implants / 9 patients:
    - Smoking → bone_change at m12: method `numeric_by_group`; groups ordered by level order with "Not assessed" last and `tested: false`; Mann–Whitney on the two tested groups; `effect.name` = `Mean difference` with CI; `missing` counts per reason add up to `implants − included`.
    - Delegate → failed: groups ordered by label, not by rate.
    - Smoking → survival: `survival` has one fit per tested group, plus log-rank; `event_time_unknown` rows are excluded and counted as `missing.not_applicable`.
    - **Empty level:** filter smoking to `current` only, then factor smoking → one group, `test: null`, no NaN anywhere (`JSON.stringify(result)` has no `NaN` or `null` where a number is required).
    - **Constant outcome:** all bone change 0 → `effect` null and the finding says `similar`.
    - **Unsplittable continuous factor:** all torque 35, outcome survival → `survival: null`, `test: null`, and the warning `Torque has too few distinct values to split into groups.`
    - `window: 'all'` with an observation outcome → method `trend`, `trend` rows per group per window.
    - `factor: null` → `describe`, one group "All implants".
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** `run.ts`:
  1. filters;
  2. factor values via `get`;
  3. outcome via `observe` (observation outcomes) or `get` (implant outcomes);
  4. `choose`;
  5. method-specific statistics from `tests.ts` / `stats.ts`;
  6. `warningsFor`;
  7. `findingsFor`.

  Statistics per method:
  - 2 tested groups (numeric): Mann–Whitney + Welch mean difference + Hedges g as a second effect in `groups` notes. ≥ 3: Kruskal–Wallis.
  - categorical: chi-square, or Fisher when 2×2 and `minExpected < 5`; risk difference for 2×2.
  - correlation: Spearman (test) + Pearson (effect, CI) + OLS for the trend line in `points`.

  Survival milestones use `survivalAtTime(fit, 12)` and `(fit, 24)`.
- [ ] **Step 4: Run and see them pass**; commit — `feat(statistics): runAnalysis with warnings and plain-language findings`

### Task 8: Docs and verification

**Files:**
- Modify: `web/src/app/(app)/statistics/CLAUDE.md`. Add an **Explore engine (0078)** bullet covering the readers and their gate, `src/lib/analysis/` modules, windows, missing reasons, method table pointer, wording rules, and "fixture from published R values".

- [ ] **Step 1: Write the docs bullet.**
- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npm run lint`, then `./scripts/ship.sh verify statistics` → green, except the known `search_patients` leftover-data failure; name it if it appears.
- [ ] **Step 3: Commit** — `docs(statistics): Explore engine rules`. This PR ships on its own (readers unused until PR 4, which is harmless). Alternatively the owner may hold it to ship with PR 4.
