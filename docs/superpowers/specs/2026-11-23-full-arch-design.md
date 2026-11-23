# Full-arch view and full-arch cases — design

Date: 2026-11-23 · Project C of the advanced-rehabilitation request (B components/screws released 2026-11-22, A implant types released 2026-11-23; D Implant Passport and E statistics follow). Status: draft for owner approval.

## Why
The owner's clinics do All-on-4 / All-on-X and zygomatic cases. The patient chart shows teeth one by one; a full-arch case (several implants, some tilted or zygomatic, holding one connected bridge) cannot be seen as a whole, and nothing records the case itself (its configuration, or how the final bridge progresses from scan to delivery). The owner wants to **both see and record** full-arch cases, and thinks of a case as **one case from planning** onward.

## Goals
**C1 — see (first release, no new data):**
- A **"Teeth | Full arch"** switch on the patient chart. "Teeth" is today's chart, unchanged. "Full arch" is a new schematic drawing of both arches with three layers:
  - **Prosthesis layer:** each current restoration drawn as one connected piece over the teeth it covers (FDI numbers shown), temporary and final distinguishable, pontic/cantilever units visible; each unit selectable.
  - **Implant layer:** each implant (planned or placed) drawn under its emergence tooth: conventional upright; tilted at its recorded angle and direction; zygomatic as a long implant reaching up toward the cheekbone; pterygoid as a distinct angled posterior implant; planned implants drawn as an outline. Type label (ZYG / TLT / PTG) and component badge as on today's chart. Each implant selectable, opening the same implant panel as today.
  - **Links:** which implants hold which restoration (a connector from each supporting implant to its bridge).
- Single implants and full-arch work in other areas show together in the same drawing.
- A visible note that the drawing is schematic, not a substitute for CBCT or 3D planning.

