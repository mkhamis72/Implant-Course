# Components, screws and screwdrivers — design

Date: 2026-11-22 · Project B of the advanced-rehabilitation request (A implant types, C full-arch view, D Implant Passport, E statistics follow, one at a time). Status: approved by the owner.

## Context
The owner asked for a large extension (implant types, full-arch view, components/screws/screwdrivers, Implant Passport, statistics). It was split into five projects, built one at a time; the owner chose **B: components, screws and screwdrivers** first. It must serve all three uses the owner named: **maintenance later** (a dentist, here or elsewhere, must know which screw, driver and torque to use), **stock control** (components deducted and traced by lot like implants) and a **complete clinical record**. Approach chosen: **extend the existing component records** (`site_components`, `fit_component_v2`), not new tables, not free text.

Today: one "current component" per implant (`site_components_one_current`, 0010), types cover screw / healing abutment / Ti-base / multi-unit / abutment; fitting closes the previous one (history kept), `void_component` reopens it; stock is used when Inventory is on (`app_private.insert_use`). Products have no connection, gingival height, angle, driver or torque fields; restorations have no screws. The catalogue library (Oxy CSV) has no screws or drivers.

## Approaches
- **Extend the existing component records (chosen).** Roles on `site_components`, product specs stored once, per-fitting torque and links; reuses fit, void, stock use, history, audit and chart badges.
- Separate new screw and abutment tables: cleaner on paper but duplicates fit, void, stock and history logic.
- Free-text screw and driver notes on the restoration: fastest, but no stock, no history and weak data for the Implant Passport.

## Goals
- Several components current on one implant at once, by **role**:
  - **Healing**: cover screw, healing abutment, healing cap (new)
  - **Abutment**: Ti-base, multi-unit, abutment, temporary abutment (new)
  - **Abutment screw** (new): holds the current abutment
  - **Prosthetic screw** (new; also temporary cylinder screw): holds the restoration on that implant
  - **Impression/scan** (new; scan body, impression coping): recorded as used on a date, never "current"
- Healing and abutment exclude each other (fitting an abutment closes the healing item and vice versa). Within a role a new fitting closes the previous one (**replacement history, nothing overwritten**). Replacing an abutment also closes its abutment screw.
- **Product specs entered once** on the product: connection, gingival height (mm), angle (°), material, screwdriver interface (e.g. Hex, Torx, proprietary name), screwdriver size, screwdriver ref, recommended torque (Ncm). Shown read-only when the product is chosen and wherever the component is shown.
- **Per fitting**: product + lot (as today), date, who (as today), **actual torque (Ncm)**, and for screws what it holds (the current abutment, or the current restoration on that implant).
- **Stock**: unchanged rule — product chosen + Inventory on → lot required and one unit used; Inventory off → documentation only. Screwdrivers are text specs, never stock.
- Library products: the spec columns are also added to `catalog_items` and the loader CSV, so supplier lists can carry them; linked products stay locked (`products_catalog_locked`) and inherit them. Hand-entered products get them in the product form.

