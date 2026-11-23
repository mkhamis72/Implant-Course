# Implant types (tilted, zygomatic, pterygoid) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an implant kind on products (up to 60 mm long), an implant type and placement geometry on each implant, and keep the planned product when an implant is placed.

**Architecture:** New columns on `products`/`catalog_items` (`implant_kind`, library-locked and synced like the 0134 specs) and on `implant_sites` (type, geometry, `planned_product_id`); `place_implant_v4` is re-created with the same signature and checks, adding only the two writes; geometry is saved by a new definer from a new section of the Surgical details tab; the chart and Implants table show a type label.

**Tech Stack:** Postgres plpgsql (local Supabase), Next.js 15 server actions, Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-implant-types-design.md`

## Global Constraints
- New migrations start at `0139` in `web/supabase/migrations/`; never edit an applied one (0133–0138 are applied in prod). Dry-run each in a rolled-back transaction before the first `npm run test:db`.
- The Place implant form (fields, order, validations, messages) and `place_implant_v4`'s checks and messages do not change. `place_implant_v4` keeps its exact signature (`create or replace`, latest body `0129_place_switched_off_planned.sql`).
- Values (checked text, not enums): `implant_kind` ∈ `conventional | zygomatic | pterygoid` (default `conventional`); `implant_type` ∈ `conventional | tilted | zygomatic | pterygoid`; `angulation_direction` ∈ `mesial | distal | buccal | palatal_lingual`; `anchorage` ∈ `zygoma | pterygoid_plate | tuberosity | other`.
- Ranges: implant length 4–60 mm (was 4–25), angulation 0–60°, entry point and trajectory ≤ 200 characters.
- Labels: `Conventional`, `Tilted`, `Zygomatic`, `Pterygoid`; chart/table short labels `ZYG`, `TLT`, `PTG` (none for conventional); directions `Mesial`, `Distal`, `Buccal`, `Palatal / lingual`; anchorage `Zygoma`, `Pterygoid plate`, `Maxillary tuberosity`, `Other`.
- Definers: `security definer set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, `app_private.fail(...)` messages, revoke from public/anon, grant to authenticated, owner `tenant_definer` (grant/revoke create pattern, see 0132).
- Geometry is clinical data: it works the same in a clinic (no teaching checks).
- Statistics, research exports and reports are not changed.
- Files are CRLF; write files containing `\` with Write/Edit tools; no Prettier.

## Review Focus
1. A spare (not the primary planned product) is placed: `planned_product_id` must be the planned product, `implant_type` the spare's kind → Task 2 test `placing a spare keeps the primary plan`.
2. An implant planned before this release and placed by the previous app version during the release window still gets a type and planned product → Task 2 test `placement via the unchanged signature sets type and plan` (call `place_implant_v4` with the same named args the app uses).
3. A library-linked product's `implant_kind` edited by a company is refused; a library change does not change a placed implant's type → Task 1 tests.
4. `correct_batch` to a product of another kind re-defaults the type only if the user had not changed it → Task 2 tests (two cases).
5. Setting `tilted` with no angle, or anchorage on a conventional implant, is refused with a plain message → Task 2 tests.

---

### Task 1: Product kind, 60 mm length, implant columns (0139)

**Files:** Create `web/supabase/migrations/0139_implant_kind_and_geometry.sql`; Test `web/tests/db/implant-types.test.ts` (new).

**Interfaces — Produces:**
- `products.implant_kind` / `catalog_items.implant_kind text not null default 'conventional'` with the Global check; INSERT/UPDATE grant on `products.implant_kind` to authenticated (same pattern as 0134).
- `products.length_mm` and `catalog_items.length_mm` checks widened to 4–60 (drop and re-add the existing named checks; find their names in 0008/0128).
- `implant_sites`: `implant_type text` (nullable; Global check), `angulation_deg numeric(3,1)` (0–60), `angulation_direction text`, `anchorage text`, `entry_point text not null default ''` (≤ 200), `trajectory text not null default ''` (≤ 200), `planned_product_id uuid` with a company-scoped FK to products (pattern: 0091/0114 composite `(company_id, …)` FKs).
- Library: `app_private.protect_catalog_product()` and `app_private.sync_catalog_specs()` (latest bodies 0134) extended with `implant_kind` (locked unless equal to the library's; synced on library update); `set_catalog_items` (latest 0134) copies it.
- Backfill: placed/restored/failed sites `implant_type = 'conventional'`; `planned_product_id` from `slot_planned_implants` where `implant_site_id = site.id` (only if exactly one such row), audit trigger off during the backfill (pattern 0136).

- [ ] **Step 1: Failing tests** in `describe('implant types (0139–0140)')`: `a 45 mm zygomatic implant product can be saved`; `61 mm is refused`; `implant_kind defaults to conventional`; `a linked product refuses an implant_kind change`; `a library implant_kind change reaches linked products`; `placed implants are backfilled as conventional`; `backfill takes the planned product from the booking`.
- [ ] **Step 2:** dry-run; `npm run test:db -- implant-types` → FAIL.
- [ ] **Step 3:** write the migration.
- [ ] **Step 4:** `npm run test:db` (full) → PASS.
- [ ] **Step 5: Commit** `Implant kind on products, 60 mm implants, implant type columns (0139)`.

### Task 2: Placement keeps the plan; geometry definer (0140)

**Files:** Create `web/supabase/migrations/0140_implant_type_placement.sql`; Test `web/tests/db/implant-types.test.ts`; existing placement/corrections/stock DB tests stay green.

**Interfaces — Consumes:** Task 1 columns. **Produces:**
- `place_implant_v4` (create or replace, body of 0129 unchanged except): before overwriting `product_id`, set `planned_product_id = coalesce(planned_product_id, <site's product_id while planned>)`; set `implant_type = coalesce(implant_type, (select implant_kind from products where id = p_product))`.
- `correct_batch` (create or replace, latest body 0113): when the product changes, set `implant_type` to the new product's kind only if the current `implant_type` equals the old product's kind.
- `public.set_implant_geometry(p_site uuid, p_type text, p_angulation numeric, p_direction text, p_anchorage text, p_entry text, p_trajectory text) returns void` — placed or restored site (`'Only a placed implant has a type and angle.'`); type required (`'Choose the implant type.'`); `tilted` needs an angle (`'Enter the angle of the tilted implant.'`); anchorage, entry point and trajectory only for zygomatic/pterygoid (`'Anchorage is only recorded for zygomatic and pterygoid implants.'`); angle 0–60 (`'Enter an angle between 0 and 60°.'`); text lengths ≤ 200. Owner `tenant_definer`.

- [ ] **Step 1: Failing tests:** `placing records the planned product and the product's kind` (plan product A conventional, place zygomatic product B → planned A, type zygomatic); `placing a spare keeps the primary plan`; `placement via the unchanged signature sets type and plan` (named args exactly as `implant-actions.ts` sends them); `correct_batch re-defaults an untouched type`; `correct_batch keeps a type the user changed` (set tilted first); `set_implant_geometry saves tilted 30° distal`; `tilted needs an angle`; `anchorage only for zygomatic or pterygoid`; `refuses on a planned implant`; `works in a clinic` (teaching off); `needs Edit on Patients` (viewer refused).
- [ ] **Step 2:** dry-run; run → FAIL.
- [ ] **Step 3:** write the migration.
- [ ] **Step 4:** `npm run test:db` (full) → PASS.
- [ ] **Step 5: Commit** `Placement keeps the planned product and sets the implant type; set_implant_geometry (0140)`.

### Task 3: Domain helpers, product form, catalogue loader

**Files:** Modify `web/src/lib/inventory/types.ts`, `schemas.ts`; create `web/src/lib/patients/implant-type.ts` (+ test); modify `web/src/app/(app)/inventory/products/product-form.tsx`, `web/scripts/catalog-library.ts`, `catalog-load.ts` (+ tests).

**Interfaces — Produces:**
- `IMPLANT_KINDS`, `IMPLANT_TYPES`, `ANGULATION_DIRECTIONS`, `ANCHORAGES` as const tuples with label maps (Global labels); `Product.implant_kind`; `ImplantSite` gains `implant_type, angulation_deg, angulation_direction, anchorage, entry_point, trajectory, planned_product: Product | null`.
- `implant-type.ts`: `typeShortLabel(t: ImplantType | null): string` (`ZYG`/`TLT`/`PTG`/''), `typeLine(site): string` (e.g. `Zygomatic · 45° distal · Zygoma`; `''` for conventional with no angle), `isAnchored(t): boolean` (zygomatic or pterygoid), `typeLabels(sites): Partial<Record<number, string>>` (active site per tooth → short label).
- `productSchema`: `length_mm` 4–60 (`'Enter a length between 4 and 60 mm.'`), `implant_kind` (default conventional). `geometrySchema` mirroring Task 2 rules and messages (`siteId`, `patientId`, `type`, `angulation`, `direction`, `anchorage`, `entryPoint`, `trajectory`).
- Product form: "Implant kind" select shown for type implant (read-only for linked products); loader: optional `Implant kind` column (values `Conventional`/`Zygomatic`/`Pterygoid`, case-insensitive; bad value → `Row N: Implant kind must be Conventional, Zygomatic or Pterygoid: "x"`), length up to 60.

- [ ] **Step 1: Failing tests** for each helper, schema rule and loader value above; product form shows the kind select only for implants.
- [ ] **Step 2:** `npm test -- inventory implant-type product-form catalog-library` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`, `npm test` → PASS.
- [ ] **Step 5: Commit** `Implant kind and type in the app's helpers, product form and catalogue loader`.

### Task 4: Patient screens

**Files:** Modify `web/src/app/(app)/patients/[id]/chart-data.ts` (SITE_SELECT: new columns + `planned_product:products!<fk>(*)`), `surgery-actions.ts` (new `saveImplantGeometry` → `set_implant_geometry`), `surgical-details.tsx` (new "Implant type and angle" section with its own Save), `site-details.tsx` (type line, "Planned: <product label>" when it differs, "Emergence <tooth>" for anchored types), `chart-panel.tsx` / `web/src/components/odontogram/*` (second small label per tooth from `typeLabels`; keep component badges), `implants/page.tsx` (Type column), `web/src/lib/patients/history.ts` (labels: `implant type`, `angle`, `direction`, `anchorage`, `entry point`, `trajectory`, `planned product`); tests beside each; `web/tests/e2e/implants.spec.ts`.

**Interfaces — Consumes:** Task 2 RPC, Task 3 helpers and `geometrySchema`.

- [ ] **Step 1: Failing tests:** Surgical details section — Anchorage/Entry/Trajectory hidden for Conventional and Tilted, shown for Zygomatic; Tilted without angle shows `Enter the angle of the tilted implant.` and doesn't call the action; save sends the right payload. SiteDetails — `Zygomatic · 45° distal · Zygoma`, `Planned: …` only when different, `Emergence 14`. Odontogram — tooth with a zygomatic implant shows `ZYG` and still shows its component badge. Implants table — Type column. History — angle change described as `angle`.
- [ ] **Step 2:** `npm test -- patients odontogram` → FAIL.
- [ ] **Step 3:** implement (clinic: same behaviour).
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`, `npm test` → PASS.
- [ ] **Step 5: E2E** in `implants.spec.ts`: seed a zygomatic product 4.0 × 45 mm (API, `implant_kind: 'zygomatic'`), plan a conventional implant on 14, place the zygomatic product → panel shows `Zygomatic` and `Planned:` the conventional product, chart shows `ZYG`; set anchorage Zygoma and 45° distal → panel line updated; on another tooth place a conventional implant, set Tilted 30° distal → chart `TLT`. Run `npx playwright test implants inventory --project=chromium` with a self-started dev server → PASS.
- [ ] **Step 6: Commit** `Implant type and angle on the patient screens`.

### Task 5: Docs

**Files:** `web/src/app/(app)/patients/CLAUDE.md` (Implant types bullet: kinds, type default, geometry rules, planned product, 0139–0140), `web/src/app/(app)/admin/CLAUDE.md` (Product specs bullet: implant kind, 60 mm), root `CLAUDE.md` (one line under Catalogue/Product specs: implant kind, CSV `Implant kind`, length 60).

- [ ] **Step 1:** edit; `npx tsc --noEmit && npm run lint && npm test && npm run test:db` → green.
- [ ] **Step 2: Commit** `Docs: implant types`.
