# Research export (part 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An anonymised research export (Excel workbook or a ZIP of CSVs, plus a data dictionary) of the Research page's filtered implants and their patients, visits, X-rays, complications, restorations, problems and grafts, with stable study codes and an export log.

**Architecture:**
- **Migration 0070:** the study-code store and `research_code`, the export log and `log_research_export`, and one security-invoker reader per export table. Every reader is built from the `implant_outcomes_detail` site list and returns only allow-listed columns.
- **TS:** `src/lib/research/export/` holds the dictionary (the allowlist), the CSV/XLSX/ZIP builders, and the table assembly.
- **Download:** a route handler serves the file. The Research page gets the Export button and an admin "Recent exports" list.

**Tech Stack:** Supabase SQL, Next.js 15 route handlers, exceljs (MIT), fflate (MIT), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-research-export-design.md`

## Global Constraints

**Process**
- Work from `web/`. Migration 0070 is additive. Dry-run it before `test:db`.

**What may be exported**
- **Never free text.** Only CHECK/enum-constrained values, numbers, dates, booleans and study codes.
- Excluded:
  - columns: `notes`, `voided_reason`, `end_reason`, `failure_reason`, `failure_notes`, complication treatment text, any "other" details, radiograph `link`;
  - identifiers: names, phone, email, address, file number, `dob`.
- `latest_grade_reason` is exported (SQL-derived, fixed vocabulary).

**Study codes**
- Prefixes: `P-` patient, `I-` implant, `R-` restoration, `D-` delegate, `S-` supervisor.
- Format: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Random, stored once in `app_private.research_codes (entity text, entity_id uuid, code text unique, primary key (entity, entity_id))`, and reused.

**Access**
- Exporting needs Research view **and** Patients view. Otherwise the refusal is "Research export needs View on Patients".

**Filters**
- Exactly the Research page's: course, from, to, delegate, brand, system (`rpcArgs` in `src/lib/research/view.ts`).
- The implant set = `implant_outcomes_detail(...)` with those values.

**Table rules**
- Child tables exclude voided rows.
- Restorations: every non-voided restoration joined through `restoration_sites` to an exported implant.
- Radiographs: one row per non-voided X-ray × exported implant whose tooth is in its `teeth`. Mesial and distal are empty when not measured.
- Age = whole years at the patient's first exported placement; empty when `dob` is null.

**Files**
- CSV: UTF-8 with BOM, comma, RFC 4180 quoting, header row, ISO dates `YYYY-MM-DD`, empty for null.
- XLSX: one sheet per table, then `data_dictionary` and `about`, with a bold, frozen header row.
- File names: `research-export-YYYY-MM-DD.xlsx` / `.zip` (Cairo date).
- The `about` sheet (and `README.txt` in the zip) carries the confidentiality note: "Exact dates combined with tooth, sex and age can identify a patient in a small course. Handle this file as confidential." It also gives the filters, the export time, the outcomes version, and the row counts.

**Export log**
- `public.research_exports (id, exported_by uuid, exported_at timestamptz default now(), format text check in ('xlsx','csv'), filters jsonb, row_counts jsonb)`.
- Written only by `log_research_export`. Select for admins only. No update or delete.

**Tables and sheet names**
- `implants`, `patients`, `visits`, `radiographs`, `complications`, `restorations`, `restoration_problems`, `grafts`.

## Review Focus
1. **Free text slipping through a new column:** the dictionary test fails for any reader column that isn't in the allowlist. (Task 2 test.)
2. **Study codes are stable** across two exports and differ between patients. (Task 1 test.)
3. **The export matches the page:** the implants in the export are the same set and count as `implant_outcomes_detail` with the same filters. (Task 1 test.)
4. **A CSV value with a comma, quote or newline** is quoted correctly, and Arabic text round-trips. Only coded values are exported, but labels in the dictionary may contain commas. (Task 2 test.)
5. **Research view without Patients view** gets the refusal message, not an empty file. (Task 3 test.)

---

### Task 1: Migration 0070 — codes, log, readers

**Files:**
- Create: `supabase/migrations/0070_research_export.sql`
- Test: `tests/db/research-export.test.ts`

**Interfaces:**
- Produces:
  - `public.research_code(p_entity text, p_id uuid) returns text`
    - security definer; refuses unless `can('research','view') and can('patients','view')` (`'Research export needs View on Patients'`);
    - inserts if missing, retrying on a code collision;
    - `p_entity` is one of `patient`, `implant`, `restoration`, `delegate`, `supervisor`.
  - `public.log_research_export(p_format text, p_filters jsonb, p_row_counts jsonb) returns uuid`
    - definer; same gate; `exported_by = auth.uid()`.
  - Readers, all `(p_course uuid, p_from date, p_to date, p_delegate uuid, p_brand text, p_system text)`, security invoker and gated by `can('research','view')`:
    - `research_export_implants`
    - `research_export_patients`
    - `research_export_visits`
    - `research_export_radiographs`
    - `research_export_complications`
    - `research_export_restorations`
    - `research_export_restoration_problems`
    - `research_export_grafts`
  - **Reader columns:**
    - each returns its entity's study code(s) through `research_code`. A security-invoker function can't call app_private, but it can call the public definer `research_code`;
    - it returns only allow-listed columns;
    - it never returns names, file numbers, `dob`, ids other than codes, or free text.
    - The implants reader returns every `implant_outcomes` column except `site_id` / `patient_id`, which are replaced by `implant_code` / `patient_code`. It adds the placement, product, surgery, stability and scan/impression columns.
    - The column lists per reader are the builder's to settle, as long as they follow the spec's goal 3 and the allowlist rule. List them in the report.

- [ ] **Step 1: Write the failing DB tests:**
  - **codes:**
    - same patient → the same `P-` code on two calls;
    - two patients → different codes;
    - format `^P-[A-HJ-NP-Z2-9]{6}$`.
  - **gates:**
    - Research view without Patients view → refused by `research_code` and `log_research_export`;
    - no research permission → readers return 0 rows.
  - **set equality** (Review Focus 3): the count and codes from `research_export_implants` match `implant_outcomes_detail` with the same filters.
  - **voided children excluded:** a voided visit, X-ray, complication or restoration doesn't appear.
  - **radiograph rows:** an X-ray covering 34 and 36 with only 36 measured gives 2 rows when both are exported implants, and 34's levels are null.
  - **no identifiers:** a seeded patient with a name, phone and file number has none of those strings in any reader output. Scan every text value of every row.
  - **export log:** `log_research_export` inserts; a non-admin can't select from `research_exports`; update and delete are refused.
- [ ] **Step 2: Run** `npm run test:db -- research-export`. Expected: FAIL.
- [ ] **Step 3: Write 0070** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- research-export research permissions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): research export readers, study codes and export log (0070)`

