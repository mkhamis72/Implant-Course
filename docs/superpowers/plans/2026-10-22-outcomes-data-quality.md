# Outcome rules and data quality (part 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute versioned implant survival, ICOI success, crown survival and complication counts in SQL readers for 5b and the exports, and add a Data quality page and badges for impossible dates.

**Architecture:**
- Migration 0066 adds pure SQL helpers and readers for outcomes: an ICOI grade per visit, `implant_outcomes` and `crown_outcomes`. Nothing is stored, and no UI shows outcomes in 5a.
- Migration 0067 adds `crown_outcomes`, 0068 adds `data_quality_issues`.
- The app adds `/patients/data-quality` and warning badges.

**Tech Stack:** Supabase plpgsql/SQL (security invoker readers), Vitest (`tests/db`, jsdom), Next.js 15, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-outcomes-data-quality-design.md`

## Global Constraints

**Process**
- Work from `web/`.
- Migrations 0066, 0067 and 0068 are additive: new functions only. Dry-run each before the first `npm run test:db`.

**Database conventions**
- Readers are `language sql stable security invoker set search_path = ''`, with `revoke … from public, anon; grant … to authenticated;`.
- They need View on Patients through RLS, the same as `implant_visits` / `recall_list`.
- Security-invoker functions can't call `app_private` functions, so helpers called by readers live in `public`, are `security invoker`, and are granted the same way.
- Outcome status is decided only in SQL, never recomputed in TS.

**Values**
- Version: `'outcomes-v1'` (in the constant function `public.outcomes_version()`).
- ICOI cut-offs live in one place, as constants inside `public.icoi_grade(...)`:
  - pain 0 = none; 1–3 = grade III; ≥ 4 = grade IV;
  - mobility `yes` = IV;
  - suppuration `yes` = III;
  - bone loss < 2 mm = I, 2–4 mm = II, > 4 mm = III, > half the implant length = IV;
  - any recorded probing > 7 mm = III;
  - failed or removed = IV.
- Grades are `'I'`, `'II'`, `'III'`, `'IV'`, `'not_assessable'`.

**Rules**
- **Survival** means still in the mouth. Events are `failure_type in ('lost','removed')` and `state = 'removed'`. `failed_in_place` survives.
- **Censoring:**
  - Last contact = the latest of the last attended visit date, the last X-ray with a measured bone level for the implant, and the event date.
  - Milestones:
    - **at loading:** loading date = the earliest non-voided restoration `fitted_on` for the site; null means `not_loaded`.
    - **1 year:** survived when there is a contact on or after day 305 from placement and no event before it.
    - **year N:** survived when there is a contact on or after day 365·N − 60 and no event before it.
  - An event on or before the milestone means `failed`; otherwise the result is `unknown`.
  - Legacy failures with null `failed_on` give `event_time_unknown = true` and `unknown` at every milestone.
- **Bone loss at a visit:**
  - Baseline = the earliest measured X-ray on or after placement with purpose `baseline`; otherwise the earliest measured X-ray on or after placement.
  - Follow-up X-ray = the latest measured X-ray on or before the visit date and after the baseline.
  - Bone loss = max over mesial/distal of (follow-up − baseline), computed only for sides measured on both.
  - No baseline or no follow-up X-ray gives `not_assessable`.
- **Gradable visit:** attended, with `pain_score`, `mobility` and `suppuration` all not null, plus bone loss. Otherwise `not_assessable`, except that a failed or removed implant is IV.
- **Crown survival:**
  - Covers every non-voided final restoration; its start is `fitted_on`; the event is `end_kind = 'remade'`.
  - Censoring is at the latest contact across its implants, or at the first survival event among them.
- **Data-quality checks** (impossible dates only):
  - visit, complication, restoration (`fitted_on`), non-planning X-ray, or `failed_on` before the implant's `placed_on`;
  - any of those dates after `cairo_today()`;
  - a restoration problem before its restoration's `fitted_on`.

## Review Focus
1. **Missing X-ray data:** an implant with visits but no measured baseline X-ray gets `not_assessable`, never `I`. (Task 1 test.)
2. **Grade boundaries:** bone loss exactly 2.0 mm gives II and exactly 4.0 mm gives II; 4.1 gives III. Half the implant length on a 10 mm implant gives IV only above 5.0 mm. (Task 1 test.)
3. **Lost to follow-up:** an implant last seen at day 200 is `unknown` at 1 year, never `survived`. (Task 1 test.)
4. **failed_in_place** is `survived` at 1 year when it was seen after day 305, yet graded IV. (Task 1 test.)
5. **Data-quality scope:** a planning X-ray dated before placement isn't flagged; a follow-up visit dated before placement is. (Task 3 test.)

---

### Task 1: Migration 0066 — ICOI grade and implant outcomes

**Files:**
- Create: `supabase/migrations/0066_outcomes.sql`
- Test: `tests/db/outcomes.test.ts`

**Interfaces:**
- Produces:
  - `public.outcomes_version() returns text` (immutable) → `'outcomes-v1'`
  - `public.icoi_grade(p_failed boolean, p_pain int, p_mobility text, p_suppuration text, p_bone_loss_mm numeric, p_implant_length_mm numeric, p_max_probing_mm numeric) returns text` (immutable)
    - It is pure: it returns `not_assessable` when pain, mobility, suppuration or bone loss is null, unless `p_failed`.
    - The worst applicable grade wins.
  - `public.visit_grades(p_patients uuid[]) returns table (site_id uuid, visit_id uuid, visit_date date, bone_loss_mm numeric, grade text, reason text)`
    - One row per attended visit.
    - `reason` is a short text, e.g. `'bone loss 2.4 mm'`, `'pain 4'` or `'no baseline X-ray'`.
  - `public.implant_outcomes(p_course uuid, p_from date, p_to date) returns table (site_id uuid, patient_id uuid, tooth smallint, course_id uuid, placed_on date, loaded_on date, last_contact date, follow_up_days int, event boolean, event_on date, event_time_unknown boolean, at_loading text, year_1 text, year_2 text, year_3 text, year_5 text, latest_grade text, latest_grade_on date, ungraded_later int, biological_complications int, mechanical_complications int, version text)`
    - Null params mean no filter.
    - The course matches `implant_sites.course_id`, with the date-plus-enrollment fallback used by `course_report`.
    - The `from`/`to` range is on `placed_on`.
    - Milestone values: `survived` / `failed` / `unknown` / `not_loaded` (`at_loading` only).

- [ ] **Step 1: Write the failing DB tests** in `tests/db/outcomes.test.ts`.
  - Use the fixtures `place` (with `placedOn`), `record_visit` calls (see `visits.test.ts`), `save_radiograph` with bone levels (see `radiographs.test.ts`), `add_restoration` and `legacyFailure`.
  - Name patients `Zz Outcome …`.
  - `icoi_grade` unit cases, through `select public.icoi_grade(...)`:
    - `(false,0,'no','no',1.9,10,null)` → `I`
    - `2.0` → `II`; `4.0` → `II`; `4.1` → `III`
    - `5.1` with length 10 → `IV`
    - pain `2` → `III`; pain `4` → `IV`
    - suppuration `yes` → `III`; mobility `yes` → `IV`
    - probing `7.5` → `III`
    - pain null → `not_assessable`
    - `p_failed = true` with every other value null → `IV`
  - `implant_outcomes`:
    - `no baseline X-ray means not_assessable` (Review Focus 1)
    - `bone loss uses baseline then latest X-ray on or before the visit`: baseline mesial 0.5, a 1-year X-ray mesial 3.0, so bone loss is 2.5 and the grade is II.
    - `lost to follow-up is unknown at one year` (Review Focus 3)
    - `failed_in_place survives but is graded IV` (Review Focus 4)
    - `lost implant is failed at the milestone after its failure`
    - `legacy failure without a date has event_time_unknown and unknown milestones`
    - `at_loading is not_loaded without a restoration and survived with one`
    - `filters by course and placement date range`
    - `version is outcomes-v1`
    - `a viewer without Patients view sees no rows`
- [ ] **Step 2: Run** `npm run test:db -- outcomes`. Expected: FAIL.
- [ ] **Step 3: Write 0066** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- outcomes permissions`. Expected: PASS. If `permissions.test.ts` lists the public functions of readers, update it.
- [ ] **Step 5: Commit** `feat(db): versioned implant outcomes and ICOI grading (0066)`

