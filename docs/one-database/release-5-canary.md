# Release 5: cleanup and the canary

Owner steps, from `web/` of the worktree on the branch `one-db-release-5`. Release 5 ships migration **0096** (`0096_cleanup.sql`) and the canary tooling (`scripts/canary-check.ts`). Production company `academy` (id `a7c0de00-0000-4000-8000-000000000001`, host `kaleidoscope.imploid.net`).

## Before shipping

1. **Release 4's window is closed and verified** (`release-4-runbook.md`): the compare PASSed, `session-check` PASSed, the smoke test is done and no rollback is pending. Do not ship release 5 while a rollback to the pre-window dump is still possible: 0096 drops columns the dump-era app reads, so after it only a restore from a dump taken after release 5 helps.
2. Release 4 has been live long enough that nobody runs the release 3 build any more (no old Vercel deployment is promoted, no old tab sessions expected).
3. `git log one-db-release-5` is the code to ship; its checks have passed on a local main stack that went through release 4 first. If the stack was rebuilt at 0095 for release 4's verify (`release-4-runbook.md`, Before the window, step 2), `test:db` applies 0096 to it itself; from any other state rebuild it the same way:

   ```bash
   ! cd "/d/Claude/Claude Code/implant-course-one-db/web" && git checkout one-db-release-5 && npx supabase stop --no-backup && npm run db:start && npm run db:migrate && ./scripts/ship.sh verify auth admin delegates
   ```

   (`db:migrate` applies 0001 to 0096; the DB tests' global setup creates the test users; nothing may listen on :3000 for the E2E specs.) Then `npm run console:local` before any console E2E run.
4. Switch the repo public (Vercel Hobby deploy), as for every release; private again afterwards.

## What 0096 drops

It runs while release 4's app is live and removes only what release 4 no longer touches:

- `profiles.role`, `active`, `delegate_id`, `mfa_setup_required` (with `profiles_delegate_link` and `profiles_delegate_id_key`): the membership (`company_members`) holds them.
- `public.branding_public()` and `public.branding_logo()`: replaced by `branding_for(company)` and `branding_logo_for(company)`.
- The boolean `id` of `settings`, `branding` and `branding_logos` (their key is `company_id`).
- `public.patients_file_no_seq` (file numbers come from `app_private.file_no_counters`).
- 42 plain `<table>_company_id_idx` indexes that another index on the table already covers.

The five global uniques that 0091 replaced were dropped by 0095.

## When

0096 runs while release 4's app is live, in one transaction: it drops 42 indexes, two functions, a sequence, the four `profiles` columns and three `id` columns. Each takes an exclusive lock on its table, held until 0096 commits (seconds), so requests to those tables wait that long. Ship at a quiet hour, away from the nightly backup at 00:00 UTC (its `pg_dump` holds locks on every table). The migration starts with `set local lock_timeout = '5s'`: if any lock is not granted within 5 seconds it fails with `canceling statement due to lock timeout`, the whole of 0096 rolls back and **Release stops before the deploy**, so nothing changes for the users. That is safe: wait for a quieter moment and re-run the Release workflow (Actions, Release, Re-run all jobs).

## Ship

```bash
! cd web && ./scripts/ship.sh ship
```

from the branch `one-db-release-5`. Release migrates the control project, then every company, then deploys. After the Vercel deploy hook fires, wait 1 to 3 minutes and check `https://kaleidoscope.imploid.net` signs in and shows data. Then:

```bash
ENV_FILE=.env.prod npx tsx scripts/session-check.ts --tenant academy
```

must PASS.

## The canary

A second company in the shared database whose only job is to prove that a signed-in session of one company sees nothing of academy.

1. **Provision `canary`** in the console (Companies, Add company): slug `canary`, name `Canary`, host `canary.imploid.net`. Add the domain to the `implant-course` Vercel project first (**Add Existing**; without it HTTPS hangs) and the DNS CNAME at GoDaddy to Vercel, as for every company host.
2. **Create its first admin** in the console (a real address you control). Open the invite or set the password link from the email.
3. **Sign in to the canary** by hand at `https://canary.imploid.net/login`. The address bar must stay on `canary.imploid.net` through the sign-in and the redirect after it (release 4 could not rehearse this: under `next dev` a company's own login form redirected to the academy host). If it jumps to `kaleidoscope.imploid.net`, stop and report. Complete the 2FA setup, then open Patients, Courses and Inventory: the canary must start with its own copies of the catalogue and consent forms and **no patients, courses or stock**.
4. **Check the canary's sessions**: `ENV_FILE=.env.prod npx tsx scripts/session-check.ts --tenant academy` lists them under the canary's own company id (the canary company id is on its page in the console) and still PASSes for academy's.
5. **Run the isolation check.** It is read only: it signs in as the canary user, binds the session to the canary company, then asks PostgREST, for every company table, how many rows of academy it can see. Expected: 0 for every table, and the canary's own settings row visible (otherwise the session was not bound and the zeros prove nothing). Supply the credentials through the environment, never on the command line, and do not paste them anywhere:

   ```bash
   set -a; source .env.prod; set +a   # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DATABASE_URL, DATABASE_CA_CERT
   export CANARY_EMAIL='canary-admin@example.com' CANARY_COMPANY_ID='<the canary company id>'
   read -rs CANARY_PASSWORD; export CANARY_PASSWORD
   read -rs CANARY_TOTP; export CANARY_TOTP      # the current 6-digit code, if the user has 2FA
   npm run canary:check
   ```

   The first line printed is `Target project: <host>`; the last is `PASS` or `FAIL` (exit code 1). A `FAIL` names the table and the number of academy rows seen: stop, keep the canary suspended and report. A table printed as "closed to the session" has no grant for signed-in users, which is fine.
6. **Suspend the canary** in the console (Suspend, type the slug). Do not delete it; it can be reactivated for the next isolation check.
7. Pausing the old projects: none. Academy stayed in its project, and every company now lives in it.

Afterwards switch the repo private again.

## Audit rows

From 0096, `audit_log.row_id` for `settings` and `branding` changes is the company id; rows logged before keep `'true'`.

## Not done by 0096

`app_private.admin_company(text, boolean)` still carries its unused `p_academy_if_unbound` parameter (release 4 runbook, Rollback notes): removing it means redefining every function that calls it with two arguments, which is a separate change.
