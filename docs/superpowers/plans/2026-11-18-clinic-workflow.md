# Clinic workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic books surgeries directly, optionally recording where they happen (In clinic / GA in hospital). Its users are Admins and Doctors, with a Doctor login linked to its Doctors-list entry. Patients sign a clinic consent form. Course organizers see no change.

**Architecture:**
- **Booking:** new booking functions `create_surgery_slot_v3` / `update_surgery_slot_v3` take a date and a setting. In a clinic they find or create that date's hidden clinic day inside the same transaction, under an advisory lock, so a failure leaves no empty day and two bookings never create two days.
- **Doctors:** a nullable `doctors.user_id` links a login to its Doctors-list entry. A pending login carries the chosen or new doctor until the account exists, and the existing sign-up trigger makes the link.
- **Consent:** the clinic consent template and the clinic tick-box labels live in TS and are picked by `teachingOn`. The template pre-fills the existing "new version" form.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 server components/actions, Zod v4, Vitest (unit + DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-clinic-workflow-design.md` (and its PDF).

## Global Constraints
- **Nothing goes online without the owner's go-ahead:** no push, PR, merge, `ship.sh ship`, Vercel or production database action. Local stack only.
- **Owner preference:** export this plan to PDF next to the `.md` and copy it to `C:\Users\mkham\Desktop`.
- **Branch and migrations:** branch `feat/clinic-workflow` from `docs/clinic-workflow`. New migrations start at `0122`; the latest is `0121`.
- **Compatibility:** migrations are additive and backward compatible. The previous app version keeps calling `create_surgery_slot_v2`, `update_surgery_slot_v2`, `create_pending_login` and `add_existing_member`, and those stay unchanged.
- **Definitions:** no overloads; a function needing new parameters gets a new name without defaulted parameters. Otherwise use `create or replace` of the **latest** definition, searching later migrations first. Known latest definitions:
  - `create_surgery_slot_v2`: 0116
  - `update_surgery_slot_v2`: 0120
  - `create_pending_login`, `add_existing_member`: 0117
  - `handle_new_self_auth_user`: 0105
  - `default_permissions`: 0090
- **Clinic test:** in SQL use `not public.module_on('teaching')`; in TS use `teachingOn(features)` from `src/lib/modules/modules.ts`.
- **Exact copy:**
  - `Book surgery`
  - `Where`
  - `In clinic`
  - `GA in hospital`
  - `Doctor` (role label in a clinic)
  - `Also a doctor`
  - `New version from the clinic template`
  - clinic consent labels:
    - `Treatment by the clinic's dentists`
    - `Research use of anonymised data`
    - `Photos and X-rays for the clinical record and for publication (no face or name)`
    - `Follow-up visits and phone contact`
  - template version label `Draft — needs review`
  - review banner `Draft text: have it reviewed by your legal adviser and a native Arabic speaker before patients sign it.`
- **Course organizers:** their booking flow, roles, default permissions, consent labels and consent form are unchanged.
- **Conventions:** definer conventions; named tokens and shared classes; no Prettier; CRLF; React 19 form rules.

## Review Focus
1. Two people booking the same new date at once must share one clinic day, not create two. Pinned by the Task 1 DB test `concurrent bookings share one day`, which runs two transactions.
2. A clinic booking moved to another date must land on that date's day, and its old day stays for its other bookings. Pinned by the Task 1 test `date move`.
3. A Doctor invite that is cancelled, or fails at the Self-Auth step, must not leave an orphan Doctors entry created only for it. Pinned by the Task 2 test `cancel removes the new doctor`.
4. A linked doctor who is later made inactive must not be the default "Placed by". Pinned by the Task 4 unit test `inactive linked doctor is not the default`.
5. A consent version made from the template must be fully editable before anyone signs it, and must lock once signed, like every version. Pinned by the Task 5 test `template version is editable then locks`.

---

### Task 1: Database — direct clinic booking with a setting
**Files:**
- Create: `web/supabase/migrations/0122_clinic_direct_booking.sql`
- Test: `web/tests/db/clinic-booking.test.ts`

**Interfaces (Produces):**
- `surgery_slots.setting text null check (setting in ('clinic','hospital_ga'))`
- `app_private.clinic_day(p_date date) returns uuid`
  - Security definer, owned by `tenant_definer`, execute revoked from public, anon and authenticated.
  - It takes `pg_advisory_xact_lock(hashtext(app.current_company_id()::text || p_date::text))`.
  - It returns the earliest existing course-less `surgery` session on that date for the company, or inserts one: title `Clinic day`, start `00:00`, end `23:59`, `course_id` null.
- `public.create_surgery_slot_v3(<create_surgery_slot_v2 params in order>, p_setting text, p_date date) returns uuid`
  - Clinic: `p_session` must be null and `p_date` given. The function sets the session to `app_private.clinic_day(p_date)` and the rest follows the v2 body.
  - Course organizer: otherwise identical to v2. `p_session` is required (`Choose a surgery day.`). A non-null `p_date` or `p_setting` is refused with `Dates and settings are set on clinic bookings only.`
  - Stores `setting`.
- `public.update_surgery_slot_v3(<update_surgery_slot_v2 params in order>, p_setting text, p_date date) returns void`
  - Clinic: a non-null `p_date` different from the booking's current day moves it to `clinic_day(p_date)`, keeping its times of day. `p_setting` is stored.
  - Course organizer: `p_date` and `p_setting` must be null.
  - The rest is the latest v2 body (0120), including the recorded-teaching-values rule.
- Both new functions: `require_perm('schedule','edit')` first; execute to `authenticated` only.

- [ ] **Step 1: Create the branch.** `git switch -c feat/clinic-workflow docs/clinic-workflow`.
- [ ] **Step 2: Failing tests** (academy switched to clinic in the rolled-back tx, as `tests/db/modules-teaching.test.ts` does):
  - `books without a day`: v3 with `p_session null`, `p_date` today and `p_setting 'hospital_ga'` creates exactly one course-less surgery session titled `Clinic day` on that date, with `setting = 'hospital_ga'`.
  - `second booking reuses the day`: the session count stays 1.
  - `concurrent bookings share one day`: two separate pg clients, each in its own transaction, book the same new date at once (start both, then commit both) → 1 session.
  - `date move`: an update with a new `p_date` moves the slot to that date's day, and the old day keeps its other booking.
  - `bad setting refused`: `'garden'` violates the check.
  - `organizer unchanged`: on a course organizer, v3 with a session and null date/setting behaves like v2; a non-null `p_date` is refused.
  - `clash still checked`: the same doctor booked twice at the same time on the hidden day is refused without an override reason.
- [ ] **Step 3:** `npm run test:db -- clinic-booking` → FAIL.
- [ ] **Step 4: Write 0122.** Dry-run it in a rolled-back transaction first.
- [ ] **Step 5:** `npm run test:db -- clinic-booking placed-by-doctor modules-teaching module-guards permissions tenant-isolation` → PASS. Then run the full `npm run test:db`.
- [ ] **Step 6: Commit** — "Clinic bookings without a separate day step, with In clinic / GA in hospital (0122)"

### Task 2: Database — Doctor logins linked to the Doctors list
**Files:**
- Create: `web/supabase/migrations/0123_doctor_logins.sql`
- Test: `web/tests/db/doctor-logins.test.ts`
- Modify: `web/scripts/definer-allowlist.ts` if a postgres-owned function changes owner rules, and `tests/db/permissions.test.ts` / `module-guards.test.ts` allow-lists as needed.

**Interfaces (Produces):**
- `public.doctors.user_id uuid null`, with:
  - a composite FK `(company_id, user_id)` to `public.company_members(company_id, user_id)` (check its key first, and use what it has);
  - a partial unique index on `(company_id, user_id)` where `user_id is not null`.
- `app_private.pending_logins.doctor_id uuid null` (plus `doctor_created boolean not null default false`).
- `public.create_pending_login_v2(p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid, p_doctor uuid, p_new_doctor boolean) returns void`
  - It is the 0117 body plus the doctor rules:
    - when `p_new_doctor`, insert `doctors(name = trim(p_full_name))`, store its id in the pending row and set `doctor_created = true`;
    - when `p_doctor` is given, it must be an active, unlinked doctor of this company (`Choose a doctor without a login.`);
    - both given at once → `Choose one doctor.`
  - The doctor fields are allowed for both roles (`admin` with "Also a doctor", and `organizer`).
- `public.add_existing_member_v2(<0117 params in order>, p_doctor uuid, p_new_doctor boolean)`: the same doctor rules, linking at once since the account exists.
- `app_private.handle_new_self_auth_user` (0105, `create or replace`): after it creates the membership, it sets `doctors.user_id` for the pending row's `doctor_id`.
- `public.cancel_pending_login` (latest; `create or replace`, same signature): when `doctor_created` and the doctor has no references (no implant or booking names it), it deletes that doctor.
- `public.set_doctor_login(p_doctor uuid, p_user uuid) returns void`
  - Admin only (`app_private.admin_company`, as 0118); `p_user` null unlinks.
  - The user must be an active admin/organizer member of this company and not linked to another doctor (`That login is already linked to a doctor.`).
- `app_private.default_permissions` (0090, `create or replace`): when the member's company is a clinic (`'teaching' <> all(app_private.company_features(new.company_id))`), a new organizer gets `edit` on `patients, schedule, checklists, inventory, research`. Course organizers keep today's defaults.

- [ ] **Step 1: Failing tests:**
  - `doctor invite links on sign-up`: `create_pending_login_v2(..., 'organizer', null, null, true)` creates a doctor named after the user; then `insertSelfAuthUser` for that email → `doctors.user_id` = the new user.
  - `existing doctor linked`: same with `p_doctor` = an unlinked doctor.
  - `admin also a doctor`: role `admin` with `p_new_doctor` → linked.
  - `cancel removes the new doctor`: cancel deletes a just-created, unreferenced doctor; a doctor chosen from the list is kept.
  - `set_doctor_login`: admin links and unlinks; an organizer is refused; a second link to the same login is refused; another company's user is refused.
  - `clinic doctor gets edit`: in a clinic, a new organizer member has `edit` on the five areas. In a course organizer company, the defaults are unchanged.
- [ ] **Step 2:** `npm run test:db -- doctor-logins` → FAIL.
- [ ] **Step 3: Write 0123** (dry-run first).
- [ ] **Step 4:** `npm run test:db -- doctor-logins doctors admin-self-auth one-db-members permissions module-guards tenant-isolation`, using the real file names → PASS. Then run the full `npm run test:db`.
- [ ] **Step 5: Commit** — "Doctor logins linked to the Doctors list; clinic doctors get edit by default (0123)"

### Task 3: App — clinic Schedule books directly
**Files:**
- Modify:
  - `web/src/app/(app)/schedule/page.tsx` and `schedule/surgery-sessions.tsx`: in a clinic, no surgery-day list and no `Add clinic day`; a `Book surgery` button links to `/schedule/new?date=<selected date>`.
  - `schedule/new/page.tsx`, `slot-form.tsx`, `schedule/[id]/edit/page.tsx`: in a clinic, a `Date` field (default from `?date=`, else today) and a `Where` select (blank, `In clinic`, `GA in hospital`).
  - `schedule/actions.ts` and `src/lib/schedule/schemas.ts`: call `create_surgery_slot_v3` / `update_surgery_slot_v3` with every parameter named. A clinic sends `p_session: null`, `p_date` and `p_setting`; an organizer sends `p_date: null` and `p_setting: null`. The clash pre-check calls `slot_conflicts_v2` with the clinic day resolved as described in the next point.
  - **Clash pre-check in a clinic:** `slot_conflicts_v2` needs a session. Pass the existing clinic day for that date if there is one (look it up with a read), else skip the pre-check; the DB still refuses clashes.
  - The booking card shows `Where: In clinic` or `Where: GA in hospital` when it is set, in a clinic only.
  - Tests next to each.
- [ ] **Step 1: Failing tests:**
  - Clinic schedule: no `Add clinic day`; there is a `Book surgery` link.
  - Clinic slot form: a `Date` field and a `Where` select with the three options; submitting sends `p_date`/`p_setting`.
  - Organizer slot form: no `Date` or `Where`; unchanged payload, with v3 and nulls.
  - Card: shows `Where: GA in hospital`.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean. Then `npx playwright test schedule slot-placement --project=chromium`: check :3000 first, stop any server you start, and rerun a cold-compile timeout once.
- [ ] **Step 5: Commit** — "Clinic Schedule: Book surgery directly; Where: In clinic / GA in hospital"

### Task 4: App — Admin and Doctor roles, linked doctors, "Placed by" default
**Files:**
- Modify:
  - `web/src/app/(app)/admin/users/user-row.tsx` and `invite-form.tsx` (and their tests): in a clinic, show the role label `Doctor` for `organizer`. Create login offers `Admin` / `Doctor`.
    - For Doctor: a doctor choice, either `New doctor named after the user` (default) or an existing unlinked doctor.
    - For Admin: an `Also a doctor` tick with the same choice.
  - `admin/users/actions.ts` and `src/lib/admin/{schemas,create-login}.ts`: call `create_pending_login_v2` (and `add_existing_member_v2` where the existing-member path is used) with `p_doctor` / `p_new_doctor`.
  - `admin/doctors/{page.tsx,doctor-row.tsx,actions.ts}`: show each doctor's linked login (name and email) and an admin control to link or unlink it via `set_doctor_login`. Offer only staff logins not already linked.
  - **"Placed by" default:**
    - `src/lib/modules/modules.ts` or a new `src/lib/doctors/default.ts`: `export function defaultDoctorId(doctors: { id: string; user_id: string | null; active: boolean }[], me: string): string`, returning the active doctor whose `user_id === me`, else `''`.
    - Use it in the patients place form, through `ChartData.doctors` (now with `user_id`), and in the booking form's doctor select. In a clinic it is always the initial value; in a course organizer company it applies when Doctor is chosen.
- [ ] **Step 1: Failing tests:**
  - `defaultDoctorId` covers: linked and active → id; `inactive linked doctor is not the default`; not linked → `''`.
  - User row in a clinic: `Doctor`, not `Organizer`. Course organizer: `Organizer`.
  - Invite form in a clinic: role options `Admin`, `Doctor`; `Also a doctor` shows only for Admin; the doctor choice is submitted.
  - Doctors page: a linked login is shown, and link/unlink calls the action.
  - Clinic place form: the doctor select starts on the linked doctor.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Clinic roles Admin and Doctor; Doctor logins linked to the Doctors list; Placed by defaults to me"

### Task 5: App — clinic consent form
**Files:**
- Modify: `web/src/lib/consent/labels.ts`. Add `export function consentItems(teaching: boolean)`, which returns `CONSENT_ITEMS` with the clinic labels from Global Constraints when `teaching` is false. Use it everywhere `CONSENT_ITEMS` labels are shown: the patient consent form and list, the print pages, and the admin consent page.
- Create: `web/src/lib/consent/clinic-template.ts`
  - It exports `CLINIC_CONSENT_TEMPLATE = { label: 'Draft — needs review', text_en: string, text_ar: string }`.
  - Its sections: implant treatment by the clinic's dentists; procedure and risks; alternatives; costs; anaesthesia (local, sedation, or general anaesthesia in hospital where planned); research use of anonymised data; photos and X-rays; follow-up; the right to withdraw consent.
  - It uses only placeholders that `src/lib/consent/render.ts` supports, and never `course_name`.
  - The Arabic text is a faithful translation of the English.
- Modify:
  - `web/src/app/(app)/admin/settings/consent/page.tsx` and `version-form.tsx`: in a clinic, a `New version from the clinic template` link or button pre-fills the new-version form with `CLINIC_CONSENT_TEMPLATE` (for example via `?template=clinic`). While the label is `Draft — needs review`, the form shows the review banner from Global Constraints.
  - Tests.
- [ ] **Step 1: Failing tests:**
  - `consentItems(false)` gives the four clinic labels; `consentItems(true)` is unchanged.
  - The template text contains no `course`, `delegate` or `{{course_name}}`, in either language. It renders through `render.ts` without unknown placeholders.
  - Admin consent page in a clinic: the template button is there and pre-fills label, English and Arabic. In a course organizer company it is absent.
  - `template version is editable then locks`: a DB or action-level test that a version created from the template can be edited before the first signature and is locked after one, using the existing consent functions.
  - Patient consent form in a clinic shows the clinic labels.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Clinic consent: clinic tick-box labels and a draft template (English and Arabic)"

### Task 6: End-to-end
**Files:** Create `web/tests/e2e/clinic-workflow.spec.ts`. Copy the pattern of `clinic.spec.ts`: switch academy to a clinic by SQL, and restore it in `afterAll`/`finally`. Clean up the E2E doctor logins and doctors, the hidden days, and the consent versions you create.
- [ ] **Step 1: Write the tests.**
  - `book surgery directly`: the admin opens Schedule and uses `Book surgery`, picking today, a chair, an E2E patient, a doctor and `Where: GA in hospital`. The card shows `Where: GA in hospital`, and SQL shows one `Clinic day` for today.
  - `doctor login`: the admin creates a `Doctor` login (email off locally: a one-time password; read how `admin.spec.ts` handles it). The Doctors list shows it linked. Signed in as that doctor, the place-implant form's doctor starts on them.
  - `clinic consent`: Admin → Settings → Consent → `New version from the clinic template` shows the review banner. Save it, and the patient consent form shows `Treatment by the clinic's dentists`.
- [ ] **Step 2:** `npx playwright test clinic-workflow clinic --project=chromium` (check memory and :3000; stop servers you start) → PASS.
- [ ] **Step 3: Commit** — "E2E: clinic books directly, Doctor logins, clinic consent"

### Task 7: Local verification and docs (no release)
- [ ] **Step 1: Verify.**
  - `./scripts/ship.sh verify clinic-workflow clinic doctors` (verify only, never ship).
  - In parts: `admin admin-user-tools`, `schedule slot-placement`, `consent`, `implants`, using the spec names that exist.
  - `npm run isolation:check`, locally → 0.
- [ ] **Step 2: Docs.**
  - Repo-root `CLAUDE.md`, Modules paragraph:
    - 0122: hidden clinic days, `create/update_surgery_slot_v3` with `p_date`/`p_setting`;
    - 0123: `doctors.user_id`, `create_pending_login_v2`, `set_doctor_login`, clinic default permissions;
    - the clinic consent template.
  - `schedule/CLAUDE.md`, `admin/CLAUDE.md`, `patients/CLAUDE.md` (consent section): one line each.
  - Commit "Docs: clinic workflow".
- [ ] **Step 3: Stop.** Report to the owner and wait for the go-ahead to push.
  - **Remind the owner that the clinic consent template needs legal and Arabic review before any real patient signs it.**
