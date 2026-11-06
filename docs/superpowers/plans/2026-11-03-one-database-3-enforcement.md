# One database, plan 3: enforcement window, cleanup, canary (releases 4–5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The database itself enforces company isolation, so that a missed check in the app can't show one company's data to another. That means:
- forced RLS on every table, with four restrictive company policies each
- guards that read `company_members`
- `tenant_definer` ownership of the definers
- composite foreign keys and per-company uniques
- `company_id` taken from the session

Then the release-3 compatibility code is removed, a new company can be provisioned, and a synthetic canary company proves isolation in prod.

**Architecture:**
- **Release 4** is the one-hour window. The owner suspends academy (503), runs Release, checks row counts and checksums, then lifts the suspension.
  - Its migrations run while the previous app is suspended, so they can drop the release-3 fallbacks and mirrors.
  - The app changes in release 4 are small: provisioning, scripts, and nothing that reads the old `profiles` columns.
- **Release 5** is cleanup: drop the old `profiles` columns, the old readers, the global uniques and the redundant indexes.
- **Canary:** after release 5, a synthetic company in prod.

**Atomicity (my call):** the window migrations are separate files (one transaction each), not one transaction: the app is suspended, and a failure is rolled back by restoring the pre-window dump (Task 10 runbook).

**Tech Stack:** plpgsql migrations, Vitest DB tests, Playwright, tsx scripts, and the console (Next.js) for provisioning.

**Spec:** `docs/superpowers/specs/2026-11-02-one-database-design.md` (§2, §4–§8, §10 steps 4–6). Notes: `docs/one-database/plan-1-notes.md`, `plan-2-notes.md`, and `spike-result.md` (the definer approach is final).

## Global Constraints

- **Workspace:** the worktree is `D:\Claude\Claude Code\implant-course-one-db`, on branch `one-database`. Run commands from `web/`.
  - Every release ships from a **new branch name**, because `ship.sh` reuses a merged PR for a reused name: `one-db-release-4`, then `one-db-release-5`.
  - Prod is run by the owner.
- **Fixed values:**
  - Academy's id is `a7c0de00-0000-4000-8000-000000000001`.
  - New migrations start at `0089`, and each begins with `set local lock_timeout = '5s';`.
  - Migrations already applied in prod (0083–0088) are never edited.
- **SQL rules:**
  - No `auth.uid()`, `auth.jwt()` or `request.jwt` outside schema `app`.
  - Definers use `security definer set search_path = ''` and revoke from `public, anon`.
  - Business errors go through `app_private.fail`.
- **The spec §5 allowlist stays postgres-owned:** `app.*`, `app_private.mfa_satisfied`, `public.mfa_setup_done`, `app_private.handle_new_user`, `app_private.default_permissions`, `app_private.audit_row`, the `auth.sessions` helper used by `admin_end_sessions`, and the pre-login readers `branding_for` / `branding_logo_for`.
  - Every other definer is owned by `tenant_definer`.
  - The owner change follows the spike's order: grant CREATE on `public` and `app_private`, alter owners, revoke CREATE.
