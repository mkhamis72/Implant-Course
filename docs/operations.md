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
   - Authentication: **Sign In / Providers → Email → Allow new users to sign up: off**. Nothing else there is used: the app signs people in with Self-Auth (its own tables in `self_auth`, its own emails), not Supabase Auth.
   - Project Settings → JWT Keys: import the private key of `SELF_AUTH_PRIVATE_JWK` (made with `npx supabase gen signing-key --algorithm ES256`, `web/.env.example`) as a **standby** key, so the database accepts the tokens Self-Auth signs; `npm run self-auth:keys -- check` then confirms the keys match.
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
     - `EMAIL_ENABLED=false`, `NEXT_PUBLIC_PILOT=1`;
     - Self-Auth: `SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK`, `SELF_AUTH_KID`, `SELF_AUTH_DATABASE_URL` (Session pooler), `SELF_AUTH_DATABASE_CA_CERT` ⟨secrets⟩;
     - later as needed: `SMTP_*` (*Email* below), `CONSOLE_HOST` and `VERCEL_*` (§G), `GOOGLE_*` (§F2). `web/.env.example` describes each.
   - Settings → Git → **Deploy Hooks**: create a hook named `release` for branch `master`, then copy its URL ⟨secret⟩.
4. **GitHub** → repo → Settings → Environments → New environment **`production`**:
   - **Deployment branches and tags:** choose *Selected branches*, and add `master`. Only master's workflows can then read the production secrets.
   - Add these secrets:
     - `PROD_DATABASE_URL`: the production project's **Session pooler** URI ⟨secret⟩. Release migrates and backs up through it; Backup dumps and exports from it.
     - `PROD_DATABASE_CA_CERT`: open `prod-ca.crt` in a text editor and paste the whole text, including the BEGIN/END lines.
     - `VERCEL_DEPLOY_HOOK_URL`.
     - `BACKUP_PASSPHRASE`: a long random passphrase. **Also store it in your password manager: without it, backups cannot be read.**
     - `PROD_SUPABASE_URL` and `PROD_ANON_KEY` (Project Settings → API Keys → anon/public): the nightly keep-awake ping.
     - `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: the off-site backup bucket (§D → Off-site copy). Without them, every Backup run turns red.
5. **First company:** migrate the project directly (`ENV_FILE=.env.prod npm run db:migrate`): the migrations create the academy company. Give it its address in the Supabase SQL editor: `update public.companies set hosts = '{<host>}' where slug = 'academy';`.
6. **First release:** Actions → **Release** → Run workflow (branch `master`). It builds, backs up and migrates the production database (already up to date), then deploys.
7. **First admin:** `npm run create-user -- you@example.com "Your Name" --role admin`, run with `ENV_FILE=.env.prod` as shown at the top. The first line must name the **production** project host.
8. **Smoke check** (section I), then the **first backup**: Actions → **Backup** → Run workflow, first with mode `backup`, then with mode `verify`.
9. **Restore rehearsal** (once, before go-live): follow section D into a scratch Supabase project, then delete that project.

## B. Accounts (no email during the pilot)

All commands are run with `ENV_FILE=.env.prod` (see the top of this page).

- **New staff login (admin or organizer):**
  - Use Admin → Users → **Create login**.
  - While `EMAIL_ENABLED=false`, the app shows a one-time temporary password. Hand it over in person; they change it themselves under Account security → **Password** (current password = the one-time password, then the new one twice). Changing it signs out their other devices; it works with email on or off.
  - With email on, the same form sends an invitation. Its link verifies the address and lets them set a password.
- **New delegate login:**
  - On the delegate's page (admin only), click **Create login**. The delegate needs an email address first.
  - A delegate login sees only **My schedule** and **My report**: their own surgery bookings, the talks of the courses they are enrolled in, and their own implants.
- **Organizer permissions:**
  - In Admin → Users → **Permissions** on an organizer's row, set **None / View / Edit** for each panel: Patients, Schedule, Courses, Checklists, Inventory, Delegates, Research (Edit adds and edits studies).
  - New organizers start with View everywhere.
  - The database enforces these permissions, not just the menus.
- **From the command line:**
  - Staff: `npm run create-user -- dr@example.com "Dr Name" [--role admin]`.
  - Delegate: `npm run create-user -- d@example.com "Dr Name" --role delegate --delegate <delegate id>`.
- **Reset a password** (lost, or never received): Admin → Users → **Reset password**, or **Reset password** in the Login section of a delegate's page. With email on, it emails the user a reset link (the admin sees "couldn't be sent" if the mail fails, never "sent"); with email off, it shows a new one-time password to hand over once and signs them out everywhere. Anyone signed in can change their own password under Account security → **Password**; **Forgot your password?** there (email on only) emails them a reset link. From the command line, run the same `create-user` command again for that email.
- **Change a sign-in email** (typo, new address): Admin → Users → **Change email** on the user's row. It changes the sign-in address and the app record together (and the linked delegate's email), signs them out everywhere, and emails a notice (no link) to the new address, and to the old one if they have signed in before. Don't edit `self_auth."user"` or `profiles` in the Supabase dashboard: the two would disagree. You can't change your own here; use Account → Security.
- **Lost authenticator (company users):** Admin → Users → **Reset 2FA** (shown only when the user has one). It removes their authenticator and signs them out everywhere; at their next sign-in they must set up a new one before the app (or the database) lets them do anything else.
- **Invite never arrived:** Admin → Users → **Resend invite**, shown while email is on and the user has never signed in. Each row's **History** lists the last email, name and 2FA changes made by admins.
- **Deactivate, or change role:** Admin → Users in the app. Delegate logins are deactivated there too.
- **Delete** a user or delegate added by mistake: Admin → Users → **Delete user**, or **Delete delegate** on the delegate's page (this also deletes their login and course enrollments). Anyone with records — implants, stock, notes, checklist work, surgery bookings — can't be deleted: deactivate them, or set the delegate Inactive.

### Email

Every email comes from the app itself through one SMTP account (`sendEmail`, `web/src/lib/email/send.ts`): Self-Auth invitations and password resets, the change-of-email notice, and checklist notices. Supabase's own Auth SMTP and email templates are not used. Links go to the company's own address (`/auth/invite`, `/auth/reset`; the console's to `CONSOLE_HOST`).

**Turn it on (or check it):**
1. In Vercel → Settings → Environment Variables (Production), set `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend` (the word `resend`, not an email address), `SMTP_PASS=<the Resend API key>` (mark it Sensitive), `SMTP_FROM=Implant Course Academy <noreply@imploid.net>`, and `EMAIL_ENABLED=true`.
2. Re-run **Release** (branch `master`) so the new values reach the app.
3. Check it: Admin → Users → **Resend invite** (or **Create login** for a test address you own). "Invitation sent again to …" means the mail service accepted it. A failed send shows an error to the admin and is written to Console → Errors (Resend `535 Invalid username` means `SMTP_USER` is wrong).

Unset `SMTP_HOST` sends nothing. `EMAIL_ENABLED=false` turns invites and the reset links off: Create login and Reset password then show a one-time password to hand over instead.

**Checklist notices:** an organizer gets an email when a checklist item is assigned to them, and when the text or due date of an item assigned to them changes; nothing is sent when you assign an item to yourself. If saving shows "Saved, but the email … couldn't be sent.", see Console → Errors.

**Resend on imploid.net** (since 2026-10-17; free plan: 100 emails a day, 3,000 a month):
- Resend → Domains: `imploid.net`, region EU (Ireland). Its records are at GoDaddy (imploid.net → DNS): TXT `resend._domainkey` (DKIM) and CNAME `send` (bounce MX and SPF). Keep one `_dmarc` TXT record. Copy values from Resend: the DKIM key is different in every Resend account.
- API key: Resend → API Keys, **Sending access**, domain `imploid.net` ⟨secret⟩. Type it straight into Vercel.
- Resend → Emails shows whether each email was delivered.

One sender serves every company; the email names the company. Locally the emails land in Mailpit (http://127.0.0.1:54324).

## C. Releases

- Merging to `master` runs **Release**:
  1. typecheck, lint, unit tests and a production build;
  2. back up the production database (schema and data, every company, the console and sign-in accounts; artifact `pre-release-backups-*` and R2), and stop if that fails;
  3. migrate production;
  4. deploy through the hook.
  A red run deploys nothing. Fix it and merge again, or re-run.
- A release migrates the one production database (`npm run db:migrate` with `PROD_DATABASE_URL`) and deploys only if it succeeded. A failure stops the run before the deploy; fix it and re-run Release (applied migrations are skipped).
- If `master` moved on while a run was waiting, that run migrates but leaves the deploy to the newer run, so code never goes live before its own migration.
- Migrations must work with the previous app version for the few minutes until the new build is live. Add things; don't rename or drop in the same release.

## D. Backups and restore

**What a backup holds:** the data (not the schema) of the app tables plus the sign-in accounts (`self_auth`, and Supabase Auth's `auth` schema, unused since the Self-Auth switch-over), encrypted. The schema comes from the migrations in this repo. One database holds every company and the console, so a backup has two kinds of file: the **whole-database dump** (`prod-<date>.dump.gpg`) and, for every company, its **own export** (`company-export`: that company's rows and its members' accounts as JSON, restorable alone). Sets from before the merge of control (2026-11-14) instead have one whole-database file named after the first company (`<slug>-<date>.dump.gpg`) and a `_control-<date>.dump.gpg` registry file.

- **Backup** runs nightly and writes `prod-<date>.dump.gpg` (the whole database) and, for each company in `public.companies`, `<slug>-<date>.company.dump.gpg` (the company's own JSON export; the `.dump` in the name only keeps it inside the artifact and off-site globs), in the artifact `backups-*`, kept 14 days, and copies the same encrypted files to the Cloudflare R2 bucket under `<date>/<run id>/`, kept and locked for a year (see Off-site copy below). A failure for one company doesn't stop the others; the run turns red and ends with "Backup failed for: …". The run also pings the project to keep it awake ("Keep-awake failed for: production" if not). A failed off-site copy also turns the run red ("Off-site copy failed or did not run").
- **Monthly verify** runs on its own at 06:00 UTC on the 1st, after that night's backup; GitHub emails you if it fails (scheduled runs notify whoever last changed the workflow's schedule). Run it by hand any time: Actions → Backup → Run workflow → mode `verify`. It checks the newest artifact **and** the newest off-site set, and must finish green with "Every backup is readable and complete, in GitHub and off-site." It also accepts the older `prod-backup-*` artifacts for their remaining days. Verify decrypts with the GitHub secret, so it proves GitHub can read the backups, not that **you** can: keep `BACKUP_PASSPHRASE` in your password manager (it was lost once and replaced on 2026-10-08; backups made before that can't be read).
- **Restore rehearsal** (before go-live, then twice a year). There are no free Supabase slots for a scratch project, so use the local stack and wipe it afterwards (your local test data goes with it). It holds patient data while you work, so never leave it.
  1. `npx supabase stop --no-backup`, then `npm run db:start` and `npm run db:migrate`.
  2. Download and decrypt the newest backup outside the repo (steps 1, 5 and 6 below). Run them with `docker exec supabase_db_implant-course psql -U postgres -d postgres …` after `docker cp`-ing `data.sql` in. If your local `pg_restore` is older than the backup's, run it through `docker run --rm -v <dir>:/work postgres:18 pg_restore …`.
  3. Compare the row count of every `COPY` block in `data.sql` with `select count(*)` of that table on the local stack.
  4. `npx supabase stop --no-backup`, delete the downloaded and decrypted files, then rebuild the local stack: `npm run db:start`, `npm run db:migrate` (it adds the local companies), and the test users with the next E2E run.

  Last rehearsal: 2026-10-08, backup run 37782802942. All 57 tables matched, all 5 accounts kept their passwords, and new writes continued the ID sequences.

**Off-site copy (Cloudflare R2).** GitHub keeps artifacts only 14 days, so every run also copies its encrypted files to an R2 bucket that keeps them a year and refuses deleting or overwriting them before then, even with the workflow's own key. The files are encrypted before they leave the runner; Cloudflare never sees patient data. Set it up once, before merging the workflow change (otherwise the nightly run turns red):
1. Cloudflare dashboard → **R2 Object Storage**. Enabling R2 asks for a payment method; the backups stay well inside the free 10 GB.
2. **Create bucket** `implant-course-backups`, location: **Specify jurisdiction → European Union**.
3. Bucket → Settings → **Bucket lock rules** → Add rule: all objects (no prefix), retain **365 days**.
4. Bucket → Settings → **Object lifecycle rules** → Add rule: all objects, delete after **366 days** (a day after the lock ends, so the lock never blocks it).
5. R2 → **Manage API tokens** → Create API token: permission **Object Read & Write**, applied to `implant-course-backups` only. Copy the Access Key ID, the Secret Access Key (shown once) and the S3 endpoint that matches the bucket's location (`https://<account id>.r2.cloudflarestorage.com`; an EU-jurisdiction bucket answers only on `https://<account id>.eu.r2.cloudflarestorage.com`). The production bucket (2026-10-15) uses the default location and endpoint.
6. GitHub → Environments → `production` → add the secrets `R2_ENDPOINT` (that endpoint), `R2_BUCKET` (`implant-course-backups`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Keep the Cloudflare login in your password manager: it is the way in if GitHub is lost.
7. Run Backup by hand, then Backup with mode `verify`: both copies must pass. In the bucket, try to delete one file: R2 must refuse it.


**Restore a whole database**, if the production project is lost or damaged. For one company inside a healthy database use **Restore one company's data** below instead.

You need:
- **GnuPG:** included in Git for Windows (Git Bash), or install Gpg4win;
- **PostgreSQL client tools** (`pg_restore`, `psql`) at least as new as the `pg_dump` that made the backup. The Backup workflow installs the newest client (18 as of 2026-10), so use 18 or later, e.g. from the PostgreSQL Windows installer with "Command Line Tools" only. An older `pg_restore` stops with "unsupported version in file header".

**Restore a database** (every company in it comes back). Steps, in Git Bash from `web/`.

*Which set.* There are two kinds; pick the newest set taken **before** the damage:
- **Nightly** (Backup): artifact `backups-<run id>`, R2 folder `<date>/<run id>/`. **Data only**, and it has the per-company `*.company.dump.gpg` exports.
- **Pre-release** (Release, since the Self-Auth switch-over): artifact `pre-release-backups-<run id>-<attempt>`, R2 folder `<date>/<run id>-<attempt>/` (the `-<attempt>` suffix tells them apart). **Schema and data** of `public`, `app_private`, `app`, `auth`, `self_auth`, taken just before that release's migrations. It has no company exports. Use it to get back to the moment before a release.

The newest R2 folder can be either kind (the monthly verify checks whichever is newest). The steps below are the same for both: step 5's `pg_restore --data-only` takes only the data, also from a schema-and-data file, and step 4 builds the schema from the migrations. For a pre-release set, check out the commit **before** that release in step 4 (`git log --first-parent master`: the commit before the release's merge), because its schema is from before the release's migrations. If the set was taken after Migration B ran (after *After the window* in §E), run step 4 with `SELF_AUTH_B_HOLD=0`, or `db:migrate` skips 0103 and the schema won't match.

