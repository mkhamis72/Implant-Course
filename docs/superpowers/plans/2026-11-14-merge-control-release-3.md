# Merge control into production — Release 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app, the console, the scripts, Release and Backup use only the production database; every control-project code path, setting and workflow step is gone.

**Architecture:** The company list is always `public.companies` of the project in the env (`productionTenants`). Local development and E2E get their company addresses from rows on the one local stack (`npm run dev:companies`, run by local `db:migrate`), replacing `TENANTS_FILE` and the dev2 stack. Scripts reach the one database through `ENV_FILE`; per-company scripts take `--company <slug>`. Release and Backup read the database from a new GitHub secret `PROD_DATABASE_URL` and list companies from the database.

**Tech Stack:** Next.js 15, supabase-js, `pg`, `@mkhamis72/self-auth`, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-merge-control-into-production-design.md` (release 3 section). Release 2 is live and switched (`COMPANY_LIST=production` since 2026-11-14); `list:compare` showed 0 differences.

## Global Constraints

- No change for company users: same addresses, sign-in, data. Unknown host 404, suspended 503, as today.
- Nothing reads `CONTROL_*`, `COMPANY_LIST`, `TENANTS_FILE`, `CONTROL_SELF_AUTH_*` or `NEXT_PUBLIC_CONTROL_ANON_KEY` after this release (`grep -rE "CONTROL_|COMPANY_LIST|TENANTS_FILE" web/src web/scripts .github` finds only tests asserting their absence).
- Release migrates **before** deploying, so the release-2 app runs briefly against this release's schema: migration 0106 is additive (it tightens `is_console_user`, same signature).
- Release and Backup need, in the GitHub `production` environment, `PROD_DATABASE_URL` (Session pooler) and, for keep-awake, `PROD_SUPABASE_URL` + `PROD_ANON_KEY`; a missing or blank one stops the run before any database step, with its name in the message. The owner adds them **before** merging (runbook).
- Backups keep their shape: artifact `backups-<run>`, R2 copy, one encrypted whole-database dump `prod-<day>.dump.gpg` plus one `<slug>-<day>.company.dump.gpg` per company; `mode=verify` checks patients, sign-in accounts and companies.
- Local-only helpers refuse non-local targets through `scripts/test-guard.ts` rules (127.0.0.1/localhost).
- Removed CLI options fail with a message naming the replacement, e.g. `--tenant is gone: use --company <slug>`, `--all-tenants / --control are gone: there is one database`.
- CLAUDE.md conventions; no Prettier; `scripts/workflows.test.ts` stays green.

## Review Focus

1. `PROD_DATABASE_URL` secret with a trailing CR/space, or missing: Release and Backup clean it like the others, or stop before backup/migrate naming it (Task 4 workflow tests).
2. Fresh local stack: `npm run db:migrate` then `npm run dev` — `localhost` serves academy, not a 404 (Task 1 `dev:companies` from local `db:migrate`; refuses a hosted target).
3. A non-console account listed in `console_users` by mistake (or a company account replaying a token on the console): `is_console_user()` is false (Task 2, 0106 DB test).
4. Verify of a backup taken after this release (no `_control-*` file, `prod-*` dump): passes; a set missing the company export of one company fails naming it (Task 4).
5. `list-cache` reset during an in-flight fetch: the older fetch never overwrites the newer list (Task 1, generation counter; deferred from release 2).

---

### Task 1: Routing from the production list only; local companies on the one stack

**Files:**
- Delete: `web/src/lib/tenant/{source,control,static}.ts` and their tests, `web/src/lib/tenant/registry-static.test.ts`, `web/tenants.local.json` handling
- Modify: `web/src/lib/tenant/registry.ts` (+ test), `route.ts` (+ test; no `ANY_HOST`, null host → 404), `list-cache.ts` (+ test), `web/scripts/migrate-cli.ts` (local run calls dev companies)
- Create: `web/scripts/dev-companies.ts` (+ test), npm script `dev:companies`
- Modify E2E: `tests/e2e/companies.ts` (company B and paused by slug from the local DB), `isolation.spec.ts` (also fix the stale `reset_link_from_other_company_rejected` expectation: the app answers `Your password was changed — sign in at your company's address.`), `company-session.spec.ts`, `global-setup.ts` (runs `dev:companies`)

