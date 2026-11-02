# Plan 2 notes: company-aware app (release 3)

Decisions taken while building plan 2, and what plan 3 must do because of them. Source: the plan 2 progress ledger and the final whole-branch review.

## Rulings

1. **Lazy binding.** `getCurrentProfile` binds an unbound session on its first request. This replaces the spec §10 step 3 backfill and also covers sessions from the release window and sessions restored from a backup. The bind still checks membership. Cost if wrong: one extra RPC on a session's first request.
2. **`pending_logins` lives in `app_private`**, so `app.company_tables()` does not turn it into a company table. Cost if wrong: the table moves later.
3. **`handle_new_user` without a pending row** still creates an inactive academy membership in release 3, for the previous app version. Plan 3 makes it raise. Cost if wrong: a stray inactive academy membership for an account the old version created during the window, which an admin can remove.
4. **`app.current_session_id()`** (postgres-owned, no API grants) reads the `session_id` claim inside schema `app`, per the auth-helper rule. Cost if wrong: none. The plan 3 / step 2 helper swap must cover it too.
5. **Binding needs a membership row, active or not.** Access still needs an active one (`is_active_user`, `profile.active`). This keeps today's "Account deactivated" page for deactivated users. Isolation is unaffected because membership is per company. Implemented by redefining `app.bind_session` in 0086. Cost if wrong: deactivated users can hold a bound session that grants nothing. A user with no profile or membership is refused at sign-in rather than shown "Account deactivated"; `handle_new_user` always creates one, so this is an edge case.
6. **Academy fallback for unbound sessions.** The three redefined functions (`admin_require_mfa_setup`, `admin_end_sessions`, `delete_user`) use `coalesce(app.current_company_id(), academy)` when the caller's session is unbound, because the previous app version never binds. No other company exists in release 3. Plan 3 removes the fallback. The new `set_member_*` functions refuse unbound sessions. Cost if wrong: an unbound non-academy session acting on academy, which is impossible until plan 3 creates a second company.
7. **Accepted additions.**
   - `app_private.admin_company()`. `is_admin` still reads academy profiles.
   - `set_member_role` refuses the role `delegate`.
   - `admin_events.company_id` is set explicitly.
   - When the person has another membership, `delete_user` removes only this company's membership. Records keep referencing the person's profile.
8. **For academy, `admin_end_sessions` also ends the target's unbound sessions**, since the previous version's sessions are all unbound. This is the same release-3 compatibility as Ruling 6 and is removed in plan 3. Cost if wrong: an unbound session gets ended, which is the safe direction.
9. **`web/src/lib/admin/staff.ts`** holds the shared `staffOptions` for the three staff pickers, replacing a query that was repeated three times. Cost if wrong: none.
10. **`delete_delegate` is membership-first (0088).** 0058 deleted the profile by `delegate_id`, which cascaded to other companies' memberships, and then the app deleted the Auth account. Shared accounts from `add_existing_member` made that reachable. 0088 now matches the login through `company_members.delegate_id` for the caller's company (with Ruling 6's academy fallback). `deleteDelegate` deletes the Auth account only when no profile remains.
11. **Shared users.** `resendInvite` and `editName` refuse shared users with the shared-user message, because names and invites act on the shared account.
12. **Stale pending logins.** `createLogin` removes its pending row on any failure after `create_pending_login` (an Auth error or the backstop refusal) through the admin-only `cancel_pending_login(p_email)` for the caller's company. `handle_new_user` ignores and deletes pending rows older than 7 days. Otherwise a leftover row would quietly enrol a later sign-up of that email.

Also accepted in task 7:
- A pending row whose delegate has gone leaves a profile with no membership (edge case).
- `create_pending_login` and `add_existing_member` work for academy admins only until plan 3, because `is_admin` reads profiles.
- `editName` refuses a shared admin's own name.
- `delete_delegate` demotes a kept academy profile to an inactive organizer.

## Plan 3 must

- **Guards read `company_members`.** `is_active_user()` and `is_admin()` still read `profiles`. Deactivating someone on the academy side therefore cuts their access in company B, and the admin branch of `company_members_select` reaches across companies. Spec §4 moves the guards to `company_members`.
- **`set_user_permissions` is company-scoped** through `admin_company()` before the default company switch.
- **Remove the release-3 fallbacks:**
  - `admin_company(..., true)`;
  - the `coalesce` in `delete_delegate`;
  - `admin_end_sessions` ending unbound sessions;
  - `handle_new_user`'s path without a pending row, which must raise;
  - the profile writes in `delete_user` and `delete_delegate`;
  - the hard-coded academy uuid in both sync triggers.
- **Make the company-blind functions company-aware:**
  - `mfa_setup_done` (0074:214), which clears only `profiles`;
  - `admin_change_email`, `admin_set_name`, `admin_record_event`, `admin_user_history`;
  - `check_assignee`;
  - `is_active_user` and `is_admin`, which read `profiles`.
- **Every permissive policy also calls `is_active_user()` or `can()`.** Inactive members hold bound sessions (Ruling 5). The `companies` select policy (0083:47) is harmless.
- **Never authorise on the company alone.** The bind runs at aal1.
- **`delete_delegate` and the console's first-admin flow stop writing `profiles`.** `delete_delegate` must become membership-scoped like `delete_user`.
- **Cover `app.current_session_id()`** in the step 2 helper swap (Ruling 4).
- **Open `create_pending_login` and `add_existing_member`** to other companies' admins once `is_admin` reads memberships.
- **Keep Auth sign-ups off in every company project** (the 0088 warning; `tenant:check` and the console health check fail while they are on).
