# Design: Clinic workflow — direct booking, Admin/Doctor roles, clinic consent

> **Status (2026-11-18):** approved by the owner in chat; this PDF is for the owner's review before the implementation plan is written. Part B of the owner's 2026-11-18 list — A (booking: patient picker, spare implants), C (product catalogue) and D (recall visits) follow as separate designs.

## Context
The Clinic company type is live (Modular releases 1–3, 0109–0121). Using it shows three gaps between it and how a clinician actually works (owner, 2026-11-18):
1. A clinician has to "Add clinic day" before booking. They want to **book a surgery directly**, optionally recording whether it is **under GA in hospital** or **in clinic**.
2. The user roles are still the course-organizer ones. A clinic should have **Admin** and **Doctor** only, with no "Organizer".
3. The consent form patients sign is written for courses ("Treatment by course delegates under supervision", course name). A clinic needs a **regular clinic consent form** with no mention of courses or delegates.

This is part B of the owner's list. A (booking: patient picker and spare implants), C (product catalogue), D (recall visits) and the two small follow-ups (History labels, dropping the old functions) are separate designs, done after this one.

## Decisions (the owner's, 2026-11-18)
- **Booking days:** a hidden clinic day per date. The app creates or reuses one clinic day for a date when a booking is made, and the clinic never sees an "Add clinic day" step. The day's checklist, the doctor and chair clash checks and the Schedule day view keep working unchanged.
- **Doctor role:** a Doctor login and its Doctors-list entry are **the same person** (linked). Creating a Doctor login adds them to the Doctors list, or links an existing entry. "Placed by" and new bookings default to the signed-in doctor. Doctors without a login can still be listed.
- **Doctor access:** the same per-area **None/View/Edit grid** organizers have today, defaulting to Edit everywhere. The admin can restrict a doctor.

## Design