1. Download the newest suitable artifact (`backups-*`, or `pre-release-backups-*` as above) and unzip it. If it has expired (14 days) or GitHub is unavailable, download the file from the R2 bucket instead: Cloudflare dashboard → R2 → `implant-course-backups` → the date and run folder → the company's file → Download. Then decrypt the whole-database file: `gpg --decrypt prod-<date>.dump.gpg > prod.dump` (older sets: `<slug>-<date>.dump.gpg`). It asks for the passphrase.
2. Create a new Supabase project (Frankfurt), with the same auth settings as §A.1.
3. Make an env file `.env.restore` with the new project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (session pooler) and `DATABASE_CA_CERT`.
4. Apply the schema to the new project directly: `ENV_FILE=.env.restore npm run db:migrate`. If the backup is older than the newest migrations, check out the commit the backup belongs to first: the newest migration it has is the newest migration file at that date. Then `git checkout master` again before the next steps.
5. Turn the dump into SQL: `pg_restore --data-only --no-owner -f data.sql prod.dump`.
6. **Fresh project only.** The TRUNCATE below (with `companies … CASCADE`) is for a brand-new project and wipes every company in it, which is what a whole-database restore wants; never run it on a database that is in use. Load it in one transaction, with triggers off so nothing is created twice. This is Supabase's documented restore method. The migrations seeded `settings`, `branding`, the sample `products`, the consent form `consent_form_versions` (0072), the company list `companies` (0083) and the academy memberships `company_members` (0085) and academy's file number counter `app_private.file_no_counters` (0091), the Full plan `plans` (0109) and the catalogue library `catalog_items` (0128), and auditing those seeds wrote `audit_log` rows, so empty those ten first. Without `audit_log`, the load stops with `duplicate key value violates unique constraint "audit_log_pkey"`:

   ```bash
   psql "<new session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET session_replication_role = replica" \
     -c "TRUNCATE public.settings, public.products, public.branding, public.consent_form_versions, public.companies, public.company_members, app_private.file_no_counters, public.plans, public.catalog_items, public.audit_log CASCADE" \
     -f data.sql
   ```

