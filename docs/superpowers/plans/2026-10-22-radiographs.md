# Radiographs and bone levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log each patient's X-rays (date, type, purpose, teeth shown, optional link, notes), with optional mesial/distal bone levels per implant, shown on a patient X-rays tab and on each implant's tabs.

**Architecture:** Migration 0064 adds `radiographs` and `radiograph_bone_levels`, written only through `save_radiograph` (add and edit, with the full measurement set) and `void_radiograph`. Rules live in SQL and are mirrored in `src/lib/radiographs/` for the form. The UI is a new patient section `patients/[id]/xrays` plus an implant tab.

**Tech Stack:** Next.js 15 server actions, React 19, Zod v4, Supabase plpgsql + RLS, Vitest (`tests/db`, jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-radiographs-design.md`

## Global Constraints

**Process**
- Work from `web/`.
- Migration 0064 is new. Dry-run it in a rolled-back transaction before the first `npm run test:db`. Never edit it once applied.

**Database conventions**
- Definer write functions:
  - `security definer set search_path = ''`, with the first line `perform app_private.require_perm('patients', 'edit');`
  - `revoke execute … from public, anon; grant execute … to authenticated;`
  - no defaulted parameters.
- Errors use `app_private.fail('…')`.
- Tables follow the 0057 pattern: revoke all, then grant select; RLS select `is_active_user()` plus restrictive `(select public.can('patients','view'))`; `audit_row` trigger; `updated_at` trigger.
- Extend `patient_history` and the `audit_log_area_read` policy, copying their LATEST bodies from 0058.

**Values and labels**
- Type: `periapical` / `cbct`, labelled "Periapical" / "CBCT".
- Purpose: `planning` / `baseline` / `loading` / `follow_up` / `other`, labelled "Planning" / "Baseline (after placement)" / "Loading / crown fit" / "Follow-up" / "Other".

**Rules**
- **Date:** Cairo date, today or earlier (`'The X-ray date can''t be in the future.'`). A date before placement is allowed.
- **Teeth:** at least 1 valid FDI tooth (11–18, 21–28, 31–38, 41–48), no duplicates, any jaw. Stored in FDI order.
- **Implant purposes:** `baseline` / `loading` / `follow_up` need at least one site on the teeth with state in (`placed`, `restored`, `failed`) and `placed_on <= date`. The message is `'A baseline, loading or follow-up X-ray needs an implant placed by its date on one of its teeth.'`
- **Bone level:** `numeric(3,1)`, range −5.0 to 15.0. Null means not measured. Positive means bone below the shoulder. Each row needs at least one of mesial or distal.
- **Which implants a measurement can be on:** the site must belong to the patient, have state placed / restored / failed, and have its tooth among the X-ray's teeth. Otherwise: `'A bone level can only be recorded for an implant on one of this X-ray''s teeth.'`
- **Link:** optional; must match `^https?://` and be at most 2000 characters (`'Enter a link starting with http:// or https://.'`). It is rendered with `target="_blank" rel="noopener noreferrer"`.
- **Notes:** at most 1000 characters.
- **Optimistic concurrency** on `radiographs.updated_at`: `'This X-ray was changed by someone else. Reload to see it.'`
- **Void:** a reason is required (`'Say why this X-ray is being removed from the record.'`). Voided rows are hidden everywhere.

## Review Focus
1. **Removing a measured tooth** (keeping a tooth's measurement row while unticking that tooth) is refused, with the "only for an implant on one of this X-ray's teeth" message. (Task 1 test.)
2. **A blank bone level stays null, never 0.** Saving a row with only mesial keeps distal null; the form sends blanks as null. (Task 1 and Task 2 tests.)
3. **A baseline dated before placement** is refused; the same X-ray as `planning` is allowed. (Task 1 test.)
4. **Editing replaces the measurement set.** Saving without a previous row deletes it; re-saving the same set leaves no duplicates. (Task 1 test.)
5. **A voided X-ray** disappears from both the patient tab and the implant tab, and History shows its removal. (Task 3 test.)

---

### Task 1: Migration 0064 — radiographs, bone levels, save and void

**Files:**
- Create: `supabase/migrations/0064_radiographs.sql`
- Test: `tests/db/radiographs.test.ts`

**Interfaces:**
- Produces, tables:
  - `public.radiographs`:
    - columns: `id uuid pk, patient_id uuid not null fk patients on delete cascade, taken_on date not null, type text not null, purpose text not null, teeth smallint[] not null, link text null, notes text not null default '', voided_at, voided_by, voided_reason, created_at, created_by, updated_at`;
    - checks for type, purpose, link and notes as in Global Constraints;
    - `cardinality(teeth) >= 1`.
  - `public.radiograph_bone_levels`:
    - columns: `radiograph_id uuid fk on delete cascade, site_id uuid fk implant_sites on delete cascade, mesial_mm numeric(3,1) null, distal_mm numeric(3,1) null`;
    - primary key `(radiograph_id, site_id)`;
    - checks: the range, and `mesial_mm is not null or distal_mm is not null`.
- Produces, functions:
  - `public.save_radiograph(p_id uuid, p_patient uuid, p_taken_on date, p_type text, p_purpose text, p_teeth smallint[], p_link text, p_notes text, p_levels jsonb, p_expected_updated_at timestamptz) returns uuid`
    - `p_id` null means create, and then `p_expected_updated_at` must be null.
    - `p_levels` is a JSON array of `{"site": uuid, "mesial_mm": number|null, "distal_mm": number|null}`. It replaces the whole set: delete the existing rows, then insert.
    - Lock order: the radiograph `for update`, then the sites.
    - Edits of a voided X-ray are refused.
  - `public.void_radiograph(p_id uuid, p_reason text) returns void`
  - `public.radiographs_for(p_patient uuid) returns table (id uuid, taken_on date, type text, purpose text, teeth smallint[], link text, notes text, updated_at timestamptz, levels jsonb)`
    - security invoker; non-voided only;
    - newest first (`taken_on desc, created_at desc`);
    - `levels` = `[{site, tooth, mesial_mm, distal_mm}]`.
- `patient_history` and `audit_log_area_read` (latest bodies from 0058) are extended to the two new tables. Bone-level rows reach History through `radiograph_id` → `patient_id`.

- [ ] **Step 1: Write the failing DB tests** in `tests/db/radiographs.test.ts`.
  - Setup: the fixtures `makePatient`, `makeProduct`, `receive`, `makeDelegate`, `place` (it takes `course`), and the savepoint `refused` helper. Use patients named `Zz Xray …`.
  - Tests:
    - `saves a planning CBCT with teeth only and no implant`
    - `saves a baseline periapical with bone levels for its implant`: reading it back gives `levels` = one row with tooth 36, `mesial_mm 0.5`, `distal_mm null`.
    - `refuses a baseline dated before the placement` → `/placed by its date/`. The same X-ray as `planning` saves.
    - `refuses a future date` → `/future/`
    - `refuses a measurement for an implant not on the X-ray's teeth` (Review Focus 1) → `/one of this X-ray/`
    - `refuses a bone level outside −5 to 15 and a row with both blank`
    - `refuses a link without http(s)`
    - `editing replaces the measurement set` (Review Focus 4): save with 2 rows, then save with 1, and exactly 1 remains.
    - `rejects a stale updated_at` (use a different timestamp, as in `surgery-stability.test.ts`)
    - `void hides it from radiographs_for and needs a reason`; editing a voided X-ray is refused.
    - `failed implants can be measured`
    - `deleting the patient deletes its X-rays` (call `delete_patient` on a patient without stock).
    - `needs Edit on Patients`, and `a viewer can read through radiographs_for`
  - `permissions.test.ts` stays green: add the new tables to any allow-list it requires, as 0057/0058 did.
- [ ] **Step 2: Run** `npm run test:db -- radiographs`. Expected: FAIL (`save_radiograph` doesn't exist).
- [ ] **Step 3: Write 0064** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- radiographs permissions audit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): radiographs with optional bone levels (0064)`

### Task 2: Radiograph lib + patient X-rays section

**Files:**
- Create: `src/lib/radiographs/radiographs.ts` (+ `.test.ts`)
- Create: `src/app/(app)/patients/[id]/xrays/page.tsx`, `xrays/radiograph-form.tsx` (+ `.test.tsx`), `xrays/actions.ts` (+ `.test.ts`)
- Modify: `src/app/(app)/patients/[id]/patient-tabs.tsx`: add `{ href: \`${base}/xrays\`, label: 'X-rays' }` between Implants and Overview.

**Interfaces:**
- Consumes: Task 1's `save_radiograph`, `void_radiograph` and `radiographs_for`.
- Produces (`radiographs.ts`):
  - `RADIOGRAPH_TYPES`, `RADIOGRAPH_PURPOSES`, and the label maps from Global Constraints.
  - `IMPLANT_PURPOSES = ['baseline','loading','follow_up']`.
  - `type Radiograph = { id; taken_on; type; purpose; teeth: number[]; link: string | null; notes; updated_at; levels: { site: string; tooth: number; mesial_mm: number | null; distal_mm: number | null }[] }`
  - `radiographSchema`: blank becomes null; teeth are parsed from repeated `tooth` fields.
  - `levels` are parsed from fields `mesial_<siteId>` / `distal_<siteId>`. A row with both blank is dropped. Numbers must be −5 to 15.
  - `boneLevelLabel(mm: number | null): string` → `'—'` for null, else e.g. `'0.5 mm'`.
- Actions (`xrays/actions.ts`):
  - `saveRadiograph` and `voidRadiograph`, using `requirePermission('patients','edit')` and the `run()` / `userMessage` pattern.
  - `revalidatePath` covers both the patient chart and `/xrays`.
- **Page** (`xrays/page.tsx`):
  - `requirePermission('patients')`.
  - Loads `radiographs_for` and the patient's sites (id, tooth, state, placed_on).
  - Lists X-rays newest first as cards: date, type, purpose, teeth, link ("Open image ↗"), notes, and a bone-level table (tooth / mesial / distal).
  - Editors get **Add X-ray**, plus **Edit** and **Remove** (with a reason) on each card.
- **Form** (`radiograph-form.tsx`):
  - Fields: date (default `todayIso()`), type, purpose, teeth (an FDI checkbox grid in `ARCH_ORDER` from `src/lib/restorations/restorations.ts`), link, notes.
  - Then a **Bone levels (optional)** block: one row per implant (placed / restored / failed) on the ticked teeth, with mesial and distal number inputs (step 0.1, min −5, max 15).
  - The hint reads: "Distance from the implant shoulder to the first bone contact. + = bone below the shoulder; leave blank if not measured."
  - Edits send `expectedUpdatedAt`. Use controlled state, as `restorations.tsx` does. A `prefillTeeth?: number[]` prop pre-ticks teeth.

- [ ] **Step 1: Write the failing tests.**
  - `radiographs.test.ts`:
    - the schema maps blanks to null;
    - a row with mesial `'0.5'` and distal `''` becomes `{mesial_mm: 0.5, distal_mm: null}`;
    - a row with both blank is dropped;
    - `'15.1'` is refused;
    - `boneLevelLabel(null)` → `'—'`.
  - `radiograph-form.test.tsx`:
    - ticking 36 (an implant) shows a bone-level row for 36; ticking 35 (no implant) shows none;
    - Save calls the mocked `saveRadiograph` with `teeth` and `mesial_<site>`;
    - `prefillTeeth` pre-ticks a tooth.
  - `actions.test.ts`: the RPC is `save_radiograph`, called with `p_levels` as an array, and with null for blank levels (Review Focus 2).
- [ ] **Step 2: Run** `npm test -- radiograph`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green, with no warnings.
- [ ] **Step 5: Commit** `feat(ui): patient X-rays with optional bone levels`

### Task 3: Implant X-rays tab + History labels

**Files:**
- Modify: `src/lib/patients/implant-tabs.ts` (+ test), `src/app/(app)/patients/[id]/implant-tabs.tsx`, `chart-data.ts`
- Create: `src/app/(app)/patients/[id]/implant-xrays.tsx` (+ `.test.tsx`)
- Modify: `src/lib/patients/history.ts` (+ test)

**Interfaces:**
- Consumes: Task 2's `Radiograph`, `boneLevelLabel`, `RadiographForm` and actions.
- Produces:
  - Implant tab key `xrays`, labelled "X-rays", placed after `visits`. Its badge is the count of non-voided X-rays showing this implant's tooth.
  - `ChartData.radiographs: Radiograph[]`, loaded through `radiographs_for`.
  - `ImplantXrays({ site, data })` lists X-rays whose `teeth` include `site.tooth`, newest first, with this implant's bone levels. Editors get "Add X-ray" (`RadiographForm` with `prefillTeeth={[site.tooth]}`).
  - History:
    - "X-ray added: <Type>, <Purpose> (teeth …)"
    - "X-ray updated: <fields>"
    - "X-ray removed from the record (<reason>)"
    - bone-level rows: "Bone level recorded on tooth N"

- [ ] **Step 1: Write the failing tests:**
  - the implant tab order includes `xrays` after `visits`;
  - `ImplantXrays` shows only the X-rays that include its tooth, and shows "0.5 mm" / "—";
  - the History labels;
  - Review Focus 5: a voided X-ray isn't in `ChartData.radiographs` (mock data without it), and History shows the removal label.
- [ ] **Step 2: Run** `npm test -- implant-tabs implant-xrays history`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): X-rays on each implant; history labels`

### Task 4: E2E + docs

**Files:**
- Create: `tests/e2e/radiographs.spec.ts`
- Modify: `docs/domain-rules.md` (if on master) or `CLAUDE.md`: add a **Radiographs (0064)** bullet. Write it where the feature-rule bullets live on the branch.

- [ ] **Step 1: Write the spec.** Place an implant on 36 through the API (`placeImplant` helper in `api.ts`). Then:
  - On `/patients/<id>/xrays`, add a Baseline periapical for 36 with mesial 0.5. After a reload the card shows "Baseline (after placement)" and "0.5 mm".
  - Open tooth 36 → X-rays tab: the same X-ray shows.
  - Remove it with a reason: it disappears from both places.
- [ ] **Step 2: Run** `npx playwright test radiographs implants-tab` (check :3000 and free memory first). Expected: PASS.
- [ ] **Step 3: Docs.** The bullet covers: the tables; `save_radiograph` replacing the measurement set; the rules (teeth, implant purposes, sign convention, null = not measured); the UI paths.
- [ ] **Step 4: Verify** with `./scripts/ship.sh verify radiographs implants-tab`. Expected: "Verified".
- [ ] **Step 5: Commit** `test(e2e): radiographs; docs`
