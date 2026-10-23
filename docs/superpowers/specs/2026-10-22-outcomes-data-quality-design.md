# Outcome rules and data quality (research part 5a) — design

Part 5 of the research roadmap, split by the owner on 2026-10-22:
- **5a (this document):** the outcome rules, plus data-quality checks for impossible dates.
- **5b (later):** the Research page (numbers, survival curve, filters) and a new "Research" permission.

## Why
The owner wants to report implant survival, implant success, crown survival and complication rates from the course data. The outcome rules have to be defined once, in the database, and kept versioned, so that every number in 5b, and every export in part 6, means the same thing. Impossible dates would quietly corrupt those numbers, so they get found and fixed first.

## Goals

### 1. Outcome rules, computed in SQL and never stored or typed

**Implant survival** (owner)
- The clock starts at **placement**.
- An implant survives while it is still in the mouth: `lost` and `removed` are events, and `failed_in_place` survives (owner).
- **Censoring (owner): count up to the last visit.**
  - An implant's follow-up time ends at the latest of its last attended visit, its last measured X-ray, or its failure date.
  - After that its status is unknown.
  - It never counts as surviving past its last contact.
- **Reported at (owner):** at loading, at 1 year, at 2 years and later, plus the per-implant data a survival curve needs. That data is time and event (failed yes/no) per implant.

**Implant success: ICOI 2008 (Misch) health scale** (owner)
- The implant is graded at each assessment point, a follow-up visit, on the visit's findings plus bone loss:
  - **I — Success:** no pain or tenderness, no mobility, < 2 mm bone loss since baseline, no exudate.
  - **II — Satisfactory survival:** no pain, no mobility, 2–4 mm bone loss, no exudate.
  - **III — Compromised survival:** may have sensitivity, no mobility, > 4 mm bone loss (less than half the implant length), probing depth > 7 mm, or a history of exudate.
  - **IV — Failure:** pain on function, mobility, bone loss > half the implant length, uncontrolled exudate, or no longer in the mouth (failed or removed).
- **Bone loss** is the bone level on the latest measured X-ray minus the baseline bone level (part 4).
  - It is taken per surface, and the worse of mesial and distal is used.
  - The baseline is the earliest measured X-ray on or after placement with purpose `baseline`. *My call:* if there is none, the earliest measured X-ray on or after placement is used instead.
- *My call:* any criterion the grade needs that is missing gives **"not assessable"**, never a better grade. One exception: a failed or removed implant is graded IV regardless.
- The implant length comes from its product (`length_mm`).

**Crown survival** (owner)
- The clock starts at the final restoration's **fitting date**.
- The event is a **remake** (`end_kind = 'remade'`). A replaced temporary is not an event.
- Censoring is at the last visit, or at the end date when the implant failed under it.

**Complication rates** (owner)
- Biological and mechanical complications per implant (from `implant_complications`), and restoration problems per final restoration (`restoration_problems`).
- Counts and the share of implants or crowns with at least one, over follow-up time.

**Versioning**
- Each rule set has a version, starting with `outcomes-v1`, and every reader returns it.
- A later change to a rule becomes a new version, so earlier numbers stay explainable.

### 2. Readers for 5b and part 6
Security-invoker SQL functions, readable with View on Patients for now (5b adds the Research permission):
- `implant_outcomes(…)`: one row per implant. It returns:
  - placement date, loading date, last contact, follow-up days;
  - survival status at loading, 1 year and 2 years (survived / failed / unknown);
  - an event flag for the curve;
  - the latest ICOI grade with its reason;
  - complication counts;
  - the rule version.
- `crown_outcomes(…)`: one row per final restoration. It returns fitting date, remade yes/no, time, censoring, problem counts and the version.
- *My call:* both readers can be filtered by course and by placement date range. 5b needs that.
- **No UI shows outcomes in 5a** (owner: Research page only).

### 3. Data-quality checks: impossible dates only (owner)
- A visit, complication, restoration, non-planning X-ray, or failure date earlier than the implant's placement date.
- *My call:* also a date in the future, where the database didn't already refuse it, and a crown problem dated before its restoration's fitting date.
- **Where they show** (owner: both):
  - a **Data quality** page listing each issue with patient, tooth, what's wrong, and a link to fix it;
  - a warning badge on the patient (patient header) and on the implant (tooth panel).
- *My call:* access to the page is View on Patients. The badge shows to anyone who can see the patient.

## Settled after the builder check

### Owner decisions (2026-10-22)
- **Pain** (`pain_score` 0–10):
  - 0 = no pain, which allows grades I/II;
  - 1–3 = "sensitivity", grade III;
  - 4 or more = "pain on function", grade IV.
- **Suppuration** is judged at the graded visit only. Suppuration = yes gives grade III. An earlier, resolved episode has no effect.
- **Probing is optional.** A visit is graded from pain, mobility, suppuration and bone loss. A probing depth > 7 mm at any recorded site lowers the grade to III. When probing is blank, it isn't used.
- **Survival means still in the mouth.** `failed_in_place` counts as surviving (graded IV for success). `lost` and `removed` are survival events.

### My calls
- **Loading date** is the fitting date of the implant's first restoration, temporary or final. This matches part 3's loading rule. An implant never loaded has "not loaded" at the loading milestone.
- **Required to grade a visit:**
  - The visit was attended, and pain, mobility and suppuration were recorded.
  - Bone loss: the latest X-ray with a measured bone level for that implant, dated on or before the visit and on or after the baseline, minus the baseline. The X-ray can be from an earlier date than the visit.
  - If any of these is missing, the visit is **not assessable**.
- **"Latest grade"** is the most recent *assessable* grade, returned with its visit date. The number of later visits that couldn't be graded is returned alongside it.
- **Milestones use the existing visit windows.**
  - "Survived at 1 year" means a contact on or after day 305 from placement (the start of the `month_12` window) with no survival event before it.
  - 2 years and later use the same rule with the `year_N` windows (± 60 days).
  - A survival event before the milestone counts as "failed". No qualifying contact means "unknown".
- **Legacy failures with no `failed_on`** are a survival event with an unknown time. They are left out of the curve data, are "unknown" at each milestone, and are counted separately in the reader output. They are not a data-quality issue.
- **Crown survival:**
  - It covers every final restoration, with its type as a column, so 5b can filter to single crowns.
  - Last contact is the latest contact across all implants under the restoration.
  - It is censored at the first survival event among those implants.
  - The event is `remade`, accepted as recorded.

## Non-goals
- The Research page, the survival curve chart, filters UI and the Research permission (5b).
- Missing-follow-up, missing-baseline and incomplete-record checks (not chosen by the owner).
- Storing outcome values.
- Exports (part 6).

## Anti-goals
- "Not assessable" shown or counted as success.
- Implants lost to follow-up counted as survivors past their last contact.
- A rule changed without a new version.

## Constraints
- Readers are security invoker and need View on Patients. They follow existing patterns (`implant_visits`, `recall_list`).
- Status logic lives only in SQL, never recomputed in TS (the project rule from visits).
- The migration is additive: new functions only.
- The ICOI cut-offs and the version string are constants in one place in SQL, with DB tests for each grade boundary (< 2, 2–4, > 4, more than half the length).

## Left to the builder
- The function shapes beyond the columns above.
- The badge look.
- The layout of the Data quality page.
- Grouping issues per patient.