7. Point the app at the new project: in Vercel (Production) set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and `SELF_AUTH_DATABASE_URL` to the new project's values and redeploy; in GitHub `production` update `PROD_DATABASE_URL`, `PROD_SUPABASE_URL` and `PROD_ANON_KEY`; replace the values in `web/.env.prod`. Import the Self-Auth signing key into the new project as a standby key (Project Settings → JWT Keys, §E).
8. Check it: open every company address and the console. The companies, their addresses and the console admins come back with the data (`public.companies`, `public.console_users`); sign-in accounts too: everyone keeps their password and 2FA.

`.env.restore` can be deleted afterwards.

**Restore one company's data** (a mistake or damage in one company; the other companies in the database are untouched). Needs the company's own export `<slug>-<date>.company.dump.gpg` from the artifact or R2.
1. Decrypt it outside the repo: `gpg --decrypt <slug>-<date>.company.dump.gpg > <slug>.json`. The file holds password hashes and patient data: treat it like a database dump and delete it afterwards.
2. **Suspend the company** in the console (Companies, the company, Suspend; type the slug), wait up to 60 seconds for the host cache and confirm its site shows 503. The restore deletes the company's rows and loads the file's rows back: anything the company's users write meanwhile would be interleaved with that and lost. Other companies keep working.
3. Take a fresh export of the company, so the restore can itself be undone: `ENV_FILE=.env.prod npm run company:export -- --company <slug> --out before-<slug>.json`.
4. `ENV_FILE=.env.prod npm run company:restore -- --company <slug> --in <slug>.json`. It refuses a file whose company id is not the company's, or with a row that carries another company's id, or a table list that differs from the database's. In one transaction it deletes that company's rows (company tables in reverse foreign-key order, including its `company_members`) and loads the file's rows back. The company's sign-in accounts (Self-Auth users, passwords, Google links, authenticators; exports from 2026-11-16 on) and its members' profiles are only inserted when missing, never changed or deleted: a person whose account was deleted gets it back, and a password changed since the export stays as it is now. Older exports (`company-export-v1`) have no accounts and still restore. Triggers are off during the load (`session_replication_role = replica`; if the database role may not set it, the restore stops before changing anything), so audit rows and the stock ledger come back exactly as exported. The foreign keys of the restored rows are then checked and any failure rolls everything back. A log is written next to the file (`<file>.restore.log`).
5. **Lift the suspension** in the console (Reactivate), wait up to 60 seconds, then check the company in the app (patients, stock on hand). If it is wrong, suspend again and restore `before-<slug>.json` the same way. Delete the downloaded and decrypted files.

