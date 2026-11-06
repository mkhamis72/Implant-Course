# Release 4: the enforcement window

Owner steps, in order, from `web/` of the worktree (`cd "/d/Claude/Claude Code/implant-course-one-db/web"`) on the branch `one-db-release-4`. Production project `kshsgwvwqvufqdxcyvat`, company `academy` (id `a7c0de00-0000-4000-8000-000000000001`, host `kaleidoscope.imploid.net`). Expected length: one hour reserved, about 15 minutes of it work (the migrations themselves took 2 to 4 seconds in the rehearsals; the rest is the dump, the Release workflow and the Vercel deploy).

Release 4 applies migrations **0089 to 0095** (not 0089 to 0094): guards, company functions, company keys, forced policies, console first admin, company refs, `provision_company`. Prod must be at release 3 first (migrations through 0088, control `0004`). Release also applies control migration `0005_provision.sql` to the control project (additive: a unique index and `console_set_company`). Every command that touches prod prints `Target project: <host>` first; stop if it is not the host you expect.

Commands below that read prod use `ENV_FILE=.env.prod` and `--tenant academy` (read from the control project). Put no secret on a command line.

**When:** keep the window away from the nightly backup at 00:00 UTC (02:00/03:00 Cairo, `backup.yml`): its `pg_dump` holds locks on every table while it runs, and each migration gives up after 5 seconds of waiting for a lock (`set local lock_timeout = '5s'`). Any other quiet hour works; start no later than 22:00 UTC, so an hour's window ends before the backup.

## Before the window (days before)

1. Release 3 is live and its checklist (`release-3-checklist.md`) is done, including `session-check` PASS.
2. `git log one-db-release-4` is the code to ship. Verify it on a local main stack at **exactly 0095**: release 4's DB tests fail on a stack that already has release 5's 0096 (it drops columns and indexes they still check), and running the `one-database` branch's tests applies 0096. So rebuild the main stack first. This wipes the local stack's data (leftover E2E rows, the console E2E company `console-e2e`); Docker Desktop must be running:

   ```bash
   ! cd "/d/Claude/Claude Code/implant-course-one-db/web" && git checkout one-db-release-4 && npx supabase stop --no-backup && npm run db:start && npm run db:migrate && ./scripts/ship.sh verify
   ```

   `db:migrate` takes the empty stack to 0095 (`Applied: 0001_foundation.sql, ..., 0095_provision_company.sql`). The test users need no step: the DB tests' global setup (`tests/db/global-setup.ts`, `tests/support/test-users.ts`) creates them on every run. Expected last line `Verified one-db-release-4.` (2026-11-06, after this rebuild: 36 s to rebuild the stack, 3 s to migrate, 2.5 minutes for verify: unit 222 files / 1518 tests, DB 77 files / 646 tests). To sign in to the dev server afterwards, `npm run create-user -- you@example.com "Your Name" --role admin`.

   Back to release 5 afterwards: `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && git checkout one-database && npm run test:db` (it applies 0096 to the stack first), then `npm run console:local` before the console E2E (it recreates `console-e2e`). Do the same rebuild-and-verify on `one-db-release-5` before release 5 (`release-5-canary.md`).
3. Switch the repo public (Vercel Hobby deploy), as for every release; private again afterwards.
4. Tell the academy users the window time. Suspended means they see "Service unavailable" (503).
5. Docker Desktop must be running on the machine you use: the dump (step 2) and the rollback run `pg_dump`, `pg_restore` and `psql` in the `postgres:17` container. Have the dashboard open on the prod project: Authentication, Logs, Database advisors.
6. Read the Rollback section below once before the window; it is one command plus two compares, rehearsed locally.

## The window

1. **Suspend academy in the console.** Console host, Companies, academy, Suspend (reason "release 4 window", type the slug). Wait up to 60 seconds for the host cache, then open `https://kaleidoscope.imploid.net` and confirm it shows 503. Nobody writes from now on.

2. **Pre-window dump** (the rollback point; a full `pg_dump` of every schema including `auth`, with grants: the rollback replays them):

   ```bash
   ENV_FILE=.env.prod npm run backup:pre-one-db -- --tenant academy --out "D:/Backups/implant-course/pre-window/academy"
   ```

   Expected: files `full.dump`, `schema.dump`, `counts.json`, `settings.md` in `pre-window/academy` (the script writes into `--out` itself). Keep this directory; do not continue without it.

