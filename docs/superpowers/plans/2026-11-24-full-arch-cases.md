# Full-arch cases (C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a full-arch case per patient and arch from planning onward (configuration, implants, bridges, final-bridge stages) and show it in the Full arch view.

**Architecture:** Two new tables (`full_arch_cases`, `full_arch_stages`) and nullable `case_id` on `implant_sites` and `restorations`, written only through new security-definer functions; a trigger links a new restoration to the open case of its implants. Status is derived in TS from what is recorded. The app loads cases with the chart data, adds a case panel to the Full arch view (C1, `src/components/full-arch/`), and labels each arch with its case.

**Tech Stack:** Supabase Postgres (plpgsql definers, RLS), Next.js 15 server actions, React 19, Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-full-arch-design.md` (C2 part and Settled points). Builds on C1 (`docs/superpowers/plans/2026-11-23-full-arch-view.md`), which must be merged first.

## Global Constraints
- Migrations `0142_full_arch_cases.sql` (tables, columns, RLS, trigger) and `0143_full_arch_case_functions.sql` (definers, history). Never edit an applied migration; dry-run each in a rolled-back transaction before the first `npm run test:db` (root CLAUDE.md Gotchas).
- Backward-compatible: the previous app version must keep working against the new schema (only additions; no change to existing functions' signatures; `place_implant_v4`, `add_restoration`, planning and booking unchanged).
- New tables follow the company pattern of `public.doctors` (0114): `company_id uuid not null default app.current_company_id()`, `(company_id, id)` unique, composite FKs to the company's rows, the four restrictive `*_company_*` policies, a `*_tenant_definer` policy, `force row level security`, `set_updated_at` and `audit_row('id')` triggers. Read policies mirror `restorations` (0057: `is_active_user()` + restrictive `can('patients','view')`). No direct insert/update/delete grants to `authenticated`.
- Definers: `security definer set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, owner `tenant_definer` as other recent definers, `revoke … from public, anon` / `grant execute … to authenticated`, errors via `app_private.fail('…')`. No defaulted parameters.
- Values: arch `upper` / `lower` (upper = FDI quadrants 1–2, lower = 3–4); configuration `all_on_4` / `all_on_6` / `all_on_x` / `other` with labels "All-on-4", "All-on-6", "All-on-X", "Other"; `name` ≤ 60, `notes` ≤ 1000, `close_reason` 1–500; stages `scan` / `lab_design` / `try_in` with labels "Scan / impression", "Lab and design approved", "Try-in"; `lab` ≤ 120 (lab_design only), `passive_fit boolean` and `occlusion` ≤ 500 (try_in only), stage `notes` ≤ 1000.
- One open case per patient + arch (`closed_at is null`). An implant belongs to at most one case; it must be the case's patient and arch and not `removed`. A restoration joins a case only if every tooth is in the case's arch and it is the same patient.
- Status (TS, `caseStatus`): `closed` if `closed_at`; `completed` if a current (not ended, not voided) final restoration has this `case_id`; `in_treatment` if any case implant is placed, restored or failed; else `planned`. Labels "Planned", "In treatment", "Completed", "Closed".
- Delivery is not a stage row: the final bridge's fitted date (and the temporary's) come from the linked restorations.
- Stage dates: not after `cairo_today()` and not before the earliest `placed_on` of the case's implants; a stage needs at least one placed implant in the case. Any order; `record_case_stage` creates or replaces; `clear_case_stage` deletes.
- Exact error messages (used by tests and shown to users):
  - "This arch already has an open full-arch case."
  - "An implant must be this patient's, on this arch, and not in another case."
  - "A restoration in a case must be this patient's and on the case's arch."
  - "Record a stage after an implant of the case is placed."
  - "The date must be between the first placement and today."
  - "This case is closed."
  - "Give a reason to close the case."
  - "Someone else changed this case. Reload and try again." (optimistic concurrency on `full_arch_cases.updated_at`)

## Review Focus
1. Two companies: one company's definer calls can never read or link another company's patient, site, restoration or case. → Task 2 test `company isolation`.
2. An implant removed as entered by mistake (`remove_placement`) or a deleted patient (`delete_patient`) with a case: no error, the case remains (or goes with the patient). → Task 1 test `remove_placement and delete_patient with a case`.
3. A temporary replaced by a final bridge on the same implants: the final is linked to the case automatically (trigger), and voiding the final returns status to in treatment. → Task 1 trigger test + Task 3 `caseStatus` tests.
4. Previous app version: `add_restoration`, `place_implant_v4`, `plan_implant` called exactly as before still work with cases present. → Task 1 test `previous app calls unchanged`.
5. A closed case whose implants are needed in a new case on the same arch: the new case takes them (a closed case keeps only its record, not its implants; `create_full_arch_case` and `set_case_sites` may take implants from a **closed** case). → Task 2 test `new case takes implants from a closed case`.