**Delete one company's data** (a data-protection request, or after a company leaves). Irreversible: export first and keep that file encrypted until the request is settled.

1. **Suspend the company** in the console and wait up to 60 seconds (its site shows 503), so nobody writes while it is erased. Note its id: `select id from public.companies where slug = '<slug>';`.
2. `ENV_FILE=.env.prod npm run company:export -- --company <slug> --out erase-<slug>.json` (the people are in its `public.company_members` table).
3. `ENV_FILE=.env.prod npm run company:restore -- --company <slug> --delete` removes every company-table row of the company (the same transaction, triggers and checks as a restore, with nothing reloaded). The company row and its people's sign-in accounts stay.
4. Remove the people and the company row. Self-Auth accounts belong to one company each (`self_auth."user"."companyId"`; a person in two companies has two accounts), so this removes only this company's people. Deleting an account also deletes its sessions, password, Google link and authenticator (cascade) and its `profiles` row (trigger). Sign-in bindings and unused invitations reference the company, so they go before it; the company's audit trigger would log its own deletion under the deleted company (`audit_log_company_id_fkey`), so it is off for that one statement (foreign keys stay checked). Supabase SQL editor (postgres), in one transaction, with the id from step 1 in all five places:

   ```sql
   begin;
   delete from self_auth."user" where "companyId" = '<company id>';
   delete from app.session_companies where company_id = '<company id>';
   delete from app_private.pending_logins where company_id = '<company id>';
   alter table public.companies disable trigger companies_audit;
   delete from public.companies where id = '<company id>';
   alter table public.companies enable trigger companies_audit;
   commit;
   ```

   If any statement fails, the transaction is rolled back and nothing changes; do not retry pieces of it. Rehearsed (steps 3 and 4, rolled back) on the local stack, 2026-11-15: no row referencing the company was left, and other companies' accounts and profiles were unchanged. The console's change log keeps its earlier entries for the company (it has no link to the company row).
