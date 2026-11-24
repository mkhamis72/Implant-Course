# Implant Passport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generate, store and download a per-patient Implant Passport PDF built on the server from the existing records, with a clinic setting for its medical content.

**Architecture:** `@react-pdf/renderer` 4.9.0 (installed, commit ba5826c; sub-parts `@react-pdf/textkit` 7.0.1 and `@react-pdf/layout` 5.2.0 pinned by `overrides` because today's releases need a part missing from npm) renders a React PDF document in Node route handlers. Data is read with the signed-in user's Supabase client (RLS), turned into a pure printable model, rendered, and saved as bytes through a definer into a closed table; downloads are served from those bytes and logged. Fonts are bundled: `web/src/lib/passport/fonts/NotoSans.ttf` (Latin) and `NotoNaskhArabic.ttf` (Arabic), OFL licence beside them.

**Tech Stack:** Next.js 15 route handlers (Node runtime), React 19, @react-pdf/renderer, Supabase Postgres (plpgsql, RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-implant-passport-design.md` (incl. "Owner answers" and "Settled calls").

## Global Constraints
- Owner decisions: fixed stored PDFs; English labels now (all labels in one module `src/lib/passport/labels.ts` so Arabic can be added later); server-built with @react-pdf/renderer; Arabic text in the record must print correctly (Noto Naskh Arabic); medical content per clinic setting `allergies_medications` (default) / `full` / `none`.
- Exact copy: page title "Implant Passport"; passport number `<file_no>-<version>`; "Not recorded"; "None recorded"; "Schematic drawing — not a substitute for CBCT or 3D planning."; footer "This passport summarises the clinic's records on the date shown. It is not a manufacturer warranty or guarantee. Values not recorded are shown as 'Not recorded'."; stale note "Records changed since this version"; size error "The passport is too large to store."; settings labels "Allergies and medications only" / "Full medical summary" / "Nothing medical"; download filename `Implant passport <file_no>-<version>.pdf`.
- Contact details (phone, email, address) are never printed. Lot numbers only when the company plan has Inventory (`module_on('inventory')` / `Profile.features`). Placed by = doctor name, else delegate name, else "Not recorded"; no supervisors.
- Permissions: generate = Edit on Patients; list + download = View on Patients; passport settings = admin. Pages/handlers guard themselves (`requirePermission`, `requireAdmin`).
- Migration `0145_implant_passport.sql` only; company pattern of `public.doctors` (0114); definers `security definer set search_path = ''`, first line `require_perm('patients', …)` (settings: admin check as other admin definers), owner as recent definers, no defaulted params; closed file table like 0072 consent files; never edit applied migrations; dry-run before first `test:db`.
- Stored PDF ≤ 5 MB and starts with `%PDF-`. No external network at render time (fonts and logo from the app/database). CSP unchanged.
- Dates in Cairo (`formatDate`, `cairo_today()`); "Not recorded" for recorded-but-empty values; fields the app does not record are omitted.

## Review Focus
1. Arabic patient name and Arabic free text render joined and right-to-left inside English lines. → Task 1 spike evidence (rendered page image) + Task 4 test.
2. A large patient (16 implants, each with 4–6 components incl. replaced ones, 2 full-arch cases) renders within Vercel Hobby limits (time < 10 s locally on a cold route, memory reasonable, size < 1.5 MB). → Task 1 measurement, re-checked in Task 4.
3. Company isolation and permissions on generate, list, download and settings. → Task 2 DB tests + Task 5 E2E with a View-only user.
4. A patient with nothing recorded (no implants) still produces a valid one-page passport with "None recorded" sections. → Task 3/4 tests.
5. Lot numbers absent when Inventory is off; medical section follows the setting at generation time and the stored copy keeps it. → Task 3 tests.

---

### Task 1: Spike — react-pdf on our stack with Arabic and a large passport

**Files:** Create `web/src/lib/passport/fonts.ts` (`registerPassportFonts(): void`, idempotent; registers family "Passport" from NotoSans.ttf and "PassportArabic" from NotoNaskhArabic.ttf with absolute paths resolved at runtime, and configures fallback so Arabic runs use the Arabic font), `web/src/lib/passport/spike.tsx` (temporary document), `web/scripts/passport-spike.ts` (renders to `renderToBuffer`, prints ms, heap MB, bytes; writes the PDF to a path given on the command line). Ensure `next.config.ts` keeps @react-pdf/renderer server-only and the font files are included in the server bundle (Next `outputFileTracingIncludes` for the passport route if needed).

- [ ] Render a synthetic document: 3 pages of tables (16 implant rows, 80 component rows), a header with a PNG logo, an SVG chart (lines and rects), and lines mixing English and Arabic: "Patient: محمد أحمد علي", "Lab: معمل النور".
- [ ] Convert page 1 to PNG (Edge headless can print the PDF? — use `pdftoppm` if present, else open the PDF in Edge headless and screenshot) and Read the image: Arabic letters joined and right-to-left; Latin normal.
- [ ] Run `next build` and check the route bundle includes the fonts; time a cold `renderToBuffer` in the built server (local `next start`, a temporary route `GET /patients/passport-spike` guarded by `requireAdmin`), record ms / bytes.
- [ ] Report to the controller: numbers, the image, any font issue (e.g. variable fonts not supported → convert to a static instance or fetch the static TTF from google/fonts `notosans/static`). **Stop here; the controller decides.** Do not build further features. Commit only `fonts.ts` + font changes + the script; delete the temporary route and `spike.tsx` before committing, or keep them uncommitted.

### Task 2: Database (0145)

**Files:** `web/supabase/migrations/0145_implant_passport.sql`, `web/tests/db/implant-passport.test.ts`, update `tests/db/permissions.test.ts` / `one-db-guards` / `tenant-isolation` only as their rules require.

Produces: `public.patient_passports(id, company_id, patient_id, version, generated_at, generated_by, size_bytes, sha256, medical_level)`; closed `public.patient_passport_files(passport_id, company_id, bytes)`; `public.passport_downloads(id, company_id, passport_id, downloaded_at, downloaded_by)`; `public.passport_settings(company_id pk, medical text check in ('allergies_medications','full','none'), updated_at)`; functions `save_patient_passport(p_patient uuid, p_file bytea, p_medical_level text) returns uuid`, `patient_passport_file(p_passport uuid) returns bytea` (logs a download), `set_passport_settings(p_medical text)` (admin), reader `passport_settings_current() returns text` (default when no row); `patient_history` adds "Implant passport generated (version N)"; all cascade with `delete_patient`.

- [ ] Failing tests: versions 1, 2 per patient (concurrent saves get distinct versions); bytes not starting `%PDF-` refused; > 5 MB refused with the exact message; file table unreadable directly by `authenticated`; download returns the same bytes and logs who; View-only user can download but not save; delegate login sees nothing; company B cannot read or download company A's passport; settings admin-only, default `allergies_medications`; `delete_patient` removes passports, files and downloads; history row present.
- [ ] Migration, dry-run, `npm run test:db` (full) green. Commit "Implant passport: storage, versions, downloads and settings (0145)".

### Task 3: Data and printable model

**Files:** `web/src/lib/passport/labels.ts`, `web/src/lib/passport/model.ts` (+ test), `web/src/lib/passport/load.ts` (server-only loader).

Produces: `loadPassportData(patientId: string): Promise<PassportData>` (patient, medical_history, sites with product/planned product/doctor/delegate/surgery/grafts/components with products, restorations with sites, full-arch cases with stages, branding name + logo bytes, company plan features, `medical_level` from `passport_settings_current()`); pure `passportModel(data: PassportData, generatedAt: string, version: number): PassportModel` — sections: header, patient, medical (per level), overview (counts + `fullArchModel` input), implants table rows (arch order), implant details, components by role + replaced history with torque/driver fields, restorations, full-arch cases, footer. Every empty recorded value → "Not recorded"; lot only when Inventory on.

- [ ] Failing unit tests for each section incl. Review Focus 4 and 5, planned-vs-placed line, Arabic strings passed through unchanged, ordering.
- [ ] Implement; `npm test -- passport`; tsc; lint. Commit "Implant passport: data and printable model".

### Task 4: The PDF document

**Files:** `web/src/lib/passport/document.tsx` (`PassportDocument({ model })`), `web/src/lib/passport/render.ts` (`renderPassport(model): Promise<Buffer>`), `web/src/lib/passport/chart.tsx` (react-pdf `Svg` chart from C1's `fullArchModel`/`implantLine`), tests.

- [ ] Failing tests: `renderPassport` returns bytes starting `%PDF-`; page count grows with implants; the large fixture renders < 1.5 MB and within the Task 1 time budget; a helper that renders the document tree (not the PDF) finds the exact copy strings, the passport number, "Not recorded", and the medical section per level.
- [ ] Implement A4 layout: header (logo, clinic name, title, passport number, date) and footer (note, page X of Y) on every page; tables wrap across pages without splitting rows; chart on the overview page.
- [ ] Render the large fixture and an empty patient to PDFs, convert page 1 to an image, Read it, fix what reads badly. Commit "Implant passport: PDF document".

### Task 5: Pages, handlers, settings, E2E, docs

**Files:** `web/src/app/(app)/patients/[id]/passport/page.tsx` (+ test), `…/passport/generate/route.ts` (POST), `…/passport/[passportId]/download/route.ts` (GET), patient tabs/header link "Implant passport", `web/src/app/(app)/admin/settings/` passport section (+ action + test), `web/tests/e2e/implant-passport.spec.ts`, docs (patients CLAUDE.md "Implant passport (0145)" paragraph; root CLAUDE.md one line; admin CLAUDE.md settings line).

- [ ] Page lists versions (number, date, generated by, size, "Downloaded N times, last by X on D"), stale note on the latest when any patient audit row is newer than it, Generate (Edit only; disabled while pending), Download links. Handlers: `runtime = 'nodejs'`, guard, load → model → render → `save_patient_passport` → redirect; download sets `Content-Type: application/pdf`, attachment filename, `Cache-Control: no-store`.
- [ ] Admin settings: radio group with the three labels, saved via `set_passport_settings`.
- [ ] E2E: organizer generates → version 1 listed → download response is `application/pdf` starting `%PDF-` → generate again → version 2; viewer (View on Patients) sees Download but no Generate; admin changes the setting to "Nothing medical" → next version's model has no medical section (assert via the page's version row label or a test-only check, builder's choice).
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`, `npx playwright test implant-passport --project=chromium`, `npm run build` (bundle includes fonts). Commit "Implant passport: pages, settings, E2E and docs".