---

### Task 1: Schema, RLS and the restoration-link trigger (0142)

**Files:**
- Create: `web/supabase/migrations/0142_full_arch_cases.sql`
- Test: `web/tests/db/full-arch-cases.test.ts`

**Interfaces:**
- Produces: tables `public.full_arch_cases(id, company_id, patient_id, arch, configuration, name, notes, closed_at, close_reason, created_at, created_by, updated_at)`, `public.full_arch_stages(id, company_id, case_id, stage, done_on, lab, passive_fit, occlusion, notes, created_at, created_by, updated_at; unique (case_id, stage))`; columns `implant_sites.case_id uuid`, `restorations.case_id uuid` with composite FKs `(company_id, case_id) → full_arch_cases(company_id, id) on delete set null (case_id)`; partial unique index `full_arch_cases_one_open (company_id, patient_id, arch) where closed_at is null`; trigger `restoration_sites_case_link` after insert on `restoration_sites` (function `app_private.link_restoration_to_case()`): when the restoration's `case_id` is null and the inserted site has an open case whose arch contains all the restoration's teeth, set `restorations.case_id`. Grants: `select` on both tables to `authenticated`; `case_id` is not in any column grant (only definers write it).

- [ ] **Step 1: Write failing DB tests** (`withTx`, `actAs` as in `tests/db/restorations.test.ts`; insert cases as `asPostgres` in this task since definers come in Task 2):
  - `one open case per arch`: second open `upper` case for the same patient → unique violation; a closed one plus a new open one → ok.
  - `trigger links a new restoration`: a case on `upper` with sites at 15, 12, 22, 25 placed; `add_restoration` (temporary, full_arch, teeth 15–25) → that restoration's `case_id` = case id; a single crown on a site with no case → `case_id` null; a case that is closed → not linked.
  - `staff read, delegates do not`: organizer sees the case; a delegate login sees no rows; viewer with Patients None sees none.
  - `remove_placement and delete_patient with a case`: both succeed; after `delete_patient` the case row is gone (cascade from patient).
  - `previous app calls unchanged`: `plan_implant`, `place_implant_v4`, `add_restoration` with their existing arguments succeed on a patient that has a case.

- [ ] **Step 2: Run** `npm run test:db -- full-arch-cases` — Expected: FAIL (relation does not exist).

- [ ] **Step 3: Write `0142_full_arch_cases.sql`**; dry-run it in a rolled-back transaction (scratchpad `tsx` script with `pgConfig()`), then **Run** `npm run test:db -- full-arch-cases` — Expected: PASS. Also run `npm run test:db -- module-guards permissions restorations` — Expected: PASS.

- [ ] **Step 4: Commit** `git add web/supabase/migrations/0142_full_arch_cases.sql web/tests/db/full-arch-cases.test.ts && git commit -m "Full-arch cases: tables, case links and restoration trigger (0142)"`

---

### Task 2: Case functions and history (0143)

