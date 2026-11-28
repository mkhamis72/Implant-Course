# Exclude filters, screw sizes, passport screws, admin on phones, passport in the browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five owner requests in one feature PR: is/is-not patient filters, a per-system screw size list feeding the Component form, screw-only passport fields, admin pages that fit a phone, and a passport built in the browser with only a small log stored.

**Architecture:** Additive migrations 0147–0150 (new `_vN` functions and tables, nothing dropped); the app moves to the new functions; the passport's server routes are replaced by a JSON data route plus a lazily loaded client renderer reusing `document.tsx`/`chart.tsx`. Old functions/tables are dropped by a later clean-up PR (not in this plan).

**Tech Stack:** Next.js 15 App Router, React 19, Supabase Postgres (RLS, plpgsql), `@react-pdf/renderer` 4.9.0, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-filters-screws-passport-admin-design.md`

## Global Constraints
- All commands run from `web/`. Migrations `0147_patient_list_exclude.sql`, `0148_screw_sizes.sql`, `0149_component_screw_size.sql`, `0150_passport_generations.sql`; never edit an applied migration; backward-compatible (add, don't drop or rename).
- No overloads with defaulted parameters: new names (`patient_list_matches_v2`, `search_patients_v3`, `search_patients_count_v2`, `fit_component_v4`).
- Definer functions: `security definer set search_path = ''`, first line `perform app_private.require_perm('<area>', '<level>')` (admin-only: the existing admin check used by `set_passport_settings` in 0145), explicit `revoke … from public, anon` / `grant … to authenticated`; readers `security invoker`. Business errors via `app_private.fail('…')`.
- New tables: company policies + `tenant_definer` policy as in 0145, `audit_row` trigger, explicit grants; add to `tests/db/tenant-isolation.test.ts`; `tests/db/permissions.test.ts` and `tests/db/module-guards.test.ts` stay green.
- URL params exactly: `stage_not=1`, `course_not=1`, `supervisor_not=1`.
- Exclude meaning: *stage is not {ticked}* = matches none of the ticked options; *course is not X* = no placed implant and no non-cancelled booking in X (patients with no course included); supervisor likewise.
- Screw kinds exactly `abutment_screw`, `prosthetic_screw`; `temporary_cylinder_screw` uses `prosthetic_screw` sizes (its role is prosthetic_screw).
- Passport screw fields, in order: Product, Ref code, Size, Screwdriver, Recommended torque, Actual torque, Fitted on, Lot (Inventory on). Screwdriver/recommended torque from the product, else from the size.
- Passport generation needs **Patients View**; the download file name is `Implant passport <file no> <YYYY-MM-DD>.pdf` (Cairo date, `todayIso()`).
- UI: design tokens and shared classes only; data tables `className="table"` with `data-label`; dates via `formatDate`; no Prettier.
- `search_patients_v2` stays (the booking picker in `schedule/actions.ts` keeps using it).

## Review Focus
1. Exclude with a patient who has no implants and no bookings at all: "Course is not X" must list them; "Stage is not restored" must list them too (they match none). → Task 1 DB tests.
2. Exclude combined with paging: page 2 links and the total keep `*_not`. → Task 1 `pageHref` test.
3. A screw fitted with no product and a size: the passport prints the size's screwdriver and torque. → Task 4 model test.
4. Passport with Arabic name and a logo generated in the browser under the production CSP. → Task 0 spike + Task 5 E2E.
5. Admin Users page at 360 px with a 40-character email and the Change email panel open: no sideways scroll of the card. → Task 6 E2E.

---

### Task 0: Spike — react-pdf in the browser under the real CSP (throwaway)

**Files:** scratch only; nothing committed except, if needed, the CSP change carried into Task 5.

- [ ] **Step 1:** On a throwaway branch, add a test page (client component) that dynamically imports `@react-pdf/renderer` and `src/lib/passport/document.tsx`, registers the four TTFs copied to `public/passport-fonts/`, renders the `test-fixtures.ts` passport (Arabic name + PNG logo) with `pdf(el).toBlob()`, and clicks an `<a download>`.
- [ ] **Step 2:** `npm run build && npm run start`; open it in Chrome; check the console for CSP violations (`wasm-unsafe-eval`, worker, blob) and that a valid PDF downloads (starts with `%PDF-`, Arabic shaped, logo shown).
- [ ] **Step 3:** Record the result in the ledger: needed CSP additions (expected at most `'wasm-unsafe-eval'` in `script-src`), first-click time, added client chunk size. Delete the throwaway branch.

### Task 1: Exclude filters (is / is not)

**Files:**
- Create: `supabase/migrations/0147_patient_list_exclude.sql`, `tests/db/patient-list-exclude.test.ts`
- Modify: `src/app/(app)/patients/page.tsx`, `filter-menu.tsx`, `teaching-filters.tsx`, `pager.tsx`; `src/lib/patients/{stages,list-filters,pages}.ts` (+ their tests); `src/app/(app)/patients/CLAUDE.md`

**Interfaces:**
- Produces SQL: `patient_list_matches_v2(q text, include_archived boolean, stages text[], course uuid, supervisor uuid, stages_not boolean, course_not boolean, supervisor_not boolean)`; `search_patients_v3(<same 8>, p_offset int, p_limit int)`; `search_patients_count_v2(<same 8>) returns bigint` — bodies copied from 0124 with each excluded block wrapped in `not (…)` when its `_not` is true (a null/empty filter ignores its `_not`).
- Produces TS: `ListFilters` gains `stagesNot: boolean; courseNot: boolean; supervisorNot: boolean`; `parseNot(value): boolean` (`'1'` → true) in `list-filters.ts`.

- [ ] **Step 1: DB tests (failing)** in `tests/db/patient-list-exclude.test.ts`, names unique (`Zz Excl …`): patients A (restored implant in course C1), B (cover_screw implant in course C2), N (no implants, no bookings). Assert:
  - `stages={restored}, stages_not=true` → B and N, not A.
  - `course=C1, course_not=true` → B and N, not A.
  - `course=C1, course_not=false` → A only (same as `search_patients_v2`).
  - `search_patients_count_v2` equals the v3 row count for each case.
  - `stages_not=true` with empty `stages` → same as no filter.
  - Supervisor exclude mirrors course.
- [ ] **Step 2:** `npm run test:db -- patient-list-exclude` → FAIL (function does not exist). Dry-run the migration in a rolled-back transaction first (see Gotchas).
- [ ] **Step 3:** Write 0147 (grants as 0124: `authenticated` execute, revoke public/anon). Run the test → PASS.
- [ ] **Step 4: Unit tests (failing):** `pageHref({… stagesNot: true, courseNot: true}, 2)` contains `stage_not=1` and `course_not=1`; omits them when false; `parseNot('1') === true`, `parseNot(undefined) === false`, `parseNot(['1','0'])` uses the first value.
- [ ] **Step 5:** Implement parsing, `ListFilters`, `pageHref`, `Pager` props; `page.tsx` calls `search_patients_v3` / `search_patients_count_v2`; the Teeth column (`toothBoundFilters`) uses stages only when `stagesNot` is false.
- [ ] **Step 6: UI:** an `is / is not` `<select>` (name `stage_not` etc., values `''`/`1`, label "Stage filter mode" etc. for screen readers) beside each FilterMenu and each teaching select; remount with `key` so it keeps the URL value. Component test: the select renders with the URL's value and submits `stage_not=1`.
- [ ] **Step 7:** `npm test -- patients` PASS; update the "Patient list filter" bullet in `patients/CLAUDE.md` (v3 functions, `*_not`, v2 kept for the booking picker); commit.

### Task 2: Screw sizes — table, functions, Admin → Screw sizes

**Files:**
- Create: `supabase/migrations/0148_screw_sizes.sql`, `tests/db/screw-sizes.test.ts`, `src/app/(app)/admin/screw-sizes/{page.tsx,screw-size-row.tsx,screw-size-form.tsx,actions.ts}` (+ tests), `src/lib/admin/screw-sizes.ts` (schema + labels, + test)
- Modify: `src/lib/admin/nav.ts` (+ test), `tests/db/tenant-isolation.test.ts`, `src/app/(app)/admin/CLAUDE.md`

**Interfaces:**
- Produces table `public.screw_sizes(id uuid pk, company_id, brand text, system text, kind text check in ('abutment_screw','prosthetic_screw'), label text 1–40, driver_interface text ≤60, driver_size text ≤30, driver_ref text ≤60, torque_ncm numeric(5,1) 0–150 null, active boolean default true, created_at, updated_at)`, unique (company_id, brand, system, kind, label).
- Read: `can('patients','view') or is_admin()`; no direct writes for `authenticated`.
- Produces functions: `save_screw_size(p_id uuid, p_brand text, p_system text, p_kind text, p_label text, p_driver_interface text, p_driver_size text, p_driver_ref text, p_torque numeric) returns uuid` (p_id null = insert; admin only); `set_screw_size_active(p_id uuid, p_active boolean)` (admin only).
- Produces TS: `type ScrewSize = { id: string; brand: string; system: string; kind: 'abutment_screw' | 'prosthetic_screw'; label: string; driver_interface: string; driver_size: string; driver_ref: string; torque_ncm: number | null; active: boolean }` in `src/lib/admin/screw-sizes.ts`, plus `screwDriverLine(s: ScrewSize): string` ("Screwdriver <interface size> · ref <ref> · Recommended torque <n> Ncm", empty parts left out).

- [ ] **Step 1: DB tests (failing):** admin saves and edits a size; an organizer gets the permission error; a duplicate label refused with a user message; torque 151 refused; a viewer with Patients View reads it; a user without Patients View and not admin reads nothing; company B cannot read company A's sizes; switching off keeps the row.
- [ ] **Step 2:** Run → FAIL; write 0148; run → PASS; add the table to `tenant-isolation.test.ts`; `npm run test:db -- permissions module-guards tenant-isolation` PASS.
- [ ] **Step 3: Admin page.** Nav item "Screw sizes" after Catalogue (nav test updated). The page lists sizes grouped by brand + system (table with `data-label`: Kind, Size, Screwdriver, Torque, Active). There is an Add form; brand + system come from a select of the company's implant products' distinct (brand, system), read with `fetchAll`. Each row has Edit and Switch off/on. Actions call `requireAdmin()` and the RPCs, with Zod schema in `screw-sizes.ts` (+ tests for bounds).
- [ ] **Step 4:** Component tests for the form (React 19 uncontrolled pattern) and the actions (mocked rpc); commit.

### Task 3: Size in the Component form, `fit_component_v4`, chart line

**Files:**
- Create: `supabase/migrations/0149_component_screw_size.sql`, `tests/db/screw-size-fitting.test.ts`
- Modify: `src/app/(app)/patients/[id]/implant-forms.tsx`, `implant-actions.ts` (+ test), `chart-data.ts`, the chart component line renderer (where `specsLine` / component labels are shown), `src/lib/inventory/components.ts` (+ test)

**Interfaces:**
- Consumes: `ScrewSize`, `screwDriverLine` (Task 2).
- Produces SQL: `site_components.screw_size_id uuid null references screw_sizes(id)`; `fit_component_v4(<the 12 v3 params>, p_screw_size uuid)` = v3 body (latest definition, 0138) plus: when `p_screw_size` is not null, refuse unless the part's role is `abutment_screw` or `prosthetic_screw` and the size's kind equals that role, size active, same company — messages "A size is only for a screw.", "This size is for another kind of screw.".
- Produces TS: `SiteComponent.screw_size: Pick<ScrewSize,'label'|'driver_interface'|'driver_size'|'driver_ref'|'torque_ncm'> | null` (embedded in the chart select); `ChartData.screwSizes: ScrewSize[]` (active only); `sizesFor(sizes: ScrewSize[], kind, implant: {brand, system} | null): ScrewSize[]`.

- [ ] **Step 1: DB tests (failing):** fit an abutment screw with an abutment-screw size → stored; prosthetic size on abutment screw → refused; size on a healing abutment → refused; switched-off size → refused; v3 still works (no size).
- [ ] **Step 2:** Migration; tests PASS.
- [ ] **Step 3: Unit tests (failing):** `sizesFor` filters by kind and by implant brand+system, returns all sizes of the kind when implant is null, and maps `temporary_cylinder_screw` → `prosthetic_screw`; the ComponentForm shows a "Size" select only for screw types, shows `screwDriverLine` for the chosen size, and `fitComponent` sends `p_screw_size`; `implant-actions.test.ts` expects `fit_component_v4`.
- [ ] **Step 4:** Implement; the chart's component line appends the size label (e.g. "Abutment screw · M1.6 × 7 mm"); changing the type clears the size. `npm test -- implant` PASS; commit.

### Task 4: Passport — screw fields only

**Files:** Modify `src/lib/passport/model.ts`, `labels.ts`, `model.test.ts`, `test-fixtures.ts`, `document.test.tsx` if it asserts fields.

**Interfaces:** Consumes `SiteComponent.screw_size` (Task 3). Produces `L.screwSize = 'Size'`.

- [ ] **Step 1: Tests (failing):** a current abutment screw with product (driver set) and size prints exactly the Global Constraints field list in order, no Connection/Gingival height/Angle/Material; a prosthetic screw with no product but a size prints the size's screwdriver and torque; a full-arch case prosthetic screw prints the same list; an abutment still prints its full list unchanged; Size prints "Not recorded" when absent (same `NR` as other fields).
- [ ] **Step 2:** Implement in `partFields` (branch on `componentRole(c.component_type)`) and the case-screw list (`model.ts` ~285); tests PASS; commit.

### Task 5: Passport built in the browser, generation log

**Files:**
- Create: `supabase/migrations/0150_passport_generations.sql`, `tests/db/passport-generations.test.ts`, `src/app/(app)/patients/[id]/passport/data/route.ts` (+ test), `src/lib/passport/client.ts` (browser renderer, + test with mocks), `public/passport-fonts/*.ttf` (copies of the four fonts)
- Modify: `passport/page.tsx`, `generate-passport.tsx` (+ tests), `src/lib/passport/fonts.ts` (browser registration by URL), `src/lib/passport/load.ts` (logo as data URL), `next.config.ts` + `scripts/next-config.test.ts` (remove passport include), `src/lib/security-headers.ts` (+ test) only if Task 0 found it needed, `tests/e2e/implant-passport.spec.ts`
- Delete: `passport/generate/route.ts` (+ test), `passport/[passportId]/download/route.ts` (+ test), `src/lib/passport/render.ts`, `src/lib/passport/versions.ts` parts no longer used

**Interfaces:**
- Produces SQL: `passport_generations(id, company_id, patient_id → patients on delete cascade, generated_by → profiles, generated_at timestamptz default now(), medical_level text)`; read with `can('patients','view')`; `log_passport_generation(p_patient uuid, p_medical_level text) returns uuid` (`require_perm('patients','view')`, patient in company, medical level in the 0145 set); `patient_history` and the `audit_log_area_read` policy redefined from their latest (0145) definitions to include `passport_generations`.
- Produces route: `GET /patients/[id]/passport/data` → `200 { passport: PassportModel, fileName: string }` / `{ error }` 400/403/404/500, `Cache-Control: no-store`, same-origin check as the old generate route, `requirePermission`-equivalent View check.
- Produces client: `downloadPassport(patientId: string): Promise<void>` in `src/lib/passport/client.ts` (fetch → `import('@react-pdf/renderer')` + `import('./document')` → register fonts from `/passport-fonts/` → `pdf(el).toBlob()` → `<a download>`; revokes the object URL).

- [ ] **Step 1: DB tests (failing):** viewer logs a generation; a user without Patients View refused; delegate login refused; another company's patient refused; rows deleted with `delete_patient`; `patient_history` lists the generation.
- [ ] **Step 2:** Migration; PASS; tenant-isolation list updated.
- [ ] **Step 3: Route tests (failing):** cross-origin → 403; no View → 404; returns the model and logs once; file name `Implant passport <file no> <today>.pdf`.
- [ ] **Step 4:** Implement the route (reuse `loadPassportData` + the model builder; never `render.ts`).
- [ ] **Step 5: Client tests (failing):** `downloadPassport` with mocked `fetch` and mocked dynamic modules creates a Blob link with the given file name; on `{ error }` it throws the message; the button shows "Preparing…" then re-enables, and shows the error in an alert.
- [ ] **Step 6:** Implement the client loader and button; page lists `passport_generations` (who, when, medical level, "records changed since" via the existing `recordsChangedSince`), button visible with View; remove the old routes, `render.ts`, the `next.config.ts` passport entry and its test lines; apply the Task 0 CSP finding.
- [ ] **Step 7: E2E:** rewrite `implant-passport.spec.ts`: a View-only user clicks Generate, the download's bytes start with `%PDF-`, the list shows one generation; the admin setting still changes the medical level shown. Run it; `npm run build` PASS; commit.

### Task 6: Admin pages on phones

**Files:** Modify `src/app/(app)/admin/users/{user-row,edit-name,change-email,reset-google,reset-two-factor,permission-grid}.tsx`, `catalogue/catalogue-form.tsx`, `settings/branding-form.tsx`, `src/app/globals.css` (tabs scroll cue, if needed); `tests/e2e/mobile.spec.ts`.

- [ ] **Step 1: E2E (failing):** in `mobile.spec.ts` (phone project), an admin visits `/admin/users`, `/admin/settings`, `/admin/settings/consent`, `/admin/chairs`, `/admin/doctors`, `/admin/catalogue`, `/admin/screw-sizes` (and supervisors/lecturers): `document.documentElement.scrollWidth <= innerWidth` and every `.card`'s `scrollWidth <= clientWidth + 1`. On Users, a seeded user with a 40-character email is shown, and their Change email panel is opened before measuring.
- [ ] **Step 2:** Run → FAIL on Users/Catalogue.
- [ ] **Step 3:** Fix: wrap the role form (`flex flex-wrap`), `break-all` on emails, drop `pr-4` on cells below `sm`, wrap button pairs, warning boxes `w-full` on phones, permission legend stacked below `sm`, catalogue rows `flex-wrap` with smaller indentation on phones, branding preview wraps.
- [ ] **Step 4:** E2E PASS; look at each page at 360 px in the browser (Claude in Chrome or Playwright screenshot) and fix anything squeezed; commit.

### Task 7: Docs and full verification

- [ ] **Step 1:** Root `CLAUDE.md`: the Implant passport line (browser-built, `passport_generations`, stored tables kept for one release); the Product specs line (screw sizes, `fit_component_v4`). `patients/CLAUDE.md`: passport and component sections. `admin/CLAUDE.md`: Screw sizes.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`, E2E `patients implant-passport mobile` plus the component spec, `npm run build` — all PASS; commit.
- [ ] **Step 3:** Ledger note for the later clean-up PR: drop `patient_passport_files`, `patient_passports`, `passport_downloads`, `save_patient_passport`, `patient_passport_file`, `search_patients` (0098), `fit_component_v3`; remove `patient_passports` from `patient_history`.
