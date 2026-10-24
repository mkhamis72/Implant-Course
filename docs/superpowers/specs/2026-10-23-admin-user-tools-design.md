# Admin user tools — design

Decided with the owner on 2026-10-23.

## Why
Admins keep running into account problems the app can't fix: a delegate's email typed wrong at invite, a staff member with a new phone who can't pass 2FA, a misspelled name, and invites nobody accepted. The first real case was changing a user's email from one address to another, which needed SQL in the Supabase dashboard (it touches `auth.users`, `auth.identities` and `profiles`). Admin → Users should handle all of these.

## Goals (owner)
1. **Change email** (admin only).
   - Takes effect **immediately**: there is no confirmation link.
   - The user keeps their password, 2FA, role, permissions and records.
   - The Auth account's email (confirmed), the email identity and `profiles.email` all change together.
   - If the user is linked to a delegate (`profiles.delegate_id`), that delegate's `email` changes too (owner: keep in sync).
   - Refused if the new address already belongs to another account, or isn't a valid email.
   - **A notice goes to both the old and the new address**: "Your sign-in email for {company} was changed to {new} by an administrator. If you didn't expect this, contact your course organizer." It contains no link.
2. **Reset 2FA** (admin only).
   - Removes every authenticator factor of the user.
   - At their next sign-in they enter their password, then **must** set up 2FA again (owner): they are sent to Account → Security and can't use the rest of the app until a new factor is verified.
   - Today 2FA is optional, so this needs a per-user "must set up 2FA" flag. It is cleared when they verify a new factor.
3. **Edit name**: the user's display name (`profiles.full_name`), edited on the user's row.
4. **Last sign-in**: each user row shows the date and time (Cairo), or "Never".
5. **Resend invite**: shown only for users who have never signed in. It sends the invite email again, and is available only while `EMAIL_ENABLED`. Otherwise the existing one-time-password flow applies.
6. **History on the row** (owner): a short list under each user of the admin changes, for example "Email changed by Mohamed · 23 Oct 2026", "2FA reset by …", "Name changed by …", "Invite resent by …". Newest first, the last 10 entries.

## My calls
- **Self-service limits.** Admins can't change their own email or reset their own 2FA from Admin → Users. The buttons are hidden on their own row, and the server refuses. Their own 2FA is managed in Account → Security as today. Editing their own name is allowed.
- **Where the rules live.**
  - Auth changes happen in server actions with the service role (`src/lib/admin/auth-accounts.ts`), guarded by `requireAdmin()`.
  - Database changes go through definer functions that start with `require_admin`:
    - `admin_change_email(user, new_email)` updates profile and delegate, and refuses duplicates in `profiles`;
    - `admin_set_name(user, name)`;
    - `admin_require_mfa_setup(user)`.
  - The order for an email change is in "Settled after the builder check".
- **The 2FA flag** is a new column, `profiles.mfa_setup_required boolean default false`.
  - It is set by `admin_require_mfa_setup` and cleared by a definer function, `mfa_setup_done()`. The user calls it after verifying a factor; it checks that the user really has a verified factor at aal2.
  - Enforcement is described in "Settled after the builder check".
  - The flag doesn't affect RLS. Without a factor, `is_active_user()` already allows aal1.
- **History** comes from `audit_log`: the profile and delegate rows' changes are already audited.
  - The 2FA reset and the resent invite are recorded with a small `admin_events` table (user, kind, actor, at), which is audited too.
  - The Users page reads history through an admin-only reader, `admin_user_history(user)`, which merges both sources into labelled lines.
  - Actor names come from `profiles`.
- **Last sign-in** comes from the Auth admin API (`listUsers`, `last_sign_in_at`), read on the Users page server-side. The page already lists users; this adds one admin call per page load, paged past the API's page size.
- **Notices** go through `sendEmail` (`src/lib/email/send.ts`). A failed notice only warns, as checklist notices do: the change itself stands.
- **Resend invite** uses the same Auth invite call as Create login. A user is "invited, never signed in" when `last_sign_in_at` is null.

## Settled after the builder check

### Owner decision (2026-10-23)
- **Reset 2FA and Change email sign the user out everywhere.**
  - Every session and refresh token of that user is revoked, using the Auth admin sign-out or session deletion for that user id.
  - A stolen phone or an open laptop loses access at once.
  - Revocation runs last: if it fails, the admin sees "Changed, but existing sessions could not be ended" with the error.

### My calls
- **Enforcing the 2FA flag.**
  - The flag is checked in the session guards (`requireActiveUser`, `requirePermission`, `requireAdmin`, `requireSignedIn`, `requireDelegate`) as well as in the layout. Pages and server actions therefore can't run until a factor is verified.
  - Allowed while the flag is set: `/account/security` and its actions, sign-out, and `/login/*`.
  - A matching check in middleware (`decideRedirect`) redirects page requests early.
- **Order of an email change:**
  1. **Auth first**: update the email, confirmed, and the email identity. Auth is where duplicates and invalid addresses most often fail.
  2. **Then the database**: `admin_change_email` updates the profile and the linked delegate. It also refuses a duplicate profile email.
  3. **If the database step fails:** a compensating Auth update restores the old address.
  4. **If that compensation also fails:** the admin sees "The sign-in email was changed to {new} but the app record wasn't. Ask your developer to fix user {id}." An `admin_events` row of kind `email_change_incomplete` is recorded.
  5. **Then:** revoke sessions, then send the notices.
- **Resending an invite.**
  - It uses `auth.admin.generateLink({ type: 'invite' })` for a user who has never signed in. The app builds the same `/auth/confirm?token_hash=…&type=invite` link the Supabase template uses, and sends it through `sendEmail` with the invite wording.
  - If `generateLink` refuses, the admin sees the mapped error and can use Reset password (one-time password) instead.
  - It is available only while `EMAIL_ENABLED`.
- **Who the actions apply to.**
  - **Allowed targets:** any other user (organizers, delegate logins, other admins), including deactivated ones. One admin can rescue another who lost their phone.
  - **Never yourself:** your own email or 2FA can't be changed here.
  - **Reset 2FA** shows only when the user has at least one verified factor. It isn't a way to *require* 2FA for someone who never set it up.
- **Notices.** The old-address notice is skipped when the user has never signed in, because the old address was probably a typo. The new address always gets one.

## Non-goals
- Users changing their own email (not needed now).
- Bulk actions.
- Changing the email of console admins (control project).

## Anti-goals
- An email change that updates the profile but not the sign-in account, or the reverse, left half-done.
- A 2FA reset that leaves the user able to work without setting up 2FA again.
- Any of these actions available to non-admins.
- Notice emails that include a sign-in link (phishing-shaped).

## Constraints
- Migrations are additive (`0074` or the next free number at build time; 8a/8b take 0072/0073). New public tables grant only what they need. `tests/db/permissions.test.ts` stays green.
- Every action guards with `requireAdmin()`, and every definer function with `require_admin`.
- Auth errors reach the admin as clear messages (`mapAuthError`).
- E2E: email notices are read through Mailpit, as in the password-reset and checklist specs.

## Left to the builder
- The row layout (an actions menu vs inline buttons).
- The exact history label wording beyond the examples.
