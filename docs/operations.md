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
- **Change a sign-in email** (typo, new address): Admin → Users → **Change email** on the user's row. It changes the sign-in address and the app record together (and the linked delegate's email), signs them out everywhere, and emails a notice (no link) to the new address, and to the old one if they have signed in before. Don't edit `auth.users` or `profiles` in the Supabase dashboard: the two would disagree. You can't change your own here; use Account → Security.
- **Lost authenticator (company users):** Admin → Users → **Reset 2FA** (shown only when the user has one). It removes their authenticator and signs them out everywhere; at their next sign-in they must set up a new one before the app (or the database) lets them do anything else.
- **Invite never arrived:** Admin → Users → **Resend invite**, shown while email is on and the user has never signed in. Each row's **History** lists the last email, name and 2FA changes made by admins.
- **Deactivate, or change role:** Admin → Users in the app. Delegate logins are deactivated there too.
- **Delete** a user or delegate added by mistake: Admin → Users → **Delete user**, or **Delete delegate** on the delegate's page (this also deletes their login and course enrollments). Anyone with records — implants, stock, notes, checklist work, surgery bookings — can't be deleted: deactivate them, or set the delegate Inactive.

### Turning on email verification

1. In Supabase → Authentication → SMTP Settings, enter the SMTP provider's host, port, user and password, and a sender address on your domain.
2. In Authentication → Email Templates, point the links at the app's `/auth/confirm` route. The default `{{ .ConfirmationURL }}` link does not work with it.
   - **Invite user:** `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept the invitation and set your password</a>`. `{{ .RedirectTo }}` is the request's own `https://<host>/auth/confirm` (the app passes it on every invite and reset), so each company gets links on its own address. Use it only once the release that passes `redirectTo` is live; before that the template used `{{ .SiteURL }}/auth/confirm?...` (see `docs/one-database/release-3-checklist.md`).
   - **Reset password:** the same link with `type=recovery`. The login page's **Forgot password?** sends it (shown only while `EMAIL_ENABLED` is on); users with 2FA enter their code before setting the new password. Reset links also last `86400` seconds (step 3).
3. In Authentication → Sign In / Providers → Email, set **Email OTP Expiration** to `86400` so invitation links last 24 hours (the default is 1 hour).
4. In Authentication → URL Configuration, set the Site URL to the production URL and add `https://<site>/auth/confirm` to the redirect URLs (with one shared database, `https://*.imploid.net/**`).
5. In Vercel → Settings → Environment Variables (Production), set `EMAIL_ENABLED=true`, then redeploy: Actions → **Release** → Run workflow (branch `master`).
6. Check it: create a login for a test address you own. The email should arrive, its link should open "Set a password", and the new user should reach the app. If nothing arrives, look in Supabase → Logs → Auth for SMTP errors.

**Resend on imploid.net** (since 2026-10-17; free plan: 100 emails a day, 3,000 a month):
- Resend → Domains: `imploid.net`, region EU (Ireland). Its records are at GoDaddy (imploid.net → DNS): TXT `resend._domainkey` (DKIM) and CNAME `send` (bounce MX and SPF). Keep one `_dmarc` TXT record. Copy values from Resend: the DKIM key is different in every Resend account.
- API key: Resend → API Keys, **Sending access**, domain `imploid.net` ⟨secret⟩. It is the SMTP password both here and for the app emails below. Type it straight into Supabase and Vercel.
- SMTP settings: host `smtp.resend.com`, port `465`, username `resend`, password = the API key, sender `noreply@imploid.net`.
- To turn email off again, set `EMAIL_ENABLED=false` and re-run Release: logins go back to temporary passwords.

*Until 2026-10-17 the pilot used Gmail SMTP* (a dedicated Gmail account with 2-Step Verification and an app password; host `smtp.gmail.com`, port `465`, username and sender = the Gmail address). Revoke its app passwords once Resend works.

