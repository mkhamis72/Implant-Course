# Implant Course Manager — Core Design Spec

- **Date:** 2026-10-01
- **Status:** Draft for review
- **Scope:** Core sub-project (Phase 1). Patient files, general appointments and purchasing are
  separate sub-projects with their own specs.
- **Brief:** `Prompt/Ini Prompt.txt`

## 1. Purpose and users

Implant-course organizers (all dentists) in Egypt run courses where delegates place implants
on real patients under supervision. They need one cloud system to:

- keep each patient's record and implant-focused odontogram,
- track surgical and prosthetic stock with lot traceability and automatic deduction,
- record which delegate placed or assisted each implant, under which supervisor, in which course,
- schedule surgery slots (chair, time, patient, supervisor, delegates, implants needed),
- run checklists for lectures, workshops and surgeries.

**Success criteria**

1. From any patient profile, the organizer lands on that patient's odontogram and can see
   every implant's status, current component, placing delegate and outcome.
2. Placing an implant or fitting a component reduces stock in the same transaction; stock never
   goes negative.
3. For any lot number, the system lists every patient, tooth, date and delegate it was used on.
4. For any delegate, the system lists every implant they placed or assisted, per course.
5. A day's surgery schedule produces a pull list that flags shortages before the day starts.
6. Pasted checklist text becomes one checkbox per line; any organizer can tick items, and the
   system shows who ticked each one and when.

**Out of scope for Core:** patient file uploads, non-surgery appointments, suppliers/purchase
orders/costs, billing, Arabic UI, deciduous teeth, multiple clinics/branches, delegate logins.

## 2. Users, roles and access

| Role | Can do |
|---|---|
| Admin | Everything an Organizer can, plus invite/deactivate users, manage chairs and settings |
| Organizer | All clinical, scheduling, inventory, course and checklist work |

- Accounts are **invite-only** (Admin sends an invite). No public sign-up.
- **Email verification required** before first login.
- Email + password login. **TOTP two-factor authentication is optional**, enabled per user.
- Idle session timeout (default 30 minutes, set in Settings).
- Delegates are data records only; they never log in.

## 3. Architecture

- **Frontend/server:** Next.js (App Router, TypeScript), deployed on Vercel.
- **Backend:** Supabase: Postgres, Auth, Storage (Storage reserved for the Files sub-project).
  Region: EU Frankfurt (closest managed region to Egypt).
- **Access control:** Row-Level Security on every table. Policies check that the user has an
  active `profiles` row; Admin-only tables/actions check `role = 'admin'`.
- **Transactions:** multi-table actions are Postgres functions (RPC), each in one transaction:
  `receive_stock`, `place_implant`, `fit_component`, `adjust_stock`, `record_followup`,
  `create_surgery_slot`, `toggle_checklist_item`.
- **Audit:** a generic trigger writes to `audit_log` on insert/update/delete of all clinical,
  schedule, inventory and checklist tables.
- **Concurrency:** editable rows carry `updated_at`; updates send the version they read and
  fail if it changed, and the UI says "changed by <name> — reload".
- **Hosting portability:** no Vercel-specific APIs in business logic. All business rules
  live in SQL, so Postgres + Next.js can move to another host (including in-country) if the
  legal review of Egypt PDPL (Law 151/2020) requires it.

## 4. Data model

All tables have `id uuid pk`, `created_at`, `created_by`, `updated_at` unless noted.
FDI tooth values are constrained to 11–18, 21–28, 31–38, 41–48.

### 4.1 Users
- `profiles` — `user_id` (auth.users), `full_name`, `role` (`admin` | `organizer`),
  `active` bool.
- `settings` — single row: `expiry_alert_days` (default 60), `session_timeout_minutes`.

### 4.2 Patients
- `patients` — `file_no` (unique), `full_name`, `dob`, `sex`, `phone`, `email`, `address`,
  `archived` bool (patients are never hard-deleted).
- `medical_history` — 1:1 with patient: `allergies`, `medications`, flags `diabetes`,
  `smoker`, `bisphosphonates`, `anticoagulants`, `radiotherapy_head_neck`, `osteoporosis`,
  `other_conditions`, `notes`. Any true flag or non-empty allergy appears as a medical-alert badge.
