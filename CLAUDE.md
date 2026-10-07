# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Implant Course Manager** — web app for implant-course organizers in Egypt (English UI). Patients with an FDI odontogram, surgical/prosthetic inventory with lot traceability, courses/delegates, surgery schedule plus lecture/workshop talks, checklists, course reports, dashboard; admin/organizer/delegate roles. Spec: `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`; plans in `docs/superpowers/plans/`.

All code lives in `web/` — run every command from there.

## Commands

```bash
npm run dev                 # http://localhost:3000
npx tsc --noEmit            # typecheck
npm run lint
npm test                    # unit + component (Vitest, jsdom): src/**/*.test.ts(x), scripts/**/*.test.ts
npm test -- parse           # single file / name filter
npm run db:start            # local Supabase stack (Docker Desktop must be running); db:stop, db:status (URLs, keys)
npm run test:db             # DB tests against the local stack; APPLIES PENDING MIGRATIONS FIRST (see Gotchas)
npm run test:db -- friction # single DB test file
npm run test:e2e            # Playwright, 1 worker, starts/reuses the dev server (~12 min full run)
npm run db:dev2:start         # second local stack (company B for the isolation E2E): writes web/.env.dev2 + web/tenants.local.json; then ENV_FILE=.env.dev2 npm run db:migrate once; db:dev2:stop
TENANTS_FILE=tenants.local.json npx playwright test isolation --project=chromium   # needs both stacks, nothing on :3000; skips without TENANTS_FILE
npx playwright test schedule -g "clash"   # single spec / test
npm run db:migrate          # apply supabase/migrations/*.sql not yet in app_private.schema_migrations
npm run console:admin -- you@example.com   # console admin in the control project (needs CONTROL_SERVICE_ROLE_KEY in the env file)
npm run console:local   # dev2 stack as control project + .env.console for console E2E (then: set -a; source .env.console; set +a; npx playwright test console --project=chromium, nothing on :3000)
npm run create-user -- you@example.com "Name" [--role admin | --role delegate --delegate <id>]   # temporary password; ENV_FILE=.env.prod targets prod
npm run db:migrate -- --tenant academy      # one company from the control project (ENV_FILE=.env.prod); --all-tenants = every company, stops at the first failure
npm run tenants:export -- --dir <dir>       # backup workflow: one env file per company (masked under GitHub Actions)
./scripts/ship.sh verify [e2e specs…]   # on a feature branch, all committed: tsc, lint, unit, test:db (local), named E2E specs
./scripts/ship.sh ship                  # push → PR → merge → watch release.yml (migrates PROD, then deploys) — the owner runs this
```

