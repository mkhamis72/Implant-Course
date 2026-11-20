# Design: Booking a surgery — patient picker, spare implants, full editing

> **Status (2026-11-20):** approaches approved by the owner in chat. This is part A of the owner's 2026-11-18 list (`2026-11-18-owner-requests-backlog.md`). Part B (clinic workflow) and the Patients-list pages are live.

## Context and why
The owner wants three things when booking an implant surgery (owner, 2026-11-18):
1. **The right patient.** Organizers mixed up patients by file number. The owner wants to search by name and open the patient's file to confirm before booking.
2. **Spare implants for each tooth.** Next to the planned implant, list the backups to have ready. Spares are prepared from stock before the surgery. They are **just a list**: no stock is reserved or moved (owner, 2026-11-20).
3. **Edit everything.** Editing a booking should change the tooth, the planned implant and the spares, not only the technique.

**Today** (`web/src/app/(app)/schedule/new/slot-form.tsx`, `schedule/new/page.tsx`, `schedule/actions.ts`):
- The patient is chosen in a text box, `Patient (file number)`, with a `<datalist>` of up to 2000 names. The page reads `patients` directly (`file_no, full_name`, not archived). A wrong file number books the wrong patient.
- "Implants needed" holds rows of tooth, implant (optional) and technique. `create_surgery_slot_v3` (0122) turns each row into a planned `implant_sites` row and a `slot_planned_implants` row (0014: `slot_id`, `tooth`, `product_id`, `implant_site_id`, unique per slot and tooth).
- Editing a booking (`[id]/edit`) keeps the patient fixed. The implants show only a technique select, saved through `set_implant_technique`.
- Spares don't exist.

## Goals / non-goals / anti-goals
- **Goals:**
  - The patient is chosen by search and confirmed against their file.
  - Each booked tooth can carry spare implants, and they show where the tray is prepared.
  - Until an implant is placed, its tooth, planned implant, technique and spares can be edited, and teeth can be added or removed.
  - All of this works the same for clinics and course organizers.
- **Non-goals:**
  - stock reservation or stock movements for spares;
  - changing the patient of an existing booking (cancel and rebook, as today);
  - the product catalogue clean-up (part C).
- **Anti-goals:**
  - editing an implant that is already placed here (that stays in Corrections);
  - booking without a confirmed patient;
  - breaking the previous app version during a release (additive migrations, new function names).

## Approaches (chosen in chat, 2026-11-20)
- **Patient picker.**
  - **Chosen: search and confirm.** Type part of a name, file number or phone, then choose a match. A confirmation card shows file no, name, age and phone, with **Open file** (new tab) and **Change**.
  - **Rejected:** a clearer datalist with a confirm tick. Cheaper, but you still pick from one long list, which is where the mix-ups happen.
- **Spares.**
  - **Chosen:** a list of catalogue implants under each tooth, using the same implant choice as the planned implant. They show on the booking card.
  - **Rejected:** free-text notes per tooth. Simpler, but unchecked text brings back the mix-ups the owner wants gone.
- **Editing.**
  - **Chosen:** full editing of the planned implants until placement. A placed implant is shown read-only with "Placed — change it in Corrections".

## Design

### 1. Patient picker (booking form, new booking only)
- **Search.** A search box labelled `Patient`. After 2+ characters (debounced), it shows up to 10 matches: file no, name, age, phone.
  - It searches through a server action that calls `search_patients_v2` (0124) with offset 0 and limit 10, excluding archived patients.
  - The action needs Edit on Schedule, as booking does. The patients rows must be readable to Schedule users: 0032 lets Schedule read patients. The builder confirms `search_patients_v2` (security invoker) works for a Schedule-only user; if not, add a narrow reader.
- **Confirm.** Choosing a match replaces the box with a card: `0412 · Ahmed Ali · 54 · 010…` with **Open file ↗** (`/patients/<id>`, new tab) and **Change**.
- **Submit.** The form sends the patient's **id**, not the file number, and the action checks it exists. `bookSurgery` today sends `patientFileNo`; it moves to `patientId`. Check what `create_surgery_slot_v3` takes and keep that call.
- The 2000-row patient list and the `<datalist>` are removed from `schedule/new/page.tsx`.
- **Keyboard and accessibility:** a combobox pattern (`role="combobox"`, a listbox, arrow keys and Enter), and the card is announced.

### 2. Spare implants
- **Data.** A new table `public.slot_spare_implants`:
  - columns: `id`, `slot_id` (cascade), `tooth` (`fdi_tooth`), `product_id` (an active implant product, not null), `position smallint`, `company_id`, as on the other tenant tables;
  - unique `(slot_id, tooth, product_id)`;
  - RLS, audit trigger and grants following `slot_planned_implants` (readers as for bookings, writes only through the definer functions).
  - The builder adds it to the restore `TRUNCATE` list only if it seeds rows; it won't.
- **Rules.**
  - A spare belongs to a tooth that is in the booking.
  - There are at most 5 spares per tooth (my call).
  - A spare may not repeat the planned implant or another spare for that tooth.
  - An inactive product is refused, with the same message as the planned implant (`Choose an implant from the catalog.`).
  - When a tooth leaves the booking, its spares go with it. A cancelled booking keeps its spares, for the record.
- **Form.** Under each tooth row: `Spares` with an `+ Add spare` link. Each spare is an implant select of the same kind as the planned implant, with a remove ×.
- **Booking card / day view.** Each tooth line gets `Spares: Ø4.0 × 11.5, Ø4.5 × 10`, using the product label used today. A booking without spares shows nothing extra.
- **Print.** If the booking has a printed or detail view, spares appear there too. The builder checks what exists and does not add a new print page.

