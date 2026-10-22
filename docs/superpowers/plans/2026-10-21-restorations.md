# Restorations (research part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Record temporary and final restorations (single crown, bridge, overdenture, full arch) once, each linked to all its implants and the teeth it covers.
- Record each restoration's problems, and show restorations on a new tooth-panel tab and as bars on the odontogram.
- Count restorations in course and delegate reports.
- Convert existing "final restoration" components into restorations.
- Add a required course picker to placement.

**Architecture:**
- **Database:** new tables `restorations`, `restoration_sites` and `restoration_problems`, written only through definer functions.
  - Restorations own the implant `restored` state.
  - New report functions sit beside the existing ones (additive).
  - Placement gets a new function version with `p_course`, and the old versions stay for the release window.
- **App:** a lib module `src/lib/restorations/` holds the rules, labels, schemas, loading and arch helpers. The tab, forms and odontogram layer build on it.

**Tech Stack:** Next.js 15 server actions, React 19, Zod v4, Supabase plpgsql + RLS, Vitest (`tests/db`, jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-restorations-design.md`

## Global Constraints

**Process and conventions**
- Work from `web/`.
- Migrations are 0057–0060. Never edit one once it is applied. Dry-run each new migration in a rolled-back transaction before its first `npm run test:db`.
- Every new public definer function:
  - `security definer set search_path = ''`, with the first line `perform app_private.require_perm('patients', 'edit');`
  - `revoke execute … from public, anon; grant execute … to authenticated;`
  - no defaulted parameters.
- Readers that should obey RLS are `security invoker`.
- New tables:
  - `revoke all … from public, anon, authenticated; grant select … to authenticated;`
  - RLS on: select policy `public.is_active_user()`, plus the restrictive `(select public.can('patients','view'))` policy (copy the `implant_complications` pattern in 0047).
  - `app_private.audit_row()` trigger.
  - an `updated_at` trigger where edits are optimistic.
  - add them to the audit-log read policies the way 0047 did for its tables.
- Business errors use `app_private.fail('…')`.
- Dates are Cairo dates: `public.cairo_today()` in SQL, `todayIso()` / `formatDate` in TS.
- Release window: migrations are additive. Keep `place_implant_v2`, `correct_placement`, `component_type 'final_restoration'` and `fit_component` working for the previous app version. A follow-up PR after deploy drops `place_implant_v2` and the old `correct_placement`.

**Values**
- Stage: `temporary`, `final`.
- Type: `single_crown`, `bridge`, `overdenture`, `full_arch`.
- Retention: `screw`, `cement`, `attachment`.
- Material: `zirconia`, `lithium_disilicate`, `metal_ceramic`, `pmma_acrylic`, `composite`, `metal_framework`, `other`.
- Problem type: `chipping`, `fracture`, `debonding`, `screw_loosening`, `screw_fracture`, `wear`, `other`.
- Problem action: `recemented`, `retightened`, `repaired`, `none`, `other`.
- End kind: `replaced` (a temporary ended by any restoration) or `remade` (a final ended by a final; the reason is required).

**Labels**
- Types: "Single crown", "Bridge", "Overdenture", "Full arch".
- Stages: "Temporary", "Final".
- Retention: "Screw-retained", "Cement-retained", "Attachment (removable)".
- Materials: "Zirconia", "Lithium disilicate", "Metal-ceramic", "PMMA / acrylic", "Composite", "Metal framework", "Other".
- Problems: "Chipping", "Fracture", "Debonding / loss of retention", "Screw loosening", "Screw fracture", "Wear", "Other".
- Actions: "Recemented", "Retightened", "Repaired / polished", "None", "Other".
- Loading: "Immediate", "Early", "Conventional".

**Rules**
- Implant count: a single crown has exactly 1 implant; a bridge, overdenture or full arch has at least 2.
- All implants are placed or restored, belong to the patient, and are in one jaw. Teeth 1x/2x are upper and 3x/4x lower.
- **Teeth covered** form one contiguous run in arch order and include every implant's tooth. A single crown covers exactly its own tooth.
  - Upper arch order: 18 17 16 15 14 13 12 11 21 22 23 24 25 26 27 28.
  - Lower arch order: 48 47 46 45 44 43 42 41 31 32 33 34 35 36 37 38.
- **Fitted date:** today or earlier, and not before any linked implant's `placed_on`.
- **Adding a restoration** ends every current restoration on any of its implants, completely.
  - A temporary is refused if any of those current restorations is a final: `'This implant has a final restoration. Record the repair as a problem on it instead of fitting a temporary.'`
  - Ending a final needs `p_remake_reason` (non-blank): `'Say why the final restoration was remade.'`
- **Restored state:** an implant is `restored` exactly when it has a current, non-voided final restoration. Only sites in `placed`/`restored` are switched. Tooth status follows via `app_private.set_tooth`: `'restored'`, otherwise `'implant_placed'`.
- **Loading** is derived in TS only, from `days = first restoration fitted_on − placed_on`:
  - ≤ 7 days → immediate;
  - fitted on or before `placed_on` + 2 calendar months → early;
  - otherwise conventional.
  - The cut-offs are constants, `LOADING_IMMEDIATE_DAYS = 7` and `LOADING_EARLY_MONTHS = 2`.
- **Course of a restoration:** `restorations.course_id` when set; otherwise the course whose dates contain `fitted_on` and in which its delegate is enrolled.
- **Crown types stop being offered on implants:** the new app no longer offers the complication types `screw_loosening`, `screw_fracture`, `restoration_fracture`, `loss_of_retention` and `prosthetic_remake` in the implant complication form. SQL still accepts them.

## Review Focus
1. **Partial overlap.** A crown is added on 36 under a current bridge 34–36. The bridge ends completely as remade, and 34 drops back to `placed` with no current restoration. (Task 1 test.)
2. **Undo after a replacement.** Undoing the newest restoration reopens exactly the restorations it ended and recomputes `restored` on every implant involved, including implants only the old one covered. Undoing a restoration that something newer ended is refused. (Task 1 test.)
3. **Failed implant under a bridge.** A bridge on 34+36 where 36 fails: the bridge stays current, 36 stays `failed` (it is never switched to `restored`), and 34 stays `restored`. Undoing 36's failure (`void_followup`) gives `restored`, because the bridge is current. (Task 2 test.)
4. **Converted data shows once.** After conversion, the converted crown appears once, as a restoration. The `final_restoration` component no longer shows in the component timeline or as an odontogram badge. An implant's restored state is unchanged by the migration. (Tasks 3 and 7 tests.)
5. **Old app during the release window.** The old Place form (`place_implant_v2` without a course) still works, and placements with no course still count in course reports by date and enrollment. (Task 4 test.)

---

### Task 1: Migration 0057 — restorations core

**Files:**
- Create: `supabase/migrations/0057_restorations.sql`
- Test: `tests/db/restorations.test.ts`

**Interfaces:**
- Produces, tables:
  - `public.restorations`:
    - columns: `id uuid pk, patient_id uuid not null fk patients, stage text, type text, teeth smallint[] not null, fitted_on date not null, retention text null, material text null, delegate_id uuid null fk delegates, supervisor_id uuid null fk supervisors, course_id uuid null fk courses, notes text not null default '', ended_on date null, end_kind text null, end_reason text null, ended_by uuid null fk restorations, voided_at, voided_by, voided_reason, created_at, created_by, updated_at`;
    - check constraints for each value list in Global Constraints;
    - `(ended_on is null) = (end_kind is null)`;
    - `end_kind = 'remade'` requires a non-blank `end_reason`.
  - `public.restoration_sites`: `(restoration_id uuid fk on delete cascade, site_id uuid fk implant_sites on delete cascade, primary key both)`.
- Produces, functions:
  - `public.add_restoration(p_patient uuid, p_stage text, p_type text, p_sites uuid[], p_teeth smallint[], p_fitted_on date, p_retention text, p_material text, p_delegate uuid, p_supervisor uuid, p_course uuid, p_remake_reason text, p_notes text) returns uuid`
  - `public.update_restoration(p_restoration uuid, p_retention text, p_material text, p_delegate uuid, p_supervisor uuid, p_course uuid, p_notes text, p_expected_updated_at timestamptz) returns void`
    - edits details only;
    - stale → `'This restoration was changed by someone else. Reload to see it.'`
  - `public.void_restoration(p_restoration uuid, p_reason text) returns void`
    - refused when the restoration has been ended (`'Only the newest restoration on these implants can be undone.'`) or is already voided;
    - a blank reason → `'Say why this restoration is being removed from the record.'`;
    - reopens the restorations with `ended_by = p_restoration` (clears `ended_on/end_kind/end_reason/ended_by`).
  - `app_private.sync_restored(p_site uuid) returns void`: applies the Restored state rule. It is called for every site whose current restoration changed.
- Behaviour: lock sites `for update` in `id` order before reading current restorations, so a restoration and its implants lock in one order. The arch-order contiguity check is one helper, `app_private.teeth_contiguous(p_teeth smallint[]) returns boolean`.

- [ ] **Step 1: Write the failing DB tests** in `tests/db/restorations.test.ts`.
  - Setup: copy `stage-filter.test.ts` (`makeProduct`, `receive`, `makeDelegate`, `makePatient`, `place`). Name patients `Zz Resto …`. Use savepoint refusals, as in `research-capture.test.ts`.
  - Tests:
    - `a final single crown restores its implant`: `implant_sites.state = 'restored'` and the tooth status is `restored`.
    - `a temporary does not restore`: the state stays `placed`.
    - `a bridge covers its pontic`: sites 34 and 36 with teeth `{34,35,36}` save; both sites are restored.
    - `refuses teeth that are not contiguous or miss an implant`: `{34,36}` → `/teeth/i`.
    - `refuses mixed jaws`: sites 36 and 26 → `/jaw/i`.
    - `refuses a bridge on one implant` → `/at least two/i`. `refuses a single crown on two implants` → `/one implant/i`.
    - `a final replaces a temporary`: the temporary has `end_kind = 'replaced'` and `ended_on = new fitted_on`.
    - `a final over a final needs a reason`: without a reason → `/why/i`; with a reason → old `end_kind = 'remade'`.
    - `refuses a temporary over a final` → `/Record the repair as a problem/`.
    - `partial overlap ends the bridge completely` (Review Focus 1): the bridge on 34+36 is `remade`; 34 is `placed`, its tooth is `implant_placed`; 36 is `restored`.
    - `undo reopens what it ended` (Review Focus 2): after voiding the crown on 36, the bridge is current again and 34 and 36 are both restored. Voiding the bridge while the crown is current → `/newest/`.
    - `refuses a date before placement or in the future`.
    - `refuses a removed or failed implant`.
    - `update_restoration edits details and rejects a stale updated_at`: use a different timestamp, e.g. `'2026-01-01T00:00:00Z'`, as in `surgery-stability.test.ts`.
    - `needs Edit on Patients` → permission error.
- [ ] **Step 2: Run** `npm run test:db -- restorations`. Expected: FAIL, because `add_restoration` doesn't exist.
- [ ] **Step 3: Write 0057** with the Interfaces above and the Global Constraints rules. Dry-run it in a rolled-back transaction.
- [ ] **Step 4: Run** `npm run test:db -- restorations permissions audit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): restorations linked to implants and teeth (0057)`

### Task 2: Migration 0058 — problems, state ownership, report readers

**Files:**
- Create: `supabase/migrations/0058_restoration_problems_reports.sql`
- Test: `tests/db/restoration-problems.test.ts`, `tests/db/restoration-reports.test.ts`

**Interfaces:**
- Consumes: Task 1's tables and `app_private.sync_restored`.
- Produces, `public.restoration_problems`:
  - columns: `id, restoration_id fk not null, noticed_on date not null, type text, action text, notes text not null default '', voided_at, voided_by, voided_reason, created_at, created_by, updated_at`;
  - checks from Global Constraints; RLS, audit and `updated_at` as in Global Constraints.
- Produces, problem functions:
  - `public.record_restoration_problem(p_restoration uuid, p_noticed_on date, p_type text, p_action text, p_notes text) returns uuid`
  - `public.update_restoration_problem(p_problem uuid, p_noticed_on date, p_type text, p_action text, p_notes text, p_expected_updated_at timestamptz) returns void`
  - `public.void_restoration_problem(p_problem uuid, p_reason text) returns void`
  - The date is between the restoration's `fitted_on` and `coalesce(ended_on, cairo_today())`: `'The problem date must be between the fitting date and <end or today>.'`. A voided restoration is refused.
- Produces, state ownership (`create or replace`, same signatures):
  - `void_component` (latest 0030:432) no longer changes `state` for `final_restoration`. Instead it calls `app_private.sync_restored` on the site.
  - `void_followup` (latest 0048:188) sets `restored` when the site has a current final restoration, otherwise `placed` (replacing the component check at 0048:214-222).
  - Copy each LATEST body. Search later migrations first.
- Produces, report readers:
  - `public.course_restorations(p_course uuid) returns table (restoration_id uuid, patient_name text, file_no text, teeth smallint[], stage text, type text, fitted_on date, delegate_id uuid, delegate text, supervisor text, ended_on date, end_kind text)`
    - security invoker; course rule from Global Constraints; voided rows excluded.
  - `public.my_restorations() returns table (restoration_id uuid, course_name text, patient_name text, file_no text, teeth smallint[], stage text, type text, fitted_on date, ended_on date)`
    - security definer, the same delegate guard as `my_report` (0046:85).
  - `public.delegate_restorations(p_delegate uuid) returns table (restoration_id uuid, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text, teeth smallint[], stage text, type text, fitted_on date, ended_on date)`
    - security invoker.

- [ ] **Step 1: Write the failing DB tests.**
  - `restoration-problems.test.ts`:
    - records, updates and voids a problem;
    - date bounds;
    - stale update;
    - a voided restoration is refused;
    - permission.
  - `restoration-reports.test.ts`:
    - a restoration with `course_id` appears in that course;
    - one without a course appears in the course whose dates contain `fitted_on` and whose enrollment includes its delegate, and not in another course;
    - `delegate_restorations` lists it;
    - `my_restorations` as the test delegate login (`inject('testUsers').delegate`, linked to "Test Delegate Login") lists only theirs.
  - Same file, Review Focus 3: a bridge on 34+36, then 36 fails (`record_failure` or a failed `record_visit`, as in `failure.test.ts`):
    - 36 stays `failed` and 34 `restored`;
    - after voiding 36's failed visit, 36 is `restored`.
  - `void_component` on a `final_restoration` component (fit through `fit_component`) leaves the state decided by restorations.
- [ ] **Step 2: Run** `npm run test:db -- restoration-problems restoration-reports`. Expected: FAIL.
- [ ] **Step 3: Write 0058** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- restoration permissions audit failure components visits`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): restoration problems, restored state from restorations, report readers (0058)`

### Task 3: Migration 0059 — convert existing final restorations

**Files:**
- Create: `supabase/migrations/0059_convert_final_restorations.sql`
- Test: `tests/db/restoration-conversion.test.ts`

**Interfaces:**
- Consumes: Task 1's tables.
- Produces: an idempotent conversion as `app_private.convert_final_restorations() returns integer` (the rows created). The migration calls it once. It stays callable so a follow-up can reconcile rows fitted by the old app during the release window.
- **Converted rows:**
  - For each non-voided `final_restoration` component **with no restoration already linked to its site and fitted on the same date**:
    - **Current** (`removed_on is null`): insert a `final`, `single_crown` restoration.
      - `teeth = {site.tooth}`, `fitted_on = component.fitted_on`, `delegate_id = component.fitted_by_delegate_id`;
      - retention and material null;
      - `notes = 'Converted from a fitted final restoration.'`
    - **Followed by another `final_restoration`** on the same site (the next non-voided component by `fitted_on`, `created_at` is a `final_restoration`): insert it the same way, plus `ended_on` = the next one's `fitted_on`, `end_kind = 'remade'`, `end_reason = 'not recorded'`, and `ended_by` = the restoration converted from the next one.
    - **Followed by any other component type:** not converted.
  - Link each one in `restoration_sites`.
- Don't call `sync_restored`; the state is already `restored` for current ones. Don't touch `site_components`.

- [ ] **Step 1: Write the failing DB tests** (fixtures through `fit_component`, then call `app_private.convert_final_restorations()` as postgres):
  - `converts a current final restoration`: one final single crown, with the delegate, fitted on the same date.
  - `converts a remade chain`: crown A, then crown B. A is remade (`'not recorded'`) and ended by B; B is current.
  - `skips a crown followed by a healing abutment`.
  - `is idempotent`: a second call returns 0.
  - `leaves implant state unchanged` (Review Focus 4, DB half).
- [ ] **Step 2: Run** `npm run test:db -- restoration-conversion`. Expected: FAIL.
- [ ] **Step 3: Write 0059**, dry-run it, and check the dry-run output count against `select count(*) from site_components where component_type = 'final_restoration' and voided_at is null` on the local stack.
- [ ] **Step 4: Run** `npm run test:db`. Expected: the whole DB suite passes.
- [ ] **Step 5: Commit** `feat(db): convert fitted final restorations into restorations (0059)`

### Task 4: Migration 0060 — course on placement

**Files:**
- Create: `supabase/migrations/0060_placement_course.sql`
- Test: `tests/db/placement-course.test.ts`

**Interfaces:**
- Produces:
  - `public.place_implant_v3(p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date, p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid, p_graft text, p_notes text, p_slot uuid, p_technique text, p_course uuid) returns uuid`
    - The body is `place_implant_v2`'s (0035:8-169) with these changes:
      - no torque/ISQ/bone parameters (they stay null);
      - no defaults;
      - `p_course` is required (`'Choose the course.'`) and must exist;
      - it sets `course_id = p_course`, overriding the slot's session course.
  - `public.correct_placement_v2(p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid, p_course uuid, p_graft text, p_notes text) returns void`
    - The body is `correct_placement`'s latest (0053) with `course_id = p_course`; the course is required.
- `place_implant_v2` and `correct_placement` stay unchanged.

- [ ] **Step 1: Write the failing DB tests:**
  - `v3 stores the course`;
  - `v3 refuses no course`;
  - `v3 with a slot keeps the chosen course`;
  - `correct_placement_v2 changes the course`;
  - `v2 still places without a course and the placement counts by date and enrollment in course_report` (Review Focus 5);
  - permission.
- [ ] **Step 2: Run** `npm run test:db -- placement-course`. Expected: FAIL.
- [ ] **Step 3: Write 0060** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- placement-course permissions slot-placement implants corrections`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): placement records its course (0060)`

### Task 5: Restoration lib + Restoration tab (view and add/edit/undo)

**Files:**
- Create: `src/lib/restorations/restorations.ts` (+ `.test.ts`): values, labels, types, Zod schemas, `loadingOf`, arch helpers
- Create: `src/app/(app)/patients/[id]/restorations.tsx` (+ `.test.tsx`): tab panel, `RestorationForm`, `RestorationCard`
- Create: `src/app/(app)/patients/[id]/restoration-actions.ts` (+ `.test.ts`)
- Modify: `chart-data.ts` (load the patient's restorations with site ids and problems), `src/lib/patients/implant-tabs.ts` (+ test), `implant-tabs.tsx`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces (`restorations.ts`):
  - `ARCH_ORDER: { upper: number[]; lower: number[] }`
  - `jawOf(tooth: number): 'upper' | 'lower'`
  - `defaultTeeth(implantTeeth: number[]): number[]`: the contiguous run from the first to the last implant in arch order.
  - `type Restoration = { id; stage; type; teeth: number[]; fitted_on; retention; material; delegate_id; supervisor_id; course_id; notes; ended_on; end_kind; end_reason; updated_at; site_ids: string[]; problems: RestorationProblem[] }`
  - `type RestorationProblem = { id; noticed_on; type; action; notes; updated_at }`
  - `currentRestoration(siteId: string, all: Restoration[]): Restoration | null`
  - `loadingOf(placedOn: string, restorations: Restoration[]): 'immediate' | 'early' | 'conventional' | null`: from the earliest `fitted_on` among the site's restorations.
  - `restorationSchema`, `restorationEditSchema` (schemas for the actions' form fields; blank → null).
  - The label maps from Global Constraints.
- Actions: `addRestoration`, `updateRestoration`, `voidRestoration`.
  - Each uses `requirePermission('patients','edit')` and the shared `run()` / `userMessage` pattern from `implant-actions.ts`.
  - They call the Task 1 RPCs with the named `p_*` params.
- **Tab:** key `restoration`, label "Restoration", placed between `surgery` and `visits`. Hidden for planned and removed sites. Its badge is the current restoration's stage, if any.
- **Panel** (as the approved mockup, spec goal 6):
  - shows `Loading: <label>`;
  - lists restorations newest first, the current one highlighted, ended ones muted with "Replaced on …" / "Remade on … — <reason>";
  - **Add restoration** (when editable) opens the form:
    - stage, type, implants (checkboxes over the patient's placed or restored implants, this one pre-ticked), teeth covered (shown for multi-implant types, pre-filled with `defaultTeeth`, extra teeth tickable beyond the ends);
    - fitted date (`todayIso()` default), retention, material, delegate (optional), supervisor (optional), course (optional; courses running on the date first), and notes;
    - a remake reason field, shown when the selection covers a current final;
    - a line "Replaces the <stage> on <teeth>" when it ends something.
  - Edit details and Undo (with a reason) on the newest restoration.
  - Selects are remounted with `key` per result.

- [ ] **Step 1: Write the failing tests.**
  - `restorations.test.ts`:
    - `defaultTeeth([34,36])` → `[34,35,36]`; `defaultTeeth([15,12,22,25])` → `[15,14,13,12,11,21,22,23,24,25]`;
    - `jawOf(26)` → `'upper'`;
    - `loadingOf('2026-01-10', [fitted '2026-01-10'])` → `'immediate'`; `'2026-01-17'` → `'immediate'` (7 days); `'2026-01-18'` → `'early'`; `'2026-03-10'` → `'early'`; `'2026-03-11'` → `'conventional'`; with no restorations → `null`;
    - the schemas map blanks to null and reject unknown values.
  - `implant-tabs.test.ts`: the tab order is implant, surgery, restoration, visits, complications, corrections.
  - `restorations.test.tsx` (mock `./restoration-actions`):
    - a viewer sees the cards but no Add;
    - choosing Bridge and ticking 34 shows teeth 34–36 pre-ticked;
    - Save calls `addRestoration` with `sites`, `teeth`, `stage`, `type`;
    - the remake reason shows only when a current final is covered.
  - `restoration-actions.test.ts`: the RPC payload names.
- [ ] **Step 2: Run** `npm test -- restorations implant-tabs restoration-actions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green, with no warnings from the new files.
- [ ] **Step 5: Commit** `feat(ui): restoration tab with add, edit and undo`