Development, DB and E2E tests run on a **local Supabase stack** (Docker; `web/supabase/config.toml` mirrors prod's auth settings, MFA and email templates; its own migration runner is off, `npm run db:migrate` applies `supabase/migrations`). `web/.env.local` points at it (never print its contents); emails land in Mailpit (http://127.0.0.1:54324). Test fixtures refuse to run unless `ALLOW_TEST_FIXTURES=1` and `TEST_SUPABASE_PROJECT_REF=local` with both URLs on 127.0.0.1/localhost (or a hosted ref matching both URLs) (`scripts/test-guard.ts`). `scripts/db.ts` `pgConfig()` connects to the local stack without TLS and requires `DATABASE_CA_CERT` for hosted projects; hosted `DATABASE_URL` must be the Session pooler URI.

## Architecture

**Stack:** Next.js 15 App Router (server components + server actions), React 19, Tailwind v4, Zod v4, Supabase (`@supabase/ssr`) with Postgres RLS.

**Companies (multi-tenant, part 1):** one Supabase project per company behind one app. `src/lib/tenant/` routes by Host: middleware (Node runtime) → `routeHost()` → registry → sets the trusted `x-tenant` (any browser-sent one is dropped) and that company's CSP. Server code gets it with `currentTenant()`, which also requires the request's Host to belong to that tenant; `createClient()` / `createAdminClient()` (async) use it. Registry: none configured = the `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` env vars as tenant `default`, serving any host; `TENANTS_FILE` = local list (dev/isolation E2E only); `CONTROL_SUPABASE_URL` = the control project (`tenants`, Vault `tenant/<slug>/…`, cache 60 s, stale ≤ 10 min). Control migrations: `supabase/control/migrations/`, `npm run db:migrate -- --control`. Unknown host 404, suspended 503.

**Console (multi-tenant part 4):** `CONSOLE_HOST` is routed first by `routeConsole` (company hosts 404 on `/console`, the console host serves nothing else). Sign-in is control-project Auth with mandatory TOTP and the `console_admins` list; `requireConsoleAdmin()` guards every console page and action. Writes go through the `console_*` definer functions with the admin's email as `actor` (control migrations 0002, 0003; `console_log` records first-admin create/reset); health is `GET /console/api/health?slug=`. Runbook: `docs/operations.md` §G → Console.

**Branding (multi-tenant part 2, 0040):** each company's name, brand colour, navigation colour and logo live in its own database (`public.branding`, `public.branding_logos`; logo bytes are kept out of `audit_log`, `logo_version` is audited). Anyone reads them through `branding_public()` / `branding_logo()` (the login page renders before sign-in); admins write through `update_branding` / `set_branding_logo` / `clear_branding_logo` (Admin → Settings → Branding). `getBranding()` (`src/lib/branding/get.ts`) reads it once per request and falls back to the defaults on any failure; the root layout sets the title, icon and an `html:root` CSS-variable override (`brandingCss`), and `/brand/logo?v=<version>` (public path) serves the logo. Readability rules are in `src/lib/branding/colors.ts`; status colours are never branded. Nav colours use the `bg-nav` / `text-nav-ink` / `hover:bg-nav-hover` / `border-nav-line` tokens.

**The database is the source of truth for rules.** Every multi-table or integrity-sensitive operation (place implant, fit component, receive stock, corrections, booking, checklists) is a `public.*` plpgsql function called via `supabase.rpc(...)`. Conventions in those functions:
- `security definer set search_path = ''`, first line `perform app_private.require_perm('<area>', 'edit');` (plain `require_active()` only for non-area helpers), explicit `revoke … from public, anon` / `grant … to authenticated`. Readers that should obey RLS are `security invoker`.
- Business errors are raised with `app_private.fail('message')` (hint `'user'`). In TS, `userMessage(error)` (`src/lib/db-errors.ts`) shows those verbatim and hides everything else.
- `public.is_active_user()` / `is_admin()` gate RLS (active profile, plus aal2 when the user has verified 2FA). Writes are further restricted by column-level grants.
- **Roles & permissions** (0029–0034):
  - Roles are `admin`, `organizer` and `delegate`. `is_active_user()` means active **staff** only (admin or organizer).
  - **Organizers:** `user_permissions` holds None/View/Edit per area (`patients`, `schedule`, `courses`, `checklists`, `inventory`, `delegates`).
    - In SQL, `public.can(area, level)` decides access. **Restrictive** `<table>_area_*` policies AND it with the existing policies; write them as `(select public.can(...))` so it runs once per query (0034).
    - Every security-definer write function starts with `app_private.require_perm(area, 'edit')`. `tests/db/permissions.test.ts` fails if a new public definer function or table skips this.
    - Some reads cross areas, for example schedule → patients/courses and patients → bookings; see 0032 and 0033.
    - In TS, pages call `requirePermission(area)`, actions call `requirePermission(area, 'edit')`, and controls hide unless `canEdit(profile, area)`.
  - **Delegates** (`profiles.delegate_id`) get no table access. They read only through `my_schedule()` and `my_report()`, on the `/my` pages.
  - Staff-picker lists (checklist assignee, lead organizer, fitted by organizer) filter `role in ('admin','organizer')`: an active profile may be a delegate login. `check_assignee` enforces it for checklists (0037).
- `app_private.audit_row()` trigger on every table → `audit_log` (patient History tab reads it via `patient_history`). Patients view reads only the patient tables' audit rows; admins read all (0036).
- `stock_movements` is an append-only ledger; corrections are reversing movements. Lock order: site → batch.
- Dates are Cairo dates: use `public.cairo_today()` in SQL, `todayIso()` (`src/lib/dates.ts`) and `formatDate/formatTime` (`src/lib/format.ts`) in TS — never `current_date` / `new Date()` formatting.
- Patients and medical history use optimistic concurrency on `updated_at`.
- Supervisors on bookings and implants (`surgery_slots.supervisor_id`, `implant_sites.supervisor_id`) reference `public.supervisors`, an admin-maintained list of names (Admin → Supervisors), not user accounts. Accounts copied in by 0024 kept their profile id as supervisor id. Embed names via `supervisors!*_supervisor_ref_fkey`. "Fitted by organizer" on components still references `profiles`.
- The catalogue is Oxy Implant PSK-MDK + MD EXT, generated from `docs/catalog/oxy-catalog.csv` (0026). The 0008 sample brands are deactivated (`is_sample`), not deleted. Any component can be fitted without a product (Oxy cover screws come in the implant box).
- `implant_sites.technique` is `guided` / `free_hand`, nullable in the DB (older rows and the previous app version) but required by the app's Zod schemas; the schedule colours bookings by it (`bookingTechnique`). Bookings are edited in place with `update_surgery_slot` (same day only) and completed/reopened with `set_slot_status` (0027). Bookings need a surgery session that day: Schedule editors add one from the Schedule page ("Add surgery day") through `add_surgery_session`, which needs Edit on Schedule and only creates `surgery` sessions (0039); other session types are still added under Courses (Edit on Courses).
- **Placement and course reports (0035).**
  - The app places implants with `place_implant_v2`, which adds `p_isq` and `p_bone_type` (D1–D4).
  - `place_implant` stays only as a 13-argument wrapper for the release window, and a later PR drops it. Don't add an overload with defaulted parameters: PostgREST's named-argument calls become ambiguous.
  - `course_report(course)` is security invoker, so implants show only to users with Patients or Schedule view. The report's summaries and CSV are built in `src/lib/reports/course-report.ts`.
- **Lectures & workshops (0028):** `sessions.type` lecture/workshop sessions hold `talks` (time, `lecturers` row, topic), written only via `create_talk` / `update_talk` / `delete_talk`, which refuse times outside the session, overlaps in the session and double-booked lecturers. UI: `schedule/lectures|workshops`, sharing `schedule/_talks/`. Sessions have an optional `room`.
- Courses and patients are hard-deleted only through `delete_course` / `delete_patient`, which refuse anything with stock traceability or placed implants (the ledger is permanent); otherwise patients are archived. Users and delegates likewise only through `delete_user` (admin; any FK to the profile = "has records") / `delete_delegate` (refuses implant records or bookings) (0037); the action then deletes the Auth account with the service role (`src/lib/admin/auth-accounts.ts`), which also sets one-time passwords for **Reset password**.
- Tooth state `extracted` is labelled "To be extracted" (the tooth is still present); the enum value is unchanged.

**Migrations** (`web/supabase/migrations/NNNN_*.sql`) are applied once, in order, by `scripts/migrate.ts`; never edit an applied one. To change a function, add a new migration with `create or replace` of the *latest* definition (search later migrations — functions are redefined several times). New public tables get no privileges by default (0019) and must grant what they need.

Releases (`.github/workflows/release.yml`) migrate production *before* the new code deploys, so the previous app version runs against the new schema for a few minutes: migrations must be backward-compatible (add, don't rename or drop in the same release). When something the previous version still uses must go (e.g. an FK it embeds through), ship two PRs: the additive one first, the removal after it has deployed (see 0024 → 0025).

**App layout:** `src/app/(app)/` is the signed-in area; its `layout.tsx` redirects to `/login` or `/deactivated` and shows delegates their own menu. Because pages render in parallel with layouts, pages and every server action must guard themselves (`src/lib/auth/session.ts`): `requirePermission(area[, 'edit'])` for panel pages/actions, `requireAdmin()` for admin, `requireSignedIn()` for pages shared with delegates (account/security, set-password), `requireDelegate()` for `/my`. `requireActiveUser()` means staff and sends delegates to `/my`. `searchParams` are read with `readParams()` (`src/lib/search-params.ts`), which tolerates repeated params. Domain logic (parsing, labels, schemas, pure helpers) lives in `src/lib/<domain>/` with colocated tests; route folders hold pages, client forms and `actions.ts`.

**Security headers:** `next.config.ts` applies `securityHeaders()` (`src/lib/security-headers.ts`) to every route — a CSP allowing only this site and the Supabase project. Any new external origin (script, image, API) must be added there or the browser blocks it.

**Styling:** design tokens live in `src/app/globals.css` (`@theme`). Use the named colours (`text-muted`, `border-line`, `text-accent`, `bg-ok-soft`, `text-bad` …), not raw Tailwind palette colours, and the shared classes `.btn`/`.btn-secondary`/`.btn-danger`, `.input`, `.label`, `.card`, `.badge(-ok|-warn|-bad)`, `.rule(-ok|-warn|-bad|-accent)`, `.page-header`, `.tabs`/`.tab` (or `SectionNav`). Data tables use `className="table"` with `data-label` on every `<td>` so they stack on phones.

## Production

Runbook: `docs/operations.md` (provisioning, accounts, releases, backup/restore); go-live checklist: `docs/go-live.md`.
- Pilot on Supabase Free (Frankfurt) + Vercel Hobby (`fra1`, `web/vercel.json`). Merging to `master` runs `.github/workflows/release.yml`: checks + `next build` → migrate prod → Vercel deploy hook (Vercel's own git deploys are off). `backup.yml` takes a nightly encrypted data-only dump; `mode=verify` checks it. `web/scripts/workflows.test.ts` pins these workflows' safety properties — keep it green when editing them.
- Pilot switches (Vercel env, `src/lib/flags.ts`): `EMAIL_ENABLED` — on in prod since 2026-10-06 (Supabase Auth SMTP via a dedicated Gmail account); `false` makes Create login show a one-time password instead of sending an invite. `NEXT_PUBLIC_PILOT=1` shows the pilot banner. The Supabase invite/reset email templates must link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery` — the default `{{ .ConfirmationURL }}` doesn't work with `src/app/auth/confirm/route.ts` (`docs/operations.md` → Turning on email verification).
- Supabase Free allows **2 active projects per account across all orgs**: prod and the control project use both (dev runs on the local stack since 2026-10-07; the old hosted dev project is paused).
- Production routes through the **control project** `implant-course-control` (since 2026-10-07; runbook `docs/operations.md` §G): Vercel Production sets `CONTROL_SUPABASE_URL` + `CONTROL_SERVICE_ROLE_KEY`, and the control registry maps the company `academy` (host `implant-course.vercel.app`) to the prod project, with its service key in Vault. Any other host, including Vercel deployment URLs, gets 404. Rollback: remove both Vercel vars and run Release. `web/.env.prod` holds `CONTROL_SUPABASE_URL` / `CONTROL_DATABASE_URL` for `db:migrate -- --control` and `tenant:register` / `tenant:check`. Multi-tenant parts 1–4 (registry, branding, operations, console) are done; part 5 (onboarding) is not started.
- Scripts target a company with `--tenant <slug>` (read from the control project via `CONTROL_DATABASE_URL` in `.env.prod`); without it they use `ENV_FILE` as before (`scripts/env-file.ts`). Release migrates the control project then every company (`--all-tenants`) before deploying; Backup writes one encrypted file per company plus the control registry (`backups-*`). GitHub needs `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY` (production environment). Every script prints `Target project: <host>` first. Never name a prod env file `.env.production*` — Next.js would load it automatically. `npm run catalog-export` writes the product catalog to CSV.

## Tests

- **DB tests** (`tests/db/`): each test runs in `withTx` (always rolled back); `actAs(c, userId)` impersonates a user via JWT claims, `asPostgres(c)` resets role; `setPerms(c, user, {...})` sets area permissions. Test users come from `inject('testUsers')` (`tests/support/test-users.ts`): `organizer` is pinned to Edit everywhere, `viewer` has View everywhere + Edit on Inventory, `delegate` is a delegate login linked to the "Test Delegate Login" delegate.
- **E2E** (`tests/e2e/`): the `chromium` project runs everything except `mobile.spec.ts`, which runs in the `phone` project (360px). Log in with `login(page, TEST_USERS.organizer.email)`; name data with `uniqueName()` (prefix `E2E `, cleaned up in global teardown). Wait for server-derived state rather than optimistic UI. Prefer `getByRole('combobox', { name })` for selects.
- Component tests mock server actions with `vi.mock('./actions', …)`.

## Gotchas

- Windows + Git Bash: heredocs and `node -e` mangle backslashes/quotes — write files containing `\` with the Write/Edit tools. Files are CRLF in git; multi-line string matches may need CRLF normalisation.
- `gh` is not on Git Bash's PATH: call `"/c/Program Files/GitHub CLI/gh.exe"`. The user's `!` prompt runs Bash, not PowerShell. There is no Python; script with Node.
- The local stack needs Docker Desktop running and `npm run db:start` after every reboot; `test:db`, E2E and `next dev` fail to connect otherwise (`ship.sh verify` checks it first). `npm run db:stop` frees its memory.
- E2E reuses whatever listens on :3000. A leftover `next dev` (find it with `Get-NetTCPConnection -LocalPort 3000`) can hold several GB and make unrelated specs time out — check memory before debugging timeouts.
- E2E patients with stock movements survive teardown, so DB tests that search by name must use names unique to the test (e.g. `Zz …`). `slot-placement` E2E occasionally clashes with a leftover booking on its random future date; rerun before investigating.
- The booking form only lists surgery sessions dated today or later.
- React 19 resets `<form action={…}>` after the action: keep inputs uncontrolled with `defaultValue={valueOf(state, …)}` (`src/lib/patients/form-state.ts`) so values survive. `<select>` and radios still fall back to their first/initial option — remount them on each result (`key`; see `schedule/_talks/talk-form.tsx`, `admin/users/permission-grid.tsx`).
- `npm run test:db` applies pending migrations to the local stack on its first run; treat applied migrations as uneditable anyway (prod applies each once). Write the failing test before creating the migration file, and dry-run a new migration in a rolled-back transaction (a small `tsx` script using `pgConfig()`, run with `NODE_PATH=web/node_modules`) before the first `test:db`.
- The full E2E run (~110 tests) exceeds the 10-minute foreground limit and background runs get killed under memory pressure: run it in parts (`npx playwright test <spec names…>`) and check free memory first.
- Next.js renders a hidden `role="alert"` route announcer: filter alert locators by text (`getByRole('alert').filter({ hasText })`).
- There is no Prettier config — don't run Prettier; it rewrites quotes and wrapping.
- A migration that seeds rows must add its table to the restore `TRUNCATE` in `docs/operations.md` §D, or restoring the nightly data-only dump fails on the primary key (as `branding` would have).