### Task 2: Dictionary + file builders (pure TS)

**Files:**
- Create: `src/lib/research/export/dictionary.ts`, `csv.ts`, `xlsx.ts`, `zip.ts`, `assemble.ts` (+ tests)
- Modify: `web/package.json`: add `exceljs` and `fflate`, at exact current versions.

**Interfaces:**
- Consumes: Task 1 reader column names (from the migration).
- Produces:
  - `DICTIONARY: Record<TableName, Record<string, { label: string; kind: 'code' | 'coded' | 'number' | 'date' | 'boolean' | 'text-derived'; unit?: string; values?: Record<string, string>; source: string; notes?: string }>>`
    - `text-derived` is used only for `latest_grade_reason`.
  - `type ExportTables = Record<TableName, Record<string, unknown>[]>`
  - `assertAllowlisted(tables: ExportTables): void` throws when a column isn't in `DICTIONARY`.
  - `toCsv(rows, columns): string` (with BOM)
  - `buildXlsx(tables, meta): Promise<Uint8Array>`
  - `buildZip(tables, meta): Uint8Array` (CSV per table + `data_dictionary.csv` + `README.txt`)
  - `type ExportMeta = { exportedAt: string; filters: Record<string, string | null>; version: string; rowCounts: Record<TableName, number> }`
  - `exportFileName(format, todayIso): string`

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 1:**
    - every column of a sample of each reader's columns (a fixture copied from the migration's return lists) is in `DICTIONARY`;
    - `assertAllowlisted` throws on an unknown column `notes`.
  - **`toCsv`** (Review Focus 4): BOM present; `a,b` → `"a,b"`; `a"b` → `"a""b"`; newline quoted; null → empty; Arabic preserved.
  - **`buildXlsx`:** reading it back with exceljs gives the sheets `implants … grafts, data_dictionary, about`, a bold frozen header, and the confidentiality sentence in `about`.
  - **`buildZip`:** unzipping (fflate) lists `implants.csv … grafts.csv, data_dictionary.csv, README.txt`.
  - **`exportFileName`:** `research-export-2026-10-23.xlsx`.