## Non-goals / anti-goals
- No change to the Place implant form, placement sequence, validations or `place_implant_v4`; no change to the restoration form or `add_restoration` (screws are recorded from the implant's components, pointing at the restoration).
- No "planned" screw status (status is current / replaced / voided); no screwdriver stock or instrument inventory.
- Implant types, full-arch view, passport and statistics are later projects (A, C, D, E); this one must leave the data they will read (specs + per-fitting torque + links).
- Anti-goal: anything that breaks existing component history, badges, voids or stock reversal for current data.

## Design

**Database (new migrations, never edit applied ones)**
1. `0133_component_roles_enums.sql` — `alter type component_type add value` × healing_cap, temporary_abutment, scan_body, impression_coping, abutment_screw, prosthetic_screw, temporary_cylinder_screw; `alter type product_type add value` × healing_cap, temporary_abutment, abutment_screw (prosthetic_screw, scan_body, impression_coping exist). Alone in its migration: a new enum value can't be used in the same transaction (`scripts/migrate.ts` runs each file in one transaction; precedent 0029).
2. `0134_component_tracking.sql`
   - `products` + `catalog_items`: `connection text`, `gingival_height_mm numeric(4,1)`, `angle_deg numeric(4,1)`, `material text`, `driver_interface text`, `driver_size text`, `driver_ref text`, `torque_ncm numeric(5,1)` (all nullable, checks on ranges). Linked products copy them from the library (extend whatever copies library fields today in `set_catalog_items`, 0128/0132).
   - `site_components`: `torque_ncm numeric(5,1)` (0–150), `holds_component_id uuid` (FK same table, same site), `holds_restoration_id uuid` (FK `restorations`, restoration must include this site via `restoration_sites`).
   - `app_private.component_role(component_type) returns text` (healing / abutment / abutment_screw / prosthetic_screw / transfer; legacy final_restoration → 'legacy').
   - Replace index `site_components_one_current (site_id)` with one current per (site, role) — expression index on `app_private.component_role(component_type)` (immutable) where `removed_on is null`; transfer rows are inserted with `removed_on = fitted_on`.
   - `component_accepts` extended for the new types (scan_body→scan_body, impression_coping→impression_coping, healing_cap→healing_cap, temporary_abutment→temporary_abutment, abutment_screw→abutment_screw, prosthetic_screw & temporary_cylinder_screw→prosthetic_screw).
   - **New `fit_component_v3`** (same checks as v2 + `p_torque`, `p_holds_component`, `p_holds_restoration`; closes per role and the healing↔abutment exclusion; closes the abutment screw when its abutment is replaced; screws require what they hold; `insert_use` as today). `void_component` gets `create or replace` (same signature) so it reopens the previous row **of the same role**. v2 stays one release for the previous app version (CLAUDE.md: replaced function stays one release), dropped in a later clean-up.
   - Add `fit_component_v3` to the definer allow-list in `tests/db/permissions.test.ts`; owner `tenant_definer` (grant/revoke create pattern).
   - `patient_history` already covers `site_components`; add labels for torque / holds.

**App**
- `src/lib/inventory/types.ts`: new component and product types, labels, badges (`HC`, `TA`; screws and transfer get no chart badge), `COMPONENT_ACCEPTS`, `componentRole()` mirror of the SQL.
- `src/lib/inventory/components.ts` `badgesFor`: badge of the current healing or abutment item.
- `src/lib/inventory/schemas.ts`: `productSchema` gains the spec fields; component schema gains torque and holds.
- `inventory/products/product-form.tsx` (+ `[id]` edit): a "Specifications" group (connection, GH, angle, material, screwdriver interface / size / ref, recommended torque); read-only for linked products.
- `patients/[id]/implant-forms.tsx` `ComponentForm`: new types grouped by role; after choosing a product show its specs ("Driver: Hex 1.25 · Recommended 25 Ncm"); "Torque (Ncm)" field; for screws a "Holds" select (current abutment / current restoration on this implant); action `fitComponent` → `fit_component_v3`.
- Implant tab component list (`implant-tabs.tsx` area): current items grouped by role, each with specs + torque, and a "Replaced" history under it; Replace = the form pre-set to that role; Void as today.
- `scripts/catalog-library.ts` + `catalog:load`: optional spec columns in the CSV (Connection, Gingival height (mm), Angle (°), Material, Driver interface, Driver size, Driver ref, Torque (Ncm)), validated like sizes (0132).
- `src/lib/patients/history.ts`: labels for the new fields/types.
- Docs: `patients/CLAUDE.md` (components), `inventory` notes, root `CLAUDE.md` one line; spec at `docs/superpowers/specs/2026-11-22-component-tracking-design.md` + PDF next to it and on the Desktop (owner preference).

## Left to the builder
Exact UI wording/grouping, ordering of the component list, which existing loader helper validates the new numeric columns, test fixture shapes.

## Verification
- TDD: DB tests first (new file `tests/db/component-tracking.test.ts`): healing+abutment exclusion; abutment + abutment screw + prosthetic screw current together; replacing a screw keeps the old row closed; replacing the abutment closes its screw; screw must hold something on this site / a restoration that includes this site; transfer rows never current; void reopens previous of the same role only; stock used once per fitting with Inventory on, none with it off; specs copied to linked products; v2 still works for the previous app. Existing component, stock, corrections and module-guards tests stay green. Dry-run each migration in a rolled-back transaction before the first `test:db`.
- Unit/component tests for `componentRole`, badges, schemas, ComponentForm (specs shown, Holds select, torque), product form specs, loader CSV columns.
- E2E: extend the components spec (fit MUA → abutment screw → restoration → prosthetic screw, replace screw, see history) and inventory product spec; run with a self-started dev server (`npx playwright test <specs> --project=chromium`).
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`; owner ships with `! cd web && ./scripts/ship.sh ship` (repo public before, private after).
