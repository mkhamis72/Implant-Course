# Research governance (research part 8) — design

Part 8 of the research roadmap (`docs/superpowers/specs/2026-10-17-research-capture-surgery-design.md`), decided with the owner on 2026-10-23. It builds on 5b (Research page and permission) and 6 (export and export log).

## Why
The owner plans to seek ethics approval and publish course results. Two things are needed for that:
- proof of each patient's consent, for treatment by trainees, research use, teaching images and follow-up;
- a record of which ethics approval and protocol a dataset was produced under.

Nothing is collected today. Consent will become part of the treatment consent the patient signs at the course.

## Goals

### 8a: Patient consent
1. **The consent form** (owner) is one combined form with four items, each accepted or refused by the patient:
   1. treatment by course delegates under supervision;
   2. research use of anonymised data;
   3. clinical photos and X-rays used for teaching and publication (no face or name);
   4. follow-up visits and phone contact.
   - Two languages, **English and Arabic**. The patient chooses one (owner), and the printout is in that language only.
   - Draft text: `docs/consent/consent-form-v1.md` (committed with this design). It must be reviewed by the owner's lawyer or ethics committee before use.
   - The draft text is the builder's source for the printable form.
2. **Printing** (owner: both), from the patient page:
   - **prefilled**, with patient name, file number, date and course;
   - **blank**, from the Consent settings, for bulk printing.

   The language is chosen at print time. The form shows its version (e.g. `v1`) in the footer.
3. **Form versions:**
   - Each version of the form text is stored with a label (`v1`) and an effective date.
   - The current version is what prints.
   - *My call:* versions are kept in the database (`consent_form_versions`: label, effective date, English text, Arabic text), so a wording change needs no release.
   - Adding a version is an admin task in Admin → Settings → Consent.
   - A version is editable only until a consent record references it (see "Settled after the builder check").
4. **Recording a signed form** (owner): someone with Patients Edit records, on the patient page:
   - the four answers (yes / no each);
   - the date signed (today or earlier);
   - the form version and the language;
   - an **uploaded scan** (owner: photo or PDF) of the signed paper.
   - *My call:* the upload is required to record consent, because the scan is the proof.
5. **History of consent:**
   - A new signed form becomes the current consent. Earlier ones stay viewable, listed with their dates and versions.
   - *My call:* a record can be voided with a reason (wrong patient, unreadable scan), as with radiographs.
   - Records are never edited in place; record a new one instead.
   - There is no withdrawal flow (owner: not needed). Refusing an item means answering "no" on a new form.
