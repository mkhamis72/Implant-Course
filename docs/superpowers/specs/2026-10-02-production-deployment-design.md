# Production deployment: design

Date: 2026-10-02 · Status: draft for review

## Goal

Run Implant Course Manager in production for a **pilot**. A few organizers use it with:
- the real catalog;
- real courses and delegates;
- test patients, or patients who have consented to the pilot.

Meanwhile the Egypt PDPL legal check finishes. Full go-live with real courses happens later, after the go-live gate in §6 is complete.

**Success means:**
- organizers sign in at the production address and use every feature;
- every merge to `master` is migrated and deployed in a fixed order;
- there is an encrypted copy of the data from the last 24 hours;
- nothing in the setup blocks the switch to paid plans and real email at go-live.

## Decisions (agreed with the organizer)

| Topic | Pilot choice | At go-live |
|---|---|---|
| Launch | Pilot: test or consented patients only | Real courses |
| Database | New Supabase project, **Free** plan, Frankfurt | Supabase Pro + daily backups (decide on point-in-time recovery) |
| Hosting | Vercel **Hobby**, `*.vercel.app` address, functions in `fra1` | Vercel Pro (Hobby is non-commercial only); custom domain optional |
| Email | **None.** Accounts are created by script; temporary passwords handed over in person | Resend on an owned domain (SPF/DKIM), Supabase SMTP and email templates |
| Release flow | **Approach A:** GitHub Action runs tests → migrates prod → triggers the Vercel deploy hook | Unchanged |
| Backups | Nightly encrypted `pg_dump` as a GitHub Actions artifact, kept 14 days | Supabase backups, plus the export if wanted |

Rejected release flows:
- **B (Vercel auto-deploy, migrations run from a laptop):** code can go live before its migration, and production database credentials sit on a laptop.
- **C (migrate inside the Vercel build):** a cancelled build can leave the database half-migrated, and preview builds would need production secrets.

## 1. Environments

- **Supabase projects:**
  - **dev:** the existing project. Tests and E2E use it; the test guard (`scripts/test-guard.ts`) allow-lists only it.
  - **prod:** a new project in Frankfurt (`eu-central-1`).
- **Production auth settings:**
  - public sign-ups disabled;
  - site URL and redirect URLs set to the Vercel production address;
  - TOTP 2FA enabled;
  - minimum password length 10 (matches the app);
  - session settings left at their defaults (the app enforces the idle timeout).
- **Vercel project:**
  - connected to the GitHub repo, with automatic production deploys from `master` disabled; production deploys come only from the deploy hook;
  - function region `fra1`;
  - production environment variables set in Vercel only:
    - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
    - `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`;
    - `EMAIL_ENABLED=false`, `NEXT_PUBLIC_PILOT=1`;
  - preview deployments receive no production variables.
- **Local production file:** `web/.env.production.local` lives on the admin's PC only and is git-ignored. It is used by the account and catalog scripts and holds:
  - `DATABASE_URL` (prod session pooler);
  - `DATABASE_CA_CERT`;
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
  - `ALLOW_TEST_FIXTURES=0`.
- **Selecting the env file:** `scripts/load-env.ts` gains an `ENV_FILE` override, defaulting to `.env.local`. Scripts run as `ENV_FILE=.env.production.local npm run create-user -- …`.
- **Fixture guard:** the test-fixture guard is unchanged, so fixtures and DB/E2E tests refuse to run against prod.

## 2. Release flow (`.github/workflows/release.yml`)

Trigger: push to `master`, plus `workflow_dispatch` for re-runs. Steps:
1. `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm test` (unit only; DB/E2E stay local because they need the dev project).
2. `npm run db:migrate` against prod. The connection verifies TLS with `DATABASE_CA_CERT`, written to a temp file from a secret. The migration runner is already idempotent: each file is applied once, in a transaction.
3. `curl -X POST $VERCEL_DEPLOY_HOOK_URL` starts the production build.

Rules:
- If step 1 or 2 fails, nothing is deployed.
- Concurrency group `release`, so two releases never interleave.
- Migrations stay backward-compatible with the previous app version, because old code serves traffic until the new build is live. This is written down as a rule in `CLAUDE.md`.

GitHub secrets:
- `PROD_DATABASE_URL`;
- `PROD_DATABASE_CA_CERT` (the PEM text);
- `VERCEL_DEPLOY_HOOK_URL`;
- `BACKUP_PASSPHRASE`.

## 3. Backups and keep-alive (`.github/workflows/backup.yml`)

Nightly, at 02:00 Cairo time:
1. `pg_dump --format=custom` of the prod `public` and `app_private` schemas. It uses the PostgreSQL client matching the server's major version and verified TLS.
2. Encrypt with `gpg --symmetric --cipher-algo AES256` using `BACKUP_PASSPHRASE`. The plain dump never leaves the runner.
3. Upload as an artifact `prod-backup-<date>`, kept for 14 days.
4. The connection itself counts as activity. A REST request with the anon key is also made, to keep the Free project from pausing.

