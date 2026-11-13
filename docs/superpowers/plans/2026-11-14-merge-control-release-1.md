# Merge control into production — Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production gets the company list (addresses, status), the console's tables and functions, and a repeatable copy + compare from the control project, while the app keeps reading control.

**Architecture:** Two additive migrations in `web/supabase/migrations/` (0104 list, 0105 console). One module, `web/scripts/list-sync.ts`, holds the copy and compare logic as functions that take a `pg` client, so DB tests run them inside a rolled-back transaction; a thin CLI wraps it. Release runs copy then compare after migrating. No file under `web/src/` changes in this release.

**Tech Stack:** Postgres (plpgsql), TypeScript scripts run with `tsx`, `pg`, Vitest (unit + `tests/db`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-merge-control-into-production-design.md`

## Global Constraints

- All commands run from `web/`. Read `CLAUDE.md` (root) → *Architecture*, *Migrations*, *Tests*, *Gotchas* first.
- Migrations are additive and backward-compatible: the app version before this release and the current app must both work unchanged. Never edit an applied migration.
- Every new function: `security definer set search_path = ''`, explicit `revoke … from public, anon, authenticated` and the grants named in the task. No overloads with defaulted parameters.
- Console write functions are callable by `service_role` only, exactly as in control (`supabase/control/migrations/0002_console.sql`). Company users (`authenticated`) get no execute on them and no privileges on `console_admins` or `tenant_audit`.
- New definer functions follow `0095_provision_company.sql`: `owner to postgres`, `revoke all … from tenant_definer`, and are added to the definer-owner allowlist that `scripts/migrate.test.ts` says is shared with the guard (search for `provision_company` in `scripts/` and `tests/db/` to find both lists).
- Write the failing test before the migration file; dry-run each migration in a rolled-back transaction before the first `npm run test:db` (CLAUDE.md → Gotchas).
- DB test names that search by name use a `Zz ` prefix. Slugs in tests: `zz-…`.
- The app must not read the new columns in this release. `grep -r "hosts" src/lib/tenant` must show no new reader.
- No Prettier. Files are CRLF in git.

## Review Focus

1. A control address written as `Kaleidoscope.Imploid.net:443.` must land in production as `kaleidoscope.imploid.net` and compare as equal (Task 1, Task 3).
2. A control company with no `company_id` is not copied; compare must fail and name its slug (Task 3).
3. Running the copy twice must add no rows to `tenant_audit` and change nothing (Task 3).
4. An address that moved from company A to company B in control since the last copy must copy without tripping the "address already used" rule (Task 3).
5. `provision_company('zz-new', 'Zz New')` (the current app's path, which knows nothing of addresses) must still create a company, with no addresses and status `active` (Task 1).
6. A console account with the same real email as an existing company admin must be accepted and must get no profile and no membership (Task 2).

---

### Task 1: Company list in production (migration 0104)

**Files:**
- Create: `web/supabase/migrations/0104_company_list.sql`
- Test: `web/tests/db/company-list.test.ts`

**Interfaces:**
- Produces:
  - `public.companies.hosts text[] not null default '{}'`, `public.companies.status text not null default 'active' check (status in ('active','suspended'))`, `public.companies.list_updated_at timestamptz not null default now()`.
  - Trigger `companies_list_normalise` (before insert or update on `public.companies`): cleans every address with the same expression and pattern as control's `tenants_normalise` (`supabase/control/migrations/0001_control_registry.sql`), takes the same advisory lock, refuses an address held by another company **compared by `id`** (not slug) with `A host of <slug> is already used by <other slug>`, sets `list_updated_at` when `hosts`, `status`, `slug` or `name` changed.
  - `public.tenant_audit (id bigint identity primary key, at timestamptz not null default now(), slug text not null, action text not null, actor text not null default current_user, reason text, before jsonb, after jsonb, source_id bigint unique)`. RLS enabled, no policies; `revoke all … from public, anon, authenticated`; `grant select, insert on … to service_role`.
  - Trigger `companies_list_audit` (after insert or update or delete on `public.companies`; the existing `companies_audit` trigger stays): when `slug`, `name`, `hosts` or `status` changed, inserts into `tenant_audit` with `actor = coalesce(nullif(current_setting('app.actor', true), ''), current_user)`, `reason = nullif(current_setting('app.reason', true), '')`, `before`/`after` = `jsonb_build_object('slug', …, 'name', …, 'hosts', …, 'status', …)`. Writes nothing while `current_setting('app.list_copy', true) = 'on'`.

- [ ] **Step 1: Write the failing tests** in `tests/db/company-list.test.ts` (pattern: `tests/db/` neighbours, `withTx`, `asPostgres`):

```ts
it('new columns default to no addresses and active', …)        // select hosts, status from companies where slug='academy' → [] / 'active' unless already copied; assert on a company made by provision_company('zz-new','Zz New')
it('cleans addresses', …)   // update … set hosts = array['Kaleidoscope.Imploid.net:443.', 'kaleidoscope.imploid.net'] → hosts equals ['kaleidoscope.imploid.net']
it('refuses an invalid address', …)   // hosts = array['bad host'] → rejects /Invalid host/
it('refuses an address another company holds', …)   // two zz companies, same host → rejects /already used by zz-a/
it('lets a company change its slug and keep its addresses', …)   // update slug only → no error
it('refuses an unknown status', …)   // status = 'paused' → rejects
it('records list changes with actor and reason', …)   // set_config app.actor='a@b.c', app.reason='why'; update status → one tenant_audit row: action 'update', actor, reason, before.status 'active', after.status 'suspended'
it('records nothing while app.list_copy is on', …)
it('records nothing when no list column changed', …)   // update created_at only
it('gives company users nothing on tenant_audit', …)   // actAs organizer → select from tenant_audit rejects /permission denied/
```

- [ ] **Step 2:** Run `npm run test:db -- company-list`. Expected: FAIL, `column "hosts" does not exist`.
- [ ] **Step 3:** Write `0104_company_list.sql` to the Interfaces above (`set local lock_timeout = '5s';` first, as 0095 does). Dry-run it in a rolled-back transaction.
- [ ] **Step 4:** Run `npm run test:db -- company-list`, then `npm run test:db -- permissions companies provision`. Expected: PASS.
- [ ] **Step 5:** Commit: `0104: company list columns, rules and change log in production`.

### Task 2: Console tables and functions in production (migration 0105)

**Files:**
- Create: `web/supabase/migrations/0105_console_in_production.sql`
- Modify: `web/tests/db/permissions.test.ts` (the `allow` set near line 258) and the definer-owner allowlist (see Global Constraints)
- Test: `web/tests/db/console-production.test.ts`

**Interfaces:**
- Consumes: Task 1's columns, `tenant_audit`, `app.actor` / `app.reason` settings.
- Produces:
  - `public.console_admins (user_id uuid primary key references self_auth."user"(id) on delete cascade, email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1), active boolean not null default true, created_at timestamptz not null default now())`; RLS on; `revoke all … from public, anon, authenticated, service_role`; `grant select, insert, update … to service_role`.
  - `public.is_console_admin() returns boolean`: body identical to control 0002; execute granted to `authenticated`.
  - `public.console_update_tenant(p_slug text, p_name text, p_hosts text[], p_actor text) returns void`: sets `app.actor`, updates `companies.name` (trimmed) and `hosts` by slug; `Unknown company <slug>` if none.
  - `public.console_set_status(p_slug text, p_status text, p_reason text, p_actor text) returns void`: same checks and messages as control 0002 (`Give a reason (3–300 characters).`, `Unknown status <x>`, `Unknown company <slug>`), sets `app.actor` and `app.reason`.
  - `public.console_log(p_slug text, p_action text, p_detail text, p_actor text) returns void`: latest control definition (`supabase/control/migrations/0006_onboarding_log.sql`), reading `public.companies` instead of `tenants`.
  - All three `console_*`: execute to `service_role` only. Not recreated: `console_register_tenant`, `console_replace_secrets`, `console_set_company`, `tenant_secret`, `control_private.*` (keys and the registry-to-project link no longer exist; `provision_company` creates companies).
  - `app_private.handle_new_self_auth_user()` — `create or replace` of the latest definition (0101; confirm no later one): first statement `if new."companyId" = 'console' then return new; end if;`. Everything else unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/db/console-production.test.ts`:

