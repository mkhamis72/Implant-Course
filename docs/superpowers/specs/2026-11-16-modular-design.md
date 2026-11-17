# Design: modules per company (for pricing) — "Modular"

> **Status: PARKED (2026-11-16, revised 2026-11-17)**, waiting for the owner's review and decision. Nothing is built. A reviewer checked this design against the code on 2026-11-16, and the corrections are included below. The 2026-11-17 revision makes Checklists part of Core and adds the company type (Course organizer or Clinic). Before building, re-check the migration numbers it cites against the latest migrations, then write a plan per release (superpowers:writing-plans).

## Context

The owner wants to sell Implant Course Manager in plans, both to course organizers and to clinics (doctors who place implants but don't teach). Each company gets a set of **modules**. A module that is off disappears from that company's app, and the data stays. The owner sets this from the **console**. Company admins can't switch modules on themselves; they only see what their plan includes.

Today nothing like this exists. `public.companies` has no plan, type or feature columns, and every gate in the app is a per-user permission area. These are the 7 areas (`src/lib/auth/permissions.ts`, `public.can()` latest in `0089_company_guards.sql`, `require_perm` in `0030`):

- `patients`
- `schedule`
- `courses`
- `checklists`
- `inventory`
- `delegates`
- `research` (shown as Statistics)

Modules and the company type build on those areas.

## Decisions (the owner's)

- **Who switches modules:** the owner, from the console, per company. Company admins can't.
- **Switching a module off:** it is hidden, and its data is kept intact. Switching it back on restores everything.
- **Pricing shape:** plans plus extras. Each company has one plan, and the owner can add extra modules on top.
- **Where plans live:** they are editable in the console. Changing a plan updates every company on that plan.
- **What a company sees:** only the company admin sees a "Your plan" page, which lists the modules and marks missing ones "Not in your plan – contact us". Everyone else never sees missing modules.
- **Always on:** Patients (tooth chart, implants, restorations, follow-ups, radiographs, consent), Schedule, **Checklists**, Dashboard and Admin. Checklists are essential, so every plan has them (2026-11-17).
- **Company type (2026-11-17):** the owner sets each company to **Course organizer** or **Clinic** in the console.
  - A clinic never sees anything about teaching: no courses, delegates, lectures, workshops, lecturers, supervisors or delegate logins. That rules out menus, pages, fields (optional ones too), filters, reports, export columns, emails, and listings on the Your plan page, even as "Not in your plan".
  - Courses, delegates and supervisors are not modules a clinic could buy. They come with the Course organizer type.
  - academy, osdic and demo are Course organizers.
- **Inventory off:** implants are picked from the product catalogue only. There is no lot, no stock movement and no lot recall. Stock tracking starts from the day Inventory is switched on.
- **Clinics have clinic days:** Schedule works with surgery days that have no course, no delegates and no enrolment checks.
- **Doctors list:** a new admin-maintained list, Admin → Doctors (names, like Supervisors). In a clinic, the "Placed by" person on an implant and on a booking is always a doctor.
- **Inventory switched on later:** staff may attach a lot to an implant placed earlier without one, for lot recall. This **doesn't change stock**.

## Company types and modules

| | What it covers | Area(s) it gates |
|---|---|---|
| **Core** (always on, both types) | Dashboard, Patients, Schedule (surgery days and bookings), Checklists and templates, Admin, branding, consent | `patients`, `schedule`, `checklists` |
| **Teaching** (Course organizer type only; never in a clinic) | Courses, course days, lectures and workshops, lecturers, delegates, enrolments, delegate logins and the `/my` portal, course reports, the Statistics → Courses tab, the supervisor list and supervisor fields | `courses`, `delegates` |
| **Inventory** (module, either type) | Stock, lots, receiving, lot recall, pull-list shortages, dashboard stock card, implant picker with lots | `inventory` |
| **Statistics** (module, either type) | Results, Explore, studies, export, `analysis.R` | `research` |

- Teaching is not a switchable module. It follows the company type: always on for a Course organizer, absent for a Clinic.
- The only switchable modules are **Inventory** and **Statistics**. They are independent of each other and of the type.
- Doctors (Admin → Doctors) is part of Core for clinics. Course organizers keep "Placed by" a delegate (my call: doctors are hidden for them, so nothing changes for current users).

## How it works

**Data:**
- A new table `public.plans` holds `id`, `name`, `kind` and `modules text[]`.
- `public.companies` gets `kind` (`course_organizer` | `clinic`, default `course_organizer`), `plan_id` and `extra_modules text[]`.
- A company's plan must be of its kind. The console functions refuse a mismatch.
- `modules` and `extra_modules` hold only `inventory` and `statistics`. The names are a fixed list, checked in SQL and in TS.
- A company's effective features are core + teaching (if Course organizer) + its plan's modules + its extras.
- Migration: a **"Full"** Course organizer plan with both modules, assigned to academy, osdic and demo. **Nothing changes for current users.**

**Enforced in the database.**
- `public.can(area, level)` also returns false when the area's feature is off for the bound company, through a new `public.module_on(module)` (definer, owned by `tenant_definer`, reads the company's kind, plan and extras). `module_on('teaching')` is true exactly when the company is a Course organizer. This covers the area RLS policies and every `require_perm` definer function.
- **Performance:** the 0030 `area_policies` call `can()` unwrapped. Recreate them as `(select public.can(...))` so the module lookup runs once per query, not once per row.
- **Reads that bypass `can()`:** the reviewer found these, and each needs `module_on(...)` added directly:
  - the cross-area OR rules in 0032/0033/0081: stock movements readable through Patients/Schedule; courses, sessions and enrollments readable through Schedule/Patients;
  - `stock_lots`, `supervisors` and `lecturers`, which check only `is_active_user()`; `delegates`;
  - `my_schedule` and `my_report`, which check only `is_delegate_user()`;
  - `pull_list`, `inventory_overview` and `course_report`;
  - admin-only `research_exports`.

  Products stay readable, because the catalogue is core. Sessions stay readable in a clinic (clinic days); only their course link is hidden.