### Checklist assignment emails

The app emails an organizer when a checklist item is assigned to them, and when the text or due date of an item assigned to them changes. Nothing is sent when you assign an item to yourself. These emails come from the app itself, not from Supabase Auth, so they need their own SMTP settings. They are off until `SMTP_HOST` is set, and also off while `EMAIL_ENABLED=false`.
1. Use the Resend API key from above ⟨secret⟩, or a second one for the same domain so it can be revoked without breaking invites.
2. In Vercel → Settings → Environment Variables (Production), add `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend`, `SMTP_PASS=<the API key>` (mark it Sensitive) and `SMTP_FROM=Implant Course Academy <noreply@imploid.net>`.
3. Re-run **Release** (branch `master`).
4. Check it: assign a checklist item to another organizer login whose mailbox you can read. If saving shows "Saved, but the email … couldn't be sent.", look in Vercel → Logs for `sendEmail failed`.

One sender serves every company; the email names the company. Locally the emails land in Mailpit (http://127.0.0.1:54324).

## C. Releases

- Merging to `master` runs **Release**:
  1. typecheck, lint, unit tests and a production build;
  2. back up every company database and the control project (schema and data, sign-in accounts included; artifact `pre-release-backups-*` and R2), and stop if that fails;
  3. migrate production (Migration B of Self-Auth stays held until the production variable `SELF_AUTH_B_HOLD` is `0`, §E);
  4. deploy through the hook.
  A red run deploys nothing. Fix it and merge again, or re-run.
- A release migrates the control project (`db:migrate -- --control`), then every registered company in slug order (`db:migrate -- --all-tenants`, suspended ones too), and deploys only if all succeeded. A failure stops the run before the deploy and names the company; fix it and re-run Release (companies already migrated are skipped as up to date).
- If `master` moved on while a run was waiting, that run migrates but leaves the deploy to the newer run, so code never goes live before its own migration.
- Migrations must work with the previous app version for the few minutes until the new build is live. Add things; don't rename or drop in the same release.

## D. Backups and restore

**What a backup holds:** the data (not the schema) of the app tables plus the sign-in accounts (Supabase Auth's `auth` schema and, since the Self-Auth switch-over, `self_auth`), encrypted. The control file also holds the console admins and their accounts. The schema comes from the migrations in this repo. Since the one-database release a database can hold several companies, so a backup has two kinds of file: a **whole-database dump** (every company in that database; taken once per distinct database, named after the first company on it) and, for every company, its **own export** (`company-export`: that company's rows and its members' accounts as JSON, restorable alone).

- **Backup** runs nightly and writes, per distinct database, `<slug>-<date>.dump.gpg` (the whole database, named after the first company on it), per company `<slug>-<date>.company.dump.gpg` (the company's own JSON export; the `.dump` in the name only keeps it inside the artifact and off-site globs), plus `_control-<date>.dump.gpg` (the company registry only), in the artifact `backups-*`, kept 14 days, and copies the same encrypted files to the Cloudflare R2 bucket under `<date>/<run id>/`, kept and locked for a year (see Off-site copy below). A failure for one company doesn't stop the others; the run turns red and ends with "Backup failed for: …". The run also pings every company and the control project to keep them awake; a failed ping doesn't stop the others and is named in "Keep-awake failed for: …". A failed off-site copy also turns the run red ("Off-site copy failed or did not run").
- **Monthly verify** runs on its own at 06:00 UTC on the 1st, after that night's backup; GitHub emails you if it fails (scheduled runs notify whoever last changed the workflow's schedule). Run it by hand any time: Actions → Backup → Run workflow → mode `verify`. It checks the newest artifact **and** the newest off-site set, and must finish green with "Every backup is readable and complete, in GitHub and off-site." It also accepts the older `prod-backup-*` artifacts for their remaining days. Verify decrypts with the GitHub secret, so it proves GitHub can read the backups, not that **you** can: keep `BACKUP_PASSPHRASE` in your password manager (it was lost once and replaced on 2026-10-08; backups made before that can't be read).
- **Restore rehearsal** (before go-live, then twice a year). There are no free Supabase slots for a scratch project, so use the local dev2 stack and wipe it afterwards. It holds patient data while you work, so never leave it.
  1. `npx supabase stop --workdir .dev2 --no-backup`, then `npm run db:dev2:start` and `ENV_FILE=.env.dev2 npm run db:migrate`.
  2. Download and decrypt the newest backup outside the repo (steps 1, 5 and 6 below). Run them with `docker exec supabase_db_implant-course-dev2 psql -U postgres -d postgres …` after `docker cp`-ing `data.sql` in. If your local `pg_restore` is older than the backup's, run it through `docker run --rm -v <dir>:/work postgres:18 pg_restore …`.
  3. Compare the row count of every `COPY` block in `data.sql` with `select count(*)` of that table in dev2.
  4. `npx supabase stop --workdir .dev2 --no-backup`, delete the downloaded and decrypted files, then rebuild dev2 for the console tests: `npm run db:dev2:start`, `npm run console:local` (control project only: do not `db:migrate` the rebuilt dev2; the company schema's sign-up trigger would refuse the console admins).

  Last rehearsal: 2026-10-08, backup run 37782802942. All 57 tables matched, all 5 accounts kept their passwords, and new writes continued the ID sequences.

**Off-site copy (Cloudflare R2).** GitHub keeps artifacts only 14 days, so every run also copies its encrypted files to an R2 bucket that keeps them a year and refuses deleting or overwriting them before then, even with the workflow's own key. The files are encrypted before they leave the runner; Cloudflare never sees patient data. Set it up once, before merging the workflow change (otherwise the nightly run turns red):
1. Cloudflare dashboard → **R2 Object Storage**. Enabling R2 asks for a payment method; the backups stay well inside the free 10 GB.
2. **Create bucket** `implant-course-backups`, location: **Specify jurisdiction → European Union**.
3. Bucket → Settings → **Bucket lock rules** → Add rule: all objects (no prefix), retain **365 days**.
4. Bucket → Settings → **Object lifecycle rules** → Add rule: all objects, delete after **366 days** (a day after the lock ends, so the lock never blocks it).
5. R2 → **Manage API tokens** → Create API token: permission **Object Read & Write**, applied to `implant-course-backups` only. Copy the Access Key ID, the Secret Access Key (shown once) and the S3 endpoint that matches the bucket's location (`https://<account id>.r2.cloudflarestorage.com`; an EU-jurisdiction bucket answers only on `https://<account id>.eu.r2.cloudflarestorage.com`). The production bucket (2026-10-15) uses the default location and endpoint.
6. GitHub → Environments → `production` → add the secrets `R2_ENDPOINT` (that endpoint), `R2_BUCKET` (`implant-course-backups`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Keep the Cloudflare login in your password manager: it is the way in if GitHub is lost.
7. Run Backup by hand, then Backup with mode `verify`: both copies must pass. In the bucket, try to delete one file: R2 must refuse it.

**Before this release every tenant must have its company id** in the control project (register with `--company <uuid>` or `--provision`). The nightly company export fails for one without, naming it ("no company id in the control project") and turning the run red.

**Restore a whole database**, if a company's project (or the control project) is lost or damaged. For one company inside a healthy shared database use **Restore one company's data** below instead.

You need:
- **GnuPG:** included in Git for Windows (Git Bash), or install Gpg4win;
- **PostgreSQL client tools** (`pg_restore`, `psql`) at least as new as the `pg_dump` that made the backup. The Backup workflow installs the newest client (18 as of 2026-10), so use 18 or later, e.g. from the PostgreSQL Windows installer with "Command Line Tools" only. An older `pg_restore` stops with "unsupported version in file header".

**Restore a database** (every company in it comes back). Steps, in Git Bash from `web/`.

*Which set.* There are two kinds; pick the newest set taken **before** the damage:
- **Nightly** (Backup): artifact `backups-<run id>`, R2 folder `<date>/<run id>/`. **Data only**, and it has the per-company `*.company.dump.gpg` exports.
- **Pre-release** (Release, since the Self-Auth switch-over): artifact `pre-release-backups-<run id>-<attempt>`, R2 folder `<date>/<run id>-<attempt>/` (the `-<attempt>` suffix tells them apart). **Schema and data** of `public`, `app_private`, `app`, `auth`, `self_auth` (control: `public`, `auth`, `self_auth`), taken just before that release's migrations. It has no company exports. Use it to get back to the moment before a release.

The newest R2 folder can be either kind (the monthly verify checks whichever is newest). The steps below are the same for both: step 5's `pg_restore --data-only` takes only the data, also from a schema-and-data file, and step 4 builds the schema from the migrations. For a pre-release set, check out the commit **before** that release in step 4 (`git log --first-parent master`: the commit before the release's merge), because its schema is from before the release's migrations. If the set was taken after Migration B ran (after *After the window* in §E), run step 4 with `SELF_AUTH_B_HOLD=0`, or `db:migrate` skips 0103 and the schema won't match.

1. Download the newest suitable artifact (`backups-*`, or `pre-release-backups-*` as above) and unzip it. If it has expired (14 days) or GitHub is unavailable, download the file from the R2 bucket instead: Cloudflare dashboard → R2 → `implant-course-backups` → the date and run folder → the company's file → Download. Then decrypt the company's file: `gpg --decrypt <slug>-<date>.dump.gpg > <slug>.dump`. It asks for the passphrase.
2. Create a new Supabase project (Frankfurt), with the same auth settings as §A.1.
3. Make an env file `.env.restore` with the new project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (session pooler) and `DATABASE_CA_CERT`, plus the `CONTROL_SUPABASE_URL` and `CONTROL_DATABASE_URL` lines copied from `.env.prod` (`tenant:register` reads the company from the first group and the control project from the second).
4. Apply the schema to the new project directly: `ENV_FILE=.env.restore npm run db:migrate`. If the backup is older than the newest migrations, check out the commit the backup belongs to first: the newest migration it has is the newest migration file at that date. Then `git checkout master` again before the next steps.
5. Turn the dump into SQL: `pg_restore --data-only --no-owner -f data.sql <slug>.dump`.
6. **Fresh project only.** The TRUNCATE below (with `companies … CASCADE`) is for a brand-new project and wipes every company in it, which is what a whole-database restore wants; never run it on a database that is in use. Load it in one transaction, with triggers off so nothing is created twice. This is Supabase's documented restore method. The migrations seeded `settings`, `branding`, the sample `products`, the consent form `consent_form_versions` (0072), the company list `companies` (0083) and the academy memberships `company_members` (0085) and academy's file number counter `app_private.file_no_counters` (0091), and auditing those seeds wrote `audit_log` rows, so empty those eight first. Without `audit_log`, the load stops with `duplicate key value violates unique constraint "audit_log_pkey"`:

   ```bash
   psql "<new session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
     -c "SET session_replication_role = replica" \
     -c "TRUNCATE public.settings, public.products, public.branding, public.consent_form_versions, public.companies, public.company_members, app_private.file_no_counters, public.audit_log CASCADE" \
     -f data.sql
   ```

7. Repoint the company: `ENV_FILE=.env.restore npm run tenant:register -- <slug> "<Name>" <hosts…>`, with the same slug and hosts as before. This points the company at the new project and replaces its Vault secrets. The app picks up the re-registered project within its 10-minute routing cache (or right after the next deploy).
8. Check it: `ENV_FILE=.env.prod npm run tenant:check -- <slug>`. Sign-in accounts come back with the data: everyone keeps their password and 2FA.

`.env.restore` can be deleted afterwards: the control project now holds the new keys. If the restored company is the academy, update the academy values in `.env.prod` only if you still use them. Also update Vercel's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the new project: otherwise the documented rollback (removing the `CONTROL_*` variables, §G) would point at the dead project.

**Restore one company's data** (a mistake or damage in one company; the other companies in the database are untouched). Needs the company's own export `<slug>-<date>.company.dump.gpg` from the artifact or R2.
1. Decrypt it outside the repo: `gpg --decrypt <slug>-<date>.company.dump.gpg > <slug>.json`. The file holds password hashes and patient data: treat it like a database dump and delete it afterwards.
2. **Suspend the company** in the console (Companies, the company, Suspend; type the slug), wait up to 60 seconds for the host cache and confirm its site shows 503. The restore deletes the company's rows and loads the file's rows back: anything the company's users write meanwhile would be interleaved with that and lost. Other companies keep working.
3. Take a fresh export of the company, so the restore can itself be undone: `ENV_FILE=.env.prod npm run company:export -- --tenant <slug> --out before-<slug>.json`.
4. `ENV_FILE=.env.prod npm run company:restore -- --tenant <slug> --in <slug>.json`. It refuses a file whose company id is not the company's, or with a row that carries another company's id, or a table list that differs from the database's. In one transaction it deletes that company's rows (company tables in reverse foreign-key order, including its `company_members`) and loads the file's rows back; `profiles` and `auth.users` are only inserted when missing and never deleted, because a person can belong to another company. Triggers are off during the load (`session_replication_role = replica`; if the database role may not set it, the restore stops before changing anything), so audit rows and the stock ledger come back exactly as exported. The foreign keys of the restored rows are then checked and any failure rolls everything back. A log is written next to the file (`<file>.restore.log`).
5. **Lift the suspension** in the console (Reactivate), wait up to 60 seconds, then check the company in the app (patients, stock on hand). If it is wrong, suspend again and restore `before-<slug>.json` the same way. Delete the downloaded and decrypted files.

**Delete one company's data** (a data-protection request, or after a company leaves). Irreversible: export first and keep that file encrypted until the request is settled.
1. `ENV_FILE=.env.prod npm run company:export -- --tenant <slug> --out erase-<slug>.json`; the list of people is in its `public.company_members` table.
2. `ENV_FILE=.env.prod npm run company:restore -- --tenant <slug> --delete` removes every company-table row of the company (the same transaction, triggers and checks as a restore, with nothing reloaded). The company row itself, `companies`, stays. To remove it too, end the company's sign-in sessions first: their bindings in `app.session_companies` reference the company (`session_companies_company_id_fkey`), so a plain delete of the company fails while any exist; and the company's own audit trigger would log its deletion under the deleted company, which fails too (`audit_log_company_id_fkey`), so it is off for that one statement (foreign keys stay checked). As postgres, in one transaction (tried in a rolled-back transaction on the local stack, 2026-11-06):

   ```sql
   begin;
   delete from auth.sessions where id in (select session_id from app.session_companies where company_id = '<company id>');
   delete from app.session_companies where company_id = '<company id>';
   alter table public.companies disable trigger companies_audit;
   delete from public.companies where id = '<company id>';
   alter table public.companies enable trigger companies_audit;
   commit;
   ```
3. Remove the people only if they have no other membership (they may belong to another company): as postgres, `delete from auth.users u where u.id in (<user ids from step 1>) and not exists (select 1 from public.company_members m where m.user_id = u.id)`. Their `profiles` rows go with them. A user who is still a member somewhere stays.
4. Deregister the company from the control project in the console (hosts and Vault secrets), and delete `erase-<slug>.json` once the request is closed. Nightly backups still hold the company's data until the 14-day artifacts expire and the year-long R2 copies are deleted by their lifecycle rule; say so in the reply to the data subject.

**Restore the control project:** create a fresh project; run `ENV_FILE=.env.prod npm run db:migrate -- --control` (with `CONTROL_*` pointing at it); load `_control-<date>.dump` the same way (no TRUNCATE needed). Read each company's slug, name and hosts with `select slug, name, hosts from public.tenants`. Re-run `tenant:register` for every company (Vault secrets aren't in the backup; use an env file with that company's keys, as in step 3 above), then `tenant:check -- <slug>` for each. Update `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` in Vercel and `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL` and `CONTROL_ANON_KEY` in GitHub; re-run Release.

**Free plan pause:** if the Supabase dashboard shows the project as paused, open it and choose **Restore project**. The nightly backup's requests normally prevent this.

### Self-Auth rehearsal (before the switch-over)

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
| `SELF_AUTH_DATABASE_URL` | the shared company database's **Session pooler** URI (port 5432), user `postgres.<project ref>` (the **postgres** role: schema `self_auth` is revoked from `service_role`), ending in `?sslmode=require` |
| `CONTROL_DATABASE_URL` | the control project's Session pooler URI, postgres role, `?sslmode=require` (the console signs in against it; before Self-Auth it was in GitHub and `.env.prod` only) |
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
5. **Merge `feat/self-auth` into `master`.** The release takes its own backup (note `pre-release-backups-…` and the R2 folder from its log), runs Migration A (`0101`, `0102`, control `0007`), holds Migration B, and deploys the new app, still in maintenance. Its deploy hook builds **without** Vercel's build cache (`?buildCache=false`, documented by Vercel for deploy hooks): the vendored `@mkhamis72/self-auth` tarball (`web/vendor/`, 0.1.3) is a local file dependency, so a cached copy of an earlier build of it must not be reused. Check it in Vercel → the new deployment → Build Logs (no "Restored build cache" line). If it did use a cache, redeploy that deployment with "Use existing Build Cache" **off** before step 6.
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

## G. Control project (companies)

The app serves each company from its own Supabase project. Without `CONTROL_SUPABASE_URL` it serves one company (tenant `default`) from the `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` env vars, as before.

**Set up (once, owner):**
1. Create the project `implant-course-control` (Frankfurt). Create it in your existing Supabase organisation (the second Free slot; Free allows 2 active projects per account).
2. In `web/.env.prod` add `CONTROL_SUPABASE_URL` and `CONTROL_DATABASE_URL` ⟨secret⟩ (Session pooler). `CONTROL_SERVICE_ROLE_KEY` goes only in Vercel (no script reads it). The Supabase CA certificate is shared, so `DATABASE_CA_CERT` covers it; otherwise set `CONTROL_DATABASE_CA_CERT`.
3. Apply the control schema: `ENV_FILE=.env.prod npm run db:migrate -- --control`. The first line must read `Target project: control <ref>.supabase.co`. The control project's `tenant_audit` table is read-only even for the service-role key.

**Register a company** (its project's keys come from the loaded env file; for the academy that's `.env.prod`):

```bash
ENV_FILE=.env.prod npm run tenant:register -- academy "Implant Course Academy" kaleidoscope.imploid.net implant-course.vercel.app
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
2. Vercel → Domains: add the console address to the project. Environment Variables (Production): `CONSOLE_HOST` = the host name only, `console.imploid.net` since 2026-10-17 (no `https://`, no path; before that `implant-console.vercel.app`, which now gets 404), `NEXT_PUBLIC_CONTROL_ANON_KEY` = the control project's anon key. Re-run Release.
3. Add `CONTROL_SUPABASE_URL` (already there) and `CONTROL_SERVICE_ROLE_KEY` to `.env.prod` just for this step, run `ENV_FILE=.env.prod npm run console:admin -- you@example.com` (it prints a temporary password), then remove the service key line again. Running it again for an existing admin sets a new temporary password and keeps their authenticators.
4. **Sign in straight away and set up 2FA.** Until you do, anyone who has the temporary password could enrol their own authenticator first. Then replace the temporary password under **Change password** (top bar) and check that the academy row shows OK.

*Lost authenticator:* control project → Authentication → Users → the user → delete the factor, run `console:admin` again for that email (new temporary password), sign in and set up 2FA at once.

*Using it:* the Companies page shows each company's health (a live check of its project) and counts. A company's page lets you suspend it (reason, and type the slug to confirm) and reactivate it, edit its name and addresses, replace its keys (checked before saving), invite its first admin (see below), and shows whether each address is live on Vercel (**Add to Vercel** retries one that isn't). Every change, including an invited, created or reset first admin (the target email, never a password) and each address added to Vercel, is recorded in the company's History table with the admin's email. `tenant:register` / `tenant:check` still work and are recorded as `script`.

**Add a company (shared database, multi-tenant part 5).** Console → **Add company**: company name, slug and address (suggested from the name: `<slug>.imploid.net`), and the first admin's name and email. One click then:
1. registers the company with the shared database's keys, copied from the company that serves academy (no keys to paste);
2. creates the company with its starting data (`provision_company`: settings, branding, catalogue, consent forms);
3. adds the address to the Vercel project;
4. emails the first admin an invite on the company's own address. A login this company already has gets a password-reset email instead; someone another company already uses keeps their password and gets a notice. With `EMAIL_ENABLED=false` it shows a one-time password instead.

The result lists each step. Once the company exists, a failed address or invite doesn't undo it: redo it from the company's page. An existing slug is refused. The new address can show "not found" for up to a minute after Vercel reports it live (registry cache).

*One-time setup for automatic addresses:*
- GoDaddy (imploid.net → DNS): a CNAME with name `*` and value `cname.vercel-dns.com`. Names that have their own record (kaleidoscope, osdic, console, www, Resend's) keep it.
- Vercel → Account Settings → Tokens: a token scoped to the team that owns `implant-course`. In the project's Environment Variables (Production): `VERCEL_API_TOKEN` ⟨secret⟩, `VERCEL_PROJECT_ID` (Settings → General → Project ID), and `VERCEL_TEAM_ID` if the project belongs to a team. Redeploy (Release) to pick them up.
- Without these the console still adds the company and shows the manual address steps on its page (Vercel **Add Existing**, plus a GoDaddy CNAME if there's no wildcard).

**Add a company on another Supabase account.**

> **Not supported with Self-Auth.** Self-Auth keeps every company's accounts in the shared company database (the app's one `DATABASE_URL` / `SELF_AUTH_DATABASE_URL`), so a company on its own project could not sign in. `tenant:register` refuses a project other than the shared one ("… is not the shared company database …") before changing anything. Add companies with the console's **Add company** until Self-Auth supports one database per project. The steps below are kept for that day.

The app doesn't care which Supabase account a company's project lives in. The control registry stores each company's project URL, and its keys in Vault. Release, Backup, keep-awake and the console all work from there.

Who should own the account:
- **The company's own account (recommended for a paying company):** they own their data and pay their own Supabase bill. They invite you as a project member so you can set it up and support it.
- **A second account of your own, only to get two more free projects:** check Supabase's terms first, because several accounts used to get around the free-plan limit may break their fair-use rules. A Free project isn't meant for real patient data anyway: put a real company on Pro.

Steps (Git Bash, from `web/`):
1. **Project:** in that account, create the project, region **Central EU (Frankfurt)**. Then:
   - Apply the Authentication settings from §A.1 (sign-ups off, confirm email on, TOTP, minimum password length 10).
   - URL Configuration: Site URL and Redirect URLs use **the company's address** (`https://<host>`, `https://<host>/**`).
   - Email templates: invite and recovery must link to `/auth/confirm` (§B → Turning on email verification).
   - SMTP: Resend on `imploid.net` (settings in §B → Turning on email verification), or the company's own sender.
2. **Env file** for this company, `web/.env.<slug>`. It is git-ignored like every `.env*` file; never name it `.env.production…`. It holds:
   - its `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ⟨secret⟩, and `DATABASE_URL` ⟨secret⟩ (Connect → **Session pooler**);
   - `DATABASE_CA_CERT=prod-ca.crt` (the Supabase CA certificate is the same for every project, on any account);
   - `ALLOW_TEST_FIXTURES=0`;
   - the `CONTROL_SUPABASE_URL` and `CONTROL_DATABASE_URL` lines copied from `.env.prod`.
3. **Schema:** `ENV_FILE=.env.<slug> npm run db:migrate`. The first line must name the **new** project's host.
4. **Register:** `ENV_FILE=.env.<slug> npm run tenant:register -- <slug> "<Company name>" <host>`. (The console's **Add company** only adds companies to the shared database.)
5. **Check:** `ENV_FILE=.env.prod npm run tenant:check -- <slug>` must end with `OK`. A certificate error here means the project uses a different CA. Then paste both certificates, one after the other, into `web/prod-ca.crt` and into the GitHub secret `PROD_DATABASE_CA_CERT`, which Release and Backup use for every company.
6. **Address:** normally `<name>.imploid.net`. Vercel → Domains → **Add Existing** `<host>` on the `implant-course` project (Production). At GoDaddy (imploid.net → DNS) add a CNAME, name `<name>`, value as Vercel shows (`….vercel-dns-017.com`), and save. Wait for **Valid Configuration**. A host that isn't in the company's registered addresses gets 404.
7. **First admin:** console → the company → **First admin** (an invite email on the company's address). Or `ENV_FILE=.env.prod npm run create-user -- --tenant <slug> admin@company.com "Name" --role admin`.
8. **Clean up:** delete `web/.env.<slug>`, because Vault now holds its keys. If the company owns the account, they can also rotate the service key later: replace it from the console (**Replace keys**).

From then on, every Release migrates the company, every Backup run saves it (`<slug>-<date>.dump.gpg`, also copied to R2), and its health shows on the console's Companies page. App emails (checklist notices) still go through the one `SMTP_*` sender set in Vercel.

*Locally:* `npm run db:dev2:start`, `npm run console:local` (dev2 is the control project only, do not migrate it; both companies are in the main stack; refuses non-local stacks; writes `.env.console`), then `set -a; source .env.console; set +a; npm run dev` and open `http://console.localhost:3000/console`. The console E2E (`npx playwright test console --project=chromium`, with the same env loaded and nothing on :3000) skips without `CONSOLE_HOST`; `npm run console:admin` is for real projects.

## H. Keys and secrets

- To rotate a company's service role key or database password: change it in Supabase, then re-run `tenant:register` for that company (the control project's Vault holds them), then `tenant:check`. For a company other than the academy, `tenant:register` reads that company's values from an env file like `.env.restore` in §D step 3 (with the new key or password), not from `.env.prod`.
- To rotate the control project's keys or password: change it in Supabase, then update `web/.env.prod`, Vercel (`CONTROL_*`) and the GitHub secrets (`CONTROL_*`), then re-run Release.
- If a key was exposed, rotate it immediately, then check Supabase's auth logs.

## I. Smoke check after a release

1. Open the production URL. The pilot banner is visible.
2. Sign in as admin. The dashboard loads.
3. Create a test patient named "Pilot test …", add a checklist, and tick an item.
4. Browser dev tools → Network → reload: the page response has `content-security-policy` and `strict-transport-security` headers.
5. Catalog check: `npm run catalog-export` (with `ENV_FILE=.env.prod`), then compare the CSV with your supplier lists. Fix products in the app; untick **Sample** on each verified product, and deactivate products you don't stock.