- `visit_notes` — `patient_id`, `visit_date`, `author_id`, `text`, `teeth smallint[]`.

### 4.3 Courses and delegates
- `courses` — `name`, `start_date`, `end_date`, `venue`.
- `delegates` — `full_name`, `phone`, `email`, `licence_no`, `notes`.
- `enrollments` — `course_id`, `delegate_id` (unique pair).
- `sessions` — `course_id`, `type` (`lecture` | `workshop` | `surgery`), `title`, `date`,
  `start_time`, `end_time`, `lead_organizer_id`.

### 4.4 Surgery schedule
- `chairs` — `name`, `active`.
- `surgery_slots` — `session_id` (type surgery), `chair_id`, `starts_at`, `ends_at`,
  `patient_id`, `supervisor_id` (profile), `status` (`scheduled` | `done` | `cancelled`),
  `override_reason` (set when a double-booking warning was overridden).
- `slot_delegates` — `slot_id`, `delegate_id`, `role` (`placing` | `assisting`).
- `slot_planned_implants` — `slot_id`, `tooth`, `product_id`, `implant_site_id` (the planned site
  created for it).

### 4.5 Chart
- `tooth_status` — `patient_id`, `tooth`, `status` (`present` | `missing` | `extracted` |
  `implant_planned` | `implant_placed` | `restored` | `failed`); unique (patient, tooth).
  A tooth with no row is shown as `present`.
- `implant_sites` — `patient_id`, `tooth`, `state` (`planned` | `placed` | `restored` |
  `failed` | `removed`), `product_id`, `stock_lot_id`, `placed_on`, `torque_ncm`,
  `graft` (text), `placing_delegate_id`, `assisting_delegate_id`, `supervisor_id`,
  `course_id`, `session_id`, `slot_id`, `notes`.
  Only one active site (not `failed`/`removed`) is allowed per patient + tooth.
- `site_components` — `site_id`, `component_type` (`cover_screw` | `healing_abutment` |
  `ti_base` | `multi_unit` | `abutment` | `final_restoration`), `product_id` (nullable for
  lab-made restorations), `stock_lot_id` (nullable), `fitted_on`, `fitted_by_delegate_id`
  (nullable), `fitted_by_organizer_id` (nullable), `removed_on` (nullable), `notes`.
  The current component is the latest row with `removed_on is null`.
- `implant_followups` — `site_id`, `date`, `check_type` (free text, e.g. "2-week",
  "3-month"), `outcome` (`integrated` | `failed` | `complication` | `ok`), `notes`.

### 4.6 Inventory
- `products` — `category` (`surgical` | `prosthetic`), `type` (`implant` | `cover_screw` |
  `healing_abutment` | `graft` | `membrane` | `ti_base` | `multi_unit` | `abutment_straight` |
  `abutment_angled` | `scan_body` | `impression_coping` | `analog` | `prosthetic_screw` |
  `other`), `brand`, `system`, `platform`, `diameter_mm`, `length_mm`, `ref_code`,
  `description`, `reorder_level`, `active`.
- `stock_lots` — one row per received batch: `product_id`, `lot_no` (**nullable**), `expiry`
  (**nullable**), `received_on`, `qty_received`, `notes`.
- `stock_movements` — append-only: `stock_lot_id`, `delta` (signed int), `reason` (`receive` |
  `use` | `adjust` | `waste` | `return`), `implant_site_id`, `site_component_id`,
  `patient_id`, `note`, `reverses_movement_id`. No update or delete (enforced by RLS +
  trigger). Corrections are new reversing rows.
- View `stock_on_hand` — per lot and per product: `sum(delta)`.
- Constraint: a movement may not make a lot's on-hand quantity negative (checked inside the
  RPCs with row locks on the lot).

### 4.7 Checklists
- `checklist_templates` — `name`, `session_type` (`lecture` | `workshop` | `surgery` | null for
  general).
- `template_items` — `template_id`, `position`, `text`.
- `checklists` — `title`, `template_id` (nullable), `session_id` (nullable), `slot_id`
  (nullable), `standalone` bool.
- `checklist_items` — `checklist_id`, `position`, `text`, `assignee_id` (nullable),
  `due_date` (nullable), `done_by` (nullable), `done_at` (nullable).
