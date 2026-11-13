# Merge the control project into the production database — design

Date: 2026-11-14. Status: approved by the owner. Next: a step-by-step plan per release, starting with release 1.


## Context

The app runs on two Supabase projects. **Production** holds every company's data and sign-in accounts. **Control** (`implant-course-control`) holds only the company list (address → company, plus each company's database keys in Vault), the console's admins and sign-in accounts, and the console's change log.

The control project was built when each company was meant to get its own database. Since the one-database releases every company lives in production, so the control project now stores keys that are the same for every company, and costs a second project to run, back up, migrate and (at go-live) pay for. It also brings about ten `CONTROL_*` settings, a second signing key, and extra steps in every release and backup.

Owner's reasons, in order: less to run and pay for, then a simpler setup.

## Decisions the owner made

- Every company always lives in the one shared database. Pointing a company at a separate database is no longer supported.
- No interruption for companies during the change. Only the console may be briefly unavailable.
- The owner is the only console user and will set a new console password and authenticator once. Console accounts are not copied.

## Goals

- One Supabase project. The control project is retired and later deleted.
- The company list lives in production and the app reads it from there.
- The console works as today (add company, addresses, suspend, first admin, health, log) against production.
- The `CONTROL_*` settings, the per-company keys in Vault and the control steps in Release and Backup are gone.

## Non-goals

- A separate database per company.
- Any change to how company users sign in, or to company data.
- Moving Supabase or Vercel to another account, or moving to Pro (parked separately).

## What must not happen

- A company address answering 404 or 503 at any point during the change.
- A company user, of any role, being able to call a console function or read another company's list entry.
- A release that cannot be undone by the owner within minutes.
- The console's history (who changed which company and why) being lost.

## Target state

**Company list.** `public.companies` gains the addresses (`hosts`) and the status (active / suspended) that `tenants` holds today, with the same rules as the control trigger `tenants_normalise` (addresses cleaned, one address belongs to one company). The app reads the list with production's own keys from its normal settings (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), keeping today's caching (fresh 60 s, usable up to 10 min if the database cannot be reached). `src/lib/tenant/control.ts` and `registry.ts` are the seams: `Tenant` keeps its shape, with the URL and anon key now coming from settings instead of a row.

**Keys.** `tenantServiceKey()` returns the service key from settings. Vault entries `tenant/<slug>/…` and `tenant_secret` are not recreated. Scripts no longer look up a database per company: there is one database, reached through `ENV_FILE` as before.

**Console.** The console becomes one more Self-Auth company (`console`) in production's `self_auth` tables, as it already is in the control database. `console_admins`, the `console_*` functions, `is_console_admin` and the change log (`tenant_audit`) are recreated in production. The console signs in with production's Self-Auth secret and signing key; the separate console secret and key go. Add company no longer copies keys (`sharedProject` goes): it creates the company, its address on Vercel and the first admin's invite.

**Safety of the console inside production.** `is_console_admin` stays as strict as today: second factor present and an active row in `console_admins` for this exact account. Console tables grant nothing to `anon` / `authenticated`. A DB test proves every `console_*` function refuses an admin, an organizer and a delegate of a company. `tests/db/permissions.test.ts` requires every public definer function to start with `require_perm`; the console functions get a named exemption that requires `is_console_admin` instead.

**History.** The rows of `tenant_audit` are copied into production once, unchanged. (My call: kept as its own table, not mixed into `audit_log`, which is per company.)

## How it rolls out: three releases, each one reversible

**Release 1 — production gets the list (nothing changes for anyone).**
Migration adds the list columns to `companies` and the console tables and functions. A copy step, safe to repeat, copies the list and history from control into production; a compare step fails if the two differ. The app still reads control. Undo: nothing to undo, the new columns are unused.

**Release 2 — the app can read either; the owner flips the switch.**
The code supports both sources. One explicit Vercel setting chooses the source; until it is set the app keeps using control. Switch-over, owner's steps: stop making console changes, run the copy and compare once more, create the console admin in production (`console:admin`), set the Vercel setting, redeploy, sign in to the console and set up the authenticator, check every company address. Undo: remove the setting and redeploy; control was never changed. Console changes made after the flip would not be in control, so the owner makes none until satisfied.

**Release 3 — clean up (about a week later).**
Remove the control code paths, the `CONTROL_*` settings, `supabase/control/`, the control steps in `release.yml` and `backup.yml` (keeping `scripts/workflows.test.ts` green), the dev2 console setup and `TENANTS_FILE` handling that only existed for two projects, and the `--tenant` / `--all-tenants` / `--control` script options. Rewrite `docs/operations.md` §G and the affected parts of `CLAUDE.md` and `docs/go-live.md`. Owner: keep one final encrypted backup of the control project, pause it, delete it after a month.

Every release is backward-compatible with the app version before it, as the release order (migrate, then deploy) requires.

## Left to the builder

- Exact column and table names in production, and whether addresses stay an array on `companies` or get their own table.
- How local development and the isolation and console E2E tests find companies once there is one stack (rows with `*.localhost` addresses, replacing `TENANTS_FILE` and dev2).
- The name of the Vercel switch and the copy / compare scripts.
- Whether old script options are accepted and ignored for one release or removed at once.

## How we will know it works

- Unit: registry tests for both sources; console tests.
- DB: console functions refuse company users; list rules (duplicate address refused, suspended company) behave as the control ones do.
- E2E on the local stack: console (add company, suspend, first admin), isolation (two companies, suspended one), sign-in.
- After each release on the live site: `kaleidoscope`, `osdic` and `demo` addresses load; an unknown address gives 404; a suspended company gives 503; the console signs in with 2FA and shows all companies with their history.
- After release 3: no `CONTROL_` name left in code, workflows or Vercel; nightly backup and the monthly verify pass with one database.

## Found while reading this as a builder

Checked against the code on 2026-11-14; each is settled here, none needs the owner.

- **Production refuses a console sign-in account today.** The trigger `self_auth_user_created` (`app_private.handle_new_self_auth_user`, 0101) fails any new Self-Auth user that has no pending login for its `companyId`, and otherwise gives it a profile and a company membership. Release 1 must redefine it so an account whose `companyId` is `console` is accepted and gets **no** profile and **no** membership. With no profile, `is_active_user()` is false for it, so it reads no company data. A DB test proves both: the console account is created, and it can read no company table.
- **Console functions use `auth.uid()` and the `aal` claim**, which production's Self-Auth tokens already carry, so `is_console_admin` moves unchanged apart from where `console_admins` lives. `console_admins.user_id` has no foreign key to `auth.users` (control 0007 dropped it); the key points at `self_auth."user"` as control 0008 does.
- **The same person can be a company admin and the console admin.** Self-Auth accounts are per company (`companyId` + `realEmail`), so the owner's address can exist once for `academy` and once for `console`.
- **Companies and console switch together** under the one Vercel setting in release 2 (my call: two switches would allow a state where the console edits a list the app does not read).
- **`companies` has forced row-level security.** The app reads the list with the service key, as it reads control today; no new policy for company users is added.
- **Names and limits copied from control:** slug pattern, name length, host pattern and the advisory lock in `tenants_normalise` (control 0001); the slug-rename quirk noted in the owner's notes (a rename that keeps the same hosts is refused) should be fixed in the new trigger, not copied.
- **Restore:** release 1 adds seeded or copied rows to new tables; add them to the restore `TRUNCATE` list in `docs/operations.md` §D in the same release.