- **New `plans` table:** global, with no `company_id`. It gets forced RLS plus a `tenant_definer` policy, like `console_users` (0105).
- **Rows are never touched,** so switching back on restores everything. A DB test lists every policy and definer function that reads a module's tables and fails if one skips the module check, the same way `permissions.test.ts` does for `require_perm`.

**In the app:**
- `loadAccount` (`src/lib/auth/session.ts`) loads the company's kind and modules alongside the user's permissions.
- `canView`/`canEdit` return false for an area whose feature is off. As a result:
  - `visibleNavItems` (`src/components/nav-items.ts`) and the dashboard cards hide automatically;
  - `requirePermission(area)` redirects.
- A new `hasModule(account, 'teaching')` covers the parts that have no permission area: the supervisor fields and Admin → Supervisors, the lecturers list, the Statistics Courses tab, the delegate portal, and the Doctors list (shown when teaching is off).
- **Delegate logins:** in a clinic, a delegate login gets a "not available" page instead of `/my`.

**What a clinic never sees** (each is hidden when `hasModule(account, 'teaching')` is false, and the database refuses or returns nothing behind it):
- **Navigation and dashboard:** Courses, Delegates, Lectures and workshops; the dashboard's course cards.
- **Admin:** Supervisors; the delegate role in Users and Create login; the courses and delegates rows in the permission grid.
- **Patients:** the course and supervisor filters on the patient list (0098); course, delegate and supervisor fields on bookings, implants, components and restorations, including on old records (my call: consistent with "hidden, kept"); the course report.
- **Schedule:** course names on days and bookings; enrolment checks; "placing delegates", replaced by "Placed by" a doctor.
- **Statistics:** the Courses tab, Explore's course grouping, and the course, delegate and supervisor columns in the export dictionary (the export allowlist leaves them out).
- **Checklists:** links to `/courses/...` point to the Schedule day instead; the template scope "course day" reads "clinic day"; assignment emails name the day, not a course.
- **Your plan:** Courses and Supervisors are never listed.

