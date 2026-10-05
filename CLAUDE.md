# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Implant Course Manager** — web app for implant-course organizers in Egypt (English UI). Patients with an FDI odontogram, surgical/prosthetic inventory with lot traceability, courses/delegates, surgery schedule, checklists, dashboard. Spec: `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`; plans in `docs/superpowers/plans/`.

All code lives in `web/` — run every command from there.

## Commands

```bash
npm run dev                 # http://localhost:3000
npx tsc --noEmit            # typecheck
npm run lint
npm test                    # unit + component (Vitest, jsdom): src/**/*.test.ts(x), scripts/**/*.test.ts
npm test -- parse           # single file / name filter
npm run test:db             # DB tests against the hosted dev project; applies pending migrations first
npm run test:db -- friction # single DB test file
npm run test:e2e            # Playwright, 1 worker, starts/reuses the dev server (~12 min full run)
npx playwright test schedule -g "clash"   # single spec / test
npm run db:migrate          # apply supabase/migrations/*.sql not yet in app_private.schema_migrations
npm run create-user -- you@example.com "Name" [--role admin]   # prints a temporary password; ENV_FILE=.env.prod targets prod
```

There is no local Supabase: DB and E2E tests hit the hosted **dev** project configured in `web/.env.local` (never print its contents). Test fixtures refuse to run unless `ALLOW_TEST_FIXTURES=1` and the URLs match `TEST_SUPABASE_PROJECT_REF` (`scripts/test-guard.ts`). `scripts/db.ts` `pgConfig()` requires `DATABASE_CA_CERT` except on that dev project. `DATABASE_URL` must be the Session pooler URI.

## Architecture

**Stack:** Next.js 15 App Router (server components + server actions), React 19, Tailwind v4, Zod v4, Supabase (`@supabase/ssr`) with Postgres RLS.

**The database is the source of truth for rules.** Every multi-table or integrity-sensitive operation (place implant, fit component, receive stock, corrections, booking, checklists) is a `public.*` plpgsql function called via `supabase.rpc(...)`. Conventions in those functions:
- `security definer set search_path = ''`, first line `perform app_private.require_active();`, explicit `revoke … from public, anon` / `grant … to authenticated`.
- Business errors are raised with `app_private.fail('message')` (hint `'user'`). In TS, `userMessage(error)` (`src/lib/db-errors.ts`) shows those verbatim and hides everything else.
- `public.is_active_user()` / `is_admin()` gate RLS (active profile, plus aal2 when the user has verified 2FA). Writes are further restricted by column-level grants.
- **Roles & permissions** (0029–0033):
  - Roles are `admin`, `organizer` and `delegate`. `is_active_user()` means active **staff** only (admin or organizer).
  - **Organizers:** `user_permissions` holds None/View/Edit per area (`patients`, `schedule`, `courses`, `checklists`, `inventory`, `delegates`).
    - In SQL, `public.can(area, level)` decides access. **Restrictive** `<table>_area_*` policies AND it with the existing policies.
    - Every security-definer write function starts with `app_private.require_perm(area, 'edit')`. `tests/db/permissions.test.ts` fails if a new public definer function or table skips this.
    - Some reads cross areas, for example schedule → patients/courses and patients → bookings; see 0032 and 0033.
    - In TS, pages call `requirePermission(area)`, actions call `requirePermission(area, 'edit')`, and controls hide unless `canEdit(profile, area)`.
  - **Delegates** (`profiles.delegate_id`) get no table access. They read only through `my_schedule()` and `my_report()`, on the `/my` pages.
- `app_private.audit_row()` trigger on every table → `audit_log` (patient History tab reads it via `patient_history`).
- `stock_movements` is an append-only ledger; corrections are reversing movements. Lock order: site → batch.
- Dates are Cairo dates: use `public.cairo_today()` in SQL, `todayIso()` (`src/lib/dates.ts`) and `formatDate/formatTime` (`src/lib/format.ts`) in TS — never `current_date` / `new Date()` formatting.
- Patients and medical history use optimistic concurrency on `updated_at`.
- Supervisors on bookings and implants (`surgery_slots.supervisor_id`, `implant_sites.supervisor_id`) reference `public.supervisors`, an admin-maintained list of names (Admin → Supervisors), not user accounts. Accounts copied in by 0024 kept their profile id as supervisor id. Embed names via `supervisors!*_supervisor_ref_fkey`. "Fitted by organizer" on components still references `profiles`.
- The catalogue is Oxy Implant PSK-MDK + MD EXT, generated from `docs/catalog/oxy-catalog.csv` (0026). The 0008 sample brands are deactivated (`is_sample`), not deleted. Any component can be fitted without a product (Oxy cover screws come in the implant box).
- `implant_sites.technique` is `guided` / `free_hand`, nullable in the DB (older rows and the previous app version) but required by the app's Zod schemas; the schedule colours bookings by it (`bookingTechnique`). Bookings are edited in place with `update_surgery_slot` (same day only) and completed/reopened with `set_slot_status` (0027).
- Courses and patients are hard-deleted only through `delete_course` / `delete_patient`, which refuse anything with stock traceability or placed implants (the ledger is permanent); otherwise patients are archived.
- Tooth state `extracted` is labelled "To be extracted" (the tooth is still present); the enum value is unchanged.

