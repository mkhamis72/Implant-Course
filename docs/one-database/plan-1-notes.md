# Plan 1: rulings and notes for plans 2 and 3

Plan 1 (`docs/superpowers/plans/2026-11-02-one-database-1-foundations.md`) finished on 2026-11-02. The decisions made while building it, and what plans 2 and 3 must pick up, are below.

## Rulings made during plan 1

1. **Owner-run steps were batched** (backups, the prod spike, ships, prod checks), and the code tasks went ahead in the meantime.
2. **Local Docker access:** local `pg_dump` and `pg_restore` reach the host database through `host.docker.internal`, not `--network host`.
3. **Release 1 ships alone,** from branch `one-db-release-1` (Tasks 1–4, no migrations).
4. **Restore proof:** it was made on a dump of the local stack. The real academy proof is re-run with `restore-check` once the owner's dump exists.
5. **Spike grants:** the spike grants CREATE on `public` and `app_private` to `tenant_definer` while it changes function owners, then revokes it. Postgres requires this when a non-superuser changes owners. Plan 3's migration must grant, change owners, then revoke.
6. **Spike scope:** the spike moves the definers in **both** `public` and `app_private` (82 + 21 = 111), apart from the spec §5 allowlist.
7. **Spike check 10:** it proves the real guard chain under `tenant_definer`. `require_active()` and `can()` work only once `tenant_definer` has permissive policies on `profiles` **and** `user_permissions`, and they fail closed without them. Plan 3 must give `tenant_definer` a permissive policy on every table its functions read or write.
8. **`createLogin` duplicate check:**
   - **Before Auth:** it refuses an email that already has a profile in any company (admin lookup).
   - **After Auth:** it refuses an account whose `created_at` is more than 5 s before the call. It never updates or deletes that account.
   - **On a lookup error:** it fails closed.
9. **Company checks:** `removeUser` and `setUserActive` carry the explicit company check too.
10. **`bind_session`** accepts an active membership of any role, delegates included.
11. **Sync trigger:** the `profiles` → `company_members` sync uses `pg_trigger_depth() < 3`, because `handle_new_user` writes `profiles` from an `auth.users` trigger at depth 2.

## Plan 2 must

- **Expose `bind_session` to the app.** PostgREST serves only `public` and `graphql_public`, so a public wrapper is needed (and allowlisted in the guards), or schema `app` must be exposed. `supabase.rpc('bind_session')` won't resolve otherwise.
- **Treat an unbound session as a mismatch** and sign the user out. Backups don't include schema `app`, so after a restore every session is unbound.
- **Clean up `app.session_companies`,** which grows with every sign-in.
- **Add the reverse mirror** (`company_members` → `profiles` for academy) and revisit the depth guard. The upsert's `is distinct from` stops ping-pong.
- **Switch `memberOfMyCompany` to `company_members`** for `app.current_company_id()`, and add the company check to `setUserRole` when role writes move.
- **Handle invites to existing accounts.** `inviteUserByEmail` re-sends to an existing Auth account before the `created_at` check catches it. The `pending_logins` flow should avoid this.
- **Exclude global tables explicitly.** `app.company_tables()` is dynamic: every new public table (for example `pending_logins`) becomes a company table unless it is excluded.

## Plan 3 must

- **Scope the admin branch** of the `company_members` select policy by company.
- **Set the audit company:** `audit_row()` sets `audit_log.company_id` from NEW/OLD. Today `company_members` audit rows take the academy default, and their `row_id` (`user_id`) is ambiguous across companies.
- **Allowlist the `app` helpers.** The "no definer executable by anon" guard must allowlist `app.current_user_id`, `app.current_aal` and `app.current_company_id`.
- **Never authorise on the company alone.** Nothing may treat `app.current_company_id()` as authorisation, because `bind_session` runs at aal1.
- **Retire `one-db-check`.** It assumes one company (members = profiles).
- **Rewrite `docs/operations.md` §D.** Its TRUNCATE with `companies … CASCADE` would wipe every company.
- **Review the indexes.** `_company_id_idx` duplicates the leading column of `_company_id_key` on 40 tables.

## Deferred minor findings (kept deferred by the final review)

- **T1:** `redact` with a short local password, a partial dump file left on failure, and `spawnSync` maxBuffer.
- **T2:** extra tables in `actual` are ignored, and the order of the RESTORE.md truncate prose.
- **T5:** `company_tables()` has no explicit owner, and `service_role` keeps its default grants on `companies`.
- **T6:** the table-count test uses a lower bound of 40 instead of 47.
- **T7:** one test covers four refusal cases.
- **T8:** the tests pin the `clientConfig` wrapper.
