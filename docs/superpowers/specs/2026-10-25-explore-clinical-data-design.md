# Explore Clinical Data (Statistics → Explore) — design

Date: 2026-10-25. Builds on `2026-10-23-statistics-design.md` and `2026-10-24-statistics-module-design.md`. Feature rules live in `web/src/app/(app)/statistics/CLAUDE.md`.

## Intent

Statistics today answers fixed questions: survival tiles and KM curve, ICOI bars, complications, "Compare by" seven groupings with log-rank, drill-downs, the anonymised export with an R script, and Studies. The owner wants course directors, supervisors and organizers to ask their own questions of the clinical data the app already holds — pick a factor and an outcome, see the right chart and the right basic statistics at once — without assembling spreadsheets and without the app pretending to be a statistician.

The user chooses the clinical question. The app organises the data, picks suitable charts and tests, states denominators, warns about thin or missing data, and never claims causation.

## Goals

- An **Explore** tab: factor + outcome pickers, automatic view and analysis choice, view switcher, filters, follow-up timepoints, key numbers, statistical summary, data-quality warnings, excluded/missing counts by category, plain-language interpretation.
- **Recession** recorded at follow-up visits (facial, mesial, distal).
- **Saved analyses**, shared within the company.
- **Print-ready report** (browser "Save as PDF"), chart image export, underlying-data CSV under the existing export rules.
- **Course overview**: per-course aggregates and side-by-side comparison.
- Faster readers: unfiltered All courses must be well inside the statement timeout.

## Non-goals (v1)

- Multivariable, mixed-effects or Cox models in the app (the R script keeps Cox).
- X-ray quality/examiner fields; ISQ device, direction or multiple readings.
- Server-generated PDF files; private saved analyses; per-course permissions.
- Any change to the Results, Studies or Recent exports tabs, or to other modules beyond the recession fields on the visit form.

## Anti-goals

- A causal sentence ("smoking causes…"), or "best/worst" operator wording or ordering by outcome for delegates, supervisors or courses.
- A percentage without its denominator.
- A number hidden because data is thin (owner rule: always show, warn when thin).
- Pooling measurements from different timepoints.
- An estimated or fabricated measurement; an X-ray without a bone level counts as "Not measured".
- Any path that shows data the user couldn't see on the Results page.

## Decisions (owner)

- Analyse existing data; add recession capture only.
- Add a chart library.
- PDF = print-ready page.
- Saved analyses visible to everyone with Statistics (Research) view; creator or admin renames/deletes.

## Builder's calls (made during planning; owner may revisit)

- Chart library: Apache ECharts, tree-shaken, SVG renderer, loaded only on Explore and its print page (server `renderToSVGString` for vector print). The existing hand-drawn survival chart stays.
- Recession: three numeric columns on `implant_followups`, mm, 0–15, null = not measured. Examiner = the visit's recorder (audit); method in the visit notes.
- Missing-data categories are derived: Not recorded, Not attended, Pending, Not applicable, Not measured.
- Underlying-data CSV uses study codes and `DICTIONARY` columns and is logged in `research_exports`.

## Access

No new permission model. Area-level only (no per-course/per-patient restriction exists). Pages: `requirePermission('research')` plus the Patients-view note as on Results. Readers: security invoker, gated on `(select public.can('research','view'))` and `can('patients','view')`. Saving: `require_perm('research','edit')`. Delegates never. Tenant isolation is the existing one database per company.

## Data

- **Recession (0076):** `implant_followups.recession_facial_mm / recession_mesial_mm / recession_distal_mm`, read by `record_visit` from `p_findings` like probing (no signature change). Added to the visit form/display and to `research_export_visits` + `DICTIONARY` (two PRs if the previous build's allowlist rejects unknown columns).
- **Readers (0077):** `analysis_implants(filters)` one row per placed implant with patient, implant, site, surgical, people and implant-level outcome columns (outcomes reused from `implant_outcomes_detail`); `analysis_observations(filters)` long format `(site_id, measure, value, observed_on, days_since_placement, source_id, not_attended)` for bone change (baseline rule of `visit_grades`, 0066), mesial/distal bone level, ISQ, max probing, BOP any, suppuration, mobility, recession ×3, plaque, pain. Filter args are the existing six.
- **Saved analyses (0078):** `saved_analyses(id, title, config jsonb, course_id, created_by, created_at, updated_at)`, audited; `save_analysis` / `delete_analysis` definer functions; `config` validated by a versioned Zod schema.

## Engine (`src/lib/analysis/`, pure TS)

- `variables.ts` registry (key, label, group, kind, role, unit, levels, accessor, missing classifier). Derived: jaw, anterior/posterior (FDI 13–23, 33–43 anterior), age bands, median split of a continuous factor for survival groups.
- `timepoints.ts`: Placement (0), Early (1–60 d), 3 mo (61–135), 6 mo (136–270), 12 mo (271–545), 24 mo (546–910), Later (> 910), custom; one observation per implant per window (closest to target).
- `filters.ts`: patient, implant, site, surgical, people, follow-up; ANDed; URL state.
- `choose.ts`: factor kind × outcome kind → views (default first) + analysis:
  - categorical → continuous: box, strip, table; Mann-Whitney + Welch mean difference CI + Hedges g (2 groups), Kruskal-Wallis (≥ 3).
  - continuous → continuous: scatter + trend, table; Spearman (primary), Pearson with CI, OLS slope.
  - categorical → categorical/binary: stacked bar, grouped bar, table; chi-square, Fisher 2×2 when expected < 5, risk difference CI.
  - continuous → binary: box, table; Mann-Whitney.
  - → survival: KM, table; existing `kmFit` / `logRank`.
  - longitudinal: trend by timepoint, trajectories, table; descriptive.
- `tests.ts`: descriptives, Welch t, Mann-Whitney, Kruskal-Wallis, chi-square, Fisher, Pearson, Spearman, OLS; checked against R outputs in a fixture.
- `quality.ts`: group < 5 warning; < 3 per group → no test; missing > 20%; group ratio > 4:1; follow-up spread (IQR > half window); conflicting records from `data_quality_issues`; clustering note when implants > patients.
- `wording.ts`: non-causal templates, "N of M" denominators, "Association does not necessarily imply causation."

## Screens

- **Explore** (`/statistics/explore`): "What would you like to understand?" factor/outcome pickers; timepoint; filter chips; "Current analysis" line; key-number cards; view switcher (valid views only); chart with tooltips, zoom on scatter/trend, point → patient file no + tooth link; summary; data quality; included / excluded by category; interpretation; underlying table toggle; Save; Saved analyses list; Print; Export chart; Export data. Computation runs in the browser over rows loaded by the server.
- **Print** (`/statistics/explore/print?…`): title, variables, filters, population, sample sizes, main + optional alternative chart, statistics, missing data, warnings, company branding, course context, Cairo date, limitations.
- **Courses** (`/statistics/courses`): per course by start date — implants, patients, systems, dimension mix, follow-up completion, prosthetic completion, complication counts, measurement availability; side-by-side for ticked courses; "N of M", no ranking; link into Explore.

## Delivery

Six PRs: (1) recession, (2) reader speed, (3) engine, (4) Explore UI, (5) saved + print + exports, (6) course overview. Each verified with `./scripts/ship.sh verify` and its E2E specs.