3. **Before checksums** (read-only; per table row count and per column md5, `company_id` excluded):

   ```bash
   ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out "D:/Backups/implant-course/pre-window/checksums-before.json"
   ```

   Expected: `Target project: <prod host>` then `N tables, M rows -> ...` (tables of `public`, `app_private`, `app` and `auth`; `public.audit_log` is hashed row by row).

   Then the **before fingerprint** (read-only; the schema, grants, default privileges and roles of `public`, `app_private` and `app`, no data), which the rollback is checked against:

   ```bash
   ENV_FILE=.env.prod npm run schema:fingerprint -- --tenant academy --out "D:/Backups/implant-course/pre-window/fingerprint-before.json"
   ```

   Expected: `Target project: <prod host>` then `N entries -> ...` (1753 on a release 3 stack).

4. **Ship release 4.** From the branch `one-db-release-4`:

   ```bash
   ./scripts/ship.sh ship
   ```

   Release migrates the control project, then every company (0089 to 0095 for academy, suspended companies included), then triggers the Vercel deploy. Wait for the run to turn green, then 1 to 3 minutes more for the build to go live. If the run fails at the academy migration, nothing was deployed: read the error, do not edit an applied migration, and use the rollback below if unsure. Migrations begin with `set local lock_timeout = '5s'`, so a lock wait fails fast instead of hanging. **A lock-timeout failure** (`canceling statement due to lock timeout`) is not a reason to roll back: each migration file is its own transaction, so the files before it are applied and the failing one left nothing behind. Wait a minute and re-run the Release workflow (Actions, Release, Re-run all jobs): it applies the remaining files, then deploys. Then continue with step 5 as normal.

5. **After checksums and compare:**

   ```bash
   ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out "D:/Backups/implant-course/pre-window/checksums-after.json"
   npm run window:checksums -- --compare "D:/Backups/implant-course/pre-window/checksums-before.json" "D:/Backups/implant-course/pre-window/checksums-after.json"
   ```

   Expected last line `PASS`, exit 0. Expected lines (rehearsal): `EXPECTED app_private.file_no_counters: table only after (0091)`, `EXPECTED app_private.schema_migrations` rows 88 to 95 and its two column hashes (the runner recording 0089 to 0095), and `REPORTED public.audit_log: 1 new row(s), N earlier row(s) unchanged` (the migrations write audit rows; every row that existed before is compared one by one and must be unchanged; auth session tables are reported without failing). Any `DIFFERENT` line is a failure, `DIFFERENT public.audit_log: ... earlier row(s) changed` included: stop and roll back. Columns are compared one by one. A table or a column present on one side only fails unless it is in `EXPECTED_SCHEMA_CHANGES` in `scripts/window-checksums.ts`, with the migration that makes it. If the only differences are in `auth.users` sign-in or refresh timestamp columns (`last_sign_in_at`, `updated_at`; open tabs refreshing tokens during the window), check them by hand: that is not an automatic rollback. Any other `DIFFERENT` line is.

6. **Session check before the lift.** Academy is still suspended and nobody has signed in on the new code, so this confirms that no existing session is bound to another company (run it as soon as the compare has passed):

   ```bash
   ENV_FILE=.env.prod npx tsx scripts/session-check.ts --tenant academy
   ```

   Expected `PASS` (`no bound sessions yet` is normal here). Any other company id prints `PROBLEM`: stop and roll back.

7. **Lift the suspension** in the console (Reactivate) now that the compare and the session check have passed (a suspended site answers 503, so it cannot be smoke-tested), wait up to 60 seconds, and reload the site. If anything below fails, suspend again and use the rollback. Smoke test on `https://kaleidoscope.imploid.net`:

   - Sign in with 2FA (this binds the session to the company).
   - Open a patient and its Implants tab.
   - Schedule: open a surgery day, make a booking and cancel it.
   - Inventory: the stock page lists batches; open a receive form without saving.
   - Statistics: the results page loads with data.
   - Export: a Statistics export downloads.
   - Patients, Recall list loads (see the performance item below).
   - Admin, Users lists the same people; a delegate login's `/my` shows the schedule.

   Then run the session check a second time:

   ```bash
   ENV_FILE=.env.prod npx tsx scripts/session-check.ts --tenant academy
   ```

   Expected `academy: N sessions` with N of at least 1 (the smoke-test sign-in is bound to academy) and `PASS`.

8. **Advisors, afterwards.** Dashboard, Database, Advisors: Security and Performance. Compare with what the dashboard showed before; every new item that names `app.*`, `company_*` or the `*_area_*` / company policies needs a look. Expected new notices are Performance "unindexed foreign key" items on the composite `(company_id, ...)` keys at most; nothing may say a table has RLS disabled.

