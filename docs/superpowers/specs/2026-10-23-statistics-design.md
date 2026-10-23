# Statistics (research part 7) — design

Part 7 of the research roadmap, decided with the owner on 2026-10-23. It builds on 5b (the Research page) and part 6 (the export).

## Why
The Research page shows point estimates. The owner wants to see how certain those numbers are, and to compare groups. For proper analysis, the export should come with a ready-made R script that a statistician can run.

## Goals
1. **Confidence intervals** (owner):
   - Each survival tile (1 and 2 years) shows a 95% CI under the %. *My call:* Wilson score interval on survived / (survived + failed).
   - The survival curve gets a shaded 95% CI band. *My call:* Greenwood variance with the log-log transform, as in R's `survfit` with `conf.type = "log-log"`.
   - When M < 30, "small sample" stays alongside the wide interval.
2. **Group comparisons** (owner): a "Compare by" selector on the Research page with these options:
   - **Brand / implant line** (`brand`, or `brand · system`);
   - **Technique** (guided / free-hand);
   - **Loading** (immediate / early / conventional / not loaded). Derived in TS from `loaded_on` − `placed_on` with the part 3 constants (`LOADING_IMMEDIATE_DAYS`, `LOADING_EARLY_MONTHS`), reusing `loadingOf`'s rule.
   - **Patient risk factors:**
     - smoking (current / former / never / not assessed);
     - diabetes status;
     - periodontitis history;
     - bone type (D1–D4).

   When a group is chosen:
   - one survival curve per group (distinct design-token colours plus a legend);
   - a table per group with implants, 1- and 2-year survival with CI, and the ICOI share of I + II;
   - the **log-rank p-value** across groups;
   - "Not assessed" or missing values form their own group, shown but excluded from the test. *My call:* the note says so.
   - Groups with < 5 implants are shown with the thin-data warning (owner principle).
3. **Clustering note** (owner): the page shows a short note wherever a p-value or CI appears: "Patients can have several implants; these figures treat implants as independent. Use the R script for patient-clustered models."
4. **R script** (owner: R): `analysis.R` ships in the CSV zip and as its own download link on the Research page. It:
   - reads the CSVs and applies factor labels from `data_dictionary.csv`;
   - joins `patients` to `implants`;
   - runs Kaplan–Meier with CIs overall and per group (the same groups as the page);
   - runs log-rank tests;
   - runs a Cox model of implant loss on the risk factors and implant variables, with robust standard errors clustered by `patient_code` (`coxph(..., cluster = patient_code)`);
   - tabulates the ICOI distribution.

   It uses only `survival` plus base R (no other packages), is commented, and starts with a header naming the export it expects and the `outcomes-v1` rules.

## Settled after the builder check

### Owner decisions (2026-10-23)
- **Loading comparisons are a table only.**
  - Comparing by loading shows counts and survival per loading group with a warning: "Late-loaded implants had to survive until loading, so this comparison is biased; no test is shown."
  - It has no curves and no p-value. The R script does the same: descriptive only.
- **The headline survival is the Kaplan–Meier estimate.**
  - The 1- and 2-year tiles show the KM estimate at day 365 and 730, with its log-log 95% CI. Tiles and curve therefore always agree.
  - The tile still shows how many implants were at risk at that point, plus the SQL milestone breakdown: survived / failed / not reached / lost to follow-up. That breakdown is labelled "status at the milestone", without a % of its own.
  - *My call:* the Wilson interval is dropped from the tiles.
- **The R script adjusts for operator.**
  - The Cox model is stratified by `course_code` and includes `placing_delegate_code`, as a frailty or cluster term per patient.
  - The page adds a note: "Group comparisons here are not adjusted for who placed the implant or the course."

### Owner principle (2026-10-23): always show the numbers, and warn when the data is thin
- Tables, CIs and tests are **always computed and shown**, never hidden for small samples. When the data is thin, a clear warning sits next to them, e.g. "⚠ Not enough data — interpret with caution (n = 12, 1 failure)".
- So **every rule below that hides a figure becomes a warning instead.**
- **Thin data** means any of:
  - a group or estimate with < 30 implants at risk;
  - < 10 failures in a test;
  - a group with < 5 implants.
- **The only cases with no number** are ones that are mathematically undefined, such as a test with zero failures overall or a CI with zero events. They show "—", with "No failures yet, so this can't be estimated".
- **The loading comparison** keeps its curves and p-value hidden. That's a bias problem, not small numbers, as the owner decided above, and it still carries its bias warning.

### My calls
- Smoking is current / former / never (0043). Diabetes and periodontitis history are yes / no. "Not assessed" (null) is its own group and is excluded from tests.
- **Failures with an unknown date** are excluded from curves, CIs and tests. Every curve and p-value shows "N failure(s) with unknown date not included", and the group table counts them in a separate column.
- **When the log-rank test runs:** whenever at least two groups have >= 1 implant and there is >= 1 failure overall. Thin data (a group < 5 implants, < 10 failures) gets the warning, not a hidden result. With zero failures it shows "—" and "No failures yet". A group with zero events shows survival 100% and the CI as "not estimable", and its band isn't drawn.
- **R script safeguards:**
  - It prints, for each model, the n used, the events, and the rows dropped for missing covariates.
  - It fits one-variable Cox models for each factor.
  - It always fits the multivariable model when it can be estimated, and prints a clear warning when there are < 10 events per variable.
  - It restates the not-assessed rule.
- **Bone type** is per implant; the risk factors are per patient. The clustering note covers both.
- **`implant_outcomes_groups`** returns only `site_id`, technique, bone type, smoking, diabetes and periodontitis. It is gated by Research view and Patients view, like the others.
- **Labels:** the KM log-log CI is labelled "95% CI".

## Non-goals
- Multivariable models in the app (only in the R script).
- SPSS syntax (the owner chose R).
- Patient-level views in the app (the owner chose the note plus the script).
- New outcome rules.

## Anti-goals
- A p-value shown without the clustering note.
- A test run on groups too small to compare.
- An R script that doesn't match the export's column names.

## Constraints
- Group variables the page doesn't already have (technique, risk factors, bone type) need an additional reader. *My call:* `implant_outcomes_groups(...)`, with the same six filters and the same gate as `implant_outcomes_detail`, returning `site_id` plus the group columns. The page joins it in TS by `site_id`.
- The statistics are computed in TS for display (pure functions, unit-tested against known values from R: a fixture computed by `survival::survfit` and `survdiff` on a small dataset, committed with the test). Outcome status still comes only from SQL.
- The R script lives in the repo as `src/lib/research/export/analysis.R`. A unit test checks that every column name it references exists in the export dictionary.
- No new JS dependency for the statistics: the chi-square p-value is computed in TS. *My call:* a small regularized-gamma implementation, tested against known values.

## Left to the builder
- The exact UI for the selector and legend colours (design tokens).
- Rounding: CI to one decimal place; p as `p = 0.034`, or `p < 0.001`.