- **`tenant_definer` setup:** it needs a permissive `for all to tenant_definer using (true) with check (true)` policy on every table its functions touch (`spike-result.md`). It also needs `grant anon to tenant_definer`, plus table and function grants.
- **Never authorise on the company alone:** every permissive policy also calls `public.is_active_user()`, `public.can(...)` or `public.is_admin()`. The exception is a person-level policy on `profiles` (the caller's own row).
- **Release 4 migrations may assume the previous app version is suspended.** Release 5 migrations must still run with release 4 live.

## Review Focus

1. **A user who is active in academy and inactive in company B,** on a session bound to B, sees nothing in B and can't call any edit function. *Test in Task 7.*
2. **Two companies each with a patient `file_no` `P-001`,** a chair named `Chair 1` and a default checklist template coexist, while duplicates within one company are still refused. *Test in Task 4.*
3. **A definer called by company B with company A's uuids** (patient, slot, lot, site) changes nothing and returns nothing. It should raise its normal "not found" error, not a permission error that leaks existence. *Test in Task 7.*
4. **The restore of one company's export** into the shared database leaves the other company's row counts and checksums unchanged. *Test in Task 9.*
5. **After the window, academy sees exactly what it saw before:** the same row counts and the same per-table md5, `company_id` excluded. *Test in Task 10.*

---

### Task 1: Guard tests (the target, written first)

**Files:**
- Create: `web/tests/db/one-db-guards.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (filter the policy guard on `_area_`; see the plan-1 notes)

**Interfaces:**
- Produces: a guard file with one `it` per guard. Each guard checks the catalog and lists offenders in its failure message.
  - A `PENDING` set names the guards that later tasks enable: Task N removes its guard names from `PENDING`. Guards in `PENDING` run as `it.skip`. When all tasks are done, `PENDING` is empty, and the file asserts that it is.
- Guard names, which later tasks reference:
  - `rls-forced`: every table in `public` and `app_private` has `relrowsecurity` and `relforcerowsecurity`.
  - `company-policies`: every table in `app.company_tables()` has the four restrictive policies `<t>_company_select|insert|update|delete`, using `(select app.current_company_id())`.
  - `company-id-index`: every `company_id` column leads some index.
  - `composite-fks`: no single-column FK between two company tables.
  - `company-uniques`: every unique constraint or index on a company table includes `company_id`. The parent-scoped ones are allowlisted, each with a comment.
  - `definer-owner`: every definer in `public` and `app_private` is owned by `tenant_definer`, apart from the allowlist.
  - `no-auth-outside-app`: no function or policy outside schema `app` mentions `auth.uid`, `auth.jwt` or `request.jwt`.
  - `anon-exec`: no definer is executable by `anon` outside the allowlist: `app.current_user_id`, `app.current_aal`, `app.current_company_id`, `branding_for`, `branding_logo_for`.
  - `permissive-needs-guard`: every permissive policy (except `profiles_self`) calls `is_active_user`, `can` or `is_admin`.
  - `tenant-definer-policies`: every table touched by a `tenant_definer` function has a `to tenant_definer` permissive policy. Approximate this as: every table in `public` and `app_private` has one.

- [ ] **Step 1: Write the file** with all ten guards and `PENDING` holding all ten. Run `npm run test:db -- one-db-guards`. Expected: PASS (ten skipped, plus one that checks the size of `PENDING`).
- [ ] **Step 2: Prove each guard works.** Temporarily remove each guard from `PENDING` and run it. Each must FAIL today with a non-empty offender list, recorded in the report. Then put them all back.
- [ ] **Step 3: Fix the `permissions.test.ts:276` filter** and run `npm run test:db -- permissions`. Expected: PASS.
- [ ] **Step 4: Commit:** `test(db): catalog guards for company isolation (pending)`.

### Task 2: Migration 0089, guards and auth helpers read the company

**Files:**
- Create: `web/supabase/migrations/0089_company_guards.sql`
- Test: `web/tests/db/one-db-company-guards.test.ts`, and enable `no-auth-outside-app` in `one-db-guards.test.ts`

**Interfaces:**
- Consumes: `app.current_user_id()`, `app.current_company_id()`, `app.current_aal()`, `app.current_session_id()`, and `company_members`.
- Produces, as `create or replace` of the latest definitions with the same signatures:
  - **`is_active_user()`, `is_admin()`, `can(area, level)`, `is_delegate_user()`, `my_delegate_id()`, `app_private.require_active()` and `app_private.require_perm()`** read the caller's `company_members` row for `app.current_company_id()`, and `user_permissions` filtered by `company_id`. An unbound session means no access.
  - **`mfa_satisfied` / `mfa_setup_done`:** `mfa_setup_required` is read from and cleared on the member row for the current company.
  - **Everything else:** every other function and policy that mentions `auth.uid()`, `auth.jwt()` or `request.jwt` is redefined to use `app.*`. List them from the catalog query of guard `no-auth-outside-app`.

- [ ] **Step 1: Failing tests:**
  - **Inactive in B:** with an organizer active in academy and inactive in B, `is_active_user()` is true when bound to academy and false when bound to B.
  - **Permissions per company:** `can('patients','edit')` follows the bound company's `user_permissions`.
  - **Unbound:** an unbound session gets `is_active_user()` false.
  - **2FA per company:** with `mfa_setup_required` set only on the B membership, bound to academy the user is not forced to set up 2FA, and bound to B they are. `mfa_setup_done()` clears only the B flag.
- [ ] **Step 2: Run** `npm run test:db -- one-db-company-guards`. Expected: FAIL.
- [ ] **Step 3: Write 0089.** Then remove `no-auth-outside-app` from `PENDING`.
- [ ] **Step 4: Run** the full `npm run test:db`. Tests that impersonate users must bind a session first: use `actAsBound` (`tests/db/helpers.ts`), and switch `actAs` callers that need guards to it. Expected: PASS, apart from the known `search_patients`.
- [ ] **Step 5: Commit:** `feat(db): guards and auth helpers read the bound company (0089)`.

### Task 3: Migration 0090, company-blind functions and removing the release-3 fallbacks

**Files:**
- Create: `web/supabase/migrations/0090_company_functions.sql`
- Test: `web/tests/db/one-db-company-functions.test.ts`

**Interfaces:**
- Produces (same signatures):
  - **Admin functions scoped to the caller's company** (they refuse a user who isn't a member there): `set_user_permissions`, `admin_change_email`, `admin_set_name`, `admin_record_event` (sets `company_id`), `admin_user_history` (filters to the company), and `app_private.check_assignee` (the assignee must be an active staff member of the row's company).
  - **No more fallbacks:**
    - `admin_company(p_message, p_academy_if_unbound)` treats `true` like `false`: unbound means refuse. Keep the signature.
    - `delete_delegate` drops its `coalesce`.
    - `admin_end_sessions` no longer ends unbound sessions.
  - **`handle_new_user`** raises `app_private.fail('No pending login for this address.')` when there's no pending row.
  - **The profile mirrors are dropped,** since nothing writes the old columns any more: drop the triggers `profiles_sync_member` and the reverse-mirror trigger, plus their functions. `delete_user` and `delete_delegate` stop writing `profiles.role` / `profiles.active`.
  - **Opened to every company's admins:** `create_pending_login` / `add_existing_member` (now that `is_admin` reads memberships).

- [ ] **Step 1: Failing tests:**
  - An admin of B can't `set_user_permissions`, `admin_set_name` or `admin_change_email` for an academy-only user (`User not found.`).
  - An unbound admin is refused by `delete_user`.
  - An `auth.users` insert with no pending row raises.
  - A B admin can `create_pending_login`.
  - `check_assignee` refuses an assignee from another company.
- [ ] **Step 2: Run** `npm run test:db -- one-db-company-functions`. Expected: FAIL.
- [ ] **Step 3: Write 0090.**
- [ ] **Step 4: Run** the full `npm run test:db`. Tests that created auth users without a pending row now need one: add a `pendingLogin()` fixture in `tests/db/fixtures.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): company-scoped admin functions; release-3 fallbacks removed (0090)`.

### Task 4: Migration 0091, composite keys, per-company uniques, singletons

**Files:**
- Create: `web/supabase/migrations/0091_company_keys.sql`
- Test: `web/tests/db/one-db-company-keys.test.ts`, and enable `composite-fks` and `company-uniques`

**Interfaces:**
- Produces:
  - **Composite FKs:** every FK from one company table to another becomes `(company_id, <col>) references <t> (company_id, id)`, keeping its **constraint name**. Build the list from the catalog with a `do` loop. FKs to `profiles` and `companies` stay as they are.
  - **Per-company uniques:**
    - `patients (company_id, upper(file_no))`
    - `chairs (company_id, name)`
    - `consent_form_versions (company_id, label)`
    - `checklist_templates (company_id, applies_to) where is_default`
    - the `file_no` counter per company (find how `next_file_no` counts; it must count within `app.current_company_id()`)
    - advisory-lock keys that include `company_id`. Grep for `pg_advisory_xact_lock` in the latest definitions.

    The global uniques are **kept until release 5**. With academy only, they don't block anything yet.
  - **Singletons:** `settings`, `branding` and `branding_logos` get primary key `company_id` (drop the boolean `id` key, and keep the `id` column until release 5). Every function using `on conflict (id)` on them changes to `on conflict (company_id)`: `update_branding`, `set_branding_logo`, `clear_branding_logo`, and the settings writers.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 2,** run in company B once the global uniques are dropped. Write it now as a DB test that drops the global constraint inside the test's transaction.
  - A slot in academy can't reference a B chair (FK violation).
  - Two companies each have a `settings` row.
  - `update_branding` bound to B writes B's row.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Write 0091.** Enable the two guards; the parent-scoped unique allowlist goes in the guard file, with a reason for each entry.
- [ ] **Step 4: Run** the full `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): composite company keys, per-company uniques and singletons (0091)`.

### Task 5: Migration 0092, policies, forced RLS, tenant_definer, the default switch

**Files:**
- Create: `web/supabase/migrations/0092_company_policies.sql`
- Modify: `web/scripts/migrate.ts` (owner assertion)
- Test: enable `rls-forced`, `company-policies`, `definer-owner`, `anon-exec`, `permissive-needs-guard`, `tenant-definer-policies` and `company-id-index`. Add `web/scripts/migrate.test.ts` cases.

**Interfaces:**
- Produces:
  - **RLS:** enable and force it on every table in `public` and `app_private` (including `research_codes` and `schema_migrations`; give `schema_migrations` a postgres-only policy or none, since only postgres touches it).
  - **Four restrictive policies** per company table, named `<relname>_company_select|insert|update|delete`. They are `to public`, with `using` / `with check (company_id = (select app.current_company_id()))` as the spec gives. Generate them in a loop over `app.company_tables()`.
  - **`profiles`:** policies `profiles_self` (`user_id = (select app.current_user_id())`) and `profiles_company` (select only: the person shares a membership with the caller's company, and `(select public.is_active_user())`). Writes stay with the definers.
  - **`company_members_select`:** its admin branch adds `company_id = (select app.current_company_id())`.
  - **Permissive policies:** add a guard call to every one that lacks it; the guard `permissive-needs-guard` lists them.
  - **`tenant_definer`:**
    - `create role tenant_definer nologin nobypassrls`, then `grant anon to tenant_definer`;
    - usage on `public`, `app_private` and `app`; select, insert, update and delete on every table in `public` and `app_private`; execute on every function in `app_private` and `app`;
    - a permissive `<relname>_tenant_definer` policy `for all to tenant_definer using (true) with check (true)` on every table;
    - grant CREATE on `public, app_private`, alter the owner of every definer outside the allowlist, then revoke CREATE.
  - **Default switch:** `alter column company_id set default app.current_company_id()` on every company table. `handle_new_user` and `provision_company` (Task 8) set it explicitly. `audit_row()` sets `audit_log.company_id` from `NEW` / `OLD` (a `company_id` column when the table has one, otherwise the session's company).
  - **`migrate.ts`:** after each migration, inside the same transaction, if role `tenant_definer` exists, assert that every definer outside the allowlist (exported constant `DEFINER_ALLOWLIST`) is owned by `tenant_definer`, and roll back with the offending list otherwise. The allowlist is shared with the guard test (import the constant).

- [ ] **Step 1: Failing tests** in `migrate.test.ts`: the allowlist assertion rejects a migration that creates a postgres-owned definer, using a temporary migrations dir against the local stack inside a rolled-back schema. Follow `migrate-all.test.ts`.
- [ ] **Step 2: Run** `npm test -- migrate`. Expected: FAIL.
- [ ] **Step 3: Write 0092 and the `migrate.ts` check.** Dry-run 0092 in a rolled-back transaction.
- [ ] **Step 4: Run** `npm run test:db`. Then enable the remaining guards, emptying `PENDING`, and run `npm run test:db -- one-db-guards`. Expected: PASS everywhere, apart from the known `search_patients`. Fix tests that inserted rows without a bound session: they now get a null `company_id` and fail the not-null constraint, which is the intended fail-closed behaviour.
- [ ] **Step 5: Commit:** `feat(db): company policies, forced RLS, tenant_definer ownership, session company default (0092)`.

### Task 6: The app compiles against enforcement (release 4 app changes)

**Files:**
- Modify: anything Task 5 breaks in `web/src`, typically inserts that relied on the academy default from a context without a bound session (service-role admin client writes, scripts).
- Test: `npm test`, plus E2E in Task 10.

**Interfaces:**
- Produces:
  - **Every service-role write to a company table** passes `company_id` explicitly from `currentTenant().companyId`. Find them by grepping `createAdminClient()` callers that use `.insert` / `.upsert`.
  - **Nothing in `web/src` reads `profiles.role`, `.active`, `.delegate_id` or `.mfa_setup_required`.** A unit test (`src/lib/one-db-columns.test.ts`) greps the source and fails on any match. This makes the release 5 drop safe.

- [ ] **Step 1: Failing test:** the grep test. It fails if any match remains, for example in `lib/console/first-admin.ts` or `lib/console/companies.ts`.
- [ ] **Step 2: Fix the matches.**
  - The console's first-admin flow calls `add_existing_member` / `create_pending_login` through the company's database. Use a service-role path that sets a pending row with `company_id` explicitly: add `public.console_add_first_admin(p_company uuid, p_email text, p_full_name text) returns void` in a new migration `0093_console_first_admin.sql` (service_role only, postgres-owned, on the allowlist with a comment).
  - The active-user count reads `company_members`.
- [ ] **Step 3: Run** `npm test`, tsc and lint. Expected: PASS.
- [ ] **Step 4: Commit:** `fix(app): explicit company on service-role writes; nothing reads the old profile columns`.

### Task 7: The isolation proof

**Files:**
- Create: `web/tests/db/tenant-isolation.test.ts`
- Rewrite: `web/tests/e2e/isolation.spec.ts` for one database and two hosts

**Interfaces:**
- Consumes: everything above.
- Produces:
  - **The DB test, driven by the catalog.** Companies A and B each get an admin, an organizer, a viewer and a delegate. There's also a user with no membership, an unbound session and `anon`.
    - **Seeding:** seed one row per company table in each company, through the existing fixtures run in each company's bound session.
    - **Tables:** for every table in `app.company_tables()`, as each B role: `select` of A's rows returns 0; `update … where company_id = A` changes 0 rows; `delete` changes 0; `insert` with `company_id = A` fails.
    - **View:** the same for `stock_on_hand`.
    - **Functions:** every public function with a uuid argument (from the catalog), called as B's admin with A's ids, either raises the function's own error or changes nothing. Compare a per-table checksum of A's rows before and after.
    - **Review Focus 1:** active in A, inactive in B, bound to B: zero rows everywhere, and every edit function is refused.
    - **Review Focus 3:** for `place_implant_v3`, `receive_stock`, `create_surgery_slot` and `record_consent` with A's ids, the error is the normal not-found message, not a permission error.
  - **E2E:**
    - Two tenants on the local stack, with hosts `a.localhost` / `b.localhost` and `TENANTS_FILE`.
    - A's admin can't see B's patients, users, stock, Statistics or exports.
    - A's admin posting B's user ids to every admin action gets `User not found.`
    - A cookie used on the wrong host is refused (reuse `company-session.spec.ts` helpers).

- [ ] **Step 1: Write both tests.** Run them against the code from before Tasks 2–6, for example by checking out the commit before 0089 in a scratch worktree, and record that they FAIL there. Then run them on HEAD: PASS.
- [ ] **Step 2: Commit:** `test: one-database isolation proof (DB and E2E)`.

### Task 8: Provisioning a company

**Files:**
- Create: `web/supabase/migrations/0094_provision_company.sql`
- Modify:
  - `web/supabase/control/migrations/0005_provision.sql` (if the control functions need a column or a change)
  - `web/src/app/console/(admin)/actions.ts` (register)
  - `web/scripts/tenants.ts` (`tenant:register`)
- Test: `web/tests/db/one-db-provision.test.ts`, plus the console action tests

**Interfaces:**
- Produces:
  - **`public.provision_company(p_slug text, p_name text) returns uuid`**, service_role only and postgres-owned (allowlisted). It inserts `companies` and seeds that company's `settings`, `branding` (name), the product catalogue (copied from academy's active non-sample products: the same columns, new ids, `company_id` set) and the consent form versions (copied the same way). It returns the id, and refuses a duplicate slug.
  - **Console register:** it calls `provision_company` through the company database's service role and saves the id to the control `tenants.company_id`. After that, `console_add_first_admin` (Task 6) creates the first admin.
  - **`tenant:register --provision`:** does the same from the CLI.

- [ ] **Step 1: Failing DB test.** `provision_company('canary', 'Canary')` creates exactly one company with one `settings` row, one `branding` row named `Canary`, a product count equal to academy's active non-sample count, and consent versions. A second call raises.
- [ ] **Step 2: Failing console test.** The register action stores the returned company id.
- [ ] **Step 3: Implement, then run** `npm run test:db -- one-db-provision` and `npm test -- console`. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(console): provision a company in the shared database (0094)`.