## Rollback

Use it when the compare fails, the Release stops after migrating academy for a reason other than a lock timeout (step 4), or the smoke test shows data from the wrong company.

It puts academy's database back to the pre-window dump: the schemas `public`, `app_private` and `app` with their data, grants and default privileges, the trigger on `auth.users` that calls them, and the release 3 roles (`tenant_definer`, added by 0092, is dropped, so a later retry of 0089 to 0095 starts clean). `auth` itself is not restored: the window does not change it, and sign-ins stay valid. Anything written after the dump (a smoke-test booking) is lost. It runs as **one transaction**: if any statement fails, the database stays exactly as it was (rehearsed: a failing run left the fingerprint identical), so it can be fixed and run again.

`D:/Backups/implant-course/pre-one-db/RESTORE.md`, section "Restore the whole academy project", is superseded for release 4 by this section: its `pg_restore --clean --no-acl --schema=public --schema=app_private` restores no grants, leaves schema `app` at the release 4 versions and keeps `tenant_definer`, after which a retried release 4 fails at 0089.

1. Keep academy suspended (if it was lifted: Suspend, wait up to 60 seconds, confirm 503).
2. **Redeploy the release 3 build in Vercel** (Deployments, the last production deployment before release 4, Redeploy). Do **not** revert on master and run Release for this: the rollback removes 0089 to 0095 from `app_private.schema_migrations`, so a Release would apply them again.
3. **Roll the database back** (Docker Desktop running):

   ```bash
   ENV_FILE=.env.prod npm run window:rollback -- --tenant academy --dump "D:/Backups/implant-course/pre-window/academy/full.dump" --confirm kshsgwvwqvufqdxcyvat
   ```

   Expected, in about 5 seconds plus the network (rehearsal 4.4 to 4.5 s, the transaction itself 3.0 s):

   ```text
   Target project: <prod host> (ref kshsgwvwqvufqdxcyvat)
   Now at 0095_provision_company.sql; outside triggers to recreate: auth users on_auth_user_created
   Replaying 1315 dump entries in one transaction ...
   ledger: 88 migrations, last 0088_pending_logins.sql
   Rolled back in 3.0 s. Now run window:checksums and schema:fingerprint and compare.
   ```

   (The entry count is the rehearsal's; prod's may differ by a few.) `--confirm` must be the project ref the script reads from the database URL, or it refuses. In that one transaction (`scripts/window-rollback.ts`): `drop owned by tenant_definer cascade` and `drop role tenant_definer`; `drop schema app cascade` and `drop schema app_private cascade`; every table, view, sequence, function and type of ours in `public` dropped (`public` itself stays, it carries Supabase's own default privileges); our default privileges in `public` revoked, so the restored objects start from the built-in ACLs and the dump's own `GRANT`, `REVOKE` and `ALTER DEFAULT PRIVILEGES` lines rebuild exactly the release 3 ones; then the dump's entries for the three schemas (schema, data, constraints, indexes, policies, triggers, ACLs) and the `auth.users` trigger, replayed by `psql --single-transaction -v ON_ERROR_STOP=1`; last, a check that the ledger ends at 0088 and the role is gone. The SQL with the data never leaves the container. It refuses a dump without ACLs (one taken before release 4 changed `backup:pre-one-db`), a dump without the ledger or the trigger, and any object outside the three schemas that depends on them and would be lost.
4. **Prove it** (both must end `PASS`):

   ```bash
   ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out "D:/Backups/implant-course/pre-window/checksums-rollback.json"
   npm run window:checksums -- --compare "D:/Backups/implant-course/pre-window/checksums-before.json" "D:/Backups/implant-course/pre-window/checksums-rollback.json"
   ENV_FILE=.env.prod npm run schema:fingerprint -- --tenant academy --out "D:/Backups/implant-course/pre-window/fingerprint-rollback.json"
   npm run schema:fingerprint -- --compare "D:/Backups/implant-course/pre-window/fingerprint-before.json" "D:/Backups/implant-course/pre-window/fingerprint-rollback.json"
   ```

   Checksums: no `EXPECTED` lines (no 0091 table, ledger back at 88 rows), `REPORTED public.audit_log: 0 new row(s), N earlier row(s) unchanged`; auth session tables may be `REPORTED`. Fingerprint: three `REGROUPED` lines are expected and fine (`consent_form_versions_label_check`, `saved_analyses_title_check`, `studies_title_check`: a CHECK written `a and b and c` in a migration is stored nested and comes back flat from a dump; same rule, other parentheses). Any `DIFFERENT`, `ONLY BEFORE` or `ONLY AFTER` line: keep academy suspended, keep every file, and report; the database is consistent (one transaction) but not equal to release 3.
5. Control migration `0005_provision.sql` stays applied on the control project: it is additive and the release 3 app ignores it. Reactivate academy and sign in once. Afterwards revert the release 4 merge on master (so the next Release does not migrate again) before any new release.
6. **Retrying release 4 later** needs nothing special: the rolled-back database takes 0089 to 0095 from Release like the first time (rehearsed: all seven applied in 0.4 s, and the compare against the original `checksums-before.json` passed with the usual `EXPECTED` lines). Take a new dump, checksums and fingerprint in that window.

Migrations 0089 to 0095 are not backward compatible with the release 3 app (forced company policies, definers that need a bound session). Rolling back means going back to the dump, not just redeploying.

### Rollback rehearsal (2026-11-06, local dev2)

Built to look like prod at release 3, grants included: a wiped dev2 stack migrated 0001 to 0082 (so every grant comes from the migrations, as on prod; the earlier `restore-check` rehearsals restore without ACLs, so their grants are not prod's), the real 2026-11-02 academy dump's data loaded into it (`PASS 76/76` against its `counts.json`), then 0083 to 0088. Its fingerprint equals that of an empty stack migrated to 0088 (`PASS`, 1753 entries). Then the window as above, the rollback, the proofs and a retry:

| Step | Time | Result |
| --- | --- | --- |
| Pre-window dump (`backup:pre-one-db`, with ACLs) | 4.4 s | 4 files |
| Checksums before / fingerprint before | 1.0 s / 0.9 s | 80 tables, 2223 rows / 1753 entries |
| 0089 to 0095 | 0.4 s | compare `PASS` (the usual `EXPECTED` lines, `public.audit_log: 1 new row(s), 736 earlier row(s) unchanged`) |
| `window:rollback` | 4.5 s (transaction 3.0 s) | ledger 88, last 0088 |
| Checksums after rollback vs before | 1.0 s | `PASS`, no `EXPECTED` lines; the two JSON files are byte-identical |
| Fingerprint after rollback vs before, and vs an empty stack at 0088 | 0.9 s | `PASS` both (3 `REGROUPED`); every ACL (281 objects, 77 columns with column grants), default privilege and role equal, no `tenant_definer` |
| Retry 0089 to 0095 | 0.4 s | compare vs the original before `PASS`, same `EXPECTED` lines |
| Rollback again from the retried state, and once more from an already rolled-back one | 4.4 s / 2.7 s | `PASS` / ledger 88 |
| A rollback that fails partway (a dump taken at 0095, whose grants name the role it has just dropped) | | `role "tenant_definer" does not exist`, exit 3; fingerprint before and after the attempt `PASS`: nothing changed |

## Lint (local, before the window)

`npx supabase db lint` on the local stack (main stack up, migrated to 0095) reports 19 functions with warnings, none of them real. Nothing was changed for them; migrations 0089 to 0095 are untouched by lint.

| Warning | Functions | Reason it stays |
| --- | --- | --- |
| "marked as STABLE/IMMUTABLE, but expression is VOLATILE" at a `PERFORM` | 14: `finding_number`, `finding_choice`, `check_restoration_problem`, `check_technique`, `detail_date`, `complication_details`, `check_restoration_details`, `clean_items`, `admin_company`, `my_schedule`, `my_restorations`, `my_report`, `admin_user_history`, `analysis_codes` | The PERFORM is the permission/active-user guard (`require_perm`, `require_active`), which reads the session and may raise. Marking these VOLATILE would stop the planner caching them and is not needed. Pre-existing pattern of every reader; `admin_company` only gained a company lookup in 0090. |
| "target type is different type than source type" (text to uuid / array / enum) | `provision_company` (0095), `void_followup`, `create_surgery_slot`, `save_radiograph` | String-literal initialisers and `case ... 'restored'` results that Postgres casts implicitly; the check does not model the literal cast. No runtime effect (the DB tests exercise all four). |
| "unused parameter p_academy_if_unbound" | `app_private.admin_company` | Deliberate: kept so the release 3 callers still work. Not removed by release 5's 0096: removing it means redefining every caller, a separate follow-up (see `release-5-canary.md`, "Not done by 0096"). |

## Rehearsals (2026-11-06, local, `restore-check` of the 2026-11-02 academy dump)

Dev2 stack wiped, dump restored (`PASS 76/76`), migrated to 0088 (the dump is older than release 2/3, so 0083 to 0088 applied first), checksums, `npm run db:migrate` (0089 to 0095), checksums, compare. Dump: 76 tables, 2198 rows (79 tables, 2223 rows once at 0088; 80 tables, 2232 rows after 0095).

| Rehearsal | Fresh stack to restored | Window part (checksums, migrate, checksums, compare) | Compare |
| --- | --- | --- | --- |
| 1 | not timed separately (33 s stack start, 5 s restore) | 5 s | PASS |
| 2 (from a wiped stack) | 33 s start | 4 s (45 s total with stack, restore and 0083 to 0088) | PASS |

Both rehearsals gave identical after-hashes for every table. Well inside the 30 minute target. The data is small (2.2 thousand rows), so prod's real window time is dominated by the dump, the Release workflow and the deploy, not the migrations.

`recall_list()` on the restored dump after 0095, as an academy admin with an aal2 session (34 visible patients, 104 rows): 46, 42 and 41 ms, far below the 5 s concern line (it measured 4.3 s on the 1000-patient test stack).

## Not covered by the rehearsal

- The rehearsal dump is from 2026-11-02, before releases 2 and 3; prod has grown since. Re-take `counts.json` in step 2 and compare row counts with step 3's output.
- Sign-in with the real hosts under `next start` was not rehearsed: under `next dev` a company's own login form redirected to the academy host (Task 7). After release 5 provisions the canary, check by hand at `https://canary.imploid.net/login`: the address bar must stay on the canary host through the sign-in and the redirect after it, and `session-check` must list the canary's sessions under its own company id. If it jumps to `kaleidoscope.imploid.net`, stop and report.

## Open performance item: recall_list at scale

Measured once on the main local stack (1148 patients, 833 implants on 796 patients, 586 rows), in a rolled-back transaction as a bound academy admin with an aal2 session, 3 runs each:

| Case | recall_list() |
| --- | --- |
| (a) policies as they are (290 restrictive company/area policies) | 3.0 s (3.04, 3.04, 2.98) |
| (b) all restrictive policies dropped inside the transaction | 1.7 s (1.69, 1.68, 1.66) |
| Through PostgREST as the test organizer (bound session) | 7.9 s, against the 8 s `statement_timeout` of the `authenticated` role |
| Restored academy dump (34 patients, 104 rows), after 0095 | 41 to 46 ms |

`EXPLAIN ANALYZE`: the function is `cross join lateral implant_visits(p.id)`, one call per patient, each running several row-level-secured queries. One call takes about 8 ms cold; the whole list 3.0 s for 796 implant patients, so the cost is linear in patients with implants (about 3.8 ms each in a session, about 10 ms through PostgREST). The 34-patient dump is cheap because few of its patients have implants, so "80x for 34x" is not a scaling surprise.

Do the window migrations cause it? Partly. The restrictive company policies (0092) are about 1.3 s of the 3.0 s (43%); the rest is the per-patient design of `recall_list` / `implant_visits` (0046, 0048), unchanged by the window. No pre-window run on the same data exists (Task 9 saw 3.1 s before and 4.3 s after on the test stack). Nothing was optimised.

Threshold: investigate before any company passes about 400 patients with implants (half of the 8 s timeout at today's PostgREST cost). Academy is far below it. The local E2E stack is above it, which is why the `visits` E2E ("a missed visit shows ... recall list") fails there with `Could not load the recall list`; clean the leftover E2E patients, or raise the role timeout locally, to run it.

## Console E2E (local)

`npm run console:local` now builds the shape release 5 uses: the dev2 stack is the control project only (control migrations, no company schema; do not run `db:migrate` on it) and both companies are in the main stack: `dev` (localhost, academy) and `dev2` (tenant2.localhost, company `console-e2e`, created through `provision_company` and kept between runs). On 2026-11-06 all 7 `console.spec.ts` tests passed, including the first admin created in the console signing in on the company (0090 trigger, 0093, 0095, control 0005) and adding a company. To run: wipe dev2 (`npx supabase stop --no-backup --workdir .dev2`), `npm run db:dev2:start`, `npm run console:local`, then `set -a; source .env.console; set +a; npx playwright test console --project=chromium` with nothing on :3000.
