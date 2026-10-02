# Operations

Production runs on Supabase (Frankfurt) and Vercel (functions in Frankfurt). Releases and backups run as GitHub Actions. Values marked ⟨secret⟩ go only into the place named, never into chats, tickets or code.

## A. First-time provisioning (admin, once)

1. **Supabase production project**
   - New project, region **Central EU (Frankfurt)**, Free plan. Store the database password in your password manager ⟨secret⟩.
   - Authentication:
     - **Sign In / Providers → Email:** Email on, **Allow new users to sign up: off**, **Confirm email: on**.
     - **Multi-Factor:** TOTP enabled.
     - **Passwords:** minimum length 10.
     - **URL Configuration:** Site URL = your Vercel production URL. Redirect URLs = `<vercel-url>/**`. Fill these in after step 3, once the URL exists.
   - Database settings → SSL: download the CA certificate and save it as `web/prod-ca.crt` (`*.crt` is git-ignored).
   - Connect → **Session pooler**: copy the URI ⟨secret⟩.
2. **Local production env file:** create `web/.env.production.local` with:
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
4. **GitHub** → repo → Settings → Environments → New environment **`production`** → add these secrets:
   - `PROD_DATABASE_URL`: the session pooler URI.
   - `PROD_DATABASE_CA_CERT`: open `prod-ca.crt` in a text editor and paste the whole text, including the BEGIN/END lines.
   - `VERCEL_DEPLOY_HOOK_URL`.
   - `BACKUP_PASSPHRASE`: a long random passphrase. **Also store it in your password manager: without it, backups cannot be read.**
   - `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY`.
5. **First release:** Actions → **Release** → Run workflow. It migrates the empty production database (0001…0022), then deploys.
6. **First admin** (from `web/`): `ENV_FILE=.env.production.local npm run create-user -- you@example.com "Your Name" --role admin`. The first line must name the **production** project host.
7. **Smoke check** (section F), then the **first backup**: Actions → **Backup** → Run workflow, first with mode `backup`, then with mode `verify`.

## B. Accounts (no email during the pilot)

- **New organizer:** `ENV_FILE=.env.production.local npm run create-user -- dr@example.com "Dr Name"`. Hand over the temporary password in person; they change it under Account security.
- **Reset a password:** run the same command again for that email.
- **Deactivate, or change role:** Admin → Users in the app.
- The app shows "Email isn't set up yet…" instead of the invite form while `EMAIL_ENABLED=false`.

## C. Releases

- Merging to `master` runs **Release**: typecheck, lint and unit tests, then migrate production, then deploy through the hook. A red run deploys nothing. Fix it and merge again, or re-run the workflow.
- Migrations must work with the previous app version for the few minutes until the new build is live. Add things; don't rename or drop in the same release.

## D. Backups and restore

- **Backup** runs nightly. The encrypted artifacts `prod-backup-*` are kept 14 days.
- **Monthly:** Actions → Backup → Run workflow → mode `verify`. It must finish green and report how many tables hold data.
- **Restore**, if production is lost or damaged:
  1. Download the newest `prod-backup-*` artifact and unzip it.
  2. Decrypt it: `gpg --decrypt prod-<date>.dump.gpg > prod.dump`. It asks for the passphrase.
  3. Create a new Supabase project (Frankfurt). Make an env file for it, then run `ENV_FILE=<that file> npm run db:migrate`.
  4. Load the data: `pg_restore --data-only --disable-triggers --no-owner -d "<new session pooler URI>" prod.dump`.
  5. Point Vercel's environment variables and the GitHub secrets at the new project, then re-run Release.
  6. Recreate the sign-in accounts with `create-user`. Accounts live in Supabase's `auth` schema, which the backup does not include. Profiles, and everything else, come back from the dump.
- **Free plan pause:** if the Supabase dashboard shows the project as paused, open it and choose **Restore project**. The nightly backup's requests normally prevent this.

## E. Keys and secrets

- To rotate the service role key or the database password: change it in Supabase, then update `web/.env.production.local`, Vercel's environment variables and the GitHub secrets, then re-run Release.
- If a key was exposed, rotate it immediately, then check Supabase's auth logs.

## F. Smoke check after a release

1. Open the production URL. The pilot banner is visible.
2. Sign in as admin. The dashboard loads.
3. Create a test patient named "Pilot test …", add a checklist, and tick an item.
4. Browser dev tools → Network → reload: the page response has `content-security-policy` and `strict-transport-security` headers.
5. Catalog check: `ENV_FILE=.env.production.local npm run catalog-export`, then compare the CSV with your supplier lists. Fix products in the app; untick **Sample** on each verified product, and deactivate products you don't stock.