```ts
it('accepts a console account and gives it no profile or membership', …)
// asPostgres: insert into self_auth."user" (name,email,"emailVerified","companyId","realEmail") values ('Zz Console','zz-console@console.invalid',true,'console',<the test admin's real email>)
// → no error; 0 rows in profiles and company_members for that id
it('still refuses a company account without a pending login', …)   // companyId = academy id → rejects /No pending login/
it('a console account reads no company data', …)   // actAs(c, consoleUserId) → select count(*) from patients = 0; rpc is_active_user = false
it('is_console_admin needs an active row and a second factor', …)   // row + aal2 → true; aal1 → false; active=false → false; company admin with aal2 → false
it('company users cannot run the console functions or read console_admins', …)
// for admin, organizer, delegate: each of console_update_tenant, console_set_status, console_log rejects /permission denied/; select from console_admins rejects
it('service role updates name and addresses and logs the actor', …)   // set role service_role; console_update_tenant('zz-a','Zz A2',array['zz-a.localhost'],'o@x.y') → row changed; tenant_audit actor 'o@x.y'
it('console_set_status needs a reason and a known status', …)   // 'ab' → /Give a reason/; 'paused' → /Unknown status/; 'zz-none' → /Unknown company/
it('console_log accepts only its four actions', …)   // 'first_admin_invited' ok; 'x' → /Unknown action/
```

