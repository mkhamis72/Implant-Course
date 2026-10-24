# Admin user tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can change a user's email, reset their 2FA (forcing re-setup and ending their sessions), edit names, see last sign-in, resend invites, and see a short history of these changes on each user's row.

**Architecture:**
- **Database** (migration `0074_admin_user_tools.sql`, numbered after the last migration on master at build time):
  - a `profiles.mfa_setup_required` flag;
  - an `admin_events` table;
  - definer functions guarded by admin;
  - a history reader.
- **Auth** changes go through service-role helpers in `src/lib/admin/auth-accounts.ts`.
- **Enforcement:** the session guards plus middleware enforce the 2FA flag.
- **UI:** Admin → Users rows gain the actions and history.

**Tech Stack:** Next.js 15, Supabase Auth admin API (`@supabase/supabase-js` as installed), Postgres, Vitest, Playwright + Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-23-admin-user-tools-design.md` (copied from the scratchpad when the branch is created).

## Global Constraints

**Process and guards**
- Work from `web/`. Migrations are additive. Dry-run before `test:db`. Never edit an applied migration.
- Every server action starts with `requireAdmin()`.
- Every definer function starts with `app_private.require_perm('delegates','edit')` and then refuses non-admins with `app_private.fail('Only an admin can do this.')`. No `require_admin` helper exists, and this pattern keeps `tests/db/permissions.test.ts` green.
- **Self-target is refused:** in SQL and actions, change email and reset 2FA on yourself fail with `You can't do this to your own account here. Use Account → Security.` Editing your own name is allowed.

**Change email**
- **Address:** trimmed and lower-cased; it must match the app's existing email schema.
- **Duplicates:** refused with `Another account already uses that email.`
- **Order:**
  1. Auth `updateUserById({ email, email_confirm: true })`, plus the email identity;
  2. DB `admin_change_email(p_user, p_email)`, which updates `profiles.email` and the linked `delegates.email`;
  3. on DB failure, a compensating Auth update back to the old address;
  4. if that fails, the exact message `The sign-in email was changed to {new} but the app record wasn't. Ask your developer to fix user {id}.` and an `admin_events` row `email_change_incomplete`;
  5. revoke sessions;
  6. send the notices.
- **Notice text:** `Your sign-in email for {company} was changed to {new} by an administrator. If you didn't expect this, contact your course organizer.`
  - Subject: `Your sign-in email was changed`.
  - **No links.**
  - It goes to the new address always, and to the old one only if the user has signed in before.
  - A failed send only warns.

**Reset 2FA**
- Shown only when the user has ≥ 1 verified factor.
- Steps: delete every factor (`auth.admin.mfa.listFactors` / `deleteFactor`), then `admin_require_mfa_setup(p_user)` sets the flag, then revoke sessions.

**Ending sessions**
- **Revoke sessions** is `admin_end_sessions(p_user)`: a definer `delete from auth.sessions where user_id = p_user`.
- If the function owner can't delete from `auth.sessions` on the local stack, use the Auth admin API equivalent and record which one in the report.
- If it fails, the admin sees `Changed, but existing sessions could not be ended: {error}`.

**The 2FA flag**
- While `profiles.mfa_setup_required` is set, every session guard redirects to `/account/security`. The guards are `requireAdmin`, `requireSignedIn`, `requireActiveUser`, `requirePermission`, `checkPermission` and `requireDelegate`; for `checkPermission`, return the message `Set up two-factor authentication first.` instead of redirecting.
- Allowed while it's set: `/account/security` (page and actions), sign-out and `/login/*`.
- `decideRedirect` (`src/lib/auth/redirects.ts`) redirects page requests the same way.
- The flag is cleared by `mfa_setup_done()` (definer, any signed-in user, for themselves only). It refuses unless the caller's JWT is `aal2` and they have a verified factor in `auth.mfa_factors`. The security page calls it after a successful verify.

