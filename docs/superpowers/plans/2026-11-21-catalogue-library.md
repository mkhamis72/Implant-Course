# Product catalogue library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared library of ready-made product catalogues (Oxy first) and an Admin → Catalogue page where each company's admin switches on only the products it uses, so dropdowns show those alone.

**Architecture:** A global `public.catalog_items` table (no `company_id`, read-only to users, loaded from CSV). Switching an item on gives the company its own `products` row linked by `catalog_item_id`; switching off sets `active = false`. Every existing reference (stock, implants, components, reports) keeps pointing at company rows. Pickers already read only active products; placing accepts a switched-off product only when it is the one planned (or a spare) for that tooth.

**Tech Stack:** Postgres plpgsql migration, Next.js 15 server components + server actions, Vitest (unit, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-catalogue-library-design.md`

## Global Constraints

- All commands run from `web/`. Branch `feat/catalogue-library` (exists, holds the spec).
- One new migration: `web/supabase/migrations/0128_catalogue_library.sql`. Never edit an applied migration. It must be backward-compatible with the previous app version (add only; `create or replace` keeping signatures).
- Definer functions: `security definer set search_path = ''`, explicit `revoke … from public, anon` / `grant … to authenticated`. Business errors via `app_private.fail('…')`.
- Admin-only writers use the 0118 pattern: `perform app_private.require_active();` then `if not public.is_admin() then perform app_private.fail('Only an admin can do this.'); end if;` and are added to the allow-list in `tests/db/permissions.test.ts` with a comment `// Catalogue library (0128): admin-only writers.`
- Switching on/off only changes what dropdowns offer for **new** choices. Already planned, placed and in-stock items keep working and keep showing.
- New companies start with **no products**.
- No invented reference codes: the library holds only `docs/catalog/oxy-catalog.csv` rows.
- Copy (exact):
  - Page title `Catalogue`; intro `Switch on the products your centre uses. Switched-off products are hidden from booking, the implant chart and receiving stock.`
  - Hand-entered group heading `Your own products`.
  - Save result `Saved: {n} switched on, {m} switched off.`
  - Empty pickers: `No products switched on yet. An admin chooses them in Admin → Catalogue.`
  - Linked product note: `From the catalogue library.`
  - Retired item: `No longer in the catalogue`; refused switch-on: `This product is no longer in the catalogue.`
  - Locked fields refused: `This product comes from the catalogue library, so only its reorder level and Active can change.`
- Styling with the named tokens and shared classes (`.card`, `.btn`, `.input`, `.label`, `.page-header`); no raw palette colours. No Prettier.

## Review Focus

1. **A switched-off implant planned on a booking is placed** → placing succeeds and the placement dropdown shows it preselected (Task 3 tests both).
2. **Admin switches on an item the company already has as an unlinked, slightly edited Oxy row** → the existing row is linked and activated; no second row appears (Task 2 test `reuses an unlinked row with the same brand, type and ref code`).
3. **Admin of company A switches items** → company B's products are untouched, and a non-admin (organizer with Inventory Edit) is refused (Task 2 tests).
4. **Running the loader on `oxy-catalog.csv` right after the migration** → 0 added, 0 updated, 0 retired (Task 4 test against the migrated stack).
5. **A brand row ticked when some of its items are retired** → retired items are neither switched on nor counted in "n of m" (Task 5 unit test `ignores retired items in counts and brand ticks`).

---

### Task 1: Library table, link column, backfill, locked fields, provisioning

**Files:**
- Create: `web/supabase/migrations/0128_catalogue_library.sql` (this task writes the table, column, seed, backfill, trigger and `provision_company`; Tasks 2 and 3 append their functions to the same file before the first `test:db` that applies it — see the note below)
- Create: `web/tests/db/catalogue-library.test.ts`
- Modify: `web/tests/db/one-db-provision.test.ts:36-43,60` (new companies get no products)
- Modify: `web/tests/db/permissions.test.ts` (`shared` set: add `'catalog_items'` with comment `// Catalogue library (0128): global, read-only to company users.`)
- Modify: `docs/operations.md` §D restore `TRUNCATE` (add `public.catalog_items`)

**Note on the single migration:** write all of 0128 (Tasks 1–3) as one file, but develop each task's part by dry-running it in a rolled-back transaction (CLAUDE.md Gotchas: a small `tsx` script with `pgConfig()`) and run `npm run test:db` only once the whole file is written (end of Task 3).

**Interfaces:**
- Produces: table `public.catalog_items(id uuid pk, type product_type, brand text, system text, platform text, diameter_mm numeric(4,2), length_mm numeric(4,1), ref_code text, description text, source text not null default '', retired boolean not null default false, created_at timestamptz)`, unique `nulls not distinct (brand, ref_code, type, diameter_mm, length_mm)`; select granted to `authenticated` (policy `using (true)`), nothing else. Column `public.products.catalog_item_id uuid null references public.catalog_items(id)`, unique index `products_company_catalog_item_key (company_id, catalog_item_id) where catalog_item_id is not null`. Not granted for insert/update to `authenticated` (column grants of 0008 stay as they are).
- Produces: trigger `products_catalog_locked` (before update, `app_private.protect_catalog_product()`), raising the locked-fields copy when `old.catalog_item_id is not null` and any of `type, brand, system, platform, diameter_mm, length_mm, ref_code, description` changes.

- [ ] **Step 1: Write the failing DB tests** in `catalogue-library.test.ts` (use `withTx`, `actAs`, `asPostgres`, `inject('testUsers')`, `ACADEMY_ID` as other one-db tests do):
  - `seeds the library from the Oxy CSV`: `select count(*) from public.catalog_items where brand = 'Oxy Implant' and not retired` equals the number of data rows in `../docs/catalog/oxy-catalog.csv` (count non-empty lines minus the header).
  - `links academy's Oxy products`: every academy product with brand `Oxy Implant` and `not is_sample` has `catalog_item_id` not null.
  - `leaves academy's Oxy products active`: academy's active, linked Oxy count equals the library count.
  - `refuses changing a linked product's catalogue fields`: as organizer, `update public.products set ref_code = 'X' where id = <linked>` fails with the locked-fields copy; `set reorder_level = 5` and `set active = false` succeed.
  - `catalog items are readable and not writable by users`: as organizer, select works; insert/update/delete fail with permission denied.
  - `provision_company starts a company with no products` (in `one-db-provision.test.ts`: replace the copy assertions with `count(*) from public.products where company_id = <new>` = 0).
- [ ] **Step 2: Dry-run the test file against the stack** without 0128: `npm run test:db -- catalogue-library` → FAIL (relation `catalog_items` does not exist). (This applies no migration because 0128 does not exist yet.)
- [ ] **Step 3: Write 0128 part 1:** create the table, grants, policy, audit trigger (`app_private.audit_row()` as other tables); seed with an `insert … select from (values …)` generated from `oxy-catalog.csv` (type label → enum via `PRODUCT_TYPE_LABELS` inverse; `source` = CSV `Source`; generate the values block with a throwaway Node script in the scratchpad, commit only the SQL); add `products.catalog_item_id` + unique index + FK index; backfill: `update public.products p set catalog_item_id = i.id from public.catalog_items i where p.catalog_item_id is null and p.brand = i.brand and p.type = i.type and ((i.ref_code <> '' and p.ref_code = i.ref_code) or (i.ref_code = '' and (p.system, p.platform, p.diameter_mm, p.length_mm, p.ref_code) is not distinct from (i.system, i.platform, i.diameter_mm, i.length_mm, i.ref_code)))` — guard duplicates per company by linking only the oldest matching product per `(company_id, item)` (`distinct on (company_id, i.id) … order by created_at, id`); trigger `products_catalog_locked`; `create or replace function public.provision_company(text, text)` = 0095's body without the `insert into public.products …` statement, then re-run 0095's `alter function … owner to postgres`, `revoke all … from public, anon, authenticated, tenant_definer`, `grant execute … to service_role`.
- [ ] **Step 4: Dry-run 0128 part 1** in a rolled-back transaction (scratchpad `tsx` script reading the file, `begin; <sql>; rollback;`). Expected: no error; print `select count(*) from public.catalog_items` and the academy linked count, both equal to the CSV row count.
- [ ] **Step 5: Update `permissions.test.ts` shared set and `docs/operations.md` §D TRUNCATE.**
- [ ] **Step 6: Commit** (tests + migration part 1 + docs): `git commit -m "Catalogue library: global catalog_items seeded from the Oxy CSV, products linked, new companies start empty (0128)"`.

### Task 2: Switch items and own products on or off

**Files:**
- Modify: `web/supabase/migrations/0128_catalogue_library.sql` (append)
- Modify: `web/tests/db/catalogue-library.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (definer allow-list)

**Interfaces:**
- Produces: `public.set_catalog_items(p_item_ids uuid[], p_on boolean) returns int` (rows changed). On: per item, linked row → `active = true`; else an unlinked row of the company with same `brand`, `type` and non-empty `ref_code` → link it and activate (oldest one); else insert a product copied from the item (`reorder_level` 0, `active` true, `is_sample` false, `catalog_item_id`). A retired item → `fail('This product is no longer in the catalogue.')`. Off: linked rows → `active = false`. Unknown ids → `fail('Product not found.')`. Admin-only (Global Constraints pattern).
- Produces: `public.set_products_active(p_product_ids uuid[], p_on boolean) returns int`, admin-only, updates `active` on the given rows of the caller's company (RLS scope; ids of another company change nothing and count 0).

- [ ] **Step 1: Write failing tests:**
  - `switches an item on by creating a linked product` (item not yet in a fresh provisioned company: use `provision_company` in the tx, act as that company's admin — follow `one-db-provision.test.ts` for creating its admin; or delete academy's link for one item first) → returns 1, row exists, active, linked.
  - `switching on again changes nothing` → returns 0 for an already-active linked item.
  - `reuses an unlinked row with the same brand, type and ref code` → after nulling `catalog_item_id` and changing `description` on academy's row as postgres, switch on → same product id linked, no new row.
  - `switches off without deleting` → active false, row still there, its stock lots and implant sites untouched.
  - `refuses a retired item` → copy above.
  - `refuses a non-admin` → organizer (Edit everywhere) gets `Only an admin can do this.`
  - `leaves other companies alone` → company-b's products unchanged after academy admin calls both functions with all ids.
  - `set_products_active toggles own rows only`.
- [ ] **Step 2: Dry-run the tests** — FAIL (functions missing).
- [ ] **Step 3: Append both functions to 0128** with grants; add both names to the permissions allow-list.
- [ ] **Step 4: Dry-run the appended SQL** in a rolled-back transaction. Expected: no error.
- [ ] **Step 5: Commit** `"Catalogue library: set_catalog_items and set_products_active (admin)"`.

### Task 3: Placing keeps a switched-off planned implant

**Files:**
- Modify: `web/supabase/migrations/0128_catalogue_library.sql` (append `create or replace function public.place_implant_v4(…)`)
- Modify: `web/src/app/(app)/patients/[id]/chart-data.ts` (load spares of the patient's planned sites)
- Modify: `web/src/app/(app)/patients/[id]/implant-forms.tsx` (placement picker list)
- Create: `web/src/lib/inventory/with-recorded.ts` + `with-recorded.test.ts`
- Modify: `web/tests/db/catalogue-library.test.ts`

**Interfaces:**
- Consumes: `place_implant_v4` latest body is `0121_clinic_final_fixes.sql:432-575`; copy it whole, same signature.
- Produces: in `place_implant_v4`, the product check becomes: active implant, **or** (`type = 'implant'` and) it is the product of the planned `implant_sites` row for `(p_patient, p_tooth)`, or it is in `public.slot_spare_implants` for that row's `slot_id` (or `p_slot`) and `p_tooth`. Message unchanged: `Choose an implant from the catalog.`
- Produces: `withRecorded(list: Product[], extra: (Product | null | undefined)[]): Product[]` — `list` plus each `extra` not already in it, sorted by `productLabel` numeric. `ChartData` gains `spares: Record<string, Product[]>` keyed by implant site id (planned sites only). The placement form's `ImplantPicker` gets `implants={withRecorded(data.implants, [site.product, ...(data.spares[site.id] ?? [])])}`.

- [ ] **Step 1: Write failing tests:**
  - DB `places a switched-off planned implant`: book a slot with planned product P (`create_surgery_slot_v4`), set P inactive as postgres, place it with `place_implant_v4` → succeeds.
  - DB `places a switched-off spare of that tooth` → succeeds; a switched-off product neither planned nor spare → `Choose an implant from the catalog.`
  - Unit `withRecorded`: adds a missing product once, keeps order sorted, ignores null/duplicates.
- [ ] **Step 2:** `npm test -- with-recorded` → FAIL.
- [ ] **Step 3: Implement `withRecorded`, the chart-data spares query** (`supabase.from('slot_spare_implants').select('slot_id, tooth, position, product:products(*)')` filtered to the slot ids of the patient's planned sites; skip the query when there are none) **and the form change.** Append the `place_implant_v4` replacement to 0128.
- [ ] **Step 4: Run** `npm test -- with-recorded` → PASS; then the whole migration's first apply: `npm run test:db -- catalogue-library one-db-provision permissions` → PASS.
- [ ] **Step 5: Run the full DB suite** `npm run test:db` → PASS (expect existing tests that relied on provisioned products, e.g. `modules.test.ts`, `console-production.test.ts`, `company-list.test.ts`, to need a product inserted in their tx; fix them by inserting what they use, not by changing 0128).
- [ ] **Step 6: Commit** `"Catalogue library: placing keeps a switched-off planned or spare implant"`.

### Task 4: Library CSV loader

**Files:**
- Create: `web/scripts/catalog-library.ts` (pure: parse + diff), `web/scripts/catalog-library.test.ts`
- Create: `web/scripts/catalog-load.ts` (CLI)
- Modify: `web/package.json` (`"catalog:load": "tsx scripts/catalog-load.ts"`)

**Interfaces:**
- Produces: `parseCatalogCsv(text: string): LibraryRow[]` — columns `Type,Brand,System,Platform,Diameter (mm),Length (mm),Ref code,Description,Source,Check` (BOM tolerated, quoted fields, type label → `product_type` via `PRODUCT_TYPE_LABELS`; unknown type throws `Row N: unknown type "X"`). `LibraryRow = { type, brand, system, platform, diameter_mm: number|null, length_mm: number|null, ref_code, description, source }`.
- Produces: `diffLibrary(existing: (LibraryRow & { id: string; retired: boolean })[], incoming: LibraryRow[]): { add: LibraryRow[]; update: { id: string; row: LibraryRow }[]; retire: string[] }` — key `(brand, ref_code, type, diameter_mm, length_mm)`; update when `system/platform/description/source` differ or the item was retired; retire existing non-retired items of the incoming brands absent from the CSV.
- CLI: `npm run catalog:load -- --in <file.csv> [--apply]`; prints `Target project: <host>` first (as other scripts, via `load-env` / `pgConfig()`); prints `Added N, updated N, retired N` and `Dry run: nothing written. Add --apply to write.` unless `--apply`; with `--apply` writes in one transaction. Never touches `public.products`.

- [ ] **Step 1: Write failing unit tests:** parses the real `oxy-catalog.csv` (row count = lines − 1, first row `OMKN30100`, diameter 3, length 10); `diffLibrary` add/update/retire/unchanged cases; a retired item present again is updated (un-retired).
- [ ] **Step 2:** `npm test -- catalog-library` → FAIL.
- [ ] **Step 3: Implement** both modules and the CLI.
- [ ] **Step 4:** `npm test -- catalog-library` → PASS; then against the local stack `npm run catalog:load -- --in ../docs/catalog/oxy-catalog.csv` → prints `Added 0, updated 0, retired 0` (Review Focus 4).
- [ ] **Step 5: Commit** `"Catalogue library: catalog:load script (dry run by default)"`.

### Task 5: Admin → Catalogue page

**Files:**
- Create: `web/src/lib/catalog/group.ts` + `group.test.ts`
- Create: `web/src/app/(app)/admin/catalogue/page.tsx`, `catalogue-form.tsx` (client), `actions.ts`, `catalogue-form.test.tsx`
- Modify: `web/src/lib/admin/nav.ts` (add `{ href: '/admin/catalogue', label: 'Catalogue' }` after Doctors, always shown)
- Modify: `web/src/lib/admin/nav.test.ts` if it pins the list

**Interfaces:**
- Consumes: `set_catalog_items`, `set_products_active` (Task 2).
- Produces: `groupCatalog(items: CatalogItem[], products: Product[]): CatalogGroup` where `CatalogItem` mirrors the table; output `{ brands: { brand, on, total, systems: { system, on, total, platforms: { platform, types: { type, rows: { itemId, label, refCode, on, retired }[] }[] }[] }[] }[], own: { productId, label, on }[] }`. A row is `on` when the company has an active product linked to it. Retired items are left out unless the company has them on (then `retired: true`); `on`/`total` counts exclude retired. `own` = products with `catalog_item_id` null and `is_sample` false, plus samples that are active.
- Produces: `saveCatalogue(prev: SaveState, formData: FormData): Promise<SaveState>` in `actions.ts`, `requireAdmin()` first; form fields `on_item`, `off_item`, `on_product`, `off_product` (repeated ids, only the changed ones, computed client-side); calls the RPCs (skip empty arrays); returns `{ message: 'Saved: N switched on, M switched off.' }` or `{ error: userMessage(error) }`; `revalidatePath('/admin/catalogue')`.
- Page: `requireAdmin()`; reads `catalog_items` (all, ordered brand, system, platform, type, diameter, length) and `products` (`id, catalog_item_id, active, is_sample, …`), passes `groupCatalog(...)` to the form. Layout per spec sketch: brand → system → platform → type → rows; brand and system rows are tri-state checkboxes (`indeterminate` set via ref) with `n of m on`; `<details>` per brand, first open; a filter `input` (matches brand, system, platform or ref code, case-insensitive) hides non-matching rows; retired rows show the `No longer in the catalogue` badge and their checkbox can only be unticked; `Save` button; result in a `role="status"` line.

- [ ] **Step 1: Write failing unit tests** for `groupCatalog`: counts; a linked inactive product is off; hand-entered products go to `own`; inactive samples are left out; `ignores retired items in counts and brand ticks` (Review Focus 5).
- [ ] **Step 2: Write failing component test** (`vi.mock('./actions', …)`): ticking a system ticks its rows; untick one row → system shows indeterminate; Save submits only changed ids in `on_item`/`off_item`; filter `normo` hides other systems.
- [ ] **Step 3:** `npm test -- catalog/group catalogue-form` → FAIL.
- [ ] **Step 4: Implement** group helper, page, form, action, nav entry.
- [ ] **Step 5:** `npm test -- catalog/group catalogue-form nav` → PASS; `npx tsc --noEmit` and `npm run lint` clean.
- [ ] **Step 6: Commit** `"Admin → Catalogue: switch library products and own products on or off"`.

### Task 6: Product edit page, empty pickers, E2E, docs

**Files:**
- Modify: `web/src/app/(app)/inventory/products/[id]/page.tsx`, `product-form.tsx` (linked → library fields `readOnly`/`disabled` with the `From the catalogue library.` note; only reorder level and Active submitted), `actions.ts` (update only `reorder_level, active` for linked products)
- Modify: `web/src/app/(app)/patients/[id]/implant-picker.tsx`, `web/src/app/(app)/schedule/new/page.tsx` (or its form), `web/src/app/(app)/inventory/receive/page.tsx` (show the empty-pickers copy when the product list is empty)
- Create: `web/tests/e2e/catalogue.spec.ts`
- Modify: `CLAUDE.md` (Architecture: one paragraph "Catalogue library (0128)"), `web/src/app/(app)/admin/CLAUDE.md` (Catalogue page), `web/README.md` only if it describes provisioning products

**Interfaces:**
- Consumes: Tasks 1–5.

- [ ] **Step 1: Write failing component tests:** product form with `catalog_item_id` set renders type/brand/system/platform/size/ref/description disabled and the note; implant picker with `implants=[]` shows the empty-pickers copy.
- [ ] **Step 2:** run them → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Write the E2E** `catalogue.spec.ts` (admin login; `uniqueName()` not needed for library rows): open `/admin/catalogue`, untick system `PSK-MDK · PSK Normo`, Save, see `Saved: 0 switched on, 27 switched off.` (count from the page's own `n of m` before saving rather than hard-coding); open `/schedule/new` and check a Normo implant is not offered by `chooseImplant` (brand `Oxy Implant`); go back, tick it, Save; the implant is offered again. `test.afterAll` switches it back on through the page if the test failed midway.
- [ ] **Step 6: Run** `npx playwright test catalogue schedule implants --project=chromium` → PASS.
- [ ] **Step 7: Docs** (CLAUDE.md paragraph: `catalog_items` global, `products.catalog_item_id`, `set_catalog_items`/`set_products_active` admin-only, linked fields locked, new companies start empty, `place_implant_v4` accepts the planned/spare switched-off implant, `npm run catalog:load`; add the `catalog:load` line to Commands).
- [ ] **Step 8: Full verification:** `./scripts/ship.sh verify catalogue schedule implants isolation` → all green; `npm run isolation:check` → 0.
- [ ] **Step 9: Commit** `"Catalogue library: locked library fields, empty-picker hint, E2E and docs"`.