### 1. Direct booking in a clinic
- **Schedule (clinic):**
  - There is no surgery-day list and no "Add clinic day". A **Book surgery** button opens the booking form with **Date**, Start, End, Chair, Patient, Doctor (default: the signed-in user's linked doctor), **Where** (optional: *In clinic* / *GA in hospital*), Notes, and the planned implants as today.
  - The day view lists the clinic's bookings by date as today.
- **Hidden day:** a new definer, `public.clinic_day(p_date date) returns uuid`.
  - Rules: clinic only (`module_on('teaching')` false, else the not-used message); `require_perm('schedule','edit')`.
  - It finds the company's course-less `surgery` session on that date, or creates it. My calls:
    - title `Clinic day`;
    - times 00:00–23:59, so any booking time fits;
    - a partial unique index on (company_id, date) where `course_id is null and type = 'surgery'`, so concurrent bookings share one day.
  - Clinic days already made by hand (release 3) are reused if they are course-less surgery sessions on that date. If one date has several, the earliest is reused (my call).
- **Where:** `surgery_slots.setting text null check (setting in ('clinic','hospital_ga'))`. Labels: `In clinic`, `GA in hospital`. Shown on the booking card and form **in clinics only** (my call: organizer bookings unchanged).
- **Functions:** `create_surgery_slot_v3` / `update_surgery_slot_v3`. These are the v2 parameters plus `p_setting text`, with no defaults and no overloads.
  - In a clinic, the server action calls `clinic_day(date)` and then `create_surgery_slot_v3`.
  - Changing the date of a clinic booking moves it to that date's hidden day (my call). Today's booking edit can't change the date; this adds it for clinics only.
  - v2 stays for the previous app version during the release (the same pattern as v3 → v4).
- **Checklists:** the default `surgery` checklist still attaches to the hidden day (existing trigger) and links to the Schedule date (release 3).

### 2. Admin and Doctor roles in a clinic
- **The database role is unchanged:** `organizer` is shown as **Doctor** in a clinic everywhere roles appear (Admin → Users, Create login, the role select). `delegate` is already refused in a clinic (0117).
- **Link a login to a doctor:** `doctors.user_id uuid null` (unique per company where not null; composite FK to the company's member). My calls:
  - a doctor entry links to at most one login;
  - one login links to at most one doctor;
  - linking is available for **both company types** (Admin → Doctors shows the login; Course organizers simply don't need it).
- **Create login in a clinic:**
  - Role `Admin` / `Doctor`.
  - A **Doctor** login is created as `organizer` and gets a Doctors-list entry: either a new one named after the user (default), or a chosen existing unlinked entry.
  - An **Admin** login has an optional **"Also a doctor"** tick with the same choice (my call: a small clinic's owner is often both).
  - Existing logins can be linked or unlinked from Admin → Doctors.
- **Defaults:** placing an implant or booking in a clinic defaults the doctor to the signed-in user's linked doctor when it is active. Course organizers keep Delegate as the default; the doctor default applies only when they choose Doctor.
- **Permissions:** unchanged mechanism. A new Doctor login gets Edit on every clinic area (patients, schedule, checklists, and inventory/statistics when the plan has them). The admin edits the grid as today; teaching areas are already hidden in a clinic.
- **Functions:** `set_doctor_login(p_doctor uuid, p_user uuid)` (admin only, clinic and organizer). The login creation path passes the doctor choice; create a new versioned function rather than an overload where a signature must change.

### 3. Clinic consent form
- **Today:**
  - `consent_form_versions` holds the form per company, with an English and an **Arabic** text (`text_en`, `text_ar`) and placeholders including `course_name`.
  - The four tick-boxes are fixed columns: treatment, research, teaching_images, follow_up. Their labels are in `src/lib/consent/labels.ts`.
  - A version locks once someone signs it.
- **Clinic labels** (TS, picked by `teachingOn`):
  - treatment → **Treatment by the clinic's dentists**
  - research → unchanged (**Research use of anonymised data**)
  - teaching_images → **Photos and X-rays for the clinical record and for publication (no face or name)**
  - follow_up → unchanged

  The columns stay, so earlier signatures keep their meaning.
- **Clinic template:** a clinic consent text in **English and Arabic**, kept with the app, using no `course_name`. It covers implant treatment by the clinic's dentists, risks, alternatives, costs (generic), anaesthesia including GA in hospital where applicable, research, photos, follow-up, and the right to withdraw.
  - In a clinic, **Admin → Settings → Consent** gets **"New version from the clinic template"**, which creates an unsigned version the admin can review and edit before it takes effect.
  - Course organizers don't see the button.
- **Legal and language review (owner):** the course form had a legal review (2026-11-16). The clinic text, and especially the **Arabic** wording I draft, must be reviewed by the owner's legal adviser and a native speaker **before any real patient signs it**. The template ships marked "Draft — needs review" in its version label, until the owner replaces or confirms it.

## Approaches considered
- **Booking:** hidden day per date (**chosen**) vs. bookings without days. The second is a cleaner model but would rework the clash checks, the day view, checklists and reports.
- **Doctor role:** linked to a Doctors-list entry (**chosen**) vs. a renamed Organizer role. The second means double entry and no "me" default.
- **Doctor access:** the per-area grid (**chosen**) vs. full edit on everything. The second gives the admin no way to restrict a doctor.
- **Consent:** a clinic template the admin turns into a new version (**chosen**) vs. silently replacing a company's form. That would break locked, signed versions, and a legal text should never change unseen.

## Goals / non-goals / anti-goals
- **Goals:** a clinic books in one step; users are Admin or Doctor; patients sign a clinic consent form; Course organizers see no change.
- **Non-goals:** the patient picker, spare implants, product catalogue and recall visits (parts A, C, D); pricing; changing the course consent text.
- **Anti-goals:**
  - an edited, signed consent version (versions stay locked);
  - any teaching wording in a clinic;
  - breaking the previous app version during a release (additive migrations, new function versions).

## Left to the builder
- Exact placement of the Book surgery button, and the form layout.
- The wording of the clinic template, within the sections above.
- How Admin → Doctors shows and edits the login link.
- Whether `clinic_day` and `create_surgery_slot_v3` are called in one RPC or two (they must not leave an empty day behind on failure; either clean it up or make the day cheap and harmless).

## Verification (local only; nothing online without the owner)
- **DB tests:**
  - `clinic_day` is idempotent and concurrent-safe, and refused for Course organizers;
  - v3 with `setting`;
  - the clinic date move;
  - `set_doctor_login` is admin-only and same-company;
  - the doctor default;
  - Course organizers are unchanged.
- **Unit and component tests:** clinic Schedule (no day list, Book surgery, Where), role labels (Doctor), Create login (Admin/Doctor, Also a doctor), consent labels per type, the template button only in a clinic.
- **E2E (clinic):** create a Doctor login and sign in as that doctor; book a surgery directly with Where = GA in hospital; place from it with "Placed by" pre-filled to the doctor; create a consent version from the clinic template and sign it on a patient.
- Full `test:db`, `npm test`, `tsc`, lint, and `isolation:check` on the local stack.
