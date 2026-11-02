# All companies in one database: design

Date: 2026-11-02. Status: draft for the owner's approval.
Supersedes sub-project 1 of the 2026-10-31 plan (`~/.claude/plans/plan-database-migration-to-tranquil-sutherland.md`), whose isolation findings this design keeps.

## Why

Implant Course runs one Supabase project per company. Supabase Free allows two active projects (prod and the control project use both), and each extra company would cost a Pro project. The owner wants every company in **one** database, with every row belonging to a company and no company ever able to see another's data.

This is step 1 of the move to AWS (`D:\Claude\Claude Code\Platform\docs\superpowers\specs\2026-10-30-aws-migration-design.md`). Step 2 replaces Supabase Auth with a shared sign-in module, and step 3 moves the database to Postgres on AWS Lightsail. So this step keeps the database plain Postgres and puts everything that depends on Supabase Auth behind two functions.

## Goals

- One Supabase project (the existing prod project) serves every company.
- Every company-owned row has `company_id uuid not null` with a foreign key to `companies` and an index.
- Company isolation is enforced in the database, so that a missed check in the app can't leak data.
- The web address picks the company, and the server checks that the signed-in user belongs to it.
- One login can belong to several companies, with a role and permissions in each.
- No policy or function calls `auth.uid()` or reads JWT claims directly, apart from `app.current_user_id()` and `app.current_company_id()`.

## Non-goals

- New features, UI redesign, other sign-in methods, or moving off Supabase.
- Importing another company's existing data. No second company has data today. A future company starts empty through provisioning.
- Automated self-service onboarding (multi-tenant part 5).

## Anti-goals (a failure even if it works)

- Any path where one company's user sees, lists, changes or deletes another company's rows: tables, the view, functions, exports, Statistics, admin actions or service-role code.
- 2FA silently stops being enforced. The 10-31 plan found that `mfa_satisfied` would pass everyone if run as the wrong owner.
- Academy loses data, IDs, passwords or 2FA, or is down for more than the planned hour.
- A release that the previous app version can't run against (Releases migrate before deploying; see the root `CLAUDE.md`).

## Constraints and facts (Step 0 findings, local catalog at migration 0082)