### Task 9: Operations, per company

**Files:**
- Create: `web/scripts/company-export.ts`, `web/scripts/company-restore.ts`
- Modify:
  - `web/scripts/migrate-all.ts` and the backup workflow's company loop (`.github/workflows/backup.yml`): once per distinct `database_url`
  - `web/scripts/workflows.test.ts`
  - `docs/operations.md` §D (rewrite)
- Test: `web/scripts/company-export.test.ts`, `web/tests/db/one-db-company-restore.test.ts`

**Interfaces:**
- Produces:
  - **`company-export --tenant <slug> --out <file>`** writes one company's rows from every company table, plus its `company_members`, `profiles` and `auth.users` rows, as JSON per table, in FK order.
  - **`company-restore --tenant <slug> --in <file>`** refuses a non-matching `company_id`. In one transaction it deletes that company's rows in reverse FK order and reloads them. It writes a log.
  - **Distinct databases:** `migrate --all-tenants` and the backup loop dedupe tenants by database host and ref.
  - **§D in `docs/operations.md`:** whole-database restore (existing), per-company restore (new), and per-company deletion for a data-protection request.

- [ ] **Step 1: Failing tests:**
  - Export then restore company B into the shared local DB leaves A's per-table counts and md5 unchanged (Review Focus 4), and B's rows match the export exactly.
  - `workflows.test.ts` asserts the dedupe.