5. Its addresses went with the company row (the hosts now give 404). Remove the domain from the `implant-course` Vercel project (Settings, Domains) so it no longer gets a certificate, and delete `erase-<slug>.json` once the request is closed. Nightly backups still hold the company's data until the 14-day artifacts expire and the year-long R2 copies are deleted by their lifecycle rule; say so in the reply to the data subject.

**Rebuild an erased company** (a company deleted by mistake, or one that comes back). Needs an export of it from 2026-11-16 on (`erase-<slug>.json` from step 2 above, or its nightly `<slug>-<date>.company.dump.gpg`): those carry the company row (name, addresses, status) and its sign-in accounts. Older exports cannot rebuild a deleted company.
1. Decrypt it outside the repo, as for a restore. The file holds password hashes and authenticator secrets as well as patient data: treat it like a database dump and delete it afterwards.
2. `ENV_FILE=.env.prod npm run company:restore -- --company <slug> --in <file> --create`. The id and slug come from the file (the `--company` slug must match it). It refuses when the company still exists (use a plain restore), or when another company now has its slug or one of its addresses. In one transaction it puts back the company row, then restores as above: accounts, profiles, members and data come back as exported, so people sign in with their old password, Google and authenticator. OAuth tokens are never in an export (Google sign-in does not need them).
3. Add its domain back to the `implant-course` Vercel project (Settings, Domains), wait for it to be valid, then open its site and sign in once. The console's change log records the rebuilt row as a new entry. Run `ENV_FILE=.env.prod npm run isolation:check -- --company <slug>`.


**Free plan pause:** if the Supabase dashboard shows the project as paused, open it and choose **Restore project**. The nightly backup's requests normally prevent this.

## F2. Google sign-in (owner, once; live since 2026-11)

People whose company email is a Google account can sign in with a "Sign in with Google" button on the login page. They still need an account in the app (an invite or an existing user) with that email; Google only replaces the password. Two-factor authentication, where set, is still asked for. Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or neither. If only one is set, Google sign-in stays off (password sign-in still works) and the server log names the missing one. Without them the button is hidden, and `/auth/google/start` and `/auth/google/callback` answer 404.

