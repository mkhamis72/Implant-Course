# Faster placement + scan/impression per implant

## Context
- **Placing should be fast.** Today the Place form also asks for insertion torque, ISQ and bone type. The owner wants these moved out: placing records only the implant, lot, people and technique. Torque, ISQ and bone type are entered afterwards in **Surgical details**, which already opens right after placement (`initialTab(justPlaced)` → `surgery`).
- **Scan/impression per implant.** For each implant, record whether a **digital scan** or a **conventional impression** was taken, with an optional date. The patient list needs filters for "digital scan", "conventional impression" and "not yet taken".
- **Owner's answers:**
  - Move the three fields out of placement.
  - Record the kind *and* the date.
  - Filter on both "taken" and "not yet".
  - A patient with some implants scanned and some not shows under both filters.

Size: a project. Approving this plan also approves the design. The first build step commits it as `docs/superpowers/specs/2026-10-21-placement-scan-impression-design.md`.

## Part A — Torque / ISQ / bone type move to Surgical details
**Storage is unchanged.** The values stay in `implant_sites.torque_ncm / isq / bone_type`, which `course_report` and `ImplantFacts` read.

**SQL (migration `0053_surgery_stability_impression.sql`)**
- New `save_implant_surgery_v2`: the same parameters as `save_implant_surgery` (0044) plus `p_torque numeric, p_isq numeric, p_bone_type text`.
  - Same optimistic check on `implant_surgery.updated_at`.
  - Same range checks as `place_implant_v2` (0035:47–55): torque 0–150, ISQ 0–100, bone type D1–D4.
  - Upserts `implant_surgery` and updates the three `implant_sites` columns in one transaction. It locks the site first (lock order site → …).
  - No defaults on the new parameters, so PostgREST calls are not ambiguous.
  - Standard header: `security definer set search_path = ''` and `require_perm('patients','edit')`; grants match 0044.
- **The old `save_implant_surgery` stays** while the previous app version is still live. A follow-up PR after deploy drops it (the 0052 pattern).
- `correct_placement` (latest in 0049:36–111): `create or replace` with the same signature, but it **no longer writes** torque/ISQ/bone type. The parameters are accepted and ignored, with a comment saying so.
  - *My call:* this avoids a correction overwriting values that were edited in Surgical details.
  - Cost: during the few minutes of a release, an old-version correction of those three fields is ignored.

**App**
- `implant-forms.tsx` PlaceForm: remove `TorqueField`, the ISQ input and the bone type select (:212–236, :354–364) and their state.
  - `placeImplant` (`implant-actions.ts:34`) sends null for `p_torque/p_isq/p_bone_type`.
  - Trim `placeSchema` (`src/lib/inventory/schemas.ts:79`). `correctPlacementSchema` picks from it, so drop those fields there too.
- `corrections.tsx` PlacementDetails: remove the three inputs (:98–109). `correctPlacement` passes null.
- `src/lib/implants/surgery.ts`:
  - Add `torque`, `isq` and `boneType` to `surgerySchema`. Reuse `optionalNumber` and `BONE_TYPES` from `src/lib/inventory/schemas.ts`.
  - Add them to `surgeryCompleteness`, so the tab badge counts 12 fields.
- `surgical-details.tsx` SurgeryForm:
  - Put a **"Stability"** group at the top: torque with the 15/25/35/45 quick buttons (move `TorqueField` here), "Torque measured as" next to it, then ISQ and bone type.
  - Seed the values from the site row (`site.torque_ncm` etc.). The `ChartData` site is already loaded.
- `surgery-actions.ts` `saveSurgery` calls `save_implant_surgery_v2`.

## Part B — Scan / impression
**SQL (same migration 0053)**
- Add `implant_sites.impression_type text` with a check `in ('digital_scan','conventional')` (null = not taken), and `implant_sites.impression_taken_on date`.
  - Constraint: the date is only set when there is a type.
  - Existing grants: check the column-level grants on `implant_sites`. Writes go only through the function.
- New `record_impression(p_site uuid, p_type text, p_taken_on date, p_expected_updated_at timestamptz)`:
  - Optimistic on `implant_sites.updated_at` (as `correct_failure`).
  - Refuses planned or removed sites.
  - Date: not in the future (`cairo_today()`), and not before `placed_on`.
  - Type null clears both columns.
  - Header: `require_perm('patients','edit')`.
- `search_patients` (latest 0041): `create or replace` with the same signature, widening what `stages` accepts (the 0041 pattern):
  - `digital_scan` / `conventional`: there is an implant site with that `impression_type`.
  - `impression_pending`: there is a placed implant (not planned, removed or failed) whose current stage is `cover_screw` or `healing_abutment` and which has `impression_type is null`.
    - *My call:* restored implants are excluded, so older restored cases without a record don't flood the list.
  - Filters stay ORed with the others, so a part-scanned patient matches both "scanned" and "not yet".

**App**
- `src/lib/implants/impression.ts` (new): types, labels ("Digital scan", "Conventional impression", "Not taken"), a Zod schema and tests.
- **Implant tab (`ImplantFacts`, `site-details.tsx:97`):**
  - A "Scan / impression" row shows the current value, e.g. a badge "Digital scan · 3 Nov 2026".
  - Users with Edit on Patients get a small inline form: a dropdown (Not taken / Digital scan / Conventional impression) plus a date that defaults to today when a type is chosen. Saved with the `recordImpression` action in `implant-actions.ts`.
  - Remount the select on each result (`key`; React 19 reset gotcha).
- `src/lib/patients/stages.ts`: add the three filter values and labels ("Digital scan", "Conventional impression", "Scan / impression not yet taken") to `PATIENT_FILTERS`. `patients/page.tsx` picks them up through the existing checkboxes.
- Also shown on `SiteDetails` for earlier implants (it reuses `ImplantFacts`).
- If the restore TRUNCATE list in `docs/operations.md` §D doesn't need a change, note that (no seeded rows). Update CLAUDE.md: the placement/report note (0035) and a short scan/impression bullet.

## Non-goals
- Scan/impression in the course report or CSV.
- Lab tracking or prosthetic loading (research part 3).
- Showing it on the odontogram.

## Tests (write first)
- **DB** (`tests/db/`):
  - `save_implant_surgery_v2`: writes the site columns, enforces ranges, rejects a stale `updated_at`, needs Edit on Patients.
  - `correct_placement` leaves torque, ISQ and bone type unchanged.
  - `record_impression`: date rules, clearing, stale updated_at, planned and removed sites refused.
  - `search_patients`: each new filter, plus the mixed patient matching both.
  - `permissions.test.ts` stays green.
- **Dry-run** 0053 in a rolled-back transaction before the first `test:db`.
- **Unit and component:**
  - `surgery.ts` schema and completeness.
  - `impression.ts`.
  - Update `implant-forms.test.tsx`: the Place form no longer shows torque.
  - Update `corrections.test.tsx` and `surgical-details.test.tsx`: the Stability fields save.
  - Impression form test.
- **E2E:** adjust `implants.spec.ts` and any spec that fills torque or ISQ on placement. Add one flow: place → fill torque/ISQ/bone in Surgical details → set Digital scan → the patient list filter "Digital scan" shows the patient.

## Verification
`./scripts/ship.sh verify implants patients` (tsc, lint, unit, test:db, those E2E specs). Then a manual check in `npm run dev`: place an implant, and Surgical details opens with Stability at the top.