**Interfaces:**
- Produces: `registry.ts` exports `findTenantByHost(host)`, `findTenantBySlug(slug)`, `findTenantByCompanyId(id)` (one `resetProductionCache()` and refetch for an unknown id), `tenantServiceKey(slug)` (`SUPABASE_SERVICE_ROLE_KEY`, error `SUPABASE_SERVICE_ROLE_KEY is not set`) — all over `productionTenants()`. `isSingleTenant` and `ANY_HOST` are removed.
- `dev-companies.ts`: `LOCAL_COMPANIES = [{ slug: 'academy', hosts: ['localhost', 'a.localhost'] }, { slug: 'company-b', name: 'Company B', hosts: ['b.localhost', 'tenant2.localhost'] }, { slug: 'paused', name: 'Paused Co', hosts: ['paused.localhost'], status: 'suspended' }]`; `ensureLocalCompanies(client)` creates missing ones with `provision_company`, sets hosts/status (idempotent); refuses unless `pgConfig()` targets 127.0.0.1/localhost.

- [ ] **Step 1: Tests first.** `registry.test.ts`: routes `osdic.imploid.net` from the production list with no env switch; unknown host null; `tenantServiceKey` = env key; unknown company id resets once. `route.test.ts`: a request without a usable Host → 404 (no wildcard). `list-cache.test.ts`: `reset()` while a fetch is in flight, then a newer fetch resolves first — `get()` returns the newer list after the older one resolves. `dev-companies.test.ts`: refuses `DATABASE_URL` on a non-local host; with a fake client creates only missing companies and sets hosts/status; running twice changes nothing.
- [ ] **Step 2:** `npm test -- tenant dev-companies` → FAIL.
- [ ] **Step 3:** Implement; `list-cache` gets a generation counter bumped by `reset()`, a fetch writes the cache only if its generation is current. Local `db:migrate` (target 127.0.0.1) runs `ensureLocalCompanies` after migrating.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit` → PASS; `npm run db:migrate` on the local stack prints the three companies; with `npm run dev`: `curl -H "host: b.localhost:3000" …/login` 200, `paused.localhost` 503, `nope.localhost` 404; `npx playwright test isolation company-session --project=chromium` → all pass.
- [ ] **Step 5:** Commit `Routing from the production list only; local companies on the one stack`.

### Task 2: Console on production only

**Files:**
- Modify: `web/src/lib/console/{env,store,admin-active,session,supabase,companies,schemas}.ts` (+ tests), `web/src/lib/self-auth/{console,signing-key}.ts` (+ tests), `web/src/app/console/(admin)/{actions.ts,actions.test.ts,layout.tsx,companies/[slug]/page.tsx,companies/[slug]/forms.tsx}`, `web/scripts/{console-admin.ts,self-auth-node.ts,self-auth-keys.ts}` (+ tests), `web/tests/e2e/console.spec.ts`
- Delete: `web/scripts/{console-local,dev2-stack}.ts` (+ tests), npm scripts `console:local`, `db:dev2:start`, `db:dev2:stop`
- Create: `web/supabase/migrations/0106_console_user_is_console_account.sql`, test in `web/tests/db/console-production.test.ts`

**Interfaces:**
- `consoleConfig()` → `{ url, anonKey, serviceKey }` from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`; `consoleSource` removed. `consoleAuth` = `tenantAuth`. `consoleStore()` returns the production store only; `ConsoleStore` loses `source`, `replaceKeys`, `shared` keeps returning env. `companies.ts` keeps `CompanyRow`, `companyHealth`; `listCompanies/getCompany/companyAudit/serviceKeyOf/sharedProject` go. Replace keys (action, form, `secretsSchema`) goes. Layout header drops the "Company list" label. `signingKey` has one scope (`SELF_AUTH_*`); `CONTROL_SELF_AUTH_*` unread. `console-admin.ts` always targets production (`console_users`, `nodeAuth`), prints `Target project: <host> (production)`.
- 0106: `create or replace function public.is_console_user()` — also requires `exists (select 1 from self_auth."user" s where s.id = app.current_user_id() and s."companyId" = 'console')`; same signature, owner and grants.

