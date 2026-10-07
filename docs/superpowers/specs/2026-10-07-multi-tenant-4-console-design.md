# Multi-tenant, part 4: super-admin console

Date: 2026-10-07. Builds on parts 1–3 (live): production routes through the control project (`tenants`, Vault secrets), branding, per-company releases and backups.

## Context and goals

The owner manages companies with scripts (`tenant:register`, `tenant:check`, `create-user --tenant`). Part 4 gives them a web console for the four things they need now:
1. **See company health:** every company with status, hosts, whether its project answers, and counts.
2. **Suspend / reactivate** a company, with a recorded reason.
3. **Add / edit** a company whose Supabase project already exists (creating projects automatically is part 5).
4. **Create the first admin** (or reset their password) in a company.

Success: the owner signs in on the console's own address with password + 2FA and does all four without a terminal; nothing about the console is reachable on a company address; companies behave exactly as today.

## Decisions

| Topic | Decision |
|---|---|
| Where it runs | The same Next.js app and Vercel project, on its own host (`CONSOLE_HOST`, e.g. `implant-console.vercel.app`). |
| Sign-in | The control project's Supabase Auth; TOTP 2FA mandatory (enrolment forced at first sign-in); 15-minute idle sign-out. |
| Who | Rows in control `public.console_admins` (active). No sign-up: accounts are created by `npm run console:admin -- <email>`. |
| Writes | Server actions call control definer functions with the control service key (already in Vercel), only after `is_console_admin()` passes for the signed-in session. |
| Audit | Every console write goes to `tenant_audit` with `actor` = the console admin's email (scripts: `script`) and an optional `reason`. |
| Secrets | Write-only in the UI: saved keys are never shown again. |
| Out of scope now | Deleting companies, per-company migration status, backup status, creating Supabase projects (part 5). |

## Routing and sign-in

