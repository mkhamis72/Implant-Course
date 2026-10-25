# Explore Clinical Data: recession capture and faster readers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record facial/mesial/distal recession at follow-up visits, put it in the research export, and make the outcome readers fast enough to build the Explore tab on (PRs 1, 1b and 2 of the spec).

**Architecture:** Recession is three new nullable numeric columns on `implant_followups`, written only through `record_visit` (findings jsonb, so the signature doesn't change) and validated in SQL and Zod. The export columns ship one release later, because the previous build's `assertAllowlisted` throws on unknown columns. Reader speed is a measured fix (indexes or a set-based rewrite) that keeps output identical.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 / React 19, Zod v4, Vitest (unit, component, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-explore-clinical-data-design.md`

## Global Constraints

- Recession columns: `recession_facial_mm`, `recession_mesial_mm`, `recession_distal_mm`, `numeric(3, 1)`, `check (… between 0 and 15)`, nullable. Null = not measured.
- Error copy, in SQL and Zod: `Enter recession from 0 to 15 mm.`
- The findings keys are the column names (as for probing).
- Never edit an applied migration. `create or replace` from the **latest** definition: `record_visit` is in `0049_failure_fixes.sql:115`.
- Migrations are backward-compatible: the previous app version runs against the new schema for a few minutes.
- Work from `web/`. Branch: `feat/explore-clinical-data` (spec already committed). Each PR ends with `./scripts/ship.sh verify <specs>`; the owner ships (`! cd web && ./scripts/ship.sh ship`, after making the repo public).
- Write the failing DB test before the migration file, and dry-run each migration in a rolled-back transaction before the first `test:db` (root CLAUDE.md → Gotchas).
- No Prettier. CRLF files: use Edit/Write for multi-line changes.

## Review Focus

1. **A visit typed as attended, then switched to "did not attend".** The recession values must be dropped (the Zod transform nulls them), not saved. Test in Task 2.
2. **A decimal comma or blank input (`"1,5"`, `" "`).** Blank = not measured. A non-number shows the copy above and never reaches SQL. Test in Task 2.
3. **Recession sent with no probing.** It saves on its own; BOP is not inferred from recession. Test in Task 2.
4. **Old app build during the release window.** It never sends recession keys, and its export must not break. That is why the export columns go in PR 1b. Covered by the PR split, checked in Task 4.
5. **"All courses" with no filter after the speed fix.** It must return the same rows and values as before. Equivalence check in Task 5.

---

## PR 1: Recession capture

### Task 1: Migration 0076 — columns and `record_visit`

**Files:**
- Create: `web/supabase/migrations/0076_recession.sql`
- Test: `web/tests/db/visits.test.ts` (extend `record_visit` describe and the `row` helper)

**Interfaces:**
- Produces: columns `implant_followups.recession_facial_mm | recession_mesial_mm | recession_distal_mm` (numeric, null). `record_visit` accepts the three findings keys with the same names.

- [ ] **Step 1: Write the failing tests** in the `record_visit` describe of `tests/db/visits.test.ts`. Add `recession_facial_mm::float as rf, recession_mesial_mm::float as rm, recession_distal_mm::float as rd` to the `row` helper's select.

```ts
it('records recession at three sites; empty means not measured', async () => {
  await withTx(async (c) => {
    const { site } = await placedSite(c);
    const id = await recordVisit(c, site, { findings: { recession_facial_mm: 1.5, recession_mesial_mm: 0 } });
    expect(await row(c, id)).toMatchObject({ rf: 1.5, rm: 0, rd: null });
  });
});
```

In `refuses out-of-range, malformed and unknown findings` add:

```ts
await refused(c, () => bad({ recession_facial_mm: 16 }), /Enter recession from 0 to 15 mm/);
await refused(c, () => bad({ recession_distal_mm: -1 }), /Enter recession from 0 to 15 mm/);
await refused(c, () => bad({ recession_mesial_mm: 'some' }), /Enter recession from 0 to 15 mm/);
```

In `refuses bad dates, … findings when not attended` add: a `did_not_attend` visit with `{ recession_facial_mm: 1 }` is refused with the same message that test already expects for findings on a non-attended visit.

- [ ] **Step 2: Dry-run the migration, then run the tests and see them fail**

Write the migration (Step 3) and dry-run it first with a scratchpad `tsx` script (`pgConfig()`, `begin` … `rollback`).
Run: `npm run test:db -- visits`
Expected, before the migration exists: FAIL with `column "recession_facial_mm" does not exist` / `Unknown finding: recession_facial_mm`.

- [ ] **Step 3: Write `0076_recession.sql`**
  - `alter table public.implant_followups add column` × 3, with the checks from Global Constraints.
  - `create or replace function public.record_visit(...)`: copy the whole body from `0049_failure_fixes.sql:115`, and only:
    - append the three keys to `c_keys`;
    - add `c_recession constant text := 'Enter recession from 0 to 15 mm.';`;
    - add the three columns to the insert with `app_private.finding_number(v_f, '<key>', 0, 15, false, c_recession)`.
  - Keep the signature, so the grants stay.
  - The audit trigger already covers the table, so add nothing else. No restore-TRUNCATE change (nothing seeded).

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm run test:db -- visits permissions`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(visits): recession columns and record_visit findings (0076)`

### Task 2: Visit rules in TS (schema, findings, summary)

**Files:**
- Modify: `web/src/lib/visits/visits.ts` (`VisitFindings`, `visitSchema`, transform, `toFindings`, `summarizeFindings`, a new `RECESSION_SITES`)
- Test: `web/src/lib/visits/visits.test.ts`

**Interfaces:**
- Consumes: Task 1 columns and keys.
- Produces:
  - `RECESSION_SITES = [{ key: 'facial', short: 'F', label: 'facial', column: 'recession_facial_mm', field: 'recessionFacial' }, { key: 'mesial', short: 'M', label: 'mesial', column: 'recession_mesial_mm', field: 'recessionMesial' }, { key: 'distal', short: 'D', label: 'distal', column: 'recession_distal_mm', field: 'recessionDistal' }] as const`.
  - `VisitFindings` gains `recession_facial_mm | recession_mesial_mm | recession_distal_mm: number | null`.
  - `visitSchema` fields `recessionFacial | recessionMesial | recessionDistal` (number 0–15 or null).
  - The summary segment is `Rec F 1.5 · M 0 mm` and comes right after the PD segment.

- [ ] **Step 1: Write the failing tests** in `visits.test.ts`:
  - `visitSchema` parses `recessionFacial: '1.5', recessionMesial: '', recessionDistal: '0'` to `1.5, null, 0`.
  - `'16'`, `'-1'` and `'1,5'` fail on path `recessionFacial` with message `Enter recession from 0 to 15 mm.`.
  - `attendance: 'did_not_attend'` with `recessionFacial: '2'` parses to `recessionFacial: null`.
  - Recession with no probing leaves every `bop*` field `null`.
  - `toFindings` includes `recession_facial_mm: 1.5` and omits the null keys.
  - `summarizeFindings` on a fixture with probing `M 3` and recession facial 1.5 / mesial 0 contains `PD M 3 mm · Rec F 1.5 · M 0 mm`.
  - Update the existing `VisitFindings` fixtures with the three null keys.

- [ ] **Step 2: Run and see them fail** — `npm test -- visits.test` → FAIL (unknown keys / missing segment).

- [ ] **Step 3: Implement.** Reuse the `number(message, predicate)` helper, with a `RECESSION` constant equal to the copy. In the non-attended branch of the transform, set the three fields to `null`. Map them in `toFindings`. Build the `Rec …` segment from `RECESSION_SITES` the same way the `depths` segment is built.

- [ ] **Step 4: Run and see them pass** — `npm test -- visits` → PASS. Also run `npx tsc --noEmit`: every `VisitFindings` literal and the `visits.test.tsx` fixture (line 26) must get the keys.

- [ ] **Step 5: Commit** — `feat(visits): recession in the visit rules and summary`

### Task 3: Visit form and data loading

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/visits.tsx` (initial values near line 60; a fieldset after the probing fieldset, about line 154)
- Modify: `web/src/app/(app)/patients/[id]/chart-data.ts:29` (select the three columns)
- Test: `web/src/app/(app)/patients/[id]/visits.test.tsx`, `web/tests/e2e/visits.spec.ts`

**Interfaces:**
- Consumes: `RECESSION_SITES`, schema fields from Task 2.

- [ ] **Step 1: Write the failing tests**
  - Component, in the test `pre-picks the due visit … records an attended visit with probing and bleeding`: fill `getByLabelText('Recession facial')` with `1.5`, and expect the mocked action to receive `recessionFacial: '1.5', recessionMesial: '', recessionDistal: ''`.
  - E2E, `visits.spec.ts`, in the existing attended-visit test: fill `Recession facial` = `2`, `Recession distal` = `1`, save, then expect the visit row to show the text `Rec F 2 · D 1 mm`.

- [ ] **Step 2: Run and see them fail** — `npm test -- visits.test.tsx` → FAIL (label not found).

- [ ] **Step 3: Implement.**
  - A `<fieldset>` with legend `Recession (mm)` and a `grid grid-cols-3 gap-2` of inputs (`className="input text-center"`, `inputMode="decimal"`, `aria-label={`Recession ${s.label}`}`, short label shown `aria-hidden`), mapped from `RECESSION_SITES`. It follows the probing fieldset's markup; the form is controlled through `v` / `set`.
  - Initial values `''`.
  - Add the columns to the `chart-data.ts` select.

- [ ] **Step 4: Run and see them pass** — `npm test -- visits.test.tsx`, then `npx playwright test visits` → PASS.

- [ ] **Step 5: Update docs** — in `web/src/app/(app)/patients/CLAUDE.md` → Follow-up visits, add "recession (facial/mesial/distal, mm, 0076)" to the findings list.

- [ ] **Step 6: Commit** — `feat(visits): recession fields on the visit form`

- [ ] **Step 7: Verify PR 1** — `./scripts/ship.sh verify visits` → all green. Hand over to the owner to ship. Wait for the Release to finish and go live (1–3 min) before starting PR 1b.

## PR 1b: Recession in the research export (after PR 1 is live)

### Task 4: Export reader and dictionary

**Files:**
- Create: `web/supabase/migrations/0077_export_recession.sql` (renumber if another migration landed first; later plans then shift by one)
- Modify: `web/src/lib/research/export/dictionary.ts` (`visits` entries), `web/src/lib/research/export/reader-columns.fixture.ts`
- Test: the research export DB test (find it with `grep -l research_export_visits tests/db`), `web/src/lib/research/export/dictionary` tests

**Interfaces:**
- Produces: `research_export_visits(...)` returns `recession_facial_mm, recession_mesial_mm, recession_distal_mm` after `probing_lingual`.

- [ ] **Step 1: Confirm why this is its own PR.** `assertAllowlisted` (`dictionary.ts:259`) throws on any column missing from `DICTIONARY`, so the previous build would fail every export during the release window. Note this in the PR body.
- [ ] **Step 2: Write the failing tests**
  - The DB test expects the three columns in `research_export_visits` output, with values for a visit recorded with recession.
  - `reader-columns.fixture.ts` lists them.
  - Each `DICTIONARY.visits` entry has unit `mm` and the description "Recession at the <site> site (mm); empty = not measured".
- [ ] **Step 3: Run and see them fail** — `npm run test:db -- export` → FAIL.
- [ ] **Step 4: Write the migration.** `drop function public.research_export_visits(uuid, date, date, uuid, text, text)` and recreate it from its latest definition (`0070_research_export.sql:241`; check later migrations first) with the three columns, then re-apply its revoke/grant. Add the dictionary entries. `analysis.R` is unchanged (it doesn't read them).
- [ ] **Step 5: Run and see them pass** — `npm run test:db -- export` and `npm test -- export analysis` → PASS (`analysis.test.ts` must still pass).
- [ ] **Step 6: Commit and verify** — `feat(statistics): recession in the research export`, then `./scripts/ship.sh verify research-export`. The owner ships.

## PR 2: Faster outcome readers

### Task 5: Measure, fix and prove equivalence

**Files:**
- Create: `web/supabase/migrations/0078_outcomes_speed.sql` (number after 1b)
- Scratchpad only (not committed): `bench-readers.ts`, `equivalence.ts`
- Modify: `web/src/app/(app)/statistics/CLAUDE.md` and the root `CLAUDE.md` Gotchas line on slow unfiltered readers, `web/tests/e2e/*` only if a brand filter was there purely for speed (leave the filters in place; they also isolate data)

**Interfaces:**
- Produces: `implant_outcomes`, `implant_outcomes_detail`, `crown_outcomes_detail` and `implant_outcomes_groups` with unchanged signatures and identical output, faster.

- [ ] **Step 1: Baseline.** The scratchpad script `bench-readers.ts` runs as the test organizer (`set local role authenticated` + JWT claims, as `actAs` does), with no filters, five runs each: `select count(*) from public.implant_outcomes_detail(null,null,null,null,null,null)` and the same for `crown_outcomes_detail` and `implant_outcomes_groups`. It prints the median ms. Record the numbers in the PR body (expect about 7,500 ms).
- [ ] **Step 2: Find the cause.** Run `explain (analyze, buffers)` on the same calls, and on `visit_grades(<all patient ids>)` and `implant_outcomes(null,null,null)` directly. To see inside plpgsql/SQL functions, `set local auto_explain.log_nested_statements = on` or inline the function bodies. Write the cause in one line in the PR body (for example: "`visit_grades` seq-scans `radiograph_bone_levels` per visit" or "`implant_outcomes_detail` runs `implant_outcomes` once per joined row").
- [ ] **Step 3: Write the equivalence check** (`equivalence.ts`, scratchpad):
  - In one transaction, `create temp table before_x as select * from <reader>(nulls…)` for the four readers.
  - Run the migration file's SQL.
  - Compare each against the new output with `except` both ways. Print the row counts and "identical" or the first diff. Then `rollback`.
- [ ] **Step 4: Write the migration.** Use the smallest change that fixes the measured cause: an index first (for example `radiograph_bone_levels (site_id, radiograph_id)`, `implant_sites (course_id)`); a set-based `create or replace` of the offending function (from its latest definition, signature unchanged) only if indexes aren't enough. Run `equivalence.ts` → "identical" for all four, and `bench-readers.ts` → `implant_outcomes_detail` median **< 1,500 ms**.
- [ ] **Step 5: Run the existing tests** — `npm run test:db -- outcomes research export permissions` → PASS. These pin the readers' output.
- [ ] **Step 6: Update the docs.** Remove or adjust the "~7.5 s" notes in `statistics/CLAUDE.md` and root `CLAUDE.md` with the new measured figure.
- [ ] **Step 7: Commit and verify** — `perf(statistics): faster outcome readers (0078)`, then `./scripts/ship.sh verify statistics`. The owner ships, then checks `/statistics` → All courses on the live site 1–3 min after Release.

---

Later plans (written when this one is done): PR 3 analysis engine, PR 4 Explore UI, PR 5 saved analyses + print + exports, PR 6 course overview.
