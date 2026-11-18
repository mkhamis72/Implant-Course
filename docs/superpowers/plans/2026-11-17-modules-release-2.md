# Modules release 2: Inventory optional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company whose plan lacks Inventory places implants and fits components from the product catalogue with no stock batch, sees no stock, lots or pull list anywhere, and keeps all its stock data; when Inventory is switched on later, staff can attach a lot to an earlier implant without changing stock.

**Architecture:** Release 1 already gates the `inventory` area through `can()`. This release:
- removes the "Inventory always on" rule;
- closes the two stock tables to company users when Inventory is off, with restrictive `module_on('inventory')` select policies. Every inventory reader (`inventory_overview`, `pull_list`, `search_lots`, `lot_usage`, the reports and the `stock_on_hand` view) is security invoker, so they follow;
- adds module checks to the patient-area definers that touch lots;
- adds a DB guard that fails when a reader of a module's tables skips the check.

The app reads `profile.features` to drop batch pickers and stock surfaces.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 server components/actions, Zod v4, Vitest (unit + DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-modular-design.md`: "Inventory off" and "Inventory switched on later" in Decisions; item 1 of "How it changes the current app"; release 2 of "Delivery".

## Global Constraints

- **Nothing goes online without the owner's go-ahead:** no `git push`, PR, merge, `ship.sh ship`, Vercel or production database action. Local stack only.
- Branch `feat/modules-r2`, created from `feat/modules-r1` (PR #122, not merged yet). Two migrations in `web/supabase/migrations/`: `0111_inventory_optional.sql` (Task 1) and `0112_inventory_optional_lots.sql` (Task 2). 0110 is the latest today.
- Additive and backward compatible. Every existing company is on Full, which includes `inventory`, so nothing changes for them. The previous app version must keep working (it always sends a lot).
- Spec rules:
  - Inventory off = implants picked from the product catalogue only; no lot, no stock movement, no lot recall.
  - Stock tracking starts from the day Inventory is switched on.
  - Attaching a lot later doesn't change stock.
  - Switching off never touches rows.
  - `remove_placement` and `delete_patient` still remove the stock movements of placements made earlier.
- When Inventory is on, behaviour is exactly as today: a placed implant needs a stock batch, and a component with a product needs a batch.
- Feature names: `inventory`, `statistics`, `teaching`. `module_on('inventory')` is the only switch; never test company kind for it.
- Definer conventions (CLAUDE.md): change functions with `create or replace` of the **latest** definition, keeping the signature (no new overloads, no defaulted parameters added). Latest definitions:
  - `place_implant_v3` and `correct_placement_v2`: 0081
  - `fit_component_v2`: 0090
  - `correct_batch`: 0030
  - `my_report`: 0046
  - `console_save_plan`: 0110
  - `app_private.company_features`: 0109
- Copy (exact):
  - lot sent while Inventory is off: `Stock batches are not used in your plan.`
  - attach-later refusal while off: `Inventory is not in your plan.`
  - site detail when Inventory is on and no batch is recorded: `No stock batch recorded`
- Styling: named tokens and shared classes only. No Prettier. Files are CRLF.

## Review Focus

1. **Implant placed while off, then Inventory switched on:** the corrections panel offers "Attach stock batch", attaching leaves that lot's on-hand count unchanged, and the lot then shows on the implant. Covered by Task 2 test `attach later leaves stock unchanged` and the Task 6 E2E.
2. **An implant that already has a lot, viewed while Inventory is off:** no lot text anywhere and no crash on the null embed. Covered by Task 4 test `site details without a readable lot`.
3. **A mistaken implant with a lot removed while Inventory is off:** its stock comes back. Covered by Task 2 test `remove_placement returns stock while inventory is off`.
4. **Delegate portal while Inventory is off:** no lot numbers. Covered by Task 1 test `my_report hides lots when inventory is off`.
5. **Product-only correction on a no-lot implant:** it changes the product and is refused for a non-implant product. Covered by Task 2 tests `product-only correction` / `product-only correction refuses a non-implant`.

---

### Task 1: Database — Inventory switchable, stock tables gated, module guard

**Files:**
- Create: `web/supabase/migrations/0111_inventory_optional.sql`
- Create: `web/tests/db/module-guards.test.ts`, `web/tests/db/modules-inventory.test.ts`
- Modify: `web/tests/db/modules.test.ts`: the "inventory is always on in release 1" test now expects `module_on('inventory')` false for a plan without it.

**Interfaces:**
- Produces (SQL):
  - `app_private.company_features(uuid)`: same body as 0109 **without** the forced `inventory`.
  - `public.console_save_plan(...)`: same as 0110 **without** forcing `inventory` into `modules`.
  - Restrictive select policies, `to authenticated`, using `(select public.module_on('inventory'))`:
    - `stock_lots_module_read` on `public.stock_lots`
    - `stock_movements_module_read` on `public.stock_movements`
  - `public.my_report(...)` (latest 0046, same signature): `lot_no` (and any other `stock_lots` column it returns) is `case when public.module_on('inventory') then … end`.
- Produces (test): `module-guards.test.ts` with a `MODULE_TABLES` map. Two rules:
  - For each feature, every listed table has a RESTRICTIVE SELECT policy whose expression contains `module_on('<feature>')` or `can('<area>'`.
  - Every `public` **security definer** function whose source mentions a listed table contains `module_on('<feature>')`, `can('<area>'` or `require_perm('<area>'`, or is in that feature's `ALLOWED` list with a reason comment.
  - The map:
    - `statistics` / area `research`: `research_exports`, `studies`, `saved_analyses`, `study_courses`.
    - `inventory` / area `inventory`: `stock_lots`, `stock_movements`. ALLOWED:
      - `delete_patient`, `remove_placement` ("ledger purge: deletes the movements of what it removes, whatever the module");
      - `correct_placement_v2` ("reads the implant's own lot expiry only");
      - `place_implant_v3`, `fit_component_v2`, `correct_batch` ("Task 2 adds their module check and removes them from this list").
    - `teaching`: empty list for now, with a comment "release 3".

- [ ] **Step 1: Create the branch.** `git switch -c feat/modules-r2` from `feat/modules-r1`.
- [ ] **Step 2: Failing tests.**
  - `module-guards.test.ts`: the two rules above. Expected RED: `stock_lots` and `stock_movements` have no `module_on` policy, and `my_report` lacks a check.
  - `modules-inventory.test.ts`, on a plan `{statistics}` set for academy inside the rolled-back tx:
    - `inventory off closes stock`: as `users.admin`, `select count(*)` from `stock_lots`, `stock_movements`, `stock_on_hand` → 0 (seed one lot first and check it is visible on Full); `rpc pull_list(cairo_today())` and `inventory_overview('', '', true)` return no rows; `can('inventory','view')` false.
    - `my_report hides lots when inventory is off`: as the delegate login, a placed implant with a lot shows `lot_no` on Full and null with Inventory off.
    - `switching back restores identical stock`: md5 fingerprint of `stock_movements` before off and after on is equal.
    - `a plan without inventory is saved as is`: `console_save_plan(null, 'Zz NoInv', 'course_organizer', '{statistics}', 'x')` stores `{statistics}`.
- [ ] **Step 3:** `npm run test:db -- module-guards modules-inventory modules` → FAIL as described.
- [ ] **Step 4: Write 0111 (part 1)** with the objects above. Dry-run it in a rolled-back transaction first (CLAUDE.md Gotchas).
- [ ] **Step 5:** `npm run test:db -- module-guards modules-inventory modules modules-console permissions one-db-guards tenant-isolation` → PASS.
- [ ] **Step 6: Commit** — "Modules (0111): Inventory can be switched off; stock tables closed and lot numbers hidden when it is; module guard test"

### Task 2: Database — placing, fitting and correcting without lots; attaching a lot later

**Files:**
- Create: `web/supabase/migrations/0112_inventory_optional_lots.sql` (Task 1's `test:db` applied 0111, so it is not edited again)
- Test: `web/tests/db/modules-inventory.test.ts` (extend); `web/tests/db/module-guards.test.ts`: remove `place_implant_v3`, `fit_component_v2`, `correct_batch` from the inventory ALLOWED list; they must now pass on their own module check.

**Interfaces:**
- Produces (SQL, same signatures):
  - Constraint `implant_sites_placed_details`: drop and re-add without `stock_lot_id is not null`; the other conditions stay.
  - `place_implant_v3`:
    - Inventory on: unchanged. `lock_lot`, then `insert_use`; a null lot still fails with `lock_lot`'s "Choose a stock batch."
    - Inventory off: a non-null `p_lot` fails with `Stock batches are not used in your plan.`; a null lot skips `lock_lot`/`insert_use` and stores `stock_lot_id = null`.
  - `fit_component_v2`:
    - Inventory on: unchanged ("Choose the stock batch used." when a product has no lot).
    - Inventory off: a product with no lot is accepted with no stock movement; a non-null lot fails with `Stock batches are not used in your plan.`
  - `correct_batch(p_site, p_new_lot, p_reason, p_component, p_new_product)`: same signature; the paths are decided by (old lot, new lot):
    - old **set**, new **set**: as today (reverse + use). Requires Inventory on, else `Inventory is not in your plan.`
    - old **null**, new **null**: product-only correction. `p_new_product` must differ from the current product and pass the existing product checks (implant, or `component_accepts`). No stock movement.
    - old **null**, new **set**: attach a lot later. Requires Inventory on, else `Inventory is not in your plan.` The lot must exist and match the product (`That stock batch is for a different product.`), and its expiry must not be before the use date (same message as `lock_lot_for_correction`). **No on-hand check and no stock movement.** Sets `stock_lot_id` (and `product_id` when given).
    - old **set**, new **null**: `Choose a different batch.` (a lot is never removed).
    - The existing component branch's "This component was not taken from stock." is replaced by these paths for components with a product and no lot. A component with no product stays refused with that message.

- [ ] **Step 1: Failing tests** in `modules-inventory.test.ts`. "Off" means academy on `{statistics}`; seed a product with `products` of type `implant` and a lot with stock on hand (helpers in `tests/db/fixtures.ts`).
  - `place without a lot while off`: `place_implant_v3(..., p_lot => null, ...)` succeeds; `stock_lot_id` is null; no `stock_movements` row for the site.
  - `a lot is refused while off`: the same call with a lot → `Stock batches are not used in your plan.`
  - `a lot is still required while on`: Full, null lot → `Choose a stock batch.`
  - `component without a lot while off`: `fit_component_v2` with a product and a null lot succeeds and writes no movement.
  - `product-only correction`: an off-placed implant, `correct_batch(site, null, 'wrong size', null, otherImplant)` → `product_id` changed, no movement. `product-only correction refuses a non-implant`: a component product id → `Choose an implant from the catalog.`
  - `attach later leaves stock unchanged`: place while off, switch academy to Full, record `on_hand` of lot L, `correct_batch(site, L, 'lot found', null, null)` → `stock_lot_id = L` and `on_hand` unchanged; switching off and attaching → `Inventory is not in your plan.`
  - `remove_placement returns stock while inventory is off`: place with a lot on Full (on_hand −1), switch off, `remove_placement(site, 'mistake')` → back on Full, `on_hand` restored.
- [ ] **Step 2:** `npm run test:db -- modules-inventory` → FAIL.
- [ ] **Step 3: Write `0112_inventory_optional_lots.sql`** (dry-run first).
- [ ] **Step 4:** `npm run test:db -- modules-inventory module-guards implants components corrections delete permissions one-db-guards tenant-isolation` → PASS (use the existing test file names that cover placement, components, corrections and deletion).
- [ ] **Step 5: Commit** — "Modules (0112): implants and components without stock batches when Inventory is off; correct the product or attach a lot later without changing stock"

### Task 3: App — features helper, forms without batches

**Files:**
- Modify: `web/src/lib/modules/modules.ts` (+ test), `web/src/lib/inventory/schemas.ts` (+ test), `web/src/lib/inventory/types.ts` (`ChartData`), `web/src/app/(app)/patients/[id]/chart-data.ts`, `implant-forms.tsx` (+ test), `implant-picker.tsx`

**Interfaces:**
- Produces:
  - `export function featureOn(features: readonly Feature[], f: Feature): boolean` in `modules.ts`.
  - `ChartData.inventoryOn: boolean`, set from `featureOn(me.features, 'inventory')` in `chart-data.ts`.
  - `placeSchema.lotId` becomes optional (`optionalUuid`); the database decides when a batch is required. `componentSchema` drops its "product needs a batch" refine for the same reason.
- Behaviour when `!data.inventoryOn`:
  - Place and component forms render no `BatchSelect` and no receive-stock panel.
  - `ImplantPicker` gets `stockFilter={false}`: no "in stock" filter or on-hand counts, every active implant is listed.
  - The submitted `lotId` is null.
  - When on: exactly as today.

- [ ] **Step 1: Failing tests:**
  - `modules.test.ts` `featureOn`.
  - `schemas.test.ts`: `placeSchema` accepts no `lotId`; `componentSchema` accepts a product without a lot.
  - `implant-forms.test.tsx` (create if absent, following the folder's component-test pattern): with `inventoryOn: false` the place form shows no "Stock batch" group, and submitting calls the action with `lotId: null`; with `inventoryOn: true` the batch group shows.
- [ ] **Step 2:** `npm test -- modules schemas implant-forms` → FAIL.
- [ ] **Step 3: Implement.** Add a `stockFilter: boolean` prop to `ImplantPicker` (true keeps today's behaviour). Fixture `ChartData` objects in tests gain `inventoryOn: true`.
- [ ] **Step 4:** `npm test -- modules schemas implant-forms implant-picker`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Patients: place and fit from the catalogue when Inventory is off"

### Task 4: App — corrections and site details

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/corrections.tsx` (+ test), `site-details.tsx` (+ test), `implant-actions.ts` (correction action passes a null `newLotId`)

**Interfaces:**
- Consumes: `ChartData.inventoryOn` (Task 3); the `correct_batch` paths (Task 2).
- The batch-correction panel offers per implant or component:
  - **Inventory off**, record without a lot: "Correct product" (product select, reason) → `newLotId: null`. A record that has a lot (made earlier) offers nothing.
  - **Inventory on**, record without a lot: "Attach stock batch" (lot select from `data.lots` for that product, **including lots with 0 on hand**, excluding lots expired before the use date; plus a reason). It also offers "Correct product".
  - **Inventory on**, record with a lot: today's batch correction, unchanged.
- `site-details.tsx`: lot line as today when `site.lot` is set. When Inventory is on and `site.stock_lot_id` is null → `No stock batch recorded`. When Inventory is off → no lot line at all, even if `site.lot` were set.

- [ ] **Step 1: Failing tests:**
  - `corrections.test.tsx`: the three cases above render the right control.
  - `site-details.test.tsx` `site details without a readable lot`: `inventoryOn: false`, a site with `stock_lot_id` set and `lot: null` renders no "Lot" text and doesn't throw. With `inventoryOn: true` and `stock_lot_id: null` it shows `No stock batch recorded`.
- [ ] **Step 2:** `npm test -- corrections site-details` → FAIL.
- [ ] **Step 3: Implement**, reusing `correctionLots` with an `includeEmpty` flag for the attach case.
- [ ] **Step 4:** `npm test -- corrections site-details implant-actions`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Patients: correct the product without a batch; attach a stock batch later"

### Task 5: App — stock surfaces outside Patients; console switch

**Files:**
- Modify:
  - `web/src/app/(app)/page.tsx`: the "Stock shortages for surgeries" card needs `canView(profile, 'inventory')` as well as its current condition.
  - `web/src/app/(app)/schedule/pull-list/page.tsx`: redirect to `/schedule` when `!featureOn(profile.features, 'inventory')`.
  - `web/src/app/(app)/schedule/page.tsx`: hide the "Pull list" link under the same condition.
  - `web/src/app/(app)/courses/[id]/report/page.tsx`: hide the Lot column when Inventory is off. CSVs keep their Lot column, empty, so the file format stays stable (my call).
  - `web/src/app/(app)/delegates/[id]/page.tsx`: the same, if it shows lots.
  - Console: `web/src/app/console/(admin)/plans/plan-form.tsx` and `companies/[slug]/forms.tsx`. Inventory is an ordinary checkbox; remove `ALWAYS_ON` and the hard-coded `'inventory'` branch; keep `LATER` (Clinic) for release 3, defined once in `src/lib/modules/modules.ts` as `export const KIND_AVAILABLE: Record<CompanyKind, boolean> = { course_organizer: true, clinic: false }`.
  - Their tests.

- [ ] **Step 1: Failing tests:**
  - Dashboard: if there is no dashboard component test, cover it with the E2E in Task 6 instead and say so.
  - Pull-list redirect via a page test, or E2E.
  - Console `plan-form` / `PlanFields`: the Inventory checkbox is enabled and unticking it submits without `module_inventory`.
  - Course report page: no "Lot" header when Inventory is off.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Inventory off: no pull list, stock cards or lot columns; the console can switch Inventory"

### Task 6: End-to-end

**Files:**
- Create: `web/tests/e2e/inventory-off.spec.ts`

Follow the release-1 `modules.spec.ts` pattern: academy is switched by SQL to a plan `E2E NoInventory <unique>` with `{statistics}`, and `afterAll` sets academy back to Full and deletes the plan, in `finally`. Use `seedProduct` / `seedImplantStock` and `chooseImplant(page, brand, 'Ø4.0 × 10 mm')` from `implants.spec.ts` / `tests/e2e` helpers.

- [ ] **Step 1: Write the tests:**
  - `Inventory disappears`: as admin, the nav has no `Inventory`; `/inventory` and `/schedule/pull-list` end elsewhere; the dashboard shows no "Low stock" or "Stock shortages" card.
  - `place an implant from the catalogue`: on a new `uniqueName()` patient, place an implant choosing the brand and size only (no batch step) → the implant shows as placed with no lot text. Via `withPg`, the site has `stock_lot_id` null and no `stock_movements` row.
  - `attach a batch later`: switch academy to Full, `page.reload()`, open the implant's corrections, then "Attach stock batch". Choose the seeded lot, give a reason and save. The lot shows on the implant, and `stock_on_hand` for that lot is unchanged (`withPg` before and after).
- [ ] **Step 2: Run** `npx playwright test inventory-off implants modules --project=chromium`. Check memory and :3000 first, and stop any server you start. Expected: PASS.
- [ ] **Step 3: Commit** — "E2E: Inventory switched off by plan; attach a batch later"

### Task 7: Local verification and docs (no release)

- [ ] **Step 1:** `./scripts/ship.sh verify inventory-off implants modules console` (the `verify` subcommand only). If memory kills the E2E part, run the specs in parts. Also run, in parts: `npx playwright test schedule slot-placement components corrections --project=chromium`, using the spec names that exist and that touch placement, components and the pull list. Then `npm run isolation:check` on the local stack → 0.
- [ ] **Step 2: Docs.**
  - Repo-root `CLAUDE.md`, Modules paragraph:
    - Inventory is switchable (0111/0112);
    - stock tables are closed by `module_on('inventory')`;
    - the place/fit/correct rules when off, and attaching a lot later;
    - `tests/db/module-guards.test.ts` (and add new module tables to it);
    - remove "Inventory stays on until release 2".
  - `web/src/app/(app)/patients/CLAUDE.md`: one line under the implant picker / receiving stock section on catalogue-only placement when Inventory is off.
  - Commit "Docs: Inventory optional".
- [ ] **Step 3: Stop.** Report the branch, what was verified, and that both PR #122 and this branch wait for the owner.
