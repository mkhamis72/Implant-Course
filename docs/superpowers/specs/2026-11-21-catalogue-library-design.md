# Product catalogue: shared library and Admin → Catalogue (owner request C)

Date: 2026-11-21. Backlog: `2026-11-18-owner-requests-backlog.md`, part C.

## Intent

The owner's words: a centre or clinician should "only have the products he uses instead of the full catalogue", to avoid mix-ups, and there should be "pre-uploaded catalogues for multiple common systems that users can just select to activate specific products from, instead of having to manually enter each one".

- **Who:** the company **admin**, once when the company starts and again whenever a new system comes in.
- **Today:** each company has its own `public.products` rows. A new company gets academy's Oxy catalogue copied in (`provision_company`, 0095/0105), about 220 rows. Hiding is one product at a time (the **Active** tick on the product's edit page). All pickers (receive stock, implant chart, booking new/edit) already read only `active` products.
- **Data:** only Oxy exists (`docs/catalog/oxy-catalog.csv`). Other systems are added when the owner supplies a supplier list; Claude turns it into a CSV in the same format. No reference codes are invented.

## Goals

1. One shared **library** of ready-made systems that every company can see and no company can change.
2. **Admin → Catalogue:** a page where an admin switches library products on or off for their company in bulk. Tick boxes work at every level the owner named: brand, line/system (for example `PSK-MDK · PSK Normo`), connection (platform), and single sizes. This covers implants and components alike (healing abutments, multi-units, abutments, etc.). Products the company entered by hand appear on the same page and can be switched on or off too.
3. Switched-off products disappear from every picker, as inactive products do today.
4. A new system can be added later by loading a CSV, with no code change.

## Non-goals

- Editing the library from the app or the console (the library is maintained with a script).
- Other systems' data (comes later, from the owner).
- Prices, suppliers, stock levels per library item.
- Changing how stock, implants, components or reports reference products.

## Anti-goals

- Switching a product on or off **only changes what the dropdowns offer for new choices** (owner, 2026-11-21). It never affects implants already planned on a booking, implants already placed, or stock already in inventory: those keep working and keep showing the product.
- One company's choices must never show up in another company (the isolation check must stay green).
- No invented reference codes.

## Approaches

- **A. Shared library, companies switch items on (chosen by the owner).** A new global table holds library products. Ticking an item gives the company its own `products` row linked to it; unticking makes that row inactive. Every existing reference keeps pointing at company rows, so RLS, the company export/restore and the isolation check are untouched.
- **B. Companies reference shared products directly.** No copies, but stock, implants, export/restore, RLS and the isolation check all assume products belong to a company: a large, risky rework. Dropped.
- **C. No library; bulk tick page over each company's own rows only.** Quickest, but every company still carries the full Oxy copy and a new system must be imported into each company separately, against "ready-made, just select". Dropped.

## Design (approach A)

### Database (one new migration)

- **`public.catalog_items`** (global, no `company_id`, like `public.plans`): `id`, `type` (`product_type`), `brand`, `system`, `platform`, `diameter_mm`, `length_mm`, `ref_code`, `description`, `source` (catalogue page, from the CSV's `Source`), `retired` boolean default false, `created_at`. Same checks as `products`. Unique key: `(brand, ref_code, type, diameter_mm, length_mm)` with nulls treated as equal (Claude's call; Oxy ref codes are unique per item, but components without a ref code exist in some catalogues).
  - Readable by `authenticated` (select only). No writes except through the loader (service role / postgres).
  - Added to the restore `TRUNCATE` list in `docs/operations.md` §D only if the migration seeds rows (it does: see backfill), so yes.