**Google Cloud setup (once):**
1. Open console.cloud.google.com and pick or create a project (for example "Implant Course").
2. Go to **Google Auth Platform** → **Branding**. Set the app name to `Implant Course Manager` and choose a support email.
3. Go to **Audience**. Choose **External** and publish the app (**In production**). **Publish app** stays greyed out until **Branding** has a home page and a privacy policy link: set **Application home page** to `https://www.imploid.net`, **Application privacy policy link** to `https://www.imploid.net/privacy`, and add `imploid.net` under **Authorized domains**. The privacy page ships with the app (`web/src/lib/tenant/landing.ts`); keep its text true when what the app stores changes. While the app is in **Testing**, only the test users listed under **Audience** can sign in with Google.
4. Under scopes, keep only `openid`, `email` and `profile`. These need no Google review.
5. Go to **Clients** → **Create client** → **Web application**.
6. Under **Authorized redirect URIs** add one URI per company:
   - `https://kaleidoscope.imploid.net/auth/google/callback`
   - `https://osdic.imploid.net/auth/google/callback`
   - `https://demo.imploid.net/auth/google/callback`
7. Create the client. Copy the **client ID** and the **client secret** into your password manager.

**Vercel settings:**
1. Vercel → the `implant-course` project → Settings → Environment Variables.
2. Add `GOOGLE_CLIENT_ID` ⟨secret⟩ for **Production**, with the client ID. Mark it **Sensitive**.
3. Add `GOOGLE_CLIENT_SECRET` ⟨secret⟩ for **Production**, with the client secret. Mark it **Sensitive**.
4. Run **Release** (Actions → Release → Run workflow on `master`) so the new deployment picks them up.

**Smoke test (before telling users):**
1. Open one company's login page. Check that the **Sign in with Google** button shows.
2. Click it and sign in with a Google account whose email already has an account there. Enter the 2FA code if that account has 2FA. Check that you land in the app.
3. Open **Account security**. It shows "Google sign-in: used".
4. Sign out.
5. Click the button again and sign in with a Google account that has **no** account there. The login page must show "There's no account for this email here. Ask your admin."
6. Tell the users.

**Login page messages** (the address ends `/login?error=<code>`):

| Code | Message | What to do |
|---|---|---|
| `google_no_account` | There's no account for this email here. Ask your admin. | Invite the person (Admin → Users) with that Google email. |
| `google_disabled` | This account is deactivated. | Reactivate the user in Admin → Users, if that is intended. |
| `google_unverified` | Google didn't confirm this email address. | The person must use a Google account with a confirmed email. |
| `google_other_account` | This account uses a different Google account. Ask your admin. | The account already uses another Google account (or the address changed hands). If the person should use this one: Admin → Users → **Reset Google sign-in**. |
| `google_failed` | Google sign-in didn't work. Try again or use your password. | Try again. If it repeats, check the two Vercel settings and the redirect URI in the Google client. |

**Someone changed their Google account:** Admin → Users → the user → **Reset Google sign-in**. This also signs them out everywhere. Their next Google sign-in is remembered instead. A deactivated user stays refused until reactivated.

## G. Companies and the console

Every company and the console live in the one production database (merge of control into production, releases 1–3, 2026-11-14; design `docs/superpowers/specs/2026-11-14-merge-control-into-production-design.md`). The app routes each request by its host through `public.companies` (`hosts`, `status`), read with the project's own keys and cached 60 s; if the database can't be reached it keeps routing from its last list for 10 minutes, then shows "Service unavailable". An unknown host gets 404, a suspended company 503. A status or address change reaches every server within about a minute.

**Release 3 checklist (owner, in this order):**
1. *Before merging:* GitHub → the repo → Settings → Environments → `production` → add secrets `PROD_DATABASE_URL` ⟨secret⟩ (prod project → Connect → **Session pooler** URI), `PROD_SUPABASE_URL` (`https://kshsgwvwqvufqdxcyvat.supabase.co`) and `PROD_ANON_KEY` (Project Settings → API Keys → anon/public). Release and Backup stop with the missing name otherwise, before touching anything.
2. Merge and Release as usual (repo public, `./scripts/ship.sh ship`, repo private again). Check the Vercel deployment is Ready.
3. Open each company address and the console (sign in, every company listed with its history).
4. Actions → **Backup** → Run (mode `backup`), then again with mode `verify`: the set holds `prod-<date>.dump.gpg` and one `<slug>-<date>.company.dump.gpg` per company.
5. Vercel → Environment Variables (Production): delete `CONTROL_SUPABASE_URL`, `CONTROL_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_CONTROL_ANON_KEY`, `CONTROL_DATABASE_URL`, `CONTROL_SELF_AUTH_SECRET`, `CONTROL_SELF_AUTH_PRIVATE_JWK`, `CONTROL_SELF_AUTH_KID` and `COMPANY_LIST`; redeploy. GitHub `production`: delete `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY`. `web/.env.prod`: delete the `CONTROL_*` lines.
6. Last copy of the control project, kept with the backups (Git Bash, from `web/`, a PostgreSQL client at least as new as the server; the control Session pooler URI pasted only into the prompt): `read -rs CTL; PGSSLMODE=verify-full PGSSLROOTCERT=prod-ca.crt pg_dump --format=custom --no-owner --schema=public --schema=auth --schema=self_auth --schema=vault "$CTL" > control-final.dump; unset CTL`, then check it: `pg_restore --list control-final.dump | grep -c "TABLE DATA"` must print a number above 0. Encrypt it with the backup passphrase (`gpg --symmetric --cipher-algo AES256 --output control-final-$(date -u +%F).dump.gpg control-final.dump`), delete `control-final.dump`, and store the `.gpg` file with the R2 backups or offline.
7. Supabase → the `implant-course-control` project → **Pause**. Delete it after a month without problems; that frees the second Free project slot.

