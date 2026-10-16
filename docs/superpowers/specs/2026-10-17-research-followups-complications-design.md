# Research readiness, part 2: follow-up visits, complications and failure

Date: 2026-10-17. Second sub-project of the research-readiness roadmap (part 1: `2026-10-17-research-capture-surgery-design.md`, which holds the full roadmap). Builds on part 1; implementation starts after part 1 is merged.

## Context and goals

Course patients are recalled by the course team on a regular schedule. Today a follow-up is a date, a free-text check name, an outcome (ok / integrated / failed / complication) and notes. The app doesn't know which visits are expected, so it can't tell a missed visit from one not yet due; there are no clinical findings; complications are one outcome word; a failure has no date, type or reason beyond the follow-up that recorded it.

Part 2 makes follow-up research-grade:
- **2a, visits:** a fixed visit schedule per implant, visit status (upcoming / due / overdue / missed / done / did not attend / not needed), structured findings with four-site probing, ISQ at each stage, a recall list and a dashboard tile.
- **2b, complications and failure:** a complications registry (events at any time, editable as they evolve) and structured implant failure.

**Success:** for every implant the team sees which visit is next and which were missed; a visit records attendance and findings in about a minute; the recall list tells the team whom to call; complications and failures carry dates, types, severity and resolution, so survival, complication incidence and time-to-event can be analysed later.

**Delivery:** one spec, two plans and PRs — 2a first, then 2b. Each is useful on its own.

## Decisions

| Topic | Decision |
|---|---|
| Missing data | Empty means not assessed / not recorded, never "no". A missed visit (window passed, nothing recorded) is distinct from "did not attend" (recorded) and from a negative finding. |
| Schedule | Fixed in SQL (`app_private.visit_schedule()`), counted from the placement date. Not editable in the app for now. |
| Status | Calculated, never stored, in the database; the UI only renders it. |
| Visit storage | Extend `implant_followups`; existing rows become unscheduled visits. |
| Probing | Four sites (mesial, buccal, distal, lingual/palatal) with bleeding per site. |
| Visit records | Not editable (as today); mistakes are voided with a reason and re-entered. |
| Complications | Own events at any time, optionally linked to the visit where found; editable (treatment, resolution); voided, never deleted. |
| Peri-implantitis / mucositis | Recorded by the clinician; the form shows the 2017 World Workshop case definitions as guidance. No automatic diagnosis. |
| Failure | Columns on `implant_sites`; early vs late derived, not entered. Old failures are not back-filled. Recorded details are editable (`correct_failure`), audited. |
| Release safety | Additive migrations; `record_followup` stays for the release window and is dropped in a later PR. |
| Out of scope | Booking recall visits into the Schedule, editable schedules, loading-relative visits (part 3), bone-level measurements (part 4), automatic case definitions and data-quality checks (part 5). |

## 2a — Visits

### Schedule

| Key | Label | Target (days after placement) | Window (days) |
|---|---|---|---|
| `early_review` | Early review (suture removal) | 10 | 7–21 |
| `osseointegration` | Osseointegration check | 90 | 70–112 |
| `month_6` | 6-month review | 182 | 152–212 |
| `month_12` | 12-month review | 365 | 305–425 |
| `year_N` (N ≥ 2) | Year-N review | 365 × N | 365 × N ± 60 |

Annual visits are generated up to the one whose window contains today (plus the next upcoming one).

### Data (`implant_followups`, new nullable columns)

| Column | Values |
|---|---|
| `visit_key` | a schedule key (`early_review`, `osseointegration`, `month_6`, `month_12`, `year_N`); null = unscheduled (all existing rows) |
| `attendance` | `attended` / `did_not_attend` / `not_needed` |
| `pain_score` | int 0–10 |
| `patient_concerns` | text ≤ 1000 |
| `swelling`, `suppuration`, `plaque`, `mobility` | `yes` / `no` |
| `probing_mesial`, `probing_buccal`, `probing_distal`, `probing_lingual` | numeric(3,1) 0–15 mm |
| `bop_mesial`, `bop_buccal`, `bop_distal`, `bop_lingual` | `yes` / `no` |
| `isq` | numeric(4,1) 0–100 |
| `prosthesis_status` | `stable` / `loose` / `not_restored` |
| `radiograph_taken` | `yes` / `no` |
| `recommended_treatment` | text ≤ 1000 |