- **`products.catalog_item_id`** uuid null, references `catalog_items(id)`; unique per `(company_id, catalog_item_id)` where not null. Hand-entered products leave it null.
- **Seeding and backfill (in the migration):** insert the contents of `docs/catalog/oxy-catalog.csv` into `catalog_items` (Claude's call: the CSV is the source the 0026 catalogue was generated from, so a later `catalog:load` of the same CSV changes nothing). Then link every company's existing products to the matching item by **brand + type + ref code** (when the ref code is empty: by all seven fields). Claude's call: a company whose Oxy row was slightly edited still gets linked, so switching the item on later never creates a near-duplicate. Unmatched products stay hand-entered. Nothing is deactivated: every company sees exactly what it sees now.
- **`public.set_catalog_items(p_item_ids uuid[], p_on boolean)`** (security definer, admin only like the 0118 admin tools; `require_active()` + `is_admin()`):
  - **On:** for each item, if the company has a linked product, set it active; else if it has an unlinked product with the same brand, type and ref code (non-empty), link and activate that one; otherwise insert a product copied from the item (`reorder_level` 0) with the link. Retired items cannot be switched on ("This product is no longer in the catalogue.").
  - **Off:** set linked products inactive. Never deletes.
  - Returns the number of products changed.
- **`public.set_products_active(p_product_ids uuid[], p_on boolean)`** (same guard): bulk on/off for the company's own rows, used for hand-entered products. (Claude's call: a separate function keeps each one simple and avoids a defaulted parameter.)
- **`provision_company`**: new companies start with **no products** (owner, 2026-11-21): the first admin chooses in Admin → Catalogue. Until any product is on, the booking/implant/receive pickers show "No products switched on yet. An admin chooses them in Admin → Catalogue." (Claude's wording).
- **Already-planned products keep working.** Today `place_implant_v4`, `correct_placement_v3`, `create_surgery_slot_v4`, `update_surgery_slot_v3` and `set_booking_implants` refuse a product that is not `active`. New versions (or `create or replace` keeping signatures) must accept an inactive product when it is the one already recorded for that tooth (planned on the booking, or the placed implant being corrected), as 0127 already does for spares. Stock batches of a switched-off product stay listed in Inventory; the placing picker offers a switched-off product only when it is the one planned for that tooth (Claude's call, keeps the dropdown short). The booking/placing pickers always include the product already recorded on the row being edited.
- `tests/db/permissions.test.ts` and `module-guards.test.ts`: add the new functions/table where their rules require.

### Linked products

- The library fields (type, brand, system, platform, size, ref code, description) of a linked product are **read-only** on the product edit page, with a line "From the catalogue library". Reorder level and Active stay editable. The `products` update path refuses changes to those fields when `catalog_item_id` is set (Claude's call: keeps the link meaningful).
- An admin can still add a product by hand (Inventory → New product), as now.

### Loading a library CSV

- `npm run catalog:load -- --in <file.csv>` (new script, `ENV_FILE` picks the database, prints `Target project` first). Same columns as `oxy-catalog.csv`.
- Upserts by the unique key; items in the database for the CSV's brand that are missing from the CSV are marked `retired` (never deleted). Updates description/source of existing items; it does **not** change linked company products' fields (Claude's call: a company's recorded product never changes underneath it; a correction is a new item).
- Dry-run by default; `--apply` writes. Prints added / updated / retired counts.

### Admin → Catalogue page

```
Catalogue                                   [Save]
Switch on the products your centre uses. Switched-off products
are hidden from booking, the implant chart and receiving stock.

[x] Oxy Implant                         180 of 221 on
    [x] PSK-MDK · PSK Normo              27 of 27
        Implants
        [x] Ø3.75 × 10 mm   OPN37100
        ...
    [-] MD EXT                           12 of 28
        ...
Your own products
    [x] Healing cap 5 mm  (hand-entered)
```

- Grouped brand → system (line) → connection (platform) → type → products; brand and system rows are tri-state tick boxes with "n of m on" counts; groups collapsed by default except the first (Claude's call).
- A filter box (brand/system/ref code) at the top (Claude's call: 220+ rows).
- **Save** sends the changed items only (two calls: items on, items off; plus the hand-entered pair). Result line: "Saved: 14 switched on, 3 switched off."
- Admin only (`requireAdmin()`), in Admin's section nav, shown whatever the plan (implant pickers need products even with Inventory switched off).
- Retired library items are not offered; if a company still has one active, it shows under its system with "No longer in the catalogue", can be switched off but not on.
- Mobile: rows stack; the tick boxes stay large enough to tap.

### Tests

- DB: set_catalog_items on/off/idempotent/retired/other company untouched/non-admin refused; set_products_active scoped to own company; backfill links; provisioning links Oxy; linked fields refused on update.
- Unit: grouping/counting helper for the page; CSV parser for the loader (reuse the 0026 generator's parsing if suitable).
- E2E: admin switches a system off → its implant no longer offered in the booking picker; switches it back on.
- `npm run isolation:check` stays at 0.

## Left to the builder

Exact migration number, function bodies, how the page posts its changes, component structure, loader internals.