**Files:**
- Create: `web/supabase/migrations/0143_full_arch_case_functions.sql`
- Test: `web/tests/db/full-arch-cases.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 tables and columns.
- Produces (all `returns uuid` for create, `void` otherwise):
  - `create_full_arch_case(p_patient uuid, p_arch text, p_configuration text, p_name text, p_notes text, p_sites uuid[]) returns uuid`
  - `update_full_arch_case(p_case uuid, p_configuration text, p_name text, p_notes text, p_updated_at timestamptz)`
  - `set_case_sites(p_case uuid, p_sites uuid[], p_updated_at timestamptz)` — replaces the membership of an open case
  - `set_case_restoration(p_restoration uuid, p_case uuid)` — `p_case` null unlinks
  - `record_case_stage(p_case uuid, p_stage text, p_done_on date, p_lab text, p_passive_fit boolean, p_occlusion text, p_notes text)`
  - `clear_case_stage(p_case uuid, p_stage text)`
  - `close_full_arch_case(p_case uuid, p_reason text, p_updated_at timestamptz)` / `reopen_full_arch_case(p_case uuid, p_updated_at timestamptz)`
  - `patient_history` (latest definition, `create or replace`, same signature) also returns `full_arch_cases` and `full_arch_stages` audit rows for the patient.

- [ ] **Step 1: Write failing DB tests** (extend the file):
  - `create groups planned and placed implants`: create on `upper` with sites 15 (planned), 25 (placed) → both `case_id` set; a lower site → "An implant must be this patient's, on this arch, and not in another case."; second open case on `upper` → "This arch already has an open full-arch case."
  - `new case takes implants from a closed case`: close case A (reason "Changed plan"), create B with A's sites → sites now in B, A keeps nothing.
  - `close needs a reason and blocks edits`: close with `''` → "Give a reason to close the case."; `set_case_sites` / `record_case_stage` on a closed case → "This case is closed."; `reopen` → ok; reopen when another open case exists on the arch → "This arch already has an open full-arch case."
  - `optimistic concurrency`: `update_full_arch_case` with a stale `p_updated_at` → "Someone else changed this case. Reload and try again."
  - `stages`: with no placed implant → "Record a stage after an implant of the case is placed."; date before the first placement or after today → "The date must be between the first placement and today."; `try_in` with passive fit false and occlusion text → stored; recording `try_in` again replaces it; `lab` given on `scan` → refused ("…" any `fail` message); `clear_case_stage` removes it.
  - `restoration link rules`: `set_case_restoration` with a restoration on the lower arch → "A restoration in a case must be this patient's and on the case's arch."; null unlinks.
  - `permissions`: viewer (View on Patients) calling any function → refused by `require_perm`.
  - `company isolation`: acting in company B with company A's patient / case / site ids → refused or no rows affected; nothing in A changes.
  - `history shows case changes`: `patient_history(patient)` includes rows for `full_arch_cases` and `full_arch_stages`.

- [ ] **Step 2: Run** `npm run test:db -- full-arch-cases` — Expected: the new tests FAIL.

- [ ] **Step 3: Write `0143_full_arch_case_functions.sql`** (find the latest `patient_history` definition by searching later migrations first); dry-run; **Run** `npm run test:db -- full-arch-cases permissions module-guards` — Expected: PASS. Then the full `npm run test:db` — Expected: all pass.

- [ ] **Step 4: Commit** `git add web/supabase/migrations/0143_full_arch_case_functions.sql web/tests/db/full-arch-cases.test.ts && git commit -m "Full-arch case functions and history (0143)"`

---

### Task 3: Domain types, status, loading and actions

**Files:**
- Create: `web/src/lib/full-arch/cases.ts`, `web/src/lib/full-arch/cases.test.ts`, `web/src/app/(app)/patients/[id]/case-actions.ts`, `web/src/app/(app)/patients/[id]/case-actions.test.ts`
- Modify: `web/src/lib/inventory/types.ts` (`ChartData.cases`, `ImplantSite.case_id`, `Restoration.case_id`), `web/src/app/(app)/patients/[id]/chart-data.ts` (load cases with stages), `web/src/lib/patients/history.ts` (labels)

**Interfaces:**
- Consumes: Task 2 functions.
- Produces:
  ```ts
  export const ARCHES = ['upper', 'lower'] as const; export type Arch = (typeof ARCHES)[number];
  export const CONFIGURATIONS = ['all_on_4', 'all_on_6', 'all_on_x', 'other'] as const; export const CONFIGURATION_LABELS: Record<Configuration, string>;
  export const CASE_STAGES = ['scan', 'lab_design', 'try_in'] as const; export const CASE_STAGE_LABELS: Record<CaseStage, string>;
  export type CaseStageRow = { stage: CaseStage; done_on: string; lab: string | null; passive_fit: boolean | null; occlusion: string | null; notes: string };
  export type FullArchCase = { id: string; arch: Arch; configuration: Configuration; name: string; notes: string; closed_at: string | null; close_reason: string | null; updated_at: string; stages: CaseStageRow[] };
  export type CaseStatus = 'planned' | 'in_treatment' | 'completed' | 'closed'; export const CASE_STATUS_LABELS: Record<CaseStatus, string>;
  export function caseStatus(c: FullArchCase, sites: readonly ImplantSite[], restorations: readonly Restoration[]): CaseStatus;
  export function caseTitle(c: FullArchCase): string; // "Upper arch · All-on-4" or "Upper arch · 4 + 2 zygomatic" when name given
  export function caseBridges(c: FullArchCase, restorations: readonly Restoration[]): { temporary: Restoration | null; final: Restoration | null }; // current ones linked to the case
  // Zod schemas: caseSchema, caseStageSchema, closeCaseSchema (values from Global Constraints)
  ```
  Server actions in `case-actions.ts` (pattern of `restoration-actions.ts`: `requirePermission('patients','edit')`, Zod parse, `rpc`, `userMessage`, `revalidatePath`): `createCase`, `updateCase`, `setCaseSites`, `setCaseRestoration`, `recordCaseStage`, `clearCaseStage`, `closeCase`, `reopenCase`, each `(input) => Promise<{ error?: string }>`.

- [ ] **Step 1: Write failing tests**: `cases.test.ts` — `caseStatus` for each status (incl. final voided → `in_treatment`, final ended → `in_treatment`, closed wins), `caseTitle` both forms, `caseBridges` picks current linked ones, schema bounds (name 61 chars refused, close reason empty refused, `lab` only on `lab_design`). `case-actions.test.ts` — each action calls the right RPC with the right argument names (mock the Supabase client as other action tests do) and returns `userMessage` errors.
- [ ] **Step 2: Run** `npm test -- full-arch/cases case-actions` — Expected: FAIL.
- [ ] **Step 3: Implement**; `loadChartData` reads `full_arch_cases` with `stages:full_arch_stages(...)` for the patient (closed ones too) into `ChartData.cases`; `case_id` comes with sites and restorations.
- [ ] **Step 4: Run** `npm test -- full-arch case-actions chart-data history` and `npx tsc --noEmit` — Expected: PASS / clean.
- [ ] **Step 5: Commit** `git commit -m "Full-arch cases in the app's data and actions"` (add the files above).

---

### Task 4: Case panel, stages and the drawing's case labels

**Files:**
- Create: `web/src/app/(app)/patients/[id]/full-arch-case.tsx`, `web/src/app/(app)/patients/[id]/full-arch-case.test.tsx`
- Modify: `web/src/app/(app)/patients/[id]/chart-panel.tsx` (Full arch view only), `web/src/components/full-arch/full-arch.tsx` (optional `cases` prop: a caption per arch), `web/src/components/full-arch/full-arch.test.tsx`, `web/src/app/(app)/patients/[id]/restorations.tsx` (a read-only line "Part of: Upper arch · All-on-4" and an "Unlink from case" / "Link to case" control when `editable`)

**Interfaces:**
- Consumes: Task 3 exports and actions; C1 `FullArch`.
- Produces: `FullArchCasePanel({ patientId, data, arch })` — shown under the drawing in the Full arch view, one per arch that has a case or "Start full-arch case" buttons ("Start upper case", "Start lower case") when `data.editable` and no open case exists.
- Panel content (editable controls only when `data.editable`; forms uncontrolled with `defaultValue`, selects keyed per result — root CLAUDE.md React 19 gotcha):
  - Header: `caseTitle`, status badge (`CASE_STATUS_LABELS`), Edit (configuration, name, notes).
  - Implants: checklist of the arch's non-removed implants (tooth, type label, state), Save → `setCaseSites`.
  - Bridges: temporary "Delivered <date>" / "Not yet"; final "Delivered <date>" / "Not yet" (from `caseBridges`).
  - Final bridge stages: one row per `CASE_STAGES` with date, done ✓ or "Not recorded", Record/Edit form (date min = first placement of the case, max = `data.today`; Lab name on `lab_design`; Passive fit Yes/No and Occlusion on `try_in`; notes), Clear; then a Delivery row from the final bridge.
  - Close (reason required) / Reopen.
  - `FullArch` caption per arch: `"<caseTitle> · <status label>"` plus "Scan ✓ · Lab ✓ · Try-in — · Delivery —" progress.

- [ ] **Step 1: Write failing component tests**: start button creates a case with the chosen configuration and the arch's planned/placed implants pre-ticked; read-only (`editable=false`) shows no buttons; stage form sends `lab` only for lab_design and passive fit for try_in; date input `min`/`max` set as above; close requires a reason (error shown from the action); `FullArch` with `cases` shows the caption text; restoration tab shows "Part of: Upper arch · All-on-4".
- [ ] **Step 2: Run** `npm test -- full-arch-case full-arch restorations` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus `npx tsc --noEmit`, `npm run lint` — Expected: PASS / clean.
- [ ] **Step 5: Commit** `git commit -m "Full-arch case panel and stages"`.

---

### Task 5: E2E, docs

**Files:**
- Create: `web/tests/e2e/full-arch-cases.spec.ts`
- Docs: `web/src/app/(app)/patients/CLAUDE.md` ("Full-arch cases (0142–0143)" paragraph: tables, rules, trigger, status, functions), root `CLAUDE.md` one line next to the Implant kind note; `docs/operations.md` unchanged (tables not seeded).

- [ ] **Step 1: E2E** (setup like `tests/e2e/full-arch.spec.ts`): patient with planned implants at 15, 12, 22, 25 → Full arch → "Start upper case", All-on-4 → status "Planned"; place the four (API helpers as in `full-arch.spec.ts`) → reload → "In treatment"; add a temporary full-arch restoration 15–25 (API) → Temporary "Delivered"; record Scan, Lab and design (lab "E2E Lab"), Try-in (passive fit Yes) through the panel; add the final restoration (API) → caption shows "Completed" and Delivery date; void the final (API) → "In treatment".
- [ ] **Step 2: Run** `npx playwright test full-arch-cases full-arch restorations chart --project=chromium` — Expected: all pass.
- [ ] **Step 3: Docs**, then `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` — Expected: clean / all pass.
- [ ] **Step 4: Commit** `git commit -m "Full-arch cases: E2E and docs"`.
