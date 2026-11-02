# One database, plan 1: restore points, spike, release 1 and release 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take restore points for prod (academy) and the control project, prove the `tenant_definer` approach, ship the service-role company checks (release 1), and ship the additive schema (release 2: `companies`, `app.*` helpers, `company_id` everywhere, `company_members`), all without changing what academy sees.

**Architecture:** Academy stays in place in the prod project. Release 2 only adds things: every company table gets `company_id` with academy's uuid as a constant default, so existing rows are filled without an UPDATE. Nothing reads the new objects yet. Plan 2 (company-aware app, release 3) and plan 3 (the enforcement window, cleanup, canary and operations) are written after Task 3 decides between the definer approach and the fallback.

**Tech Stack:** Postgres 15+/Supabase, plpgsql migrations applied by `web/scripts/migrate.ts`, Vitest DB tests (`npm run test:db`), Next.js 15 server actions, tsx scripts, Docker (`postgres:17` client image).

**Spec:** `docs/superpowers/specs/2026-11-02-one-database-design.md`

## Global Constraints

- Work only in the worktree `D:\Claude\Claude Code\implant-course-one-db`, on branch `one-database` or on feature branches cut from it. Run commands from `web/`.
- Academy's company id is `a7c0de00-0000-4000-8000-000000000001`, slug `academy`. It's used as a literal in migrations.
- Never call `auth.uid()`, `auth.jwt()` or `request.jwt.*` outside schema `app` in **new** SQL. Existing functions are moved over in plan 3.
- New migrations start at `0083`. Never edit an applied one. Every release must run with the previous app version (add, don't rename or drop).
- New tables get RLS `enable` **and** `force`, explicit grants (0019 default: none), and the `app_private.audit_row()` trigger.
- Definer functions: `security definer set search_path = ''`, `revoke … from public, anon`, grant only what's needed.
- Backups go to `D:\Backups\implant-course\pre-one-db\<academy|control>\`, outside the repo. Secret values never go in the repo, in chat or in script output.
- Prod is run by the owner, because auto mode blocks Claude. Give owner commands as `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && …`.
- A migration that seeds rows adds its table to the restore `TRUNCATE` in `docs/operations.md` §D.

## Review Focus

1. **The previous app version keeps writing `profiles`** (invite, role change, deactivate, delete) after release 2, so `company_members` must follow every write. *Test in Task 7.*
2. **Rows created by existing functions after 0084** (a booking, a stock receipt) must get academy's `company_id` through the default, with no code change. *Test in Task 6.*
3. **The nightly data-only backup must still restore** after release 2 adds seeded tables (`companies`, `company_members`). *Restore rehearsal in Task 8.*
4. **Academy users still sign in with password and 2FA**, and patients, bookings, stock and Statistics still load after release 2. *E2E subset in Task 8.*
5. **The backup and spike scripts never print a secret**, even when they fail (a failed `pg_dump` echoing its connection string). *Test in Task 1.*

---

### Task 1: Restore-point backup script

**Files:**
- Create: `web/scripts/pre-one-db-backup.ts`, `web/scripts/pre-one-db-backup-lib.ts`
- Test: `web/scripts/pre-one-db-backup.test.ts`
- Modify: `web/package.json` (script `"backup:pre-one-db": "tsx scripts/pre-one-db-backup.ts"`)

**Interfaces:**
- Consumes: `applyTenantArg(argv, env)` (`scripts/tenant-env.ts`), `pgConfig(env)` (`scripts/db.ts`), `withControl(env, fn)`.
- Produces:
  - `pgDumpArgs(kind: 'full' | 'schema', outFile: string): string[]`, the `pg_dump` arguments without the connection string.
  - `countsSql(): string`, a query returning `{ table: string, rows: number }` for every ordinary table in `public`, `app_private` and `auth` (exact `count(*)`).
  - `settingsMarkdown(s: { label: string; host: string; serverVersion: string; envNames: string[]; vaultNames: string[] }): string`.
  - `redact(text: string, secrets: string[]): string`.
  - CLI: `npm run backup:pre-one-db -- (--tenant academy | --control) --out <dir>` writes `<dir>/full.dump`, `schema.dump`, `counts.json` and `settings.md`.

- [ ] **Step 1: Write the failing tests** in `pre-one-db-backup.test.ts`:
  - `pgDumpArgs('full', '/out/full.dump')` equals `['--format=custom', '--no-owner', '--no-acl', '--file=/out/full.dump']`. It has no `--schema` filter, so `auth` is included.
  - `pgDumpArgs('schema', …)` adds `--schema-only`.
  - `settingsMarkdown(...)` contains every env name and vault name, and has no `=` after an env name.
  - `redact('connect postgresql://u:pw@h/db failed', ['postgresql://u:pw@h/db', 'pw'])` contains neither secret and contains `[redacted]`.
  - `countsSql()` matches `/relkind in \('r','p'\)/` and names the three schemas.
- [ ] **Step 2: Run** `npm test -- pre-one-db-backup`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the lib**, then the CLI:
  - **Connection:** `--tenant academy` resolves the company env through `applyTenantArg`. `--control` uses `CONTROL_DATABASE_URL` and `CONTROL_DATABASE_CA_CERT` from `ENV_FILE`.
  - **Dumps:** each one runs `docker run --rm -e PGURL -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.crt -v <ca>:/ca.crt:ro -v <out>:/out postgres:17 sh -c 'pg_dump "$PGURL" "$@"' -- <args>`. The URL passes only through the environment, never in argv.
  - **Output:** stdout and stderr pass through `redact()` with the URL and password. The CLI prints only `Target project: <host>`, the file names and their sizes.
  - **`counts.json`** comes from `countsSql()` over `pgConfig()`, inside `begin read only`.
  - **`settings.md`** holds the host, `select version()`, the env **names** from `ENV_FILE` and Vault secret **names** (control: `select name from vault.secrets`). It ends with an empty "Owner fills in" section: Auth providers, redirect URLs, email templates, the plan's backup / PITR status and the latest backup time.
- [ ] **Step 4: Run** `npm test -- pre-one-db-backup`. Expected: PASS.
- [ ] **Step 5: Dry-run locally:** `ENV_FILE=.env.local npx tsx scripts/pre-one-db-backup.ts --out "$TEMP/pre-one-db-local"`. With no `--tenant` or `--control` flag it uses `DATABASE_URL` from `ENV_FILE`. For 127.0.0.1 it drops `PGSSLMODE`/`PGSSLROOTCERT` and runs the container with `--network host`, as `pgConfig` skips TLS locally. Expected: four files, and `pg_restore --list` (run in the same image) lists `auth.users`.
- [ ] **Step 6: Commit:** `git commit -m "feat(ops): pre-one-db backup script"`.
- [ ] **Step 7 (owner):**
  - Run the two backups and report the printed sizes:
    - `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ENV_FILE=.env.prod npm run backup:pre-one-db -- --tenant academy --out "/d/Backups/implant-course/pre-one-db/academy"`
    - The same with `--control --out ".../control"`.
  - Fill in the "Owner fills in" section of both `settings.md` files from the Supabase dashboard.
  - Copy `web/.env.prod` and the Vercel env export into the backup folder. Those files hold values: they stay outside the repo.

### Task 2: Prove the restore and write RESTORE.md

**Files:**
- Create: `web/scripts/restore-check.ts`, `docs/one-database/RESTORE.md` (secret-free), `D:\Backups\implant-course\pre-one-db\RESTORE.md` (the same content plus local paths)
- Test: `web/scripts/restore-check.test.ts`

**Interfaces:**
- Consumes: `counts.json` and `full.dump` from Task 1; the dev2 stack (`npm run db:dev2:start` writes `web/.env.dev2`).
- Produces:
  - `compareCounts(expected: Record<string, number>, actual: Record<string, number>): { table: string; expected: number; actual: number | null; ok: boolean }[]`
  - CLI: `ENV_FILE=.env.dev2 npx tsx scripts/restore-check.ts --dump <full.dump> --counts <counts.json>`, which exits 1 on any mismatch.

- [ ] **Step 1: Write the failing test.** `compareCounts({a:1,b:2},{a:1,b:3})` marks `b` not ok, and a table missing from `actual` is `actual: null, ok: false`.
- [ ] **Step 2: Run** `npm test -- restore-check`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The CLI refuses unless the target host is 127.0.0.1 (`test-guard` style).
  - It restores with `pg_restore --no-owner --no-acl --schema=public --schema=app_private` (schema and data) into the **un-migrated** dev2 database.
  - It then restores `--data-only --schema=auth --disable-triggers` into dev2's own `auth` tables.
  - It counts with `countsSql()` and prints a table with one line per mismatch, then `PASS n/n` or `FAIL`.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Run the real proof.** Use a fresh dev2 (`npm run db:dev2:stop`, then `npm run db:dev2:start`, with no `db:migrate`), then the CLI on `/d/Backups/implant-course/pre-one-db/academy/full.dump`. Expected: `PASS` for every table in `public`, `app_private` and `auth.users`, `auth.identities`, `auth.mfa_factors`.
  - A mismatch only in `auth` bookkeeping tables (`auth.sessions`, `auth.refresh_tokens`, `auth.audit_log_entries`) that grew between the dump and the count is acceptable. Record it in RESTORE.md.
- [ ] **Step 6: Write RESTORE.md** with the exact commands for each case:
  - **Whole-project restore of academy.** Pause the app (suspend in the console), then `pg_restore --clean --if-exists --no-owner --no-acl --schema=public --schema=app_private` plus `--data-only --schema=auth` into the prod project. Run the counts check, then lift the suspension.
  - **Control project restore:** the same, with `--schema=public --schema=control_private`.
  - **Code:** `git checkout pre-one-db-2026-11`, then redeploy through Release.
  - Where the owner's settings copies live.
- [ ] **Step 7: Commit** `restore-check.ts`, its test and `docs/one-database/RESTORE.md`: `git commit -m "docs(ops): restore points and restore check for one-database"`.

### Task 3: `tenant_definer` spike

**Files:**
- Create: `web/scripts/spike-tenant-definer.ts`, `docs/one-database/spike-result.md`

**Interfaces:**
- Consumes: `applyTenantArg`, `pgConfig`.
- Produces: the decision in `spike-result.md`, which is **"definer approach"** or **"fallback: explicit company check in every definer"**. Plan 3 reads it.

- [ ] **Step 1: Write the script.** It opens one transaction and **always** ends with `rollback`. It runs as the connection's `postgres` and prints `PASS`/`FAIL <check>: <reason>` per check, exiting 1 on any FAIL. The checks:
  1. `create role tenant_definer nologin nobypassrls`, then `grant tenant_definer to postgres`, then `grant anon to tenant_definer` all succeed.
  2. `grant usage on schema public, app_private`, `grant select, insert, update, delete on all tables in schema public` and `grant execute on all functions in schema app_private` to `tenant_definer` all succeed.
  3. Create a temporary table `public.spike_rows (company_id uuid, id uuid)` with RLS enabled and forced, plus:
     - a restrictive policy for all commands: `company_id = current_setting('spike.company')::uuid`
     - a permissive `using (true) with check (true)` policy for `tenant_definer, authenticated`
     - the `app_private.audit_row()` trigger
  4. Create a definer function `public.spike_get(uuid) returns int`, which counts rows by id, then `alter function … owner to tenant_definer`. Seed one row for company A.
     - As `authenticated` with `spike.company = B` and claims `{sub, role}`, `spike_get(A's id)` returns 0.
     - With `spike.company = A` it returns 1.
  5. A tenant_definer-owned function returning `auth.uid()` returns the `sub` from the claims.
  6. A tenant_definer-owned function inserting into `spike_rows` succeeds, and an `audit_log` row appears. This shows `audit_row` (postgres-owned) still writes.
  7. A tenant_definer-owned function calling `app_private.require_active()` runs without a permission error.
  8. `alter function … owner to tenant_definer` succeeds for **every** public `security definer` function except the allowlist (spec §5). Print the count.
  9. Running `pg_dump --schema-only` isn't possible inside the transaction, so record instead whether `pg_roles` shows `tenant_definer` with `rolbypassrls = false`.
- [ ] **Step 2: Run it locally:** `ENV_FILE=.env.local npx tsx scripts/spike-tenant-definer.ts`. Expected: all PASS. Fix the script, not the checks, until it does; a check that can't pass locally means the fallback.
- [ ] **Step 3: Commit:** `git commit -m "chore(spike): tenant_definer feasibility check"`.
- [ ] **Step 4 (owner):** run `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ENV_FILE=.env.prod npx tsx scripts/spike-tenant-definer.ts --tenant academy`. Then confirm with `select rolname from pg_roles where rolname = 'tenant_definer'` (read-only) that the role is gone after the rollback.
- [ ] **Step 5: Write `spike-result.md`:** both outputs, the decision, and, if any check failed on prod, which one. Commit: `git commit -m "docs: tenant_definer spike result"`.

### Task 4: Release 1, service-role company checks

**Files:**
- Create: `web/src/lib/admin/same-company.ts`
- Modify: `web/src/app/(app)/admin/users/actions.ts` (`resetPassword` :103, `changeEmail` :132, `resetTwoFactor` :168, `editName` :203, `resendInvite` :215), `web/src/lib/admin/create-login.ts:17`, `web/src/lib/admin/auth-accounts.ts:98` (`listSignIns`)
- Test: `web/src/lib/admin/same-company.test.ts`, `web/src/app/(app)/admin/users/actions.test.ts` (extend or create), `web/src/lib/admin/create-login.test.ts` (extend or create)

**Interfaces:**
- Produces:
  - `memberOfMyCompany(userId: string): Promise<boolean>`. It selects `profiles.user_id` by id through the admin's own RLS client (`createClient()`). Today that is "same company"; plan 2 switches it to `company_members` for `app.current_company_id()`.
  - `listSignIns(userIds: string[]): Promise<Map<string, string | null>>`. The new parameter is the visible member ids, and the result holds only those ids.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/supabase/server`, `@/lib/supabase/admin` and `@/lib/auth/session`):
  - With `memberOfMyCompany` false, `resetPassword`, `changeEmail`, `resetTwoFactor`, `editName` and `resendInvite` each return `{ error: 'User not found.' }` and never call any `admin.auth.admin.*` method.
  - With `memberOfMyCompany` true, `resetPassword` calls `updateUserById` once.
  - `createLogin`: when `inviteUserByEmail` returns a user id that already has a `profiles` row (admin client lookup), it returns `{ error: 'A user with this email already exists.' }` and calls neither `deleteUser` nor the profile update.
  - `listSignIns(['a'])`, given Auth users `a` and `b`, returns a map with only `a`.
- [ ] **Step 2: Run** `npm test -- admin`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Call `memberOfMyCompany` right after the uuid check in each action, **before** any Auth call. In `changeEmail` that means before `changeAuthEmail`.
  - In `createLogin`, look the returned id up in `profiles` with the admin client before the update/rollback branch.
  - Pass the page's member ids to `listSignIns`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: all green.
- [ ] **Step 5: Verify and ship.** Commit (`fix(admin): check the user belongs to the admin's company before any Auth change`), run `./scripts/ship.sh verify admin-users`, then the owner runs `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ./scripts/ship.sh ship` (make the repo public first, private after). After deploy, the owner resets a test user's password in prod.

### Task 5: Migration 0083, companies and `app` helpers

**Files:**
- Create: `web/supabase/migrations/0083_companies.sql`
- Test: `web/tests/db/one-db-foundation.test.ts`
- Modify: `docs/operations.md` §D (add `public.companies` to the restore `TRUNCATE`)

**Interfaces:**
- Produces:
  - `public.companies (id uuid pk default gen_random_uuid(), slug text unique not null, name text not null, created_at timestamptz not null default now())`. RLS is enabled and forced. `authenticated` can select its own company once plan 2 binds sessions: `id = (select app.current_company_id())`. No API writes. The table has the audit trigger. The seed is academy (`a7c0de00-0000-4000-8000-000000000001`, `academy`, name = `branding.name`, or `'Academy'` when that is empty).
  - Schema `app`, with usage granted to `authenticated, anon`.
  - `app.current_user_id() returns uuid`: `stable`, definer, owner postgres, body `select auth.uid()`.
  - `app.current_aal() returns text`: `auth.jwt() ->> 'aal'`.
  - `app.current_company_id() returns uuid`: returns `null` in this migration and is replaced in 0085.
  - `app.company_tables() returns setof regclass`. It returns every ordinary table in `public` except `companies` and `profiles`, plus `app_private.research_codes`. Execute is revoked from `public, anon, authenticated`.
  - The `execute` grants on the three `current_*` functions go to `authenticated, anon`.

- [ ] **Step 1: Write the failing tests** (`withTx`, `actAs`):
  - `companies` has exactly one row, academy, with the fixed id.
  - Under `actAs(c, organizer)`, `select app.current_user_id()` equals the organizer's id, and `app.current_aal()` equals the `aal` passed in `extraClaims`.
  - As `anon`, `app.current_user_id()` is null.
  - As `authenticated`, `select * from app.company_tables()` fails with a permission error.
  - As `postgres`, `app.company_tables()` includes `public.patients` and `app_private.research_codes` and excludes `public.companies` and `public.profiles`.
  - `pg_class.relforcerowsecurity` is true for `public.companies`.
- [ ] **Step 2: Run** `npm run test:db -- one-db-foundation`. Expected: FAIL. Dry-run the migration in a rolled-back transaction first (CLAUDE.md, Gotchas).
- [ ] **Step 3: Write `0083_companies.sql`** to the interface above.
- [ ] **Step 4: Run** `npm run test:db -- one-db-foundation`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(db): companies table and app helpers (0083)"`.

### Task 6: Migration 0084, `company_id` on every company table

**Files:**
- Create: `web/supabase/migrations/0084_company_id.sql`
- Test: `web/tests/db/one-db-company-id.test.ts`

**Interfaces:**
- Consumes: `app.company_tables()` and the academy id.
- Produces: on each table in `app.company_tables()`:
  - `company_id uuid not null default 'a7c0de00-0000-4000-8000-000000000001' references public.companies (id)`
  - index `<table>_company_id_idx`
  - constraint `<table>_company_id_key unique (company_id, id)`, but only for tables whose primary key is the single column `id`
  - For the singletons `settings`, `branding` and `branding_logos`: `unique (company_id)` instead.

  Plan 3 relies on these names.

- [ ] **Step 1: Write the failing tests:**
  - For every table in `app.company_tables()`: the column is `not null`, has an FK to `companies`, has an index whose first column is `company_id`, and has a default containing the academy id.
  - `select count(*) from <t> where company_id <> academy` is 0 for every table.
  - **Review Focus 2:** after `actAs(organizer)` and a `create_surgery_slot` RPC (existing fixture data from `fixtures.ts`), the new `surgery_slots` row and its `audit_log` row carry academy's `company_id`.
  - `stock_movements` row count is unchanged by the migration (compare against a count taken in the test's setup via `asPostgres`), and `audit_log` gained no rows from the migration itself.
- [ ] **Step 2: Run** `npm run test:db -- one-db-company-id`. Expected: FAIL.
- [ ] **Step 3: Write `0084_company_id.sql`** as one `do $$ … $$` loop over `app.company_tables()` using `format('%s', regclass)`. Use `add column if not exists … default <literal>`; a constant default means no table rewrite and no row triggers fire. Then add the FK, the index and the unique constraint.
- [ ] **Step 4: Run** `npm run test:db`, the **full** suite. Expected: PASS. A failure in an existing test means a function that copies whole rows by position (`insert … select *`). Fix it in this migration with `create or replace` of the latest definition.
- [ ] **Step 5: Commit:** `git commit -m "feat(db): company_id on every company table (0084)"`.

### Task 7: Migration 0085, `company_members`, session binding and the sync from `profiles`

**Files:**
- Create: `web/supabase/migrations/0085_company_members.sql`
- Test: `web/tests/db/one-db-members.test.ts`
- Modify: `docs/operations.md` §D (add `public.company_members` to the restore `TRUNCATE`)

**Interfaces:**
- Consumes: 0083 and 0084 (including `delegates_company_id_key`).
- Produces:
  - **`public.company_members`:**
    - columns `company_id uuid not null references companies`, `user_id uuid not null references profiles (user_id) on delete cascade`, `role public.user_role not null`, `active boolean not null`, `delegate_id uuid`, `mfa_setup_required boolean not null default false`, `created_at`, `updated_at`
    - pk `(company_id, user_id)`; `foreign key (company_id, delegate_id) references delegates (company_id, id)`; `unique (company_id, delegate_id)`; index on `user_id`
    - RLS enabled and forced. Select policy: `user_id = (select app.current_user_id()) or (select public.is_admin())`. `grant select to authenticated`, no write grants. Audit and `set_updated_at` triggers.
  - **`app.session_companies`:** `session_id uuid pk`, `company_id uuid not null references public.companies`, `user_id uuid not null`, `created_at timestamptz not null default now()`. RLS enabled and forced, no policies, no grants.
  - **`app.current_company_id()`**, replaced: `select company_id from app.session_companies where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and user_id = auth.uid()`.
  - **`app.bind_session(p_company uuid) returns void`**: definer, `grant execute to authenticated`. Errors via `app_private.fail`:
    - no `session_id` claim → `'No sign-in session.'`
    - no active membership in `p_company` → `'You do not have access to this company.'`
    - already bound to another company → `'You do not have access to this company.'`
    - same company → no-op
  - **`app_private.sync_member_from_profile()`**: an `after insert or update or delete` trigger on `profiles` that upserts or deletes academy's `company_members` row, copying `role`, `active`, `delegate_id` and `mfa_setup_required`. It's guarded by `pg_trigger_depth() < 2`, and a backfill insert covers existing profiles.

- [ ] **Step 1: Write the failing tests:**
  - **Backfill:** `company_members` has one academy row per `profiles` row, with equal role, active, delegate_id and mfa_setup_required.
  - **Review Focus 1, through the previous app version's own paths:**
    - an admin `update profiles set role='admin'` on the viewer makes the member row `admin`
    - `set active=false` makes it inactive
    - `delete_user` removes it
    - a new `auth.users` insert (via `handle_new_user`) creates it
  - **`bind_session`:**
    - with claims `{sub: organizer, session_id: S}` it inserts `(S, academy, organizer)`, and `app.current_company_id()` then returns academy
    - a second call with academy is a no-op
    - a call with a second company (inserted as postgres in the test) fails with `'You do not have access to this company.'`
    - without a `session_id` claim it fails with `'No sign-in session.'`
    - an inactive member fails
  - **Locked down:**
    - as `authenticated`, `select * from app.session_companies` fails with a permission error
    - `insert into company_members` fails
    - the organizer sees only their own member row; an admin sees all
  - `relforcerowsecurity` is true for both new tables.
- [ ] **Step 2: Run** `npm run test:db -- one-db-members`. Expected: FAIL.
- [ ] **Step 3: Write `0085_company_members.sql`** to the interface above.
- [ ] **Step 4: Run** `npm run test:db`, the full suite, plus `-- permissions` specifically. Expected: PASS. `tests/db/permissions.test.ts` checks new definers call `require_perm`; add `app.bind_session` to its non-area allowlist there, with a comment pointing at the spec §3.
- [ ] **Step 5: Commit:** `git commit -m "feat(db): company_members, session binding, sync from profiles (0085)"`.

### Task 8: Release 2, verify, rehearse the restore, ship, check prod

**Files:**
- Create: `web/scripts/one-db-check.ts` (read-only)
- Modify: `docs/operations.md` §D (if Tasks 5 and 7 didn't finish it)

**Interfaces:**
- Produces: CLI `ENV_FILE=… npx tsx scripts/one-db-check.ts [--tenant academy]`. Inside `begin read only` it prints, per table in `app.company_tables()`, `rows`, `null company_id` and `other company`, then the `companies` and `company_members` counts against `profiles`. It exits 1 if any null or other-company count is non-zero, or if the member count ≠ the profile count.

- [ ] **Step 1: Restore rehearsal (Review Focus 3).** Take a data-only dump of the local stack the way `backup.yml` does (`--data-only --schema=public --schema=app_private --schema=auth`), restore it into a fresh migrated dev2 using the §D `TRUNCATE` + restore commands, then run `one-db-check.ts` against dev2. Expected: no primary-key error and the check passes.
- [ ] **Step 2: Run** `./scripts/ship.sh verify login mfa patients schedule implants statistics`. Expected: all green (Review Focus 4).
- [ ] **Step 3: Owner ships** with `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ./scripts/ship.sh ship`, making the repo public first and private after. Release migrates prod with 0083–0085.
- [ ] **Step 4: Owner checks prod** with `! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ENV_FILE=.env.prod npx tsx scripts/one-db-check.ts --tenant academy`. Expected: exit 0. Then sign in to `kaleidoscope.imploid.net` with 2FA and open a patient, the schedule, stock and Statistics.
- [ ] **Step 5:** Write plans 2 and 3 from the spec and `docs/one-database/spike-result.md`.