- When a session or surgery slot is created, the default template for its type (if one is
  set) is copied into a new checklist attached to it.

### 4.8 Audit
- `audit_log` — `table_name`, `row_id`, `action`, `user_id`, `at`, `before jsonb`,
  `after jsonb`. Insert-only.

## 5. Key flows

### 5.1 Receive stock
Inventory → Receive stock: product, quantity, optional lot no., optional expiry, received date.
`receive_stock` inserts a `stock_lots` row and a `receive` movement.

### 5.2 Schedule a surgery slot
Schedule day grid → click a chair/time → drawer: session, patient, supervisor, placing and
assisting delegates, planned implants (tooth + product), times.
`create_surgery_slot`:
1. Checks for overlapping slots with the same chair, supervisor, delegate or patient. If any
   exist, it returns warnings; the UI asks for confirmation plus an override reason.
2. Inserts the slot, its delegates and its planned implants.
3. For each planned implant, it creates an `implant_sites` row (`planned`) and sets
   `tooth_status` to `implant_planned`.
4. Attaches the surgery checklist template, if one is set.

### 5.3 Daily pull list
For a date: sum of planned implants by product across non-cancelled slots, compared with
`stock_on_hand` restricted to non-expired lots (lots with no expiry count as non-expired).
Rows where needed > available are flagged. The page can be printed.

### 5.4 Place an implant
From the chart (tooth panel) or from a slot ("Record placement" pre-fills patient, tooth,
product, delegates, supervisor, course, session).
Lot picker: lots of the chosen product with on-hand > 0 and (expiry is null or expiry ≥ today),
ordered by expiry ascending, nulls last; batches with no lot no. show as "No lot".
`place_implant`:
1. Locks the lot; rejects if wrong product, expired, or on-hand < 1.
2. Requires placing delegate, supervisor and a stock batch (which may have no lot no.); the
   assisting delegate is optional.
3. Updates/creates the site → `placed` with all fields; inserts a `use` movement (−1) linked to
   site and patient.
4. Sets `tooth_status` to `implant_placed`; marks the slot `done` if all its planned implants
   are placed.

### 5.5 Fit a component
Tooth panel → Add component: type, product + lot (optional for a lab-made final restoration),
date, fitted by. `fit_component` requires the site to be `placed` or `restored`, closes the
previous current component (`removed_on`), inserts the new component and a `use` movement when
a lot is given. A `final_restoration` sets the site to `restored` and the tooth to `restored`.

### 5.6 Follow-up
Tooth panel → Add follow-up. `record_followup` inserts the row; outcome `failed` sets the
site to `failed` and the tooth to `failed`.

### 5.7 Recall lookup
Inventory → lot page → "Used in": all `use` movements for the lot joined to site/component,
patient, tooth, date, placing delegate, supervisor, course. Only batches with a lot no. are
searchable by lot.

### 5.8 Delegate report
Delegate page: sites where the delegate is placing or assisting, grouped by course, with
patient, tooth, product, lot, date, current state, latest follow-up outcome; totals placed,
assisted, failed. CSV export and print view.

### 5.9 Checklists
- Template editor or new checklist: paste text → split on newlines; trim; drop blank lines;
  strip leading bullet markers (`-`, `*`, `•`, `[ ]`, `[x]`, `1.`, `1)`); each remaining line
  becomes an item, in order.
- Checklist page: one large checkbox per item. `toggle_checklist_item` sets or clears
  `done_by`/`done_at`; ticked items are shown crossed off with "✓ Dr X · 14:32".
- Items can be added, edited, reordered and deleted (any organizer); optional assignee and due date.
- The Checklists section lists all checklists with filters: Mine (assigned to me), Open,
  by Session, Templates.

## 6. Screens

Navigation: Dashboard · Patients · Schedule · Courses & Delegates · Inventory · Checklists ·
Admin (Admin only). Desktop-first, usable on tablets.

- **Dashboard** — today's surgeries by chair; pull-list shortages for today and tomorrow;
  low-stock products (on hand ≤ reorder level); lots expiring within `expiry_alert_days`;
  my open checklist items.