*Undo while control still exists* (before you delete it): unpause the control project if it is paused; put back the GitHub `production` secrets `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY` **before** running Release (the release-2 workflow reads them); register in control any company added since the switch (`ENV_FILE=.env.prod npm run tenant:register -- <slug> "<Name>" <hosts…> --company <id>` from a release-2 checkout); then revert the release-3 PR and run Release, and put the Vercel `CONTROL_*` settings and `COMPANY_LIST=production` back and redeploy. Console changes made since stay in production (release 2 reads the console from production too).

**Console.** The super-admin console manages the companies from a browser, at its own address (`CONSOLE_HOST`, `console.imploid.net`): a console account (Self-Auth company `console`, listed in `public.console_users`) with password and an authenticator app; `is_console_user()` (0105, 0106) requires the second factor, an active row and a console account. Idle sessions are signed out after 15 minutes. Company addresses never serve it (404 for `/console`).

*Create or reset a console admin:* in `web/.env.prod` the company project's `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and the Self-Auth `SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK` (one line, single quotes), `SELF_AUTH_KID`; then `cd web && ENV_FILE=.env.prod npm run console:admin -- you@example.com`. The first line must read `Target project: kshsgwvwqvufqdxcyvat.supabase.co (production)`; it prints a temporary password once. Remove the secrets from `.env.prod` afterwards. Running it again for an existing admin sets a new temporary password and keeps their authenticator. **Sign in straight away**, set up 2FA, then **Change password** (top bar).

*Lost authenticator:* Supabase SQL editor: `delete from self_auth.totp_factor where user_id = (select user_id from public.console_users where email = 'you@example.com');`, then run `console:admin` again for that email and set up 2FA at once.