- **`routeConsole(host, path)`** (pure, `src/lib/console/route.ts`): if the normalised host equals `CONSOLE_HOST` → `console` (only paths under `/console` are served; anything else 404); if a company host asks for `/console…` → 404; otherwise → company routing as today. The middleware calls it before `routeHost`. Without `CONSOLE_HOST` set, the console doesn't exist (every `/console` path 404s).
- **Console Supabase clients** (`src/lib/console/supabase.ts`): browser/server clients for `CONTROL_SUPABASE_URL` + `NEXT_PUBLIC_CONTROL_ANON_KEY` (new public Vercel env); cookies live on the console host only. Service client: `CONTROL_SERVICE_ROLE_KEY`.
- **CSP on the console host:** the control project's origin only (part 1's `contentSecurityPolicy(url, dev)`).
- **Guard** `requireConsoleAdmin()` (`src/lib/console/session.ts`): no session → `/console/login`; session at aal1 with a verified factor → `/console/login/mfa`; no verified factor → `/console/mfa/setup` (enrolment, reusing the app's TOTP components); signed in but `is_console_admin()` false → sign out + "Not a console admin". Every console page and server action calls it.
- **Idle sign-out:** the existing idle-timer mechanism with a fixed 15 minutes on the console.

## Pages

- **`/console` (Companies):** one row per company — name, slug, hosts, status badge. Health and counts load per row after the page renders (client calls a server action, 5 s timeout each):
  - health = `checkTenant` (part 1): anon key accepted, service key reads `profiles`; OK or the problems.
  - counts = active staff/delegate logins (`profiles` where active) and patients (`patients`), via the company's service key with `count: 'exact', head: true` (counts only, no rows).
- **`/console/companies/new` (Add):** slug, name, hosts (one per line), Supabase URL, anon key, service key, database URL (session pooler). Runs `checkTenant` first — nothing saved on failure — then `console_register_tenant`. The page says the project must exist and be migrated; the release then keeps it migrated.
- **`/console/companies/<slug>`:**
  - Edit name and hosts (`console_update_tenant`).
  - Suspend / reactivate: reason (3–300 chars) and type the slug to confirm (`console_set_status`). Effect within ~1 minute (registry cache).
  - Replace keys: URL, anon key, service key, database URL (write-only), `checkTenant` first, then `console_replace_secrets`.
  - First admin: email + full name → create the user in the company's Auth (email confirmed) with a temporary password and an active `admin` profile, or reset the password if the email exists; show the password once. Same logic as `scripts/create-user.ts`, moved to a shared module.
  - History: this company's `tenant_audit` rows (when, actor, action, reason, changed fields — never secrets).

## Control migration `0002_console.sql` (additive; applied by the release)

- `public.console_admins (user_id uuid primary key references auth.users on delete cascade, email text not null unique, active boolean not null default true, created_at timestamptz not null default now())`; RLS on; revoked from public/anon/authenticated; service_role select/insert/update.
- `public.is_console_admin() returns boolean` (definer, stable, granted to authenticated): `exists (active row for auth.uid())` and `(auth.jwt() ->> 'aal') = 'aal2'`.
- `tenant_audit`: add `reason text`. `tenants_audit()` replaced to record `actor = coalesce(nullif(current_setting('app.actor', true), ''), current_user)` and `reason = nullif(current_setting('app.reason', true), '')`.
- Definer functions, granted to `service_role` only, each taking `p_actor text` and setting `app.actor` (and `app.reason`) with `set_config(…, true)` before writing:
  - `console_register_tenant(p_slug, p_name, p_hosts text[], p_supabase_url, p_anon_key, p_service_role_key, p_database_url, p_actor)` — upsert row + both Vault secrets (the logic in `scripts/tenants.ts`; `tenant:register` switches to calling it with actor `script`).
  - `console_update_tenant(p_slug, p_name, p_hosts, p_actor)`.
  - `console_set_status(p_slug, p_status, p_reason, p_actor)` — reason required (3–300 chars).
  - `console_replace_secrets(p_slug, p_supabase_url, p_anon_key, p_service_role_key, p_database_url, p_actor)`.
  - Unknown slug → `Unknown company <slug>`.
- `tenants.supabase_url` check also accepts `http://127.0.0.1:<port>` and `http://localhost:<port>` (local development and E2E only; on Vercel these reach nothing, and only 2FA console admins can write).

## Scripts

- `npm run console:admin -- <email>` (control project via `CONTROL_*` in the env file): creates (or resets) the Auth user with a temporary password, email confirmed, and an active `console_admins` row; prints `Target project: control <host>` first and the password once.
- `tenant:register` calls `console_register_tenant` with actor `script`.

## Testing

- **Unit:** `routeConsole` (console host + console path; console host + company path → 404; company host + `/console` → 404; no `CONSOLE_HOST`); form schemas (slug, hosts, URL, key fields, reason length); health/counts helpers with mocked Supabase responses and timeout.
- **DB (control schema on the local stack, rolled back):** `is_console_admin()` false without aal2 / not listed / inactive; console functions refused for authenticated/anon; register writes row + Vault; set_status records reason and actor and requires a reason; duplicate hosts refused; local URL forms accepted; `tenant_audit` never contains secrets.
- **E2E (local):** the control schema applied to the local stack (`db:migrate -- --control` with `CONTROL_DATABASE_URL` = local), app in control mode with `CONSOLE_HOST=console.localhost` and the two local companies registered:
  - console host refuses company pages; company host refuses `/console`;
  - console admin signs in with password + TOTP; non-admin is refused;
  - both companies show OK and counts;
  - suspend company 2 → its address 503; reactivate → back;
  - add a company (reusing dev2's keys under a new slug/host) → appears healthy;
  - create a first admin for a company → sign in on that company's host with the temporary password.

## Rollout

1. Merge → the release applies `0002` to the control project.
2. Owner: Vercel → add the console domain to the project; env `CONSOLE_HOST` and `NEXT_PUBLIC_CONTROL_ANON_KEY` (control anon key); re-run Release.
3. Owner: control project → Authentication → disable sign-ups; enable TOTP MFA.
4. `ENV_FILE=.env.prod npm run console:admin -- <owner email>` → temporary password.
5. Owner signs in on the console address, sets up 2FA, checks the academy shows OK.

## Out of scope

- Deleting a company; migration/backup status in the console; creating Supabase projects, domains, SMTP (part 5); console branding.
