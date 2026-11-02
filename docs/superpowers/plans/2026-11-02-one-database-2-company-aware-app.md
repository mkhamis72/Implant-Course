# One database, plan 2: the company-aware app (release 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app knows each request's company. The host gives the company. Every sign-in session is bound to it after a membership check, and a session used on another company's host is signed out. Roles, active status and permissions are read and written per company through `company_members`. New logins carry their company, and the same email can belong to two companies. Academy sees no change.

**Architecture:** The control registry maps a host to a tenant, which now also carries `companyId`. Sessions are bound through a `public` wrapper around `app.bind_session` (PostgREST doesn't serve schema `app`).
- **Binding rule:** `getCurrentProfile()` binds an unbound session lazily to the host's company, provided the user is an active member there. A session bound to another company is signed out. This replaces the spec's one-time backfill, and it also covers sessions created by the previous app version during the release window and sessions after a restore.
- **Membership writes:** they go through new definers. A reverse mirror keeps academy's `profiles` columns in step while the previous version may still run.
- **Out of scope:** enforcement (policies, `tenant_definer`, default switch, composite FKs) is plan 3.

**Not in this plan (plan 3):** policies and the company default switch; `tenant_definer`; composite FKs; per-company uniques; `audit_row` company; console provisioning (`provision_company`; `lib/console/first-admin.ts` still writes `profiles`); per-company backups and §D; dropping the old `profiles` columns and the readers `branding_public` / `branding_logo`.

**Tech Stack:** Next.js 15 server actions and route handlers, `@supabase/ssr`, plpgsql migrations (`web/supabase/migrations`, control: `web/supabase/control/migrations`), Vitest unit, DB and component tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-one-database-design.md` (§3, §4, §10 step 3). Rulings and notes from plan 1 are in `docs/one-database/plan-1-notes.md`.

## Global Constraints

- **Where to work:** the worktree `D:\Claude\Claude Code\implant-course-one-db`, on branch `one-database`. Run commands from `web/`. Prod is owner-run.
- **Fixed ids and messages:** academy is `a7c0de00-0000-4000-8000-000000000001`.
  - Membership refusal message: exactly `You do not have access to this company.`
  - Refusal for shared users: exactly `This user also belongs to another company. Ask support to change their sign-in details.`
- **New SQL:** no `auth.uid()` / `auth.jwt()` outside schema `app`. Use `app.current_user_id()`, `app.current_company_id()`, `app.current_aal()`.
- **Migrations:** new ones start at `0086` (control: `0004`). Each starts with `set local lock_timeout = '5s';`, and none edits an applied migration. They must be additive: the previous app version (release 2) must keep working for the minutes between migrate and deploy.
- **Definers:** `security definer set search_path = ''`, `revoke … from public, anon`, then grant `authenticated`. Admin-only definers check `public.is_admin()` and raise `app_private.fail('Only admins can do this.')`.
  - New public definers that aren't area-scoped go on the `permissions.test.ts` allowlist with a comment citing spec §3/§4.
- **Tables:** new tables get RLS enabled and forced, explicit grants, and the audit trigger. A new table in `public` automatically becomes a company table via `app.company_tables()`; put global tables in `app_private`.
- **Seeds and restore:** a migration that seeds rows adds its table to `docs/operations.md` §D TRUNCATE.

## Review Focus

1. **A session with no binding** (signed in by the previous version during the release window, or after a restore) is bound on its first request to the host's company if the user is a member there. Otherwise it is signed out. *Test in Task 3.*
2. **A member deactivated in their company** after signing in is signed out on their next request with `You do not have access to this company.`, not shown a blank page. *Test in Task 3.*
3. **An invite or recovery link opened on another company's host** binds the new session to that host's company only if the user is a member there. Otherwise it goes to `/auth/error`. *Test in Task 3.*
4. **The last active admin of a company** can't be demoted or deactivated through the new definers, even while another company has admins. *Test in Task 5.*
5. **A delegate login** still lands on `/my` after signing in, with the role read from `company_members`. *Test in Task 3.*

---

### Task 1: Tenants carry their company

**Files:**
- Create: `web/supabase/control/migrations/0004_tenant_company.sql`
- Modify: `web/src/lib/tenant/types.ts` (`Tenant`), `web/src/lib/tenant/control.ts:39` (select), `web/src/lib/tenant/static.ts` (schema plus the single-tenant default), `web/scripts/tenant-register.ts` (optional `--company <uuid>`)
- Test: `web/src/lib/tenant/control.test.ts`, `web/src/lib/tenant/static.test.ts`, `web/tests/db/control.test.ts`

**Interfaces:**
- Produces:
  - `Tenant.companyId: string`. It is never empty for a tenant the app routes to.
  - Control `public.tenants.company_id uuid`, nullable, with `update … set company_id = 'a7c0de00-…0001' where slug = 'academy'` in the migration.
  - Static and `TENANTS_FILE` entries gain an optional `companyId`, defaulting to academy's id. The env single-tenant mode uses academy's id.
  - A control row with `company_id` null maps to a tenant with status `suspended`, so it is answered with 503, never routed.

- [ ] **Step 1: Failing tests.**
  - `control.test.ts`: a row with `company_id` maps to `companyId`; a row with null maps to `status: 'suspended'`.
  - `static.test.ts`: an entry without `companyId` gets academy's id; an env-only config gets academy's id.
  - DB `control.test.ts`: after 0004, academy's row has the academy id.
- [ ] **Step 2: Run** `npm test -- tenant` and `npm run test:db -- control`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration and the TS changes. `tenant-register --company <uuid>` writes `company_id` (and keeps an existing value when omitted).
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(tenant): tenants carry their company id`.

### Task 2: Migration 0086, session wrappers and company readers

**Files:**
- Create: `web/supabase/migrations/0086_session_wrappers.sql`
- Test: `web/tests/db/one-db-session.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (allowlist)

**Interfaces:**
- Consumes: `app.bind_session(uuid)` and `app.current_company_id()` (0085), and `app.session_companies`.
- Produces (all `public`, postgres-owned definers):
  - **`bind_my_session(p_company uuid) returns void`** → `authenticated`. It calls `app.bind_session(p_company)`, then deletes the caller's `app.session_companies` rows whose `session_id` no longer exists in `auth.sessions` (stale cleanup).
  - **`my_session_company() returns uuid`** → `authenticated`. It returns `app.current_company_id()`.
  - **`branding_for(p_company uuid)`** and **`branding_logo_for(p_company uuid)`** → `anon, authenticated`. They return the same columns as `branding_public()` and `branding_logo()` (read their latest definitions), filtered to that company's row.
  - **`settings_for_me()`** isn't needed: settings reads add `.eq('company_id', …)` in Task 4.

- [ ] **Step 1: Failing tests.**
  - With claims `{sub: organizer, session_id: S1}`:
    - `bind_my_session(academy)` binds S1, and `my_session_company()` returns academy.
    - A stale row `(S0, academy, organizer)` with no `auth.sessions` row is gone afterwards.
    - A row for another user's stale session is untouched.
  - `bind_my_session(other company)` raises `You do not have access to this company.`
  - As `anon`, `branding_for(academy)` returns academy's name, and `branding_for(gen_random_uuid())` returns no row.
  - The permissions guard still passes.
- [ ] **Step 2: Run** `npm run test:db -- one-db-session`. Expected: FAIL.
- [ ] **Step 3: Write 0086.** For `auth.sessions` rows in tests, insert a real session row as postgres for S1; see how `admin-user-tools.test.ts` seeds sessions.
- [ ] **Step 4: Run** `npm run test:db -- one-db-session permissions`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): session binding wrappers and company branding readers (0086)`.

### Task 3: Sign-in binds the session; every request checks it

**Files:**
- Create: `web/src/lib/auth/company-session.ts`
- Modify:
  - `web/src/app/login/actions.ts` (`login`)
  - `web/src/app/auth/confirm/route.ts` (`GET`)
  - `web/src/lib/auth/session.ts` (`getCurrentProfile`, the `Profile` source)
  - `web/src/app/login/page.tsx` (shows `?error=company`)
- Test: `web/src/lib/auth/company-session.test.ts`, `web/src/app/login/actions.test.ts` (create if missing), `web/src/app/auth/confirm/route.test.ts`, `web/src/lib/auth/session.test.ts`, `web/tests/e2e/company-session.spec.ts`

**Interfaces:**
- Consumes: `currentTenant().companyId` (Task 1), and the `bind_my_session` / `my_session_company` RPCs (Task 2).
- Produces:
  - `bindSessionToCompany(supabase, companyId: string): Promise<'ok' | 'refused'>`. It calls `bind_my_session`. On any error it signs out locally (`auth.signOut({ scope: 'local' })`) and returns `'refused'`.
  - `ensureSessionCompany(supabase, companyId: string): Promise<'ok' | 'refused'>`. It reads `my_session_company()`. Null means bind (lazy). Equal means `'ok'`. A different company means sign out and return `'refused'`.
  - `getCurrentProfile()` calls `ensureSessionCompany` first. On `'refused'` it returns null, and the layout's redirect to `/login` then shows `?error=company`.
  - The profile is read from `company_members` for the tenant's `companyId` (`role, active, delegate_id, mfa_setup_required`), joined with `profiles (full_name, email)`, plus `user_permissions` filtered by `company_id`. A missing member row keeps today's "deactivated" fallback.
  - `login`: after `signInWithPassword`, call `bindSessionToCompany`. On `'refused'` return `{ error: 'You do not have access to this company.', email }`. The delegate redirect reads the role from `company_members`.
  - `confirm/route.ts`: after `verifyOtp`, call `bindSessionToCompany`. On `'refused'` redirect to `/auth/error?code=company`, and add copy for `company` in `app/auth/error/page.tsx`.

- [ ] **Step 1: Failing unit tests** (mock the Supabase client and `currentTenant`):
  - `ensureSessionCompany`: null then bind ok gives `'ok'`; null then bind error gives `'refused'` plus `signOut`; equal gives `'ok'` with no bind; different gives `'refused'` plus `signOut`.
  - `login`: a bind refusal returns the exact message.
  - `login`: a delegate member is redirected to `/my`.
  - `confirm`: a bind refusal redirects to `/auth/error?code=company`.
  - `getCurrentProfile`: a `'refused'` result gives null, and the role comes from the member row.
- [ ] **Step 2: Run** `npm test -- company-session login confirm session`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run** the same command, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: E2E** `company-session.spec.ts` (Review Focus 1–3):
  - **Setup:** a `TENANTS_FILE` with two tenants on the **same** local stack. `a.localhost` maps to academy. `b.localhost` maps to a company B, seeded through the API fixture as postgres, with the organizer test user **not** a member.
  - Sign in at `a.localhost:3000`, copy the auth cookies to `b.localhost:3000`, then load `/`. Expected: redirected to `/login`, and that session is ended.
  - Delete the session's `session_companies` row as postgres, then reload on `a.localhost`. Expected: still signed in, and the row is back.
  - Deactivate the member row as postgres, then reload. Expected: `/login?error=company` shows `You do not have access to this company.`
  - Run it with `TENANTS_FILE=… npx playwright test company-session --project=chromium` (see how `isolation.spec.ts` uses `TENANTS_FILE`). It skips without one.
- [ ] **Step 6: Commit:** `feat(auth): bind each session to the host's company and check it on every request`.

### Task 4: Branding and settings read the host's company

**Files:**
- Modify: `web/src/lib/branding/get.ts` (`getBranding`), `web/src/app/brand/logo/route.ts` (or wherever `branding_logo` is called; grep for it), `web/src/lib/auth/session.ts` (`getSettings`)
- Test: `web/src/lib/branding/get.test.ts`, the logo route test, `web/src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `branding_for` / `branding_logo_for` (Task 2) and `currentTenant().companyId`.
- Produces:
  - `getBranding()` calls `branding_for({ p_company: companyId })`, and keeps falling back to the defaults on any failure, including no tenant.
  - The logo route calls `branding_logo_for`.
  - `getSettings()` adds `.eq('company_id', companyId)`.

- [ ] **Step 1: Failing tests** asserting the RPC name and the `p_company` argument, the defaults on an RPC error, and the settings filter.
- [ ] **Step 2: Run** `npm test -- branding session`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(branding): read branding and settings for the host's company`.

### Task 5: Migration 0087, membership writes per company

**Files:**
- Create: `web/supabase/migrations/0087_member_writes.sql`
- Test: `web/tests/db/one-db-member-writes.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (allowlist)

**Interfaces:**
- Consumes: `company_members`, `app.current_company_id()`, and the latest definitions of `delete_user`, `admin_end_sessions`, `admin_require_mfa_setup` and `protect_last_admin` (grep for the last migration defining each).
- Produces:
  - **Staff read policy.** Add an extra **permissive** select policy on `company_members`: `company_id = (select app.current_company_id()) and (select public.is_active_user())`. Staff pickers read members of their own company.
  - **`public.set_member_role(p_user uuid, p_role public.user_role) returns void`** and **`public.set_member_active(p_user uuid, p_active boolean) returns void`**: admin-only, acting on the caller's bound company. Each raises `app_private.fail('User not found.')` when there's no member row there.
  - **`app_private.protect_last_member_admin()`:** a before update/delete trigger on `company_members`. It refuses to leave a company with no active admin, with the same message as the existing `protect_last_admin`.
  - **`app_private.sync_profile_from_member()`:** the reverse mirror. After insert/update on `company_members` **for academy rows only**, it copies `role, active, delegate_id, mfa_setup_required` into `profiles` when they differ (`is distinct from`). It is guarded like the forward sync.
  - **`admin_require_mfa_setup`:** redefined (same signature) to set `company_members.mfa_setup_required` for the caller's company. The mirror updates `profiles`.
  - **`admin_end_sessions(p_user)`:** redefined (same signature) to delete only `auth.sessions` whose id is bound to the caller's company in `app.session_companies`.
  - **`delete_user(p_user)`:** redefined (same signature). It deletes the caller's company membership, its `user_permissions` rows for that company, and its own checks stay as they are. It deletes the `profiles` row only when no membership remains.

- [ ] **Step 1: Failing tests** (create company B and a B membership for the viewer test user as postgres):
  - **`set_member_role`:** as the admin bound to academy, `set_member_role(viewer, 'admin')` changes only academy's member row and mirrors it to `profiles`. Called with a user who has no academy membership, it raises `User not found.` A non-admin raises `Only admins can do this.`
  - **Review Focus 4:** demoting the last active academy admin raises the last-admin message even though company B has an active admin.
  - **`admin_end_sessions`:** it deletes the viewer's academy-bound session and keeps their B-bound one.
  - **`delete_user`:** with a B membership, it removes the academy membership and keeps `profiles`. Without one, it removes `profiles` too.
  - **Forward sync:** the previous version's direct `update profiles set role` still flows to academy's member row (no regression).
- [ ] **Step 2: Run** `npm run test:db -- one-db-member-writes`. Expected: FAIL.
- [ ] **Step 3: Write 0087.**
- [ ] **Step 4: Run** the full `npm run test:db`. The only known failure allowed is `patient-functions > search_patients`.
- [ ] **Step 5: Commit:** `feat(db): per-company membership writes and reverse mirror (0087)`.

### Task 6: The admin and staff screens use memberships

**Files:**
- Modify:
  - `web/src/app/(app)/admin/users/actions.ts` (`setUserRole`, `setUserActive`, `removeUser`, `resetPassword`, `changeEmail`, `resetTwoFactor`)
  - `web/src/app/(app)/admin/users/page.tsx`
  - `web/src/lib/admin/same-company.ts`
  - `web/src/lib/admin/auth-accounts.ts`
  - the staff pickers in `checklists/[id]/page.tsx`, `courses/[id]/page.tsx` and `patients/[id]/chart-data.ts`
  - `delegates/actions.ts`, `delegates/[id]/page.tsx`
- Test: the existing colocated tests for each file

**Interfaces:**
- Consumes: Task 5's RPCs, and `currentTenant().companyId`.
- Produces:
  - **`memberOfMyCompany(userId)`** selects `company_members` by `user_id` and `company_id = companyId`, still through the admin's RLS client, and still fails closed.
  - **`sharedWithAnotherCompany(userId: string): Promise<boolean>`** (in `same-company.ts`) uses the **admin** client to count `company_members` rows for the user with `company_id <> companyId`. On error it returns true (fail closed).
  - **Shared users:** `resetPassword`, `changeEmail` and `resetTwoFactor` return the shared-user refusal message when it is true, before any Auth call.
  - **`setUserRole` / `setUserActive`** call `set_member_role` / `set_member_active`. `setUserRole` also gets the `memberOfMyCompany` check. The Auth ban in `setUserActive` happens only when the user has no other active membership.
  - **`removeUser`:** after `delete_user`, call `deleteAuthUser` only if the admin client finds no `profiles` row left for the user.
  - **Lists:** the users page and the staff pickers read `company_members` (role, active filter) joined with `profiles (full_name, email)`, for `companyId`. The delegate link reads `company_members.delegate_id`.

- [ ] **Step 1: Failing tests:**
  - For each of the three Auth actions: shared returns the exact message and makes no Auth call.
  - `setUserRole` refuses non-members with `User not found.`
  - `setUserActive` with another active membership calls no ban.
  - `removeUser` calls no `deleteAuthUser` when a profile remains.
  - A picker query uses `company_members` with the company filter. Assert this through the mocked client chain, following the existing tests.
- [ ] **Step 2: Run** `npm test -- admin checklists courses patients delegates`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): users, pickers and delegate links read company memberships`.

### Task 7: Migration 0088, new logins carry their company; existing accounts join

**Files:**
- Create: `web/supabase/migrations/0088_pending_logins.sql`
- Modify: `web/src/lib/admin/create-login.ts`, `web/src/lib/admin/notices.ts` (the added-to-company notice)
- Test: `web/tests/db/one-db-pending-logins.test.ts`, `web/src/lib/admin/create-login.test.ts`, `web/src/lib/admin/notices.test.ts`

**Interfaces:**
- Produces:
  - **`app_private.pending_logins`:** columns `(company_id uuid not null references public.companies, email text not null, full_name text not null default '', role public.user_role not null, delegate_id uuid, created_by uuid not null, created_at timestamptz not null default now(), primary key (company_id, email))`. RLS is forced and no API grants exist.
  - **`public.create_pending_login(p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid) returns void`:** admin-only. It upserts the pending row for the caller's company, with `created_by = app.current_user_id()`.
  - **`handle_new_user`,** redefined (same signature). It inserts the `profiles` person row with `full_name` from the pending row, if any. Then:
    - If one or more `pending_logins` rows exist for `lower(new.email)`, it inserts a `company_members` row per pending row (active, with its role and delegate) and deletes those rows.
    - If none exist, it keeps today's behaviour: an inactive academy membership through the forward sync. That way the previous version's logins still work during the window (plan 3 makes this raise).
  - **Forward sync insert branch:** it skips creating academy's member row when `handle_new_user` already created memberships from pending rows. Use a transaction-local flag set by `handle_new_user`: `set_config('app.member_from_pending','on',true)`.
  - **`public.add_existing_member(p_email text, p_role public.user_role, p_delegate_id uuid) returns uuid`:** admin-only. It finds the profile by `lower(email)`, inserts an active membership in the caller's company and returns the user id. It raises `A user with this email already exists.` when they're already a member here.
  - **`createLogin`:**
    - If a profile with this email exists in another company, it calls `add_existing_member` and sends the "added to <company name>" notice through `sendEmail`. A failed send only warns. It returns `{ ok: 'Added <email> to this company. They sign in with their existing password.' }` with no Auth call.
    - Otherwise it calls `create_pending_login` **before** invite or create, then continues as today. The profile `update` after Auth is replaced by nothing, because `handle_new_user` already applied the pending row.
    - Ruling 8's `created_at` backstop stays.

- [ ] **Step 1: Failing DB tests:**
  - **`create_pending_login` then an `auth.users` insert** (as in the 0085 tests) gives exactly one active member row with the pending role and delegate, plus a `profiles` row with the name, and no pending row left.
  - **An `auth.users` insert without a pending row** still gives an inactive academy member (the previous version's path).
  - **`add_existing_member`** for an academy user called while bound to company B adds a B membership. Calling it again raises.
- [ ] **Step 2: Failing unit tests:**
  - The existing-account path calls `add_existing_member`, sends one notice, and makes no `inviteUserByEmail`.
  - A new address calls `create_pending_login` before `inviteUserByEmail`.
  - An error from `create_pending_login` returns the error with no Auth call.
- [ ] **Step 3: Run** `npm run test:db -- one-db-pending-logins` and `npm test -- create-login notices`. Expected: FAIL.
- [ ] **Step 4: Implement** 0088 and the TS.
- [ ] **Step 5: Run** the full `npm run test:db`, `npm test`, tsc and lint. Expected: PASS (known failure aside).
- [ ] **Step 6: Commit:** `feat(admin): new logins carry their company; existing accounts join another company`.

### Task 8: Release 3, verify, links, ship, check

**Files:**
- Create: `docs/one-database/release-3-checklist.md`
- Modify: `docs/operations.md` (Turning on email verification: the templates use `{{ .RedirectTo }}`)

- [ ] **Step 1: Audit the links.** Every Auth email call passes `redirectTo: ${requestOrigin()}/auth/confirm`: `inviteUserByEmail`, `resetPasswordForEmail`, `generateLink` in `inviteLink`, and resend invite. Add a unit test for any call that doesn't.
- [ ] **Step 2: Write `release-3-checklist.md`** with the owner steps, in order:
  - **(a) Before shipping:** the read-only check that academy's control row has `company_id` (`npm run tenant:check -- academy` or a query), after `db:migrate -- --control` runs in Release.
  - **(b) After deploy:**
    - Add `https://*.imploid.net/**` to Supabase → Auth → URL Configuration → Redirect URLs.
    - Switch the invite and recovery templates to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite|recovery`, keeping the old text in the checklist for rollback.
    - Send a test invite and a password reset, and open each link.
  - **(c) Smoke test:** sign in with 2FA, open users, the checklist assignee picker and `/my` as a delegate.
  - **(d) Prod check:** a read-only check that `app.session_companies` has rows for academy and no other company.
- [ ] **Step 3: Verify:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` (known failure only), then `npx playwright test auth admin admin-user-tools invite delegate-portal delegates permissions password-reset patients schedule --project=chromium`, plus `company-session` with its `TENANTS_FILE`. Check free memory first, and make sure nothing is on :3000.
- [ ] **Step 4: Commit** the checklist and docs. The owner ships with `./scripts/ship.sh ship` (repo public, then private) and follows the checklist.