*Using it:* the Companies page shows each company's health and counts. A company's page lets you suspend it (reason, and type the slug to confirm) and reactivate it, edit its name and addresses, invite its first admin, and shows whether each address is live on Vercel (**Add to Vercel** retries one that isn't). Every change, including an invited, created or reset first admin (the email, never a password) and each address added to Vercel, is recorded in the company's History (`public.company_log`) with the admin's email.

**Add a company.** Console → **Add company**: company name, slug and address (suggested `<slug>.imploid.net`), and the first admin's name and email. One click then:
1. checks no other company uses the address, then creates the company with its starting data (`provision_company`: settings, branding, consent forms; no products — its admin switches them on in Admin → Catalogue, 0128) and its address;
2. adds the address to the Vercel project;
3. emails the first admin an invite on the company's own address. A login this company already has gets a password-reset email instead; someone another company already uses keeps their password and gets a notice. With `EMAIL_ENABLED=false` it shows a one-time password instead.

**Then, by hand (you):** Google Cloud console → Google Auth Platform → **Clients** → the web client → **Authorized redirect URIs** → add `https://<host>/auth/google/callback` → **Save** (§F2). Until you do, Google shows its own `redirect_uri_mismatch` page.

The result lists each step. Once the company exists, a failed address or invite doesn't undo it: redo it from the company's page. An existing slug is refused.

*One-time setup for automatic addresses:*
- GoDaddy (imploid.net → DNS): a CNAME with name `*` and value `cname.vercel-dns.com`. Names that have their own record (kaleidoscope, osdic, console, www, Resend's) keep it.
- Vercel → Account Settings → Tokens: a token scoped to the team that owns `implant-course`. In the project's Environment Variables (Production): `VERCEL_API_TOKEN` ⟨secret⟩, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID` if the project belongs to a team. Redeploy to pick them up.
- Without these the console still adds the company and shows the manual address steps on its page (Vercel **Add Existing**, plus a GoDaddy CNAME if there's no wildcard).

**A company on its own Supabase project** is not supported: every company's accounts and data are in the one database.

**Company isolation check** (after adding a company, before go-live, or whenever in doubt): from `web/`, `ENV_FILE=.env.prod npm run isolation:check` (`-- --company <slug>` for one company's pairs). For every pair of active companies, both ways, it acts as an active admin of one (signed in, 2FA passed, session bound to its company, exactly as the website does) and counts the other's rows in every company table. Each pair is one transaction that is always rolled back, so nothing is saved, and it needs no passwords. Expect `PASS` on every line and `0` rows; a `FAIL` names the table and the count: stop and report. A company whose admin has not signed in yet is `SKIPPED`. First run 2026-11-15: academy, demo and osdic, 6 pairs, PASS.

**Scripts** reach the one database through `ENV_FILE` (e.g. `ENV_FILE=.env.prod`). Per-company scripts take `--company <slug>`: `npm run company:export -- --company <slug> --out <file>`, `npm run company:restore -- --company <slug> --in <file>` (§D). `--tenant`, `--all-tenants` and `--control` are refused with the replacement. `npm run companies:list` prints the slugs (Backup uses it).

*Locally:* `npm run db:migrate` adds the local companies to the local stack (`localhost` / `a.localhost` = academy, `tenant2.localhost` = company-b, `paused.localhost` = suspended; `npm run dev:companies` does only that). For the console add `CONSOLE_HOST=console.localhost:3000` to `.env.local`, run `npm run dev`, create a console admin with `npm run console:admin -- you@example.com` and open `http://console.localhost:3000/console`. The console E2E (`npx playwright test console --project=chromium`) skips without `CONSOLE_HOST`.

## G2. Error alerts

**What it does.** In production every server-side `console.error` (a failed email, a database error, a failed sign-in) is also written to `public.error_log` (0107), masked (email addresses, tokens and database passwords) and cut to 1000 characters, at most 20 a minute per server instance (`src/lib/errors/report.ts`, switched on in `src/instrumentation.ts`). Every hour (minute 17) the **Error alert** workflow lists the errors since its last run, then opens every active company's first address and the console. If there is any new error, or a site doesn't answer 200, the run fails and GitHub emails you ("Run failed: Error alert"). Open the run; its log lists each kind of error, how often and when it last happened. Each error is reported once; a site that stays down fails every hour. Entries older than 30 days are deleted by the check.

**What you do with an alert.** Read the run's log, or open **Console → Errors** (`/console/errors`): every recorded error of the last 30 days, grouped by message, with how often and when it was first and last seen (Cairo time). For details look at the Vercel logs within the hour (they keep only one hour on Hobby), or in the Supabase SQL editor: `select at, message from public.error_log order by at desc limit 50;`. Run the check again by hand: Actions → Error alert → Run workflow.

**Setup (once):** nothing beyond the GitHub `production` secrets `PROD_DATABASE_URL` and `PROD_DATABASE_CA_CERT` (§A). GitHub emails the failure to whoever last changed the workflow's schedule (you, when you merge it); check GitHub → Settings → Notifications → Actions → "Send notifications for failed workflows only" is on, with email. GitHub turns scheduled workflows off after 60 days without a commit to the repository; it emails before that, and Actions → Error alert → Enable workflow turns it back on. Each run costs about a minute of the private repository's 2,000 free Actions minutes a month (about 730 a month).

## H. Keys and secrets

- To rotate the service role key or the database password: change it in Supabase, then update Vercel (Production: `SUPABASE_SERVICE_ROLE_KEY`, or `DATABASE_URL` and `SELF_AUTH_DATABASE_URL`), GitHub `production` (`PROD_DATABASE_URL`) and `web/.env.prod`, then redeploy. Every company and the console use the same keys.
- If a key was exposed, rotate it immediately, then check Supabase's auth logs.

## I. Smoke check after a release

1. Open the production URL. The pilot banner is visible.
2. Sign in as admin. The dashboard loads.
3. Create a test patient named "Pilot test …", add a checklist, and tick an item.
4. Browser dev tools → Network → reload: the page response has `content-security-policy` and `strict-transport-security` headers.
5. Catalog check: `npm run catalog-export` (with `ENV_FILE=.env.prod`), then compare the CSV with your supplier lists. Fix products in the app; untick **Sample** on each verified product, and deactivate products you don't stock.

## I2. Take the whole site offline (emergency)

For a problem that affects every company (a suspected data leak, a release that damages data): Vercel → `implant-course` → Settings → Environment Variables → Production, set `MAINTENANCE` = `1`, then Deployments → the current one → Redeploy. Every address (companies, console, landing) then answers a "back soon" page (503) before any sign-in or database call; only the logo (`/brand/*`) still loads. To look around yourself meanwhile, set `MAINTENANCE_BYPASS_TOKEN` to 32 or more random characters and send it as the cookie `icm_maintenance_bypass` (browser dev tools → Application → Cookies) or the header `x-maintenance-bypass`. To end it, remove `MAINTENANCE` (any value other than `1` is off) and redeploy. For one company only, suspend it in the console instead (§G).
