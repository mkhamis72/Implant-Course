# Research readiness, part 1: data captured before and at surgery

Date: 2026-10-17. First sub-project of the research-readiness roadmap below.

## Context and goals

The owner wants the app to support implant research later (retrospective studies, observational research, quality improvement), without a specific study in mind yet. The reference list of research questions is the owner's "Implant Research & Outcomes Analytics" brief: implant dimensions and design, placement and loading timing, grafting, primary stability, bone levels, survival versus success, operator and course effects. Analytics are worth building only once structured data has accumulated, so the work starts with **capturing better data from now on**.

Today's records have gaps that make research data unreliable:
- `medical_history` risk factors are booleans defaulting to `false`, so "not asked" is stored as "no".
- Grafting is a 200-character free-text field (`implant_sites.graft`).
- Placement timing (extraction date, immediate/early/delayed) and surgical details (flap, healing mode, closure) are not recorded.

Part 1 fixes the data that is lost if it isn't recorded on the day: patient risk factors and the surgical details of each placed implant.

**Success:** for every implant placed from now on, the organizer can record timing, site and surgical details and grafts in under a minute, during or after the session; each implant shows how complete its record is; risk factors distinguish yes, no and not assessed.

## Decisions

| Topic | Decision |
|---|---|
| Missing data | An empty value always means "not recorded / not assessed", never "no". |
| Entry timing | Placement stays quick and unchanged. Surgical details are a separate record, editable any time after placement (the owner's teams enter basics live and details often later). |
| Existing risk-factor data | `true` → yes (smoking → current); `false` → not assessed, because it can't be told apart from "never asked". |
| Release safety | New columns beside the old booleans; a trigger copies old-version boolean writes during the release window; a later PR drops the booleans (pattern of 0024 → 0025). |
| Placement function | `place_implant_v2` and `correct_placement` are unchanged; torque, ISQ, bone type and technique stay on `implant_sites`. |
| Old graft text | Kept in `implant_sites.graft` and shown read-only as "Graft (old note)"; no longer entered. |
| Timing definitions | ITI types 1–4. Only an immediate placement with a different extraction date is refused; other timing/days mismatches are warnings. |
| Out of scope (part 1) | Intraoperative complications (complications registry, part 2), repeated ISQ readings (part 2), ridge/CBCT measurements, graft materials from inventory, research exports. |

## Data

### Medical history (`medical_history`, new nullable columns)

| Column | Values | Backfill |
|---|---|---|
| `smoking` | `never` / `former` / `current` | `smoker` true → `current` |
| `cigarettes_per_day` | int 1–100, only when `smoking = 'current'` | — |
| `diabetes_status` | `yes` / `no` | `diabetes` true → `yes` |
| `hba1c` | numeric(3,1) 4.0–20.0 % | — |
| `hba1c_date` | date, not after `cairo_today()`; required with `hba1c` and vice versa | — |
| `bisphosphonates_status` | `yes` / `no` | true → `yes` |
| `anticoagulants_status` | `yes` / `no` | true → `yes` |
| `radiotherapy_status` | `yes` / `no` | `radiotherapy_head_neck` true → `yes` |
| `osteoporosis_status` | `yes` / `no` | true → `yes` |
| `periodontitis_history` | `yes` / `no` | — |
| `bruxism` | `yes` / `no` | — |
| `previous_implant_failure` | `yes` / `no` | — |

All are `check`-constrained text. Allergies, medications, other conditions and notes are unchanged.

**Release-window trigger** (`before insert or update` on `medical_history`): when the previous app version writes an old boolean (on insert: the value is `true`; on update: the value changed), set the matching new column (`true` → `yes`/`current`, changed to `false` → `no`/`never`). The new app writes only the new columns. The follow-up PR drops the trigger and the boolean columns.

Saving stays a direct update through column-level grants with the `updated_at` concurrency check; the new columns are added to the update grant.

### Surgical details (`implant_surgery`, one row per implant site)

`site_id uuid primary key references implant_sites (id) on delete cascade`, plus `created_at`, `created_by`, `updated_at` (`set_updated_at` trigger).

| Column | Values |
|---|---|
| `extraction_date` | date, not after the site's `placed_on` |
| `placement_timing` | `immediate` (at extraction) / `early_soft_tissue` (~4–8 weeks) / `early_partial_bone` (~12–16 weeks) / `delayed` (healed ridge) |
| `soft_tissue_phenotype` | `thin` / `thick` |
| `keratinized_mucosa_mm` | numeric(3,1) 0–15 |
| `flap` | `flapless` / `crestal` / `crestal_releasing` / `papilla_sparing` / `other` |
| `torque_type` | `peak` / `final` (the value stays in `implant_sites.torque_ncm`) |
| `healing` | `submerged` (cover screw) / `transmucosal` (healing abutment) / `immediate_provisional` |
| `primary_closure` | `yes` / `no` |
| `grafting_performed` | `yes` / `no` |

Days from extraction to placement are derived (`placed_on − extraction_date`), never stored.

### Grafts (`implant_grafts`, zero or more per implant site)

`id uuid primary key`, `site_id → implant_sites (id) on delete cascade`, `created_at`, `created_by`, `updated_at`.

| Column | Values |
|---|---|
| `procedure` | `socket_preservation` / `gbr` / `horizontal_augmentation` / `vertical_augmentation` / `sinus_crestal` / `sinus_lateral` / `ridge_split` / `other` (not null) |
| `timing` | `simultaneous` / `staged` (not null) |
| `performed_on` | date; required and before `placed_on` when staged; null when simultaneous (the placement date applies) |
| `material` | `autogenous` / `allograft` / `xenograft` / `alloplast` / `combination` / `none` (nullable = not recorded) |
| `product` | text ≤ 120, e.g. "Bio-Oss 0.5 g" |
| `membrane` | `none` / `resorbable` / `non_resorbable` (nullable = not recorded) |
| `notes` | text ≤ 500 |

## Database functions and rules

All three tables follow the house conventions: `security definer set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, business errors via `app_private.fail(...)`, `revoke … from public, anon` / `grant … to authenticated`.

- **`save_implant_surgery(p_site uuid, …the nine fields…, p_expected_updated_at timestamptz)`** creates or updates the row. It refuses:
  - a site that is `planned` or `removed` (placed, restored and failed are accepted);
  - an extraction date after `placed_on`;
  - `placement_timing = 'immediate'` with an extraction date that isn't `placed_on`;
  - `grafting_performed = 'no'` while the site has grafts;
  - a stale `p_expected_updated_at` on an existing row (the existing "changed by someone else" message). On create it must be null.
- **`add_implant_graft`**, **`update_implant_graft`**, **`delete_implant_graft`**: same site-state rule; staged grafts need `performed_on` before `placed_on`; simultaneous grafts store no date. Adding a graft when `grafting_performed = 'no'` is refused.
- **Correcting the placement date** (`correct_placement`) is not blocked by these rules; inconsistencies it creates are left to the data-quality checks of part 5.

**Reads:** RLS select on both tables for `public.is_active_user()`, plus the restrictive `(select public.can('patients', 'view'))` area policy. No table write grants (writes go only through the functions). Delegates read nothing.

**Audit and history:** `audit_row('site_id')` on `implant_surgery`, `audit_row('id')` on `implant_grafts`. New migration redefines (latest definitions):
- `patient_history` (latest in 0020): adds both tables to the site-keyed branch (`site_id` in the patient's sites);
- `audit_log_area_read` (latest in 0036): adds both table names to the Patients-view list.

No seeded rows, so the restore `TRUNCATE` list in `docs/operations.md` §D is unchanged.

## Screens

**Medical history (patient Overview tab, `overview/medical-history-form.tsx`)**
- Each risk factor is a row of radios: Yes / No / Not assessed (pre-selected when empty). Smoking: Never / Former / Current / Not assessed. Rows stack on phones.
- "Cigarettes per day" shows when Current is chosen; HbA1c has a value and a date input.
- A line above Save reads "N of 9 not assessed" (the nine risk-factor questions: smoking, diabetes, bisphosphonates, anticoagulants, radiotherapy, osteoporosis, periodontitis history, bruxism, previous implant failure).
- Radios are remounted with a `key` per result (React 19 form reset; see `schedule/_talks/talk-form.tsx`).
- `medicalAlerts` reads the new columns: alerts only for `yes`, and "Smoker" for `current`.

**Implant details (chart tooth panel, `implant-section.tsx` → `SiteDetails`)**
- New collapsible **Surgical details** block under the facts box. Heading: "Surgical details · N of 9 recorded", `badge-warn` until complete, `badge-ok` when complete.
- Closed view lists the recorded values in words (e.g. "Immediate · 0 days after extraction · Thick phenotype · Flapless · Peak torque · Submerged · Primary closure").
- Editors (`data.editable`) get **Edit**, opening the form in place. The form shows the timing definitions beside the options and a non-blocking warning when the days since extraction don't fit the chosen category.
- **Grafts** list in the same block ("GBR · Xenograft · Resorbable membrane · Simultaneous") with **Add graft**, **Edit**, **Delete**. When grafting performed is yes and there are no grafts, the block shows a warning.
- After **Place implant** succeeds, the block opens with "Add surgical details now or later."
- An old free-text graft shows as "Graft (old note): …".

**Patient Implants tab (`implants/page.tsx`):** new **Details** column with "N/9" (`—` for sites that aren't placed).

**Place and Corrections forms:** the Graft text box is removed. Corrections passes the site's existing `graft` value through unchanged to `correct_placement`.

Pure rules live in `src/lib/implants/surgery.ts` (Zod schemas, labels, days since extraction, timing warning, completeness count) and `src/lib/patients/` (tri-state medical-history schema and alerts). Server actions call `requirePermission('patients', 'edit')` and `userMessage(error)`.

## Testing

Tests first (TDD). Each migration is dry-run in a rolled-back transaction before the first `test:db`.

**DB tests (`tests/db/`):**
- Medical history: backfill mapping; release-window trigger; checks (cigarettes only when current, HbA1c value and date together, no future HbA1c date); viewer can't update the new columns.
- `save_implant_surgery`: create then update; refusals (planned/removed site, extraction after placement, immediate with a different extraction date, grafting "no" with grafts, stale `expected_updated_at`); failed site accepted.
- Grafts: add/update/delete; staged date rule; simultaneous stores no date; adding refused when grafting is "no"; site and patient deletion cascade.
- Permissions: refused without Edit on Patients; nothing readable without View on Patients or for delegates; `permissions.test.ts` green.
- History: surgery and graft changes appear in `patient_history` and pass `audit_log_area_read`.

**Unit and component tests (Vitest):**
- `surgery.ts`: schemas, days since extraction, timing warning boundaries, completeness count, labels.
- Tri-state medical-history schema; `medicalAlerts`; History-tab labels for the new columns.
- Components: medical-history radios keep their values after save; Surgical details read view, badge, timing warning, grafting warning; graft list; Place and Corrections without the Graft box.

**E2E (Playwright, `chromium`):** place an implant → fill Surgical details → add a graft → Implants tab shows "9/9" → History tab shows the change. Medical-history tri-state save and reload in the existing patient spec. `mobile.spec.ts`: radio rows stack at 360px.

**Release:** `./scripts/ship.sh verify` with the new and affected specs. A follow-up PR, after this one deploys, drops the old booleans and the sync trigger.

## Research-readiness roadmap

Each sub-project gets its own spec, plan and implementation.

1. **Data captured before and at surgery** (this spec).
2. **Follow-up visits and complications registry:** configurable visit schedule, attended vs missed, clinical findings (probing, bleeding, suppuration, mobility, pain), repeated ISQ readings with stage, structured complications (surgical, biological, mechanical) with dates, severity, treatment and resolution.
3. **Loading and prosthetics:** loading dates and protocol (immediate/early/conventional, independent of placement timing), provisional and definitive restorations, retention, abutment and material, prosthetic complications kept separate from implant outcomes.
4. **Radiographs and marginal bone levels:** mesial and distal measurements against a defined reference point and baseline, examiner, calibration, comparability flag, consistent sign convention.
5. **Outcome definitions and data quality:** versioned definitions of implant survival, success, failure and censoring; prosthesis survival and success; automated checks (impossible dates, implausible values, missing follow-up treated as unknown, planned vs actual).
6. **Research area:** de-identified dataset builder and exports (CSV/Excel) with a data dictionary, inclusion criteria and completeness; descriptive dashboards with denominators and uncertainty. A simple export of existing data could move earlier if useful.
7. **Statistics:** most analysis (regression, Cox, mixed effects) done in R/SPSS/Stata on the exported dataset; in-app only descriptive statistics and Kaplan–Meier when data allow.
8. **Governance:** study and ethics-approval references, consent status, protocol version, export access log; Egyptian data-protection requirements.