- [ ] **Step 2:** Run `npm run test:db -- console-production`. Expected: FAIL (`relation "public.console_admins" does not exist`).
- [ ] **Step 3:** Write `0105_console_in_production.sql`; add the four function names to the `permissions.test.ts` allow set with a one-line comment (`console: service-role only, or reads only the caller's own admin row`) and to the definer-owner allowlist. Dry-run the migration.
- [ ] **Step 4:** Run `npm run test:db -- console-production permissions`, then `npm test -- migrate`. Expected: PASS. If any Self-Auth code or SQL casts `"companyId"` to `uuid`, the first test fails: fix by guarding `console` in that function in this migration, never by changing the test.
- [ ] **Step 5:** Commit: `0105: console admins and console functions in production`.

### Task 3: Copy and compare (scripts)

**Files:**
- Create: `web/scripts/list-sync.ts`, `web/scripts/list-sync-cli.ts`
- Modify: `web/package.json` (scripts `"list:copy": "tsx scripts/list-sync-cli.ts copy"`, `"list:compare": "tsx scripts/list-sync-cli.ts compare"`)
- Test: `web/tests/db/list-sync.test.ts`

**Interfaces:**
- Consumes: `withControl` (`scripts/tenant-env.ts`), `pgConfig()` (`scripts/db.ts`), `scripts/load-env`, Tasks 1–2.
- Produces, in `list-sync.ts`:

```ts
export type ControlCompany = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; company_id: string | null };
export type ControlAudit = { id: number; at: string; slug: string; action: string; actor: string; reason: string | null; before: unknown; after: unknown };
export type Snapshot = { companies: ControlCompany[]; audit: ControlAudit[] };
export async function readSnapshot(control: Client): Promise<Snapshot>;          // tenants + tenant_audit, ordered
export async function applyList(prod: Client, s: Snapshot): Promise<{ updated: number; skipped: string[]; auditAdded: number }>;
export async function diffList(prod: Client, s: Snapshot): Promise<string[]>;    // one line per difference; [] = equal
```

- `applyList` rules (caller owns the transaction): `set local app.list_copy = 'on'`; match control rows to `companies` by `company_id = id`; rows with no `company_id` or no matching company go to `skipped` (slug); first remove from every company the addresses it should no longer hold, then set each company's `hosts` and `status`; never touch `slug` or `name`; insert audit rows with `source_id = control id`, `on conflict (source_id) do nothing`, keeping `at`, `actor`, `reason`, `before`, `after`.
- `diffList` lines: `<slug>: not in production`, `<slug>: no company id in control`, `<slug>: addresses differ (control: …; production: …)` (order-insensitive, after the same cleaning), `<slug>: status differs`, `<slug>: slug differs (production: …)`, `<prod slug>: not in control`, `history: N control rows missing in production`.
- CLI: prints `Target project: <host>` first (as every script does); `copy` runs `applyList` in one transaction and prints the counts and skipped slugs; `compare` prints each line and exits 1 if any. `copy` also exits 1 when `skipped` is non-empty. Never prints keys or connection strings.

