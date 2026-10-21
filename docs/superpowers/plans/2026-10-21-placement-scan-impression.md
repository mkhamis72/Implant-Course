# Placement stability + scan/impression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Placing an implant no longer asks for torque, ISQ or bone type. They are recorded in Surgical details instead.
- Each implant records whether a digital scan or conventional impression was taken, and when.
- The patient list can filter by digital scan, conventional impression, or not yet taken.

**Architecture:**
- Two additive migrations:
  - 0053 adds `save_implant_surgery_v2`, which writes `implant_surgery` plus the three `implant_sites` stability columns, and makes `correct_placement` stop writing those columns.
  - 0054 adds the `implant_sites.impression_*` columns, `record_impression` and wider `search_patients` filter values.
- The app moves the three fields from the Place and Corrections forms into the Surgical details form. It adds a Scan / impression control to the Implant tab and three patient-list filters.

**Tech Stack:** Next.js 15 server actions, React 19, Zod v4, Supabase plpgsql, Vitest (`tests/db`, jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-placement-scan-impression-design.md`

## Global Constraints
- Work from `web/`.
- Never edit an applied migration. 0053 and 0054 are new. Dry-run each in a rolled-back transaction before the first `npm run test:db` (CLAUDE.md Gotchas).
- Every new public definer function:
  - `security definer set search_path = ''`, with the first line `perform app_private.require_perm('patients', 'edit');`
  - `revoke execute … from public, anon; grant execute … to authenticated;`
- No defaulted parameters on new functions.
- Keep the signatures of `correct_placement` and `search_patients`. The old `save_implant_surgery` stays; dropping it is a later PR.
- Business errors use `app_private.fail('…')`.
- Dates are Cairo dates: use `public.cairo_today()` in SQL and `todayIso()` in TS.
- Filter values: `digital_scan`, `conventional`, `impression_pending`.
- Labels:
  - Types: "Digital scan", "Conventional impression", "Not taken".
  - Filters: "Digital scan", "Conventional impression", "Scan / impression not yet taken".
- "Not yet taken" means the implant's current stage is `cover_screw` or `healing_abutment` (via `implant_stage`) and `impression_type is null`. Planned, failed, removed and restored implants never match.
- Styling: use the named tokens and shared classes only. Each `<select>` is remounted with `key` on each result (React 19 reset).

## Review Focus
1. **Clearing values.** Blanking torque, ISQ or bone type in Surgical details sets them to null; it doesn't keep the old value. (Task 1 DB test, Task 3 schema test.)
2. **Optimistic saves when the row doesn't exist yet.** The first Surgical details save on an implant that has torque from an older placement still works with `expectedUpdatedAt` null. (Task 1.)
3. **Scan date.**
   - Choosing "Not taken" with a date left in the field clears both columns and doesn't error. (Task 2 SQL coalesces; Task 4 schema drops the date when the type is blank.)
   - A date before placement or in the future is refused. (Task 2.)
4. **Failed implants.** A failed implant with no impression doesn't show under "not yet taken". (Task 2 search test.)
5. **Recording a scan from a stale page.** Recording a scan after someone else saved a visit is not blocked. `record_impression` uses its own `p_expected_updated_at` against `implant_sites.updated_at`, so a stale page gets "changed by someone else". The UI shows that message verbatim through `userMessage`. (Task 2 stale test.)

---

### Task 1: Migration 0053 — `save_implant_surgery_v2`, `correct_placement` stops writing stability

**Files:**
- Create: `supabase/migrations/0053_surgery_stability.sql`
- Test: `tests/db/surgery-stability.test.ts`

**Interfaces:**
- Produces:
  ```
  public.save_implant_surgery_v2(p_site uuid, p_extraction_date date, p_placement_timing text,
    p_soft_tissue_phenotype text, p_keratinized_mucosa_mm numeric, p_flap text, p_torque_type text,
    p_healing text, p_primary_closure text, p_grafting_performed text,
    p_torque numeric, p_isq numeric, p_bone_type text,
    p_expected_updated_at timestamptz) returns void
  ```
- Behaviour:
  - Same checks and upsert as `save_implant_surgery` (`0044_implant_surgery.sql:71-112`). Reuse `app_private.lock_placed_site`.
  - Then: torque 0–150 (`'Insertion torque must be between 0 and 150 Ncm.'`), ISQ 0–100 (`'ISQ must be between 0 and 100.'`), bone type in D1–D4 (`'Choose a bone type from D1 to D4.'`). Copy the exact wording from `place_implant_v2` in 0035:47-55 if it differs.
  - `update public.implant_sites set torque_ncm = p_torque, isq = p_isq, bone_type = p_bone_type where id = p_site`.
- `correct_placement`: `create or replace` of the 0049:36-111 body with the same signature, minus the `torque_ncm/isq/bone_type` assignments and their checks. Add the comment: `-- p_torque, p_isq and p_bone_type are ignored since 0053: they are recorded in Surgical details.`

- [ ] **Step 1: Write the failing DB tests** in `tests/db/surgery-stability.test.ts`. Use the `research-capture.test.ts` setup (`makeProduct`, `receive`, `makeDelegate`, `makePatient`, `place`, the `refused` helper). Name patients `Zz Stability …`. Call through a helper `save(c, site, overrides)` with all fields null by default.
  - `saves torque, ISQ and bone type on the implant`: after the save, `select torque_ncm::float, isq::float, bone_type from implant_sites` gives `{35, 72, 'D2'}`.
  - `clears them when saved blank`: a second save with nulls and `expected = updated_at` gives `{null, null, null}`.
  - `first save works when the placement already had torque`: place with `p_torque 40`, then save v2 with expected null → OK.
  - `refuses out-of-range values`: torque 151 → `/torque/i`; ISQ 101 → `/ISQ/`; bone `'D5'` → `/bone type/i`.
  - `refuses a stale save`: two saves with the same old `updated_at` → `/changed by someone else/`.
  - `needs Edit on Patients`: `setPerms(c, users.organizer, { patients: 'view' })` → `/permission/i` (match the wording used in `permissions.test.ts`).
  - `correct_placement leaves stability alone`: place with torque 40, ISQ 70, D3, then `correct_placement(... p_torque => null, p_isq => null, p_bone_type => null ...)` → still `{40, 70, 'D3'}`.
- [ ] **Step 2: Run** `npm run test:db -- surgery-stability`. Expected: FAIL (`function public.save_implant_surgery_v2 … does not exist`). Check first that `npm run db:start` is up and that this run doesn't apply a half-written 0053.
- [ ] **Step 3: Write 0053** as described in Interfaces. Dry-run it in a rolled-back transaction: a scratchpad `.ts` script using `pgConfig()`, run with `NODE_PATH=web/node_modules`.
- [ ] **Step 4: Run** `npm run test:db -- surgery-stability permissions corrections research-capture`. Expected: PASS. `permissions.test.ts` checks the `require_perm` header.
- [ ] **Step 5: Commit** `feat(db): save_implant_surgery_v2 records torque, ISQ and bone type (0053)`

### Task 2: Migration 0054 — impression columns, `record_impression`, patient filter values

**Files:**
- Create: `supabase/migrations/0054_implant_impression.sql`
- Test: `tests/db/impression.test.ts`

**Interfaces:**
- Produces:
  - Columns:
    - `implant_sites.impression_type text check (impression_type in ('digital_scan','conventional'))`
    - `implant_sites.impression_taken_on date`
    - `constraint implant_sites_impression_date check (impression_taken_on is null or impression_type is not null)`
  - Check the column-level grants on `implant_sites` (`grep -n "implant_sites" supabase/migrations/*.sql | grep grant`). Don't grant UPDATE on the new columns. Make sure SELECT covers them: grant select on the two columns if select is column-level.
  - `public.record_impression(p_site uuid, p_type text, p_taken_on date, p_expected_updated_at timestamptz) returns void`:
    - Lock the site `for update`. Missing, planned or removed → `'A scan or impression can only be recorded for a placed implant.'`
    - `updated_at <> p_expected_updated_at` → `'This implant was changed by someone else. Reload to see it.'`
    - Type not null:
      - A future date → `'The scan / impression date can''t be in the future.'`
      - Date before `placed_on` → `format('The scan / impression date can''t be before the placement date (%s).', placed_on)`.
      - Otherwise set both columns.
    - Type null: set both to null, ignoring `p_taken_on`.
  - `search_patients`: `create or replace` of the 0041 body with the same signature. Add one more `or exists (...)` over `implant_sites s` (left join current `site_components c` as in 0041) where either of these holds:
    - `s.impression_type = any(stages)`
    - `'impression_pending' = any(stages) and s.impression_type is null and public.implant_stage(s.state, c.component_type) in ('cover_screw','healing_abutment')`
  - Update the header comment.

- [ ] **Step 1: Write the failing DB tests** in `tests/db/impression.test.ts`. Use the `stage-filter.test.ts` `setup` / `search` helpers (copy them locally) and names `Zz Impression …`. Read `updated_at` before each call.
  - `records a digital scan with its date`: the columns read back as `('digital_scan', <placed_on>)`.
  - `clears both when the type is null, even with a date`: gives `(null, null)`.
  - `refuses a date before placement` → `/before the placement date/`. `refuses a future date` → `/future/`. `refuses a planned implant` → `/placed implant/`. `refuses a stale updated_at` → `/changed by someone else/`.
  - `needs Edit on Patients` → permission error.
  - `filters`:
    - Patient A has two implants with cover screws, one scanned digitally. `search(c, 'Zz Impression', ['digital_scan'])` and `['impression_pending']` both include A.
    - Patient B has a conventional impression only. It appears under `['conventional']` and not under `['digital_scan']`.
    - Patient C has one failed implant without an impression (`legacyFailure` or `record_failure`, as in `failure.test.ts`). It does not appear under `['impression_pending']`.
    - Patient D has a restored implant without an impression. It does not appear under `['impression_pending']`.
- [ ] **Step 2: Run** `npm run test:db -- impression`. Expected: FAIL (`column "impression_type" does not exist`).
- [ ] **Step 3: Write 0054** and dry-run it in a rolled-back transaction.
- [ ] **Step 4: Run** `npm run test:db -- impression stage-filter permissions audit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): record a scan or impression per implant and filter patients by it (0054)`

### Task 3: App — torque/ISQ/bone type move to Surgical details

**Files:**
- Modify: `src/lib/implants/surgery.ts`, `src/lib/implants/surgery.test.ts`
- Modify: `src/app/(app)/patients/[id]/surgical-details.tsx`, `surgical-details.test.tsx`
- Modify: `src/app/(app)/patients/[id]/surgery-actions.ts`, `surgery-actions.test.ts`
- Modify: `src/app/(app)/patients/[id]/implant-forms.tsx`, `implant-forms.test.tsx`
- Modify: `src/app/(app)/patients/[id]/implant-actions.ts`
- Modify: `src/app/(app)/patients/[id]/corrections.tsx`, `corrections.test.tsx`
- Modify: `src/lib/inventory/schemas.ts`
- Modify: callers of `surgeryCompleteness` (`grep -rn surgeryCompleteness src`), e.g. `src/lib/patients/implant-tabs.ts`

**Interfaces:**
- Consumes: `save_implant_surgery_v2` (Task 1).
- Produces:
  - `surgerySchema` gains `torque` (`optionalNumber(0, 150, …)`), `isq` (`optionalNumber(0, 100, …)`) and `boneType` (the `BONE_TYPES` enum, blank → null). Move the field definitions out of `placeSchema` so the messages stay the same.
  - `type Stability = { torque_ncm: number | null; isq: number | null; bone_type: string | null }`
  - `surgeryCompleteness(s: ImplantSurgery | null, stability: Stability): { recorded: number; total: number }`, with `SURGERY_TOTAL === 12`.
  - `SURGERY_FIELD_LABELS` gains `torque_ncm: 'insertion torque', isq: 'ISQ', bone_type: 'bone type'`, read from `stability`.
  - `TorqueField` moves from `implant-forms.tsx` into `surgical-details.tsx` (or a small `torque-field.tsx` beside it if `implant-forms.tsx` keeps nothing else that uses it). Same label: "Insertion torque (Ncm, optional)".

- [ ] **Step 1: Write the failing tests**
  - `surgery.test.ts`:
    - `surgeryCompleteness(null, {torque_ncm: 35, isq: null, bone_type: 'D2'})` → `{recorded: 2, total: 12}`.
    - `surgerySchema` parses `torque: ''` to null and `torque: '35'` to 35, and rejects `'151'` and `boneType: 'D5'`.
  - `surgical-details.test.tsx`:
    - The form shows "Insertion torque (Ncm, optional)", "ISQ (optional)" and "Bone type", seeded from the site's `torque_ncm` / `isq` / `bone_type`.
    - Clicking the 35 quick button and saving calls the mocked `saveSurgery` with `torque: '35'`.
  - `surgery-actions.test.ts`: `saveSurgery` calls `rpc('save_implant_surgery_v2', expect.objectContaining({ p_torque: 35, p_isq: 72, p_bone_type: 'D2' }))`.
  - `implant-forms.test.tsx`: the Place form has no "Insertion torque", "ISQ" or "Bone type" field. Replace the old assertions that filled them.
  - `corrections.test.tsx`: the placement correction form has none of the three fields.
- [ ] **Step 2: Run** `npm test -- surgery surgical-details implant-forms corrections`. Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement.**
  - The Stability group goes first in `SurgeryForm`, in this order: torque (with quick buttons), "Torque measured as", ISQ, bone type.
  - `placeImplant` and `correctPlacement` send `p_torque: null, p_isq: null, p_bone_type: null`.
  - `placeSchema` and `correctPlacementSchema` drop the three fields.
  - Pass the site to `surgeryCompleteness` at each caller.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` and `npm run lint`. Expected: all green.
- [ ] **Step 5: Commit** `feat(ui): torque, ISQ and bone type move from placement to surgical details`

### Task 4: App — Scan / impression on the Implant tab

**Files:**
- Create: `src/lib/implants/impression.ts`, `src/lib/implants/impression.test.ts`
- Create: `src/app/(app)/patients/[id]/impression-control.tsx`, `impression-control.test.tsx`
- Modify: `src/app/(app)/patients/[id]/implant-actions.ts` (add `recordImpression`)
- Modify: `src/app/(app)/patients/[id]/site-details.tsx` (`ImplantFacts`, :97)
- Modify: the `ImplantSite` type and `chart-data.ts` select, if they don't use `*` (add `impression_type`, `impression_taken_on`)

**Interfaces:**
- Consumes: `record_impression` (Task 2).
- Produces (`impression.ts`):
  - `IMPRESSION_TYPES = ['digital_scan', 'conventional'] as const`, `type ImpressionType`
  - `IMPRESSION_LABELS: Record<ImpressionType, string>`, `NOT_TAKEN_LABEL = 'Not taken'`
  - `impressionSchema = z.object({ siteId, patientId, expectedUpdatedAt: string, type: ImpressionType | null (blank → null), takenOn: optional date string | null })`. A refine drops `takenOn` (→ null) when `type` is null.
  - `impressionSummary(site: { impression_type: ImpressionType | null; impression_taken_on: string | null }): string`. It returns `'Not taken'`, `'Digital scan'` or `'Digital scan · 3 Nov 2026'`, using `formatDate`.
- Action: `recordImpression(prev, formData)`, following the existing actions in `implant-actions.ts`:
  - `requirePermission('patients', 'edit')`
  - `rpc('record_impression', { p_site, p_type, p_taken_on, p_expected_updated_at })` through the shared `run()` helper (it revalidates the patient).
- UI (`ImpressionControl({ site, patientId, editable })`):
  - Shows `impressionSummary(site)` as a badge (`badge-ok` when taken, plain `badge` otherwise) under the label "Scan / impression".
  - When `editable` (the same rule as `TechniqueControl`'s `editable` in `ImplantFacts`), show:
    - a `select` (Not taken / Digital scan / Conventional impression)
    - a date input (`max={todayIso()}`) that defaults to `todayIso()` once a type is chosen and is hidden while "Not taken"
    - a hidden `expectedUpdatedAt = site.updated_at`
    - a Save button
  - Errors show through the form-state alert, like the other forms.
  - Hidden for planned and removed sites.

- [ ] **Step 1: Write the failing tests**
  - `impression.test.ts`:
    - `impressionSummary` gives these three outputs.
    - The schema maps `type: ''` to null with `takenOn` null even when a date was sent, and rejects `type: 'photo'`.
  - `impression-control.test.tsx` (mock `./implant-actions`):
    - Viewers see the badge but no select.
    - An editor picks "Digital scan", the date shows today, and Save calls `recordImpression` with `type=digital_scan` and `takenOn=<today>`.
- [ ] **Step 2: Run** `npm test -- impression`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the lib, the action, and the control, and render `ImpressionControl` in `ImplantFacts` after the technique row.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): record a scan or impression on each implant`

### Task 5: Patient list filters

**Files:**
- Modify: `src/lib/patients/stages.ts` and its test
- Modify: `src/app/(app)/patients/page.tsx`, only if the checkbox list or the Teeth column needs a change (the Teeth column must ignore the new values)

**Interfaces:**
- Consumes: the `search_patients` values (Task 2).
- Produces: `PATIENT_FILTERS` gains `'digital_scan', 'conventional', 'impression_pending'` with the Global Constraints labels. `parseStages` accepts them.

- [ ] **Step 1: Write the failing test** in `stages.test.ts`: `parseStages(['digital_scan','impression_pending','bogus'])` → `['digital_scan','impression_pending']`, and each new value has its label.
- [ ] **Step 2: Run** `npm test -- stages`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check `teethByPatient` and the Teeth column so a scan filter doesn't highlight teeth wrongly. If the page highlights teeth whose stage is in the filter, the new values match no stage, which is fine.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): filter patients by scan / impression`

### Task 6: E2E, docs

**Files:**
- Modify: `tests/e2e/implants.spec.ts` (:41 fills torque on the Place form)
- Create or modify: an E2E test in `tests/e2e/implants.spec.ts`
- Modify: `CLAUDE.md` (the Placement and course reports bullet and the Research capture bullet; add a Scan/impression bullet)
- Check: `docs/operations.md` §D needs no TRUNCATE change (0053 and 0054 seed no rows). Say so in the commit message.

- [ ] **Step 1: Update the existing spec.**
  - Remove the torque fill at :41.
  - After placement, the Surgical details tab is open. Fill "Insertion torque (Ncm, optional)" with 35 and pick bone type D2, then save. Wait for the server state: reload and see "35 Ncm" on the Implant tab.
- [ ] **Step 2: Add** `test('records a digital scan and finds the patient by it')`:
  - Place an implant (seed helpers and `chooseImplant` as in the spec).
  - On the Implant tab, choose "Digital scan" and save.
  - Go to `/patients?stage=digital_scan&q=<name>` and expect the patient row.
  - Go to `/patients?stage=impression_pending&q=<name>` and expect no row.
- [ ] **Step 3: Run** `npx playwright test implants course-report`. Expected: PASS. `course-report.spec.ts` seeds through the RPC with `p_torque`, which still works.
- [ ] **Step 4: Update CLAUDE.md:**
  - Placement: the Place form no longer captures torque, ISQ or bone type. `save_implant_surgery_v2` writes them (0053), and `correct_placement` ignores them.
  - New bullet: scan/impression (0054). `implant_sites.impression_type` / `impression_taken_on` are written only through `record_impression`; the filter values are `digital_scan` / `conventional` / `impression_pending`. Follow-up: drop `save_implant_surgery` after this release has deployed.
- [ ] **Step 5: Verify** with `./scripts/ship.sh verify implants course-report`. Expected: every stage passes.
- [ ] **Step 6: Commit** `test(e2e): stability in surgical details and scan filter; docs`
