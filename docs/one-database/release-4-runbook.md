# Release 4: the enforcement window

Owner steps, in order, from `web/` of the worktree (`cd "/d/Claude/Claude Code/implant-course-one-db/web"`) on the branch `one-db-release-4`. Production project `kshsgwvwqvufqdxcyvat`, company `academy` (id `a7c0de00-0000-4000-8000-000000000001`, host `kaleidoscope.imploid.net`). Expected length: one hour reserved, about 15 minutes of it work (the migrations themselves took 2 to 4 seconds in the rehearsals; the rest is the dump, the Release workflow and the Vercel deploy).

Release 4 applies migrations **0089 to 0095** (not 0089 to 0094): guards, company functions, company keys, forced policies, console first admin, company refs, `provision_company`. Prod must be at release 3 first (migrations through 0088, control `0004`). Every command that touches prod prints `Target project: <host>` first; stop if it is not the host you expect.

Commands below that read prod use `ENV_FILE=.env.prod` and `--tenant academy` (read from the control project). Put no secret on a command line.

## Before the window (days before)

1. Release 3 is live and its checklist (`release-3-checklist.md`) is done, including `session-check` PASS.
2. `git log one-db-release-4` is the code to ship; its CI-equivalent checks have passed (`./scripts/ship.sh verify`).
3. Switch the repo public (Vercel Hobby deploy), as for every release; private again afterwards.
4. Tell the academy users the window time. Suspended means they see "Service unavailable" (503).
5. Docker is not needed for the window itself. Have the dashboard open on the prod project: Authentication, Logs, Database advisors.

## The window

1. **Suspend academy in the console.** Console host, Companies, academy, Suspend (reason "release 4 window", type the slug). Wait up to 60 seconds for the host cache, then open `https://kaleidoscope.imploid.net` and confirm it shows 503. Nobody writes from now on.

2. **Pre-window dump** (the rollback point; a full `pg_dump` of every schema including `auth`):

   ```bash
   ENV_FILE=.env.prod npm run backup:pre-one-db -- --tenant academy --out "D:/Backups/implant-course/pre-window"
   ```

   Expected: files `full.dump`, `schema.dump`, `counts.json`, `settings.md` in `pre-window/academy`. Keep this directory; do not continue without it.

3. **Before checksums** (read-only; per table row count and per column md5, `company_id` excluded):

   ```bash
   ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out "D:/Backups/implant-course/pre-window/checksums-before.json"
   ```

   Expected: `Target project: <prod host>` then `N tables, M rows -> ...`.

4. **Ship release 4.** From the branch `one-db-release-4`:

   ```bash
   ./scripts/ship.sh ship
   ```

   Release migrates the control project, then every company (0089 to 0095 for academy, suspended companies included), then triggers the Vercel deploy. Wait for the run to turn green, then 1 to 3 minutes more for the build to go live. If the run fails at the academy migration, nothing was deployed: read the error, do not edit an applied migration, and use the rollback below if unsure. Migrations begin with `set local lock_timeout = '5s'`, so a lock wait fails fast instead of hanging.

5. **After checksums and compare:**

   ```bash
   ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out "D:/Backups/implant-course/pre-window/checksums-after.json"
   npm run window:checksums -- --compare "D:/Backups/implant-course/pre-window/checksums-before.json" "D:/Backups/implant-course/pre-window/checksums-after.json"
   ```

   Expected last line `PASS`, exit 0. Expected lines (rehearsal): `EXPECTED app_private.file_no_counters: table only after (0091)`, `EXPECTED app_private.schema_migrations` rows 88 to 95 and its two column hashes (the runner recording 0089 to 0095), and `REPORTED public.audit_log` (migrations write audit rows; auth session tables are reported the same way). Any `DIFFERENT` line is a failure: stop and roll back. The compare hashes only columns present on both sides, so new columns never matter; a table or column on one side only fails unless it is in `EXPECTED_SCHEMA_CHANGES` in `scripts/window-checksums.ts`, with the migration that makes it.

6. **Lift the suspension** in the console (Reactivate) now that the compare has passed (a suspended site answers 503, so it cannot be smoke-tested), wait up to 60 seconds, and reload the site. If anything below fails, suspend again and use the rollback.