- [ ] **Step 1: Write the failing tests** in `tests/db/list-sync.test.ts` (each inside `withTx`, building the `Snapshot` by hand, companies made with `provision_company`):

```ts
it('copies addresses and status and reports no difference afterwards', …)
it('cleans a control address before comparing', …)            // 'Kaleidoscope.Imploid.net:443.' vs stored → diffList = []
it('skips a control company without a company id and compare names it', …)   // skipped = ['zz-x']; diff includes 'zz-x: no company id in control'
it('is safe to run twice', …)                                 // second applyList: auditAdded 0; tenant_audit count unchanged
it('moves an address from one company to another', …)         // A had h, snapshot gives h to B → no error; A=[], B=[h]
it('writes no change-log rows of its own', …)                 // tenant_audit rows = snapshot.audit.length only
it('copies history once, keeping time, actor and reason', …)
it('reports a production company that control does not know', …)   // diff includes 'zz-only: not in control'
it('does not change slug or name', …)
```

- [ ] **Step 2:** Run `npm run test:db -- list-sync`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `list-sync.ts`, then `list-sync-cli.ts` and the two npm scripts.
- [ ] **Step 4:** Run `npm run test:db -- list-sync`, `npx tsc --noEmit`, `npm run lint`. Expected: PASS, no new warnings.
- [ ] **Step 5:** Local end-to-end check with the dev2 stack as control (`npm run db:dev2:start`, `npm run console:local`): `ENV_FILE=.env.console npm run list:copy` then `… list:compare`. Expected: `0 differences`, exit 0. Record the output in the PR description.
- [ ] **Step 6:** Commit: `list:copy / list:compare: bring the company list from control into production`.

### Task 4: Release step and runbook

**Files:**
- Modify: `.github/workflows/release.yml` (after the step "Migrate the control project, then every company", before the deploy hook)
- Modify: `web/scripts/workflows.test.ts`
- Modify: `docs/operations.md` (§G: a short "Company list in production (release 1 of the merge)" note; §D only if step 3 below finds a table)
- Modify: `CLAUDE.md` (Companies paragraph: one sentence; Commands: the two scripts)

**Interfaces:**
- Consumes: `npm run list:copy`, `npm run list:compare`, the secrets the migrate step already uses.

- [ ] **Step 1: Write the failing tests** in `scripts/workflows.test.ts`:

```ts
it('Release copies the company list after migrating and before deploying', …)   // step order: migrate < list:copy < list:compare < deploy hook
it('Release stops before deploying when the lists differ', …)                   // the compare step has no continue-on-error and no `|| true`
```

- [ ] **Step 2:** Run `npm test -- workflows`. Expected: FAIL.
- [ ] **Step 3:** Add the step "Copy the company list into production, then compare" using the same secret-cleaning lines as the migrate step. Then migrate an empty local stack and list non-empty tables (CLAUDE.md → Gotchas, last item); if 0104/0105 left rows anywhere, add that table to the restore `TRUNCATE` in `docs/operations.md` §D.
- [ ] **Step 4:** Update `docs/operations.md` and `CLAUDE.md`. The note must say: the app still reads control; console changes reach production at the next Release or by running `list:copy` by hand; Release 2 removes this step before the switch.
- [ ] **Step 5:** Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:db`. Expected: all PASS.
- [ ] **Step 6:** Commit: `Release: copy and compare the company list; runbook`.

### After the last task (owner)

1. `./scripts/ship.sh verify isolation company-session console` on the branch.
2. Repo public, then `! cd web && ./scripts/ship.sh ship`. The Release log must show `Target project`, the copy counts with no skipped company, and `0 differences`.
3. Live check: `kaleidoscope`, `osdic` and `demo` addresses load, the console signs in. Nothing should look different.
4. Repo private again.
