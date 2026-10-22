# Restorations (research part 3: loading and prosthetics) — design

Part 3 of the research roadmap in `2026-10-17-research-capture-surgery-design.md`. Decided with the owner on 2026-10-21.

## Why
The owner wants to know, later, **how long the course's crowns and bridges last and what goes wrong with them**. Implant survival is already covered by parts 1–2b. This part only **records** the data properly. Analysis (survival curves, outcome definitions, export) belongs to research parts 5–6, which will have a research / data-analysis module. Part 3 builds no summary or report beyond what is listed below.

How restoring works at the courses:
- The same delegates restore the implants, or an organizer does. This usually happens at a later course session, 3–6 months after placement.
- Sometimes a temporary crown goes on the same day as the implant.
- Most restorations are single crowns. Some are bridges, some are overdentures or full-arch restorations.

## Goals
1. **Restoration record.** A restoration is recorded once and linked to **every implant it sits on** (one or more). Its fields:
   - **stage:** temporary / final
   - **type:** single crown / bridge / overdenture / full arch
   - **date fitted**
   - **retention:** screw / cement / attachment (removable)
   - **material:** from a list
   - **teeth covered**
   - **optional:** the delegate who fitted it and the supervisor (from `public.supervisors`), plus notes
2. **Teeth covered.** For a multi-implant restoration:
   - the implants' teeth plus every tooth between the first and last implant (pontics) are included automatically;
   - the user can tick extra teeth beyond the outermost implants (cantilevers).
   - A single crown covers its own tooth.
   - Teeth covered are in one jaw.
3. **Replacement and remake.** Adding a restoration to an implant that already has a current one ends the old one's life:
   - A **temporary** that is followed by any restoration shows "Replaced on <date>".
   - A **final** followed by a final shows "Remade on <date> — reason …"; the reason is required.
   - **Only a remake ends a final crown's life.** A debonded crown that is cemented back is the same crown.
   - **Partial overlap (owner, 2026-10-21):** "Current" and "ended" belong to the whole restoration, not to each implant.
     - If the new restoration covers only some of the old one's implants, the old one ends **completely**.
     - Implants it no longer covers show no restoration until one is recorded for them.
     - Example: bridge 34–36, then a single crown on 36. The bridge is remade, and 34 is left with no current restoration.
   - **No temporary over a current final (owner, 2026-10-21):** adding a temporary to an implant whose current restoration is a final is refused, with a message to record the repair as a problem on the final instead. The final stays current throughout a repair.
4. **Problems on the restoration.** Crown problems are recorded on the restoration, not the implant:
   - Types: chipping, fracture, debonding / loss of retention, screw loosening, screw fracture, wear, other.
   - Each problem has a date, the action taken (e.g. recemented, retightened, polished/repaired, none), and notes.
   - Implant-level mechanical problems stay as implant complications: implant fracture and abutment fracture.
5. **Loading.** The app derives each implant's loading from the date of its first restoration (temporary or final) relative to its placement date:
   - **immediate:** same day up to 1 week;
   - **early:** more than 1 week up to 2 months;
   - **conventional:** more than 2 months.
   - Nobody types it. It is never stored; it is derived like early/late failure (`src/lib/implants/failure.ts`).
   - The thresholds follow the ITI consensus wording. *My call:* exact day cut-offs are the builder's to pin from that consensus, written as constants with a test.