- `outcome` becomes nullable (required by the function when attended). The previous app version may briefly show a blank outcome for a not-attended row during a release.
- `check_type` stays required: for scheduled visits the function fills it with the schedule label, so the old screens and the course report CSV keep working.
- Unique index on `(site_id, visit_key)` where `voided_at is null and visit_key is not null`.

### Functions

- **`record_visit(p_site uuid, p_date date, p_visit_key text, p_check_type text, p_attendance text, p_outcome public.followup_outcome, p_findings jsonb, p_notes text) returns uuid`** — `security definer`, `require_perm('patients','edit')`. Findings travel as one JSON object (keys = the column names above) and are validated field by field, so adding a finding later doesn't change the signature. Refuses: a site not placed/restored/failed; a date before placement or after `cairo_today()`; an unknown visit key; a scheduled visit already recorded (live); `not_needed` without a reason in notes; a missing outcome when attended; any finding when not attended; out-of-range or unknown values; an unscheduled visit without a check name. A `failed` outcome marks the implant and tooth failed as `record_followup` does (2b adds the failure details).
- **`app_private.visit_schedule()`** — the schedule table above (key, label, target, window start, window end), generating `year_N` rows.
- **`public.implant_visits(p_patient uuid)`** — `security invoker`. For every implant of the patient, each expected visit with target date, window, status and the live record (if any), plus the unscheduled visits. Implants failed or removed expect no visits after the failure date. Status: `upcoming` (before the window), `due` (window open, target not passed), `overdue` (window open, target passed), `missed` (window closed, nothing recorded), `done` / `did_not_attend` / `not_needed` (from the record).
- **`public.recall_list()`** — `security invoker`, built on the same calculation across non-archived patients: visits `due`, `overdue`, or `missed` with a window that closed in the last 60 days; patient, phone, tooth, visit, target date, window end, status; sorted by target date.
- Reads need View on Patients (the recall list shows phone numbers); delegates read nothing.

### Screens

- **Implant on the chart:** the Follow-ups list becomes a **Visits** timeline — each expected visit with label, target date and status badge (upcoming muted, due accent, overdue warn, missed bad, done ok, did not attend warn, not needed muted); unscheduled visits (incl. old follow-ups) in date order with a short findings summary. **Add follow-up** becomes **Record visit**.
- **Record visit form:** visit select (pre-picks the earliest due/overdue/missed; "Unscheduled" with a free-text name), date, attendance radios. When attended: outcome, pain 0–10, swelling / suppuration / plaque / mobility (yes / no / blank), a probing grid (columns M / B / D / L: mm input plus a bleeding tick), ISQ, prosthesis status, radiograph taken, recommended treatment, notes. When not attended / not needed: only notes (the reason). The grid fits at 360px.
- **Implants tab:** a **Next visit** column ("6-month review · 12 Apr 2027 · Due").
- **Recall list:** new page under Patients ("Recall"), View on Patients; filter chips Overdue / Due / Missed (60 days), all on by default; rows link to the patient's chart.
- **Dashboard:** a tile "Recall: N overdue · M due" linking to the recall list.

### Testing

- **DB:** `record_visit` attended with findings, did not attend, not needed with reason; every refusal; re-recording after voiding; failed outcome still fails implant and tooth. `implant_visits` statuses at exact window boundaries, annual generation, nothing after failure/removal, old follow-ups as unscheduled. `recall_list` inclusion/exclusion (done, not needed, failed implants, archived patients, 60-day limit). Permissions (Edit to record, View to read, Schedule-only and delegates read nothing). `record_followup` still works.
- **Unit/component:** findings schema (blank = not assessed, ranges, findings only when attended), status labels/badges, visit pre-pick, fields hidden when not attended, probing grid, recall filters.
- **E2E:** record the early review with probing and bleeding on a fresh implant → Done badge, Next visit on the Implants tab; an implant placed 4 months ago (seeded) shows the early review Missed and appears on the recall list and dashboard tile; phone width: the probing grid fits at 360px.

## 2b — Complications and failure

### Complications (`implant_complications`)

`id`, `site_id → implant_sites on delete cascade`, plus:

