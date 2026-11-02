# tenant_definer spike result

Question: can the public security-definer functions enforce company isolation through RLS by being owned by a `NOBYPASSRLS` role `tenant_definer`, instead of an explicit company check added to each one by hand (spec §5)?

Script: `web/scripts/spike-tenant-definer.ts`. It runs everything in one transaction and always rolls back, then confirms the role is gone.

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
PASS 8 every public definer (minus allowlist) owned by tenant_definer: 82 functions moved to tenant_definer; 4 allowlisted stay with postgres; CREATE on public revoked afterwards, definers still run
PASS 9 pg_roles: tenant_definer has rolbypassrls = false: rolbypassrls = false
After rollback: tenant_definer is gone
All checks passed
```

Exit code 0.

### Findings

- **`ALTER … OWNER TO tenant_definer` needs `CREATE` on schema `public` for the new owner.** Postgres requires this of any non-superuser, and the local stack's `postgres` is not a superuser. `grant anon to tenant_definer` doesn't supply it. With only `usage` (the brief's check 2), all 82 owner changes failed with `permission denied for schema public`. The script now grants `create on schema public` in check 2 and revokes it once the owners have changed. The definers still run afterwards (check 8 calls `spike_get` again), so the grant is needed only while owners change. The migration should do the same: grant, alter owners, revoke.
- **Count:** 86 public definers, of which 82 moved and 4 are on the allowlist that exists in `public` (the other allowlist names are in `app_private` or aren't public definers). The spec's "about 111" presumably also counts `app_private` definers, which check 8 leaves alone.
- `auth.uid()`, the postgres-owned `audit_row` trigger, and `app_private.require_active()` all work from a tenant_definer-owned function (the require_active check ran with an active staff user's claims and `aal2`).
- Check 7 needs one active admin or organizer profile without `mfa_setup_required`; otherwise it fails with "no active staff profile to sign in as" (a setup gap, not a spike failure).

## Prod run: pending owner

The owner runs the script against prod. It changes nothing: the transaction always rolls back.

```
! cd "/d/Claude/Claude Code/implant-course-one-db/web" && ENV_FILE=.env.prod npx tsx scripts/spike-tenant-definer.ts --tenant academy
```

Then confirm, read-only, that the role is gone: `select rolname from pg_roles where rolname = 'tenant_definer'` (the script also prints `After rollback: tenant_definer is gone`).

Output: _pending_.

## Decision

**Provisional: definer approach** (all checks pass locally). This becomes final only if the prod run passes too. If any check fails on prod because hosted Supabase forbids it (most likely check 1, `grant anon to tenant_definer`, or the owner changes in check 8), the decision becomes **fallback: explicit company check in every definer**, and this section names the failing check.