**Edit name, last sign-in, resend invite**
- **Name:** `admin_set_name(p_user, p_name)`, 1–120 characters, trimmed.
- **Last sign-in:** from `auth.admin.listUsers` (page through all pages), formatted with `formatDate`/`formatTime` in Cairo, or `Never`.
- **Resend invite:**
  - shown only when `last_sign_in_at` is null and `EMAIL_ENABLED`;
  - `auth.admin.generateLink({ type: 'invite', email })`, then the link `{origin}/auth/confirm?token_hash={hashed_token}&type=invite`, sent by `sendEmail` with the subject `You're invited to {company}` and the same body wording as the Supabase invite template in `supabase/config.toml`;
  - recorded as `admin_events` `invite_resent`.

**History**
- `admin_user_history(p_user) returns table(at timestamptz, actor_name text, kind text)`: admin only, newest first, limit 10.
- It merges:
  - `audit_log` rows on `profiles` where `email` or `full_name` changed (kinds `email_changed`, `name_changed`);
  - `admin_events` (kinds `mfa_reset`, `invite_resent`, `email_change_incomplete`).
- Labels in TS (`src/lib/admin/history.ts`):
  - `Email changed by {actor} · {date}`
  - `Name changed by {actor} · {date}`
  - `2FA reset by {actor} · {date}`
  - `Invite resent by {actor} · {date}`
  - `Email change incomplete · {date}`

**Copy:** design tokens and shared classes only.

---

## Review Focus
1. **A user whose 2FA was reset can't do anything but set it up again.** A direct server-action POST (e.g. `savePermissions`, or a patient action) is refused while the flag is set, not just the page redirected. (Task 2 test.)
2. **An email change never leaves the account half-done silently.** When the DB step fails, Auth is restored. When the restore also fails, the exact message shows and the event is recorded. (Task 2 test with mocked Auth.)
3. **Self-targeting is refused server-side**, even if a crafted form posts your own user id. (Task 1 DB test + Task 2 action test.)
4. **The delegate email follows.** A delegate login's email change updates `delegates.email`. A user with no delegate leaves delegates untouched. (Task 1 test.)
5. **Notices contain no links** and skip the old address for never-signed-in users. (Task 2 unit test on the message builder + E2E via Mailpit.)

### Task 1: Migration — flag, events, admin functions, history reader

**Files:**
- Create: `supabase/migrations/0074_admin_user_tools.sql`, `tests/db/admin-user-tools.test.ts`

**Interfaces — Produces:**
- Column `profiles.mfa_setup_required boolean not null default false`.
- Table `public.admin_events(id, user_id → profiles, kind text check in ('mfa_reset','invite_resent','email_change_incomplete'), actor_id, at)`, audited, select for admins only.
- Functions (all `returns void` unless noted):
  - `admin_change_email(p_user uuid, p_email text)`
  - `admin_set_name(p_user uuid, p_name text)`
  - `admin_require_mfa_setup(p_user uuid)`, which inserts the `mfa_reset` event
  - `admin_record_event(p_user uuid, p_kind text)`
  - `admin_end_sessions(p_user uuid)`
  - `mfa_setup_done()`
  - `admin_user_history(p_user uuid)` (table, as in Global Constraints)

- [ ] **Step 1: Write failing DB tests:**
  - non-admin refused on each admin function;
  - self-target refused (exact message);
  - duplicate email refused (exact message);
  - email lower-cased and trimmed;
  - linked delegate email updated, unlinked untouched (Review Focus 4);
  - name length rules;
  - the flag is set; `mfa_setup_done` refused at aal1 or with no verified factor, and clears the flag at aal2 with a factor (insert a verified factor row as postgres);
  - `admin_end_sessions` removes the user's `auth.sessions` rows (insert one as postgres);
  - history merges and orders both sources, with limit 10;
  - `permissions.test.ts` stays green.
- [ ] **Step 2: Run** `npm run test:db -- admin-user-tools`. Expected: FAIL.
- [ ] **Step 3: Write the migration** and dry-run it.
- [ ] **Step 4: Run** `npm run test:db -- admin-user-tools permissions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): admin user tools — email, name, 2FA reset flag, history`

### Task 2: Auth helpers, actions, 2FA enforcement

**Files:**
- Modify:
  - `src/lib/admin/auth-accounts.ts`: `changeAuthEmail`, `resetAuthFactors`, `inviteLink`, `listSignIns`;
  - `src/app/(app)/admin/users/actions.ts`: `changeEmail`, `resetTwoFactor`, `editName`, `resendInvite`;
  - `src/lib/auth/session.ts`;
  - `src/lib/auth/redirects.ts`;
  - `src/app/(app)/account/security/actions.ts`: call `mfa_setup_done` after verify;
  - tests for each.
