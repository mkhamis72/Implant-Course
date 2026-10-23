# Research page (research part 5b) — design

Part 5b of the research roadmap. It follows 5a (`2026-10-22-outcomes-data-quality-design.md`), which defined the versioned outcome readers. Decided with the owner on 2026-10-23. The owner approved the mockup unchanged.

## Why
5a computes implant survival, ICOI success, crown survival and complications in SQL, but nothing shows them. The owner wants one page with those numbers, filterable, and visible only to people they choose.

## Goals
1. **Research page** at `/patients/research` ("Research" link next to "Recall list" and "Data quality").
   - It shows **outcomes-v1** in the header, from `outcomes_version()`.
2. **Filters** (owner): course, placement date range, delegate (placing delegate), implant brand / type (the product's brand, then line/type).
   - Filters are kept in the URL search params (`readParams`).
   - The defaults are all courses and all dates.
3. **Tiles** (owner, mockup):
   - implants placed in range;
   - **survival at 1 year** and **at 2 years**, each as `survived / (survived + failed)`. The counts under each tile are: N survived of M, *n* not reached, *n* lost to follow-up (unknown);
   - **crowns remade**: remakes / final restorations.
   - *My call:* when M < 30, the tile shows "small sample".
4. **Survival curve** (owner): Kaplan–Meier over months since placement, using `follow_up_days` and `event` from `implant_outcomes`.
   - Implants with `event_time_unknown` are left out, and their count is shown under the chart.
   - The number of implants still being followed is shown under the axis at 0, 12 and 24 months.
   - *My call:* the curve is computed in TS from the rows (a plain product-limit estimator). This is display only; the event and censoring status still come from SQL.
5. **ICOI breakdown** (owner): the count of implants by latest grade (I / II / III / IV) plus **not assessable**.
   - Not assessable is shown separately and never counted as success.
6. **Complications** (owner):
   - implants with ≥ 1 biological, and with ≥ 1 mechanical, complication, as counts and % of implants;
   - crown problems on final restorations, from `crown_outcomes.problems`.
7. **Drill-down** (*my call*, from the mockup's "every number links"): each number opens a list of the implants or crowns behind it, with patient, tooth, placed date and the relevant status. Rows link to the patient chart.
8. **Research permission** (owner):
   - A new area `research` in the permission grid, with None / View only. There is no Edit, because nothing on the page writes.
   - Admins always have access. Organizers default to **None** until an admin grants View. Delegates never have access.
   - The page and its readers require View on Research. The readers are security invoker and read patient tables, so they also need View on Patients.
   - *My call:* granting Research View without Patients View shows a note: "Research needs View on Patients to read the records".

## Settled after the builder check

- **Crowns follow the implant filters** (owner, 2026-10-23):
  - A crown counts when at least one implant under it is in the filtered set: the same course, placement date range, placing delegate and brand / type.
  - This needs a second wrapper, `crown_outcomes_detail(...)`, which joins `crown_outcomes` to `restoration_sites` and applies the implant filters in SQL. All tiles then describe the same implants.
- *My call:* **denominators** are all placed implants in the filter. Every % shows its count.
  - The ICOI breakdown has two extra groups: **not assessable** and **not yet graded** (no assessable visit at all, i.e. `latest_grade` null).
  - Complication % = implants with ≥ 1 complication / all placed implants in the filter.
- *My call:* **no product.** Implants without a product are included under "all brands" and excluded when a brand is chosen. The page shows "N implants have no product recorded" whenever any exist in the unfiltered set.
- *My call:* **permission defaults.**
  - `app_private.default_permissions()` and the `set_user_permissions` area list gain `research`, but new organizers default to None, so the default set excludes it.
  - Existing organizers are untouched.
  - "No row" means None.
- *My call:* **Research without Patients view.** When the user has Research View but not Patients View, the page shows the note "Research needs View on Patients to read the records" instead of empty tiles.

## Non-goals
- Exports / CSV / data dictionary (part 6).
- Statistics beyond descriptive numbers and Kaplan–Meier, such as confidence intervals and comparisons (part 7).
- Changing any outcome rule (5a, `outcomes-v1`).

## Anti-goals
- A % shown without its count.
- "Not assessable" or "not reached" counted as success or survival.
- Outcome status recomputed in TS.

## Constraints
- Readers are security invoker. The brand / type and delegate filters need either new parameters on the 5a readers or filtering in TS on columns the readers return.
  - *My call:* add `placing_delegate_id`, `product brand` and `system` columns through a new reader `implant_outcomes_detail(...)` that wraps `implant_outcomes`. This avoids changing 5a's signature. Filtering happens in SQL.
- The permission area needs a migration:
  - add `research` to the area check and `public.can`;
  - the restrictive gate is `can('research','view')` on the new reader.
  - Follow the 0029–0034 patterns; `permissions.test.ts` must stay green.
- The chart is inline SVG with design tokens. No new chart dependency, so no CSP change.
- The page is phone-friendly: tiles stack, and the chart scales.

## Left to the builder
- The exact SVG drawing.
- The drill-down UI (a dialog or a sub-route).
- The order of the tiles on small screens.
