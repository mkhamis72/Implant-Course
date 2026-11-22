# Components, screws and screwdrivers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record several components per implant by role (healing, abutment, abutment screw, prosthetic screw, impression/scan), with product specs (connection, GH, angle, material, screwdriver, recommended torque) stored once, actual torque per fitting, replacement history and stock use.

**Architecture:** Extend `site_components` (roles via `app_private.component_role`, one current per role, `replaced_by` link so a void reopens exactly what a fitting closed) behind a new `fit_component_v3`; add spec columns to `products` and `catalog_items` (library values flow to linked products by trigger); the app's Component form, implant panel and product form show them.

**Tech Stack:** Postgres plpgsql (Supabase local stack), Next.js 15 server actions, Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-component-tracking-design.md`

## Global Constraints
- Never edit an applied migration; new ones are `0133`… in `web/supabase/migrations/`. Dry-run each in a rolled-back transaction (`pgConfig()` script, `NODE_PATH=web/node_modules`) before the first `npm run test:db`.
- A new enum value cannot be used in the migration that adds it: `0133` only adds values.
- Definers: `security definer set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, errors via `app_private.fail(...)`, `revoke … from public, anon` / `grant … to authenticated`, owner `tenant_definer` (`grant create on schema public, app_private to tenant_definer; alter function … owner to tenant_definer; revoke create …`). Every new public definer goes in the allow-list in `tests/db/permissions.test.ts`.
- `fit_component_v2` stays (previous app version calls it for a few minutes during release); app calls only `fit_component_v3`. No defaulted-parameter overloads.
- Place implant form, `place_implant_v4`, restoration form and `add_restoration` are unchanged.
- Stock: product chosen + Inventory on → lot required, one `insert_use`; Inventory off → no lot (`'Stock batches are not used in your plan.'`). Screwdrivers are never stock.
- Clinic (`teachingOn` false): delegate/course refused as in v2 (`'Courses, delegates and supervisors are not used in your plan.'`).
- Torque range 0–150 Ncm (same as `implant_sites.torque_ncm`); angle 0–45°; gingival height 0–10 mm.
- UI copy in plain English; use design tokens and shared classes (root `CLAUDE.md` Styling). Files are CRLF; write files containing `\` with Write/Edit tools.

## Review Focus
1. Voiding an abutment that closed a healing abutment (and its screw) must reopen exactly those rows — and nothing else. → Task 3 test `void reopens what the fitting closed`.
2. Existing data (rows fitted by v2, one current per site, no `replaced_by`) must still void correctly → Task 3 test `void of a v2 fitting reopens the previous row of the same role group`.
3. A prosthetic screw pointing at a restoration that does not include this implant, or at another site's abutment, is refused → Task 3 tests `screw must hold this site's abutment` / `restoration must include the site`.
4. A spec value edited on a library-linked product is refused, but a library update reaches linked products → Task 2 tests.
5. Scan body / impression coping fittings never appear as current and never block another fitting → Task 3 test `transfer rows are never current`.

---

### Task 1: Enum values (0133)

**Files:**
- Create: `web/supabase/migrations/0133_component_roles_enums.sql`
- Test: `web/tests/db/component-tracking.test.ts` (new)

- [ ] **Step 1: Failing test** `describe('component tracking (0133–0135)')` → `it('has the new component and product types')`: query `enum_range(null::public.component_type)` and `enum_range(null::public.product_type)`; expect component types to contain `healing_cap, temporary_abutment, scan_body, impression_coping, abutment_screw, prosthetic_screw, temporary_cylinder_screw`, product types to contain `healing_cap, temporary_abutment, abutment_screw`.
- [ ] **Step 2: Dry-run** then run `npm run test:db -- component-tracking` → FAIL (values missing).
- [ ] **Step 3: Migration** — only `alter type public.component_type add value if not exists '…';` × 7 and `alter type public.product_type add value if not exists '…';` × 3, header comment naming 0134/0135 as the users.
- [ ] **Step 4:** `npm run test:db -- component-tracking` → PASS.
- [ ] **Step 5: Commit** `Component tracking: new component and product types (0133)`.