### Task 6: Restoration problems UI + implant complication types

**Files:**
- Modify: `src/app/(app)/patients/[id]/restorations.tsx` (problem list and form), `restoration-actions.ts`
- Modify: `src/lib/implants/complications.ts` (+ test): the implant form's mechanical types
- Modify: `src/lib/patients/history.ts` (+ test): labels for `restorations`, `restoration_sites`, `restoration_problems`

**Interfaces:**
- Consumes: Task 2 problem functions; Task 5 types.
- Produces:
  - Actions `recordRestorationProblem`, `updateRestorationProblem`, `voidRestorationProblem`.
  - `IMPLANT_FORM_TYPES`: `COMPLICATION_TYPES` with the five crown types removed from `mechanical`, leaving `implant_fracture`, `abutment_fracture`, `other`. The complication form uses it; labels for old rows still resolve through `TYPE_LABELS`.
- **History:**
  - "Restoration added: <Stage> <type> on <teeth>"
  - "Restoration updated: <fields>"
  - "Restoration removed from the record (<reason>)"
  - "Restoration problem recorded: <type> — <action>"

- [ ] **Step 1: Write the failing tests:**
  - "Record a problem" saves type, date, action and notes;
  - the implant complication form no longer offers "Screw loosening";
  - the history labels.
