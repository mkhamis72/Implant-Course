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
     - `PROD_DATABASE_URL`: the session pooler URI.
     - `PROD_DATABASE_CA_CERT`: open `prod-ca.crt` in a text editor and paste the whole text, including the BEGIN/END lines.
     - `VERCEL_DEPLOY_HOOK_URL`.
     - `BACKUP_PASSPHRASE`: a long random passphrase. **Also store it in your password manager: without it, backups cannot be read.**
     - `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY`.
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
- **Reset a password:** run the same command again for that email.
- **Deactivate, or change role:** Admin → Users in the app. Delegate logins are deactivated there too.

### Turning on email verification

1. In Supabase → Authentication → SMTP Settings, enter the SMTP provider's host, port, user and password, and a sender address on your domain.
2. In Authentication → URL Configuration, set the Site URL to the production URL and add `https://<site>/auth/confirm` to the redirect URLs.
3. In Vercel → Settings → Environment Variables (Production), set `EMAIL_ENABLED=true` and redeploy.
4. Check it: create a login for a test address you own. The email should arrive, its link should open "Set a password", and the new user should reach the app.

## C. Releases

- Merging to `master` runs **Release**:
  1. typecheck, lint, unit tests and a production build;
  2. migrate production;
  3. deploy through the hook.
  A red run deploys nothing. Fix it and merge again, or re-run.
- If `master` moved on while a run was waiting, that run migrates but leaves the deploy to the newer run, so code never goes live before its own migration.
- Migrations must work with the previous app version for the few minutes until the new build is live. Add things; don't rename or drop in the same release.

## D. Backups and restore

**What a backup holds:** the data (not the schema) of the app tables plus Supabase's sign-in accounts (`auth` schema), encrypted. The schema comes from the migrations in this repo.

- **Backup** runs nightly. The artifacts `prod-backup-*` are kept 14 days.
- **Monthly:** Actions → Backup → Run workflow → mode `verify`. It must finish green with "Backup is readable and complete."

**Restore**, if production is lost or damaged.

You need:
- **GnuPG:** included in Git for Windows (Git Bash), or install Gpg4win;
- **PostgreSQL client tools** (`pg_restore`, `psql`) at least as new as the Supabase server, e.g. from the PostgreSQL Windows installer with "Command Line Tools" only.

Steps, in Git Bash from `web/`:
1. Download the newest `prod-backup-*` artifact and unzip it.
2. Decrypt it: `gpg --decrypt prod-<date>.dump.gpg > prod.dump`. It asks for the passphrase.
3. Create a new Supabase project (Frankfurt), with the same auth settings as §A.1, and make an env file for it, e.g. `.env.restore`. If the backup is older than the newest migrations, check out the commit the backup belongs to: the newest migration it has is the newest migration file at that date. Then run `ENV_FILE=.env.restore npm run db:migrate`.
4. Turn the dump into SQL: `pg_restore --data-only --no-owner -f data.sql prod.dump`.
5. Load it in one transaction, with triggers off so nothing is created twice. This is Supabase's documented restore method. The migrations seeded `settings` and the sample `products`, so empty those first:

   ```bash
   psql "<new session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET session_replication_role = replica" \
     -c "TRUNCATE public.settings, public.products CASCADE" \
     -f data.sql
   ```

6. Point Vercel's environment variables, the GitHub secrets and `web/.env.prod` at the new project, then re-run Release. Sign-in accounts come back with the data: everyone keeps their password and 2FA.

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