- [ ] **Step 1: Tests first.** DB: `is_console_user_requires_a_console_account` — a company (academy) Self-Auth user with aal2 and an active `console_users` row inserted as postgres → `false`; a `console` account → `true`. Unit: `consoleConfig` reads only the company env; store tests drop the control block and `replaceKeys`; `console-admin` has no control branch (`consoleAdminTarget` removed or production-only); `signingKey` ignores `CONTROL_SELF_AUTH_*`.
- [ ] **Step 2:** `npm test -- console self-auth scripts/console-admin scripts/self-auth-keys` and `npm run test:db -- console-production` → FAIL.
- [ ] **Step 3:** Implement; write 0106 (dry-run it in a rolled-back transaction first, per CLAUDE.md).
- [ ] **Step 4:** Unit, `npx tsc --noEmit`, `npm run lint`, `npm run test:db` → PASS; with `CONSOLE_HOST=console.localhost` in the env of `npm run dev`: `npx playwright test console --project=chromium` → all pass (one stack; company two is `company-b`).
- [ ] **Step 5:** Commit `Console on production only; is_console_user requires a console account`.

### Task 3: Scripts on one database

**Files:**
- Modify: `web/scripts/migrate-cli.ts`, `migrate-target.ts` (+ tests), `company-export.ts`, `company-restore.ts` (+ tests), `self-auth-import.ts`, `create-user-args.test.ts`, `package.json`
- Delete: `web/scripts/{tenant-register,tenant-check,tenants-export,tenant-env,migrate-all,list-sync,list-sync-cli,control-tenants-check,pre-one-db-backup,window-checksums,window-rollback,schema-fingerprint}.ts` (+ tests), `web/tests/db/{control,list-sync}.test.ts`, `web/supabase/control/`; npm scripts `tenant:*`, `tenants:export`, `list:*`, `backup:pre-one-db`, `window:*`, `schema:fingerprint`
- Create: `web/scripts/companies-list.ts` (+ test), npm script `companies:list`

**Interfaces:**
- `migrate-cli`: `npm run db:migrate` applies `supabase/migrations` to `ENV_FILE`'s database; `--tenant`, `--all-tenants`, `--control` exit 1 with the Global Constraints messages.
- `company:export -- --company <slug> --out <file|->` and `company:restore -- --company <slug> --in <file> | --delete`: resolve the slug in `public.companies` of `ENV_FILE`'s database; unknown slug exits 3 with `Unknown company <slug>`; `--tenant` exits 1 `--tenant is gone: use --company <slug>`.
- `companies:list`: prints one active-or-suspended company slug per line (order by slug), nothing else, for the workflows.