- [ ] **Step 2: Run** `npm test -- restorations complications history`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): record problems on a restoration; crown problems leave the implant form`

### Task 7: Odontogram bars; hide final_restoration components

**Files:**
- Modify: `src/components/odontogram/odontogram.tsx`, `layout.ts` (+ tests)
- Modify: `src/app/(app)/patients/[id]/chart-panel.tsx` (+ test)
- Modify: `src/lib/inventory/components.ts` (`badgesFor`), `site-details.tsx` (`ComponentTimeline`), `implant-forms.tsx` (`ComponentForm` stops offering `final_restoration`)

**Interfaces:**
- Consumes: Task 5's `Restoration` and `ARCH_ORDER`.
- Produces:
  - Odontogram prop `spans?: { id: string; teeth: number[]; implantTeeth: number[]; label: string; temporary: boolean }[]`, one per current restoration.
  - `layout.ts` gets `spanBox(teeth: number[]): { x; y; width; jaw }`, which reuses the tooth box geometry.
  - **Drawing:**
    - one bar per span, between the tooth boxes and the jaw line, labelled e.g. "Bridge 34–36" or "Full arch · on 15, 12, 22, 25" (single crown: "Crown");
    - covered teeth without an implant are outlined dashed;
    - temporaries are drawn at reduced opacity, using tokens only.
  - **Clicking** a bar or a covered tooth calls `onSelect` with the restoration's first implant tooth (for a pontic or cantilever) and opens the Restoration tab.
  - `badgesFor` and `ComponentTimeline` skip `final_restoration` components.

- [ ] **Step 1: Write the failing tests:**
  - `spanBox([34,35,36])` spans exactly those boxes;
  - the odontogram renders one bar labelled "Bridge 34–36";
  - clicking pontic 35 selects 34;
  - `badgesFor` ignores a current `final_restoration` (Review Focus 4, UI half);
  - `ComponentForm` has no "Final restoration" option.
- [ ] **Step 2: Run** `npm test -- odontogram layout chart-panel components implant-forms`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): restorations on the odontogram`

