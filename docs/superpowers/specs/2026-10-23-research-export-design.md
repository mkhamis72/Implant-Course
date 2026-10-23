# Research export (research part 6) — design

Part 6 of the research roadmap, decided with the owner on 2026-10-23. It builds on 5a/5b: `outcomes-v1` readers, the Research page, and the Research permission.

## Why
The owner and a statistician need the course data outside the app:
- Excel, for quick tables;
- SPSS / R / Stata, for analysis (part 7 does statistics outside the app).

The export must be anonymised, complete, and explained by a data dictionary, so that every column means the same thing in every export.

## Goals
1. **Export button on the Research page.** It uses the page's current filters: course, placement dates, placing delegate, brand / type. The included implants are the same set the page shows.
2. **Formats** (owner: both): the user chooses
   - an **Excel workbook** (one sheet per table plus a Data dictionary sheet), or
   - a **ZIP of CSV files** (one CSV per table plus `data_dictionary.csv`; UTF-8 with BOM so Excel opens Arabic / accents correctly).
3. **Tables** (owner: all four groups):
   - **implants**: one row per placed implant in the filter.
     - Placement: date, tooth, jaw, technique, product brand / system / diameter / length, course, placing delegate (as a code, see goal 4), supervisor (as a code).
     - Surgical details (part 1): timing, phenotype, mucosa, flap, torque type, healing, closure, grafting; insertion torque, ISQ, bone type.
     - Scan / impression.
     - Every `implant_outcomes` column: survival milestones, event, follow-up days, latest ICOI grade and its reason, complication counts, version.
   - **patients**: one row per patient with ≥ 1 exported implant.
     - Study code, sex, age at first placement (whole years, from `dob`).
     - Every medical-history risk factor (part 1): smoking / cigarettes per day, diabetes status / HbA1c, the `*_status` fields, periodontitis history, bruxism, previous implant failure.
   - **visits**: one row per non-voided visit of an exported implant (all findings).
   - **radiographs**: one row per non-voided X-ray × exported implant on its teeth (date, type, purpose, mesial / distal bone level).
   - **complications**: one row per non-voided implant complication.
   - **restorations**: one row per non-voided restoration on ≥ 1 exported implant (stage, type, teeth, dates, retention, material, end kind). Plus **restoration_problems**.
   - **grafts**: one row per implant graft.
   - *My call:* keys are `implant_id` (a new stable export code per implant, see goal 4), `patient_code`, `restoration_code`, so tables join in any tool.
4. **De-identification** (owner):
   - No names, phone numbers, emails, addresses, file numbers or free-text notes.
     - Free text such as notes and reasons is dropped, because names can hide in it (see "Settled after the builder check").
   - **Dates are kept.**
   - Patients, implants, restorations, delegates and supervisors get **stable study codes** (owner: the same code every time), e.g. `P-7F3K9Q`, `I-…`, `R-…`, `D-…`, `S-…`.
     - Codes are random, stored once in a private table (`app_private.research_codes`: entity type, entity id, code, unique), and reused in later exports.
     - They are never derived from the id, so they can't be reversed.
5. **Coded values:** every column holds the app's stored value (e.g. `digital_scan`, `I`, `not_reached`). The **data dictionary** lists, for each table and column:
   - column name, label, type, unit, allowed values with their labels, source (which form or rule), and notes;
   - for outcome columns, the rule version `outcomes-v1` and a one-line rule summary.
   - *My call:* Excel users read labels from the dictionary sheet. No duplicated label columns.
6. **Export log** (owner): every export records who, when, format, filters, and the row count per table, in `public.research_exports`.
   - Admins see the log on the Research page (a "Recent exports" section, admins only). It can't be edited or deleted.
7. **Access** (owner): anyone with **Research → View**, which needs Patients view as on the page.

## Settled after the builder check
- **Free text never leaves the app** (owner, 2026-10-23).
  - Only CHECK- or enum-constrained values, numbers, dates, booleans and study codes are exported.
  - Every free-text column is excluded, including `notes`, `voided_reason`, `end_reason`, `failure_reason`, `failure_notes`, complication treatment text, "other" details and the radiograph `link`.
  - The dictionary test enforces an **allowlist**: a column can only be exported if it has a dictionary entry marked coded, numeric, date or code.
  - `latest_grade_reason` *is* exported, since it is derived by SQL from a fixed set of criterion names. Its dictionary entry lists them.
  - Restorations export `end_kind` only.
- *My call:* **voided rows.**
  - An implant is exported if it is in `implant_outcomes_detail` with the filters, whatever its child rows are.
  - Child tables exclude voided rows.
  - A test checks that the implants' outcome columns match what the Research page shows for the same filters.
- *My call:* **restorations** are every non-voided restoration (all types and stages, current or ended) joined through `restoration_sites` to an exported implant. Their delegate and supervisor are exported as D- and S- codes.
- *My call:* **radiographs** have one row per non-voided X-ray × exported implant whose tooth is in the X-ray's teeth. Mesial and distal levels are empty when that implant wasn't measured. Purpose is included, so planning X-rays are identifiable.
- *My call:* **study codes**:
  - They are per company (each company's own database).
  - `app_private.research_codes` is filled at runtime, not seeded, so the restore TRUNCATE list doesn't need it. The nightly dump includes `app_private`, so codes survive a restore.
  - Deleting a patient, implant or delegate leaves its code row orphaned. That is harmless, because a code alone identifies no one.
- *My call:* a missing `dob` gives an empty age. `dob` itself is never exported.
- *My call:* **access.** Research view without Patients view gives a clear refusal: "Research export needs View on Patients". `research_code()` and the export readers require both permissions.
- *My call:* **the filtered set** is exactly the Research page's filters: course, from, to, delegate, brand, system. Every child table is built from the `site_id` list of `implant_outcomes_detail` with those values.
- *My call (re-identification):* the owner chose to keep dates. The dictionary's front sheet notes that exact dates combined with tooth, sex and age can identify a person in a small course, and that the file must be handled as confidential. The export log records each export.

## Non-goals
- Statistics or charts beyond 5b.
- Ethics, consent and study registration (part 8; the export log is the only governance piece here).
- Scheduled or automatic exports.
- Importing data back.

## Anti-goals
- Any direct identifier in the file, including inside free text.
- Study codes that change between exports.
- A column without a dictionary entry.
- An export that silently differs from the Research page's filtered set.

## Constraints
- **Build the data in SQL; files in TS.**
  - The export rows come from a security-invoker SQL reader per table (or one function returning jsonb per table), gated by `can('research','view')`. Filters reuse `implant_outcomes_detail` logic.
  - Study codes are assigned by a definer function `app_private`-backed `research_code(entity, id)`, called from the export path; it needs the research permission check.
  - Logging is a definer write, `log_research_export(...)`.
- **Files** are generated in a Next.js route handler (`/patients/research/export?format=xlsx|csv&…filters`), guarded by `requirePermission('research')`, and streamed as a download.
  - *My call:* the libraries are **exceljs** (MIT) for xlsx and **fflate** (MIT) for zip. They are new dependencies, server-only, so there is no CSP change.
- Dictionary entries live in one TS module, `src/lib/research/dictionary.ts`. A unit test fails if any exported column lacks an entry.
- Migrations are additive, and the new tables grant what they need (`research_exports`: select for admins, insert only via the function).
- Size: course-scale data, so building in memory is fine.

## Left to the builder
- Column order within each table.
- Sheet styling (bold header, frozen first row).
- The export button's placement.
- The exact shape of the dictionary.
- Whether readers return jsonb or `setof` records.