### Task 2: Migration 0067 — crown outcomes

**Files:**
- Create: `supabase/migrations/0067_crown_outcomes.sql`
- Test: `tests/db/crown-outcomes.test.ts`

**Interfaces:**
- Produces: `public.crown_outcomes(p_course uuid, p_from date, p_to date) returns table (restoration_id uuid, patient_id uuid, type text, teeth smallint[], fitted_on date, last_contact date, follow_up_days int, remade boolean, remade_on date, censored_by_implant_event boolean, problems int, version text)`
  - Covers non-voided final restorations.
  - The course is `restorations.course_id`, falling back to the restoration's course rule (`course_restorations` in 0058). The `from`/`to` range is on `fitted_on`.

- [ ] **Step 1: Write the failing tests:**
  - `a remade crown is an event at its end date`
  - `a replaced temporary is not listed`
  - `a bridge's last contact is the latest across its implants`
  - `crown censored at the first implant loss under it`
  - `problem count`
  - `version`
- [ ] **Step 2: Run** `npm run test:db -- crown-outcomes`. Expected: FAIL.
- [ ] **Step 3: Write 0067** and dry-run it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): crown outcomes`

### Task 3: Data-quality issues reader + page + badges

**Files:**
- Create: `supabase/migrations/0068_data_quality.sql`
- Create: `src/lib/data-quality/issues.ts` (+ test), `src/app/(app)/patients/data-quality/page.tsx`
- Modify: the patient header (`patients/[id]/layout.tsx`) and the tooth panel (`implant-section.tsx` or `site-details.tsx`) for the badges; the patients list page, with a "Data quality" link next to "Recall list"
- Test: `tests/db/data-quality.test.ts`, component tests for the badge

**Interfaces:**
- Produces:
  - `public.data_quality_issues(p_patient uuid) returns table (patient_id uuid, patient_name text, file_no text, site_id uuid, tooth smallint, kind text, record_table text, record_id uuid, record_date date, reference_date date, message text)`
    - `p_patient` null means all patients.
    - `kind` is one of `before_placement`, `in_future`, `problem_before_fitting`.
    - `message` is a full sentence, e.g. `'Follow-up visit dated 2026-01-02 is before the placement date (2026-02-01).'`
  - `src/lib/data-quality/issues.ts`: `issueLink(issue): string`, which links to the record's place: visits / complications / restoration → `/patients/<id>?tooth=<n>`; X-ray → `/patients/<id>/xrays`.
  - **Page:**
    - `requirePermission('patients')`.
    - A table: patient (link), tooth, problem, date, "Fix" link.
    - Empty state: "No date problems found."
  - **Badges:** a `badge-warn` with the text "Date problem" (plus the count when it's more than 1):
    - in the patient header when that patient has issues;
    - on the implant's tooth panel when the issue's `site_id` matches.

- [ ] **Step 1: Write the failing tests:**
  - DB tests, one per check, plus Review Focus 5: the planning X-ray isn't flagged, a follow-up before placement is.
  - DB test: viewer access.
  - Unit test for `issueLink`.
  - Component test: the badge shows on the tooth panel only for the matching site.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The database refuses most of these dates today, so the tests create bad rows directly as postgres.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run test:db -- data-quality`. Expected: green.
- [ ] **Step 5: Commit** `feat: data-quality page and badges for impossible dates`

### Task 4: E2E + docs

**Files:**
- Create: `tests/e2e/data-quality.spec.ts`
- Modify: `CLAUDE.md`: add an **Outcomes and data quality (0066–0068)** bullet covering the version, the ICOI constants location, the censoring rule, readers only (no UI until 5b), and the data-quality checks.

- [ ] **Step 1:** In the E2E spec:
  - Seed a patient with a placed implant through `placeImplant`.
  - Insert a visit dated before placement through the API, using service role or the test helper. If there's no API path, use a postgres insert in global setup style (`api.ts` helpers).
  - Expect `/patients/data-quality` to list it, and the patient header to show "Date problem".
- [ ] **Step 2: Run** `npx playwright test data-quality` (check :3000 and memory first). Expected: PASS.
- [ ] **Step 3:** Write the docs bullet.
- [ ] **Step 4: Verify** with `./scripts/ship.sh verify data-quality`. Expected: "Verified".
- [ ] **Step 5: Commit** `test(e2e): data quality; docs`
