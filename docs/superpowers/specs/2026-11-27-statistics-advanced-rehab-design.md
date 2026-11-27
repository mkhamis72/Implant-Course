# Statistics for zygomatic and full-arch work — design

Date: 2026-11-27 · Project E of the advanced-rehabilitation request (B components, A implant types, C full-arch view and cases, D Implant Passport all released). Status: draft for owner approval.

## Why
The owner wants to see, for themselves, how their advanced work turns out. Two questions:
1. **Zygomatic vs tilted:** do zygomatic implants do as well as **tilted implants in All-on-4 cases** (the usual alternative for the back of an atrophic maxilla)?
2. **All-on-4 vs All-on-6:** do All-on-4 cases do as well as All-on-6 cases?

Statistics today works implant by implant (survival, complications, bone level, probing, restoration problems) and can compare by brand, technique, loading, smoking, diabetes, periodontitis and bone type. It does not know implant type (0139), angulation or anchorage (0140), or full-arch cases (0142–0143), and it has no case-level outcome.

## Goals
- **Results → Compare by** gains three options:
  - **Implant type** (conventional / tilted / zygomatic / pterygoid / not recorded).
  - **Full-arch case type** (All-on-4 / All-on-6 / All-on-X / Other / not in a case).
  - **Zygomatic vs tilted (All-on-4)** — the owner's question 1 in one click: two groups, *Zygomatic* (every zygomatic implant) and *Tilted in All-on-4* (tilted implants in an All-on-4 case); every other implant is left out and the page says how many.
  Each gets the existing survival tiles, Kaplan–Meier curves, log-rank test and thin-data warning.
- **Explore** gains factors: implant type, angulation (°, continuous), tilt direction, anchorage, full-arch case type. Every existing Explore outcome (survival, complications, bone change, probing, bleeding, restoration problems) can then be split by them.
- **New tab Statistics → Full arch** (after Courses): one column per case type (All-on-4, All-on-6, All-on-X, Other), owner's question 2. Rows:
  - Cases (with at least one placed implant in the filtered set).
  - Reached the final bridge — "k of n" (status *Completed*, the C2 rule: current final bridges cover every placed implant).
  - Median time from first implant to final bridge (completed cases only; months; also min–max).
  - Closed without completion — k of n.
  - Cases with a bridge problem — k of n; and total problems.
  - Cases that lost an implant — k of n; implants failed / placed.
  - Implants per case (median).
  - Implant survival inside the cases at 1 and 2 years (Kaplan–Meier, as on Results) — and a link to Results with Compare by *Full-arch case type* for the curves.
  Plus a short list of the cases behind each column (file no., arch, status, first placement, final bridge date) linking to the patient, so the owner can check the numbers.
- **Export** gains the new implant columns (implant type, angulation, tilt direction, anchorage, case code, case type) and a ninth table **full_arch_cases** (case code, patient study code, arch, case type, status, first placement, final bridge date, closed date, stage dates), all through the dictionary allowlist.
- The same six research filters (course, dates, delegate, brand, system …) apply to every new view.

## Non-goals
- No p-values for the case table in this release: case counts will be small for a long time; "k of n" plus the thin-data warning. (Implant-level comparisons keep their log-rank test.)
- No new data entry and no change to any patient screen.
- No statistics for components / screws (project B data) — not asked for; a later request if wanted.
- No change to how survival, failure or completion are defined.

## Anti-goals
- Hiding numbers when data is thin (owner rule: always show, with a warning). Right now there are only days of zygomatic and case data.
- Any change to existing comparisons' numbers or the existing export columns' meaning (researchers' earlier exports must stay comparable).
- Breaking the previous app version during the release window.

## Approaches (owner picked 2)
1. **New details in the existing comparisons only** (Compare by + Explore). Smallest; answers question 1; question 2 only at implant level, nothing about cases.
2. **Option 1 + a Full arch tab with case-level outcomes + a one-click Zygomatic vs tilted comparison + export columns. — chosen.** The only option that answers both questions; reuses the screens the owner knows.
3. **A separate full-arch statistics page only.** Self-contained, but zygomatic results would miss Explore's curves and bone-level analysis.

## Decisions
- **Owner:** compare zygomatic against tilted implants in All-on-4; compare All-on-4 vs All-on-6; readers are the owner.
- **Which cases count (my call):** a case is in the Full arch tab when at least one of its placed implants is in the filtered implant set (`implant_outcomes_detail` with the page's filters). Planned-only cases (no placed implant) are left out and counted in a note ("3 planned cases without a placed implant are not included").
- **Time to final bridge (my call):** from the case's first placement date to the latest `fitted_on` of the current final bridges that complete it. Months as elsewhere (`days / 30.4375`).
- **Implant in a closed case (my call):** counts under its case's type; a case whose final bridge was delivered counts as completed (with its months to the bridge) even if it was closed later, for example to start a redo, and only a case closed before that shows as *Closed without completion*. An implant moved to a newer case (C2 ruling: a new case takes implants from a closed one) counts under its current case only.
- **Zygomatic vs tilted (my call):** zygomatic implants from any case type (or none) — they are rarely in an "All-on-4" case; tilted only when the case is All-on-4.
- **Data shape (my call; plan revision):** new security-invoker readers next to the old ones, nothing changed or dropped: one implant-level reader `implant_rehab_vars(<research filters>)` returning `implant_type`, `angulation_deg`, `angulation_direction`, `anchorage`, `case_id`, `case_configuration` per implant, merged by implant into the Compare-by groups and Explore rows (as `implant_outcomes_groups` is today), and a case-level reader `analysis_full_arch_cases(<research filters>)` returning one row per case with its configuration, arch, status inputs, first placement, final-bridge date, closed date, stage dates, implants placed/failed and bridge problems. Same gates as today: Research view **and** Patients view, Statistics module on. Case status keeps being derived in TS from the C2 rule (`src/lib/full-arch/cases.ts`), so the chart and Statistics never disagree.
- **Clinic companies:** everything works the same (no course filter there); no teaching data is shown.
- **Saved analyses** keep working; old saved URLs stay valid (new factor keys are additive).

## Constraints
- Migration 0146+ only; backward-compatible (add, don't drop); readers `security invoker set search_path = ''`, explicit revoke/grant; `tests/db/module-guards.test.ts` must cover the new readers (Statistics module); PostgREST 1000-row cap → page with `fetchAll` as the export does.
- Export: every new column needs a dictionary entry (`src/lib/research/export/dictionary.ts`) and the reader-column fixture; no free text (entry point and trajectory are free text → not exported, not in Explore).
- Dates in Cairo; "k of n"; "—" when n = 0; under 30 implants (or cases) → thin-data warning, numbers still shown.

## Left to the builder
Exact layout of the Full arch tab table and case list, the order of new Compare-by options, Explore factor grouping (a "Full arch" group is suggested), whether the implant-level additions go in one or two `_v2` readers, test fixture shapes.

## Verification
DB tests (new readers: filters, Research + Patients view gates, company isolation, module guard, a case with a moved implant, planned-only cases excluded); unit tests (case summary maths incl. median time and closed cases, Zygomatic vs tilted grouping, new Explore factors, export dictionary/fixture); E2E (seed an All-on-4 case with tilted implants and a zygomatic implant, see both comparisons on Results and both columns on Full arch; export contains the new table); full suites; owner ships with `! cd web && ./scripts/ship.sh ship`.