6. **Restoration tab.** A new **Restoration** tab on each implant (tooth panel, between Surgical details and Visits) shows:
   - the derived loading;
   - the restorations newest first, current one highlighted, replaced and remade ones greyed with their end date and reason;
   - each restoration's problems;
   - buttons **Add restoration** and **Record a problem**.
   - The approved mockup is described here: the add form has stage, type, implants (this patient's placed or restored implants, the current tooth pre-ticked), teeth covered (for multi-implant types), date fitted, retention, material, the optional delegate/supervisor, and notes. It shows a note like "Replaces the temporary on 36".
7. **Odontogram.** Each **current** restoration is drawn as one bar under all the teeth it covers:
   - labelled with its type, e.g. "Bridge 34–36" or "Full arch · on 15, 12, 22, 25";
   - implants are drawn as today, and pontic and cantilever teeth are marked as covered (dashed);
   - a single crown gets a short bar under its own tooth;
   - temporaries are drawn lighter;
   - clicking the bar or any covered tooth opens that restoration's implant (the first implant for pontics or cantilevers) on its Restoration tab.
   - *My call:* replaced and remade restorations are not drawn.
8. **Restored state.** An implant is **restored** when it has a current **final** restoration. The site state and tooth status move to `restored` when one is fitted and back to `placed` when it is undone. A temporary alone doesn't make it restored.
9. **Course report.** A restoration with a delegate counts in that delegate's course report: a new "restored" count next to placed and assisted. It also appears in the delegate's own `/my` report. Restorations with no delegate count only in totals.
   - **Course picker on the restoration (owner, 2026-10-21):** the add form has an **optional** Course field. A restoration with a course counts in that course's report. One without a course falls back to the course whose dates contain its fitting date and in which its delegate is enrolled, the same rule placements use when `course_id` is empty (0046).
10. **Course picker on placement (owner, 2026-10-21):** the Place form gets a **required** Course field.
    - When the placement comes from a booking, it is pre-filled with the booking's course; today `place_implant_v2` takes it from the slot's session.
    - The placement stores it in `implant_sites.course_id`, which the course reports already read first.
    - *My calls:*
      - The course list shows all courses, those running on the chosen date first.
      - The course can be changed later from Corrections.
      - Existing placements with no course keep working through the date-plus-enrollment fallback; nothing is backfilled.
      - The Plan form doesn't ask for a course.
    - **Release window:** adding a course parameter changes the placement function's signature. Following the 0035/0052 pattern, add a new function, keep `place_implant_v2` (and `correct_placement`'s current signature) for the previous app version, and drop them in a follow-up PR. Don't add a defaulted parameter to the existing function. SQL enforces "required" only in the new function, because the old one must keep working during the window.
11. **Converting existing data.** Every current, non-voided `final_restoration` component becomes a restoration in one migration:
    - final, single crown, fitted on the component's `fitted_on`, on that implant and its tooth, with the component's delegate;
    - retention and material are empty (null = not recorded);
    - notes say it was converted.
    - *My call:* earlier non-voided `final_restoration` components are converted only when they are followed in time by another `final_restoration` on the same implant; those are converted as remade, with the reason "not recorded". A `final_restoration` that was followed by another component type (e.g. a healing abutment) is **not** converted, so the conversion invents no remakes. The conversion runs once in production and can't be redone, so it is tested on the local stack with fixtures covering each case, and dry-run against a copy of the data before release if one is available.
    - **Who owns `restored`** (*my call*): after this release, restorations own the `restored` state.
      - `void_component` and `void_followup` are redefined (same signatures) to set `restored` / `placed` from whether the implant has a current final restoration, not from components.
      - `fit_component` setting `restored` for a `final_restoration` stays for the old app's release window; it is harmless because the new app no longer offers that type.
      - The new app hides `final_restoration` components in the component timeline and on odontogram badges, so a converted crown isn't shown twice. The component rows stay untouched, as history.

## Non-goals
- Crown survival analysis, outcome definitions, dashboards, export (parts 5–6).
- Radiographs and bone levels (part 4).
- Lab orders, shade, cost, the lab's name.
- Stock or lot tracking for crowns: lab-made crowns aren't stock. Abutments, ti-bases and multi-units stay as stock-tracked components exactly as today.
- Moving existing mechanical complications off implants (see Constraints).

