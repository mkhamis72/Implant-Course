# Multi-tenant, part 1: tenant-aware app

Status: design approved in brainstorming (2026-10-07); spec awaiting review.

## Context and goals

Implant Course Manager runs as a single-company pilot: one Supabase project (Frankfurt) and one Vercel project. The owner wants to offer it to a **handful (2–10) of other implant-course companies**, and will onboard each one personally. Each company's data must be fully separate. Only the owner, as super-admin, sees across companies. Each company gets its own name, logo, colour scheme, web address, implant catalogue and email sender.

The work is split into five sub-projects, each with its own spec, plan and build. **This spec covers part 1:** making the app tenant-aware, so that one deployment serves several companies, each with its own database. The other four parts are summarised at the end so that part 1 leaves room for them.

**Success for part 1**
- The same deployment serves company A on A's web address from A's database, and company B on B's web address from B's database. Nothing from one company is reachable from the other.
- Production behaves exactly as today until the control project is switched on (a single-tenant fallback).
- The current academy becomes company #1 with no data migration and no visible change for its users.

## Decisions

| Topic | Decision |
|---|---|
| Isolation model | **One Supabase project (database and Auth) per company**, behind **one shared Next.js app** that picks the company from the request's host. |
| Company registry | A separate **control Supabase project** holds the `tenants` table. Adding a company needs no deploy. |
| Company secrets | Each company's service-role key and database URL are stored **encrypted in the control project's Vault**. Only the app server and the release workflow can read them, using the control service key. |
| Cross-company access | Only the owner, through the super-admin console (part 4). Inside a company, the owner uses an admin login of that company. There's no single sign-on in this version. |
| Hosting during development | The control project (production registry) and a second dev company (dev2) live in a **separate free Supabase org**, because the current org's two free projects are taken by dev and prod. Before a paying company goes live, everything moves to **Supabase Pro**, and Vercel moves to **Pro** (commercial use). |

## Architecture overview

```
browser ──► https://<company host>/…
              │
              ▼
        Next.js middleware ──── resolveTenant(host) ──► control project: tenants (cached ~60 s)
              │  strips any incoming x-tenant header,
              │  sets the trusted x-tenant = <slug>,
              │  sets the CSP for that company's Supabase origin
              ▼
   pages · server actions · route handlers
              │  createClient() / createAdminClient()
              ▼
        that company's Supabase project (database, RLS, Auth, SMTP)
```

Everything the app does today — RLS, `require_perm`, audit, the `/my` delegate pages — happens inside the company's own database, unchanged. Part 1 changes only **which** database a request talks to.

## Control project

A new Supabase project. It holds **no patient data**. It has its own migration folder, `web/supabase/control/migrations/`, which the existing migrate script applies with `npm run db:migrate -- --control`. The control project tracks its applied migrations in its own `app_private.schema_migrations`.

### `public.tenants`