- [ ] **Step 2: Implement, run the tests, commit:** `feat(ops): per-company export, restore and one migration per database`.

### Task 10: The window, rehearsed

**Files:**
- Create: `web/scripts/window-checksums.ts`, `docs/one-database/release-4-runbook.md`
- Delete: `web/scripts/one-db-check.ts` (one company only); keep `session-check.ts`

**Interfaces:**
- Produces:
  - **`window-checksums --tenant academy --out <file>`** writes, per table in `public` / `app_private` / `auth`, the row count and the md5 of all rows ordered by primary key with `company_id` excluded, inside `begin read only`.
  - **`--compare <before> <after>`** exits 1 on any difference, `audit_log` and `auth` session tables aside, listing them.
  - **`release-4-runbook.md`** gives the owner steps with exact commands:
    1. suspend academy in the console;
    2. take the pre-window dump (`backup:pre-one-db --tenant academy --out …/pre-window`);
    3. take the before checksums;
    4. ship `one-db-release-4`;
    5. take the after checksums and compare them;
    6. run `session-check` and the smoke test (sign in with 2FA, patient, booking, stock, Statistics, export);
    7. lift the suspension.

    It also gives the rollback (restore the pre-window dump per `RESTORE.md`, redeploy release 3) and the advisors (`supabase db lint` locally beforehand; dashboard Security and Performance advisors afterwards).

