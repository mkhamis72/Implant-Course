# Implant types: tilted, zygomatic, pterygoid — design

Date: 2026-11-23 · Project A of the advanced-rehabilitation request (B components/screws released 2026-11-22; C full-arch view, D Implant Passport, E statistics follow). Status: draft for owner approval.

## Why
The owner's clinics already place **zygomatic implants** and do **All-on-4** cases. Today the app cannot record them properly: products refuse lengths over 25 mm (zygomatic implants are about 30–55 mm), an implant has no type, angle or anchorage, and placing an implant overwrites the planned product. The record must be accurate enough for a later dentist (and for the Implant Passport, project D) to know what is in the mouth.

## Goals
- **Implant kind on the product**, entered once: `conventional` (default), `zygomatic`, `pterygoid`. Product length allowed up to 60 mm for implants (diameter unchanged).
- **Implant type on each placed implant**: `conventional`, `tilted`, `zygomatic`, `pterygoid`. It defaults from the placed product's kind (conventional product → conventional) and can be changed (e.g. a conventional implant placed tilted in All-on-4 → `tilted`).
- **Placement geometry on each implant** (all optional): angulation (0–60°), direction (mesial / distal / buccal / palatal-lingual), anatomical anchorage (zygoma / pterygoid plate / maxillary tuberosity / other), entry point (short text), trajectory (short text). The tooth number stays the **emergence position** (labelled as such for zygomatic and pterygoid implants).
- **Planned vs actual**: when an implant is placed, the product that was planned is kept (`planned_product_id`) instead of being lost; the implant panel shows "Planned: …" when it differs from what was placed.
- **Visible**: a small type label on the chart tooth and in the Implants table — `ZYG`, `TLT`, `PTG` (nothing for conventional); the implant panel shows type, angle, direction and anchorage.

## Non-goals
- **Subperiosteal** implants (custom framework, fixation screws, posts) — not used by the owner yet; a later project with its own record.
- Two implants at the same tooth position — owner confirmed zygomatic implants emerge at different positions, so the one-active-implant-per-tooth rule stays.
- 3D/CBCT planning, drawn trajectories — the chart label is schematic only (full-arch drawings are project C).
- Statistics by type (project E), Implant Passport (project D).

## Anti-goals
- No change to the **Place implant form**, its fields, order or validations, or to `place_implant_v4`'s checks (owner requirement). The only placement-time change is in the database: keep the planned product and set the type from the product.
- No change to existing implants' data except defaults (`conventional`) and the planned-product backfill where it can be known.

## Approaches
- **Type on the implant, defaulted from the product (chosen).** Product kind entered once; implant type follows it on placement and can be changed to Tilted; geometry entered in the existing Surgical details tab, so the Place form is untouched.
- Type on the product only: simpler, but cannot record a tilted conventional implant — exactly what All-on-4 needs.
- Extra fields on the Place form: one-step entry, but changes the protected placement form.

## Design
**Database (new migrations from 0139)**
- `products.implant_kind` and `catalog_items.implant_kind` (enum or checked text: conventional / zygomatic / pterygoid; default conventional; only meaningful for `type = 'implant'`); part of the library-locked fields like the 0134 specs (library sync + lock rule extended). Widen `products.length_mm` / `catalog_items.length_mm` checks to 4–60 (numeric(4,1) already fits).
- `implant_sites`: `implant_type` (conventional / tilted / zygomatic / pterygoid, nullable while planned), `angulation_deg numeric(3,1)` 0–60, `angulation_direction`, `anchorage`, `entry_point text ≤ 200`, `trajectory text ≤ 200`, `planned_product_id uuid` (company-scoped FK to products).
- Placement: `place_implant_v4` gets `create or replace` (same signature, latest body 0129) adding only: `planned_product_id = <product before placing>` and `implant_type = coalesce(implant_type, kind of the placed product)`. No new checks, no message changes. (Previous app version calls the same function, so it stays compatible.) `correct_batch` changing the product re-defaults the type only if it still equals the old product's kind.
- New definer `set_implant_geometry(p_site, p_type, p_angulation, p_direction, p_anchorage, p_entry, p_trajectory)` (Edit on Patients; placed or restored implants; `tilted` needs an angle; anchorage only for zygomatic/pterygoid), audited like other site updates.
- Backfill: existing placed implants `implant_type = 'conventional'`; `planned_product_id` only where a linked booking (`slot_planned_implants.implant_site_id`) recorded the plan.
- `patient_history` already covers `implant_sites`: add field labels.

**App**
- Product form: "Implant kind" select for implants; length up to 60 mm; catalogue CSV optional column `Implant kind`.
- Surgical details tab: an "Implant type and angle" section (type, angle, direction, anchorage, entry point, trajectory) with its own Save, calling `set_implant_geometry`; anchorage/entry/trajectory shown only for zygomatic and pterygoid; angle required for tilted.
- Implant panel: type line (e.g. "Zygomatic · 45° distal · zygoma") and "Planned: <product>" when different; tooth labelled "Emergence 14" for zygomatic/pterygoid.
- Chart + Implants table: small `ZYG` / `TLT` / `PTG` label (like component badges).
- History labels for the new fields; docs (patients CLAUDE.md, root CLAUDE.md).

## Settled points (from the builder check)
- **Where the plan lives:** a planned implant's product is `implant_sites.product_id` while `state = 'planned'` (set by `plan_implant` or the booking). `place_implant_v4` stores that value in `planned_product_id` before overwriting it, booked or not; placing a spare keeps the planned (primary) product as planned. Backfill for already-placed implants comes only from `slot_planned_implants` linked to the site.
- **Type before placement (my call):** the type and angle are set after placement, in Surgical details; planning stays as it is. A planned site's `implant_type` stays null and placement fills it from the product's kind. Reason: no change to planning or booking screens; an All-on-4 posterior is marked Tilted right after placing.
- **Library (my call):** `implant_kind` is a locked, synced library field like the 0134 specs; it is not part of the brand + type + ref link key. A library change updates linked products but never changes already-placed implants' recorded type.
- **App limits:** the product form and catalogue CSV loader accept implant lengths up to 60 mm. Statistics, research exports and reports ignore the new fields until project E (my call).
- **Corrections:** only `correct_batch` changes an implant's product (`correct_placement_v3` does not); it re-defaults the type only when the type still equals the old product's kind. Removing a mistaken implant deletes it as today.
- **Clinic:** geometry is clinical data, not teaching data; `set_implant_geometry` needs Edit on Patients and works the same in a clinic.

## Left to the builder
Exact UI layout of the new Surgical details section, label styling on the chart, enum vs checked text, test fixture shapes.

## Verification
DB tests (types default from product on placement, planned product kept, geometry rules, library lock/sync of implant_kind, 60 mm length, previous-app placement unchanged), unit/component tests (forms, labels), E2E (zygomatic product 45 mm placed → type Zygomatic, set anchorage/angle; All-on-4 posterior set Tilted 30° distal; chart shows ZYG/TLT), full suites, owner ships with `! cd web && ./scripts/ship.sh ship`.
