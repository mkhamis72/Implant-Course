# Self-Auth switch-over: rehearsal, switch-over and rollback (history)

Moved out of `docs/operations.md` on 2026-11-15. The switch-over from Supabase Auth to Self-Auth was done in 2026-11, and the dev2 stack, the control project and the maintenance window it describes are gone. Kept as the record of how it was done; do not follow it as a runbook.

## Self-Auth rehearsal (before the switch-over)

> Historical (switch-over done 2026-11). It mentions the dev2 stack and the control project, both gone since the merge of control into production (release 3, §G).

A full run of the switch-over on copies of last night's prod and control data, on the local dev2 stack, ending with a simulated rollback. Nothing here touches a live database except the one read-only dump in step B1. The copies hold patient data and password hashes: never leave them, and wipe everything at the end (step D).

`self-auth:import` (`web/scripts/self-auth-import.ts`) is a dry run unless given `--apply`. It prints counts, the split plan, ids and masked emails (`s***@example.com`), never hashes or secrets. It stops before changing anything if it finds a user column it doesn't handle, a hash that isn't bcrypt, a user without an email, or an id that Self-Auth already holds for another company. Re-running it is safe.

You need two worktrees: the old app at the tag (`git worktree add ../ic-before restore/before-self-auth`, then `npm ci` in its `web/`) and this branch (`feat/self-auth`). Commands run in Git Bash from the worktree's `web/` that is named.

**A. App database (prod copy on dev2)**