**C2 — record (second release):**
- A **full-arch case** per patient and arch (upper or lower; at most one open case per arch): configuration (All-on-4, All-on-6, All-on-X, Other) plus an optional short name (e.g. "4 + 2 zygomatic"), notes.
- Created at planning: the case groups the arch's **planned implants** (made with today's planning); placed implants, their components and the temporary and final bridges (today's restorations) are linked to the case.
- **Status** derived, not typed: Planned (no placed implant) → In treatment → Completed (final bridge delivered) — plus Closed/cancelled by hand.
- **Temporary bridge:** only its delivery date (today's restoration fitted date).
- **Final bridge stages**, each with a date and notes: **Scan / impression**, **Lab and design approved** (lab name), **Try-in** (passive fit yes/no, occlusion note), **Delivery** (the final restoration, see Settled points).
- The full-arch drawing shows each case's configuration and stage progress beside its arch.

## Non-goals
- Subperiosteal frameworks (later project, own record).
- Changing planning, booking, the Place implant form or today's tooth chart.
- The Implant Passport (D) and statistics by case (E) — C2 leaves the data they need.
- Drawn trajectories from CBCT, true anatomy, 3D.

## Anti-goals
- Breaking or altering the individual tooth chart, its clicks and badges.
- Counting prosthetic teeth as implants, or creating crowns per supporting implant.
- Making the case a second copy of data already recorded (implants, components, restorations stay where they are; the case links them).

## Approaches
- **Data: a case record of its own (chosen).** A new `full_arch_cases` row (patient, arch, configuration) with its stage rows; implant sites and restorations point to it. Only this lets a case exist from planning.
- Data: case details on the final restoration — rejected: no case before the bridge exists, but the owner starts cases at planning.
- **Drawing: a separate full-arch drawing beside today's chart (chosen).** New component behind the switch, reusing the tooth positions and numbering (`src/components/odontogram/layout.ts`, `fdi`) but drawing its own bridge and implants. Today's chart cannot break; costs some repeated drawing code.
- Drawing: one chart with a mode inside — rejected: every change risks the individual-tooth chart the owner wants unchanged.

## Design
**C1 (app only)**
- `src/components/full-arch/` — `FullArch` SVG component and pure geometry helpers (`implantShape(type, angle, direction, jaw)` → path/rotation; zygomatic and pterygoid shapes fixed schematic lengths; tilted uses the recorded angle, 0° when none). Input built from `ChartData` (sites with `implant_type`, `angulation_deg`, `angulation_direction`, state, badges; `restorationSpans`), so no new query.
- `chart-panel.tsx`: the switch (remembered in the URL, e.g. `?view=arch`); selection reuses `onSelect`, so tapping an implant or a bridge opens the same panel/tab as on the Teeth view.
- Phones: the drawing scales to width like the tooth chart; keyboard-selectable like the tooth chart.

**C2 (database + app; migrations from 0142)**
- `public.full_arch_cases`: `id`, `company_id`, `patient_id`, `arch` (`upper`/`lower`), `configuration` (`all_on_4`/`all_on_6`/`all_on_x`/`other`), `name text ≤ 60`, `notes ≤ 1000`, `closed_at`, `close_reason`, audit columns, `updated_at`. Unique open case per patient + arch.
- `public.full_arch_stages`: `case_id`, `stage` (`scan`/`lab_design`/`try_in`), `done_on date`, `lab text ≤ 120` (lab_design), `passive_fit boolean` and `occlusion text ≤ 500` (try_in), `notes ≤ 1000`; one row per stage per case.
- `implant_sites.case_id` and `restorations.case_id` (nullable, company-scoped FKs, `on delete set null`). A site/restoration may only join a case of the same patient whose arch contains its teeth.
- Definers (Edit on Patients, `require_perm('patients','edit')`, audited, `app_private.fail` messages, company-scoped): `create_full_arch_case(p_patient, p_arch, p_configuration, p_name, p_notes, p_sites uuid[])`, `update_full_arch_case(...)`, `set_case_sites(p_case, p_sites)`, `set_case_restoration(p_restoration, p_case)`, `record_case_stage(p_case, p_stage, p_done_on, p_lab, p_passive_fit, p_occlusion, p_notes)`, `close_full_arch_case(p_case, p_reason)`. Dates follow the patients "dates at entry" rules (`cairo_today()`).
- Readers through RLS (patients view), `patient_history` labels for the new tables, module-guards/permissions tests updated.
- App: a **Full-arch case** panel on the patient (opened from the arch in the drawing or a "Start full-arch case" action on the chart): configuration, implants (pick the arch's planned/placed implants), bridges, stage checklist with dates; the restoration form gains "Part of full-arch case" when one is open for that arch.
- Placement keeps the site's `case_id` (the placed implant is the same site row), so no change to `place_implant_v4`.

## Settled points (from the builder check; all my calls unless marked)
- **One implant per tooth** stays (project A): the drawing never needs two implants on one emergence tooth.
- **Arch rule:** a restoration joins a case only if all its teeth are in the case's arch; cross-arch restorations are refused for cases (they stay case-less).
- **Linking bridges:** the restoration form pre-ticks "Part of full-arch case" when any implant it covers is in an open case for that arch (can be unticked). A final restoration that replaces a case's temporary is therefore linked by default.
- **Delivery is the final restoration:** the Delivery stage is not typed separately; it is the fitted date of the current, non-voided final restoration linked to the case. **Completed** = such a restoration exists; if it is voided or ended (remade), the case goes back to In treatment. The temporary bridge's delivery is likewise its restoration's fitted date. Stage rows exist only for Scan, Lab and design, Try-in.
- **Stages:** may be entered in any order (no date-order rule beyond the patients "dates at entry" rules); `record_case_stage` creates or updates the stage; clearing a stage deletes it; edits to the case use optimistic concurrency on its `updated_at`.
- **Sites:** an implant belongs to at most one case (one `case_id`), can be added to or removed from a case while it is open, and must be on the case's arch and patient. A failed implant stays in the case and is drawn as failed; an implant removed as entered by mistake (`remove_placement`) or a deleted patient simply disappears (rows deleted, `case_id` goes with them). A case implant may still carry its own single crown (restoration rules unchanged).
- **Planned implants in the drawing (C1):** drawn as an outline at their tooth, upright, typed from the planned product's implant kind (geometry is recorded after placement, project A); spares are not drawn.
- **Closing:** a closed case keeps its links for history; a new case can then be opened on that arch; a closed case can be reopened if its arch has no other open case.
- **Clinic and modules:** works the same in Clinic companies and regardless of Statistics/Inventory modules (Patients area only). New tables are not seeded, so no restore `TRUNCATE` entry. Migrations start at 0142 (0141 is released).
- **C1 needs nothing from C2.** C2 adds the case label and stage progress beside the arch.

## Left to the builder
Exact drawing proportions and colours (design tokens only), connector style, panel layout, test fixtures.

## Verification
C1: unit tests for geometry (angle/direction → rotation, per type), component tests (layers render, selection opens the same tab, schematic note), E2E: a patient with an All-on-4 (two tilted) + a zygomatic shows four implants under one bridge on Full arch; Teeth view unchanged (existing chart tests stay green).
C2: DB tests (one open case per arch, sites/restorations only from the same patient and arch, stage rules, permissions, company isolation, history), component tests (case panel, stages), E2E (start case at planning → place → temporary → stages → final delivered → Completed). Full suites; owner ships each release with `! cd "/d/Claude/Claude Code/implant-course-self-auth/web" && ./scripts/ship.sh ship`.