| Column | Values |
|---|---|
| `category` | `surgical` / `biological` / `mechanical` (not null) |
| `type` | surgical: `intraoperative_injury`, `haemorrhage`, `nerve_symptoms`, `sinus_complication`, `wound_dehiscence`, `infection`, `graft_exposure_loss`, `early_osseointegration_loss`, `other` · biological: `mucositis`, `peri_implantitis`, `progressive_bone_loss`, `suppuration`, `persistent_pain`, `soft_tissue_recession`, `other` · mechanical: `implant_fracture`, `abutment_fracture`, `screw_loosening`, `screw_fracture`, `restoration_fracture`, `loss_of_retention`, `prosthetic_remake`, `other` (not null; must belong to the category) |
| `other_type` | text ≤ 120, required when type is `other` |
| `noticed_on` | date, from the placement date to `cairo_today()` (not null) |
| `severity` | `mild` / `moderate` / `severe` |
| `treatment` | text ≤ 1000 |
| `resolved_on` | date ≥ `noticed_on`, ≤ today; null = open |
| `followup_id` | optional → `implant_followups` (a visit of the same site) |
| `notes` | text ≤ 1000 |
| `voided_at`, `voided_reason` | as on follow-ups |

Plus `created_at`, `created_by`, `updated_at`; audited; RLS select for active staff with the restrictive Patients-view policy; no table write grants.

**Functions** (`security definer`, `require_perm('patients','edit')`): `record_complication(p_site, p_details jsonb) returns uuid`; `update_complication(p_complication, p_details jsonb, p_expected_updated_at)` (stale saves refused with "changed by someone else"); `void_complication(p_complication, p_reason)`. Same site-state rule as visits (placed, restored or failed).

### Failure (`implant_sites`, new nullable columns)

| Column | Values |
|---|---|
| `failed_on` | date, from placement to today |
| `failure_type` | `lost` / `removed` / `failed_in_place` |
| `failure_reason` | `no_osseointegration` / `peri_implantitis` / `fracture` / `malposition` / `other` |
| `failure_notes` | text ≤ 1000 |

- **`record_failure(p_site, p_failed_on, p_type, p_reason, p_notes)`** — sets the columns, marks the implant `failed` and the tooth failed, and ends expected visits from that date. Refuses a date before placement or in the future, and refuses a site whose failure details are already recorded (use `correct_failure`). Allowed on an implant already `failed` without details.
- **`correct_failure(p_site, p_failed_on, p_type, p_reason, p_notes, p_expected_updated_at)`** — edits recorded failure details (same validation), optimistic on `implant_sites.updated_at` (a stale edit is refused with "changed by someone else"). Refuses a site with no failure details recorded. The implant stays failed; the audit trigger records the change, and History shows "Failure details corrected: <fields>". Moving `failed_on` re-derives early/late and the end of expected visits.
- **`record_visit`** with outcome `failed` requires the failure fields in `p_findings` (`failed_on` defaults to the visit date) and calls `record_failure` in the same transaction.
- **Early vs late** (derived in TS and SQL readers): early when `failed_on` is before the first non-voided abutment / Ti-base / multi-unit / final-restoration component; late otherwise. Part 3 switches this to the loading date.
- `patient_history` and `audit_log_area_read` (latest definitions) include `implant_complications`; `implant_sites` changes already appear.

### Screens

- **Implant on the chart:** a **Complications** block under Visits — open complications first (bad badge), resolved ones muted; **Add complication**, per item **Edit** (add treatment, resolve) and **Remove from record** (reason).
- **Complication form:** category → type (filtered) → other fields; peri-implantitis / mucositis show the case definitions.
- **Failure box** on a failed implant: date, type, reason, early/late, notes; old failures show **Add failure details**; recorded ones have **Edit failure details** (editors only). The Record visit form reveals the failure fields when the outcome is "failed".
- **Odontogram:** a small warning dot on a tooth whose implant has an open complication. **Implants tab:** an **Open complications** count column.
- **History:** "Complication recorded: Peri-implantitis", "Complication resolved", "Failure recorded: removed (peri-implantitis)".

### Testing

- **DB:** each refusal (type not in category, other without text, dates, site state), update with stale version refused, void, failed visit writes visit and failure in one transaction (and rolls both back on a failure-field error), failure details added to an old failure, re-recording refused, `correct_failure` (edits, stale version refused, refused without recorded details, visits end at the new date), permissions, history.
- **Unit/component:** type list filtered by category, case-definition help, failure fields shown on "failed", early/late derivation.
- **E2E:** add a complication, then resolve it; record a failed visit with failure details; warning dot, Implants tab column and History reflect them.

## Follow-up PR (after 2a and 2b have deployed)

Drop `record_followup` (the 2a UI no longer calls it; it stays only for the previous app version during the release window).
