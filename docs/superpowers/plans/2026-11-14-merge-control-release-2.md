# Merge control into production — Release 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app and the console can read the company list from either the control project or production; one Vercel setting, `COMPANY_LIST=production`, switches both. Until the owner sets it, nothing changes.

**Architecture:** One function, `listSource()`, decides the source. Company routing gets a production reader next to the control one, sharing the existing cache (fresh 60 s, usable 10 min). The console gets a `ConsoleStore` interface with a control and a production implementation; pages and actions call the store, never a table. The console signs in through the company Self-Auth instance in production mode. Release stops copying the list (after the switch a copy would overwrite console changes with control's stale list). No migration: release 1 created everything, and the service role already reads `companies`.

**Tech Stack:** Next.js 15 server code, `@supabase/supabase-js`, `@mkhamis72/self-auth`, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-merge-control-into-production-design.md` (release 2 section). Release 1 names, which differ from the spec's: `company_log`, `console_users`, `is_console_user`, `console_update_company`, `console_set_company_status`, `console_log_company` (migration 0105).

## Global Constraints

- Without `COMPANY_LIST=production`, behaviour is exactly today's (control, `TENANTS_FILE` or single-company). Every existing test passes unchanged except where a task says otherwise.
- `COMPANY_LIST` accepts `production` or nothing; any other value is treated as unset and logged once (`COMPANY_LIST=<v> is not a known value; using the control project`). A typo must never take the sites down.
- Companies and console switch together (spec: one setting).
- Production mode reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` / `SELF_AUTH_DATABASE_URL`, `SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK`, `SELF_AUTH_KID` — all already set in Vercel Production. It reads no `CONTROL_*` variable.
- A company row in production mode: `slug`, `hosts`, `status` from `companies`, `companyId` = its `id`, `supabaseUrl` / `anonKey` from the env. Unknown host 404, suspended 503, as today.
- Console sign-in in production mode is the company Self-Auth instance (`tenantAuth`) with company `'console'`; Google sign-in stays off for the console (the console never offers it).
- Console writes in production mode go only through `console_update_company`, `console_set_company_status`, `console_log_company`, `provision_company` (service role). Company keys are not per company any more: Replace keys is refused with `Keys are no longer kept per company.` and hidden.
- No migration in this release.
- Follow CLAUDE.md conventions (server-only modules, no Prettier, guarded console pages/actions).

## Review Focus

1. `COMPANY_LIST=Production` or `production ` (case, spaces) — treated as `production` after trim + lower-case; `prod` — treated as unset with the log line (Task 1).
2. Production reader fails (database down) after one good fetch: the cached list keeps serving for 10 min, then 503, exactly like control (Task 1).
3. A company account's session cookie on the console host, and a console session on a company host, still never open each other's side when both live in the same Self-Auth database (Task 2, E2E `console_session_not_valid_on_company_host`).
4. A company added from the console in production mode is routable on its address within 60 s and its first admin's invite links to that address (Task 3, `findTenantByCompanyId` cache reset).
5. After the switch, `npm run db:migrate -- --all-tenants`, backups and `company:export` still read control; a company added after the switch is missing there until release 3. The runbook must say so (Task 4).

---

### Task 1: Source switch and production company reader

**Files:**
- Create: `web/src/lib/tenant/source.ts`, `web/src/lib/tenant/list-cache.ts`, `web/src/lib/tenant/production.ts` (+ `.test.ts` for each)
- Modify: `web/src/lib/tenant/control.ts` (use `list-cache`), `web/src/lib/tenant/registry.ts` (+ its test)

**Interfaces:**
- Produces:
  - `listSource(env?: Record<string, string | undefined>): 'production' | 'control' | 'static'` — `production` when `COMPANY_LIST` (trimmed, lower-cased) is `production`; else `control` when `CONTROL_SUPABASE_URL` is set; else `static` (`TENANTS_FILE` or single company, as `registry.ts` decides today).
  - `createListCache(fetch: () => Promise<Tenant[]>): { get(now?: number): Promise<Tenant[]>; reset(): void }` — the exact semantics of today's `controlTenants` (FRESH_MS 60 s, STALE_MS 10 min, RETRY_MS 15 s, one inflight fetch, `RegistryUnavailableError` when too old). `controlTenants` / `resetControlCache` become thin wrappers; their tests stay green unchanged.
  - `productionTenants(now?: number): Promise<Tenant[]>`, `resetProductionCache(): void` — service-role supabase-js client on `NEXT_PUBLIC_SUPABASE_URL` with `SUPABASE_SERVICE_ROLE_KEY`, fetch timeout `CONTROL_TIMEOUT_MS` (3 s); `select id, slug, hosts, status from companies`.
  - `registry.ts`: `findTenantByHost`, `findTenantBySlug`, `findTenantByCompanyId` (cache reset of the active source), `tenantServiceKey` (production: `SUPABASE_SERVICE_ROLE_KEY`, error `SUPABASE_SERVICE_ROLE_KEY is not set` if missing), `isSingleTenant` (false in production mode).

- [ ] **Step 1: Write the failing tests.**
  - `source.test.ts`: `{}` → static; `{CONTROL_SUPABASE_URL:'x'}` → control; `{COMPANY_LIST:' Production '}` → production (also with CONTROL set); `{COMPANY_LIST:'prod', CONTROL_SUPABASE_URL:'x'}` → control and `console.error` called once with `COMPANY_LIST=prod is not a known value; using the control project`.
  - `production.test.ts` (inject the fetch through the cache, as `control.test.ts` does): maps `{id, slug, hosts, status}` + env URL/anon key to `Tenant`; a fetch failure inside 10 min returns the cached list; after 10 min throws `RegistryUnavailableError`.
  - `registry.test.ts`: with `COMPANY_LIST=production`, `findTenantByHost('osdic.imploid.net')` returns the production row, `tenantServiceKey('osdic')` returns `SUPABASE_SERVICE_ROLE_KEY`, no `controlTenants` call; `findTenantByCompanyId` of an unknown id resets the production cache once and refetches.
- [ ] **Step 2:** `npm test -- tenant` → FAIL (modules missing).
- [ ] **Step 3:** Implement to the Interfaces.
- [ ] **Step 4:** `npm test -- tenant`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `Company list source: production reader behind COMPANY_LIST`.

### Task 2: Console sign-in in production mode

**Files:**
- Modify: `web/src/lib/console/env.ts` (`controlConfig` → `consoleConfig`: production mode returns the company project's URL / anon / service keys), `web/src/lib/self-auth/console.ts` (`consoleAuth` = `tenantAuth()` in production mode), `web/src/lib/console/session.ts` (admin row through the store from Task 3's `consoleAdminActive(userId)`, guard RPC `is_console_user` in production, `is_console_admin` in control), `web/src/lib/console/middleware.ts` (CSP from `consoleConfig().url`), `web/scripts/console-admin.ts`
- Tests: `env.test.ts`, `session.test.ts`, `middleware.test.ts` (existing), `scripts/console-admin.test.ts` (new or existing)

**Interfaces:**
- Produces: `consoleConfig(env?): { url: string; anonKey: string; serviceKey: string; source: 'control' | 'production' }`; `consoleAdminActive(userId: string): Promise<boolean>`; `CONSOLE_GUARD_RPC: Record<'control' | 'production', string>`.
- `console-admin.ts` in production mode (`COMPANY_LIST=production` in the env file): prints `Target project: <company project host> (production)`, creates or resets the `console` Self-Auth account through the company Self-Auth (`DATABASE_URL`, `SELF_AUTH_SECRET`, `SELF_AUTH_PRIVATE_JWK`, `SELF_AUTH_KID`), upserts `console_users (user_id, email, active)` with `SUPABASE_SERVICE_ROLE_KEY`, prints the temporary password once. Control mode unchanged.

- [ ] **Step 1: Write the failing tests:** production `consoleConfig` uses the company env and needs no `CONTROL_*`; `requireConsoleAdmin` calls `is_console_user` and reads `console_users` in production mode, `is_console_admin` / `console_admins` in control mode; the middleware CSP names the company project in production mode; `console-admin` production mode writes `console_users` and never touches `CONTROL_*`.
- [ ] **Step 2:** `npm test -- console self-auth` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- console self-auth scripts/console-admin`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `Console sign-in on the production database behind COMPANY_LIST`.

### Task 3: Console company store

**Files:**
- Create: `web/src/lib/console/store.ts` (+ `store.test.ts`)
- Modify: `web/src/lib/console/companies.ts` (control implementation moves behind the store), `web/src/app/console/(admin)/actions.ts`, `web/src/app/console/(admin)/page.tsx`, `web/src/app/console/(admin)/companies/[slug]/page.tsx`, `web/src/app/console/api/health/route.ts`, the console layout header (show `Company list: production` / `control`), the Replace keys panel (hidden in production)

**Interfaces:**
- Consumes: `listSource`, `consoleConfig`, `resetProductionCache` / `resetControlCache`.
- Produces `ConsoleStore` (`consoleStore(): ConsoleStore` picks by source):

```ts
export type ConsoleStore = {
  source: 'control' | 'production';
  list(): Promise<CompanyRow[]>;
  get(slug: string): Promise<CompanyRow | null>;
  history(slug: string): Promise<HistoryRow[]>;           // control: tenant_audit; production: company_log (order by at desc, id desc; limit 50)
  serviceKey(slug: string): Promise<string | null>;        // production: SUPABASE_SERVICE_ROLE_KEY
  shared(): Promise<SharedProject>;                        // production: from env
  addCompany(c: { slug: string; name: string; hosts: string[] }, actor: string): Promise<{ companyId: string } | { error: string }>;
  update(slug: string, name: string, hosts: string[], actor: string): Promise<string | null>;   // error message or null
  setStatus(slug: string, status: 'active' | 'suspended', reason: string, actor: string): Promise<string | null>;
  log(slug: string, action: LogAction, detail: string, actor: string): Promise<string | null>;
  replaceKeys(...): Promise<string | null>;                // production: 'Keys are no longer kept per company.'
  adminActive(userId: string): Promise<boolean>;
};
```

  `CompanyRow` keeps its fields; production fills `supabase_url` / `anon_key` from the env and `company_id` from `id`. Production `addCompany`: `provision_company(slug, name)` then `console_update_company(slug, name, hosts, actor)`, then `resetProductionCache()`. Control `addCompany`: today's `sharedProject` → `console_register_tenant` → `provision_company` → `console_set_company` sequence, moved unchanged out of `onboardCompany`. Messages shown to the admin are today's.

- [ ] **Step 1: Write the failing tests** (`store.test.ts` with a fake supabase client recording calls, as `companies.test.ts` does): production `list` maps rows and env keys; `history` reads `company_log` newest first; `addCompany` calls `provision_company` then `console_update_company` with the actor and resets the cache; `update` / `setStatus` / `log` call the `console_*_company` RPCs; `replaceKeys` refuses; control implementation calls today's RPCs (port the existing `companies.test.ts` / `actions.test.ts` expectations). Update `actions.test.ts` to mock `consoleStore`.
- [ ] **Step 2:** `npm test -- console` → FAIL.
- [ ] **Step 3:** Implement; actions and pages call only `consoleStore()`.
- [ ] **Step 4:** `npm test -- console`, `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5:** Commit `Console company store: control and production`.

### Task 4: Release, runbook, local proof

**Files:**
- Modify: `.github/workflows/release.yml` (remove *Copy the company list into production, then compare*), `web/scripts/workflows.test.ts` (replace the two release-1 tests with one: `Release no longer copies the company list (release 2 of the merge)`), `docs/operations.md` §G, `CLAUDE.md`, `web/.env.example` (`COMPANY_LIST`), `web/tests/e2e/console.spec.ts` (setup through the source: `console_users` and `companies` when `COMPANY_LIST=production`)

- [ ] **Step 1:** Workflow test first → FAIL; remove the step → PASS.
- [ ] **Step 2: Local proof in production mode.** `npm run list:copy` with `ENV_FILE=.env.console` (gives local companies their addresses), then run the dev server with `COMPANY_LIST=production` plus `.env.console`'s `CONSOLE_HOST`, and `npx playwright test console isolation company-session --project=chromium`. Expected: all pass. Then the same specs without `COMPANY_LIST` (control mode). Expected: all pass.
- [ ] **Step 3: Runbook §G → "Switch to the production list (release 2)"**, owner steps in order: (1) make no console changes from now on; (2) `ENV_FILE=.env.prod npm run list:copy` then `list:compare` → `0 differences`; (3) `ENV_FILE=<file with the company project's DATABASE_URL, SELF_AUTH_SECRET, SELF_AUTH_PRIVATE_JWK, SELF_AUTH_KID, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, COMPANY_LIST=production> npm run console:admin -- <email>`; (4) Vercel Production: add `COMPANY_LIST=production`, redeploy; (5) console: sign in with the temporary password, set up the new authenticator, header shows `Company list: production`; (6) open each company address; an unknown address 404s. **Undo:** remove `COMPANY_LIST`, redeploy (console changes made since the switch exist only in production). **Until release 3:** don't add companies (control-based scripts and backups would miss them); if one must be added, register it in control too with `tenant:register … --company <id>`.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:db` → PASS.
- [ ] **Step 5:** Commit `Release 2 of the merge: stop copying the list; switch-over runbook`.
