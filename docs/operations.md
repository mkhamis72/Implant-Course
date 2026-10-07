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
5. **First release:** Actions → **Release** → Run workflow (branch `master`). It builds, migrates the empty production database (0001…0022), then deploys.
6. **First admin:** `npm run create-user -- you@example.com "Your Name" --role admin`, run with `ENV_FILE=.env.prod` as shown at the top. The first line must name the **production** project host.
7. **Smoke check** (section F), then the **first backup**: Actions → **Backup** → Run workflow, first with mode `backup`, then with mode `verify`.
8. **Restore rehearsal** (once, before go-live): follow section D into a scratch Supabase project, then delete that project.

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

- **Backup** runs nightly and writes one encrypted file per company, `<slug>-<date>.dump.gpg`, plus `_control-<date>.dump.gpg` (the company registry only), in the artifact `backups-*`, kept 14 days. A failure for one company doesn't stop the others; the run turns red and ends with "Backup failed for: …". The run also pings every company and the control project to keep them awake; a failed ping doesn't stop the others and is named in "Keep-awake failed for: …".
- **Monthly:** Actions → Backup → Run workflow → mode `verify`. It must finish green with "Every backup is readable and complete." It also accepts the older `prod-backup-*` artifacts for their remaining days.

**Restore**, if a company's project or the control project is lost or damaged.

You need:
- **GnuPG:** included in Git for Windows (Git Bash), or install Gpg4win;
- **PostgreSQL client tools** (`pg_restore`, `psql`) at least as new as the Supabase server, e.g. from the PostgreSQL Windows installer with "Command Line Tools" only.

**Restore one company** (the others are untouched). Steps, in Git Bash from `web/`:
1. Download the newest `backups-*` artifact, unzip it, and decrypt the company's file: `gpg --decrypt <slug>-<date>.dump.gpg > <slug>.dump`. It asks for the passphrase.
2. Create a new Supabase project (Frankfurt), with the same auth settings as §A.1.
3. Re-register the company with the new project's URL, keys and database URL: `ENV_FILE=.env.prod npm run tenant:register -- <slug> "<Name>" <hosts…>`, with the new values in the env file it reads.
4. Apply the schema: `ENV_FILE=.env.prod npm run db:migrate -- --tenant <slug>`. If the backup is older than the newest migrations, check out the commit the backup belongs to first: the newest migration it has is the newest migration file at that date.
5. Turn the dump into SQL: `pg_restore --data-only --no-owner -f data.sql <slug>.dump`.
6. Load it in one transaction, with triggers off so nothing is created twice. This is Supabase's documented restore method. The migrations seeded `settings`, `branding` and the sample `products`, so empty those first:

   ```bash
   psql "<new session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET session_replication_role = replica" \
     -c "TRUNCATE public.settings, public.products, public.branding CASCADE" \
     -f data.sql
   ```

7. Check it: `ENV_FILE=.env.prod npm run tenant:check -- <slug>`. Sign-in accounts come back with the data: everyone keeps their password and 2FA.

**Restore the control project:** create a fresh project; run `ENV_FILE=.env.prod npm run db:migrate -- --control` (with `CONTROL_*` pointing at it); load `_control-<date>.dump` the same way (no TRUNCATE needed); re-run `tenant:register` for every company (Vault secrets aren't in the backup); update `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` in Vercel and `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL` and `CONTROL_ANON_KEY` in GitHub; re-run Release.

**Free plan pause:** if the Supabase dashboard shows the project as paused, open it and choose **Restore project**. The nightly backup's requests normally prevent this.

## E. Keys and secrets

- To rotate the service role key or the database password: change it in Supabase, then update `web/.env.prod`, Vercel's environment variables and the GitHub secrets, then re-run Release.
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

**GitHub secrets** (production environment): `CONTROL_DATABASE_URL` ⟨secret⟩ (session pooler URI of the control project), `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY`. Release and Backup read every company from the control project with them. `PROD_DATABASE_URL`, `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY` are no longer used by either and can be deleted after a restore rehearsal done this way. `PROD_DATABASE_CA_CERT`, `BACKUP_PASSPHRASE` and `VERCEL_DEPLOY_HOOK_URL` stay.

**Scripts take `--tenant <slug>`:** `ENV_FILE=.env.prod npm run create-user -- --tenant academy you@example.com "Name"`, `npm run catalog-export -- --tenant academy`, `npm run db:migrate -- --tenant academy`. `.env.prod` then only needs `CONTROL_SUPABASE_URL`, `CONTROL_DATABASE_URL` and `DATABASE_CA_CERT`. Write it as `--tenant <slug>` (not `--tenant=<slug>`, not repeated); `--all-tenants` must be used on its own.

**Switch production to the control project:** in Vercel (Production) add `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩, then run Release. To roll back, remove both and run Release again. Right after a deploy the first request has no cache; if the control project takes over 3 s it gets a 503, so reload.

Unknown hosts get 404; a suspended company gets 503. If the control project is down, the app keeps routing from its last list for 10 minutes, then shows "Service unavailable".
