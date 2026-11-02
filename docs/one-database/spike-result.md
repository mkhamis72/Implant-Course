# tenant_definer spike result

Question: can the security-definer functions in `public` and `app_private` enforce company isolation through RLS by being owned by a `NOBYPASSRLS` role `tenant_definer`, instead of an explicit company check added to each one by hand (spec §5)?

Script: `web/scripts/spike-tenant-definer.ts`. Everything runs in one transaction (`lock_timeout` 5 s, `statement_timeout` 60 s) that always rolls back, and the script then confirms the role is gone.

## Local run (2026-11-02)

`cd web && ENV_FILE=.env.local npx tsx scripts/spike-tenant-definer.ts`

```
Target project: 127.0.0.1
PASS 1 role tenant_definer
PASS 2 grants to tenant_definer
PASS 3 table spike_rows with forced RLS and audit trigger
PASS 4 definer spike_get sees only its company: B sees 0, A sees 1
PASS 5 auth.uid() inside a tenant_definer function: returns the claims sub
PASS 6 insert through tenant_definer, audit_row still writes: row inserted, 1 audit_log row
PASS 7 app_private.require_active() from a tenant_definer function: ran as an active staff user
PASS 8 every public and app_private definer (minus allowlist) owned by tenant_definer: public 82 moved, 4 stay; app_private 21 moved, 4 stay; CREATE on both schemas revoked afterwards, definers still run
PASS 9 pg_roles: tenant_definer has rolbypassrls = false: rolbypassrls = false
PASS 10 real guard chain (require_active, can) under tenant_definer: as an active organizer; require_active: no policy error "Not allowed", profiles policy ok; can('patients','view'): profiles policy only false, both true; needed the policy: profiles, user_permissions
After rollback: tenant_definer is gone
All checks passed
```

Exit code 0.

### Reading the output

- Checks build on each other. **If check 1 fails, the later failures follow from it** (no role, so no grants, owner changes or calls). The same goes for check 3 → 4, 6, and for check 8 → 10.

### Findings

- **`ALTER … OWNER TO tenant_definer` needs `CREATE` on the function's schema for the new owner.** Postgres requires this of any non-superuser, and the local stack's `postgres` is not a superuser. `grant anon to tenant_definer` doesn't supply it: with only `usage`, every owner change failed with `permission denied for schema public`. The script grants `create on schema public, app_private` in check 2 and revokes both once the owners have changed. The definers still run afterwards, because check 8 calls `spike_get` again. The migration should do the same: grant, alter the owners, revoke.
- **Count:** 111 definers. In `public`, 82 move and 4 stay (`mfa_setup_done`, `admin_end_sessions`, `branding_public`, `branding_logo`). In `app_private`, 21 move and 4 stay (`mfa_satisfied`, `handle_new_user`, `default_permissions`, `audit_row`). Check 8 confirms each allowlisted name exists in the catalog in the schema the spec gives. Extension-owned functions are skipped.
- `auth.uid()`, the postgres-owned `audit_row` trigger, and `app_private.require_active()` all work from a tenant_definer-owned function.
- **The real guard chain needs permissive policies for tenant_definer, and fails closed without them.** Check 10 runs with every definer moved, as an active organizer with `aal2`:
  - With no policy on `profiles`, `require_active()` raises `Not allowed`.
  - With a policy on `profiles` only, `can('patients','view')` returns `false`.
  - With policies on both `profiles` and `user_permissions`, `require_active()` passes and `can()` returns `true`.
  - So a missing policy denies access; it never leaks.
- **Plan 3 must give tenant_definer a permissive policy on every table its functions read or write.** That's the spec §5 policy `for all to tenant_definer using (true) with check (true)`, with the restrictive company policy doing the isolation. The guards need it on `profiles` and `user_permissions`; the business functions need it on every table they touch. Without it they deny everything.
- Checks 7 and 10 need one active admin or organizer whose `mfa_setup_required` flag is off. Without one they fail with `no active staff user`, which is a setup gap and not a spike failure.

## Prod run: pending owner

The owner runs the script against prod. It changes nothing: the transaction always rolls back.

```
! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ENV_FILE=.env.prod npx tsx scripts/spike-tenant-definer.ts --tenant academy
```

Then confirm, read-only, that the role is gone: `select rolname from pg_roles where rolname = 'tenant_definer'` (the script also prints `After rollback: tenant_definer is gone`).

Output: _pending_.

## Decision

**Provisional: definer approach** (all checks pass locally). This becomes final only if the prod run passes too. If any check fails on prod because hosted Supabase forbids it, the decision becomes **fallback: explicit company check in every definer**, and this section names the failing check. The likeliest failures are check 1 (`grant anon to tenant_definer`) and the owner changes in check 8.