- **Patients** — searchable list (name, file no., phone). **Opening a patient goes straight
  to that patient's odontogram.** A header strip shows name, file no., age and medical-alert
  badges. Tabs next to Chart: Overview (demographics + medical history), Implants (table of
  sites), Notes, History (audit). Links from other screens open the chart with the tooth
  highlighted (`/patients/[id]?tooth=36`).
- **Odontogram** — SVG traced from `Prompt/Odontogram.jpeg`, same FDI layout (upper 18→28,
  lower 48→38, quadrant lines). Each tooth is a clickable shape with its number.
  Status colours (+ legend): present = outline, missing = greyed/dashed, extracted = grey X,
  implant planned = blue outline fixture, implant placed = solid fixture, restored = fixture
  + crown fill, failed = red ✕. The current component appears as a badge (CS/HA/TB/MUA/AB/CR).
  Clicking a tooth opens a side panel with site details, component history, follow-ups and
  actions: Set status, Plan implant, Place implant, Add component, Add follow-up.
  Shift/ctrl-click selects multiple teeth for a bulk status change.
- **Schedule** — day grid (columns = chairs, rows = 15-min times); week list view; slot
  drawer; "Pull list" for a date (printable).
- **Courses & Delegates** — course list → course page (sessions, enrolled delegates);
  delegate list → delegate page (report, CSV, print).
- **Inventory** — catalog (filters: category, type, brand, active); stock overview (on hand,
  reorder level, nearest expiry); Receive stock; lot page (ledger + "Used in" recall);
  Adjust/Waste/Return form (reason required).
- **Checklists** — list with filters; checklist page; template editor with a paste box.
- **Admin** — users (invite, role, deactivate); chairs; settings.

## 7. Error handling

- DB functions raise errors with codes that the UI maps to clear messages, e.g.
  "Lot 12345 expired on 2026-08-01", "Only 0 left of Straumann BLX 4.0×10 (lot 12345)",
  "Tooth 36 already has an active implant".
- Forms keep the user's input when a save fails.
- Concurrency conflict → "This record was changed by <name> at <time>. Reload to see it."
- Double-booking → a warning list with "Book anyway" (requires a reason).
- Network failure → non-blocking toast with retry; nothing is half-saved, because each action is
  one transaction.

## 8. Security and privacy

- Invite-only accounts, email verification required, optional TOTP 2FA.
- RLS on all tables; the anon key alone cannot read any data.
- TLS in transit; Supabase encryption at rest; daily backups + point-in-time recovery
  (Supabase Pro plan).
- `audit_log` and `stock_movements` are insert-only.
- Patients are archived, never deleted.
- Secrets live only in Vercel/Supabase environment variables.
- Legal check of cross-border hosting under Egypt PDPL before go-live (an owner task, not code).

## 9. Testing

- **Database (Supabase CLI + pgTAP):**
  - `place_implant` deducts one unit and links the patient/site
  - expired lot rejected; no-expiry batch accepted; no-lot batch accepted
  - stock cannot go negative (including two concurrent placements on a lot with 1 unit)
  - wrong-product lot rejected
  - one active site per tooth
  - `fit_component` closes the previous component and deducts stock
  - a failed follow-up sets the site/tooth to failed
  - recall returns the correct patients/delegates
  - double-booking detection for chair/supervisor/delegate/patient
  - RLS: inactive user sees nothing; organizer cannot manage users
  - movements and audit rows cannot be updated/deleted
- **Unit/component (Vitest + Testing Library):**
  - FDI tooth map (32 teeth, correct positions/quadrants)
  - status → visual mapping
  - checklist paste parser (blank lines, bullets, numbering, whitespace)
  - pull-list calculation
- **End-to-end (Playwright):**
  1. Receive stock → schedule slot → pull list shows need → record placement from slot →
     stock reduced → chart shows placed fixture → delegate report lists it → lot recall finds it.
  2. Fit healing abutment then Ti-base → badge changes, both deducted.
  3. Paste checklist → items created → user A ticks, user B sees "✓ A", unticks.
  4. Invite → email verification required → login; enable 2FA → login requires code.

## 10. Later sub-projects

1. **Patient files** — X-ray, CBCT (DICOM/zip), photos in Supabase Storage with signed URLs.
2. **Appointments** — general (non-surgery) patient appointments.
3. **Purchasing (Inventory Phase 2)** — suppliers, purchase orders, receiving against POs, costs.
