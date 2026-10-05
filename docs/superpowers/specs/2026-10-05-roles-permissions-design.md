# Roles & permissions — design

Date: 2026-10-05 · Status: approved in chat (plan), awaiting spec review

## Goal

The pilot can test real users with three kinds of access:

- **Admin:** everything.
- **Organizer:** for each menu panel, the admin sets **None / View / Edit**.
- **Delegate:** a login that sees only their own schedule and their own report.

## Decisions (from the brainstorm)

1. **Permissions are enforced in the database.** Any signed-in user's token can call the Supabase REST API directly, so hiding menus is only for usability.
2. **Organizer areas match the menu:** Patients, Schedule (surgery and talks), Courses, Checklists, Inventory, Delegates. Each is None, View or Edit, and Edit includes View.
3. **What a delegate sees:**
   - their own surgery bookings, with the patient's name and file number for those bookings;
   - every talk in the courses they're enrolled in;
   - their own report.
   - Nothing else.
4. **Logins are created by an admin button.** For delegates it is on the delegate's page; for staff it is on Admin → Users.
   - With email on (`EMAIL_ENABLED`), the invite email verifies the address and the user sets a password.
   - With email off (the pilot today), the admin is shown a one-time temporary password to hand over.
5. **Existing organizers keep full edit on release.** New organizers start with View on every area.
6. **Order of work:**
   1. PR A (lectures)
   2. this work (PR C)
   3. course reports (PR B), which will then respect permissions.

## Today

- `user_role` is `('admin','organizer')` (0001). `handle_new_user` creates an inactive organizer.
- `is_active_user()` means an active profile with MFA satisfied (0003). `is_admin()` adds `role = 'admin'`.
- Almost every RLS policy, and `app_private.require_active()`, rely only on `is_active_user()`.
- The 26 security-definer write functions check only `require_active()`. None checks a role.
- Delegates (`public.delegates`) have no link to an auth user.

## Database

### Migration `0029_delegate_role.sql`

- `alter type public.user_role add value 'delegate';` and nothing else.
- A new enum value can't be used in the transaction that adds it, and `scripts/migrate.ts` runs each file in its own transaction.

### Migration `0030_permissions.sql`

**Tables and columns**

- `public.user_permissions`:
  - Columns: `user_id uuid references profiles (user_id) on delete cascade`, `area text check (area in ('patients','schedule','courses','checklists','inventory','delegates'))`, `level text check (level in ('view','edit'))`.
  - `primary key (user_id, area)`. No row means None.
  - Privileges: no default privileges (0019). Grant `select` to authenticated.
  - RLS select: `is_admin() or user_id = auth.uid()`.
  - Writes go only through `set_user_permissions`.
  - Trigger: `audit_row('user_id')`.
- `profiles.delegate_id uuid unique references public.delegates (id)`, with check `(role = 'delegate') = (delegate_id is not null)`.

**Backfill:** every existing `organizer` profile gets `edit` on all six areas.

**Default for new organizers:** a trigger runs `after insert or update of role on profiles`. When a profile is, or becomes, an `organizer` and has no permission rows, it gets `view` on all six areas.
- This covers `handle_new_user`, the `create-user` script, invites, and an admin being demoted.
- A profile that stops being an organizer keeps its rows. They are ignored, because `can()` only reads rows for organizers and admins pass anyway.

**Helpers**

All are `security definer set search_path = ''`, with execute granted to authenticated and revoked from public and anon.

| Function | Meaning |
|---|---|
| `public.is_active_user()` | **Redefined:** active **staff** (role admin or organizer) and `mfa_satisfied()`. Every existing policy and `require_active()` therefore deny delegates with no further change. |
| `public.is_delegate_user()` | Active profile, role `delegate`, `mfa_satisfied()`. |
| `public.my_delegate_id()` | The `delegate_id` of `auth.uid()`'s profile. |
| `public.can(p_area text, p_level text) returns boolean` | `is_admin()`, or `is_active_user()` with a permission row for the area whose level is p_level or higher (`edit` > `view`). |
| `app_private.require_perm(p_area text, p_level text)` | Calls `require_active()`, then fails with "You don't have permission to edit Inventory." (the verb and area label follow the arguments) unless `can()` allows it. |
| `public.set_user_permissions(p_user uuid, p_perms jsonb)` | Admin only. Refuses the caller's own account and any profile whose role isn't organizer. Validates areas and levels, then replaces that user's rows. |

**RLS, re-scoped by area**

Select uses `can(area,'view')`; insert, update and delete use `can(area,'edit')`.

| Scope | Tables |
|---|---|
| patients | `medical_history`, `visit_notes`, `tooth_status`, `implant_sites`, `site_components`, `implant_followups`, `audit_log` |
| `patients` select | `can('patients','view') or can('schedule','view')`. The schedule shows patient names. Writes need patients/edit. |
| schedule | `surgery_slots`, `slot_delegates`, `slot_planned_implants`, `talks` |
| courses | `courses`, `sessions`, `enrollments` |
| checklists | `checklist_templates`, `template_items`, `checklists`, `checklist_items` |
| inventory | select on `stock_movements`; writes on `products` |
| delegates | writes on `delegates` |
| any staff (`is_active_user()`) | select on `products`, `stock_lots`, `delegates`, `chairs`, `supervisors`, `lecturers`. These are reference lists that other panels' forms need. |
| admin (unchanged) | writes on profiles, settings, chairs, supervisors, lecturers |

`profiles` select stays `is_active_user() or user_id = auth.uid()`.

**Write functions**

Each function is redefined from its **latest** definition (search every later migration first). Its `require_active()` call becomes `require_perm(<area>,'edit')`.