- [ ] **Step 1: Rehearsal 1.** Restore the latest academy dump (`D:\Backups\implant-course\pre-one-db\academy`) into a fresh dev2 with `restore-check`. Migrate it up to 0088 (`ENV_FILE=… npm run db:migrate`, which applies only what's missing), take checksums, apply 0089–0094, take checksums, compare. Time it. Expected: compare PASS, under 30 minutes.
- [ ] **Step 2: Run** `npx supabase db lint` on the local stack and fix every warning. List any left with a reason in the runbook.
- [ ] **Step 3: Rehearsal 2** from fresh, timed. Record both times in the runbook.
- [ ] **Step 4: Full verification:** tsc, lint, `npm test`, `npm run test:db`, and the full E2E in parts (`auth admin admin-user-tools invite delegate-portal delegates permissions password-reset patients schedule implants statistics checklists courses isolation company-session`). Use one sequential run per part, with nothing on :3000.
- [ ] **Step 5: Commit** the runbook, scripts and lint fixes. The owner runs the window from `one-db-release-4`.

### Task 11: Release 5 cleanup and the canary

**Files:**
- Create: `web/supabase/migrations/0095_cleanup.sql`, `docs/one-database/release-5-canary.md`

**Interfaces:**
- Produces **0095**, which must run with release 4 live. It drops:
  - `profiles.role`, `active`, `delegate_id`, `mfa_setup_required` and `unique (delegate_id)`;
  - `branding_public()` / `branding_logo()`;
  - the global uniques replaced in 0091 (`patients_file_no_key`, `patients_file_no_upper_key`, `chairs_name_key`, `consent_form_versions_label_key`, `checklist_templates_one_default`);
  - the boolean `id` columns of the singletons;
  - `_company_id_idx` wherever a `_company_id_key` already leads with `company_id`.

  The guards stay green.
- Produces **`release-5-canary.md`**, the owner steps:
  1. ship `one-db-release-5`;
  2. provision `canary` in the console with host `canary.imploid.net` (Vercel domain plus registry host), and create its first admin;
  3. sign in to the canary;
  4. run the read-only isolation check `scripts/canary-check.ts`, which counts academy's rows visible to a canary session through PostgREST (expected 0 for every table) using a canary user's signed-in session;
  5. suspend the canary;
  6. pause the old projects: none here, since academy stayed in place.

- [ ] **Step 1: Failing test:** the guard test asserts that none of the dropped objects exist. Add the names to a `DROPPED` list and run it. Expected: FAIL.
- [ ] **Step 2: Write 0095 and `canary-check.ts`,** the latter with a unit test for its pure part. Run the full `test:db` and E2E `auth admin delegates`. Expected: PASS.
- [ ] **Step 3: Commit:** `chore(db): drop the pre-company columns, readers and uniques (0095); canary runbook`.