- [ ] **Step 1: Tests first** for the option parsers (`parseMigrateArgs`, export/restore args) and `companies:list` output format with a fake client.
- [ ] **Step 2:** `npm test -- scripts` → FAIL.
- [ ] **Step 3:** Implement; delete the listed files; `grep -rE "withControl|tenantEnvFrom|migrateTarget\(\['--control" web/scripts web/tests` → nothing.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:db` → PASS; locally `npm run companies:list` prints `academy`, `company-b`, `paused` (plus any test companies); `npm run company:export -- --company company-b --out -` prints JSON.
- [ ] **Step 5:** Commit `Scripts on one database: --company, no control options`.

### Task 4: Release and Backup on one database

**Files:**
- Modify: `.github/workflows/release.yml`, `.github/workflows/backup.yml`, `web/scripts/workflows.test.ts`

**Interfaces:**
- Release: pre-release backup = one whole `pg_dump` of `PROD_DATABASE_URL` (same schemas/excludes as today) encrypted to `pre-release-<run>.dump.gpg` (artifact name unchanged), R2 copy unchanged; migrate = `npm run db:migrate` with `DATABASE_URL=$PROD_DATABASE_URL`, `DATABASE_CA_CERT` from `PROD_DATABASE_CA_CERT`; then deploy hook.
- Backup: `prod-<day>.dump.gpg` + for each slug from `npm run --silent companies:list` a `<slug>-<day>.company.dump.gpg` via `company:export -- --company`; keep-awake curls `$PROD_SUPABASE_URL/auth/v1/health` with `PROD_ANON_KEY`; verify drops the `_control-*` case and treats `prod-*` as the whole dump (patients + sign-in accounts: `self_auth` user table, plus `auth users` while it exists).

- [ ] **Step 1: Workflow tests first** (replace the control ones): no `CONTROL_` anywhere in either workflow; `PROD_DATABASE_URL` cleaned and checked before the first `pg_dump`; migrate step runs `npm run db:migrate` with no `--control`/`--all-tenants`; backup loops over `companies:list`; verify has no `_control-` case; existing safety tests (encrypt before upload, all-or-nothing, migrate before deploy) still pass.
- [ ] **Step 2:** `npx vitest run scripts/workflows.test.ts` → FAIL.
- [ ] **Step 3:** Edit both workflows.
- [ ] **Step 4:** `npx vitest run scripts/workflows.test.ts` → PASS; `npm test` → PASS.
- [ ] **Step 5:** Commit `Release and Backup on one database (PROD_DATABASE_URL)`.

### Task 5: Docs and the owner's steps

**Files:** `docs/operations.md` (§G rewritten: companies live in `public.companies`, console in production; §D backup/restore file names; Release 3 owner checklist), `docs/go-live.md` (one Supabase project to move to Pro), `CLAUDE.md` (commands, Companies, Console, Production, Tests sections: no control/dev2/TENANTS_FILE), `web/README.md` (first-time setup: `db:migrate` also adds the local companies), `web/.env.example` (no `CONTROL_*`, `COMPANY_LIST`, `TENANTS_FILE`).

- [ ] **Step 1: Owner checklist in §G, in order.** Before merging: add GitHub `production` secrets `PROD_DATABASE_URL` (Session pooler URI of the prod project), `PROD_SUPABASE_URL`, `PROD_ANON_KEY`. Merge and Release (repo public, then private). After the deploy is Ready: open each company address and the console; run Backup once by hand and its verify. Then remove from Vercel `CONTROL_SUPABASE_URL`, `CONTROL_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_CONTROL_ANON_KEY`, `CONTROL_DATABASE_URL`, `CONTROL_SELF_AUTH_*`, `COMPANY_LIST` (redeploy), and from GitHub `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY`. Take one last encrypted dump of the control project (command given), keep it with the backups, pause the project; delete it after a month. **Undo before deleting control:** revert the release PR and Release; restore the `CONTROL_*` and `COMPANY_LIST` settings.
- [ ] **Step 2:** Rewrite the other docs; `grep -rnE "CONTROL_|TENANTS_FILE|dev2|tenant:register|--all-tenants" CLAUDE.md docs/operations.md docs/go-live.md web/README.md web/.env.example` → only the owner checklist's removal list and history notes.
- [ ] **Step 3:** Full checks: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:db`, `npx playwright test console isolation company-session --project=chromium` → PASS.
- [ ] **Step 4:** Commit `Release 3 of the merge: docs and owner checklist`.
