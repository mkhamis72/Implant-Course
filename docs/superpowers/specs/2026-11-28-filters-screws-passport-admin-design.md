# Exclude filters, screw sizes, passport screws, admin on phones, passport in the browser — design

Date: 2026-11-28 · Five small changes requested together after project E (statistics) shipped. Status: approved by the owner (plan review, 2026-11-28).

## Why
1. **Exclude filters:** the owner wants to find patients who do *not* match a filter (for example not yet restored, or not from a given course).
2. **Screw sizes:** when fitting an abutment or prosthetic screw, the owner wants to pick its size and see which screwdriver (and torque) goes with it.
3. **Passport screws:** a screw's passport entry prints gingival height, angle and material, which mean nothing for a screw.
4. **Admin on phones:** admin pages look distorted on a phone.
5. **Passport in the browser:** stored passport PDFs take space; the owner wants the passport made and downloaded only when needed, with nothing stored.

## Goals
- **A. Exclude filters.** On the Patients list each filter gets an **is / is not** choice: Stage menu, Scan menu, Course, Supervisor. URL: `stage_not=1`, `course_not=1`, `supervisor_not=1`. Text search and "Include archived" are unchanged.
  - *Stage/Scan is not {ticked}*: the patient matches none of the ticked options.
  - *Course is not X*: the patient has no implant and no live booking in course X; patients with no course at all are included. *Supervisor is not X*: same rule.
  - The Teeth column highlights teeth only for "is" stage filters.
  - Paging (50 per page), the total and page links keep every filter, including the new ones.
- **B. Screw sizes.** A size list per implant system, kept by the admin (**Admin → Screw sizes**): brand, system, kind (abutment screw / prosthetic screw), size label (e.g. "M1.6 × 7 mm"), screwdriver (interface, size, ref), recommended torque, active.
  - In the Component form, for an abutment, prosthetic or temporary cylinder screw, a **Size** select lists the active sizes of that kind for the site's implant brand + system (all sizes of that kind when the implant has no product). Choosing one shows "Screwdriver … · Recommended torque … Ncm".
  - The size is optional (the list may be empty) and is recorded on the fitting; the chart's component line shows it.