### Task 8: Course picker on placement and corrections

**Files:**
- Modify: `src/app/(app)/patients/[id]/implant-forms.tsx` (PlaceForm), `corrections.tsx`, `implant-actions.ts`, `chart-data.ts` (courses list), `src/lib/inventory/schemas.ts` (`placeSchema`, `correctPlacementSchema`) and their tests

**Interfaces:**
- Consumes: Task 4's `place_implant_v3` and `correct_placement_v2`.
- Produces:
  - `placeSchema.courseId` is required: `'Choose the course.'`
  - `ChartData.courses: { id; name; start_date; end_date }[]`, sorted with courses whose dates contain the given date first, then by `start_date` descending.
  - PlaceForm has a required "Course" select, pre-selected with the booking's session course when placing from a booking.
  - Corrections has a "Course" select, pre-selected with `site.course_id`.
  - `placeImplant` calls `place_implant_v3`; `correctPlacement` calls `correct_placement_v2`.

- [ ] **Step 1: Write the failing tests:**
  - the Place form shows a required "Course" and refuses to submit without one;
  - placing from a booking pre-selects its course;
  - the actions send `p_course`.
- [ ] **Step 2: Run** `npm test -- implant-forms corrections implant-actions schemas`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): course picker on placement and corrections`

### Task 9: Reports show restorations

**Files:**
- Modify: `src/lib/reports/course-report.ts` (+ test), `src/app/(app)/courses/[id]/report/page.tsx`, `report.csv/route.ts`
- Modify: `src/lib/delegate-portal/report.ts` (+ test), `src/app/(app)/my/report/page.tsx`, `src/app/(app)/delegates/[id]/page.tsx`, and the two `report.csv` routes

**Interfaces:**
- Consumes: Task 2's `course_restorations`, `my_restorations` and `delegate_restorations`.
- Produces:
  - `summarise(rows, restorations)`: the per-delegate summary gains `restored` (restorations fitted by that delegate in the course), and totals gain `restorations`.
  - **Course report page:** a "Restorations" table: patient, teeth, stage, type, fitted, delegate, supervisor, status (current / replaced / remade).
  - **Delegate pages (`/my/report` and `/delegates/[id]`):** a "Restorations" section.
  - **CSVs:** add a restorations section after the implant rows: a blank line, then a header row. Columns: `restoration,patient,file_no,teeth,stage,type,fitted_on,delegate,status`.

- [ ] **Step 1: Write the failing tests:**
  - `summarise` counts `restored` per delegate and ignores restorations without a delegate in the per-delegate counts;
  - the CSV builder emits the restorations section with that header.
- [ ] **Step 2: Run** `npm test -- course-report report`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): restorations in course and delegate reports`