### Task 2: Product specs (0134)

**Files:**
- Create: `web/supabase/migrations/0134_product_specs.sql`
- Test: `web/tests/db/component-tracking.test.ts`

**Interfaces — Produces:** columns on both `public.products` and `public.catalog_items`: `connection text not null default ''` (≤ 60), `gingival_height_mm numeric(3,1)` (0–10), `angle_deg numeric(4,1)` (0–45), `material text not null default ''` (≤ 60), `driver_interface text not null default ''` (≤ 60), `driver_size text not null default ''` (≤ 30), `driver_ref text not null default ''` (≤ 60), `torque_ncm numeric(5,1)` (0–150). Grant UPDATE on the new `products` columns to `authenticated` alongside the existing product column grants (find them in the latest migration granting products update).

- [ ] **Step 1: Failing tests:**
  - `it('stores specs on a hand-entered product')` — as organizer, update a non-linked product's 8 spec columns; read back equal.
  - `it('refuses spec changes on a library-linked product')` — linked product, `update … set driver_size = 'x'` → error `This product comes from the catalogue library, so only its reorder level and Active can change.`
  - `it('copies library specs when an item is switched on')` — as postgres set specs on a `catalog_items` row, admin calls `save_catalogue(p_items_on => [id], …)`; the new product has the same 8 values.
  - `it('a library update reaches linked products')` — as postgres update a linked item's `torque_ncm` to 35; the company product reads 35.
  - `it('refuses an angle of 60')` — check violation.
- [ ] **Step 2:** dry-run, run → FAIL.
- [ ] **Step 3: Migration:** add columns + checks; `create or replace app_private.protect_catalog_product()` adding the 8 columns to the locked tuple **except** when they equal the linked `catalog_items` row's values (so the sync passes); `create or replace public.set_catalog_items` (latest body in 0132) inserting the 8 spec columns from `v_item`, and on linking an existing hand-entered copy also setting them; new trigger `catalog_items_specs_sync` (`after update of <8 columns> on catalog_items`, function `app_private.sync_catalog_specs()` owned by `tenant_definer`) updating `products` where `catalog_item_id = new.id`.
- [ ] **Step 4:** `npm run test:db -- component-tracking catalogue-library catalog` → PASS.
- [ ] **Step 5: Commit** `Product specs: connection, GH, angle, material, screwdriver, torque (0134)`.

### Task 3: Component roles, fit_component_v3, void (0135)

**Files:**
- Create: `web/supabase/migrations/0135_component_tracking.sql`
- Modify: `web/tests/db/permissions.test.ts` (allow-list `fit_component_v3`)
- Test: `web/tests/db/component-tracking.test.ts`; existing `components.test.ts`, `stock.test.ts` stay green

