# Design: modules per company (for pricing) — "Modular"

> **Status: PARKED (2026-11-16)**, waiting for the owner's review and decision. Nothing is built. A reviewer checked this design against the code on 2026-11-16, and the corrections are included below. Before building, re-check the migration numbers it cites against the latest migrations, then write a plan per release (superpowers:writing-plans).

## Context

The owner wants to sell Implant Course Manager in plans. Each company gets a set of **modules**. A module that is off disappears from that company's app, and the data stays. The owner sets this from the **console**. Company admins can't switch modules on themselves; they only see what their plan includes.

Today nothing like this exists. `public.companies` has no plan or feature columns, and every gate in the app is a per-user permission area. These are the 7 areas (`src/lib/auth/permissions.ts`, `public.can()` latest in `0089_company_guards.sql`, `require_perm` in `0030`):

- `patients`
- `schedule`
- `courses`
- `checklists`
- `inventory`
- `delegates`
- `research` (shown as Statistics)

Modules build on those areas.

## Decisions (the owner's)

- **Who switches modules:** the owner, from the console, per company. Company admins can't.
- **Switching a module off:** it is hidden, and its data is kept intact. Switching it back on restores everything.
- **Pricing shape:** plans plus extras. Each company has one plan, and the owner can add extra modules on top.
- **Where plans live:** they are editable in the console. Changing a plan updates every company on that plan.
- **What a company sees:** only the company admin sees a "Your plan" page, which lists the modules and marks missing ones "Not in your plan – contact us". Everyone else never sees missing modules.
- **Always on:** Patients (tooth chart, implants, restorations, follow-ups, radiographs, consent), Schedule, Dashboard and Admin.
- **Inventory off:** implants are picked from the product catalogue only. There is no lot, no stock movement and no lot recall. Stock tracking starts from the day Inventory is switched on.
- **Courses off:** Schedule works with **clinic days**: surgery days with no course, no delegates and no enrolment checks. Lectures and workshops come only with Courses.
- **Doctors list:** a new admin-maintained list, Admin → Doctors (names, like Supervisors). When Courses & Delegates is off, the "Placed by" person on an implant (and on a clinic-day booking) is a doctor instead of a delegate.
- **Inventory switched on later:** staff may attach a lot to an implant placed earlier without one, for lot recall. This **doesn't change stock**.

## Modules

| Module | What it covers | Area(s) it gates |
|---|---|---|
| **Core** (always on) | Dashboard, Patients, Schedule (surgery days and bookings), Admin, branding, consent | `patients`, `schedule` |
| **Courses & Delegates** | Courses, course days, lectures and workshops, lecturers, delegates, enrolments, delegate logins and the `/my` portal, course reports, the Statistics → Courses tab | `courses`, `delegates` |
| **Inventory** | Stock, lots, receiving, lot recall, pull-list shortages, dashboard stock card, implant picker with lots | `inventory` |
| **Checklists** | Checklists and templates | `checklists` |
| **Statistics** | Results, Explore, studies, export, `analysis.R` | `research` |
| **Supervisors** | The supervisor list, and the supervisor fields on bookings, implants and restorations | (admin list) |

Courses and Delegates are one module, because delegates exist only within courses.

## How it works

**Data:**
- A new table `public.plans` holds `id`, `name` and `modules text[]`.
- `public.companies` gets `plan_id` and `extra_modules text[]`.
- A company's modules are core + its plan's modules + its extras.
- Module names are a fixed list, checked in SQL and in TS.
- Migration: a **"Full"** plan with every module, assigned to academy, osdic and demo. **Nothing changes for current users.**

**Enforced in the database.**
- `public.can(area, level)` also returns false when the area's module is off for the bound company, through a new `public.module_on(module)` (definer, owned by `tenant_definer`, reads the company's plan and extras). This covers the area RLS policies and every `require_perm` definer function.
- **Performance:** the 0030 `area_policies` call `can()` unwrapped. Recreate them as `(select public.can(...))` so the module lookup runs once per query, not once per row.
- **Reads that bypass `can()`:** the reviewer found these, and each needs `module_on(...)` added directly:
  - the cross-area OR rules in 0032/0033/0081: stock movements readable through Patients/Schedule; courses, sessions and enrollments readable through Schedule/Patients;
  - `stock_lots`, `supervisors` and `lecturers`, which check only `is_active_user()`; `delegates`;
  - `my_schedule` and `my_report`, which check only `is_delegate_user()`;
  - `pull_list`, `inventory_overview` and `course_report`;
  - admin-only `research_exports`.

  Products stay readable, because the catalogue is core.
- **New `plans` table:** global, with no `company_id`. It gets forced RLS plus a `tenant_definer` policy, like `console_users` (0105).
- **Rows are never touched,** so switching back on restores everything. A DB test lists every policy and definer function that reads a module's tables and fails if one skips the module check, the same way `permissions.test.ts` does for `require_perm`.

**In the app:**
- `loadAccount` (`src/lib/auth/session.ts`) loads the company's modules alongside the user's permissions.
- `canView`/`canEdit` return false for an area whose module is off. As a result:
  - `visibleNavItems` (`src/components/nav-items.ts`) and the dashboard cards hide automatically;
  - `requirePermission(area)` redirects.