| Area | Functions |
|---|---|
| patients | `plan_implant`, `place_implant`, `cancel_planned_implant`, `set_implant_technique`, `fit_component`, `record_followup`, `void_component`, `void_followup`, `correct_batch`, `delete_patient`, `next_file_no` |
| schedule | `create_surgery_slot`, `update_surgery_slot`, `set_slot_status`, `cancel_surgery_slot`, `create_talk`, `update_talk`, `delete_talk` |
| inventory | `receive_stock`, `adjust_stock` |
| courses | `delete_course` |
| checklists | `create_checklist`, `add_checklist_items`, `save_template`, `toggle_checklist_item`, `move_checklist_item` |

The security-invoker readers inherit RLS and are unchanged.

**Delegate read functions**

Both are security definer and fail unless `is_delegate_user()`.

`my_schedule(p_from date, p_to date)` returns:

| Column | Meaning |
|---|---|
| `kind` | `'surgery'`, `'lecture'` or `'workshop'` |
| `starts_at`, `ends_at` | start and end of the booking or talk |
| `title` | the talk's topic, or the session's title for surgery |
| `course` | course name |
| `place` | room or chair |
| `lead` | lecturer or supervisor |
| `my_role` | placing or assisting; null for talks |
| `patient_name`, `file_no`, `teeth` | surgery only |

- Surgery rows: slots that aren't cancelled, where `slot_delegates.delegate_id = my_delegate_id()`.
- Talk rows: talks in sessions of courses the delegate is enrolled in.

`my_report()` returns `delegate_report`'s columns for `my_delegate_id()` only.

## App

**Session** (`src/lib/auth/session.ts`)

- `Profile` gains `role` (admin, organizer or delegate), `delegate_id` and `permissions` (area → view or edit). They load in the same cached call.
- `requireActiveUser()` means active **staff**. A delegate is redirected to `/my`.
- `requirePermission(area, level)`:
  - On a page: redirects to `/` when the user lacks view.
  - In an action: returns "You don't have permission to edit <Area>."
- `requireDelegate()` guards the delegate pages.
- Pure helpers in `src/lib/auth/permissions.ts`: `AREAS`, `AREA_LABELS`, `canView`, `canEdit`.

**Navigation** (`src/components/nav-items.ts`)

- Each item names its area. An item shows only with view permission. Admin stays admin-only.
- Delegates get their own navigation: My schedule, My report, Account security.

**Staff pages and actions**

- Each page calls `requirePermission(area,'view')`; each action calls `requirePermission(area,'edit')`.
- Forms, "New …" buttons and Delete render only with edit permission.
- Dashboard widgets show only for areas the user can view.

**Delegate pages** (`src/app/(delegate)/my/`)

- `/my` is a week view of `my_schedule`, driven by `?date=` with Previous/Next week links.
- `/my/report` and `/my/report.csv` show `my_report`, reusing `src/lib/csv.ts` and the delegate report table.
- A delegate opening `/` or any staff route is sent to `/my`.

**Admin → Users**

- Each organizer row gets a permission grid: the six areas, each with None / View / Edit radios, and a "Save permissions" button.
- The role select keeps Admin and Organizer. Delegate logins appear with the role "Delegate", and nobody can switch to that role from this page.
- **Create login** (staff):
  - Email on: the existing invite.
  - Email off: `auth.admin.createUser({ email, password: <random>, email_confirm: true })`, then the profile is set through the admin's own session (so RLS and audit apply), then the temporary password is shown once.
  - The random-password code in `scripts/users.ts` / `create-user.ts` moves into a shared module.

**Delegate page** (admin only)

- "Create login" uses the delegate's email, with the same email-on/off behaviour. It sets `role='delegate'` and `delegate_id`.
- Once linked, the page shows "Login: active" or "Login: inactive". Deactivating a delegate login goes through Admin → Users (the existing ban flow).

**Scripts**

- `create-user` accepts `--role delegate --delegate <id>`.
- `src/lib/admin/schemas.ts` and `scripts/create-user-args.ts` accept the delegate role.

**Operations**

- `docs/operations.md` gets the steps for enabling Supabase SMTP and setting `EMAIL_ENABLED=true`. Email verification depends on them.

## Tests

**DB tests:** `tests/db/permissions.test.ts` and `tests/db/delegate-access.test.ts`.

- For each area, an organizer with None, View and Edit is checked against a representative table (select and write) and a representative function.
- **Guard-rail test:** every `public` security-definer function either calls `require_perm` or is on an explicit allowlist (the helpers and the delegate readers).
- The backfill gives existing organizers edit everywhere.
- `set_user_permissions` is admin only and refuses the caller's own account.
- **Delegate:**
  - For every `public` table, the delegate gets no rows or permission denied, except their own `profiles` row.
  - Every staff function refuses them.
  - `my_schedule` returns only their bookings and their courses' talks.
  - `my_report` returns only their implants.
  - An inactive delegate gets nothing.

**Unit tests:** `permissions.ts`, `visibleNavItems`, and the schemas that now accept the delegate role.

**E2E:**

- New test users:
  - `viewer`: View everywhere, plus Edit on Inventory.
  - `delegate`: linked to a seeded delegate.
- Specs:
  - The viewer sees no edit controls on Courses, can receive stock, and is kept out of Admin.
  - A delegate lands on `/my` and sees their booking and a talk, but not another delegate's booking.
  - A delegate who opens `/patients` is sent to `/my`.
  - A delegate can download their report CSV.
  - An admin saves a permission grid.
  - An admin creates a delegate login with email off and sees the temporary password.

## Out of scope

- Forcing a password change after a temporary password.
- Per-course permissions, for example an organizer limited to one course.
- Delegates editing anything.