### 3. Editing the implants of a booking
- **New function** `public.set_booking_implants(p_slot uuid, p_implants jsonb) returns void`. It is a definer, with `require_perm('schedule','edit')` first and no defaulted parameters.
  - `p_implants` is the **whole** planned set: `[{ tooth, product_id|null, technique, spares: [product_id…] }]`.
  - The function makes the booking match it:
    - **New tooth:** the same rules as booking. It gets a planned site, a `slot_planned_implants` row and `set_tooth 'implant_planned'`. A tooth planned in another active booking is refused, and so is a tooth that already has an implant.
    - **Changed tooth:** treated as remove + add.
    - **Changed product or technique:** updates the planned site and the `slot_planned_implants` row.
    - **Removed tooth:** removes its `slot_planned_implants` row and its spares. The planned site goes the same way it does when a booking is cancelled today; the builder reads `cancel_surgery_slot` and copies that rule.
    - **Spares:** replaces that tooth's spares.
  - **Placed is locked.** Any tooth whose site is no longer `planned` (placed, restored, failed) must come back unchanged: same tooth, same product, same technique. Otherwise it is refused with `Tooth N is already placed; change it in Corrections.` Its spares may still change (my call: harmless, and useful after the fact).
  - Only for bookings that are not `cancelled` or `done` (`set_slot_status`). Otherwise `This booking is closed.`
  - Order: lock the slot row, then its sites (the existing lock order is site → batch, and no batches are touched).
- **Booking a new surgery:** add `create_surgery_slot_v4`: the v3 body (0122) plus `spares` read from each `p_implants` item, all in one transaction. The app calls v4, and v3 stays for the previous version. My call: two separate calls (book, then add spares) could leave a booking without its spares if the second failed.
- **Edit form.**
  - It keeps the patient fixed (shown as the confirmation card, with Open file).
  - The implants section is the same editable rows as a new booking (tooth, implant, technique, spares, `+ Add another implant`, remove), pre-filled from the booking.
  - Placed teeth are shown read-only with `Placed — change it in Corrections`.
  - Saving calls `update_surgery_slot_v3` (time, people, notes, as today), then `set_booking_implants`. Their order and partial failure are left to the builder. Prefer the implants first, since that is the call that can be refused, or one new RPC wrapping both.
  - `set_implant_technique` is no longer called from this form.

### 4. Both company types
- The picker, spares and editing behave the same in a clinic and in a course organizer company. The clinic rules from 0120/0122 (recorded teaching values kept, date moves) are unchanged.

## Constraints
- **Migrations:**
  - New migrations start at **0125** (the latest is 0124).
  - They are additive: `create_surgery_slot_v3`, `update_surgery_slot_v3` and `set_implant_technique` stay for the previous app version.
  - No overloads and no defaulted parameters.
- **Conventions:**
  - definer functions follow the repo conventions;
  - the new table gets explicit grants (0019) and a company scope like its siblings;
  - `tests/db/permissions.test.ts` and `module-guards.test.ts` stay green;
  - React 19 form rules apply; use named tokens and the shared classes; CRLF; no Prettier.
- **Nothing goes online without the owner.**

## Calls made after the builder check (mine, for the owner to check)
1. **A Schedule-only user** (no Patients view):
   - The card always shows file no, name, age and phone. Schedule users can already read patient rows (0032), so nothing new is exposed.
   - **Open file** shows only when the user can view Patients (`canView(profile, 'patients')`). Otherwise the card says `File: no access` and the details on the card are what they confirm against.
2. **Removing a tooth from a booking** works exactly as cancelling a booking does today (`cancel_surgery_slot`):
   - The planned site is detached (`slot_id`, `session_id` and `course_id` set to null), and the tooth stays "implant planned" on the chart, without a booking.
   - Its `slot_planned_implants` row and spares are deleted.
   - Re-adding that tooth later reuses the detached planned site, as booking already does.
3. **A changed tooth number** is a removal plus an addition. Planned rows have no identity across a tooth change, and the payload carries no row ids.
4. **Spares after placement and completion:**
   - Placing an implant does not touch the spares.
   - A spare used in place of the planned implant is not marked; the placed record names the product actually used.
   - Spares stay on the booking card after the booking is done.
5. **No clinic-specific logic** in `set_booking_implants`. Product, technique and spares are not teaching values. Changing implants causes no time clash, so no clash override applies. Time, date and people stay in `update_surgery_slot_v3` with its existing checks.
6. **What counts as a spare:**
   - A spare may be any active implant product, of any system.
   - A spare is allowed when the planned implant is not chosen yet.

## Left to the builder
- The exact debounce and min-length of the search, and the empty and no-match text.
- Whether the edit saves in one RPC or two (no partial save the user can't see).
- The product label for spares (reuse `productLabel`).
- Where spares show on the day view, if the card is too tight there.

## Verification (local only)
- **DB tests:**
  - spares on create (v4);
  - set_booking_implants: add, remove and change a tooth, change the product and technique, replace spares;
  - limits: the max spares, a duplicate spare, an inactive product;
  - refusals: a placed tooth locked, a closed booking, a tooth in another booking;
  - permissions;
  - tenant isolation of `slot_spare_implants`.
- **Unit and component tests:**
  - the picker: search, choose, card, Open file link, Change, keyboard;
  - spares rows: add, remove, max;
  - the edit form: placed rows read-only; the payload;
  - the card shows spares.
- **E2E:**
  - book with a searched patient and 2 spares; the card shows them;
  - edit: change the tooth, implant and spares, then remove a tooth;
  - once placed, the tooth is locked.
- **Checks:** full `test:db`, `npm test`, `tsc`, lint, `isolation:check`.