- **C. Passport screws.** Abutment and prosthetic screws (including a full-arch case's prosthetic screws) print only: Product, Ref code, **Size**, Screwdriver, Recommended torque, Actual torque, Fitted on, and Lot (with Inventory). Screwdriver and recommended torque come from the product; when the product has none (or there is no product), from the chosen size. Other parts print as today.
- **D. Admin on phones (360 px).** Every admin page (Users, Settings incl. consent, Chairs, Doctors, Catalogue, Supervisors, Lecturers, Screw sizes) fits a 360 px screen: no sideways scrolling of the page or of any card, and nothing squeezed unreadable.
- **E. Passport in the browser.** The PDF is built in the user's browser from data the server prepares, then downloaded at once. Nothing is stored except a small log row.
  - Anyone with **Patients View** may generate (today: Edit).
  - The Implant passport tab shows the Generate button and a list of past generations (who, when, medical detail level), with "records changed since" on that list.

## Non-goals
- No change to which patients the existing "is" filters return, or to the text search.
- No size field on screw products and no screw rows in the catalogue library (the owner chose a per-system list).
- No change to passport content other than the screw fields; no preview of the PDF in the page.
- No redesign of admin pages beyond making them fit phones.

## Anti-goals
- Breaking the previous app version during the release window (it still calls the old search functions, `fit_component_v3` and the stored-passport routes).
- Sending the browser any patient data the server's passport rules would not print (medical whitelist and RLS stay on the server).
- Widening the site's security policy beyond what the browser PDF needs.

## Approaches
Owner's picks in **bold**.
- Screw size source: size field on screw products / **size list per system kept by the admin** / free-text size only.
- Exclude style: **is / is not per filter** / three-state per checklist option.
- After the passport move: **small "generated" log** / nothing but the button.
- Who generates: **Patients View** / Patients Edit as today.
- Passport rendering: server builds the passport *model* (as today) and returns it as JSON; the browser only draws it with the existing `document.tsx` / `chart.tsx` (my call: keeps all data rules on the server, reuses the tested document). Rejected: browser reads the tables itself (would duplicate the medical whitelist in the client).

## Decisions
- **Releases (my call):** one feature PR with migration 0147, additive only. A later clean-up PR (0148) drops what the previous version needed: `patient_passport_files`, `patient_passports`, `passport_downloads` (this deletes the stored PDFs), `save_patient_passport`, `patient_passport_file`, the 0124 search functions and `fit_component_v3`; `patient_history` stops listing `patient_passports` and lists `passport_generations`.
- **SQL (my call):** `patient_list_matches_v2` / `search_patients_v3` / `search_patients_count_v2` (0124 bodies plus three boolean params); `screw_sizes` with `save_screw_size` / `set_screw_size_active` (admin; a used size can only be switched off); `implant_components.screw_size_id` (nullable FK) set through `fit_component_v4(…, p_screw_size)`, which refuses a size of another kind or company or on a non-screw part; `passport_generations` (patient, generated_by, generated_at, medical_level) written by `log_passport_generation` (require Patients View). Usual conventions: definer functions with `require_perm`, invoker readers, explicit revoke/grant, company policies, audit trigger on `screw_sizes` and `passport_generations`.
- **Who reads screw sizes (my call):** staff with Patients View (the form) or admins (the page). It is company data, not part of the shared catalogue library.
- **Passport data route (my call):** `GET /patients/[id]/passport/data`, same-origin check, Patients View; returns the passport model (logo as a data URL) with `no-store`, and logs the generation. The log means "passport data handed out"; a failed download in the browser still leaves the row.
- **Browser rendering (my call):** the button loads `@react-pdf/renderer` and the document only on click (`import()`), registers the fonts from `public/passport-fonts/`, builds a Blob and downloads `Implant passport <file no> <date>.pdf`; "Preparing…" while working, a plain error message on failure. The server-side generate and download routes, `render.ts` and the passport entry in `next.config.ts` `outputFileTracingIncludes` go.
- **Security policy (my call, checked by a spike first):** if react-pdf needs WebAssembly in the browser, add `'wasm-unsafe-eval'` to `script-src` (allows the page's own WebAssembly only, no remote code). Downloads work with `<a download>` on a `blob:` URL under the current policy.

## Constraints
- Migrations 0147+ only; backward-compatible; don't add overloads with defaulted parameters (new `_vN` names instead).
- `tests/db/permissions.test.ts` and `tests/db/module-guards.test.ts` stay green; new tables in the tenant isolation tests.
- Data tables keep `className="table"` with `data-label`; design tokens only.
- Dates in Cairo (`todayIso`, `formatDate`).
- E2E data with `uniqueName()`.

## Left to the builder
Exact placement of the is / is not selects; the Admin → Screw sizes page layout (following Chairs/Doctors); how the size shows on the chart line; the client loader's file layout; the exact admin phone fixes (likely suspects: `admin/users/user-row.tsx` role form and long emails, cell padding, button pairs in `edit-name` / `change-email` / `reset-google` / `reset-two-factor`, `permission-grid` legend, `catalogue-form` rows, `branding-form` preview row).

## Verification
Unit tests (filter parsing, `pageHref` with `*_not`, screw `partFields`, size choice in the Component form, the passport button with a mocked loader, admin forms); DB tests (exclude semantics including patients with no course, old functions still working, `screw_sizes` RLS and company isolation, `fit_component_v4` checks, `passport_generations` with View permission and cross-company); E2E (an "is not" filter, fitting a screw with a size, passport downloaded by a View user starting with `%PDF-` and logged, admin pages at 360 px in `mobile.spec.ts`); a manual check at 360 px; full suites and build; owner ships with `! cd "D:/Claude/Claude Code/implant-course-self-auth/web" && ./scripts/ship.sh ship` (repo public first, private after).
