# Supervisors list — design

Date: 2026-10-03 · Status: approved in chat, awaiting spec review

## Goal

Organizers choose a booking's or implant's supervisor from a list of names that admins maintain, without each supervisor needing a user account (e.g. visiting professors).

## Decisions (from the brainstorm)

1. **One list for everything.** A single Supervisors list; existing user accounts are copied into it once, so current records keep their supervisor. Dropdowns show only this list.
2. **Admins manage it** on a new **Admin → Supervisors** page (like Admin → Chairs).
3. **No automatic entries** for accounts created later; an admin adds them by name if they supervise.

## Approach

A `supervisors` table that **reuses the profile ids** of the accounts copied into it. Existing `supervisor_id` values stay valid, no data is rewritten, the columns keep their names, and an app version still sending account ids sends valid supervisor ids.

Rejected: new `supervisor_ref` columns plus backfill (double columns and functions for no gain); free-text names per record (no managed dropdown; typos break clash checks and reports).

## Database

### Release 1 — migration `0024_supervisors.sql` (additive only)

- `public.supervisors`:
  `id uuid pk default gen_random_uuid()`, `full_name text not null check (length(trim(full_name)) between 2 and 120)`, `active boolean not null default true`, `created_at`, `updated_at`.
  - `app_private.set_updated_at` and `app_private.audit_row('id')` triggers.
  - Privileges as for `chairs`: no default privileges (0019); `grant select` to `authenticated`; `grant insert (full_name, active)` and `grant update (full_name, active)`; RLS select `is_active_user()`, insert/update `is_admin()`. No delete (deactivate instead).
- Backfill: `insert into supervisors (id, full_name, active) select user_id, left(coalesce(nullif(trim(full_name), ''), email), 120), active from profiles` (an empty name falls back to the email; cut to 120 characters).
- Add foreign keys `surgery_slots_supervisor_ref_fkey` and `implant_sites_supervisor_ref_fkey` (`supervisor_id → supervisors(id)`). **The existing FKs to `profiles` stay in this release**, because the previous app version embeds names through `profiles!surgery_slots_supervisor_id_fkey` / `profiles!implant_sites_supervisor_id_fkey`.
- Redefine the latest definitions to validate and name supervisors from `supervisors`:
  - `create_surgery_slot` (latest: 0021): "Choose the supervising organizer." check becomes `exists (select 1 from public.supervisors where id = p_supervisor and active)`; message "Choose an active supervisor."
  - `place_implant` (latest: 0020): same check and message.
  - `slot_conflicts` (latest: check later migrations at implementation time): the clash message names the supervisor from `supervisors`.
  - `lot_usage` (latest: 0020): the `supervisor` column comes from `supervisors`.
  - Any other function found at implementation time that joins `profiles` on `supervisor_id`.

### Release 2 — migration `0025_supervisors_drop_profile_fk.sql`

- Drop `surgery_slots_supervisor_id_fkey` and `implant_sites_supervisor_id_fkey` (to `profiles`). Until this runs, a supervisor added by name cannot be saved on a booking or implant. Release 2 is merged right after release 1 has deployed.

## App (release 1)

- **Admin → Supervisors** (`src/app/(app)/admin/supervisors/`), modelled on Chairs: list, add by name, rename, activate/deactivate; admin only (`requireAdmin()` in page and actions). Added to the admin navigation.
- Zod schema `supervisorSchema` in `src/lib/schedule/schemas.ts` (name 2–120 characters, trimmed).
- **Dropdowns** read `supervisors` where `active`, ordered by name:
  - booking form (`schedule/new/page.tsx` → `slot-form.tsx`): defaults to the current user's id if it is in the list, otherwise empty, with a "Choose a supervisor…" placeholder;
  - implant placement form (`patients/[id]/chart-data.ts` → `implant-forms.tsx`).
- **Names shown** come from the new FK embeds `supervisor:supervisors!surgery_slots_supervisor_ref_fkey(full_name)` / `supervisors!implant_sites_supervisor_ref_fkey(full_name)`: `src/lib/schedule/queries.ts`, `schedule/page.tsx`, `chart-data.ts` and its consumers, the implants tab, and the lot page (via `lot_usage`). Types move from `{ full_name, email }` to `{ full_name }`.
- If the dropdown is empty, the form says "No supervisors yet — an admin can add them under Admin → Supervisors."

## Behaviour

- Renaming a supervisor renames them everywhere, including past records.
- Deactivating hides them from dropdowns; past records keep the name.
- User accounts and supervisors are independent from now on: deactivating an account does not deactivate the copied supervisor.

## Testing

- DB (`tests/db/supervisors.test.ts`): backfill gives every profile a supervisor with the same id; booking or placing with an inactive or unknown supervisor is refused; a supervisor without an account can be booked (added with 0025 in PR 2); the clash message uses the supervisor name; only admins can insert/update; organizers can read.
- Update DB fixtures and tests that pass a profile id as supervisor (they keep working: ids are shared).
- Component: booking form default/empty state.
- E2E: an admin adds a supervisor by name; an organizer books with them and sees the name on the schedule.

## Rollout

1. PR 1 (0024 + app) → merge → release migrates, then deploys.
2. PR 2 (0025) → merge right after.

The previous app version keeps working throughout: release 1 keeps the profile FKs it embeds through, and in release 2 the running app already uses the new FKs.