Restore check: the same workflow, run with `workflow_dispatch` and `mode=verify`, downloads the latest artifact, decrypts it, and runs `pg_restore --list`. The job fails if the dump is unreadable. The admin runs it monthly.

`docs/operations.md` documents:
- the full restore procedure (into a fresh Supabase project, then repoint Vercel);
- unpausing a paused Free project;
- rotating keys and secrets;
- creating and resetting users;
- running the catalog export.

## 4. Accounts without email

- **`scripts/create-user.ts`** replaces `create-admin.ts`. The `create-admin` npm script stays as an alias that passes `--role admin`.
  - Usage: `npm run create-user -- <email> "<Full Name>" [--role organizer|admin]`. The default role is organizer.
  - Behaviour, unchanged from today's script:
    - creates the user, or resets an existing user's password, and marks the email confirmed;
    - sets the profile (name, role, active);
    - prints a temporary password and "change it under Account security".
  - Argument parsing is a pure function with unit tests: missing name, unknown role, email normalisation.
- **`EMAIL_ENABLED`** is a server-side environment variable, `true` by default so dev keeps working. When it is `false`, the Admin → Users page shows "Email isn't set up yet. Create accounts with `npm run create-user` (see docs/operations.md)." in place of the invite form. The invite server action also refuses with that message, so a stale form can't send.
- **Password resets:** the admin re-runs `create-user` for that person. The app has no self-service reset link today, and none is added.

## 5. Catalog and pilot safeguards

- **Sample catalog:** production gets the sample catalog from migration 0008, flagged "Sample — verify".
  - **`scripts/catalog-export.ts`** writes `catalog-<date>.csv` (type, brand, system, platform, Ø, length, ref code, description, sample, active) for checking against supplier lists.
  - **Fixing entries:** organizers edit wrong entries in the app. Unticking the existing **Sample** checkbox on a product marks it verified, and products they don't stock are deactivated. No new UI is needed.
- **`NEXT_PUBLIC_PILOT=1`** shows a thin amber banner at the top of every signed-in page: "Pilot: only test patients or patients who consented to the pilot." It is hidden when unset.

## 6. Go-live gate (`docs/go-live.md`)

A checklist. Real courses start only when every item is ticked and dated:
1. Vercel Pro.
2. Supabase Pro with daily backups; decision on point-in-time recovery recorded.
3. Email:
   - domain bought or chosen;
   - Resend verified (SPF/DKIM);
   - Supabase SMTP set to Resend;
   - invite and recovery email templates written;
   - `EMAIL_ENABLED=true`;
   - one invite tested end to end.
4. Written PDPL advice on hosting in Frankfurt, and patient consent wording, both approved.
5. Pilot data deleted, or kept with documented consent. Pilot temporary passwords rotated.
6. Sample catalog fully verified: no product still flagged.
7. `NEXT_PUBLIC_PILOT` removed. Optionally, a custom domain plus Supabase URL settings.

## 7. Security hardening in the app

`next.config.ts` adds response headers on all routes:
- a `Content-Security-Policy` allowing only this site and the Supabase project, plus the inline allowances Next.js needs: `default-src 'self'`, `connect-src 'self' <supabase-url> wss://<supabase-host>`, `img-src 'self' data:`, `style-src 'self' 'unsafe-inline'`, `script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`;
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

The Supabase URL in the CSP comes from `NEXT_PUBLIC_SUPABASE_URL` at build time. The full browser suite must stay green with the headers on in dev.

## 8. Who does what

Only the admin can do these, and the plan marks each one. Claude never sees or handles secret values.
- create the Supabase prod project and set its auth settings;
- create the Vercel project, its environment variables and its deploy hook;
- add the GitHub secrets;
- create `.env.production.local`;
- choose and store the backup passphrase;
- download the Supabase CA certificate.

Claude writes the code, workflows and docs, runs every local check, and walks through each manual step.

## 9. Testing

- **Unit tests:**
  - `create-user` argument parsing;
  - `ENV_FILE` selection in `load-env`;
  - `EMAIL_ENABLED` switch: the admin users page shows the notice and the invite action refuses;
  - `NEXT_PUBLIC_PILOT` banner shown or hidden;
  - CSP builder given a Supabase URL.
- **E2E (dev):** the full suite stays green with the security headers active; one test checks that the headers are present on `/login`.
- **Workflows:** `release.yml` first runs against the empty prod database. That run applies migrations 0001–0022 and is the real end-to-end check. `backup.yml` runs once by hand, then in `verify` mode.
- **Post-deploy smoke check:** documented in `docs/operations.md` and run by the admin with Claude. Steps:
  1. Open the production URL.
  2. Sign in as the created admin.
  3. Dashboard loads.
  4. Create a test patient and a checklist, tick an item.
  5. Check that the response headers are present.
  6. Run the backup workflow; it succeeds.

## Out of scope

- Custom domain and email at pilot.
- Error-monitoring services (Vercel logs suffice for the pilot).
- Staging environment.
- Self-service password reset.
- Data import of real patients.