**Interfaces — Produces:**
- `site_components` columns: `torque_ncm numeric(5,1)` (0–150), `holds_component_id uuid` (FK `site_components(id)`), `holds_restoration_id uuid` (FK `restorations(id)`), `replaced_by uuid` (FK `site_components(id)`; set on a row closed by a later fitting).
- `app_private.component_role(public.component_type) returns text immutable`: cover_screw/healing_abutment/healing_cap → `'healing'`; ti_base/multi_unit/abutment/temporary_abutment → `'abutment'`; abutment_screw → `'abutment_screw'`; prosthetic_screw/temporary_cylinder_screw → `'prosthetic_screw'`; scan_body/impression_coping → `'transfer'`; final_restoration → `'legacy'`.
- Index: drop `site_components_one_current`; create unique `site_components_one_current_role on (site_id, app_private.component_role(component_type)) where removed_on is null`.
- `app_private.component_accepts` (create or replace): new pairs healing_cap→healing_cap, temporary_abutment→temporary_abutment, scan_body→scan_body, impression_coping→impression_coping, abutment_screw→abutment_screw, prosthetic_screw→prosthetic_screw, temporary_cylinder_screw→prosthetic_screw.
- `public.fit_component_v3(p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid, p_by_delegate uuid, p_by_organizer uuid, p_notes text, p_course uuid, p_torque numeric, p_holds_component uuid, p_holds_restoration uuid) returns uuid` — all v2 checks (0117 body), plus:
  - refuse `final_restoration` (`'Record crowns and bridges in the Restoration tab.'`);
  - `p_torque` null or 0–150 (`'Enter a torque between 0 and 150 Ncm.'`);
  - abutment_screw: `p_holds_component` must be this site's current abutment-role row (`'Choose the abutment this screw holds.'`); prosthetic screws: exactly one of `p_holds_component` (this site's current abutment) or `p_holds_restoration` (a non-voided, not-ended restoration with a `restoration_sites` row for this site) (`'Choose what this screw holds.'`); other roles: both null (`'Only screws hold another part.'`);
  - closing: rows current in the same role; for healing also the current abutment-role row and vice versa; when an abutment-role row closes, also its current abutment_screw. Each closed row: `removed_on = p_fitted_on, replaced_by = <new id>` (insert first with a generated id, then close);
  - transfer: insert with `removed_on = p_fitted_on`, close nothing;
  - `insert_use` exactly as v2.
- `public.void_component(p_component uuid, p_reason text)` (create or replace, 0089 body): only a current row (unchanged message); reopen rows with `replaced_by = p_component` (clear `replaced_by`); if none and the row has no `replaced_by` history (a v2 fitting), reopen the latest non-voided row of the same role group (healing and abutment count as one group, as v2 had one slot); refuse while a current screw holds it (`'Undo the screw that holds this part first.'`).

