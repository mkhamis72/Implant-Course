# Modules release 1: plans, company type, Statistics switchable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can define plans in the console and give each company a type, a plan and extras. In this release only Statistics can actually be switched off; when it is, it disappears for everyone in that company, the data is kept, and the company admin sees it on a "Your plan" list.

**Architecture:** A new global `public.plans` table and three columns on `public.companies`. One SQL helper, `app_private.company_features(company)`, computes a company's effective features; `public.module_on(feature)` and the existing `public.can()` gate on it, so every RLS area policy and every `require_perm` function follows without being touched. The app reads the same set once per request (`my_company_plan()` in `loadAccount`), and `canView`/`canEdit` apply it, so nav, dashboard and `requirePermission` follow too.

**Tech Stack:** Postgres plpgsql migrations, Next.js 15 server components/actions, Zod v4, Vitest (unit + DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-modular-design.md` (section "Delivery", release 1).

## Global Constraints

- **Nothing goes online without the owner's go-ahead:** no `git push`, PR, merge, `ship.sh ship`, Vercel or production database action. Work and verify on the local stack only.
- Branch: `feat/modules-r1`, created from `docs/modular-design` (so the spec travels with it).
- Two migrations, `0109_modules.sql` (Task 1) and `0110_modules_console.sql` (Task 2) in `web/supabase/migrations/` (0108 is the latest). Additive and backward compatible: the previous app version must keep working against it.
- Feature names, fixed list: switchable modules `inventory`, `statistics`; type feature `teaching`. Company kinds: `course_organizer`, `clinic`.
- Release-1 limits (spec): only `course_organizer` can be chosen; Inventory is always on ("always on until release 2"); Checklists, Patients, Schedule, Dashboard, Admin are core and never gated.
- Switching off never touches rows. Admins are gated like everyone else.
- Copy: locked module text is exactly `Not in your plan – contact us` (en dash).
- Definer conventions (CLAUDE.md): `security definer set search_path = ''`, explicit revoke/grant; company-session definers owned by `tenant_definer`; service-role console functions owned by `postgres` and listed in `scripts/definer-allowlist.ts`.
- Styling: named tokens and shared classes only (`.card`, `.badge-ok`, `.label`, `.input`, `.btn`, `className="table"` with `data-label`). No Prettier. Files are CRLF in git.

## Review Focus

1. **Saving an organizer's permissions while Statistics is off** must keep their stored Statistics level (the grid hides the row but the schema requires every `perm_*` field) — Task 5 test `keeps a hidden area's level`.
2. **Restoring an export made before 0109** (no `kind`/`plan_id`/`extra_modules` keys) with `--create` must still work, falling back to the column defaults — Task 3 test.
3. **Editing a plan's modules** changes every company on that plan at once (no cache in between) — Task 2 DB test `plan edit reaches its companies`.
4. **A company admin** (not only organizers) loses Statistics when it is off — Task 1 DB test and Task 4 unit test both use the admin role.
5. **A company created after 0109** (console Add company → `provision_company`) starts on Full with Statistics on — Task 1 DB test `new company starts on Full`.

---

### Task 1: Database — plans, company columns, features, `can()` gate

**Files:**
- Create: `web/supabase/migrations/0109_modules.sql`
- Create: `web/tests/db/modules.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (allow-list `module_on`, `my_company_plan`; shared table `plans`)
- Modify: `docs/operations.md` §D (add `public.plans` to the restore `TRUNCATE`: the migration seeds a row)

**Interfaces:**
- Produces (SQL):
  - `public.plans (id uuid pk default gen_random_uuid(), name text not null unique, kind text not null check (kind in ('course_organizer','clinic')), modules text[] not null default '{}' check (modules <@ array['inventory','statistics']), updated_at timestamptz not null default now(), updated_by text)`; forced RLS; policy `plans_tenant_definer` for select to `tenant_definer`; `grant select on public.plans to service_role`; nothing to `authenticated`.
  - Seed row: id `fa110000-0000-4000-8000-000000000001`, name `Full`, kind `course_organizer`, modules `{inventory,statistics}`.
  - `public.companies` + `kind text not null default 'course_organizer' check (...)`, `plan_id uuid not null default 'fa110000-0000-4000-8000-000000000001' references public.plans(id)`, `extra_modules text[] not null default '{}' check (extra_modules <@ array['inventory','statistics'])`.
  - Policy `companies_tenant_definer_own` on `public.companies` for select to `tenant_definer` using `id = (select app.current_company_id())`.
  - `app_private.company_features(p_company uuid) returns text[]` (definer, owner `tenant_definer`): `teaching` when kind is `course_organizer`, plus the plan's modules, plus extras, plus `inventory` always (comment: "always on until release 2"); distinct, sorted.
  - `public.module_on(p_feature text) returns boolean` (definer, owner `tenant_definer`, execute to `authenticated`): `p_feature = any(app_private.company_features(app.current_company_id()))`; false without a bound company.
  - `public.my_company_plan() returns table(kind text, plan_name text, features text[])` (definer, owner `tenant_definer`, execute to `authenticated`): one row for the bound company, none without.
  - `public.can(p_area, p_level)`: the 0089 body plus `and case p_area when 'research' then public.module_on('statistics') when 'inventory' then public.module_on('inventory') when 'courses' then public.module_on('teaching') when 'delegates' then public.module_on('teaching') else true end`. Same signature.
  - Restrictive policy `research_exports_module_read` on `public.research_exports` for select to authenticated using `(select public.module_on('statistics'))` (its only reader that skips `can()`).
- Already true, no work: every area policy already calls `(select public.can(...))` (checked on the local stack 2026-11-17: 99 policies, 0 unwrapped), so the spec's "recreate as `(select …)`" item is done.

- [ ] **Step 1: Create the branch**

Run: `git switch -c feat/modules-r1` (from `docs/modular-design`). Expected: on `feat/modules-r1`.

- [ ] **Step 2: Write the failing DB tests** in `tests/db/modules.test.ts` (conventions as `console-production.test.ts`: `withTx`, `actAs`, `asPostgres`, `inject('testUsers')`; a `basic` plan is inserted as postgres with `modules '{inventory}'` and academy's `plan_id` set to it inside the rolled-back transaction):
  - `existing companies are on Full with every feature`: as `users.admin`, `my_company_plan()` → `{ kind: 'course_organizer', plan_name: 'Full', features: ['inventory','statistics','teaching'] }`.
  - `new company starts on Full`: `provision_company` as service_role → its row has `plan_id = 'fa11…0001'`, `kind = 'course_organizer'`.
  - `statistics off closes it for admins and organizers`: on `basic`, as `users.admin` and as `users.organizer`: `select public.can('research','view')` → false; `select count(*) from public.studies` / `saved_analyses` / `research_exports` → 0 where the same query returned the seeded count on Full; `select public.save_study(...)` (or any `require_perm('research','edit')` function) rejects with `/permission/`.
  - `other areas are untouched`: on `basic`, `can('patients','edit')`, `can('checklists','edit')`, `can('inventory','edit')`, `can('courses','edit')` → true for the admin.
  - `switching back restores identical rows`: fingerprint `select md5(string_agg(t::text, ',' order by id)) from public.studies t` equal before off and after back on (insert one study first).
  - `inventory is always on in release 1`: a plan with `modules '{}'` → `module_on('inventory')` true, `module_on('statistics')` false.
  - `company users can't read plans or other companies' features`: as academy's admin, `select count(*) from public.plans` → `permission denied`; `select app_private.company_features($1)` with company B's id → `permission denied for schema app_private`.
- [ ] **Step 3: Run them to see them fail.** Run: `npm run test:db -- modules` → FAIL (`function public.my_company_plan() does not exist`). Note this run applies no migration yet (0109 doesn't exist).
- [ ] **Step 4: Write `0109_modules.sql`** with the objects above, starting with `set local lock_timeout = '5s';` and a header comment pointing to the spec. Dry-run it in a rolled-back transaction first (CLAUDE.md Gotchas: a scratchpad `tsx` script using `pgConfig()`).
- [ ] **Step 5: Update the guards.** `permissions.test.ts`: allow-list `'module_on', 'my_company_plan'` (comment "Modules (0109): read the bound company's features; no area of their own") and add `'plans'` to the shared tables (comment "global plan list, closed to company users"). `docs/operations.md` §D: add `public.plans` to the TRUNCATE list.
- [ ] **Step 6: Run.** `npm run test:db -- modules permissions one-db-guards` → PASS (the definer-owner guard proves `module_on`, `my_company_plan`, `company_features` are owned by `tenant_definer`).
- [ ] **Step 7: Commit** — `git add web/supabase/migrations/0109_modules.sql web/tests/db docs/operations.md && git commit -m "Modules (0109): plans, company type and extras; can() closes Statistics when the company's plan lacks it"`

### Task 2: Database — console writes and company History

**Files:**
- Create: `web/supabase/migrations/0110_modules_console.sql` (Task 1's `test:db` run applied 0109 to the local stack, so it is not edited again)
- Modify: `web/scripts/definer-allowlist.ts`, `web/tests/db/permissions.test.ts`
- Test: `web/tests/db/modules-console.test.ts`

**Interfaces:**
- Produces (SQL, owner `postgres`, execute to `service_role` only, revoked from public/anon/authenticated/tenant_definer, as 0105):
  - `public.console_save_plan(p_id uuid, p_name text, p_kind text, p_modules text[], p_actor text) returns uuid` — `p_id` null creates. Errors (`raise exception`, shown as is by the console): `Give a name (2–60 characters).`, `A plan called % already exists.`, `Clinic plans come in a later release.` (kind `clinic`), `Unknown module %`, `A plan can't change its type.` (kind differs on update), `Unknown plan`. Always stores `inventory` in `modules` (release 1). Sets `updated_at`, `updated_by = p_actor`.
  - `public.console_set_company_plan(p_slug text, p_kind text, p_plan uuid, p_extras text[], p_actor text) returns void` — sets `app.actor`, updates the three columns. Errors: `Unknown company %`, `Clinic companies come in a later release.`, `Choose a plan for this type of company.` (plan kind ≠ kind), `Unknown module %`.
  - `app_private.companies_list_audit()` (latest in 0104) recreated with `kind`, `plan_id`, `extra_modules` added to both `jsonb_build_object` snapshots, so those changes show in the console History ("changed" keys).

- [ ] **Step 1: Failing tests** in `modules-console.test.ts` (helpers `asServiceRole`, `refused` as in `console-production.test.ts`):
  - `saves a plan and refuses bad input`: create `Zz Basic` → uuid; duplicate name, `clinic`, module `'teaching'`, 1-char name each refused with the messages above; authenticated (`actAs(users.admin)`) gets `permission denied for function console_save_plan`.
  - `plan edit reaches its companies`: academy on `Zz Basic` (`{inventory}`), then `console_save_plan` adds `statistics` → as academy admin `module_on('statistics')` is true without anything else changing.
  - `sets a company's plan, refusing mismatches`: `console_set_company_plan('academy','course_organizer', zzBasic, '{statistics}', 'owner@x')` → `my_company_plan().features` contains `statistics`; kind `clinic` refused; extras `{teaching}` refused.
  - `history records plan changes`: last `company_log` row for `academy` has `actor = 'owner@x'` and `after->>'plan_id' = zzBasic`.
- [ ] **Step 2:** `npm run test:db -- modules-console` → FAIL.
- [ ] **Step 3: Implement** the two functions and the audit trigger function; add `public.console_save_plan`, `public.console_set_company_plan` to `DEFINER_ALLOWLIST` (comment "Modules (0109): the console's plan writes, service role only") and to the permissions allow-list.
- [ ] **Step 4:** `npm run test:db -- modules-console modules permissions one-db-guards console-production company-list` → PASS.
- [ ] **Step 5: Commit** (`0110_modules_console.sql`, the tests, the allow-list) — "Modules (0110): console functions to save plans and set a company's type, plan and extras; History records them"

### Task 3: Company restore tolerates exports from before 0109

**Files:**
- Modify: `web/scripts/company-restore.ts:110-111`
- Test: the existing restore DB test (`tests/db/one-db-company-restore.test.ts`)

**Interfaces:** Consumes the 0109 column defaults. No new exports.

- [ ] **Step 1: Failing test** `restores a company row exported before plans existed`: take an export, delete `kind`, `plan_id`, `extra_modules` from `company`, erase and `--create` restore → succeeds, row has `plan_id = 'fa11…0001'`, `kind = 'course_organizer'`, `extra_modules = '{}'`.
- [ ] **Step 2:** `npm run test:db -- one-db-company-restore` → FAIL (`null value in column "plan_id"`).
- [ ] **Step 3:** In the `--create` insert, use only the insertable columns that are keys of the file's company object, so missing ones take their defaults.
- [ ] **Step 4:** Same command → PASS; also `npm test -- company-export`.
- [ ] **Step 5: Commit** — "Company restore: a company row exported before 0109 takes the plan defaults"

### Task 4: App — features in the account; `canView`/`canEdit`, nav and pages follow

**Files:**
- Create: `web/src/lib/modules/modules.ts`, `web/src/lib/modules/modules.test.ts`
- Modify: `web/src/lib/auth/permissions.ts` (+ `permissions.test.ts`), `web/src/lib/auth/session.ts`, `web/src/components/nav-items.ts` test file if present (`nav-items.test.ts`)

**Interfaces:**
- Produces (`src/lib/modules/modules.ts`):
  - `export const MODULES = ['inventory', 'statistics'] as const; export type Module = (typeof MODULES)[number];`
  - `export type Feature = Module | 'teaching'; export type CompanyKind = 'course_organizer' | 'clinic';`
  - `export const MODULE_LABELS: Record<Module, string> = { inventory: 'Inventory', statistics: 'Statistics' };`
  - `export const KIND_LABELS: Record<CompanyKind, string> = { course_organizer: 'Course organizer', clinic: 'Clinic' };`
  - `export const AREA_FEATURE: Partial<Record<Area, Feature>> = { research: 'statistics', inventory: 'inventory', courses: 'teaching', delegates: 'teaching' };` (mirrors the `case` in 0109's `can()`)
  - `export function areaOn(features: readonly Feature[] | undefined, area: Area): boolean` — true when the area has no feature, or features is undefined (callers without company context, e.g. older tests), or the feature is listed.
  - `export function toFeatures(raw: unknown): Feature[]` — keeps only known names.
- Modifies:
  - `permissions.ts`: `type Who = { role: Role; permissions: Permissions; features?: readonly Feature[] }`; `canView`/`canEdit` return false when `!areaOn(p.features, area)` (checked before the admin shortcut).
  - `session.ts`: `Profile` gains `features: Feature[]` and `plan: { kind: CompanyKind; name: string } | null`; `loadAccount` adds `supabase.rpc('my_company_plan').maybeSingle()` to its `Promise.all` (error → the same "Could not load your account" throw); the no-member fallback gets `features: []`, `plan: null`.

- [ ] **Step 1: Failing unit tests:**
  - `modules.test.ts`: `areaOn(['inventory','teaching'], 'research')` false; `areaOn(['inventory','teaching'], 'checklists')` true; `areaOn(undefined, 'research')` true; `toFeatures(['statistics','bogus'])` → `['statistics']`.
  - `permissions.test.ts`: admin with `features: ['inventory','teaching']` → `canView(…,'research')` false, `canEdit(…,'patients')` true; organizer with research `edit` and same features → false.
  - nav: `visibleNavItems({ role: 'admin', permissions: {}, features: ['inventory','teaching'] })` lacks `Statistics`, has `Checklists` and `Inventory`.
- [ ] **Step 2:** `npm test -- modules permissions nav-items` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. `visibleNavItems` needs no change beyond its parameter type accepting `features` (it passes `p` to `canView`); widen its parameter to `Who`.
- [ ] **Step 4:** `npm test -- modules permissions nav-items` → PASS; `npx tsc --noEmit` → no errors (every `Profile` literal in tests now needs `features`/`plan`: add `features: ['inventory','statistics','teaching'], plan: null` to shared test fixtures).
- [ ] **Step 5: Commit** — "Modules in the app: the account carries its company's features; canView/canEdit hide a switched-off area"

### Task 5: Admin — permission grid hides switched-off areas without losing them; "Your plan"

**Files:**
- Modify: `web/src/app/(app)/admin/users/permission-grid.tsx` (+ `.test.tsx`), `user-row.tsx` (pass `features`), its page (read `requireAdmin()`'s profile features)
- Create: `web/src/app/(app)/admin/settings/your-plan.tsx`, `your-plan.test.tsx`
- Modify: `web/src/app/(app)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `areaOn`, `MODULES`, `MODULE_LABELS`, `Feature` (Task 4); `Profile.features`, `Profile.plan`.
- Produces: `PermissionGrid({ userId, permissions, features }: { …; features: readonly Feature[] })`; `YourPlan({ plan, features }: { plan: { kind: CompanyKind; name: string } | null; features: readonly Feature[] })`.

- [ ] **Step 1: Failing component tests:**
  - `permission-grid.test.tsx` `hides a switched-off area`: features without `statistics` → no `Statistics` fieldset.
  - `keeps a hidden area's level`: permissions `{ research: 'edit' }`, statistics off → the form contains a hidden input `name="perm_research" value="edit"` (and `value="none"` when unset).
  - `your-plan.test.tsx`: Full (`['inventory','statistics','teaching']`) → heading text includes `Full`; rows `Patients, Schedule, Checklists, Dashboard and Admin`, `Courses and delegates`, `Inventory`, `Statistics` each with an `Included` badge. Without `statistics` → the Statistics row reads `Not in your plan – contact us`. With kind `clinic` → no `Courses and delegates` row at all.
- [ ] **Step 2:** `npm test -- permission-grid your-plan` → FAIL.
- [ ] **Step 3: Implement.** Grid: `AREAS.filter(a => areaOn(features, a))` rendered as now; the others as `<input type="hidden" name={`perm_${area}`} value={permissions[area] ?? 'none'} />`. Your plan: a section on Admin → Settings below Consent, heading "Your plan", a `.table` of the rows above (Included = `badge-ok`, locked = `badge-warn` with the exact copy).
- [ ] **Step 4:** Same command → PASS; `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 5: Commit** — "Admin: Your plan list; the permission grid hides switched-off areas but keeps their levels"

### Task 6: Console — Plans page and the company's type, plan and extras

**Files:**
- Modify: `web/src/lib/console/companies.ts` (`CompanyRow` + `kind: CompanyKind; plan_id: string; extra_modules: Module[]`), `web/src/lib/console/store.ts` (COLUMNS + methods), `web/src/lib/console/schemas.ts` (+ test), `web/src/app/console/(admin)/actions.ts` (+ `actions.test.ts`), `web/src/app/console/(admin)/layout.tsx` (link "Plans")
- Create: `web/src/app/console/(admin)/plans/page.tsx`, `plans/plan-form.tsx`
- Modify: `web/src/app/console/(admin)/companies/[slug]/page.tsx`, `forms.tsx` (new `PlanForm`)

**Interfaces:**
- Produces:
  - `type PlanRow = { id: string; name: string; kind: CompanyKind; modules: Module[]; companies: number }`
  - `ConsoleStore.plans(): Promise<PlanRow[]>` (reads `plans` + counts from `companies`), `savePlan(p: { id: string | null; name: string; kind: CompanyKind; modules: Module[] }, actor: string): Promise<string | null>`, `setCompanyPlan(slug: string, kind: CompanyKind, planId: string, extras: Module[], actor: string): Promise<string | null>` (both through the Task 2 RPCs; null = saved).
  - Schemas: `planSchema` (`id` optional uuid, `name` 2–60 trimmed, `kind`, `modules` from checkboxes `module_inventory`/`module_statistics`), `companyPlanSchema` (`slug`, `kind`, `plan_id` uuid, extras checkboxes `extra_inventory`/`extra_statistics`).
  - Actions: `savePlan(_prev, formData): Promise<FormState>`, `setCompanyPlan(_prev, formData): Promise<FormState>` — each `requireConsoleAdmin()` first, `failed(message, formData)` on error, `revalidatePath` of `/console/plans` and the company page; ok text `Saved.`

- [ ] **Step 1: Failing tests:** `schemas.test.ts` (planSchema: checkbox `on` → module listed; 1-char name refused; unknown kind refused); `actions.test.ts` (with the store mocked as the file already does: `setCompanyPlan` passes the parsed values and the admin's email to `store.setCompanyPlan`; an error string from the store comes back as `{ error }`; unauthenticated → `requireConsoleAdmin` redirect as the other actions' tests).
- [ ] **Step 2:** `npm test -- console` → FAIL.
- [ ] **Step 3: Implement.**
  - Plans page: `.table` of plans (name, type, modules, number of companies), each row with an edit `PlanForm`, plus a "New plan" `PlanForm`. In the form, Type offers Course organizer only (Clinic shown disabled, "later release"); the Inventory checkbox is checked and disabled with the note "Always on for now".
  - Company page: `PlanForm` section "Plan" after Details: type select (same limit), plan select listing plans of that type, extras checkboxes (Inventory disabled as above), Save.
- [ ] **Step 4:** `npm test -- console`, `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — "Console: Plans page; each company's type, plan and extras"

### Task 7: End-to-end

**Files:**
- Create: `web/tests/e2e/modules.spec.ts`
- Modify: `web/tests/e2e/console.spec.ts` (one test, using its `signInWith2fa`)

- [ ] **Step 1: Write `modules.spec.ts`** (academy, `withPg` from `companies.ts`; `beforeAll` inserts plan `E2E Basic` with `modules '{inventory}'` and sets academy's `plan_id` to it; `afterAll` sets academy back to `fa11…0001` and deletes the plan — always, in `finally`):
  - `Statistics disappears for the admin, data kept`: `login(page, TEST_USERS.admin.email)`; nav lacks link `Statistics`, has `Checklists` and `Inventory`; `page.goto('/statistics')` ends on `/`; Admin → Settings shows `Statistics` with `Not in your plan – contact us`.
  - `an organizer keeps their Statistics permission`: as admin on Admin → Users, save the organizer's permissions; then (as postgres) the organizer's `user_permissions` row for `research` is still `edit`.
  - `back on Full, everything returns`: set Full in the test, `page.reload()`, nav has `Statistics`, `/statistics` loads.
- [ ] **Step 2: Add to `console.spec.ts`** `plans: the owner creates a plan and gives it to a company`: create `E2E Plan <unique>` without Statistics, open academy's page, choose it, Save → `Saved.`; History lists the change; restore academy to Full and delete the plan through `withPg` in `finally`. (Needs `CONSOLE_HOST=console.localhost:3000` in `.env.local`, as the other console tests.)
- [ ] **Step 3: Run** (memory check first, CLAUDE.md): `npx playwright test modules console --project=chromium` → PASS.
- [ ] **Step 4: Commit** — "E2E: Statistics switched off by plan, and the console's Plans"

### Task 8: Local verification and handoff (no release)

- [ ] **Step 1:** `./scripts/ship.sh verify modules console permissions-ui` (or the spec names that exist) → tsc, lint, unit, `test:db`, named E2E all green. Also `npm run isolation:check` against the local stack → 0.
- [ ] **Step 2:** Update `web/CLAUDE.md` Architecture with a short **Modules (0109)** paragraph (plans, `company_features` / `module_on` / `can()` gate, `my_company_plan` in `loadAccount`, release-1 limits) — commit "Docs: modules".
- [ ] **Step 3: Stop.** Report to the owner: branch `feat/modules-r1`, what was verified, and that shipping (`ship.sh ship`, which migrates production) waits for their go-ahead.
