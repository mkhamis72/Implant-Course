# Booking: patient picker, spare implants, full editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookings pick the patient by search and confirm them, carry up to 5 spare implants per tooth, and allow every planned implant to be edited until it is placed.

**Architecture:**
- **Data:** a new `slot_spare_implants` table (0125).
- **New functions:**
  - `create_surgery_slot_v4`: the v3 body plus spares, one transaction.
  - `set_booking_implants` (0126): replaces a booking's whole planned set, with placed teeth locked.
  - `pull_list_v2`: the pull list with a spares count.
- **App:**
  - the picker uses `search_patients_v2` (0124) through a schedule server action;
  - the booking form, the edit form, the card and the pull list use the new functions;
  - the old functions stay for the previous app version.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 server components/actions, React 19, Zod v4, Vitest (unit + DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-booking-patient-picker-spares-design.md` (+ .pdf), approved by the owner on 2026-11-20.

## Global Constraints
- **Branch:** `feat/booking-picker-spares` (it holds the spec). New migrations are **0125** and **0126**; the latest is 0124.
- **Additive:** the previous app version keeps calling `create_surgery_slot_v3`, `update_surgery_slot_v3`, `set_implant_technique` and `pull_list`. All of them stay unchanged.
- **Function rules:**
  - No overloads and no defaulted parameters.
  - Definer conventions: `set search_path = ''`, `perform app_private.require_perm('schedule','edit')` first, revoke from `public, anon`, grant to `authenticated`, and errors via `app_private.fail`.
  - Readers are `security invoker`.
- **New table:** it follows `slot_planned_implants`, checking every later migration that touches that table: company key (0091), RLS and area policies (0030/0032/0034), teaching or module gates (0117), audit trigger, grants (0019) and the FK index (0100). `permissions.test.ts` and `module-guards.test.ts` stay green.
- **Exact copy:**
  - `Patient`
  - `Open file`
  - `Change`
  - `File: no access`
  - `Spares`
  - `+ Add spare`
  - `Spares: <labels>` on the card
  - `Placed — change it in Corrections`
  - errors:
    - `Choose the patient.`
    - `Choose an implant from the catalog.`
    - `Tooth N has more than 5 spares.`
    - `Tooth N lists the same implant twice.`
    - `Tooth N is already placed; change it in Corrections.`
    - `This booking is closed.`
- **Limits:** at most **5 spares per tooth**; the picker shows at most **10 matches**, after **2+ characters**, archived patients excluded.
- **Both company types behave the same.** The clinic rules of 0120/0122 are unchanged.
- **Conventions:**
  - Cairo dates (`todayIso`);
  - named tokens and the shared classes;
  - `data-label` on table cells;
  - React 19 form rules;
  - CRLF;
  - no Prettier.
- **Nothing goes online without the owner:** no push, PR, `ship.sh ship` or production action.

## Review Focus
1. **Removing a tooth:** it detaches its planned site exactly as `cancel_surgery_slot` does, so re-adding the same tooth later works. Pinned by the Task 2 test `remove then re-add a tooth`.
2. **A placed tooth sent back changed** (product, technique or tooth) is refused, while its spares may still change. Pinned by the Task 2 test `placed tooth is locked, spares still editable`.
3. **A Schedule-only user** (Patients None) can search, gets the card, and sees no `Open file`. Pinned by the Task 3 DB test `schedule-only user can search` and the component test `no Open file without Patients view`.
4. **The new booking's patient id comes from the picker, and the server re-checks it.** A forged, archived or other-company id is refused with `Choose the patient.`. Pinned by the Task 3 action test `forged patient id refused`.
5. **Spares on the pull list:** they count separately from "needed", including a product that is only a spare. Pinned by the Task 1 test `pull list counts spares`.

---

### Task 1: DB — spares table, create_surgery_slot_v4, pull_list_v2 (0125)
**Files:**
- Create `web/supabase/migrations/0125_booking_spares.sql`.
- Test `web/tests/db/booking-spares.test.ts`.

**Interfaces:**
- **Produces:**
  - `public.slot_spare_implants(id uuid pk, company_id, slot_id uuid not null → surgery_slots on delete cascade, tooth public.fdi_tooth not null, product_id uuid not null → products, position smallint not null, unique (slot_id, tooth, product_id))`
  - `public.create_surgery_slot_v4(<create_surgery_slot_v3 params in the same order and types, see 0122>) returns uuid`. Each `p_implants` item may carry `spares: [product_id…]`.
    - A spare must be an active implant product (`Choose an implant from the catalog.`).
    - There are at most 5 per tooth (`Tooth N has more than 5 spares.`).
    - A spare may not repeat the planned product or another spare (`Tooth N lists the same implant twice.`).
    - Spares are stored with `position` set to the array order.
  - `public.pull_list_v2(p_date date) returns table (product_id, type, brand, system, platform, diameter_mm, length_mm, description, needed int, spares int, available int)`. This is `pull_list` (0017) plus `spares`, the count of spares for that product on that day's non-cancelled bookings whose tooth's site is still `planned`. A product that is only a spare appears with `needed = 0`.

- [ ] **Step 1: Write the failing tests** in `booking-spares.test.ts` (use `withTx` / `actAs`; follow `clinic-booking.test.ts` for creating a slot):
  - `v4 stores spares in order`;
  - `v4 refuses 6 spares`;
  - `v4 refuses a spare equal to the planned implant`;
  - `v4 refuses an inactive product`;
  - `v4 without spares behaves like v3` (same rows in `implant_sites` / `slot_planned_implants`);
  - `pull list counts spares`, with a product that is only a spare giving `needed 0, spares 1`;
  - `spares are company-scoped`: academy rows are invisible to another company's admin, using the isolation pattern from the existing tenant tests;
  - `catalogue`: v4 and pull_list_v2 are granted to `authenticated` only, with no defaults.
- [ ] **Step 2:** `npm run test:db -- booking-spares` → FAIL (`does not exist`).
- [ ] **Step 3: Write 0125.** Copy the latest v3 body from 0122 and add the spares loop. Dry-run it in a rolled-back transaction (CLAUDE.md Gotchas).
- [ ] **Step 4:** `npm run test:db -- booking-spares permissions module-guards clinic-booking` → PASS. Then run the full `npm run test:db`.
- [ ] **Step 5: Commit** — "Booking spares: slot_spare_implants, create_surgery_slot_v4, pull_list_v2 (0125)".

### Task 2: DB — set_booking_implants (0126)
**Files:**
- Create `web/supabase/migrations/0126_set_booking_implants.sql`.
- Test `web/tests/db/set-booking-implants.test.ts`.

**Interfaces:**
- **Consumes:** `slot_spare_implants` (Task 1).
- **Produces:** `public.set_booking_implants(p_slot uuid, p_implants jsonb) returns void`. `p_implants` is the whole set: `[{ tooth int, product_id uuid|null, technique 'guided'|'free_hand', spares uuid[] }]`.
  - **Order of checks:**
    1. Lock the slot.
    2. If the slot is `cancelled` or `done`, fail with `This booking is closed.`.
    3. Validate every item with the v4 tooth, product, technique and spare rules.
  - **Placed teeth:** every site of this slot whose state is not `planned` must appear with the same tooth, product and technique. Otherwise fail with `Tooth N is already placed; change it in Corrections.`. Its spares may still change.
  - **New tooth:** added exactly as v4 adds it, including the "tooth planned in another active booking" and "tooth already has an implant" refusals, and `set_tooth 'implant_planned'`.
  - **Removed tooth:** its `slot_planned_implants` row and its spares are deleted, and its planned site is detached exactly as in the latest `cancel_surgery_slot` (find it; 0030 or later).
  - **Kept tooth:** update its product and technique on the site and the `slot_planned_implants` row, and replace its spares.

- [ ] **Step 1: Failing tests:**
  - `adds a tooth`
  - `changes product and technique`
  - `changes a tooth number` (removal + addition)
  - `remove then re-add a tooth`: the second booking reuses the detached site
  - `replaces spares`
  - `placed tooth is locked, spares still editable`
  - `closed booking refused`
  - `tooth in another active booking refused`
  - `needs Edit on Schedule`
  - `catalogue`
- [ ] **Step 2:** `npm run test:db -- set-booking-implants` → FAIL.
- [ ] **Step 3: Write 0126** (dry-run first).
- [ ] **Step 4:** `npm run test:db -- set-booking-implants booking-spares permissions module-guards` → PASS. Then run the full `npm run test:db`.
- [ ] **Step 5: Commit** — "Edit a booking's implants: set_booking_implants (0126)".

### Task 3: App — patient picker
**Files:**
- Create:
  - `web/src/app/(app)/schedule/new/patient-picker.tsx` (+ `.test.tsx`)
  - `web/tests/db/booking-patient-search.test.ts`
- Modify:
  - `schedule/new/page.tsx`: drop the 2000-row patients query; pass `canOpenFile = canView(profile, 'patients')`.
  - `schedule/new/slot-form.tsx`: replace the file-number box and the `<datalist>` with `PatientPicker`; send `patientId`.
  - `src/lib/schedule/schemas.ts`: `patientFileNo` → `patientId: z.string().uuid({ message: 'Choose the patient.' })`.
  - `schedule/actions.ts` (+ `actions.test.ts`).

**Interfaces:**
- **Produces:**
  - `type BookingPatient = { id: string; file_no: string; full_name: string; dob: string | null; phone: string | null }` in `src/lib/schedule/types.ts`.
  - `searchBookingPatients(q: string): Promise<BookingPatient[]>` in `schedule/actions.ts`:
    - `requirePermission('schedule','edit')`;
    - `q.trim().length < 2` → `[]`;
    - otherwise `rpc('search_patients_v2', { q, include_archived: false, stages: [], course: null, supervisor: null, p_offset: 0, p_limit: 10 })`, mapped to `BookingPatient`.
  - `PatientPicker({ canOpenFile, value, onChange }: { canOpenFile: boolean; value: BookingPatient | null; onChange: (p: BookingPatient | null) => void })`. It is a combobox:
    - a 250 ms debounce;
    - match rows show file no, name, age (`ageOn`) and phone;
    - choosing a match shows the card `<file_no> · <name> · <age> · <phone>`;
    - the card links `Open file` to `/patients/<id>` (`target="_blank"`, `rel="noopener"`) when `canOpenFile`, and otherwise shows `File: no access`;
    - the card has a `Change` button.
  - `bookSurgery` takes `patientId`. Before calling the RPC it re-reads `patients` (id, not archived) through the user's client, and answers `Choose the patient.` when the patient isn't found.

- [ ] **Step 1: Failing tests:**
  - DB, `schedule-only user can search`: with `setPerms` set to Schedule Edit and Patients None, `search_patients_v2` returns the match.
    - If it returns nothing, stop and report NEEDS_CONTEXT. The fix would be a narrow reader, which this plan does not decide.
  - Component tests:
    - `searches after 2 characters`
    - `shows at most 10`
    - `choose shows the card`
    - `Open file links to the patient in a new tab`
    - `no Open file without Patients view`
    - `Change clears the choice`
    - `keyboard: arrows and Enter choose`
  - Action tests:
    - `searchBookingPatients needs schedule edit`
    - `short query returns nothing`
    - `forged patient id refused` (for unknown, archived and other-company ids)
    - `bookSurgery sends p_patient from patientId`
  - Slot-form test: submitting sends `patientId`.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean. Run `npm run test:db -- booking-patient-search` → PASS.
- [ ] **Step 5: Commit** — "Booking: search and confirm the patient".

### Task 4: App — spares on a new booking, the card and the pull list
**Files:**
- Modify:
  - `schedule/new/slot-form.tsx`;
  - `src/lib/schedule/schemas.ts`;
  - `schedule/actions.ts`, where `bookSurgery` calls `create_surgery_slot_v4` with every parameter named, as with v3;
  - `src/lib/schedule/queries.ts`, which embeds `spares:slot_spare_implants(tooth, position, product:products(*))`;
  - the booking card in `schedule/page.tsx` (or the component it uses);
  - `schedule/pull-list/page.tsx`, which calls `pull_list_v2` and adds a `Spares` column;
  - `src/lib/schedule/types.ts` (`PullRow.spares`);
  - the tests next to each.

**Interfaces:**
- **Consumes:** `create_surgery_slot_v4`, `pull_list_v2` (Task 1).
- **Produces:**
  - The form row type `ImplantRow = { tooth: string; productId: string; technique: Technique | ''; spares: string[] }`, exported from `src/lib/schedule/schemas.ts` and reused by Task 5.
  - A `SparesEditor({ tooth, value, products, onChange })` component in `schedule/new/spares-editor.tsx`:
    - one implant select per spare, using `productLabel`;
    - a remove ×;
    - `+ Add spare`, hidden at 5.
  - The schema item gets `spares: z.array(z.string().uuid()).max(5)`, sent as `spares` in each `p_implants` item.

- [ ] **Step 1: Failing tests:**
  - `add and remove spares`
  - `no more than 5`
  - `payload carries spares per tooth`
  - card test: `shows Spares: <labels> per tooth, nothing when none`
  - pull-list test: `shows the Spares column`
  - action test: `bookSurgery calls create_surgery_slot_v4`
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Booking: spare implants per tooth, on the card and the pull list".

### Task 5: App — edit every planned implant
**Files:**
- Modify:
  - `schedule/[id]/edit/page.tsx`: load the planned rows with site state and spares;
  - `schedule/new/slot-form.tsx`: the edit mode reuses the `ImplantRow` editor and shows the patient card;
  - `src/lib/schedule/schemas.ts`;
  - `schedule/actions.ts`, where `updateBooking` calls `set_booking_implants` first and then `update_surgery_slot_v3`;
  - the tests.

**Interfaces:**
- **Consumes:** `set_booking_implants` (Task 2), `ImplantRow` and `SparesEditor` (Task 4), and `PatientPicker`'s card (Task 3), shown read-only in edit mode.
- **Produces:**
  - Edit-mode rows carry `placed: boolean`. A placed row renders read-only (tooth, product, technique) with `Placed — change it in Corrections`, and its `SparesEditor` stays editable.
  - `updateBooking` sends the full set. It no longer calls `set_implant_technique`.
  - If `set_booking_implants` fails, its message is returned and nothing else is saved.
  - If the second call fails, the message says the implants were saved and the rest was not.

- [ ] **Step 1: Failing tests:**
  - `edit rows are editable and pre-filled`
  - `placed row is read-only with the Corrections note`
  - `can add and remove a tooth`
  - `payload is the full set including placed rows unchanged`
  - `updateBooking calls set_booking_implants then update_surgery_slot_v3`
  - `implants refused → no second call`
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → clean. Then `npx playwright test schedule slot-placement --project=chromium`: check :3000 and memory first, stop any server you start, and rerun a cold-compile timeout once.
- [ ] **Step 5: Commit** — "Booking edit: change the tooth, implant, technique and spares until placed".

### Task 6: E2E, docs and local verification
**Files:**
- Create `web/tests/e2e/booking-spares.spec.ts`.
- Modify:
  - `web/src/app/(app)/schedule/CLAUDE.md`, with one bullet "Patient picker and spares (0125–0126)";
  - the repo-root `CLAUDE.md`, with one line in the Modules/Doctors area naming `create_surgery_slot_v4`, `set_booking_implants` and `pull_list_v2` as what the app calls.

- [ ] **Step 1: E2E tests** (`uniqueName()` patients; `chooseImplant` style per `implants.spec.ts`; E2E brand products):
  - `book with a searched patient and 2 spares`: the card shows `Spares:` with both labels;
  - `edit: change implant and spares, add then remove a tooth`: the card follows;
  - `placed tooth is locked`: place from the booking, then reopen the edit and see `Placed — change it in Corrections`.
- [ ] **Step 2:** `npx playwright test booking-spares schedule slot-placement implants --project=chromium` → PASS.
- [ ] **Step 3: Verify.**
  - `./scripts/ship.sh verify booking-spares schedule` (verify only).
  - `npm run isolation:check` (local) → 0.
- [ ] **Step 4: Commit** — "E2E and docs: booking patient picker and spares". Then stop and report to the owner. No push.