- [ ] **Step 1: Failing tests** (fixtures: `place` from `tests/db/fixtures.ts`, a product per type, Inventory on unless stated):
  - `it('abutment closes the healing abutment and records what replaced it')`
  - `it('abutment, abutment screw and prosthetic screw are current together')`
  - `it('replacing a prosthetic screw keeps the old one, closed, with replaced_by')`
  - `it('replacing the abutment closes its abutment screw')`
  - `it('screw must hold this site\'s abutment')` (other site's abutment → `Choose the abutment this screw holds.`)
  - `it('restoration must include the site')` (restoration on another implant → `Choose what this screw holds.`)
  - `it('transfer rows are never current')` (scan body then impression coping, both `removed_on = fitted_on`, healing abutment still current)
  - `it('void reopens what the fitting closed')` (healing → abutment + screw → void screw, void abutment → healing current again, abutment screw stays voided)
  - `it('void of a v2 fitting reopens the previous row of the same role group')` (two `fit_component_v2` calls, void the second)
  - `it('refuses to void a part a current screw holds')`
  - `it('uses stock once per fitting with Inventory on and none with it off')` (count `stock_movements` reason `use` for the component)
  - `it('records torque and refuses 200 Ncm')`
  - `it('v2 still fits a component')`
- [ ] **Step 2:** dry-run, `npm run test:db -- component-tracking` → FAIL.
- [ ] **Step 3:** write the migration; add `'fit_component_v3'` to the permissions allow-list.
- [ ] **Step 4:** `npm run test:db` (full) → all pass.
- [ ] **Step 5: Commit** `Components by role: fit_component_v3, screws, replacement history (0135)`.

### Task 4: Domain helpers and schemas (TS)

**Files:**
- Modify: `web/src/lib/inventory/types.ts`, `web/src/lib/inventory/components.ts`, `web/src/lib/inventory/schemas.ts`
- Create: `web/src/lib/inventory/specs.ts`
- Test: `components.test.ts`, `schemas.test.ts`, new `specs.test.ts` beside them

**Interfaces — Produces:**
- `COMPONENT_TYPES` gains the 7 types (keep `final_restoration` last); `COMPONENT_LABELS` (`healing_cap: 'Healing cap'`, `temporary_abutment: 'Temporary abutment'`, `scan_body: 'Scan body'`, `impression_coping: 'Impression coping'`, `abutment_screw: 'Abutment screw'`, `prosthetic_screw: 'Prosthetic screw'`, `temporary_cylinder_screw: 'Temporary cylinder screw'`); `COMPONENT_BADGES` gains `healing_cap: 'HC'`, `temporary_abutment: 'TA'` (the others map to `''`); `PRODUCT_TYPES`/labels gain `healing_cap`, `temporary_abutment`, `abutment_screw`.
- `export type ComponentRole = 'healing' | 'abutment' | 'abutment_screw' | 'prosthetic_screw' | 'transfer' | 'legacy'`; `componentRole(t: ComponentType): ComponentRole` (mirror of SQL); `COMPONENT_ROLE_LABELS`.
- `currentComponents(site: ImplantSite): SiteComponent[]` (non-voided, `removed_on === null`, ordered healing, abutment, abutment_screw, prosthetic_screw); `currentComponent` stays (now = current healing or abutment row) for existing callers; `badgesFor` uses the current healing/abutment row's badge.
- `SiteComponent` gains `torque_ncm: number | null`, `holds_component_id`, `holds_restoration_id`, `replaced_by: string | null`; `Product` gains the 8 spec fields.
- `specs.ts`: `productSpecs(p: Product): { label: string; value: string }[]` — only filled specs, labels `Connection`, `Gingival height` (`3.0 mm`), `Angle` (`17°`), `Material`, `Screwdriver` (`Hex 1.25 mm · ref ABC`), `Recommended torque` (`25 Ncm`); `specsLine(p: Product): string` joins them with ` · `, `''` when none.
- `productSchema` gains the 8 fields (optional; numbers via `optionalNumber` with the Global ranges, messages `Enter a gingival height between 0 and 10 mm.`, `Enter an angle between 0 and 45°.`, `Enter a torque between 0 and 150 Ncm.`); `componentSchema` gains `torque` (optional, same torque message), `holdsComponentId`, `holdsRestorationId` (optionalUuid) and refines: screws need one holder (`Choose what this screw holds.`), abutment_screw only `holdsComponentId`.

- [ ] **Step 1: Failing tests:** `componentRole` table for all 13 types; `currentComponents` ordering with a closed and a voided row present; `badgesFor` shows `MUA` when an abutment screw is also current; `specsLine` of a product with driver + torque = `'Screwdriver: Hex 1.25 mm · Recommended torque: 25 Ncm'` and `''` for none; schema refusals above.
- [ ] **Step 2:** `npm test -- inventory` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm test -- inventory` and `npx tsc --noEmit` → PASS (fix type fallout in callers by using the new fields, no behaviour change yet).
- [ ] **Step 5: Commit** `Component roles and product specs in the app's domain helpers`.

### Task 5: Product form specs and catalogue loader columns

**Files:**
- Modify: `web/src/app/(app)/inventory/products/product-form.tsx`, `…/products/actions.ts`, `…/products/[id]` edit page, `web/scripts/catalog-library.ts`
- Test: `product-form.test.tsx`, `scripts/catalog-library.test.ts`, `tests/e2e/inventory.spec.ts`

**Interfaces — Consumes:** Task 2 columns, Task 4 `productSchema`, `productSpecs`.
- Product form: a `Specifications` fieldset after Description: Connection, Gingival height (mm), Angle (°), Material, Screwdriver interface, Screwdriver size, Screwdriver ref, Recommended torque (Ncm). Linked products: the fieldset is shown read-only (text list from `productSpecs`), like their other catalogue fields.
- Loader: `HEADER` stays valid; 8 optional trailing columns `Connection, Gingival height (mm), Angle (°), Material, Driver interface, Driver size, Driver ref, Torque (Ncm)`; numeric ones validated like `size()` (0132): `Row N: Torque (Ncm) is not a number: "x"`; a file without them still loads.

- [ ] **Step 1: Failing tests:** form renders the 8 inputs and submits them; linked product shows `Screwdriver: Hex 1.25 mm`; loader parses a row with specs, rejects `Torque (Ncm)` = `abc`, accepts the old 9-column header.
- [ ] **Step 2:** `npm test -- product-form catalog-library` → FAIL.
- [ ] **Step 3:** implement (action passes the 8 fields to the insert/update).
- [ ] **Step 4:** tests PASS; extend `inventory.spec.ts`: create a product with screwdriver + torque, reopen it, values kept.
- [ ] **Step 5: Commit** `Product form and catalogue loader carry specifications`.

### Task 6: Component form, implant panel, corrections, history

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/implant-forms.tsx` (`ComponentForm`), `implant-actions.ts` (`fitComponent` → `fit_component_v3`), `chart-data.ts` (`SITE_SELECT` components: add `torque_ncm, holds_component_id, holds_restoration_id, replaced_by`), `site-details.tsx` (component list), `corrections.tsx` (void any current component), `web/src/lib/patients/history.ts`
- Test: component tests beside each file, `history.test.ts`, `tests/e2e/implants.spec.ts`

**Interfaces — Consumes:** Task 3 RPC signature, Task 4 helpers.
- `ComponentForm`: type select grouped by role (`<optgroup label="Healing">` …); product list filtered by `COMPONENT_ACCEPTS`; after choosing a product show `specsLine(product)` (muted line); `Torque (Ncm)` input; for screw types a required `Holds` select listing the site's current abutment-role row (`Multi-unit abutment — 3 Nov`) and, for prosthetic screws, the site's current restorations (`Full arch 15–25 (final)`). Hidden for non-screws.
- `site-details.tsx`: replace the single-stage timeline's "current" with a **Current parts** list (one line per `currentComponents` row: label, product label, `specsLine`, `Torque: 25 Ncm` when set, holder) and the existing **Component history** list gains `— replaced on <date>` for rows with `replaced_by`. Transfer rows appear only in history (`Scan body — used 3 Nov`).
- `corrections.tsx`: "Undo component" offers a select of current components (default: the latest fitted) instead of only `currentComponent`.
- `history.ts`: `site_components` labels for `torque_ncm: 'torque'`, `holds_component_id`/`holds_restoration_id: 'holds'`; new component type labels come from `COMPONENT_LABELS`.

- [ ] **Step 1: Failing tests:** ComponentForm — choosing `Prosthetic screw` shows `Holds` with the restoration option and the action receives `holdsRestorationId`; choosing a product with specs shows `Screwdriver: Hex 1.25 mm`; torque 200 → `Enter a torque between 0 and 150 Ncm.`. SiteDetails — MUA + abutment screw + prosthetic screw all listed under Current parts with torque; replaced screw in history with `replaced on`. Corrections — two current parts → select lists both. History — torque change described as `torque`.
- [ ] **Step 2:** `npm test -- patients` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`, `npm test` → PASS.
- [ ] **Step 5: E2E** in `implants.spec.ts`: place an implant, fit multi-unit (torque 30), abutment screw holding it, add a full-arch/bridge or single crown restoration, prosthetic screw holding it (torque 15), replace the prosthetic screw; panel shows three current parts and the replaced screw in history; with a product whose driver is set, the specs line shows. Run with a self-started dev server: `npx playwright test implants inventory --project=chromium` → PASS.
- [ ] **Step 6: Commit** `Component form and implant panel: parts by role, screws, torque, specs`.

### Task 7: Docs

**Files:** `web/src/app/(app)/patients/CLAUDE.md` (components bullet: roles, v3, replaced_by, holds), `web/src/app/(app)/admin/CLAUDE.md` or the inventory notes (product specs, library sync), root `CLAUDE.md` (one line under Catalogue library: specs + CSV columns; app calls `fit_component_v3`, v2 kept one release).

- [ ] **Step 1:** edit docs; `npx tsc --noEmit && npm run lint && npm test && npm run test:db` → all green.
- [ ] **Step 2: Commit** `Docs: component tracking`.