### Task 10: E2E, docs

**Files:**
- Create: `tests/e2e/restorations.spec.ts`
- Modify: E2E specs that place through the UI and now need a course: grep `tests/e2e` for the Place form (`implants.spec.ts`, `slot-placement`, `surgical-details`, …).
- Modify: `CLAUDE.md`; `docs/operations.md` §D only if a migration seeds rows (0059 seeds from data, not fixed rows, so none is expected; say so in the commit).

- [ ] **Step 1: Update the existing specs.** Each UI placement chooses a course, using `uniqueName` course seeding from `api.ts` if needed.
- [ ] **Step 2: Add `restorations.spec.ts`:**
  - `records a temporary then a final crown and shows the loading`: place, add a temporary the same day, add a final, then reload. The Restoration tab shows "Loading: Immediate", the temporary is "Replaced on …", and the final is current.
  - `records a bridge and shows it on the odontogram`: two implants (34, 36), add a bridge. The odontogram shows "Bridge 34–36"; clicking 35 opens 34's Restoration tab.
  - `records a problem on a restoration`.
  - `course report counts the restoration for its delegate`.
- [ ] **Step 3: Run** `npx playwright test restorations implants course-report corrections`, plus any spec changed in Step 1. Expected: PASS. Check :3000 and free memory first.
- [ ] **Step 4: Update CLAUDE.md:**
  - add a **Restorations (0057–0059)** bullet covering:
    - tables and write functions;
    - who owns `restored`;
    - teeth and arch rules;
    - loading derived in TS;
    - problems on the restoration, and crown types gone from the implant form;
    - the conversion;
    - report readers;
  - update the Placement bullet: `place_implant_v3` with a required course (0060); `place_implant_v2` and `correct_placement` to drop in a follow-up PR;
  - update the Components bullet: "final restoration" is no longer offered.
- [ ] **Step 5: Verify** with `./scripts/ship.sh verify restorations implants course-report corrections`. Expected: "Verified".
- [ ] **Step 6: Commit** `test(e2e): restorations; docs`