- Create: `src/lib/admin/notices.ts`: `emailChangedNotice({ company, newEmail }): { subject: string; text: string }` and `inviteEmail({ company, link })`, with tests.

**Interfaces:**
- **Consumes:** the Task 1 functions; `sendEmail`; `createAdminClient`; `mapAuthError`.
- **Produces:**
  - `listSignIns(): Promise<Map<string, string | null>>` (user id → `last_sign_in_at`);
  - `hasVerifiedFactor(userId): Promise<boolean>`;
  - the actions return the existing `ActionState` shape with the exact messages from Global Constraints.

- [ ] **Step 1: Write failing tests:**
  - **Notices:** the subject and text are exact, and the text contains no `http` (Review Focus 5).
  - **changeEmail, with Auth and the DB mocked:**
    - happy-path call order;
    - DB failure → compensating Auth call;
    - compensation failure → exact message and an `email_change_incomplete` event (Review Focus 2);
    - self id refused (Review Focus 3);
    - the old-address notice is skipped when never signed in.
  - **resetTwoFactor:** deletes every factor, then the flag, then sessions.
  - **Session guards:**
    - with the flag set, `requirePermission` redirects to `/account/security`;
    - `checkPermission` returns `Set up two-factor authentication first.` (Review Focus 1);
    - `decideRedirect` sends any non-allowed path to `/account/security`.
  - **Security verify** calls `mfa_setup_done`.
- [ ] **Step 2: Run** `npm test -- admin auth`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check that `auth.admin.mfa` and `generateLink` exist in the installed supabase-js. If session deletion through SQL isn't permitted locally, switch `admin_end_sessions` to the Auth admin API and say so.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat: admin email change, 2FA reset with enforced re-setup, invite resend`

### Task 3: Users page UI, E2E, docs

**Files:**
- Modify: `src/app/(app)/admin/users/page.tsx`, `user-row.tsx`, and their tests.
- Create:
  - `src/app/(app)/admin/users/change-email.tsx`, `edit-name.tsx`, `user-history.tsx`, with tests;
  - `src/lib/admin/history.ts` with its test;
  - `tests/e2e/admin-user-tools.spec.ts`.
- Modify: CLAUDE.md (a bullet under Roles & permissions or the Users area: email change, 2FA reset flag and enforcement, history), and `docs/operations.md` (replace any SQL-dashboard email-change instructions with the in-app action).

**Interfaces:**
- **Consumes:** the Task 2 actions and helpers, and Task 1's `admin_user_history`.
- **Produces:** each row shows:
  - name (editable);
  - email with a **Change email** action;
  - `Last sign-in: {date time}` / `Never`;
  - **Reset 2FA**, only when a factor exists and it isn't your own row;
  - **Resend invite**, only when never signed in and `EMAIL_ENABLED`;
  - a collapsible **History** (the last 10 labels).

  Change email and Reset 2FA ask for confirmation in-page (no `window.confirm`), stating that the user will be signed out everywhere.

- [ ] **Step 1: Write failing tests:**
  - `historyLabel` gives each kind's exact label;
  - the row hides Change email and Reset 2FA on your own row and Reset 2FA without a factor;
  - Resend invite shows only for a never-signed-in user with email on;
  - E2E:
    1. an admin changes a test organizer's email;
    2. Mailpit has the notice at the new address, with no link;
    3. that user signs in with the new email;
    4. the History row shows `Email changed by …`.
  - E2E: an admin resets a 2FA-enrolled test user's 2FA (enroll one in the test with the TOTP helper used by the existing MFA specs); that user's next sign-in lands on `/account/security`, and `/patients` redirects back there.
- [ ] **Step 2: Run** `npm test -- admin` and `npx playwright test admin-user-tools`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update CLAUDE.md and `docs/operations.md`.
- [ ] **Step 4: Run** `./scripts/ship.sh verify admin-user-tools` (plus any existing users/MFA specs touched). Expected: "Verified".
- [ ] **Step 5: Commit** `feat(ui): admin user tools on the Users page; e2e; docs`