7. **Session check and smoke test.**

   ```bash
   ENV_FILE=.env.prod npx tsx scripts/session-check.ts --tenant academy
   ```

   Expected `PASS` (after the smoke test at least one session is bound to academy; any other company id in the list prints `PROBLEM`). Smoke test on `https://kaleidoscope.imploid.net`:

   - Sign in with 2FA (this binds the session to the company).
   - Open a patient and its Implants tab.
   - Schedule: open a surgery day, make a booking and cancel it.
   - Inventory: stock page lists batches; open a receive form without saving.
   - Statistics: the results page loads with data.
   - Export: a Statistics export downloads.
   - Admin, Users lists the same people; a delegate login's `/my` shows the schedule.

8. **Advisors, afterwards.** Dashboard, Database, Advisors: Security and Performance. Compare with what the dashboard showed before; every new item that names `app.*`, `company_*` or the `*_area_*` / company policies needs a look. Expected new notices are Performance "unindexed foreign key" items on the composite `(company_id, ...)` keys at most; nothing may say a table has RLS disabled.

## Rollback

Use it when the compare fails, the Release stops after migrating academy, or the smoke test shows data from the wrong company.

1. Keep academy suspended.
2. **Redeploy the release 3 build in Vercel** (Deployments, the last production deployment before release 4, Redeploy). Do **not** revert on master and run Release for this: the restore below removes 0089 to 0095 from `app_private.schema_migrations`, so a Release would apply them again.
3. Restore the pre-window dump into the academy project following `D:/Backups/implant-course/pre-one-db/RESTORE.md`, section "Restore the whole academy project", with the files in `D:/Backups/implant-course/pre-window/academy`. That procedure has been proven only on local stacks (see the warning in that file); allow extra time and read it before the window.
4. Check: `ENV_FILE=.env.prod npm run window:checksums -- --tenant academy --out <file>` then `--compare` against `checksums-before.json` must PASS with no `EXPECTED` lines for 0091 or the migrations table.
5. Reactivate academy. Afterwards revert the release 4 merge on master (so the next Release does not migrate again) before any new release.

Migrations 0089 to 0095 are not backward compatible with the release 3 app (forced company policies, definers that need a bound session). Rolling back means going back to the dump, not just redeploying.

## Lint (local, before the window)

`npx supabase db lint` on the local stack (main stack up, migrated to 0095) reports 19 functions with warnings, none of them real. Nothing was changed for them; migrations 0089 to 0095 are untouched by lint.

| Warning | Functions | Reason it stays |
| --- | --- | --- |
| "marked as STABLE/IMMUTABLE, but expression is VOLATILE" at a `PERFORM` | 14: `finding_number`, `finding_choice`, `check_restoration_problem`, `check_technique`, `detail_date`, `complication_details`, `check_restoration_details`, `clean_items`, `admin_company`, `my_schedule`, `my_restorations`, `my_report`, `admin_user_history`, `analysis_codes` | The PERFORM is the permission/active-user guard (`require_perm`, `require_active`), which reads the session and may raise. Marking these VOLATILE would stop the planner caching them and is not needed. Pre-existing pattern of every reader; `admin_company` only gained a company lookup in 0090. |
| "target type is different type than source type" (text to uuid / array / enum) | `provision_company` (0095), `void_followup`, `create_surgery_slot`, `save_radiograph` | String-literal initialisers and `case ... 'restored'` results that Postgres casts implicitly; the check does not model the literal cast. No runtime effect (the DB tests exercise all four). |
| "unused parameter p_academy_if_unbound" | `app_private.admin_company` | Deliberate: kept so the release 3 callers still work. Task 11 (release 5 cleanup) removes it. |

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
- `recall_list()` scales with patient count: on the local test stack (about 1150 leftover E2E patients, 586 rows) it takes 3.4 s as a session user and 7.9 s through PostgREST, right at the 8 s `statement_timeout` of the `authenticated` role (it measured 41 ms on the restored academy dump). Production is nowhere near that size; watch the Recall list page in the smoke test and report it if it ever errors.
- The console E2E (`console.spec.ts`) cannot fully run on the local hybrid setup any more: `console:local` makes the dev2 stack both control project and a company database, and since 0088/0090 the company's `on_auth_user_created` trigger refuses the console admins' sign-ups there. With stub tables standing in for the company schema, 4 of its tests pass; "a first admin created in the console can sign in" and "adding a company" need a real company database separate from the control project.
