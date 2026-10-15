# Operations

Production runs on Supabase (Frankfurt) and Vercel (functions in Frankfurt). Releases and backups run as GitHub Actions. Values marked ⟨secret⟩ go only into the place named, never into chats, tickets or code.

**Running scripts against production (Windows PowerShell, from `web/`):**

```powershell
$env:ENV_FILE = '.env.prod'; npm run create-user -- dr@example.com "Dr Name"; Remove-Item Env:ENV_FILE
```

Always end with `Remove-Item Env:ENV_FILE`: a leftover `ENV_FILE` would point every later script (even `npm run db:migrate`) at production. Every script prints `Target project: <host>` first — check it. In Git Bash the form is `ENV_FILE=.env.prod npm run …`, which applies to that one command only.

## A. First-time provisioning (admin, once)

1. **Supabase production project**
   - New project, region **Central EU (Frankfurt)**, Free plan. Store the database password in your password manager ⟨secret⟩.
   - Authentication:
     - **Sign In / Providers → Email:** Email on, **Allow new users to sign up: off**, **Confirm email: on**.
     - **Multi-Factor:** TOTP enabled.
     - **Passwords:** minimum length 10.
     - **Emails:** leave the optional security notifications (for example password-changed emails) **off** while there is no SMTP.
     - **URL Configuration:** Site URL = your Vercel production URL. Redirect URLs = `<vercel-url>/**`. Fill these in after step 3, once the URL exists.
   - Database settings → SSL: download the CA certificate and save it as `web/prod-ca.crt` (`*.crt` is git-ignored).
   - Connect → **Session pooler**: copy the URI ⟨secret⟩.
2. **Local production env file:** create `web/.env.prod`. Never call it `.env.production…`: Next.js loads those names automatically, so a local build would connect to production. The file holds:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
   - `SUPABASE_SERVICE_ROLE_KEY` ⟨secret⟩;
   - `DATABASE_URL` (session pooler) ⟨secret⟩;
   - `DATABASE_CA_CERT=prod-ca.crt`;
   - `ALLOW_TEST_FIXTURES=0`.
3. **Vercel**
   - Add New → Project → import the GitHub repo. **Root directory: `web`**, framework Next.js. The committed `web/vercel.json` already pins functions to Frankfurt (`fra1`) and turns off automatic deploys of `master`. The release workflow's deploy hook is the only way production deploys.
   - Settings → Environment Variables (**Production** only):
     - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
     - `SUPABASE_SERVICE_ROLE_KEY` ⟨secret⟩;
     - `SITE_URL=<vercel-url>`;
     - `EMAIL_ENABLED=false`, `NEXT_PUBLIC_PILOT=1`.
   - Settings → Git → **Deploy Hooks**: create a hook named `release` for branch `master`, then copy its URL ⟨secret⟩.