- A new `hasModule(account, 'supervisors')` covers the parts that have no permission area:
  - the supervisor fields and Admin → Supervisors;
  - the lecturers list;
  - the Statistics Courses tab;
  - the delegate portal.
- **Delegate logins:** if Courses & Delegates is off, a delegate login gets a "not available" page instead of `/my`.

**Console (owner only):**
- **Plans page:** add or rename a plan and tick its modules.
- **Company Details:** a plan dropdown and extra-module checkboxes.
- The changes go through new `console_*` definer functions (pattern in `0105`, `src/lib/console/store.ts`).
- The `companies_list_audit` trigger is extended so plan and extras changes appear in the company History.
- The routing list cache (60 s) also carries the modules, so a change applies within a minute.

**Company admin:** Admin → Settings → **Your plan** is a read-only list of modules, each marked Included or "Not in your plan – contact us".

## How it changes the current app (the database changes)

1. **Inventory off.**
   - **Placed-implant check:** `implant_sites_placed_details` (0010, never changed) requires a lot, placing delegate and supervisor for every state except planned and removed. Relax the lot part.
   - **Placing and fitting:**
     - `place_implant_v3` (0081) skips `lock_lot`/`insert_use` when there is no lot.
     - `fit_component_v2` (0090) gets a "product, no lot" path.
   - **App:** the inline "receive stock" action in `implant-actions.ts` (the only place that asks for inventory edit) hides.
   - **Corrections and the pull list:**
     - `correct_batch` (0030) gets a product-only correction and an **attach a lot later** path that doesn't change stock.
     - The pull list hides.
   - **Older placements:** `remove_placement` and `delete_patient` still remove the stock movements of placements made earlier, so the ledger stays consistent (my call).
   - **Lot recall** (`/inventory/recall`) goes with the module.
2. **Courses off (clinic days).**
   - **Blocker found:** `place_implant_v3` and `correct_placement_v2` (0081) fail with "Choose the course." without one, so the course becomes optional for clinic days.
   - **Course days:** `sessions.course_id` becomes nullable. `check_session_in_course` allows a clinic day, and an **Add clinic day** joins `add_surgery_session` (0039).
   - **Bookings:** `create_surgery_slot`/`update_surgery_slot` (0091) take a doctor instead of placing delegates and skip the enrolment check.
   - **Reads that assume a course:**
     - the app's schedule queries embed `course:courses(name)` and must allow none;
     - `schedule/new` groups delegates by course;
     - `my_schedule` inner-joins courses but is off anyway.
   - **Hidden:** lectures and workshops, and the Statistics Courses tab.
   - **Checklists off:** the `sessions_attach_checklist` trigger stops writing checklists.
3. **Supervisors off.**
   - `surgery_slots.supervisor_id` is `not null` (0014), so that is dropped.
   - The supervisor requirement in the placed check and in the slot/placement functions applies only when the module is on.
   - Supervisor names hide everywhere, including on old records (my call: consistent with "hidden, kept").
4. **Delegates off.**
   - Add a `doctors` table (admin list, like `supervisors`).
   - Add `placing_doctor_id` on `implant_sites` and `surgery_slots`.
   - The placed check needs a placing delegate **or** a placing doctor.

- **Module combinations:** any combination is allowed, since each module is made independent (my call).
- **Company export/restore:** it carries `plan_id`, `extra_modules`, `doctors` and the new columns.

Each step is additive and backward compatible, so the previous app version keeps working during a release, per the CLAUDE.md release rule.

## Delivery: four releases, each one shippable

1. **Modules and plans.** Tables, `module_on`, the `can()` gate and the bypass fixes, the TS gates, console Plans and company plan/extras, and the admin's Your plan page. Everyone starts on Full, so users see no change.
   - **Checklists** and **Statistics** become switchable here, because nothing else depends on them.
   - The console marks the other modules "always on until release N" so none can be switched off half-built.
2. **Inventory optional:** the catalogue-only implant path, and attaching a lot later.
3. **Supervisors optional, and the Doctors list.**
4. **Courses & Delegates optional:** clinic days, placed by a doctor.

Each release gets its own short plan (superpowers:writing-plans) before any code.

## Not included

- Billing or payments: prices are handled outside the app.
- Company self-service upgrades.
- Usage limits such as user or patient counts.
- Deleting data.

## Verification

- **DB tests** (`tests/db/`): with a module off, its tables read nothing, its definer functions refuse, and other modules work. Switching back on returns the identical rows (fingerprint, like `one-db-company-restore.test.ts`). `permissions.test.ts` checks that every new definer function goes through `require_perm`.
- **Unit tests:** module lists, effective modules (plan + extras + core), and nav/dashboard filtering.
- **E2E:** console sets a local company to a Basic plan. The company's menu then lacks Inventory, Checklists, Statistics and Courses. Direct URLs redirect. The admin's Your plan page shows the locked modules. Switching back to Full restores everything with the same data.
- `npm run isolation:check` still passes, and `ship.sh verify` is green before each release.
