# Statistics module + dates checked at entry

## Context
The owner wants two changes:
1. **Research moves out of Patients** into its own top-level module like Courses and Delegates, named **Statistics** ("Statistics & data analysis" as the page title). The main user is an **organizer checking how one course's implants are doing**, so the module opens on a course picker and shows that course's results.
2. **No separate Data quality page.** Impossible dates should be stopped when they're entered. For example, a restoration can't be dated before its implant was placed, and the date picker itself shouldn't offer earlier dates.

What exists today: the database already refuses most impossible dates when saving (restoration fitted before placement 0057, components, follow-ups, visits, complications 0047, failure 0048/0049, scan 0054, restoration problems 0058, future X-rays 0064/0065, and moving placement after existing records 0053). `/patients/data-quality` (0068) only lists old rows saved before those rules existed. The gap is in the UI: no patient date input sets `min`/`max`, so mistakes surface only after Save. In the database, a non-planning X-ray can still be dated before placement.

Owner decisions: move and rename the module; open it on a course picker; check prod once for old bad dates and hand the list to the owner, then remove the page.

## Part A: Statistics module (PR 1)

- **Route move:** `src/app/(app)/patients/research/**` → `src/app/(app)/statistics/**` (page, drilldown, studies, studies/[id]/letter, export route, analysis.R route, filter-form, export-panel, research-view, CLAUDE.md). Keep `src/lib/research/` as is: no rename churn.
- **Redirects:** `next.config.ts` `redirects()` from `/patients/research/:path*` → `/statistics/:path*`, permanent: false, so bookmarks and old links work.
- **Nav:** add `{ href: '/statistics', label: 'Statistics', area: 'research' }` to `src/components/nav-items.ts` after Delegates. Check how nav filters by area and that `research` (not in `default_permissions()`) hides correctly for organizers with None.
- **Remove** the Research link from the Patients list (`patients/research-link.tsx` + test, its use in `patients/page.tsx`).
- **Permission label:** show the `research` area as "Statistics" in the permission grid (`admin/users/permission-grid.tsx` / its labels in `src/lib/…`). Label only, no SQL change.
- **Layout:** `statistics/layout.tsx` with `SectionNav` tabs **Results** (`/statistics`), **Export & studies** (`/statistics/data`, since `/statistics/export` is the download route: the export panel, Recent exports, Studies link, analysis.R link). Studies stays at `/statistics/studies`.
- **First screen = course picker + all filters visible:** course `<select>` first in the filter bar, using the existing `course` filter (`RESEARCH_FILTER_KEYS`, `src/lib/research/view.ts`). **Owner requirement: every filter stays visible and usable as today**: date from/to, implant brand, implant line (system), delegate, Compare by. Nothing is collapsed or moved to another tab; filters combine with the chosen course. *My call:* with no `course` param, default to the most recent course that has started (`course_options()` is ordered by start date desc; first with `start_date ≤ today`), or all courses if none has. "All courses" submits `course=all` (not empty, so it isn't replaced by the default); `rpcArgs` already treats any non-UUID as "all".
- **Internal links/strings:** update every `/patients/research` href (drilldown links, export form action, studies links, letter URLs, tests, E2E specs) and headings "Research" → "Statistics & data analysis". Update `patients/research/CLAUDE.md` (moved) and the root `CLAUDE.md` feature-rules pointer.
- Tests: move colocated tests with their files; update the route tests' paths; add a unit test for the default-course choice; E2E: adjust research/studies specs to `/statistics` and one redirect check.

## Part B: Dates limited at entry (PR 1)

- **Pickers:** add `min`/`max` to every implant-related date input, with `max = todayIso()` everywhere and `min` as below:
  - placement date (`implant-forms.tsx`, `surgical-details.tsx`): max today; extraction date ≤ placement
  - component fitted, follow-up/visit (`visits.tsx`), complication noticed/resolved (`complications.tsx`, resolved ≥ noticed), failure (`failure-box.tsx`), scan/impression (`impression-control.tsx`): min = placement date
  - restoration fitted (`restorations.tsx`): min = latest placement among the ticked implants, updated as ticks change (*my call*)
  - restoration problem: min = fitting date
  - X-ray (`xrays/radiograph-form.tsx`): max today; for non-planning purpose min = earliest placement on the chosen teeth, if any
  - Patient-level dates (DOB, HbA1c, consent signed, notes) get `max` today only.
  - Server checks stay as they are; the picker is a convenience. Pass the reference dates down from the page data that is already loaded (placed_on is on the site rows).
- **DB gap:** new migration `00NN_xray_before_placement.sql`: `create or replace` the **latest** radiograph save function (find it, after 0065) adding "A non-planning X-ray can't be before the placement date (%s)." when an implant exists on those teeth. Also check that the placement-date guard (latest definition after 0062) covers restorations, X-rays and scans, and extend it if not. Write the failing DB test first (`tests/db/`), dry-run in a rolled-back tx.

## Part C: Remove Data quality (PR 2, after the prod check)

1. **One-off prod check (read-only):** after PR 1 is live, run `select * from public.data_quality_issues(null)` against prod (scratchpad tsx script, `ENV_FILE=.env.prod`, `pgConfig()`). Give the owner the list (patient, file no, tooth, message); they fix the rows. Ask before running it, since it reads prod.
2. **Remove UI:** `patients/data-quality/` page, its link next to Recall list (`patients/page.tsx`), "Date problem" badges (`[id]/layout.tsx`, `implant-section.tsx`, `chart-data.ts`), `src/lib/data-quality/` (and any type in `inventory/types.ts`), related tests/E2E. Update `patients/CLAUDE.md`.
3. **Keep the SQL function** `data_quality_issues` (*my call*): dropping it would need the two-release dance and it's handy for future checks. Note in CLAUDE.md that it has no UI.

## Verification
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` (new X-ray test red → green).
- `./scripts/ship.sh verify` with the research/studies/statistics specs, restorations, xrays, patients specs.
- Manual (`npm run dev`): Statistics in the nav for admin, hidden for an organizer with Research None; opens on the latest course; old `/patients/research` URL redirects; export downloads; restoration date picker greys out days before placement; non-planning X-ray before placement refused.
- PR 2: Data quality link/badges gone; `tsc`/unit/E2E green.