## Anti-goals (would make it a failure even if it works)
- Recording a bridge separately on each implant, so one bridge counts as several crowns.
- Treating "not recorded" (blank retention or material, converted rows) as a value.
- Breaking the previous app version during the release window.
- A crown's life ending on anything other than a remake.

## Constraints
- **Project rules apply** (CLAUDE.md):
  - writes go only through `security definer` functions with `require_perm('patients','edit')` and optimistic concurrency on `updated_at` for edits;
  - `app_private.fail` for user errors;
  - Cairo dates; audit triggers and History labels for the new tables;
  - restore TRUNCATE list in `docs/operations.md` §D if any table is seeded (the conversion seeds rows from existing data only, so check this);
  - permissions test coverage;
  - RLS readable with View on Patients.
- **Backward compatible.** Migrations are additive, and the previous app version must keep working for a few minutes:
  - Keep `component_type` `final_restoration` and `fit_component` accepting it. The new app stops offering "Final restoration" in the component form.
  - If the old app fits a `final_restoration` component during the release window, it isn't converted. *My call:* that is acceptable for minutes. The builder may add a small reconciliation in a follow-up migration if simple.
  - The `restored` state logic in `fit_component` / `void_component` / `void_followup` must stay consistent with the new rule (goal 8). Fitting a non-final component no longer implies anything about restoration.
- **Complication types.** The SQL check still accepts the crown types (`screw_loosening`, `screw_fracture`, `restoration_fracture`, `loss_of_retention`, `prosthetic_remake`) for old rows and the old app. The new app stops offering them on implants.
  - *My call:* existing implant complications of those types stay where they are as history.
- **Validation rules:**
  - A restoration needs at least one implant of this patient that is placed or restored. A bridge, overdenture or full arch needs at least two implants. A single crown needs exactly one.
  - All implants and teeth are in the same jaw.
  - The date is today or earlier and not before any linked implant's placement date.
  - An implant can carry only one current restoration. Adding one ends whatever is current on any of its implants (goal 3).
  - A temporary is refused on an implant whose current restoration is a final.
  - A failed or removed implant can't get a new restoration.
- **Implant failure.** *My call:* an implant failing doesn't automatically end its restoration (a bridge may survive on the remaining implants). Restoration survival is analysed in part 5.
- **Undo.** The most recent restoration on an implant can be undone (voided, with a reason). Undo reopens the one it replaced, mirroring `void_component`. *My call:* editing the details of a current restoration (retention, material, notes, people) uses optimistic concurrency; the implants and teeth can't be edited, so undo and re-add instead.

## Existing code to build on
- Components and the `restored` state:
  - `fit_component` / `void_component` (latest `0030_permissions.sql`), `void_followup` (`0048`);
  - unique current component per site (`0010`);
  - `badgesFor` and the component labels (`src/lib/inventory/components.ts`, `types.ts`).
- Complications pattern to copy for problems: `0047_complications.sql`, `src/lib/implants/complications.ts`.
- Implant tabs: `src/lib/patients/implant-tabs.ts`, `patients/[id]/implant-tabs.tsx`.
- Odontogram: `src/components/odontogram/odontogram.tsx`, `layout.ts` (`TOOTH_W` 40, lower jaw mirrored), fed by `chart-panel.tsx`.
- Course report: `course_report` / `my_report` / `delegate_report` (latest `0046`), `src/lib/reports/course-report.ts`.
- Stage filter: `implant_stage` (`0023`) keys `restored` on the site state, so it keeps working through goal 8.

## Left to the builder
- Table and function names and shapes. Expected shape:
  - a restorations table;
  - a link table to implant sites;
  - teeth covered stored on the restoration;
  - a problems table.
- The material list. Start with: zirconia, lithium disilicate, metal-ceramic (PFM), PMMA / acrylic, composite, metal (titanium / CoCr) framework, other.
- The bar drawing details on the odontogram, within the existing SVG layout.
- How the add form adapts to the type (hiding teeth covered for single crowns).
- The History wording for the new tables.