**Console (owner only):**
- **Plans page:** add or rename a plan, set its kind, and tick its modules (Inventory, Statistics).
- **Company Details:** a type choice (Course organizer or Clinic), a plan dropdown limited to that type, and extra-module checkboxes.
- **Changing type:** allowed either way, and data is hidden and kept, as for modules. Course organizer → Clinic hides all course data; switching back restores it. The console asks for confirmation and names what will be hidden.
- The changes go through new `console_*` definer functions (pattern in `0105`, `src/lib/console/store.ts`).
- The `companies_list_audit` trigger is extended so type, plan and extras changes appear in the company History.
- The routing list cache (60 s) also carries the type and modules, so a change applies within a minute.

**Company admin:** Admin → Settings → **Your plan** is a read-only list of the modules for the company's type, each marked Included or "Not in your plan – contact us".

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
2. **Clinic type.**
   - **Course optional:** `place_implant_v3` and `correct_placement_v2` (0081) fail with "Choose the course." without one, so the course becomes optional for clinic days.
   - **Clinic days:** `sessions.course_id` becomes nullable. `check_session_in_course` allows a clinic day, and an **Add clinic day** joins `add_surgery_session` (0039). The `sessions_attach_checklist` trigger attaches the default checklist to clinic days too.
   - **Doctors:** add a `doctors` table (admin list, like `supervisors`) and `placing_doctor_id` on `implant_sites` and `surgery_slots`.
   - **Bookings:** `create_surgery_slot`/`update_surgery_slot` (0091) take a doctor instead of placing delegates and skip the enrolment check.
   - **Supervisors:** `surgery_slots.supervisor_id` is `not null` (0014), so that is dropped. The supervisor requirement in the placed check and in the slot/placement functions applies only to Course organizers.
   - **Placed check:** needs a placing delegate **or** a placing doctor.
   - **Reads that assume a course:**
     - the app's schedule queries embed `course:courses(name)` and must allow none;
     - `schedule/new` groups delegates by course;
     - `my_schedule` inner-joins courses but is off anyway.
   - **Checklists:** pages that read `session.course_id` link to the day when it is null.

- **Company export/restore:** it carries `kind`, `plan_id`, `extra_modules`, `doctors` and the new columns.

Each step is additive and backward compatible, so the previous app version keeps working during a release, per the CLAUDE.md release rule.

## Delivery: three releases, each one shippable

1. **Modules, plans and company type.** Tables, `module_on`, the `can()` gate and the bypass fixes, the TS gates, console Plans and company type/plan/extras, and the admin's Your plan page. Everyone starts on Full as a Course organizer, so users see no change.
   - **Statistics** becomes switchable here, because nothing else depends on it. Checklists are core.
   - The console offers only the Course organizer type and keeps Inventory "always on until release 2", so nothing can be switched off half-built.
2. **Inventory optional:** the catalogue-only implant path, and attaching a lot later.
3. **Clinic type:** the Doctors list, clinic days, placed by a doctor, and everything in "What a clinic never sees". The console then offers Clinic.

Each release gets its own short plan (superpowers:writing-plans) before any code.

## Not included

- Billing or payments: prices are handled outside the app.
- Company self-service upgrades.
- Usage limits such as user or patient counts.
- Deleting data.

## Verification

- **DB tests** (`tests/db/`): with a module off, its tables read nothing, its definer functions refuse, and other modules work. For a clinic, `module_on('teaching')` is false, and the course, delegate, supervisor and lecturer tables read nothing. A plan of the wrong kind is refused. Switching back on (or back to Course organizer) returns the identical rows (fingerprint, like `one-db-company-restore.test.ts`). `permissions.test.ts` checks that every new definer function goes through `require_perm`.
- **Unit tests:** module lists, effective features (core + type + plan + extras), and nav/dashboard filtering.
- **E2E:**
  - The console sets a local company to a Basic plan. The company's menu then lacks Inventory and Statistics but keeps Checklists. Direct URLs redirect. The admin's Your plan page shows the locked modules. Switching back to Full restores everything with the same data.
  - The console sets a local company to Clinic. No course, delegate, lecture or supervisor text, link or field appears on the patient form, the patient filters, Schedule, reports, the export header or Your plan. A clinic day can be added and booked with a doctor, and its checklist works.
- `npm run isolation:check` still passes, and `ship.sh verify` is green before each release.