4. **GitHub** → repo → Settings → Environments → New environment **`production`**:
   - **Deployment branches and tags:** choose *Selected branches*, and add `master`. Only master's workflows can then read the production secrets.
   - Add these secrets:
     - `CONTROL_DATABASE_URL`: the control project's session pooler URI (§G). Release and Backup read every company from it.
     - `PROD_DATABASE_CA_CERT`: open `prod-ca.crt` in a text editor and paste the whole text, including the BEGIN/END lines.
     - `VERCEL_DEPLOY_HOOK_URL`.
     - `BACKUP_PASSPHRASE`: a long random passphrase. **Also store it in your password manager: without it, backups cannot be read.**
     - `CONTROL_SUPABASE_URL` and `CONTROL_ANON_KEY`.
     - `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: the off-site backup bucket (§D → Off-site copy). Without them, every Backup run turns red.
     - The three `CONTROL_*` secrets exist only once the control project does (step 5): add them to GitHub after creating it. `CONTROL_ANON_KEY` is the control project's anon/public key (Project Settings → API Keys).
5. **Control project and first company:** a release migrates only the control project and registered companies, so do §G first (it creates the `CONTROL_*` values that step 4 needs, so finish the three `CONTROL_*` secrets in step 4 after this one): create the control project, migrate it, and register the first company. Migrate that company directly before registering (`tenant:register` checks its schema): `ENV_FILE=.env.prod npm run db:migrate`.
6. **First release:** Actions → **Release** → Run workflow (branch `master`). It builds, migrates the control project and every company (already up to date), then deploys.
7. **First admin:** `npm run create-user -- you@example.com "Your Name" --role admin`, run with `ENV_FILE=.env.prod` as shown at the top. The first line must name the **production** project host.
8. **Smoke check** (section F), then the **first backup**: Actions → **Backup** → Run workflow, first with mode `backup`, then with mode `verify`.
9. **Restore rehearsal** (once, before go-live): follow section D into a scratch Supabase project, then delete that project.

## B. Accounts (no email during the pilot)

All commands are run with `ENV_FILE=.env.prod` (see the top of this page).

- **New staff login (admin or organizer):**
  - Use Admin → Users → **Create login**.
  - While `EMAIL_ENABLED=false`, the app shows a one-time temporary password. Hand it over in person; they change it under Account security.
  - With email on, the same form sends an invitation. Its link verifies the address and lets them set a password.
- **New delegate login:**
  - On the delegate's page (admin only), click **Create login**. The delegate needs an email address first.
  - A delegate login sees only **My schedule** and **My report**: their own surgery bookings, the talks of the courses they are enrolled in, and their own implants.
- **Organizer permissions:**
  - In Admin → Users → **Permissions** on an organizer's row, set **None / View / Edit** for each panel: Patients, Schedule, Courses, Checklists, Inventory, Delegates.
  - New organizers start with View everywhere.
  - The database enforces these permissions, not just the menus.
- **From the command line:**
  - Staff: `npm run create-user -- dr@example.com "Dr Name" [--role admin]`.
  - Delegate: `npm run create-user -- d@example.com "Dr Name" --role delegate --delegate <delegate id>`.
- **Reset a password** (lost, or never received): Admin → Users → **Reset password**, or **Reset password** in the Login section of a delegate's page. It shows a new one-time password to hand over, whether email is on or off. From the command line, run the same `create-user` command again for that email.
- **Deactivate, or change role:** Admin → Users in the app. Delegate logins are deactivated there too.
- **Delete** a user or delegate added by mistake: Admin → Users → **Delete user**, or **Delete delegate** on the delegate's page (this also deletes their login and course enrollments). Anyone with records — implants, stock, notes, checklist work, surgery bookings — can't be deleted: deactivate them, or set the delegate Inactive.

### Turning on email verification

1. In Supabase → Authentication → SMTP Settings, enter the SMTP provider's host, port, user and password, and a sender address on your domain.
2. In Authentication → Email Templates, point the links at the app's `/auth/confirm` route. The default `{{ .ConfirmationURL }}` link does not work with it.
   - **Invite user:** `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invitation and set your password</a>`
   - **Reset password:** the same link with `type=recovery`.
3. In Authentication → Sign In / Providers → Email, set **Email OTP Expiration** to `86400` so invitation links last 24 hours (the default is 1 hour).
4. In Authentication → URL Configuration, set the Site URL to the production URL and add `https://<site>/auth/confirm` to the redirect URLs.
5. In Vercel → Settings → Environment Variables (Production), set `EMAIL_ENABLED=true`, then redeploy: Actions → **Release** → Run workflow (branch `master`).
6. Check it: create a login for a test address you own. The email should arrive, its link should open "Set a password", and the new user should reach the app. If nothing arrives, look in Supabase → Logs → Auth for SMTP errors.

**Pilot: Gmail SMTP** (free, about 500 emails a day, may land in spam; switch to Resend on your domain before go-live, see `docs/go-live.md`):
- Use a **dedicated** Gmail account, not a personal one: its app password can read and send all of that account's mail.
- Turn on 2-Step Verification for it, then create an app password at https://myaccount.google.com/apppasswords ⟨secret⟩.
- SMTP settings: host `smtp.gmail.com`, port `465`, username and sender = the Gmail address, password = the app password without spaces.
- To turn email off again, set `EMAIL_ENABLED=false` and re-run Release: logins go back to temporary passwords.

### Checklist assignment emails

