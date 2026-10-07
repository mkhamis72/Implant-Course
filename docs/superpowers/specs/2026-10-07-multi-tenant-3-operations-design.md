# Multi-tenant, part 3: operations

Date: 2026-10-07. Builds on part 1 (`2026-10-07-multi-tenant-1-tenant-aware-app-design.md`, live: production routes through the control project) and part 2 (branding, live).

## Context and goals

Releases, backups and scripts still treat production as one database (`PROD_DATABASE_URL`, `ENV_FILE=.env.prod`). A second company's database would never be migrated (the new code would break there) or backed up. Part 3 is the plumbing that must exist before a real second company goes live. It changes nothing visible in the app.

Success:
- One release migrates the control project and every registered company, and deploys only if all of them succeeded.
- Every company (and the control project's registry) is backed up nightly into its own encrypted file and can be restored on its own.
- Any script can target one company by name: `--tenant <slug>`.
- With only the academy registered, everything behaves as today.

## Decisions

| Topic | Decision |
|---|---|
| Release fan-out | One job, companies one after another in slug order; stop at the first failure; no deploy unless all succeeded. Not a parallel matrix. |
| Which companies | Every registered company, active **and suspended** (a suspended company that's switched back on is already up to date). |
| Credentials in CI | One GitHub secret, `CONTROL_DATABASE_URL` (session pooler, verified TLS with the shared Supabase CA `PROD_DATABASE_CA_CERT`). Company database URLs, service keys and anon keys are read from the control project at run time and masked in the logs. |
| Control project migrations | Applied by the release, before the companies (today the owner runs them by hand). |
| Backup failure | One company's failure doesn't stop the others; the job fails at the end naming the failed companies. |
| Control project backup | Only `public.tenants` (and `tenant_audit`); Vault secrets can't be restored into another project, so recovery re-enters them with `tenant:register`. |
| Scripts | `--tenant <slug>` on `db:migrate`, `create-user`, `catalog-export`; `--all-tenants` on `db:migrate` only. Without either flag, scripts behave as today (env file). |

## Company resolution (`scripts/tenant-env.ts`)

Connects to the control database (`CONTROL_DATABASE_URL`, CA from `CONTROL_DATABASE_CA_CERT` or `DATABASE_CA_CERT`, via `pgConfig`) and returns, per company:

- `listTenants()`: every row of `public.tenants` (slug, name, status, supabase_url, anon_key), ordered by slug.
- `tenantEnv(slug)`: the env a script needs for that company: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Vault `tenant/<slug>/service_role_key` via `public.tenant_secret`), `DATABASE_URL` (Vault `tenant/<slug>/database_url`), `DATABASE_CA_CERT` (the control CA path, shared by all Supabase projects). Unknown slug → "No company <slug> in the control project." A missing secret → "Company <slug> has no <name> in Vault; register it again with tenant:register."
- **Masking:** when `GITHUB_ACTIONS=true`, every secret value it returns is first printed as `::add-mask::<value>` so GitHub hides it in all later log lines. Nothing else ever prints a secret.
- `--tenant <slug>` in a script: resolves the company and overlays its env on `process.env` before the script runs; the script then works exactly as with an env file. Every script still prints `Target project: <slug> <host>` first.

## Release (`.github/workflows/release.yml`)

`check` job unchanged. `migrate-and-deploy`:
1. Write the CA from `PROD_DATABASE_CA_CERT` to a temp file (as today); fail with a clear message if `CONTROL_DATABASE_URL` or the CA is missing.
2. `npm run db:migrate -- --control` (control project).
3. `npm run db:migrate -- --all-tenants`: for each company in slug order, print `Target project: <slug> <host>`, apply `supabase/migrations`, and stop with a non-zero exit at the first failure (naming the company).
4. Deploy hook, unchanged (including the "master hasn't moved on" check), only if 2 and 3 succeeded.

A failure part-way is safe: migrations are additive, so companies already migrated keep working with the current app; the new code isn't deployed until a re-run gets through every company.

`PROD_DATABASE_URL` is no longer used by the release (it stays for a manual restore until the owner removes it).

## Backups (`.github/workflows/backup.yml`)

Backup mode, one job (it now checks out the repo and runs `npm ci` so it can use `scripts/tenant-env.ts`):
1. `npm run tenants:export -- --dir "$RUNNER_TEMP/tenants"` writes one file per company, `<slug>.env` (mode 600), with `SLUG`, `DATABASE_URL`, `SUPABASE_URL`, `ANON_KEY`, after printing `::add-mask::` for each secret; the shell loop sources each file in turn. The files live only in the runner's temp directory and are never uploaded.
2. For each company: `pg_dump` with today's flags (data only; `public`, `app_private`, `auth`; excluding both `schema_migrations`), piped straight into `gpg --symmetric` with `BACKUP_PASSPHRASE` (refuse to run without it), written as `out/<slug>-YYYY-MM-DD.dump.gpg`. A failure is recorded and the loop continues.
3. Control registry: `pg_dump --data-only --table=public.tenants --table=public.tenant_audit` of the control database, encrypted the same way, as `out/control-YYYY-MM-DD.dump.gpg`.
4. Upload `out/*.dump.gpg` as one artifact `backups-<run id>`, retention 14 days.
5. Keep-awake: for each company, `GET <supabase_url>/auth/v1/health` with its anon key; also the control project.
6. If any company failed in step 2, fail the job and list them.

Verify mode: download the latest `backups-*` artifact (falling back to the old `prod-backup-*` name for the first two weeks), decrypt every file, and `pg_restore --list` it; each company file must contain `TABLE DATA public patients` and `TABLE DATA auth users`, the control file `TABLE DATA public tenants`. Fail naming the file otherwise.

## Restore (`docs/operations.md` §D)

Per company, independent of the others:
1. Download and decrypt the company's file.
2. Create a fresh Supabase project; re-register the company with the new project's URL, keys and database URL (`tenant:register`, same slug and hosts).
3. `ENV_FILE=.env.prod npm run db:migrate -- --tenant <slug>`.
4. TRUNCATE the seeded tables (`settings`, `products`, `branding`) and load the file, as today.
5. `tenant:check -- <slug>`.

Control project: create a fresh project, `db:migrate -- --control`, load `control-*.dump`, then re-run `tenant:register` for every company (Vault secrets), and update `CONTROL_*` in Vercel and GitHub.

## Testing

- **Unit (`scripts/tenant-env.test.ts`):** env overlay per company; unknown slug and missing-secret messages; `::add-mask::` lines printed only under `GITHUB_ACTIONS` and before any other output; `--tenant` / `--all-tenants` argument parsing; `--all-tenants` stops at the first failure (migrate function mocked).
- **DB (`tests/db/control.test.ts`, rolled back on the local control schema):** `listTenants` returns suspended companies too, ordered by slug; `tenantEnv` reads both Vault secrets.
- **Workflows (`scripts/workflows.test.ts`):** release migrates control, then `--all-tenants`, then deploys; needs `CONTROL_DATABASE_URL`; no longer uses `PROD_DATABASE_URL`; backup encrypts every file and refuses without the passphrase; continues past a company failure and fails at the end; dumps only `tenants`/`tenant_audit` from control; verify checks every file. Existing safety properties stay pinned.
- **Manual (owner, once):** after merging, run Backup and Backup (verify) by hand and check the artifact has `academy-…` and `control-…`.

## Rollout

1. Owner adds GitHub secret `CONTROL_DATABASE_URL` (production environment) **before** merging; the first release after merge uses it.
2. Merge → release migrates control (no pending migrations today), then `academy`; deploys.
3. Owner runs Backup and Backup (verify) manually once.
4. Later: remove `PROD_DATABASE_URL` and the prod keys from `.env.prod` once a restore rehearsal has been done the new way.

## Out of scope

- Parallel or per-company deploys (one app serves all companies).
- Per-company backup passphrases or off-GitHub backup storage.
- Super-admin console (part 4) and automated onboarding (part 5).