| Column | Type | Notes |
|---|---|---|
| `slug` | text, primary key | `^[a-z0-9-]{2,40}$`, permanent |
| `name` | text | Display name for the console (branding comes later, from the company's own database) |
| `hosts` | text[] not null | Lower-case host names, without port, e.g. `{academy.example.com}`. Each host belongs to at most one company: a trigger enforces this across rows. |
| `supabase_url` | text not null | `https://<ref>.supabase.co` |
| `anon_key` | text not null | Public key, not a secret |
| `status` | text not null | `active` or `suspended` |
| `created_at`, `updated_at` | timestamptz | |

- RLS is enabled with **no policies** for `anon` or `authenticated`, and all privileges are revoked from them. Only `service_role` reads and writes the table.
- A trigger on `tenants` writes every change, before and after, to `public.audit_log` in the control project.

### Secrets in Vault

Each company has two secrets in `vault.secrets`:
- `tenant/<slug>/service_role_key`
- `tenant/<slug>/database_url`, the session pooler URI, used by the release workflow in part 3

They're read only through
`public.tenant_secret(p_slug text, p_name text) returns text`, a security-definer function with `search_path = ''`. Execute is granted to `service_role` only and revoked from public, anon and authenticated.

## Tenant runtime (app changes)

New module `web/src/lib/tenant/`:

- `types.ts`: `Tenant = { slug, supabaseUrl, anonKey, status }`.
- `host.ts`: `normaliseHost(header)` lower-cases the host, strips the port and rejects anything that isn't a host name.
- `registry.ts`:
  - `resolveTenant(host)` returns the active or suspended tenant, or null.
  - It fetches the registry from the control project with the control service key and keeps it in an in-memory cache for **60 seconds**, per server instance.
  - `tenantSecret(slug, name)` fetches from Vault on demand and caches for 5 minutes.
- `static.ts`: the registry when `CONTROL_SUPABASE_URL` isn't set. It has two modes:
  - **Single tenant** (no `TENANTS_FILE`): one tenant, `default`, built from today's env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), matching **any** host. This is how the first production release and the existing test suites run.
  - **Local multi-tenant** (`TENANTS_FILE=tenants.local.json`, git-ignored, refused when `NODE_ENV=production`): a list of `{ slug, hosts, supabaseUrl, anonKey, serviceRoleKey }`, used by the isolation E2E tests (`localhost` → dev, `tenant2.localhost` → dev2). Dev machines never hold the production control key.
- `current.ts`: `currentTenant()` for server code. It reads the `x-tenant` request header **set by the middleware** and resolves it through the same registry. If the header is missing it throws, because a page or action must never run without a tenant.

Changes to existing files:

| File | Change |
|---|---|
| `src/middleware.ts`, `src/lib/supabase/middleware.ts` | Resolve the tenant from the host first. An unknown host gets a plain 404 page. A suspended company gets the "This site is temporarily unavailable" page, with status 503 and no Supabase call. Delete any incoming `x-tenant` header and set the trusted one on the forwarded request. Create the Supabase client with the tenant's URL and anon key. Set the CSP response header for that tenant. |
| `src/lib/supabase/server.ts` | `createClient()` uses `currentTenant()` in place of `publicEnv`. Its signature is unchanged, so pages and actions don't change. |
| `src/lib/supabase/admin.ts` | `createAdminClient()` becomes async: tenant URL plus `tenantSecret(slug, 'service_role_key')`. The callers are `src/lib/admin/create-login.ts`, `src/lib/admin/auth-accounts.ts` and `src/app/(app)/admin/users/actions.ts`; each gains an `await`. |
| `src/lib/supabase/client.ts`, `src/components/idle-timer.tsx` | The browser client takes `url` and `anonKey` as arguments. The `(app)` layout passes the current tenant's values to `<IdleTimer>`. `NEXT_PUBLIC_SUPABASE_*` no longer appears in client code. |
| `src/lib/security-headers.ts`, `next.config.ts` | `securityHeaders(supabaseUrl, dev)` stays as a pure function. The middleware calls it per request with the tenant's URL. `next.config.ts` keeps only the headers that don't depend on the tenant. |
| `src/lib/env.ts` | `publicEnv` and `serverEnv().siteUrl` are removed from runtime use and kept only by the fallback and the scripts. New server-only vars: `CONTROL_SUPABASE_URL`, `CONTROL_SERVICE_ROLE_KEY`. |
| `src/lib/admin/create-login.ts` | Invite `redirectTo` is built from the request's own origin, not `SITE_URL`. The email itself links via the company project's own Site URL template, set per project in part 5. |

Scripts (`create-user`, `migrate`, `catalog-export`) keep using `ENV_FILE` in part 1. `--tenant <slug>` comes in part 3.

## Failure handling

| Situation | Behaviour |
|---|---|
| Host matches no company | 404 page; nothing about other companies is revealed. |
| Company suspended | 503 "temporarily unavailable" page. No database access. |
| Control project unreachable | Serve from the last successfully fetched registry for up to **10 minutes**, then a 503 "service unavailable" page. Never guess a company. |
| Vault secret missing or unreadable | The admin action returns "This action isn't available right now. Please try again later."; details are logged server-side only. |
| `x-tenant` sent by the browser | Always removed by the middleware before routing. |
| Wrong URL or key in a registration | Caught when the company is registered: a self-check calls the company's `/auth/v1/settings` with its anon key and a service-role read of `profiles`. Part 1 ships it as a script, `npm run tenant:check -- <slug>`; the console (part 4) and onboarding (part 5) reuse it. |

## Rollout

1. **Release 1, fallback only.** Ship the runtime with no `CONTROL_*` env set. Production keeps using today's env vars as the single `default` tenant, so its behaviour is identical. All existing test suites run in this mode.
2. **Control project.**
   - Create it in the separate free org.
   - Apply the control migrations.
   - Register the academy (`slug = academy`, hosts `implant-course.vercel.app`) with its URL, anon key and both Vault secrets.
   - Run `tenant:check academy`.
   - Set `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` in Vercel and re-run Release. The fallback is now off in production.
   - Rollback: remove the two env vars and re-run Release.
3. **Second dev company.**
   - Create the dev2 project in the free org (the org then holds control + dev2) and apply the app migrations to it (`ENV_FILE=.env.dev2 npm run db:migrate`).
   - List `localhost` → dev and `tenant2.localhost` → dev2 in the local `tenants.local.json`.
   - Prove isolation with the E2E tests below.

The owner does the steps that change production settings (Vercel env, release), as with earlier releases.

## Testing

- **Unit:** `normaliseHost`, registry cache expiry and the stale-for-10-minutes window, fallback selection, middleware header stripping, CSP per tenant.
- **DB (control schema):** the control migrations are applied **inside a rolled-back transaction on the dev database**, the same way new migrations are dry-run today, so no test ever touches the real control project. Checks: `anon`/`authenticated` can't read `tenants` or call `tenant_secret`; a duplicate host is refused; the audit row is written.
- **E2E isolation** (two dev companies: `localhost` → dev, `tenant2.localhost` → dev2):
  - a user of A can't sign in on B;
  - A's session cookie isn't accepted on B;
  - a patient created on A doesn't appear on B;
  - a spoofed `x-tenant` header is ignored;
  - an unknown host gets a 404;
  - a suspended company shows the 503 page.
- **Regression:** the full existing unit, DB and E2E suites stay green in fallback mode.

## Out of scope: later sub-projects

- **Part 2, branding.** Name, logo (public storage bucket in the company's project) and colour tokens (CSS variables over `globals.css`), stored in the company's own database and edited by its admin under Admin → Settings → Branding. A public read path for the login page.
- **Part 3, operations.** The release workflow reads the active companies from the control project, migrates each company's database, and deploys only if all succeed. Nightly backups run per company. Scripts take `--tenant <slug>`.
- **Part 4, super-admin console.** Its own host, signed in against the control project's Auth with 2FA. A companies list with health and counts, add/edit, and suspend.
- **Part 5, automated onboarding.** "New company" in the console creates the Supabase project, Auth settings, SMTP and templates via the Supabase Management API, adds the domain via the Vercel API, runs migrations, deactivates the Oxy catalogue, registers the company and creates its first admin. Management tokens are stored in Vault. It's last because it's the most security-sensitive part.

## Costs

- **Development:** free (separate free Supabase org).
- **Before the first paying company:** Supabase Pro (about $25/month base, plus about $10/month per extra small project, each company being a project) and Vercel Pro (per seat). Both are already on the go-live checklist.