**Migrations** (`web/supabase/migrations/NNNN_*.sql`) are applied once, in order, by `scripts/migrate.ts`; never edit an applied one. To change a function, add a new migration with `create or replace` of the *latest* definition (search later migrations — functions are redefined several times). New public tables get no privileges by default (0019) and must grant what they need.

Releases (`.github/workflows/release.yml`) migrate production *before* the new code deploys, so the previous app version runs against the new schema for a few minutes: migrations must be backward-compatible (add, don't rename or drop in the same release). When something the previous version still uses must go (e.g. an FK it embeds through), ship two PRs: the additive one first, the removal after it has deployed (see 0024 → 0025).

**App layout:** `src/app/(app)/` is the signed-in area; its `layout.tsx` redirects to `/login` or `/deactivated`. Because pages render in parallel with layouts, pages and every server action must call `requireActiveUser()` / `requireAdmin()` (`src/lib/auth/session.ts`) themselves. `searchParams` are read with `readParams()` (`src/lib/search-params.ts`), which tolerates repeated params. Domain logic (parsing, labels, schemas, pure helpers) lives in `src/lib/<domain>/` with colocated tests; route folders hold pages, client forms and `actions.ts`.

**Security headers:** `next.config.ts` applies `securityHeaders()` (`src/lib/security-headers.ts`) to every route — a CSP allowing only this site and the Supabase project. Any new external origin (script, image, API) must be added there or the browser blocks it.

**Styling:** design tokens live in `src/app/globals.css` (`@theme`). Use the named colours (`text-muted`, `border-line`, `text-accent`, `bg-ok-soft`, `text-bad` …), not raw Tailwind palette colours, and the shared classes `.btn`/`.btn-secondary`/`.btn-danger`, `.input`, `.label`, `.card`, `.badge(-ok|-warn|-bad)`, `.rule(-ok|-warn|-bad|-accent)`, `.page-header`, `.tabs`/`.tab` (or `SectionNav`). Data tables use `className="table"` with `data-label` on every `<td>` so they stack on phones.

## Production

Runbook: `docs/operations.md` (provisioning, accounts, releases, backup/restore); go-live checklist: `docs/go-live.md`.
- Pilot on Supabase Free (Frankfurt) + Vercel Hobby (`fra1`, `web/vercel.json`). Merging to `master` runs `.github/workflows/release.yml`: checks + `next build` → migrate prod → Vercel deploy hook (Vercel's own git deploys are off). `backup.yml` takes a nightly encrypted data-only dump; `mode=verify` checks it. `web/scripts/workflows.test.ts` pins these workflows' safety properties — keep it green when editing them.
- Pilot switches (Vercel env): `EMAIL_ENABLED=false` replaces invites with `create-user` (no SMTP yet); `NEXT_PUBLIC_PILOT=1` shows the pilot banner (`src/lib/flags.ts`).
- Scripts target prod with `ENV_FILE=.env.prod` (`scripts/env-file.ts`); every script prints `Target project: <host>` first. Never name a prod env file `.env.production*` — Next.js would load it automatically. `npm run catalog-export` writes the product catalog to CSV.

## Tests

- **DB tests** (`tests/db/`): each test runs in `withTx` (always rolled back); `actAs(c, userId)` impersonates a user via JWT claims, `asPostgres(c)` resets role. Test users come from `inject('testUsers')` (`tests/support/test-users.ts`); fixtures in `tests/db/fixtures.ts`.
- **E2E** (`tests/e2e/`): the `chromium` project runs everything except `mobile.spec.ts`, which runs in the `phone` project (360px). Log in with `login(page, TEST_USERS.organizer.email)`; name data with `uniqueName()` (prefix `E2E `, cleaned up in global teardown). Wait for server-derived state rather than optimistic UI. Prefer `getByRole('combobox', { name })` for selects.
- Component tests mock server actions with `vi.mock('./actions', …)`.

## Gotchas

- Windows + Git Bash: heredocs and `node -e` mangle backslashes/quotes — write files containing `\` with the Write/Edit tools. Files are CRLF in git; multi-line string matches may need CRLF normalisation.
- `gh` is not on Git Bash's PATH: call `"/c/Program Files/GitHub CLI/gh.exe"`. The user's `!` prompt runs Bash, not PowerShell. There is no Python; script with Node.
- E2E reuses whatever listens on :3000. A leftover `next dev` (find it with `Get-NetTCPConnection -LocalPort 3000`) can hold several GB and make unrelated specs time out — check memory before debugging timeouts.
- E2E patients with stock movements survive teardown, so DB tests that search by name must use names unique to the test (e.g. `Zz …`). `slot-placement` E2E occasionally clashes with a leftover booking on its random future date; rerun before investigating.
- The booking form only lists surgery sessions dated today or later.
- React 19 resets `<form action={…}>` after the action: keep inputs uncontrolled with `defaultValue={valueOf(state, …)}` (`src/lib/patients/form-state.ts`) so values survive.