6. **Access** (owner): anyone with Patients View can see the consent record and open the scan. Patients Edit is needed to record or void one.
7. **Badge** (owner): when a patient has no current consent record, the patient header shows **"No consent on file"**.
8. **Research page and export** (owner: warn, don't exclude):
   - Everyone is still included.
   - The Research page shows a warning line, e.g. `⚠ 12 of 40 patients have no research consent on file (8 not recorded, 4 refused)`.
   - The export's about sheet / README carries the same counts.
   - *My call:* the export's `patients` table gets a coded column `research_consent` (`yes` / `no` / `not_recorded`), from the current record. It gets a dictionary entry.

### 8b: Studies and ethics approvals
9. **A Studies section** under the Research page (`/patients/research/studies`). Each study records:
   - title;
   - ethics committee;
   - approval number;
   - approval date;
   - protocol name, version and date;
   - the courses covered (owner: the course list);
   - an uploaded **approval letter** (owner: PDF or photo, optional);
   - notes.

   There is no expiry tracking (owner).
10. **Who edits** (owner: Research holders):
    - The `research` area gets an **Edit** level. Today `user_permissions` refuses `edit` for research (0069), so that must change.
    - Research Edit adds and edits studies. Research View reads them.
    - Admins always have Edit.
    - *My call:* deleting a study is admin-only, and refused once an export references it.
11. **Export link** (owner: optional):
    - The Export form gets an optional **Study** picker.
    - When chosen, the file's about sheet / README names the study title, committee, approval number and protocol version.
    - `research_exports` records the study id, and Recent exports shows the study title.

## Settled after the builder check

### Owner decisions (2026-10-23)
- **A study is a label on an export.**
  - Choosing a study names it in the file and the log. It does not filter or check courses.
  - The study's "courses covered" is a descriptive list, stored as a join table so it can be shown and edited. Nothing enforces it.
- **The draft v1 stays editable until it is first used.**
  - v1 is seeded from the draft.
  - Admins can edit a version's text until a consent record references it. After that it is locked; the database refuses the change.
  - New wording after that becomes a new version.
  - The "current version" is the one with the latest effective date on or before today.
- **Answers are recorded only.**
  - No answer changes app behaviour: no booking or placement warning, no recall marking, no X-ray note.
  - The only consent-driven displays are the "No consent on file" badge (no current record at all) and the research-consent warning and export column (item 2).

### My calls
- **Which patients the consent counts cover.**
  - The Research page warning and the export about-sheet counts cover the patients behind the current filtered implant set, the same patients as in the export's `patients` table. "12 of 40" means 40 patients in the file.
- **What counts as the current record.**
  - The current record is the latest non-voided record by date signed, then by recorded time.
  - Voiding it falls back to the previous one.
  - `research_consent` maps as follows: no current record gives `not_recorded`; item 2 = no gives `no`; item 2 = yes gives `yes`.
- **The course on the prefilled form.**
  - The print page has a Course select listing the patient's courses (through bookings or placements), newest first.
  - It may be left blank, and the form then shows an empty line.
  - The consent record doesn't store a course.
- **Guardian details** are on the scan only. Nothing about guardians or minors is captured in the app.

## Settled with the owner
- Withdrawal of consent: not needed.
- Egyptian data-protection law (151/2020): nothing in the app. The owner handles it with their lawyer.
- Consent form versions are independent of studies: one treatment consent covers all courses.

## My calls
- **File storage.**
  - Scans and letters are stored in the database, like the branding logo (`branding_logos`, 0040). They go in a table of their own (`stored_files`: bytes, content type, size, uploaded by/at), referenced by the consent record or the study.
  - Why: the nightly data-only backup and restore already cover the database, and RLS stays in one place. Supabase Storage would need its own backup job.
  - Size limits:
    - images are re-encoded in the browser to JPEG at most 2000 px on the long side (about 300–600 KB);
    - PDFs up to 2 MB;
    - allowed types are JPEG, PNG, WebP (converted to JPEG) and PDF.
  - The Free plan's 500 MB database fits several hundred forms. Pro (planned at go-live) has 8 GB.
  - Bytes are kept out of `audit_log` (as for logos). The file id, size and type are audited.
  - Files are served by an app route that checks the reader's permission: consent files need Patients View; letters need Research View. The route sends `Content-Disposition: inline` and `Cache-Control: private, no-store`.
- **No new external origin**, so no CSP change.
- **Printing** is a print-styled HTML page (`/patients/[id]/consent/print?lang=en|ar`, with RTL for Arabic) printed by the browser. There is no PDF library.
- **Fonts:** Arabic uses the system font stack with `dir="rtl"`. No web font is added.
- **Restore `TRUNCATE`:** `consent_form_versions` is seeded with v1 from the draft, so it must be added to the restore `TRUNCATE` list in `docs/operations.md` §D, as CLAUDE.md requires.
- **Delegates** never see consent records or studies.

## Non-goals
- On-screen signatures (the owner chose upload).
- Expiry reminders and data-protection features in the app.
- Excluding non-consenting patients from figures (the owner chose a warning).
- Consent withdrawal workflows.

## Anti-goals
- A scan readable by someone without Patients View, or a letter readable by someone without Research View.
- Consent scans or approval letters appearing in any research export.
- A consent record that can't show which form version and language the patient signed.
- Changing a form version's text after patients have signed it.

## Constraints
- Migrations are additive.
  - Widening `research` to allow `edit` changes a check constraint and `set_user_permissions`. Use a new migration with `create or replace` of the latest definition.
  - `tests/db/permissions.test.ts` must stay green. Every new definer write starts with `require_perm`.
- The export allowlist rule (part 6) applies to `research_consent` and to the study fields shown in the about sheet.
- Two builds, shipped in order: **8a** (consent: tables, upload, print, badge, warnings, export column), then **8b** (studies, Research Edit, export picker). Each is its own plan and PR. 8a's `stored_files` is reused by 8b.

## Left to the builder
- Exact page layout for the consent card and the Studies list.
- Print typography.
- Where the blank-form link sits in the Consent settings.