The app emails an organizer when a checklist item is assigned to them, and when the text or due date of an item assigned to them changes. Nothing is sent when you assign an item to yourself. These emails come from the app itself, not from Supabase Auth, so they need their own SMTP settings. They are off until `SMTP_HOST` is set, and also off while `EMAIL_ENABLED=false`.
1. Create a second app password for the same dedicated Gmail account at https://myaccount.google.com/apppasswords ⟨secret⟩. A separate one can be revoked without breaking invites.
2. In Vercel → Settings → Environment Variables (Production), add `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<the Gmail address>`, `SMTP_PASS=<the app password, no spaces>` (mark it Sensitive) and `SMTP_FROM=Implant Course <the Gmail address>`.
3. Re-run **Release** (branch `master`).
4. Check it: assign a checklist item to another organizer login whose mailbox you can read. If saving shows "Saved, but the email … couldn't be sent.", look in Vercel → Logs for `sendEmail failed`.

One sender serves every company; the email names the company. Locally the emails land in Mailpit (http://127.0.0.1:54324).

## C. Releases

- Merging to `master` runs **Release**:
  1. typecheck, lint, unit tests and a production build;
  2. migrate production;
  3. deploy through the hook.
  A red run deploys nothing. Fix it and merge again, or re-run.
- A release migrates the control project (`db:migrate -- --control`), then every registered company in slug order (`db:migrate -- --all-tenants`, suspended ones too), and deploys only if all succeeded. A failure stops the run before the deploy and names the company; fix it and re-run Release (companies already migrated are skipped as up to date).
- If `master` moved on while a run was waiting, that run migrates but leaves the deploy to the newer run, so code never goes live before its own migration.
- Migrations must work with the previous app version for the few minutes until the new build is live. Add things; don't rename or drop in the same release.

## D. Backups and restore

**What a backup holds:** the data (not the schema) of the app tables plus Supabase's sign-in accounts (`auth` schema), encrypted. The schema comes from the migrations in this repo.

- **Backup** runs nightly and writes one encrypted file per company, `<slug>-<date>.dump.gpg`, plus `_control-<date>.dump.gpg` (the company registry only), in the artifact `backups-*`, kept 14 days, and copies the same encrypted files to the Cloudflare R2 bucket under `<date>/<run id>/`, kept and locked for a year (see Off-site copy below). A failure for one company doesn't stop the others; the run turns red and ends with "Backup failed for: …". The run also pings every company and the control project to keep them awake; a failed ping doesn't stop the others and is named in "Keep-awake failed for: …". A failed off-site copy also turns the run red ("Off-site copy failed or did not run").
- **Monthly verify** runs on its own at 06:00 UTC on the 1st, after that night's backup; GitHub emails you if it fails (scheduled runs notify whoever last changed the workflow's schedule). Run it by hand any time: Actions → Backup → Run workflow → mode `verify`. It checks the newest artifact **and** the newest off-site set, and must finish green with "Every backup is readable and complete, in GitHub and off-site." It also accepts the older `prod-backup-*` artifacts for their remaining days. Verify decrypts with the GitHub secret, so it proves GitHub can read the backups, not that **you** can: keep `BACKUP_PASSPHRASE` in your password manager (it was lost once and replaced on 2026-10-08; backups made before that can't be read).
- **Restore rehearsal** (before go-live, then twice a year). There are no free Supabase slots for a scratch project, so use the local dev2 stack and wipe it afterwards. It holds patient data while you work, so never leave it.
  1. `npx supabase stop --workdir .dev2 --no-backup`, then `npm run db:dev2:start` and `ENV_FILE=.env.dev2 npm run db:migrate`.
  2. Download and decrypt the newest backup outside the repo (steps 1, 5 and 6 below). Run them with `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres …` after `docker cp`-ing `data.sql` in. If your local `pg_restore` is older than the backup's, run it through `docker run --rm -v <dir>:/work postgres:18 pg_restore …`.
  3. Compare the row count of every `COPY` block in `data.sql` with `select count(*)` of that table in dev2.
  4. `npx supabase stop --workdir .dev2 --no-backup`, delete the downloaded and decrypted files, then rebuild dev2 for the tests (`npm run db:dev2:start`, `ENV_FILE=.env.dev2 npm run db:migrate`, `npm run console:local`).

  Last rehearsal: 2026-10-08, backup run 37782802942. All 57 tables matched, all 5 accounts kept their passwords, and new writes continued the ID sequences.

**Off-site copy (Cloudflare R2).** GitHub keeps artifacts only 14 days, so every run also copies its encrypted files to an R2 bucket that keeps them a year and refuses deleting or overwriting them before then, even with the workflow's own key. The files are encrypted before they leave the runner; Cloudflare never sees patient data. Set it up once, before merging the workflow change (otherwise the nightly run turns red):
1. Cloudflare dashboard → **R2 Object Storage**. Enabling R2 asks for a payment method; the backups stay well inside the free 10 GB.
2. **Create bucket** `implant-course-backups`, location: **Specify jurisdiction → European Union**.
3. Bucket → Settings → **Bucket lock rules** → Add rule: all objects (no prefix), retain **365 days**.
4. Bucket → Settings → **Object lifecycle rules** → Add rule: all objects, delete after **366 days** (a day after the lock ends, so the lock never blocks it).
5. R2 → **Manage API tokens** → Create API token: permission **Object Read & Write**, applied to `implant-course-backups` only. Copy the Access Key ID, the Secret Access Key (shown once) and the S3 endpoint that matches the bucket's location (`https://<account id>.r2.cloudflarestorage.com`; an EU-jurisdiction bucket answers only on `https://<account id>.eu.r2.cloudflarestorage.com`). The production bucket (2026-10-15) uses the default location and endpoint.
6. GitHub → Environments → `production` → add the secrets `R2_ENDPOINT` (that endpoint), `R2_BUCKET` (`implant-course-backups`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Keep the Cloudflare login in your password manager: it is the way in if GitHub is lost.
7. Run Backup by hand, then Backup with mode `verify`: both copies must pass. In the bucket, try to delete one file: R2 must refuse it.

**Restore**, if a company's project or the control project is lost or damaged.

You need:
- **GnuPG:** included in Git for Windows (Git Bash), or install Gpg4win;
- **PostgreSQL client tools** (`pg_restore`, `psql`) at least as new as the `pg_dump` that made the backup. The Backup workflow installs the newest client (18 as of 2026-10), so use 18 or later, e.g. from the PostgreSQL Windows installer with "Command Line Tools" only. An older `pg_restore` stops with "unsupported version in file header".

**Restore one company** (the others are untouched). Steps, in Git Bash from `web/`:
1. Download the newest `backups-*` artifact and unzip it. If it has expired (14 days) or GitHub is unavailable, download the file from the R2 bucket instead: Cloudflare dashboard → R2 → `implant-course-backups` → the date and run folder → the company's file → Download. Then decrypt the company's file: `gpg --decrypt <slug>-<date>.dump.gpg > <slug>.dump`. It asks for the passphrase.
2. Create a new Supabase project (Frankfurt), with the same auth settings as §A.1.
3. Make an env file `.env.restore` with the new project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (session pooler) and `DATABASE_CA_CERT`, plus the `CONTROL_SUPABASE_URL` and `CONTROL_DATABASE_URL` lines copied from `.env.prod` (`tenant:register` reads the company from the first group and the control project from the second).
4. Apply the schema to the new project directly: `ENV_FILE=.env.restore npm run db:migrate`. If the backup is older than the newest migrations, check out the commit the backup belongs to first: the newest migration it has is the newest migration file at that date. Then `git checkout master` again before the next steps.
5. Turn the dump into SQL: `pg_restore --data-only --no-owner -f data.sql <slug>.dump`.
6. Load it in one transaction, with triggers off so nothing is created twice. This is Supabase's documented restore method. The migrations seeded `settings`, `branding` and the sample `products`, and auditing those seeds wrote `audit_log` rows, so empty those four first. Without `audit_log`, the load stops with `duplicate key value violates unique constraint "audit_log_pkey"`:

   ```bash
   psql "<new session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET session_replication_role = replica" \
     -c "TRUNCATE public.settings, public.products, public.branding, public.audit_log CASCADE" \
     -f data.sql
   ```

7. Repoint the company: `ENV_FILE=.env.restore npm run tenant:register -- <slug> "<Name>" <hosts…>`, with the same slug and hosts as before. This points the company at the new project and replaces its Vault secrets. The app picks up the re-registered project within its 10-minute routing cache (or right after the next deploy).
8. Check it: `ENV_FILE=.env.prod npm run tenant:check -- <slug>`. Sign-in accounts come back with the data: everyone keeps their password and 2FA.

`.env.restore` can be deleted afterwards: the control project now holds the new keys. If the restored company is the academy, update the academy values in `.env.prod` only if you still use them. Also update Vercel's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the new project: otherwise the documented rollback (removing the `CONTROL_*` variables, §G) would point at the dead project.

**Restore the control project:** create a fresh project; run `ENV_FILE=.env.prod npm run db:migrate -- --control` (with `CONTROL_*` pointing at it); load `_control-<date>.dump` the same way (no TRUNCATE needed). Read each company's slug, name and hosts with `select slug, name, hosts from public.tenants`. Re-run `tenant:register` for every company (Vault secrets aren't in the backup; use an env file with that company's keys, as in step 3 above), then `tenant:check -- <slug>` for each. Update `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` in Vercel and `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL` and `CONTROL_ANON_KEY` in GitHub; re-run Release.

**Free plan pause:** if the Supabase dashboard shows the project as paused, open it and choose **Restore project**. The nightly backup's requests normally prevent this.

## E. Keys and secrets

- To rotate a company's service role key or database password: change it in Supabase, then re-run `tenant:register` for that company (the control project's Vault holds them), then `tenant:check`. For a company other than the academy, `tenant:register` reads that company's values from an env file like `.env.restore` in §D step 3 (with the new key or password), not from `.env.prod`.
- To rotate the control project's keys or password: change it in Supabase, then update `web/.env.prod`, Vercel (`CONTROL_*`) and the GitHub secrets (`CONTROL_*`), then re-run Release.
- If a key was exposed, rotate it immediately, then check Supabase's auth logs.

## F. Smoke check after a release

1. Open the production URL. The pilot banner is visible.
2. Sign in as admin. The dashboard loads.
3. Create a test patient named "Pilot test …", add a checklist, and tick an item.
4. Browser dev tools → Network → reload: the page response has `content-security-policy` and `strict-transport-security` headers.
5. Catalog check: `npm run catalog-export` (with `ENV_FILE=.env.prod`), then compare the CSV with your supplier lists. Fix products in the app; untick **Sample** on each verified product, and deactivate products you don't stock.

## G. Control project (companies)

The app serves each company from its own Supabase project. Without `CONTROL_SUPABASE_URL` it serves one company (tenant `default`) from the `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` env vars, as before.

**Set up (once, owner):**
1. Create the project `implant-course-control` (Frankfurt). Create it in your existing Supabase organisation (the second Free slot; Free allows 2 active projects per account).
2. In `web/.env.prod` add `CONTROL_SUPABASE_URL` and `CONTROL_DATABASE_URL` ⟨secret⟩ (Session pooler). `CONTROL_SERVICE_ROLE_KEY` goes only in Vercel (no script reads it). The Supabase CA certificate is shared, so `DATABASE_CA_CERT` covers it; otherwise set `CONTROL_DATABASE_CA_CERT`.
3. Apply the control schema: `ENV_FILE=.env.prod npm run db:migrate -- --control`. The first line must read `Target project: control <ref>.supabase.co`. The control project's `tenant_audit` table is read-only even for the service-role key.

**Register a company** (its project's keys come from the loaded env file; for the academy that's `.env.prod`):

```bash
ENV_FILE=.env.prod npm run tenant:register -- academy "Implant Course Academy" implant-course.vercel.app
ENV_FILE=.env.prod npm run tenant:check -- academy        # → Target project: control <host>; company academy (active): OK
```

**GitHub secrets** (production environment): `CONTROL_DATABASE_URL` ⟨secret⟩ (session pooler URI of the control project), `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY` (control project → Project Settings → API Keys → anon/public). Release and Backup read every company from the control project with them. The old `PROD_DATABASE_URL`, `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY` were deleted on 2026-10-08, after the restore rehearsal. `PROD_DATABASE_CA_CERT`, `BACKUP_PASSPHRASE` and `VERCEL_DEPLOY_HOOK_URL` stay.

**Switching to per-company releases (once):**
1. Add `CONTROL_DATABASE_URL` ⟨secret⟩ (the control project's Session pooler URI), `CONTROL_SUPABASE_URL` and `CONTROL_ANON_KEY` (control project → Project Settings → API Keys → anon/public) to the GitHub `production` environment.
2. Rehearse locally: `ENV_FILE=.env.prod npm run db:migrate -- --all-tenants` must print `Target project: academy <ref>.supabase.co` and then `Database is up to date.`. This is exactly what the release will do. If it fails, fix it before merging (for example, the Vault `database_url` must be the Session pooler URI).
3. Merge.
4. Run **Backup**, then **Backup** with mode `verify`, by hand, and check the artifact holds `academy-…` and `_control-…` files.

**Scripts take `--tenant <slug>`:** `ENV_FILE=.env.prod npm run create-user -- --tenant academy you@example.com "Name"`, `npm run catalog-export -- --tenant academy`, `npm run db:migrate -- --tenant academy`. `.env.prod` then only needs `CONTROL_SUPABASE_URL`, `CONTROL_DATABASE_URL` and `DATABASE_CA_CERT`. Write it as `--tenant <slug>` (not `--tenant=<slug>`, not repeated); `--all-tenants` must be used on its own.

**Switch production to the control project:** in Vercel (Production) add `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩, then run Release. To roll back, remove both and run Release again. Right after a deploy the first request has no cache; if the control project takes over 3 s it gets a 503, so reload.

Unknown hosts get 404; a suspended company gets 503. If the control project is down, the app keeps routing from its last list for 10 minutes, then shows "Service unavailable".

**Console.** The super-admin console manages the companies from a browser, at its own address (`CONSOLE_HOST`): sign in with a console admin account (email and password) and an authenticator app. Idle sessions are signed out after 15 minutes. Company addresses never serve it (they return 404 for `/console`).

*Setting it up (once, after merging part 4):*
1. Control project → Authentication → Sign In / Providers: disable new sign-ups. Multi-Factor: enable TOTP. Authentication → Rate Limits: keep the MFA verification limits at their defaults or stricter. Do this **before** the next step, which exposes the console.
2. Vercel → Domains: add the console address to the project. Environment Variables (Production): `CONSOLE_HOST` = the host name only, for example `implant-console.vercel.app` (no `https://`, no path), `NEXT_PUBLIC_CONTROL_ANON_KEY` = the control project's anon key. Re-run Release.
3. Add `CONTROL_SUPABASE_URL` (already there) and `CONTROL_SERVICE_ROLE_KEY` to `.env.prod` just for this step, run `ENV_FILE=.env.prod npm run console:admin -- you@example.com` (it prints a temporary password), then remove the service key line again. Running it again for an existing admin sets a new temporary password and keeps their authenticators.
4. **Sign in straight away and set up 2FA.** Until you do, anyone who has the temporary password could enrol their own authenticator first. Then replace the temporary password under **Change password** (top bar) and check that the academy row shows OK.

*Lost authenticator:* control project → Authentication → Users → the user → delete the factor, run `console:admin` again for that email (new temporary password), sign in and set up 2FA at once.

*Using it:* the Companies page shows each company's health (a live check of its project) and counts. A company's page lets you suspend it (reason, and type the slug to confirm) and reactivate it, edit its name and addresses, replace its keys (checked before saving), and create its first admin login (a one-time password, shown once). **Add company** needs an existing, migrated project: the keys and database URL are checked before anything is saved, and an existing slug is refused. Every change, including creating or resetting a first admin login (the target email, never the password), is recorded in the company's History table with the admin's email. `tenant:register` / `tenant:check` still work and are recorded as `script`.

*Locally:* `npm run db:dev2:start`, `ENV_FILE=.env.dev2 npm run db:migrate`, `npm run console:local` (refuses non-local stacks; writes `.env.console`), then `set -a; source .env.console; set +a; npm run dev` and open `http://console.localhost:3000/console`. The console E2E (`npx playwright test console --project=chromium`, with the same env loaded and nothing on :3000) skips without `CONSOLE_HOST`; `npm run console:admin` is for real projects.