- **One real company:** academy. Its data **stays in place** in the prod project (owner's decision). Nothing is copied, IDs don't change and password hashes don't move.
- **49 tables:** 47 in `public`, plus `app_private.research_codes` and `schema_migrations`.
  - No table has a company column.
  - All primary keys are uuid, apart from these:
    - `audit_log` uses a bigint identity, which is fine in place.
    - `settings`, `branding` and `branding_logos` are singletons keyed by a boolean.
    - `research_codes` and `schema_migrations` are keyed by text.
- **RLS:** on for all public tables, forced on none. `research_codes` has RLS off.
- **Policies and functions:** 174 policies, 4 of which call `auth.uid()` directly.
  - 111 security-definer functions, all with `search_path = ''`. `auth.uid()` appears in 24 of them.
  - `anon` can execute `is_admin`, `is_active_user`, `product_category`, `branding_public` and `branding_logo`. The last two serve the login page.
- **View and triggers:** one view, `stock_on_hand`, already `security_invoker`. 86 triggers, including `on_auth_user_created` on `auth.users`. No pg_cron.
- **Files:** no Storage buckets. Files are bytes in `stored_files` and `branding_logos`.
- **Vault and Auth:** company databases hold no Vault secrets. The control project's Vault holds `tenant/<slug>/service_role_key` and `tenant/<slug>/database_url`.
  - Supabase Auth allows one account per email per project.
- **Browser access:** the browser holds the session token. It only uses Supabase to sign out, but it *could* call PostgREST directly with any headers. So nothing the browser sends can name the company.
- **Downtime:** a one-hour maintenance window can be scheduled at any time (owner).
- **Free plan:** no third project. Rehearsals run on local stacks.

## Design

### 1. Companies and the two helper functions

- `public.companies (id uuid pk, slug text unique, name text, created_at)`. Academy's row is inserted with a fixed uuid literal, so migrations can reference it.
- A new schema `app`. `authenticated` and `anon` get usage on it; it isn't exposed through PostgREST. It holds the only code allowed to touch Supabase Auth:
  - `app.current_user_id()` returns `auth.uid()`.
  - `app.current_company_id()` returns the company of the current sign-in session (§3), or null.
  - Both are `stable`, `security definer`, `search_path = ''`, and owned by `postgres`.
- Every policy and function that today calls `auth.uid()` or `auth.jwt()` is redefined (new migrations, `create or replace` of the latest definition) to call these instead.
  - This includes `is_active_user`, `is_admin`, `can`, `require_perm`, `require_active`, the `mfa_*` helpers and the 4 direct policies.
  - The `mfa_*` helpers still read `auth.mfa_factors`, and the `aal` claim moves behind a third helper, `app.current_aal()`. **(My call:** a third helper rather than folding it into `current_user_id`, because step 2 must replace it too.)
- A catalog test fails if anything outside `app` mentions `auth.uid`, `auth.jwt` or `request.jwt`.

### 2. `company_id` on every company-owned table

- Every table in `public` except `companies` and `profiles` (the person, §4), plus `app_private.research_codes`, gets `company_id uuid not null references companies` and an index.
- In the additive release, the column is added with **academy's uuid as a constant default**. Postgres fills existing rows without an UPDATE, so the append-only `stock_movements` and `audit_log` triggers don't fire and the ledger isn't rewritten.
- The default is replaced by `app.current_company_id()` in the enforcement release, so new rows take the caller's company.
- Definer functions that insert on behalf of a company set it explicitly from `app.current_company_id()`.
- **Composite keys:** every company table gets `unique (company_id, id)`. Every table-to-table foreign key becomes composite, `(company_id, x_id) references t (company_id, id)`, under the same constraint name, so PostgREST embeds don't change. A row can then never point at another company's row, even through a definer that is handed a foreign uuid.
- **Singletons:** `settings`, `branding` and `branding_logos` become one row per company, with `company_id` as the primary key. Functions that use `on conflict (id)` change to `on conflict (company_id)`.
- **Per-company uniques:**
  - `patients.file_no` and its `upper(file_no)` index
  - `chairs.name`
  - `consent_form_versions.label`
  - `checklist_templates_one_default`
  - the `file_no` counter
  - advisory-lock keys, which gain the company
  - `protect_last_admin`, which applies per company

  Uniques already scoped by a parent row stay as they are. Their parent is company-scoped through the composite keys.
- **`audit_log`** gains `company_id`, taken from NEW/OLD in `audit_row()`. It remains the record of who changed what, so no new audit table is needed.

### 3. How a request gets its company

- **Host → company:** the control registry's `tenants` row gains `company_id`. Every company's row points at the same Supabase project. The middleware keeps doing what it does today (Host → tenant → trusted `x-tenant`; unknown host 404, suspended 503), and `currentTenant()` now also returns `company_id`.
- **Membership** (§4) is checked by the server at every sign-in:
  - password sign-in
  - MFA completion
  - the invite and recovery links in `/auth/confirm`
- **Session binding:** a new table `app.session_companies (session_id uuid pk, company_id, user_id, created_at)`, which no API role can read or write.
  - After a successful sign-in, the server calls `app.bind_session(company_id)` (definer, executable by `authenticated`).
  - That function reads the `session_id` claim, checks that the caller has an active membership in that company, and inserts the row.
  - It refuses if the session is already bound to a different company. A session belongs to one company for life.
  - `app.current_company_id()` looks the session up. It returns null for an unbound session, so every company policy denies.
- **Every request:** `currentTenant()` compares the session's company with the host's company. On a mismatch (for example a cookie or token carried to another company's host) the server signs that session out and redirects to `/login`.
- Cookies are per host, so signing in to two companies in one browser gives two independent sessions.
- Stale `session_companies` rows are deleted when their `auth.sessions` row is gone, by a cleanup in an existing server path. **(My call:** no pg_cron.)
- **Why not a JWT claim:** a claim in the token would need a Supabase Auth hook (Supabase-only) and couldn't follow the web address. The session table is plain Postgres. In step 2 only the source of `session_id` changes.

### 4. Users and companies

- **The person and the membership are separate tables (owner's decision, 2026-11-02):**
  - **`public.profiles`**: one row per login (`user_id` pk → `auth.users`), holding only the person's details: `full_name` and `email`. It isn't company-owned and has no `company_id`.
    - A user reads their own row, plus the rows of people who share a company with them, through a policy that joins `company_members` on `app.current_company_id()`.
    - The catalog guards allowlist it as the one table without `company_id`.
  - **`public.company_members (company_id, user_id, role, active, delegate_id, mfa_setup_required, created_at, updated_at)`**, with primary key `(company_id, user_id)` and `user_id` → `profiles`.
    - Role, active status and the 2FA setup flag are per company.
    - A delegate login links to that company's delegate, through a composite foreign key.
    - It gets the same four company policies as every other table.
- **Moving from `profiles` (stays compatible with the previous app version):**
  - The additive release creates `company_members` and fills it from `profiles` (academy).
  - The company-aware app release reads and writes `company_members` only.
  - While the previous version may still run, a trigger keeps `profiles.role`, `active`, `delegate_id` and `mfa_setup_required` in step with academy's membership row.
  - The cleanup PR drops those columns, the trigger and `unique (delegate_id)` from `profiles` once the new app has deployed (the 0024 → 0025 pattern).
  - `is_active_user()`, `is_admin()`, `can()`, `require_perm()`, `is_delegate_user()` and `my_delegate_id()` read the caller's `company_members` row for `app.current_company_id()`.
- `user_permissions` gains `company_id` (`(company_id, user_id, area)`) and references `company_members (company_id, user_id)`.
- The foreign keys that point at staff today (checklist assignee, lead organizer, fitted by, uploaded by, `admin_events`) move from `profiles (user_id)` to `company_members (company_id, user_id)`, so an assignee must be a member of the same company. Embeds keep the existing constraint names where PostgREST uses them.
- **Same email in two companies:** one Auth account, one password and one 2FA setup, with a membership row per company.
  - Creating a login in company B for an email that already has an account only adds a membership. No second Auth user and no invite are created, and an app email ("you've been added to B") goes out through `sendEmail`.
  - Admins of B can't reset the password, change the email or reset 2FA of a user who is also a member of another company. Those act on the shared account, so the console does them instead. **(My call.)**
- **2FA (my call):** factors belong to the Auth account, so a factor set up in one company applies in all of them, and aal2 is required wherever the account has a verified factor (today's rule). `mfa_setup_required` (0074) stays per membership. Reset 2FA on a user shared with another company is refused with "ask support". The console tool for shared accounts is deferred, because no shared users exist yet.
- **Product catalogue (my call):** each company gets its own copy of the Oxy catalogue at provisioning, because stock, lots and edits are per company. `products` follows the same `company_id` rule as every other table.
- **Removing a user:** `delete_user` removes the membership. The Auth account is deleted only when its last membership goes.
  - `admin_end_sessions` ends only the sessions bound to the admin's company.
  - The **Last sign-in** column reads `auth.users`, and stays global.
- **New accounts:** `handle_new_user` no longer creates a profile on its own. The server writes a `pending_logins (company_id, email, role, …)` row before calling Auth's invite or create, and the trigger turns it into the membership. If no pending row exists, the trigger raises an error.
- **Service-role code (fix first, harmless today):** every action in `src/lib/admin/auth-accounts.ts` and `admin/users/actions.ts` asserts that the target user is a member of the caller's company before calling Auth.
  - Today `resetPassword` has no database check.
  - `createLogin` can delete an unconfirmed account belonging to someone else.
  - `changeAuthEmail` changes Auth before running its check.
  - `listSignIns` is filtered to members.
- **Console admins** stay in the control project's own Auth, apart from company users.

### 5. Policies

- **RLS is enabled and forced on every table** in `public` and `app_private`, including `research_codes` and `schema_migrations`. Forcing it doesn't affect `postgres`, which has BYPASSRLS; it covers any future non-bypass owner. A catalog test fails if any table has it off.
- **Four restrictive policies per table**, one each for select, insert, update and delete, named `<table>_company_<cmd>`:
  - select and delete use `using (company_id = (select app.current_company_id()))`
  - insert uses `with check (…)`
  - update uses both, so a row can't be moved to another company

  These are combined (AND) with the existing role and area policies, which stay as they are. They're generated with the 0034 loop pattern.
- **Definer functions:**
  - **The approach to prove first (10-31 plan, item 5):** most definers are owned by a new `tenant_definer` role, which is NOBYPASSRLS, with a permissive `using (true)` policy for it. The company policies then apply inside those functions with no hand edits. A function handed another company's uuid finds nothing.
  - **Stay owned by `postgres`, on a fixed allowlist:** `app.*`, `mfa_satisfied`, `mfa_setup_done`, `handle_new_user`, `default_permissions`, `audit_row`, the `auth.sessions` helper split out of `admin_end_sessions`, and the pre-login branding readers. Each of these checks the company explicitly.
  - `scripts/migrate.ts` asserts the owner allowlist inside each migration's transaction, so a new definer that skips it fails the release. That's how it fails closed.
  - **If the spike fails** (hosted Supabase doesn't let `postgres` set this up), the fallback is an explicit `company_id = app.current_company_id()` check in every definer. That's about 111 functions, done table group by table group with subagents.
- `execute` is revoked from `public` and `anon` on every definer, with one exception: `branding_for(p_company uuid)` and `branding_logo_for(p_company uuid)`, the new pre-login readers.
  - The login page passes the host's company to them. Branding is public by nature (a company's own name and logo on its own sign-in page).
  - `is_admin`, `is_active_user` and `product_category` lose `anon`.
  - The old `branding_public` and `branding_logo` are dropped in the second app PR.
- The view `stock_on_hand` keeps `security_invoker = true`.

### 6. Files and secrets

- There are no Storage buckets, so the `<bucket>/<company_id>/…` layout doesn't apply. `stored_files` and `branding_logos` carry `company_id` and the same policies as every other table, and file readers (`consent_file`, logo) return nothing across companies. If Storage is ever added, the layout is `<bucket>/<company_id>/…` with a policy on the first path segment.
- **Vault:** the secrets belong to the database, not the company: one service-role key and one database URL.
  - The control project stores them once, as `database/<project-ref>/service_role_key` and `…/database_url`, and each `tenants` row references its database.
  - Per-company secrets (none exist yet) would be keyed `company/<company_id>/<name>`.
  - Only the server reads Vault, through the existing `tenant_secret`-style definer, which isn't granted to any API role. **(My call.)**
- The service-role key stays server-only: `src/lib/supabase/admin.ts` and scripts. A test (extending the existing one) fails if any `NEXT_PUBLIC_*` value or client bundle references it.

### 7. Console, provisioning and operations

- `console_register_tenant` gains a company step: `provision_company(slug, name)` in the prod database (service role, not granted to API roles).
  - It inserts `companies` and seeds settings, branding, the product catalogue and consent versions.
  - It returns `company_id`, which is saved on the `tenants` row.
- `migrate --all-tenants`, `tenant:check`, `tenants:export` and the backup workflow run **once per distinct database**, not per company.
- Nightly backups stay whole-database. A per-company export script (`scripts/company-export.ts`) writes one company's rows for restore or a deletion request.
- `docs/operations.md` §D is rewritten. Its `TRUNCATE … CASCADE` restore would wipe every company. It's replaced by a whole-database restore plus a per-company restore that deletes and reloads one company's rows in FK order.

### 8. Tests and checks before cut-over

- **`tests/db/tenant-isolation.test.ts`, driven by the catalog.** Two companies, with an admin, an organizer, a viewer and a delegate in each, plus a user with no membership, an unbound session and `anon`.
  - For every table and the view, B sees 0 of A's rows, and B's insert, update and delete against A's rows fail or change nothing.
  - Every function with uuid arguments, called by B with A's ids, returns nothing and changes nothing.
  - A user who is a member of both companies, on a session bound to A, sees only A.
- **Catalog guards:**
  - RLS enabled and forced on every table
  - four company policies on every company table
  - an index on every `company_id`
  - no single-column FK between company tables
  - no unique constraint without `company_id` (allowlist for parent-scoped ones)
  - the definer owner allowlist
  - no `auth.*` reference outside `app`
  - no definer executable by `anon` outside the allowlist

  `tests/db/permissions.test.ts:276` gets its `_area_` filter, so it can't pass vacuously.
- **E2E:**
  - `isolation.spec.ts` is rewritten for one database.
  - A's admin posts B's user ids to every admin action.
  - A session cookie used on the wrong host is refused.
  - An aal1 session with a verified factor is denied.
  - Invite, reset and delete flows still work.
- **Advisors:** `supabase db lint` on the local stack, plus the dashboard security and performance advisors on prod after cut-over. Every warning is fixed or explained in the cut-over notes.

### 9. Restore points (Step 1, before any change)

- **Code:** tag `pre-one-db-2026-11` on `master`; work on branch `one-database` in its own worktree.
- **Prod and control databases:** `pg_dump --format=custom` (all schemas, including `auth`) plus a schema-only dump, both to `D:\Backups\implant-course\pre-one-db\<academy|control>\`.
  - Settings (project ref, Auth providers, redirect URLs, email templates, Vault secret names, and env variable names with their values) go in a file in the same folder, never in the repo or chat.
  - The folder also records the plan's backup status and the latest backup time.
- **Storage:** none to download (no buckets), recorded as such.
- **Proof:** the academy dump is restored into a fresh local stack, and row counts per table are compared with prod (`begin read only`).
- **`RESTORE.md`** in the backup folder records the exact commands. A secret-free copy goes into the repo with the cut-over notes.

### 10. Releases and cut-over

Each release must stay compatible with the previous app version.

1. **Service-role assertions** (app only; harmless while there's one company).
2. **Additive schema, no downtime:** `companies`, academy's row, the `app` schema and helpers (not used yet), `company_id` with academy's constant default, composite uniques, `session_companies`, `pending_logins`, new readers.
3. **App company-aware:** binds sessions at sign-in, checks the host, uses the new readers, `pending_logins` and membership-scoped admin actions. It also sends invite and recovery links through `{{ .RedirectTo }}` with `https://*.imploid.net` allowed. Sessions signed in before this release are bound to academy by a backfill.
4. **Enforcement, in the one-hour window, as one transaction:**
   - swap the FKs to composite
   - redefine functions and policies to the helpers
   - assign `tenant_definer` ownership
   - add and force the policies
   - switch the defaults to `app.current_company_id()`
   - add the `migrate.ts` check

   The app is unchanged, because every row is academy.
   - **Before the window:** checksums are taken.
   - **After it:** row counts and an md5 of each table's rows ordered by id (excluding the new column) are compared, with every `company_id` = academy, and an academy smoke test is run (sign in with 2FA, patient, booking, stock, Statistics, export).
5. **Cleanup PR:** drop the global uniques and the old pre-login readers after (4) has deployed.
6. **Canary:** provision a synthetic company in prod on a test host, run the isolation checks against prod (read-only for academy), then suspend it.

- **Running the window (my call):** the owner suspends academy in the console (the app answers 503), runs Release with `./scripts/ship.sh ship` (auto mode blocks Claude from prod), and lifts the suspension after the checks pass. No `release.yml` change is needed.
- **Auth settings (my call):** release 3's app sends `redirectTo` first. After it's live, the owner adds `https://*.imploid.net` to the allowed redirect URLs and switches the invite and recovery templates to `{{ .RedirectTo }}`, then tests an academy invite at once. The cut-over notes list the old values so they can be reverted.
- **Spike (my call):** the `tenant_definer` spike is the first piece of work. It runs on the local stack, then once on prod inside a transaction that is rolled back (the owner runs it; `create role` and `alter function … owner` are transactional). The plan takes the definer approach only if both pass; otherwise it takes the fallback.
- **Rehearsal:** steps 2–4 run twice, timed, on a fresh local stack restored from the prod dump, before the window. The window opens only if both rehearsals pass the checksum comparison within 30 minutes.
- **Rollback:**
  - Before (4) commits, nothing changes.
  - After (4), if academy is broken, restore the pre-window dump taken at the start of the window. That loses nothing, because the app is offline during the window.
  - Code rolls back by redeploying the previous release.
  - The control project only gains columns, so it needs no rollback.

## Left to the builder

- Migration numbering and how to split work into PRs within the release order above.
- The exact names of tests and scripts, and the session-cleanup trigger point.
- Grouping of tables for parallel subagents.
- The content of the "added to company" email.

## Calls made in this document (owner to check)

1. `profiles` keeps only the person's name and email and has no `company_id`. Everything company-specific moves to `company_members`, with a sync trigger until cleanup (§4; the separate table itself is the owner's decision).
2. The company comes from a session-binding table, not a JWT claim (§3).
3. A third helper, `app.current_aal()`, for 2FA level (§1).
4. Admins can't reset passwords, emails or 2FA of a user who also belongs to another company (§4).
5. Vault secrets are keyed per database, not per company, while there's one database (§6).
6. Rehearsals run on local stacks, not a fresh hosted project (Free plan limit) (§10).
7. The "merge script" isn't built. Academy stays in place, and new companies come through `provision_company` (§7).
8. 2FA factors are per account and the setup flag is per company. Reset 2FA on shared users is deferred to a later console tool (§4).
9. Each company gets its own copy of the product catalogue (§4).
10. The window is run by suspending academy in the console, then running Release (§10).
11. The Auth redirect and template changes are made by the owner, after release 3 is live (§10).
12. The `tenant_definer` spike comes first: local, then a rolled-back transaction on prod (§10).
