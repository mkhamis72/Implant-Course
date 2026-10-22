# Radiographs and bone levels (research part 4) — design

Part 4 of the research roadmap (`2026-10-17-research-capture-surgery-design.md`), decided with the owner on 2026-10-22.

## Why
For research, the app needs to know when each implant was X-rayed, why, and (when someone measured it) how much bone sits around the implant. That way a later analysis can find the baseline image and the follow-ups and see bone change over time. Images stay in the clinic's imaging software. The app keeps a log, an optional link, and optional measurements.

When X-rays are taken at the courses (owner):
- before surgery, for planning;
- right after placement, as the baseline;
- at loading / crown fit;
- at follow-up visits.

Types used (owner): **periapical** and **CBCT**. CBCT is also used for planning.

## Goals
1. **X-ray record on the patient** (owner). Each record holds:
   - **date**;
   - **type**: `periapical` / `cbct`;
   - **purpose**: `planning` / `baseline` (after placement) / `loading` (crown fit) / `follow_up` / `other`;
   - **teeth shown**: one or more FDI teeth, in any jaw (a CBCT can show both);
   - **optional link**: a URL to the image elsewhere;
   - **notes**.
2. **Optional bone levels** (owner). For each implant on the X-ray, the **mesial** and **distal** bone level in mm, measured from the **implant shoulder / platform** (owner).
   - Blank means not measured, never zero.
   - No examiner is recorded (owner).
   - *My call:* positive = bone below the shoulder (bone loss side). 0 = bone level with the shoulder. Negative = bone above the shoulder. The range is −5.0 to 15.0 mm, with one decimal.
   - The form explains the sign.
3. **Where it shows:**
   - A new **X-rays** tab on the patient page (between Implants and Overview): list, add, edit, undo.
   - *My call:* each implant's tooth panel also gets an **X-rays** tab listing the X-rays that show that implant, with its bone levels. Adding from there pre-ticks the implant's tooth.
4. **Who:** Patients view reads; Patients edit writes, the same as other clinical records. Every change is audited and appears in History.

## Non-goals
- Storing or viewing image files in the app.
- Bone-loss calculation, comparability rules, or success criteria (part 5: outcomes and data quality).
- Panoramic X-rays (the owner said they're not used). The type list can grow later.
- Examiner or calibration tracking (the owner said no).

## Anti-goals
- A blank bone level treated as 0.
- A measurement stored against an implant that isn't on that X-ray's teeth.
- Breaking the previous app version during the release window.

## Constraints (project rules, CLAUDE.md)
- New tables are written only through `security definer` functions:
  - `require_perm('patients','edit')` comes first;
  - optimistic concurrency on `updated_at` for edits;
  - void with a reason instead of hard delete;
  - `app_private.fail` messages;
  - RLS select with View on Patients (restrictive `can`);
  - audit trigger, plus the `patient_history` and audit-log read policies extended for the new tables;
  - grants as in 0057.
- Cairo dates: the date is today or earlier.
- *My call:* the date can be before placement, because planning X-rays come first.
- Purpose `baseline` / `loading` / `follow_up` needs at least one placed implant among the teeth shown.
- Migrations are additive: new tables and functions only (0064+). Nothing existing changes, so the release window is safe.
- Bone levels can be saved only for implants (sites placed, restored or failed) whose tooth is in the X-ray's teeth.
- Edits (see "One save contract" below):
  - Editing an X-ray can change its date, type, purpose, teeth, link and notes.
  - Removing a tooth that has a measurement is refused, with a message to clear that measurement first.
- The link must be `http(s)://…`, up to 2000 characters. It is stored as text and rendered with `rel="noopener noreferrer"`, `target="_blank"`. It is not fetched by the app, so the CSP needs no change.

## Settled after the builder check (my calls)
- **X-rays without implants are valid.** A planning or CBCT X-ray can show only teeth with no implant, and then has no bone-level rows. A measurement needs an implant site in state placed, restored or failed on one of the X-ray's teeth when it is saved.
- **Implant purposes:** `baseline` / `loading` / `follow_up` need at least one implant on the ticked teeth (placed, restored or failed) whose `placed_on` ≤ the X-ray date. This is checked on both add and edit. `planning` and `other` have no such rule.
- **Ownership and deletes:**
  - A measurement belongs to its implant site, and stays with that site even if the tooth later gets a new implant. Failed sites still accept measurements, since bone loss before failure is useful data.
  - Foreign keys cascade with the patient and the site. The only hard delete is `delete_patient`, which already deletes the patient's sites, so `delete_patient` and `delete_course` need no change.
- **Undo** follows the restorations pattern:
  - `void_…(id, reason)`; the record is hidden from lists, and its bone levels go with it.
  - It can't be reversed. History shows "X-ray removed from the record (reason)".
  - Archived patients keep their X-rays.
- **One save contract:** `save_radiograph` covers both add and edit. It takes the fields, the teeth array and the measurements as one jsonb list of `{site, mesial_mm, distal_mm}`. The whole measurement set is replaced on each save, with optimistic concurrency on the X-ray's `updated_at`. A measured tooth can't be removed from the teeth list while its measurement row is still sent.

## Existing code to build on
- Teeth picking: the restoration form's teeth UI (`patients/[id]/restorations.tsx`, `src/lib/restorations/restorations.ts`: `ARCH_ORDER`, `jawOf`). Here the teeth needn't be contiguous.
- Patterns:
  - table, RLS and audit: `0057_restorations.sql`;
  - forms and actions: `restorations.tsx` / `restoration-actions.ts`;
  - patient tabs: `patients/[id]/patient-tabs.tsx`;
  - implant tabs: `src/lib/patients/implant-tabs.ts`;
  - history labels: `src/lib/patients/history.ts`.

## Left to the builder
- Table and function names. Expected shape: a radiographs table, and a bone-level table keyed by radiograph + implant site.
- The layout of the list and form.
- How bone levels are entered on the form: one row per implant on the ticked teeth.
- History wording.