1. Fresh dev2, schema as prod has it today. From `ic-before/web`: `npx supabase stop --workdir .dev2 --no-backup`, `npm run db:dev2:start`, `ENV_FILE=.env.dev2 npm run db:migrate` (stops at 0100).
2. Load last night's prod data as in §D *Restore a database* steps 1, 5 and 6, but into dev2: download the newest `backups-*` artifact, `gpg --decrypt <slug>-<date>.dump.gpg > prod.dump` (outside the repo), `pg_restore --data-only --no-owner -f data.sql prod.dump`, then `docker cp data.sql supabase_db_implant-course-dev2:/tmp/data.sql` and run step 6's command with `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -c "TRUNCATE <step 6's list> CASCADE" -f /tmp/data.sql`.
3. Note the counts the import must reproduce: `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres -c "select (select count(*) from auth.users where deleted_at is null) users, (select count(*) from auth.users where deleted_at is null and coalesce(encrypted_password,'') = '') invited, (select count(distinct user_id) from auth.mfa_factors where factor_type = 'totp' and status = 'verified') totp, (select count(*) from public.company_members) memberships"`. Expected today: 12 users, 2 invited, memberships ≥ 12.
4. Choose a rehearsal admin (an academy admin) and give them a known password and authenticator **on this copy only**, before the import, so both the new app and the rolled-back old app accept them. Make a secret with `node -e "console.log(require('otplib').authenticator.generateSecret())"` (from `web/`) and add it to your authenticator app by hand. Then:
   ```bash
   docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres -c "
     update auth.users set encrypted_password = extensions.crypt('<rehearsal password>', extensions.gen_salt('bf', 10)) where email = '<admin email>';
     update auth.mfa_factors set secret = '<secret>' where user_id = (select id from auth.users where email = '<admin email>') and factor_type = 'totp' and status = 'verified';"
   ```
   (If the admin has no factor, the update changes 0 rows and they'll enrol on first sign-in.)
5. Apply Migration A and 0102. dev2 was started from `ic-before`, whose config has no Self-Auth signing key, so its API would refuse the new app's database tokens ("Could not check your session"). Restart it from `feat/self-auth`'s `web/`, keeping the data: `npx supabase stop --workdir .dev2` (**without** `--no-backup`), then `npm run db:dev2:start`. That rewrites `.env.dev2` with new local API keys, so copy `SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK` and `SELF_AUTH_KID` from `.env.local` into `.env.dev2` after it. Then `ENV_FILE=.env.dev2 npm run db:migrate` (applies 0101 and 0102). Step 10 runs the old app on this same config, as prod keeps the key after a rollback.
6. Dry run: `ENV_FILE=.env.dev2 npm run self-auth:import -- --db app`. Check: "User columns found" with no stop; the users, invited and 2FA counts match step 3; "Accounts (one per membership)" equals the memberships count; every split line names the right person and companies.
7. Apply: `ENV_FILE=.env.dev2 npm run self-auth:import -- --db app --apply`. It must end with "Import complete." and "Check: N of N accounts in place". Run the dry run again: "already in Self-Auth" must equal the accounts count and every split must say `done`.
8. Click-through, new app. Next reads `.env.local`, not `ENV_FILE`, so in `feat/self-auth/web`: `cp .env.local .env.local.bak`, then `cp .env.dev2 .env.local` and delete any `CONTROL_*` line from it (single-company mode: localhost is the academy), then `npm run dev`. At http://localhost:3000 sign in as the rehearsal admin with the step 4 password and a code from the step 4 authenticator. Open Dashboard, Patients (one patient), Schedule, Courses, Inventory (one lot: the ledger's "by" names show), Checklists, Delegates, Admin → Users (invited users show as pending). Sign out. If a split person exists, sign in as them only if you know their password (don't reset a real user's password for this).
9. Undo the splits for the rollback (skip if step 6 listed none): `ENV_FILE=.env.dev2 npm run self-auth:import -- --db app --undo-splits` (dry run), then with `--apply`. Each split company's rows go back to the person's original id.
10. Simulated rollback. Stop the new app and `mv .env.local.bak .env.local` in `feat/self-auth/web`. In `ic-before/web`, copy the same rehearsal values to its `.env.local` (the Self-Auth lines are ignored there) and `npm run dev` (the old app at `restore/before-self-auth`, same database with Migration A applied). Sign in through Supabase Auth as the rehearsal admin, same password and authenticator. Open Patients, Schedule and Inventory; sign out and in again (session binding). A split person's other company must be reachable again (check `select company_id from public.company_members where user_id = '<their id>'` lists both). To sign in to that other company, give the old app one address per company: a `TENANTS_FILE` (outside the repo) listing academy on `academy.localhost` and the other company on `<slug>.localhost`, each with its company id and the dev2 URL and keys; add `TENANTS_FILE=<path>` to `ic-before/web/.env.local` and **restart** `npm run dev` (a running server keeps the old list). Never map a company to plain `localhost` here: after a sign-in, Next fetches the next page from `localhost` internally, so that company would refuse every other company's session ("You do not have access to this company"). Use a private window for the second company. To go forward again, re-run step 7: it splits again and skips the accounts already imported.

**B. Control database (control copy on dev2, after A)**

The nightly `_control-*` backup holds only the company registry (`tenants`, `tenant_audit`), not the console accounts, so take one encrypted read-only dump of them first.

1. Owner, read-only on the live control project: `pg_dump --data-only --format=custom --no-owner --table=auth.users --table=auth.mfa_factors --table=public.console_admins --table=public.tenants "<CONTROL_DATABASE_URL>" | gpg --symmetric --cipher-algo AES256 -o control-auth-<date>.dump.gpg`. Keep it with the backups; decrypt to `control.dump` outside the repo.
2. Rebuild dev2 as the control project: `npx supabase stop --workdir .dev2 --no-backup`, `npm run db:dev2:start`. Make `.env.rehearsal-control` with `CONTROL_DATABASE_URL` and `CONTROL_SUPABASE_URL` from `.env.dev2`'s `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`, plus `CONTROL_SELF_AUTH_SECRET` (any 32+ character value), `SELF_AUTH_PRIVATE_JWK` and `SELF_AUTH_KID` from `.env.local`.
3. From `ic-before/web`: `ENV_FILE=.env.rehearsal-control npm run db:migrate -- --control` (0001–0006). Load: `pg_restore --data-only --no-owner -f control.sql control.dump`, `docker cp control.sql supabase_db_implant-course-dev2:/tmp/control.sql`, `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -f /tmp/control.sql`.
4. From `feat/self-auth/web`: `ENV_FILE=.env.rehearsal-control npm run db:migrate -- --control` (0007), then `ENV_FILE=.env.rehearsal-control npm run self-auth:import -- --db control` (expect 1 user, 1 with 2FA), then with `--apply` (expect "Import complete.").
5. Optional sign-in check without the live authenticator: `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres -c "select u.\"realEmail\", (select count(*) from self_auth.totp_factor t where t.user_id = u.id and t.confirmed) totp, (select count(*) from self_auth.account a where a.\"userId\" = u.id and a.password like '\$2%') bcrypt from self_auth.\"user\" u"` must show the admin with totp 1 and bcrypt 1.

**C. Clean up:** `npx supabase stop --workdir .dev2 --no-backup`; delete `prod.dump`, `data.sql`, `control.dump`, `control.sql`, `ic-before/web/.env.local`, `.env.rehearsal-control` and the Self-Auth lines added to `.env.dev2`; `git worktree remove ../ic-before`. Rebuild dev2 for the console tests as in *Restore rehearsal* step 4.

**Results** (fill in on the day):

| Step | Expected | Result | Notes |
|---|---|---|---|
| A2 data load | no error | | backup run id: |
| A3 counts | 12 users, 2 invited, 2FA n, memberships m | | |
| A6 dry run | no stop; counts = A3; splits listed | | splits: |
| A7 apply | Import complete; N of N | | |
| A7 second dry run | all already in Self-Auth; splits done | | |
| A8 new app sign-in (password + TOTP) | dashboard | | |
| A8 click-through | every page loads, names show | | |
| A9 undo splits | rows moved back | | |
| A10 old app sign-in via Supabase | dashboard, pages load | | |
| A10 split person's companies | both on original id | | |
| B4 control dry run / apply | 1 user, 1 with 2FA; Import complete | | |
| B5 console admin | totp 1, bcrypt 1 | | |
| C cleanup | files and stack gone | | |

## E. Self-Auth switch-over (owner, about 1 hour, announced)

Merging `feat/self-auth` into `master` deploys the new sign-in, so maintenance goes on **first** and the merge is step 5. Do the *Self-Auth rehearsal* (§D) before the day. Announce the window a few days ahead ("sign-in unavailable for about an hour").

**What the release does by itself now:** before any migration, **Release** backs up every company database and the control project (schema and data, including the `auth` and `self_auth` sign-in schemas and the console admins), encrypted, as the artifact `pre-release-backups-<run id>-<attempt>` (14 days) and in R2 under `<date>/<run id>-<attempt>/` (a year). The files are named like the nightly ones (`<slug>-<date>.dump.gpg`, `_control-<date>.dump.gpg`). If the backup or its off-site copy fails, the run stops before migrating. **Migration B** (`0103_self_auth_b.sql`, control `0008_self_auth_b.sql`) is held: the run prints `Held: …` and skips it until the GitHub production variable `SELF_AUTH_B_HOLD` is `0` (see *After the window*).

**Before the day (once):**
- Make the switch-over env file `web/.env.switch` ⟨secret⟩ (git-ignored; delete it after the window): `CONTROL_SUPABASE_URL`, `CONTROL_DATABASE_URL`, `DATABASE_CA_CERT` (as in `.env.prod`); `DATABASE_URL` = the shared company database's **Session pooler** URI (the database academy is on), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` of that project; `CONTROL_ANON_KEY`; and the Self-Auth values below (`SELF_AUTH_SECRET`, `CONTROL_SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK`, `SELF_AUTH_KID`, `CONTROL_SELF_AUTH_PRIVATE_JWK`, `CONTROL_SELF_AUTH_KID`). Add `SELF_AUTH_DATABASE_URL` with exactly the value you give Vercel (below), so the `reach` check after step 5 tests that URL. The import refuses it if it points at another database than `DATABASE_URL`, and stops before changing anything. A Supabase project counts as one database however it is reached: the direct host `db.<ref>.supabase.co`, or the pooler with user `postgres.<ref>` on either port (session 5432, transaction 6543). Two different refs, or a pooler URL without the `.<ref>` in its user name, are refused.
- Make the secrets: `SELF_AUTH_SECRET` and `CONTROL_SELF_AUTH_SECRET`, two different 32+ character random values (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`); two signing keys, one per Supabase project (Supabase refuses a key id that another of your projects already has): run `npx supabase gen signing-key --algorithm ES256` twice, **in an empty folder** (it prints one JSON object with a `kid`; inside a Supabase project folder it may write a key file instead). The first object (one line) is `SELF_AUTH_PRIVATE_JWK` and its `kid` is `SELF_AUTH_KID` (company project); the second is `CONTROL_SELF_AUTH_PRIVATE_JWK` and `CONTROL_SELF_AUTH_KID` (control project, the console). `MAINTENANCE_BYPASS_TOKEN`: another 32+ character random value (shorter ones are ignored). Keep all of them in your password manager.

**Vercel environment variables (Production)** for the new app, all ⟨secret⟩ except `CONSOLE_HOST` and `MAINTENANCE`:

| Variable | Value |
|---|---|
| `SELF_AUTH_SECRET` | the company secret above |
| `CONTROL_SELF_AUTH_SECRET` | the console secret above |
| `SELF_AUTH_PRIVATE_JWK` | the company signing key, one-line JSON |
| `SELF_AUTH_KID` | its `kid` |
| `CONTROL_SELF_AUTH_PRIVATE_JWK` | the console signing key, one-line JSON |
| `CONTROL_SELF_AUTH_KID` | its `kid` |
| `SELF_AUTH_DATABASE_URL` | the shared company database's **Session pooler** URI (port 5432), user `postgres.<project ref>` (the **postgres** role: schema `self_auth` is revoked from `service_role`), **without** any `?sslmode=…` (TLS comes from the CA below) |
| `CONTROL_DATABASE_URL` | the control project's Session pooler URI, postgres role, **without** `?sslmode=…` (the console signs in against it; before Self-Auth it was in GitHub and `.env.prod` only) |
| `SELF_AUTH_DATABASE_CA_CERT` | the Supabase CA certificate (`prod-ca.crt`, Project Settings → Database → SSL; one root for both projects), as PEM text. Self-Auth verifies both database connections against it. A bare `?sslmode=require` fails: the current `pg` treats it as full verification against the system CAs, and Supabase's pooler chain ends in Supabase's own CA (`SELF_SIGNED_CERT_IN_CHAIN`, found at the switch-over) |
| `CONSOLE_HOST` | unchanged: `console.imploid.net` |
| `MAINTENANCE` | `1` during the window, then `0` |
| `MAINTENANCE_BYPASS_TOKEN` | the bypass token above |

The previous app ignores all of these, so setting them early changes nothing except `MAINTENANCE`.

**The day:**

1. **Backups.** Actions → Backup → Run workflow (mode `backup`), then mode `verify`; both green. Note the run id and the file names (`<slug>-<date>.dump.gpg`, `_control-<date>.dump.gpg`) in the log below. Then the console accounts, which the nightly control file only has since this release. Keep the URL off the command line and out of your shell history: put it in a one-line file `web/.env.control-dump` ⟨secret⟩ (git-ignored like every `.env*`), written in an editor as `CONTROL_DATABASE_URL='<the control Session pooler URI>'` (single quotes: the URI has `?` and `&`), then in Git Bash from `web/`:
   ```bash
   ( set -a; . ./.env.control-dump; set +a
     pg_dump --data-only --format=custom --no-owner --table=auth.users --table=auth.mfa_factors \
       --table=public.console_admins --table=public.tenants "$CONTROL_DATABASE_URL" ) \
     | gpg --symmetric --cipher-algo AES256 -o control-auth-<date>.dump.gpg
   rm .env.control-dump
   ```
   (as in the rehearsal, step B1). Note the file name too.
2. **Signing keys as standby keys.** Supabase imports only a **private** key (there is no public-key-only import) and refuses a key id another of your projects already has, so each project gets its own key. Company project: Project Settings → JWT Keys → create a standby key by importing an existing private key → paste `SELF_AUTH_PRIVATE_JWK`. Control project: the same with `CONTROL_SELF_AUTH_PRIVATE_JWK`. **Do not rotate**: the current key stays in use for the old app; a standby key is only used to check tokens. If the dashboard already made a standby key of its own, ⋯ → *Move to previously used* first (it never signs anything). `ENV_FILE=.env.switch npm run self-auth:keys -- jwks` (and `-- jwks --control`) prints each public key, to compare the `kid` with the dashboard.
3. **Check that Supabase accepts Self-Auth's tokens** (read-only; the databases have no `self_auth` tables yet, and this doesn't need them): `ENV_FILE=.env.switch npm run self-auth:keys -- check` must print `branding_for: 200, …`, and `ENV_FILE=.env.switch npm run self-auth:keys -- check --control` must print `is_console_admin: 200, …`. A `401` means that project's key isn't imported (or `SELF_AUTH_KID` / `CONTROL_SELF_AUTH_KID` doesn't match): fix it before going on. The token is signed locally for a made-up session and expires in 5 minutes; neither call changes data.
4. **Maintenance on.** Set the Vercel variables above with `MAINTENANCE=1`. The current production app (the old code) has no maintenance mode, so this takes effect when step 5 deploys the new app; until then maintenance is announced, not enforced. That is safe: the import (step 6) runs after the deploy, so it still picks up any Supabase Auth change made before it. Keep steps 4 and 5 close together. (No preview check: a preview of `feat/self-auth` would run the new code against the live, not yet migrated database. Step 7's smoke test, under maintenance, is the check.)
5. **Merge `feat/self-auth` into `master`.** The release takes its own backup (note `pre-release-backups-…` and the R2 folder from its log), runs Migration A (`0101`, `0102`, control `0007`), holds Migration B, and deploys the new app, still in maintenance. Its deploy hook builds **without** Vercel's build cache (`?buildCache=false`, documented by Vercel for deploy hooks): the vendored `@mkhamis72/self-auth` tarball (`web/vendor/`, 0.1.4) is a local file dependency, so a cached copy of an earlier build of it must not be reused. Check it in Vercel → the new deployment → Build Logs (no "Restored build cache" line). If it did use a cache, redeploy that deployment with "Use existing Build Cache" **off** before step 6.
   Then check Self-Auth reaches its tables over the URL Vercel uses (now that Migration A made them): `ENV_FILE=.env.switch npm run self-auth:keys -- reach` must print `Self-Auth database: reachable over SELF_AUTH_DATABASE_URL.` ("not migrated yet" means the release hasn't applied Migration A to this database; "unreachable (<code>)" means the URL, its role or its password is wrong: fix the URL in `.env.switch` and in Vercel).
6. **Import the accounts**, dry run first each time:
   ```bash
   ENV_FILE=.env.switch npm run self-auth:import -- --db control           # dry run: 1 user, 1 with 2FA (an inactive or banned console admin is listed as "disabled:" and imported disabled)
   ENV_FILE=.env.switch npm run self-auth:import -- --db control --apply   # "Import complete."
   ENV_FILE=.env.switch npm run self-auth:import -- --db app               # dry run: counts and splits as in the rehearsal
   ENV_FILE=.env.switch npm run self-auth:import -- --db app --apply       # "Import complete." and "Check: N of N"
   ```
   Owner decisions (2026-11-09): a person in two companies is split (the second company gets a new id); the split re-points that company's rows in one transaction, with the stock ledger's append-only trigger and the checklist-assignee check switched off for that update only. A deactivated membership is imported as a **disabled** account in that company (reactivate from Admin → Users). `audit_log` keeps the original ids.
7. **Smoke test with the bypass.** In your browser, on the company address, open dev tools → Console and run `document.cookie = "icm_maintenance_bypass=<token>; path=/; secure; samesite=lax"` (once per address: the company host and the console host each need it), then reload. Everyone else still sees "back soon". Check, each with 2FA:
   - an **admin** (academy): sign in with the old password and authenticator; Dashboard, Patients (open one), Schedule, Inventory (ledger names), Admin → Users (invited users pending);
   - a **delegate**: sign in, only their own pages;
   - a **console admin** at the console address: sign in with password and authenticator; Companies shows every company OK;
   - a **person in two companies** (if the import listed a split): signs in on each company's address with the same password and sees only that company;
   - a password reset email arrives at a mailbox you can read, and its link opens on the company's address;
   - sign out, sign in again; another company's address treats you as signed out.
   Delete the cookie afterwards (`document.cookie = "icm_maintenance_bypass=; path=/; max-age=0"`).
7a. **Close Supabase Auth** (still in maintenance), in **both** Supabase projects (the company project and the control project). No new backup is needed: the release backup from step 5, minutes earlier, already holds `auth.sessions` and every other `auth` table.
   - Dashboard → Authentication → **Sign In / Providers** (`https://supabase.com/dashboard/project/<ref>/auth/providers`) → **Email** → switch the Email provider **off** (the provider's enable toggle; at the time of writing it reads "Enable Email provider": check the label on the day) and **Save**. Supabase Auth then refuses email/password sign-in (and email links) for the old app and for anyone calling the Supabase Auth API directly. Leave "Allow new users to sign up" off as it is.
   - SQL editor (as postgres): `delete from auth.sessions;` Refresh tokens go with them (`auth.refresh_tokens.session_id` references `auth.sessions` with `on delete cascade`), so no Supabase session can be renewed. An access token Supabase already issued stays valid until it expires (the project's JWT expiry, 1 hour by default); nothing can renew it.
   - Note both in the log. Re-enable them only in a rollback (§F step 4a).
8. **Maintenance off.** Set `MAINTENANCE=0` in Vercel and redeploy the current deployment (Deployments → the current one → ⋯ → Redeploy, "Use existing Build Cache" **off**). Check a company address shows the sign-in page.
9. **Email the users** (BCC, from the usual sender):

   > Subject: Implant Course Manager: new sign-in system
   >
   > Hello,
   >
   > Today we moved Implant Course Manager to a new sign-in system. Sign in at your usual address with your usual email, password and authenticator app; nothing changes for you.
   >
   > If you work for more than one organisation in Implant Course Manager, sign in at each organisation's own address. Your password is the same for now; if you change it, change it at each address.
   >
   > If something doesn't work, use "Forgot password" on the sign-in page, or reply to this email.

**Log** (fill in on the day):

| Step | Value |
|---|---|
| 1 nightly backup run id, files | |
| 1 control accounts dump file | |
| 3 company / control token check | 200 / 200 |
| 5 build without cache; `reach` | |
| 5 release run id, `pre-release-backups-…`, R2 folder | |
| 6 control / app import counts, splits | |
| 7 smoke test (admin, delegate, console, split) | |
| 7a Email provider off + `auth.sessions` cleared (company / control) | |
| 8 maintenance off at | |

**After the window** (when you are sure there is no going back, normally a few days later):
1. Check nothing still points at a Supabase-only person. As postgres on the company database (SQL editor), this must return no rows:
   ```sql
   select 'profiles' t, user_id id from public.profiles p where not exists (select 1 from self_auth."user" u where u.id = p.user_id)
   union all select 'patients', created_by from public.patients x where created_by is not null and not exists (select 1 from self_auth."user" u where u.id = x.created_by);
   ```
   (Migration B checks every table and stops naming the counts if any remain.) A row is someone the import gave no account because they have no membership. Remove them the old way: `delete from auth.users where id = '<id>'` (Migration A's trigger deletes the profile and clears `created_by`), or, if they should keep access, give them a membership and re-run the import. On the control project, `select user_id from public.console_admins a where not exists (select 1 from self_auth."user" u where u.id = a.user_id)` must be empty.
2. Turn the hold off: GitHub → Settings → Environments → `production` → Environment variables → `SELF_AUTH_B_HOLD` = `0`. Then Actions → Release → Run workflow on `master`. It backs up, applies `0008_self_auth_b.sql` (control) and `0103_self_auth_b.sql` (each company database), and deploys. From now on the old app no longer works: §F no longer applies; restoring means the pre-release backup.
3. **Ban the old Supabase Auth users** in both projects, after Migration B is applied (SQL editor, as postgres): `update auth.users set banned_until = '2999-12-31' where banned_until is null or banned_until < '2999-12-31';` Ban, not delete: after Migration B nothing of the app references `auth.users` any more, but the rows are the record of who had Supabase accounts (their ids are the ids in `audit_log`), a ban is reversible, and a delete would also cascade into Supabase's own `auth.identities` and `auth.mfa_factors`. With the Email provider already off (§E step 7a) this is a second lock: a banned user can't get a Supabase session even if the provider were switched on again by mistake.
4. Remove what Supabase Auth used: in both Supabase projects, Authentication → turn off sign-ups and the custom SMTP (revoke its Resend key in Resend if it was a separate key); delete `.env.switch`. Keep the Self-Auth key imported in JWT Keys.

## F. Rollback after the switch-over (first hours only, before *After the window*)

Use it if the new sign-in fails in a way you can't fix quickly. Migration A kept every Supabase Auth table, trigger and helper working, so the old app runs on the migrated database unchanged.

**Use Redeploy, never Promote or Instant Rollback, anywhere in this section.** In Vercel, putting an *older* production deployment back on the domain (Promote of a deployment that already served production, or Instant Rollback) turns off auto-assignment of production domains. Every later production deployment, including the releases below, would then build but not be served. On Hobby, Instant Rollback also only reaches the immediately previous deployment. Redeploy instead makes a **new** production deployment of the old commit, with the current environment variables, and keeps auto-assignment on. (Vercel docs, checked 2026-11-09: [Instant Rollback](https://vercel.com/docs/instant-rollback): "After a rollback, Vercel turns off auto-assignment of production domains", and "Hobby users can roll back to the immediately previous deployment"; [Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment); [Managing deployments → Redeploy](https://vercel.com/docs/deployments/managing-deployments#redeploy-a-project).)

*If Promote or Instant Rollback was used by mistake:* the project overview's Production Deployment tile shows the rolled-back state and a **Manage** button. Click **Manage**, pick the **newest** production deployment and **Confirm**. That promotes it and turns auto-assignment back on (Vercel docs, *Undo a rollback*). Then do the step you meant to do with Redeploy.

*Serving check* (after every redeploy and release below): Vercel → Deployments, filter **Production**. The deployment marked **Current** must be the one you just made, and its commit SHA must be the commit you expect (`git log --oneline -1 <commit>`). The overview's Production Deployment tile must show no rolled-back state or **Manage** button. Then open a company address and check it shows the app you expect (the old sign-in page, the new one, or "We'll be back soon").

1. **Freeze releases.** Merge nothing into `master` until step 5's revert is merged: any release from the current `master` would redeploy the new app.
2. `MAINTENANCE=1` in Vercel, then Deployments → the current (new) deployment → ⋯ → **Redeploy**, "Use existing Build Cache" **off**, so nobody signs in or writes during the rollback. Serving check: the new deployment is Current and shows "We'll be back soon".
3. **Fresh backup before rewriting rows.** Actions → Backup → Run workflow, mode `backup`, must finish green. Note the run id and file names in the §E log.
4. Undo the splits so that people in two companies get both companies back on their Supabase id: `ENV_FILE=.env.switch npm run self-auth:import -- --db app --undo-splits` (dry run), then with `--apply`. The Self-Auth accounts stay.
4a. **Open Supabase Auth again**, in **both** Supabase projects, before the old app is back (§E step 7a undone): Dashboard → Authentication → **Sign In / Providers** → **Email** → switch the Email provider **on** and **Save**. Check that "Allow new users to sign up" is still off. The sessions deleted in step 7a stay gone: everyone signs in again in the old app.
5. **Put the old app back.**
   - Vercel → Deployments (Production) → the last production deployment **before** the merge (its commit is `master` just before the merge: `git log --first-parent master`) → ⋯ → **Redeploy**, "Use existing Build Cache" **off**. This builds the old app (Supabase Auth) again as a new production deployment. It ignores `MAINTENANCE`, so sign-in is open again once it is live. Serving check: the redeployed one is Current, with the pre-merge commit's SHA.
   - Revert the merge on `master` so the next release can't bring the new app back: `git revert -m 1 <merge commit>` on a branch, then a pull request into `master`, merged as usual. Its Release backs up, has nothing to migrate (the database keeps Migration A, which the old app works with; `schema_migrations` keeps the rows, so nothing is re-run later) and deploys `master`, now the old code, without build cache. Serving check: that deployment is Current, with the revert commit's SHA, and shows the old sign-in.
   - Do **not** try to undo Migration A: the old app needs nothing undone.
6. Sign in through Supabase Auth as an admin and check Patients, Schedule and Inventory; sign in on the console. Set `MAINTENANCE=0` (unused by the old app, but keep it honest for the next deploy of the new one).
7. Tell users: "We switched back to the previous sign-in. Anything you changed on your account since <time> (password, two-factor authentication, an accepted invitation) must be done again."
8. Know the edge case (Task 2 review): during the rollback window `mfa_setup_done` accepts a factor from **either** system. Someone whose 2FA an admin reset since the switch, and who enrolled a new authenticator in the new app, can clear "set up 2FA again" in the old app with that Self-Auth factor, while the old app's sign-in still checks their old Supabase factor. After a rollback, reset 2FA again in the old app for anyone reset since the switch (Admin → Users).

**Going forward again** (after the cause is fixed on a branch):
1. Announce a new window. §E step 1 (backups and the control accounts dump). The standby key from step 2 is still imported; run step 3's checks again.
2. `MAINTENANCE=1` in Vercel (takes effect with the next deploy, as in §E step 4).
3. Revert the revert: `git revert <revert commit>` on a branch (plus the fix), pull request into `master`, merge. Its Release backs up, applies anything new (Migration B stays held) and deploys the new app, in maintenance, without build cache. **Serving check** (see §F): that deployment is Current, with the new merge commit's SHA, and a company address shows "We'll be back soon". If it built but isn't Current, auto-assignment is off (a Promote or Instant Rollback happened): undo it as described in §F, promoting this newest deployment. Then `ENV_FILE=.env.switch npm run self-auth:keys -- reach`.
4. Import again, dry runs first: `--db control`, `--db control --apply`, `--db app`, `--db app --apply`. The splits are redone. Accounts already in Self-Auth are skipped, not updated: a password, 2FA or invite changed in the old app since the rollback is **not** carried over. The dry run's "already in Self-Auth" count shows who is affected. Accounts made in Self-Auth during the first window (invites, new logins) are not in Supabase Auth: the final check lists them as "made in Self-Auth only", which is expected, not a failure. Tell those people to use "Forgot password" (or reset their 2FA in Admin → Users).
5. §E steps 7 to 9: smoke test with the bypass; step 7a again (Email provider off and `delete from auth.sessions;` in both projects); then `MAINTENANCE=0` and Redeploy ("Use existing Build Cache" **off**) followed by the serving check (Current is that redeploy, and a company address shows the new sign-in page); then email the users.