- [ ] **Step 2: Run** `npm test -- research/export`. Expected: FAIL.
- [ ] **Step 3: Implement** and install the dependencies.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat: research export dictionary and file builders`

### Task 3: Export route + button + admin log

**Files:**
- Create: `src/app/(app)/patients/research/export/route.ts` (+ test)
- Modify: `src/app/(app)/patients/research/page.tsx` and its view: add an Export form (format radio: Excel / CSV zip) that carries the current filters, and the "Recent exports" section for admins (last 20 rows: when, who, format, filters, row counts)

**Interfaces:**
- Consumes: Task 1 RPCs and Task 2 builders.
- **Route** `GET /patients/research/export?format=xlsx|csv&<filters>`:
  - `requirePermission('research')`. Without Patients view → 403 with the refusal text.
  - Calls the eight readers with `rpcArgs(filters)` and runs `assertAllowlisted`.
  - Builds the file, then calls `log_research_export(format, filters, rowCounts)`.
  - Responds with `Content-Type` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/zip`), `Content-Disposition: attachment; filename="<exportFileName>"` and `Cache-Control: no-store`.
  - An invalid format → 400.
- The CSP needs no change: it's the same origin.

- [ ] **Step 1: Write the failing tests** (mock supabase like the other route tests):
  - xlsx gets the right headers and the log is called once with row counts;
  - csv gets a zip content type;
  - a bad format → 400;
  - no Patients view → 403 (Review Focus 5);
  - the Export form carries the current filters;
  - Recent exports shows only for admins.
- [ ] **Step 2: Run** `npm test -- research`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): research export download and export log`

### Task 4: E2E + docs

**Files:**
- Create: `tests/e2e/research-export.spec.ts`
- Modify: `CLAUDE.md`: a **Research export (0070)** bullet covering the allowlist/dictionary rule ("adding a column requires a dictionary entry; free text never"), study codes, the log, and the route.

- [ ] **Step 1: Write the spec.**
  - As an admin, seed two implants with a unique brand.
  - Open `/patients/research?brand=…`, choose Excel and click Export. Wait for the download (`page.waitForEvent('download')`).
  - Read the file with exceljs and check the `implants` sheet has 2 data rows, `P-` codes, and no patient name anywhere in the workbook.
  - Repeat with CSV and check the zip entries.
  - Check "Recent exports" lists 2 rows.
- [ ] **Step 2: Run** `npx playwright test research-export research`. Expected: PASS.
- [ ] **Step 3: Docs.**
- [ ] **Step 4: Verify** with `./scripts/ship.sh verify research-export research`. Expected: "Verified".
- [ ] **Step 5: Commit** `test(e2e): research export; docs`
