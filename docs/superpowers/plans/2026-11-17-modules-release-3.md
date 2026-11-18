# Modules release 3: Doctors list and the Clinic company type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every company gets an Admin → Doctors list, and an implant or booking can be "Placed by" a doctor. Course organizers keep delegates as the default. A company of type **Clinic** works with clinic days and doctors only, and never sees anything about courses, delegates, lectures, lecturers or supervisors. Data stays intact if the type changes back.

**Architecture:**
- **Doctors** are a new admin list, modelled on `supervisors`. Nullable `placing_doctor_id` columns go on `implant_sites` and `surgery_slots`, and the "placed" rule becomes "a delegate or a doctor".
- **Placement and booking functions** that need a new parameter get new versioned names (`place_implant_v4`, `correct_placement_v3`, `create_surgery_slot_v2`, `update_surgery_slot_v2`). The old ones stay for the previous app version during the release.
- **Teaching tables** get restrictive `module_on('teaching')` select policies, as Inventory got in release 2. Definers that touch teaching data check the module, and `module-guards.test.ts` gains the teaching map.
- **The app** reads `featureOn(profile.features, 'teaching')` and drops every teaching surface.
- **The console** finally offers the Clinic type.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 server components/actions, Zod v4, Vitest (unit + DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-modular-design.md`: Decisions (Company type, Clinics have clinic days, Doctors list (both types), delegates default for course organizers); "What a clinic never sees"; "Changing type"; item 2 of "How it changes the current app"; release 3 of "Delivery".

## Global Constraints

- **Nothing goes online without the owner's go-ahead:** no `git push`, PR, merge, `ship.sh ship`, Vercel or production database action. Local stack only.
- Branch `feat/modules-r3`, created from `feat/modules-r2` (PR #123, stacked on #122; neither is merged).
- New migrations start at `0114`. The latest today is `0113`, and each task's migration gets the next number.
- Additive and backward compatible. Every existing company is a Course organizer on Full, so nothing changes for them. The previous app version (release 2) must keep working: it calls `place_implant_v3`, `correct_placement_v2`, `create_surgery_slot` and `update_surgery_slot`, which stay and keep their current behaviour for Course organizers.
- **No overloads:** a function that needs a new parameter gets a new name, with no defaulted parameters. Widening what an existing parameter accepts (null) is fine. Change other functions with `create or replace` of the **latest** definition. Latest definitions:
  - `place_implant_v3`, `correct_placement_v2`, `add_restoration`: 0081, or later if a later migration redefines them; `place_implant_v3` was last redefined in 0112.
  - `create_surgery_slot`, `update_surgery_slot`: 0091.
  - `add_surgery_session`: 0039.
  - `app_private.check_session_in_course`: 0013.
  - `console_save_plan` / `console_set_company_plan`: 0111 / 0110.
  - `my_report`: 0111.
  - Always search the later migrations first.
- Spec rules:
  - **A clinic never sees anything about teaching:** no courses, delegates, lectures, workshops, lecturers, supervisors or delegate logins. That covers menus, pages, fields (optional ones too), filters, reports, export columns, emails, and listings on the Your plan page.
  - **Doctors (Admin → Doctors) are core for both types.** In a clinic, "Placed by" is always a doctor. A Course organizer chooses the placing delegate(s) (the default) or a doctor.
  - **Clinic days** are surgery days with no course, no delegates and no enrolment checks.
  - **Changing type** is allowed either way. Data is hidden and kept; the console asks for confirmation and names what will be hidden.
- Rules this plan decides (my calls; they apply in every task):
  - **Course organizer, placed by a doctor:** a course is still required (it is a course case), a supervisor is optional, and an assisting delegate is allowed (enrolment-checked as today). Placed by delegate: exactly today's rules.
  - **Clinic:** a doctor is required; the course, delegates, assisting delegate and supervisor must be null. A teaching value sent anyway fails with `Courses, delegates and supervisors are not used in your plan.`
  - Components keep "Fitted by" an organizer (staff) or delegate. In a clinic, only an organizer.
  - Restorations: in a clinic, the delegate, supervisor and course stay null; the same refusal applies if one is sent.
  - CSV exports keep their teaching columns, empty for a clinic. Exception: the Statistics research export drops the course, delegate and supervisor study-code columns for a clinic, because its dictionary is an allowlist.
- Copy (exact):
  - `Doctors` (Admin nav and page title)
  - `Placed by` with the choices `Delegate` / `Doctor`
  - `Add clinic day`
  - `Choose the doctor who placed the implant.`
  - `Courses, delegates and supervisors are not used in your plan.`
  - `Delegate logins are not used in your plan.`
  - On `/my` for a clinic: `This page is not available for your organisation.`
  - Template scope label in a clinic: `Clinic day`
- Styling: named tokens and shared classes only. No Prettier. Files are CRLF. React 19 form rules (CLAUDE.md).

## Review Focus

1. **A Course organizer places by a doctor, then a delegate report or course report is opened:** the implant still appears (placed by the doctor); no crash on a null delegate. Covered by the Task 2 DB test `course_report lists a doctor placement` and the Task 9 E2E.
2. **A company switched from Course organizer to Clinic:** old implants that have delegates, supervisors and courses show none of them anywhere, and switching back shows them all again. Covered by the Task 3 DB fingerprint test `teaching hidden and restored` and the Task 9 E2E.
3. **A clinic's Statistics export:** there are no course, delegate or supervisor columns, and the remaining columns line up. Covered by the Task 7 unit test `clinic export drops teaching codes`.
4. **A delegate login in a company that becomes a Clinic:** it gets the not-available page and reads nothing through `my_schedule` / `my_report` / `my_restorations`. Covered by the Task 3 DB test and a Task 4 component test.
5. **Clinic day booking and placement:** a doctor booking on a clinic day, then placing from it (the slot's doctor carries over), marks the slot done. Covered by the Task 2 DB test `clinic slot to placement` and the Task 9 E2E.

---

### Task 1: Database — doctors, placing-doctor columns, relaxed constraints, clinic days

**Files:**
- Create: `web/supabase/migrations/0114_doctors_and_clinic_days.sql`
- Create: `web/tests/db/doctors.test.ts`
- Modify: `docs/operations.md` §D only if the migration seeds rows; it shouldn't.

**Interfaces:**
- Produces (SQL):
  - `public.doctors`: copy the `public.supervisors` table definition, company policies, grants, audit trigger and FK index pattern; columns `id`, `company_id`, `name`, `active`, plus whatever timestamps `supervisors` has.
  - The same RLS as `supervisors`: select for `is_active_user()`, insert/update for `is_admin()`. Add the restrictive `doctors_area_*` / shared-table handling the permissions guard expects (list it with the shared tables, like `supervisors`).
  - `implant_sites.placing_doctor_id uuid references public.doctors(id)` and `surgery_slots.placing_doctor_id uuid references public.doctors(id)`, both nullable with indexes (`fk-indexes` test).
  - Constraint `implant_sites_placed_details`: latest from 0112. Re-add as `state in ('planned','removed') or (product_id is not null and placed_on is not null and (placing_delegate_id is not null or placing_doctor_id is not null))`. The supervisor requirement moves into the functions.
  - `alter table public.surgery_slots alter column supervisor_id drop not null`.
  - `alter table public.sessions alter column course_id drop not null`.
  - `app_private.check_session_in_course()`: when `new.course_id is null`, allow it only when `not public.module_on('teaching')`, else fail `Choose the course.`; otherwise today's date-range check.
- Consumes: `public.module_on` (release 1).

- [ ] **Step 1: Create the branch.** `git switch -c feat/modules-r3` from `feat/modules-r2`.
- [ ] **Step 2: Failing tests** in `doctors.test.ts`:
  - `admin manages doctors`: an admin inserts and updates; an organizer's insert is refused; an organizer can read.
  - `a placed implant may have a doctor instead of a delegate`: as postgres, insert a placed site with `placing_doctor_id` and no delegate or supervisor → accepted. Neither delegate nor doctor → violates `implant_sites_placed_details`.
  - `clinic day needs no course only in a clinic`: academy `kind='clinic'` → a session with null `course_id` is accepted. Course organizer → `Choose the course.`
- [ ] **Step 3:** `npm run test:db -- doctors` → FAIL.
- [ ] **Step 4: Write 0114** (dry-run in a rolled-back transaction first).
- [ ] **Step 5:** `npm run test:db -- doctors permissions fk-indexes one-db-guards tenant-isolation one-db-company-restore` → PASS. `company-export` should carry `doctors` through `company_tables()` automatically; check that and say so.
- [ ] **Step 6: Commit** — "Doctors list; placing doctor on implants and bookings; clinic days without a course (0114)"

### Task 2: Database — placing and booking with a doctor; clinic rules

**Files:**
- Create: `web/supabase/migrations/0115_placed_by_doctor.sql`
- Test: `web/tests/db/placed-by-doctor.test.ts`

**Interfaces:**
- Produces (SQL, all `security definer`, owner `tenant_definer`, `require_perm` as their originals, execute to `authenticated` only):
  - `public.place_implant_v4(<v3 params in order>, p_placing_doctor uuid) returns uuid`: the v3 body (latest, 0112) with these rules:
    - **Course organizer** (`module_on('teaching')`): exactly one of `p_placing_delegate` / `p_placing_doctor`, else `Choose the delegate who placed the implant.` for neither and `Choose a delegate or a doctor, not both.` for both.
      - Delegate: today's rules.
      - Doctor: the doctor must be active (`Choose the doctor who placed the implant.`); the course is required; the supervisor is optional; an assisting delegate is allowed and enrolment-checked.
    - **Clinic:** `p_placing_doctor` required (`Choose the doctor who placed the implant.`); any non-null delegate, assisting delegate, supervisor or course → `Courses, delegates and supervisors are not used in your plan.`
    - A slot with a `placing_doctor_id` and no doctor given → use the slot's doctor (as v3 does for slot data).
    - Stores `placing_doctor_id`.
  - `public.correct_placement_v3(<v2 params in order>, p_placing_doctor uuid) returns void`: the same rules on correction.
  - `public.create_surgery_slot_v2(<create_surgery_slot params in order, no defaults>, p_placing_doctor uuid) returns uuid` and `public.update_surgery_slot_v2(<update params in order, no defaults>, p_placing_doctor uuid) returns void`:
    - **Course organizer:** placing delegates (today, with supervisor required) or a doctor (no placing delegates; supervisor optional; assisting delegates allowed; no enrolment check for the doctor).
    - **Clinic:** a doctor required; `p_placing`/`p_assisting` empty; supervisor null. The session must be a clinic day or any session of the company.
  - `public.add_surgery_session(p_course, …)`, same signature. **Clinic:** `p_course` must be null (else the not-used message); creates a clinic day. **Course organizer:** unchanged.
  - `public.add_restoration` / `public.update_restoration`, same signatures. **Clinic:** a non-null `p_delegate`/`p_supervisor`/`p_course` → the not-used message.
  - `public.place_implant_v3` / `correct_placement_v2` / `create_surgery_slot` / `update_surgery_slot`: unchanged.

- [ ] **Step 1: Failing tests** (`placed-by-doctor.test.ts`):
  - Organizer, by doctor: `place_implant_v4` with a doctor and a course, no supervisor → placed, `placing_doctor_id` set. Both delegate and doctor → `Choose a delegate or a doctor, not both.`
  - Organizer, by delegate via v4 with a null doctor → same as v3 (supervisor still required: `Choose an active supervisor.`).
  - `course_report lists a doctor placement`: the row appears with a null placing delegate.
  - Clinic: `kind='clinic'` → v4 with doctor only → placed. With a course or supervisor → `Courses, delegates and supervisors are not used in your plan.` No doctor → `Choose the doctor who placed the implant.`
  - `clinic slot to placement`: a clinic day via `add_surgery_session(null, …)`, then `create_surgery_slot_v2(..., p_placing => '{}', p_supervisor => null, ..., p_placing_doctor => d)`, then `place_implant_v4(... p_slot => slot, p_placing_doctor => null ...)` → takes the slot's doctor, and the slot status becomes `done`.
  - Clinic restoration with a delegate → refused; without → accepted.
  - Old v3 still works for an organizer (regression).
- [ ] **Step 2:** `npm run test:db -- placed-by-doctor` → FAIL.
- [ ] **Step 3: Write 0115** (dry-run first).
- [ ] **Step 4:** `npm run test:db -- placed-by-doctor doctors course-delegates implants restorations permissions tenant-isolation module-guards` (the real file names) → PASS.
- [ ] **Step 5: Commit** — "Place, correct and book with a doctor; clinic rules; clinic days (0115)"

### Task 3: Database — teaching hidden in a clinic; console offers Clinic

**Files:**
- Create: `web/supabase/migrations/0116_teaching_gated.sql`
- Modify: `web/tests/db/module-guards.test.ts` (teaching map), `web/tests/db/modules-console.test.ts` (clinic is now allowed), `web/tests/db/modules.test.ts` if it asserts clinic refusal
- Test: `web/tests/db/modules-teaching.test.ts`

**Interfaces:**
- Produces (SQL):
  - Restrictive select policies `<table>_module_read`, `to authenticated`, using `(select public.module_on('teaching'))`, on `courses`, `delegates`, `enrollments`, `lecturers`, `supervisors`, `talks`, `slot_delegates`, `study_courses`.
  - `lecturers` and `supervisors` also get restrictive insert/update policies with the same check. Their write policies use only `is_admin()`. `public.sessions` stays readable (clinic days).
  - `my_schedule`, `my_report`, `my_restorations` (latest definitions): return no rows when `not public.module_on('teaching')`.
  - `course_options`, `patient_course_options`: return no rows when teaching is off.
  - `create_talk`, `update_talk`, `delete_talk`, `delete_course`, `delete_delegate`: fail with `Courses, delegates and supervisors are not used in your plan.` when teaching is off.
  - `create_pending_login`, `add_existing_member`, `set_member_role` with role `delegate`: fail with `Delegate logins are not used in your plan.` when teaching is off.
  - `console_save_plan` and `console_set_company_plan`: recreate from their latest definitions **without** the `Clinic … come in a later release.` refusals. Every other check stays, including plan kind = company kind.
  - Guard: `MODULE_TABLES.teaching` = the eight tables above. Every public definer that names them checks `module_on('teaching')` or `can('courses'|'delegates'`, or is in ALLOWED with a reason (e.g. `can`, `set_user_permissions`, `delete_patient`, the admin user functions that only read roles). No stale entries.
- Consumes: `module_on` (release 1); the v4/v2 functions (Task 2), which already check teaching.

- [ ] **Step 1: Failing tests** (`modules-teaching.test.ts`):
  - `clinic reads no teaching rows`: academy `kind='clinic'` → as the admin, `count(*)` is 0 for each of the eight tables (each seeded or non-zero first on Course organizer), while `sessions` is still readable.
  - `teaching hidden and restored`: md5 fingerprints of `courses`, `delegates` and `enrollments` are equal before the switch to clinic and after switching back.
  - Delegate login in a clinic: `my_schedule()`, `my_report()` and `my_restorations()` return 0 rows.
  - `create_pending_login(..., 'delegate', ...)` in a clinic → `Delegate logins are not used in your plan.`
  - Console: `console_set_company_plan('academy','clinic', <a clinic plan saved via console_save_plan(null,'Zz Clinic','clinic','{}','x')>, '{}', 'x')` succeeds; the kind mismatch is still refused.
- [ ] **Step 2:** `npm run test:db -- modules-teaching module-guards` → FAIL.
- [ ] **Step 3: Write 0116** (dry-run first).
- [ ] **Step 4:** `npm run test:db` (full suite, once) → PASS.
- [ ] **Step 5: Commit** — "Teaching data closed in a clinic; delegate logins refused there; the console can choose Clinic (0116)"

### Task 4: App — Doctors page, teaching helper, Admin and delegate portal

**Files:**
- Create: `web/src/app/(app)/admin/doctors/{page.tsx,actions.ts,doctor-row.tsx}`, copied from `admin/supervisors/*` with doctors names and copy, plus tests mirroring the supervisors tests.
- Modify:
  - `web/src/lib/modules/modules.ts`: `export function teachingOn(features: readonly Feature[]): boolean`, equal to `featureOn(features, 'teaching')`.
  - The Admin layout nav (`web/src/app/(app)/admin/layout.tsx`): add `Doctors` for both types; hide `Supervisors` and `Lecturers` when teaching is off. Their pages redirect to `/admin/users` when teaching is off.
  - `admin/users` user row and Create login: no `delegate` role option and no "linked delegate" picker when teaching is off (`lib/admin/schemas.ts` keeps accepting the role; the DB refuses).
  - `web/src/app/(app)/my/layout.tsx` (or the delegate pages' shared guard): when teaching is off, render `This page is not available for your organisation.` instead of the delegate pages.

- [ ] **Step 1: Failing tests:**
  - `teachingOn`.
  - Admin nav: with teaching off, there is a Doctors link and no Supervisors or Lecturers link.
  - Doctors page actions: add and rename (mirror the supervisors tests).
  - User row: no "Delegate" role option when teaching is off.
  - `/my` with teaching off shows the not-available text.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Admin → Doctors; a clinic's Admin and delegate portal show nothing about teaching"

### Task 5: App — Patients: placed by delegate or doctor; teaching fields hidden in a clinic

**Files:**
- Modify:
  - `web/src/app/(app)/patients/[id]/`: `implant-forms.tsx`, `implant-actions.ts`, `corrections.tsx`, `site-details.tsx`, the restoration form and actions, and `chart-data.ts` (load `doctors`, set `ChartData.teachingOn`).
  - `web/src/lib/inventory/schemas.ts` (place and correct schemas: `placingDoctorId: optionalUuid`).
  - The patient list filters: the course and supervisor filters from 0098 (`web/src/app/(app)/patients/page.tsx` and its filter lib).
  - Tests next to each.
- **Interfaces:**
  - `ChartData.teachingOn: boolean`; `ChartData.doctors: { id: string; name: string }[]` (active doctors).
  - The place action calls `place_implant_v4` with `p_placing_doctor`, and the correction action calls `correct_placement_v3`.
- **Behaviour:**
  - **Course organizer:** the place and correct forms show `Placed by` with the radios `Delegate` (default, today's delegate pickers and supervisor) and `Doctor` (a doctor select; supervisor optional; assisting delegate still offered). Course stays.
  - **Clinic:** no course, delegate, assisting delegate or supervisor fields at all; a required doctor select.
  - Component form: no "fitted by delegate" option and no course field when teaching is off.
  - Restoration form: no delegate, supervisor or course fields when teaching is off.
  - Site details: a `Placed by <doctor>` line when there is a doctor; no supervisor, course or delegate lines when teaching is off.
  - Patient list: no course or supervisor filters when teaching is off.
  - Radios remount on result (`key`), per CLAUDE.md.

- [ ] **Step 1: Failing tests:**
  - Place form, organizer: Delegate is checked by default; choosing Doctor shows the doctor select and submits `placingDoctorId` with `placingDelegateId: null`.
  - Place form, clinic: no "Supervisor", "Course" or "delegate" text; the doctor is required.
  - Site details, clinic: no "Supervisor" text even if `site.supervisor` is present.
  - Patient list filters, clinic: no Course or Supervisor filter.
  - Restoration form, clinic: no delegate, supervisor or course fields.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Patients: placed by a delegate or a doctor; a clinic sees no course, delegate or supervisor fields"

### Task 6: App — Schedule: bookings by doctor, clinic days, no lectures in a clinic

**Files:**
- Modify:
  - `web/src/app/(app)/schedule/new/` and `schedule/[id]/edit/`: the booking forms and actions. Use `create_surgery_slot_v2` / `update_surgery_slot_v2`.
  - `web/src/app/(app)/schedule/page.tsx` (day view), `schedule/_talks/*` (lectures and workshops), the "add surgery day" UI (`add_surgery_session`).
  - `web/src/lib/schedule/*` (types and queries that embed `course:courses(name)` must allow null).
  - Tests next to each.
- **Behaviour:**
  - **Course organizer:** the booking form gains `Placed by` with `Delegate` (default, today) / `Doctor` (doctor select; placing delegates hidden; supervisor optional). Delegates stay grouped by course as today.
  - **Clinic:** the booking form shows a doctor select and none of course, delegates or supervisor. "Add surgery day" becomes `Add clinic day` (no course field). The day view shows no course names. The lectures and workshops section and its controls are hidden, and their routes redirect to `/schedule`. Booking titles show the doctor's name where they showed delegates.
- [ ] **Step 1: Failing tests:**
  - Booking form, organizer: Delegate is the default; choosing Doctor submits `placingDoctorId` and empty placing delegates.
  - Booking form, clinic: no "Supervisor" or "delegate" text; `Add clinic day` shows and has no course select.
  - Talks section hidden in a clinic (a component test, or the E2E in Task 9 if there's no harness; say which).
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Schedule: book by delegate or doctor; a clinic has clinic days and no lectures"

### Task 7: App — Statistics, reports and checklists in a clinic

**Files:**
- Modify:
  - `web/src/app/(app)/statistics/` (layout tabs: hide `Courses`; `studies` course links; `explore` and `web/src/lib/analysis/{variables,choices,filters}.ts`: no course, delegate or supervisor grouping or filters when teaching is off).
  - `web/src/lib/research/export/{dictionary,assemble}.ts`: drop `course_code`, `placing_delegate_code`, `supervisor_code`, `delegate_code` when teaching is off, and keep the other columns aligned with `reader-columns.fixture.ts`.
  - Checklists: `web/src/app/(app)/checklists/page.tsx` and `[id]/page.tsx` (when `session.course_id` is null or teaching is off, link to `/schedule?date=<session.date>` instead of `/courses/...`); the template form scope label `Clinic day` when teaching is off; `web/src/lib/checklists/notify.ts` (the email names the day, not a course, when there is no course).
  - Tests next to each.
- [ ] **Step 1: Failing tests:**
  - `clinic export drops teaching codes`: assembling with teaching off has no `course_code`, `placing_delegate_code`, `supervisor_code` or `delegate_code` in any table header, and the rows match the headers.
  - Explore choices, teaching off: no course, delegate or supervisor variable.
  - Statistics tabs, teaching off: no Courses tab.
  - Checklist link for a clinic day goes to `/schedule?date=…`.
  - The notify email for a session with no course has no "course" text.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Statistics, exports and checklists in a clinic: no courses, delegates or supervisors"

### Task 8: Console — choose Clinic, with confirmation

**Files:**
- Modify:
  - `web/src/lib/modules/modules.ts` (`KIND_AVAILABLE.clinic = true`).
  - `web/src/app/console/(admin)/plans/plan-form.tsx` and `companies/[slug]/forms.tsx` (`PlanFields`).
  - `web/src/lib/console/schemas.ts`, `web/src/app/console/(admin)/actions.ts`.
  - Tests.
- **Behaviour:**
  - Clinic can be chosen in both forms; the plan select lists only plans of the chosen kind.
  - Changing a company's type requires ticking a confirmation checkbox named `confirm_kind_change`. Its label: `I understand: switching to Clinic hides courses, delegates, lectures, lecturers, supervisors and delegate logins (kept, not deleted).` Switching to Course organizer instead: `I understand: switching to Course organizer shows them again.`
  - The action refuses a type change without it: `Tick the box to confirm the change of type.`
- [ ] **Step 1: Failing tests:**
  - The Clinic option is enabled.
  - A type change without the confirmation → the error above.
  - With it → `store.setCompanyPlan` is called with `clinic`.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test -- console`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Console: a company can be a Clinic, after confirming what will be hidden"

### Task 9: End-to-end

**Files:**
- Create: `web/tests/e2e/doctors.spec.ts`, `web/tests/e2e/clinic.spec.ts`

Use the pattern of `modules.spec.ts` / `inventory-off.spec.ts`: switch academy by SQL (`withPg`), and in `afterAll` / `finally` restore `kind='course_organizer'` and the Full plan, then delete the E2E plans and doctors.

- [ ] **Step 1: `doctors.spec.ts`** (Course organizer):
  - The admin adds doctor `uniqueName()` in Admin → Doctors.
  - On a new patient, place an implant with `Placed by` → `Doctor`. Saved, and site details show `Placed by <doctor>`.
  - The course report still lists that implant.
- [ ] **Step 2: `clinic.spec.ts`** (academy set to `kind='clinic'` with a clinic plan):
  - **`a clinic sees nothing about teaching`:** none of `Courses`, `Delegates`, `Supervisor`, `Lecture`, `Workshop` (case-insensitive) in the main nav, Admin nav, the patient list filters, the place-implant form or the Schedule page. `/courses`, `/delegates`, `/admin/supervisors`, `/admin/lecturers` and `/statistics/courses` all redirect. The Your plan page has no Courses row.
  - **`clinic day to placement`:** `Add clinic day` for today, book a new patient with a doctor, then place the implant from that booking. The implant shows `Placed by <doctor>`; the booking shows as done.
  - **`checklist on a clinic day`:** the day's default checklist exists (if a default `surgery_day` template exists; seed one in the test otherwise) and links to the Schedule day.
- [ ] **Step 3: Run** `npx playwright test doctors clinic --project=chromium`. Check memory and :3000 first, and stop any server you start. Expected: PASS.
- [ ] **Step 4: Commit** — "E2E: doctors for course organizers; a clinic company end to end"

### Task 10: Local verification and docs (no release)

- [ ] **Step 1:** `./scripts/ship.sh verify doctors clinic modules inventory-off` (the `verify` subcommand only). Then run in parts the existing specs that touch placement, bookings, courses, delegates and the portal: `implants slot-placement schedule courses course-delegates delegate-portal course-report statistics-courses admin`, using the spec names that exist. Then `npm run isolation:check` on the local stack → 0.
- [ ] **Step 2: Docs.**
  - Repo-root `CLAUDE.md`, Modules paragraph:
    - 0114–0116: doctors, `placing_doctor_id`, the v4/v2 functions and their rules, clinic days, teaching tables closed by `module_on('teaching')`, delegate logins refused in a clinic;
    - the console offers Clinic;
    - the module-guards teaching map;
    - remove "Course organizer only".
  - `web/src/app/(app)/patients/CLAUDE.md` and `schedule/CLAUDE.md`: one line each on "Placed by" delegate or doctor and on clinic days.
  - `web/src/app/(app)/admin/CLAUDE.md`: Admin → Doctors.
  - Commit "Docs: doctors and the Clinic type".
- [ ] **Step 3: Stop.** Report the branch and what was verified. PR #122, PR #123 and this branch all wait for the owner.
