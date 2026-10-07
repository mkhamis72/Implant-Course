# Multi-tenant part 4: Super-admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A console on its own host where console admins (control-project accounts with mandatory TOTP 2FA) see every company's health and counts, suspend/reactivate, add/edit companies and replace their keys, and create a company's first admin.

**Architecture:** Same Next.js app. The middleware first runs a pure `routeConsole(host, path, CONSOLE_HOST)`: the console host only serves `/console…` (session against the control project's Supabase Auth, own idle cookie, control-only CSP); company hosts 404 on `/console…`. Console pages/actions call `requireConsoleAdmin()` and then write through new control definer functions (migration `supabase/control/migrations/0002_console.sql`) with the control service key, recording the admin's email as `actor` in `tenant_audit`.

**Tech Stack:** Next.js 15 App Router (server components + server actions), `@supabase/ssr`, `@supabase/supabase-js`, Zod v4, Postgres plpgsql + Supabase Vault, Vitest (unit, DB), Playwright (`otplib` for TOTP).

**Spec:** `docs/superpowers/specs/2026-10-07-multi-tenant-4-console-design.md`

## Global Constraints

- Run every command from `web/` (Git Bash on Windows). No Python. Files containing `\` are written with the Write/Edit tools. No Prettier; single quotes; 2-space indent; match comment density. Use design tokens (`text-muted`, `border-line`, `.btn`, `.input`, `.card`, `.badge-ok|warn|bad`, `className="table"` with `data-label` on every `<td>`).
- Never print `.env*` contents or any key/URL secret. Saved keys are write-only in the UI (never rendered back).
- Without `CONSOLE_HOST`, the console doesn't exist: every `/console…` path is 404 and company behaviour is unchanged.
- On the console host only `/console…` is served (`/` redirects to `/console`; anything else 404). On any company host `/console…` is 404.
- Console access requires: signed in on the control project, an active `console_admins` row, a verified TOTP factor, and an aal2 session. First sign-in without a factor goes to `/console/mfa/setup`. Idle sign-out after **15** minutes.
- Every console page and server action calls `requireConsoleAdmin()` first (server-side).
- Console writes go only through the control definer functions `console_register_tenant`, `console_update_tenant`, `console_set_status`, `console_replace_secrets` (service_role only), passing the admin's email as `p_actor`.
- Messages exactly: `Unknown company <slug>`; `Give a reason (3–300 characters).`; `Type the company’s slug to confirm.`; `Not a console admin.`; `The console is not configured.`
- `checkTenant` (anon key accepted, service key reads `profiles`) runs before register / replace keys; nothing is saved on failure.
- Health and counts per company load after the page renders, each with a **5 s** timeout; counts only (`count: 'exact', head: true`), never rows.
- Control migration `0002_console.sql` is additive; never edit `0001`. App migrations untouched.
- Rollout steps that change production settings are the owner's.

## Review Focus

1. **A session cookie or page from a company host used on the console host (or the reverse)** — `/console` on `localhost` must 404 even for a signed-in company admin; company pages on the console host must 404. Tests in Task 2 (`routeConsole` table) and Task 7 (E2E both directions).
2. **A signed-in control user who is not a console admin** (e.g. a dev2 company user, since locally the control project is the dev2 stack) — signed out with `Not a console admin.`, never reaches MFA setup or data. Tests in Task 3 (guard unit test with a mocked lookup) and Task 7 (E2E).
3. **A company project that hangs or is down** — its row shows "Couldn't check: timed out" after 5 s; other rows unaffected; the page itself never waits. Test in Task 4 (`companyHealth` with a never-resolving fetch and fake timers).
4. **Suspending with a mistyped slug or an empty reason** — refused with the exact messages, nothing written. Tests in Task 4 (schema) and Task 1 (DB: empty reason refused).
5. **A first admin whose email already exists** — the password is reset and the profile made an active admin; a failure after creating a new user deletes it (no half-made account). Test in Task 4 (`createFirstAdmin` with a fake client).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/control/migrations/0002_console.sql` | `console_admins`, `is_console_admin()`, audit `reason`/actor, console definer functions, local URL forms |
| `tests/db/control.test.ts` | Applies 0001 + 0002 in the rolled-back transaction; new console tests |
| `scripts/tenants.ts` | `registerTenant` calls `console_register_tenant(..., 'script')`; `checkTenant` re-exported from `src/lib/tenant/check.ts` |
| `src/lib/tenant/check.ts` | `checkTenant` (moved from scripts) |
| `src/lib/console/route.ts` (+test) | `routeConsole` |
| `src/lib/console/env.ts` | `consoleHost()`, `controlConfig()` |
| `src/lib/console/supabase.ts` | Control project clients (server session, service) |
| `src/lib/console/middleware.ts` | `updateConsoleSession` (cookies, idle, CSP) |
| `src/lib/console/session.ts` (+ `mfa-step.ts` + test) | `requireConsoleUser`, `requireConsoleAdmin`, `consoleMfaStep` |
| `src/lib/console/schemas.ts` (+test) | Form schemas |
| `src/lib/console/companies.ts` (+test) | list, get, audit, `companyHealth` |
| `src/lib/console/first-admin.ts` (+test) | `createFirstAdmin` |
| `src/app/console/…` | login, MFA, setup, `(admin)` layout, companies list/new/detail, actions |
| `src/components/idle-timer.tsx`, `app/(app)/account/security/enroll-totp.tsx`, `app/login/mfa/mfa-form.tsx` | Made reusable (login path / injected actions) |
| `scripts/console-admin.ts`, `scripts/console-local.ts` | Owner command; local E2E setup |
| `tests/e2e/console.spec.ts` | E2E |
| `docs/operations.md`, `CLAUDE.md`, `next.config.ts`, `package.json`, `.gitignore` | Docs, dev origin, scripts |

---

### Task 1: Control migration `0002_console.sql`

**Files:**
- Create: `supabase/control/migrations/0002_console.sql`, `src/lib/tenant/check.ts`
- Modify: `tests/db/control.test.ts`, `scripts/tenants.ts`

**Interfaces:**
- Produces (SQL, control project): table `public.console_admins(user_id uuid pk → auth.users, email text unique, active boolean, created_at)`; `public.is_console_admin() → boolean` (authenticated); `public.console_register_tenant(p_slug text, p_name text, p_hosts text[], p_supabase_url text, p_anon_key text, p_service_role_key text, p_database_url text, p_actor text) → void`; `public.console_update_tenant(p_slug text, p_name text, p_hosts text[], p_actor text) → void`; `public.console_set_status(p_slug text, p_status text, p_reason text, p_actor text) → void`; `public.console_replace_secrets(p_slug text, p_supabase_url text, p_anon_key text, p_service_role_key text, p_database_url text, p_actor text) → void` (all four: service_role only); `tenant_audit.reason text`; `tenant_audit.actor` = `app.actor` setting or `current_user`.
- Produces (TS): `checkTenant(t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string }, fetchImpl?: typeof fetch): Promise<string[]>` in `src/lib/tenant/check.ts` (moved verbatim from `scripts/tenants.ts`, which re-exports it).

- [ ] **Step 1: Write the failing DB tests.** In `tests/db/control.test.ts`, load the new migration next to `CONTROL_SQL` and apply both in `withControl`:

```ts
const CONSOLE_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0002_console.sql'), 'utf8');
```

```ts
async function withControl(fn: (c: Client) => Promise<void>) {
  await withTx(async (c) => {
    await c.query(CONTROL_SQL);
    await c.query(CONSOLE_SQL);
    await fn(c);
  });
}
```

Add `inject` to the vitest import and `const users = inject('testUsers');`, then append:

```ts
describe('console (0002)', () => {
  const asService = (c: Client) => c.query('set local role service_role');
  const register = (c: Client, slug: string, hosts: string[], actor = 'owner@example.com') =>
    c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
      slug, 'Zz Co', hosts, 'https://abcdefgh.supabase.co', 'anon', 'svc', 'postgres://db', actor,
    ]);

  it('is_console_admin needs an active row and an aal2 session', async () => {
    await withControl(async (c) => {
      await c.query('insert into public.console_admins (user_id, email) values ($1, $2)', [users.admin, 'admin@example.com']);
      const check = async (claims: Record<string, unknown>) => {
        await actAs(c, users.admin, claims);
        const r = (await c.query('select public.is_console_admin() as ok')).rows[0].ok;
        await asPostgres(c);
        return r;
      };
      expect(await check({ aal: 'aal2' })).toBe(true);
      expect(await check({ aal: 'aal1' })).toBe(false);
      await c.query('update public.console_admins set active = false where user_id = $1', [users.admin]);
      expect(await check({ aal: 'aal2' })).toBe(false);
      await actAs(c, users.organizer, { aal: 'aal2' });
      expect((await c.query('select public.is_console_admin() as ok')).rows[0].ok).toBe(false);
    });
  });

  it('console functions run for service_role only', async () => {
    await withControl(async (c) => {
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, () => register(c, 'zz-x', ['x.example.com']), /permission denied/);
      await actAs(c, null);
      await refused(c, () => register(c, 'zz-x', ['x.example.com']), /permission denied/);
      await refused(c, () => c.query('select * from public.console_admins'), /permission denied/);
    });
  });

  it('registers a company with its Vault secrets and records the actor', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['Co.Example.com'], 'owner@example.com');
      await asPostgres(c);
      expect((await c.query(`select hosts from public.tenants where slug = 'zz-co'`)).rows[0].hosts).toEqual(['co.example.com']);
      expect((await c.query(`select public.tenant_secret('zz-co', 'database_url') as v`)).rows[0].v).toBe('postgres://db');
      const audit = (await c.query(`select actor, after from public.tenant_audit where slug = 'zz-co' order by id desc limit 1`)).rows[0];
      expect(audit.actor).toBe('owner@example.com');
      expect(JSON.stringify(audit.after)).not.toContain('svc');
    });
  });

  it('suspends with a reason, refuses an empty reason and an unknown company', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['co.example.com']);
      await c.query(`select public.console_set_status('zz-co', 'suspended', ' Unpaid invoice ', 'owner@example.com')`);
      await refused(c, () => c.query(`select public.console_set_status('zz-co', 'active', '  ', 'owner@example.com')`), /Give a reason \(3–300 characters\)\./);
      await refused(c, () => c.query(`select public.console_set_status('zz-nope', 'active', 'Paid now', 'owner@example.com')`), /Unknown company zz-nope/);
      await asPostgres(c);
      const row = (await c.query(`select status from public.tenants where slug = 'zz-co'`)).rows[0];
      expect(row.status).toBe('suspended');
      const audit = (await c.query(`select reason, actor from public.tenant_audit where slug = 'zz-co' order by id desc limit 1`)).rows[0];
      expect(audit).toEqual({ reason: 'Unpaid invoice', actor: 'owner@example.com' });
    });
  });

  it('updates name and hosts, refusing a host another company uses', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-a', ['a.example.com']);
      await register(c, 'zz-b', ['b.example.com']);
      await c.query(`select public.console_update_tenant('zz-a', 'Zz A Renamed', array['a2.example.com'], 'owner@example.com')`);
      await refused(c, () => c.query(`select public.console_update_tenant('zz-a', 'Zz A', array['b.example.com'], 'owner@example.com')`), /already used by zz-b/);
      await asPostgres(c);
      expect((await c.query(`select name, hosts from public.tenants where slug = 'zz-a'`)).rows[0]).toEqual({ name: 'Zz A Renamed', hosts: ['a2.example.com'] });
    });
  });

  it('replaces keys in Vault and the row; accepts local URLs for development', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['co.example.com']);
      await c.query(`select public.console_replace_secrets('zz-co', 'http://127.0.0.1:54321', 'anon2', 'svc2', 'postgres://db2', 'owner@example.com')`);
      await asPostgres(c);
      expect((await c.query(`select supabase_url, anon_key from public.tenants where slug = 'zz-co'`)).rows[0]).toEqual({ supabase_url: 'http://127.0.0.1:54321', anon_key: 'anon2' });
      expect((await c.query(`select public.tenant_secret('zz-co', 'service_role_key') as v`)).rows[0].v).toBe('svc2');
      await refused(c, () => c.query(`update public.tenants set supabase_url = 'http://evil.example.com' where slug = 'zz-co'`), /tenants_supabase_url_check/);
    });
  });
});
```

(Check the file's existing imports: it already has `withTx, actAs, asPostgres` and `refused`; add `inject` to the `vitest` import.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:db -- control`
Expected: FAIL — `ENOENT … 0002_console.sql`.

- [ ] **Step 3: Write the migration** `supabase/control/migrations/0002_console.sql`

```sql
-- Console (multi-tenant part 4): who may use the super-admin console, and the only functions it writes
-- through. Console admins sign in against this project's Auth with TOTP; the app checks the row and aal2.
create table public.console_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.console_admins enable row level security;
revoke all on public.console_admins from public, anon, authenticated, service_role;
grant select, insert, update on public.console_admins to service_role;

create function public.is_console_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
     and exists (select 1 from public.console_admins a where a.user_id = auth.uid() and a.active)
$$;
revoke execute on function public.is_console_admin() from public, anon;
grant execute on function public.is_console_admin() to authenticated;

-- Who changed a company and why: set per transaction by the console functions (scripts pass 'script').
alter table public.tenant_audit add column reason text;

create or replace function public.tenants_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_audit (slug, action, actor, reason, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          coalesce(nullif(current_setting('app.actor', true), ''), current_user),
          nullif(current_setting('app.reason', true), ''),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- Local development and E2E register companies on the local stacks (http://127.0.0.1:<port>).
alter table public.tenants drop constraint tenants_supabase_url_check;
alter table public.tenants add constraint tenants_supabase_url_check
  check (supabase_url ~ '^https://[a-z0-9]+\.supabase\.co$' or supabase_url ~ '^http://(127\.0\.0\.1|localhost):[0-9]{2,5}$');

create schema if not exists control_private;
revoke all on schema control_private from public, anon, authenticated, service_role;

create function control_private.act(p_actor text, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('app.actor', coalesce(p_actor, ''), true);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
end $$;

create function control_private.put_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'Missing value for %', p_name;
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end $$;

create function public.console_register_tenant(
  p_slug text, p_name text, p_hosts text[], p_supabase_url text, p_anon_key text,
  p_service_role_key text, p_database_url text, p_actor text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  insert into public.tenants (slug, name, hosts, supabase_url, anon_key)
  values (p_slug, trim(p_name), p_hosts, p_supabase_url, p_anon_key)
  on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts,
    supabase_url = excluded.supabase_url, anon_key = excluded.anon_key;
  perform control_private.put_secret('tenant/' || p_slug || '/service_role_key', p_service_role_key);
  perform control_private.put_secret('tenant/' || p_slug || '/database_url', p_database_url);
end $$;

create function public.console_update_tenant(p_slug text, p_name text, p_hosts text[], p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  update public.tenants set name = trim(p_name), hosts = p_hosts where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_set_status(p_slug text, p_status text, p_reason text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'Give a reason (3–300 characters).';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status %', p_status;
  end if;
  perform control_private.act(p_actor, trim(p_reason));
  update public.tenants set status = p_status where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
end $$;

create function public.console_replace_secrets(
  p_slug text, p_supabase_url text, p_anon_key text, p_service_role_key text, p_database_url text, p_actor text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform control_private.act(p_actor);
  update public.tenants set supabase_url = p_supabase_url, anon_key = p_anon_key where slug = p_slug;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
  perform control_private.put_secret('tenant/' || p_slug || '/service_role_key', p_service_role_key);
  perform control_private.put_secret('tenant/' || p_slug || '/database_url', p_database_url);
end $$;

revoke execute on function public.console_register_tenant(text, text, text[], text, text, text, text, text),
  public.console_update_tenant(text, text, text[], text), public.console_set_status(text, text, text, text),
  public.console_replace_secrets(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.console_register_tenant(text, text, text[], text, text, text, text, text),
  public.console_update_tenant(text, text, text[], text), public.console_set_status(text, text, text, text),
  public.console_replace_secrets(text, text, text, text, text, text) to service_role;
```

If the dry-run (Step 4) shows `tenants_supabase_url_check` is not the constraint's name, look it up with `select conname from pg_constraint where conrelid = 'public.tenants'::regclass` and use the real name.

- [ ] **Step 4: Dry-run** the two control migrations together in a rolled-back transaction on the local stack:

```bash
node -e "const {Client}=require('pg');const fs=require('fs');(async()=>{const c=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54322/postgres'});await c.connect();try{await c.query('begin');for(const f of ['0001_control_registry.sql','0002_console.sql'])await c.query(fs.readFileSync('supabase/control/migrations/'+f,'utf8'));console.log('dry-run OK')}finally{await c.query('rollback');await c.end()}})().catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: `dry-run OK`.

- [ ] **Step 5: Move `checkTenant`** to `src/lib/tenant/check.ts` (verbatim body; imports `createClient` from `@supabase/supabase-js`), and in `scripts/tenants.ts` replace its body with `export { checkTenant } from '../src/lib/tenant/check';`. Switch `registerTenant` to the definer function (keep `upsertSecret` removed):

```ts
/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
    t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey, t.serviceRoleKey, t.databaseUrl, 'script',
  ]);
}
```

- [ ] **Step 6: Run the DB and unit tests**

Run: `npm run test:db -- control` then `npm test`
Expected: PASS (all control tests including the six new ones; existing `tenants.test.ts` still green).

- [ ] **Step 7: Commit**

```bash
git add supabase/control/migrations/0002_console.sql tests/db/control.test.ts scripts/tenants.ts src/lib/tenant/check.ts
git commit -m "feat(control): console admins, audited console functions, local project URLs (0002)"
```

---

### Task 2: Console routing in the middleware

**Files:**
- Create: `src/lib/console/route.ts`, `src/lib/console/route.test.ts`, `src/lib/console/env.ts`, `src/lib/console/middleware.ts`
- Modify: `src/middleware.ts`, `src/components/idle-timer.tsx` (+ its test), `next.config.ts` (`allowedDevOrigins`)

**Interfaces:**
- Consumes: `normaliseHost` (`src/lib/tenant/host.ts`), `blockedResponse(kind)` and `TENANT_HEADER` (`src/lib/tenant/responses.ts` / `types.ts`), `contentSecurityPolicy(url, dev)` (`src/lib/security-headers.ts`), `isIdleExpired` (`src/lib/idle.ts`), `lastSeenCookieOptions` (`src/lib/supabase/middleware.ts`).
- Produces:
  - `type ConsoleRoute = 'console' | 'console-root' | 'company' | 'not-found'`; `routeConsole(rawHost: string | null, path: string, consoleHost: string | null): ConsoleRoute`
  - `consoleHost(env?): string | null`; `controlConfig(env?): { url: string; anonKey: string; serviceKey: string }` (throws `The console is not configured.`)
  - `CONSOLE_LAST_SEEN_COOKIE = 'icm_console_last_seen'`, `CONSOLE_IDLE_MINUTES = 15`, `CONSOLE_PUBLIC_PATHS = ['/console/login']`, `updateConsoleSession(request: NextRequest): Promise<NextResponse>`
  - `IdleTimer` gains optional prop `loginPath?: string` (default `'/login'`).

- [ ] **Step 1: Write the failing test** `src/lib/console/route.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { routeConsole } from './route';

const C = 'console.example.com';

describe('routeConsole', () => {
  it.each([
    ['console.example.com', '/console', C, 'console'],
    ['Console.Example.com:443', '/console/companies/academy', C, 'console'],
    ['console.example.com', '/', C, 'console-root'],
    ['console.example.com', '/patients', C, 'not-found'],
    ['console.example.com', '/login', C, 'not-found'],
    ['console.example.com', '/consolex', C, 'not-found'],
    ['academy.example.com', '/patients', C, 'company'],
    ['academy.example.com', '/console', C, 'not-found'],
    ['academy.example.com', '/console/login', C, 'not-found'],
    ['academy.example.com', '/consoles', C, 'company'],
    [null, '/console', C, 'not-found'],
    ['academy.example.com', '/console', null, 'not-found'],
    ['academy.example.com', '/patients', null, 'company'],
  ] as const)('%s %s (console host %s) → %s', (host, path, consoleHost, expected) => {
    expect(routeConsole(host, path, consoleHost)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/console/route`
Expected: FAIL ("Failed to resolve import './route'").

- [ ] **Step 3: Implement** `src/lib/console/route.ts`

```ts
import { normaliseHost } from '@/lib/tenant/host';

export type ConsoleRoute = 'console' | 'console-root' | 'company' | 'not-found';

const isConsolePath = (path: string) => path === '/console' || path.startsWith('/console/');

/**
 * Decided before company routing. The console host serves only /console…; company hosts never do.
 * Without a console host configured the console doesn't exist.
 */
export function routeConsole(rawHost: string | null, path: string, consoleHost: string | null): ConsoleRoute {
  const host = normaliseHost(rawHost);
  if (consoleHost && host === consoleHost) {
    if (path === '/') return 'console-root';
    return isConsolePath(path) ? 'console' : 'not-found';
  }
  return isConsolePath(path) ? 'not-found' : 'company';
}
```

and `src/lib/console/env.ts`

```ts
import { normaliseHost } from '@/lib/tenant/host';

type Env = Record<string, string | undefined>;

export function consoleHost(env: Env = process.env): string | null {
  return normaliseHost(env.CONSOLE_HOST ?? null);
}

/** The control project the console signs in against and writes to. */
export function controlConfig(env: Env = process.env): { url: string; anonKey: string; serviceKey: string } {
  const url = env.CONTROL_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_CONTROL_ANON_KEY;
  const serviceKey = env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('The console is not configured.');
  return { url, anonKey, serviceKey };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/lib/console/route`
Expected: PASS. (If `normaliseHost` returns null for `console.localhost`-style hosts, check `src/lib/tenant/host.ts`; it accepts single-label-plus-`localhost` hosts already used by the isolation tests.)

- [ ] **Step 5: Implement** `src/lib/console/middleware.ts`

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_HEADER } from '@/lib/tenant/types';
import { contentSecurityPolicy } from '@/lib/security-headers';
import { isIdleExpired } from '@/lib/idle';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { controlConfig } from './env';

export const CONSOLE_LAST_SEEN_COOKIE = 'icm_console_last_seen';
export const CONSOLE_IDLE_MINUTES = 15;
export const CONSOLE_PUBLIC_PATHS = ['/console/login'];

/** Console requests: refresh the control-project session, enforce the 15-minute idle limit, control-only CSP. */
export async function updateConsoleSession(request: NextRequest): Promise<NextResponse> {
  const control = controlConfig();
  const csp = contentSecurityPolicy(control.url, process.env.NODE_ENV !== 'production');
  // Never a company request: drop any browser-sent company header.
  const headers = new Headers(request.headers);
  headers.delete(TENANT_HEADER);
  const next = () => NextResponse.next({ request: { headers } });
  let response = next();
  const supabase = createServerClient(control.url, control.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (user && !CONSOLE_PUBLIC_PATHS.includes(path)) {
    const raw = request.cookies.get(CONSOLE_LAST_SEEN_COOKIE)?.value;
    if (isIdleExpired(raw ? Number(raw) : null, Date.now(), CONSOLE_IDLE_MINUTES)) {
      await supabase.auth.signOut({ scope: 'local' });
      const url = request.nextUrl.clone();
      url.pathname = '/console/login';
      url.search = '?reason=idle';
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.cookies.delete(CONSOLE_LAST_SEEN_COOKIE);
      redirect.headers.set('Content-Security-Policy', csp);
      return redirect;
    }
    response.cookies.set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
```

(Check `TENANT_HEADER`'s module — it is exported from `src/lib/tenant/types.ts` per part 1; adjust the import path if it lives in `responses.ts`.)

- [ ] **Step 6: Route in** `src/middleware.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { routeConsole } from '@/lib/console/route';
import { consoleHost } from '@/lib/console/env';
import { updateConsoleSession } from '@/lib/console/middleware';
import { blockedResponse } from '@/lib/tenant/responses';

export async function middleware(request: NextRequest) {
  switch (routeConsole(request.headers.get('host'), request.nextUrl.pathname, consoleHost())) {
    case 'not-found':
      return blockedResponse('not-found');
    case 'console-root':
      return NextResponse.redirect(new URL('/console', request.url));
    case 'console':
      return updateConsoleSession(request);
    default:
      return updateSession(request);
  }
}
```

(keep the existing `config` export unchanged). If `src/middleware.test.ts` exists and mocks `updateSession`, add a case: with `CONSOLE_HOST` unset, `/console` returns 404 and `updateSession` isn't called.

- [ ] **Step 7: Idle timer login path.** In `src/components/idle-timer.tsx` add an optional `loginPath = '/login'` prop and use it in the redirect: `window.location.assign(`${loginPath}?reason=idle`)` (thread it into `signOutForIdle`). Add a test in `idle-timer.test.tsx` that, with `loginPath="/console/login"`, the expired timer navigates to `/console/login?reason=idle` (follow the file's existing expiry test and how it observes `window.location.assign`).

- [ ] **Step 8: Dev origin.** In `next.config.ts`, add `'console.localhost'` to `allowedDevOrigins`.

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Then with the dev server running normally (no `CONSOLE_HOST`): `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/console` → `404`; `http://localhost:3000/login` → `200`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/console src/middleware.ts src/components/idle-timer.tsx src/components/idle-timer.test.tsx next.config.ts
git commit -m "feat(console): its own host in the middleware, control-project session, 15-minute idle"
```

---

### Task 3: Console sign-in, 2FA and the admin guard

**Files:**
- Create: `src/lib/console/supabase.ts`, `src/lib/console/mfa-step.ts`, `src/lib/console/mfa-step.test.ts`, `src/lib/console/session.ts`, `src/app/console/login/page.tsx`, `src/app/console/login/login-form.tsx`, `src/app/console/login/mfa/page.tsx`, `src/app/console/mfa/setup/page.tsx`, `src/app/console/auth-actions.ts`, `src/app/console/(admin)/layout.tsx`, `src/app/console/(admin)/page.tsx` (temporary heading, replaced in Task 5)
- Modify: `src/app/login/mfa/mfa-form.tsx` (+ its page), `src/app/(app)/account/security/enroll-totp.tsx` (+ its page) — accept injected actions

**Interfaces:**
- Consumes: `controlConfig` (Task 2), `verifiedAal` (`src/lib/auth/redirects.ts`), `mapAuthError` (`src/lib/auth/errors.ts`), `IdleTimer` with `loginPath` (Task 2), `CONSOLE_LAST_SEEN_COOKIE`, `CONSOLE_IDLE_MINUTES` (Task 2).
- Produces:
  - `createConsoleClient(): Promise<SupabaseClient>` (session, control project), `createConsoleServiceClient(): SupabaseClient`
  - `consoleMfaStep(factors: { status: string }[] | undefined, aalCurrent: string | null): 'setup' | 'verify' | 'ok'`
  - `requireConsoleUser(): Promise<{ userId: string; email: string }>` (signed in + active console_admins row; no MFA requirement — for the MFA pages)
  - `requireConsoleAdmin(): Promise<{ userId: string; email: string }>` (everything incl. aal2 + `is_console_admin()`)
  - Server actions in `src/app/console/auth-actions.ts`: `signInConsole(prev, formData)`, `verifyConsoleMfa(prev, formData)`, `startConsoleEnroll()`, `confirmConsoleEnroll(factorId, code)`, `signOutConsole()`
  - `MfaForm({ action })`, `EnrollTotp({ start, confirm, onDone? })`

- [ ] **Step 1: Write the failing test** `src/lib/console/mfa-step.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { consoleMfaStep } from './mfa-step';

describe('consoleMfaStep', () => {
  it('requires setting up an authenticator when none is verified', () => {
    expect(consoleMfaStep(undefined, 'aal1')).toBe('setup');
    expect(consoleMfaStep([{ status: 'unverified' }], 'aal1')).toBe('setup');
  });
  it('requires the code when a factor exists but the session is aal1', () => {
    expect(consoleMfaStep([{ status: 'verified' }], 'aal1')).toBe('verify');
    expect(consoleMfaStep([{ status: 'verified' }], null)).toBe('verify');
  });
  it('lets an aal2 session with a verified factor in', () => {
    expect(consoleMfaStep([{ status: 'verified' }], 'aal2')).toBe('ok');
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npm test -- mfa-step` → FAIL (missing module).

- [ ] **Step 3: Implement** `src/lib/console/mfa-step.ts`

```ts
/** Console 2FA is mandatory: no verified authenticator → set one up; aal1 → enter the code. */
export function consoleMfaStep(factors: { status: string }[] | undefined, aalCurrent: string | null): 'setup' | 'verify' | 'ok' {
  if (!factors?.some((f) => f.status === 'verified')) return 'setup';
  return aalCurrent === 'aal2' ? 'ok' : 'verify';
}
```

Run `npm test -- mfa-step` → PASS.

- [ ] **Step 4: Implement** `src/lib/console/supabase.ts`

```ts
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { controlConfig } from './env';

/** The signed-in console admin's session on the control project. */
export async function createConsoleClient(): Promise<SupabaseClient> {
  const { url, anonKey } = controlConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component: read-only cookies; the middleware refreshes them.
        }
      },
    },
  });
}

/** Service access to the control project: only after requireConsoleAdmin(). */
export function createConsoleServiceClient(): SupabaseClient {
  const { url, serviceKey } = controlConfig();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 5: Implement** `src/lib/console/session.ts`

```ts
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { verifiedAal } from '@/lib/auth/redirects';
import { createConsoleClient, createConsoleServiceClient } from './supabase';
import { consoleMfaStep } from './mfa-step';

export type ConsoleAdmin = { userId: string; email: string };

async function signedInListed() {
  const supabase = await createConsoleClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/console/login');
  const { data: row } = await createConsoleServiceClient().from('console_admins').select('active').eq('user_id', user.id).maybeSingle();
  if (!row?.active) {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/console/login?reason=not-admin');
  }
  return { supabase, user };
}

/** Signed in and listed; 2FA may still be pending (the MFA pages use this). */
export const requireConsoleUser = cache(async (): Promise<ConsoleAdmin> => {
  const { user } = await signedInListed();
  return { userId: user.id, email: user.email ?? '' };
});

/** Every console page and action: listed, verified TOTP, aal2, and the control project agrees. */
export const requireConsoleAdmin = cache(async (): Promise<ConsoleAdmin> => {
  const { supabase, user } = await signedInListed();
  const { data } = await supabase.auth.getClaims();
  const aal = verifiedAal(user.factors, data?.claims?.aal);
  const step = consoleMfaStep(user.factors, aal?.current ?? null);
  if (step === 'setup') redirect('/console/mfa/setup');
  if (step === 'verify') redirect('/console/login/mfa');
  const { data: ok } = await supabase.rpc('is_console_admin');
  if (!ok) {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/console/login?reason=not-admin');
  }
  return { userId: user.id, email: user.email ?? '' };
});
```

(Check `verifiedAal`'s return type in `src/lib/auth/redirects.ts` — `Aal` is `{ current, next } | null`.)

- [ ] **Step 6: Make the 2FA components reusable.**
  - `src/app/login/mfa/mfa-form.tsx`: `export function MfaForm({ action }: { action: (prev: MfaState, formData: FormData) => Promise<MfaState> })` and `useActionState(action, {})`; drop the `./actions` import of `verifyMfa` (keep the `MfaState` type import). Its page passes `action={verifyMfa}`.
  - `src/app/(app)/account/security/enroll-totp.tsx`: `export function EnrollTotp({ start, confirm, onDone }: { start: () => Promise<Enrollment | { error: string }>; confirm: (factorId: string, code: string) => Promise<{ ok: true } | { error: string }>; onDone?: () => void })`; use `start()`/`confirm()` instead of the imported actions, and after success call `onDone ? onDone() : router.refresh()`. Its page passes `start={startEnroll} confirm={confirmEnroll}`.
  - Run `npx playwright test mfa` later (Task 7) to prove the account page still works.

- [ ] **Step 7: Console auth actions** `src/app/console/auth-actions.ts`

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { createConsoleClient } from '@/lib/console/supabase';
import { requireConsoleUser } from '@/lib/console/session';
import { CONSOLE_LAST_SEEN_COOKIE } from '@/lib/console/middleware';
import type { Enrollment } from '@/app/(app)/account/security/actions';

export type ConsoleAuthState = { error?: string; email?: string };

export async function signInConsole(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createConsoleClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error), email };
  (await cookies()).set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // The admin guard decides: not listed → signed out; no factor → setup; factor → code.
  redirect('/console');
}

export async function verifyConsoleMfa(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  await requireConsoleUser();
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const supabase = await createConsoleClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  const factor = data.totp.find((f) => f.status === 'verified');
  if (!factor) redirect('/console/mfa/setup');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: mapAuthError(error) };
  redirect('/console');
}

export async function startConsoleEnroll(): Promise<Enrollment | { error: string }> {
  await requireConsoleUser();
  const supabase = await createConsoleClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Console ${new Date().toISOString()}` });
  if (error) return { error: mapAuthError(error) };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmConsoleEnroll(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  await requireConsoleUser();
  const supabase = await createConsoleClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) return { error: mapAuthError(error) };
  return { ok: true };
}

export async function signOutConsole(): Promise<void> {
  const supabase = await createConsoleClient();
  await supabase.auth.signOut({ scope: 'local' });
  (await cookies()).delete(CONSOLE_LAST_SEEN_COOKIE);
  redirect('/console/login');
}
```

(`MfaState` from the app is `{ error?: string }`; `ConsoleAuthState` is compatible, so `MfaForm action={verifyConsoleMfa}` type-checks. If not, widen `MfaForm`'s prop type to `(prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>`.)

- [ ] **Step 8: Pages.**
  - `src/app/console/login/login-form.tsx` (client): email + password inputs (labels "Email", "Password"), `useActionState(signInConsole, {})`, keeps the email on error (`defaultValue={state.email}`), error in `role="alert"`, button "Sign in".
  - `src/app/console/login/page.tsx` (server): `<main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24"><div className="card space-y-6"><h1 className="text-xl font-semibold">Console</h1>{reason === 'idle' && <p className="rounded bg-warn-soft p-3 text-sm text-warn">You were signed out after 15 minutes of inactivity.</p>}{reason === 'not-admin' && <p role="alert" className="rounded bg-bad-soft p-3 text-sm text-bad">Not a console admin.</p>}<ConsoleLoginForm /></div></main>` reading `reason` with `readParams(searchParams, 'reason')`.
  - `src/app/console/login/mfa/page.tsx`: `await requireConsoleUser();` then a card with `<h1>Console</h1>`, "Enter the code from your authenticator app." and `<MfaForm action={verifyConsoleMfa} />`.
  - `src/app/console/mfa/setup/page.tsx`: `await requireConsoleUser();` then a card: "Two-factor authentication is required for the console. Set up an authenticator app to continue." and a small client wrapper rendering `<EnrollTotp start={startConsoleEnroll} confirm={confirmConsoleEnroll} onDone={() => router.push('/console/login/mfa')} />`. (After enrolment the session is still aal1 until a code is verified against the new factor — `confirmConsoleEnroll`'s `challengeAndVerify` actually raises the session to aal2; if so, push to `/console` instead. Check which applies by running the E2E in Task 7 and pick the route that lands on the companies page.)
  - `src/app/console/(admin)/layout.tsx`: `const admin = await requireConsoleAdmin(); const { url, anonKey } = controlConfig();` then a header bar (`<header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3"><span className="font-semibold">Console</span><div className="flex items-center gap-3 text-sm"><span className="text-muted">{admin.email}</span><form action={signOutConsole}><button className="btn-secondary btn">Sign out</button></form></div></header>`), `<main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>` and `<IdleTimer timeoutMinutes={CONSOLE_IDLE_MINUTES} supabase={{ url, anonKey }} loginPath="/console/login" />`.
  - `src/app/console/(admin)/page.tsx` (temporary): `<h1>Companies</h1>`.

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/console src/app/console src/app/login/mfa "src/app/(app)/account/security"
git commit -m "feat(console): sign-in against the control project with mandatory TOTP and an admin guard"
```

---

### Task 4: Console data: schemas, company health and the first admin

**Files:**
- Create: `src/lib/console/schemas.ts`, `src/lib/console/schemas.test.ts`, `src/lib/console/companies.ts`, `src/lib/console/companies.test.ts`, `src/lib/console/first-admin.ts`, `src/lib/console/first-admin.test.ts`

**Interfaces:**
- Consumes: `checkTenant` (`src/lib/tenant/check.ts`, Task 1), `temporaryPassword` (`src/lib/admin/passwords.ts`).
- Produces:
  - Schemas: `registerSchema` → `{ slug, name, hosts: string[], supabaseUrl, anonKey, serviceRoleKey, databaseUrl }`; `updateSchema` → `{ slug, name, hosts }`; `statusSchema` → `{ slug, status: 'active' | 'suspended', reason, confirm }` (refine confirm === slug → `Type the company’s slug to confirm.`); `secretsSchema` → `{ slug, supabaseUrl, anonKey, serviceRoleKey, databaseUrl }`; `firstAdminSchema` → `{ slug, email, fullName }`
  - `type CompanyRow = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; supabase_url: string; anon_key: string }`
  - `listCompanies(control: SupabaseClient): Promise<CompanyRow[]>`, `getCompany(control, slug): Promise<CompanyRow | null>`, `companyAudit(control, slug): Promise<{ at: string; action: string; actor: string; reason: string | null; changed: string[] }[]>`
  - `type CompanyHealth = { problems: string[]; users: number | null; patients: number | null }`; `companyHealth(control: SupabaseClient, slug: string, opts?: { timeoutMs?: number; connect?: (url: string, key: string) => SupabaseClient; fetchImpl?: typeof fetch }): Promise<CompanyHealth>`
  - `serviceKeyOf(control, slug): Promise<string>`
  - `createFirstAdmin(company: SupabaseClient, a: { email: string; fullName: string }): Promise<{ password: string; created: boolean }>`

- [ ] **Step 1: Write the failing tests** `src/lib/console/schemas.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { firstAdminSchema, registerSchema, statusSchema } from './schemas';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const base = {
  slug: 'acme', name: 'Acme Implants', hosts: 'acme.example.com\n Clinic.Acme.com ',
  supabaseUrl: 'https://abcdefgh.supabase.co', anonKey: 'a'.repeat(30), serviceRoleKey: 's'.repeat(30),
  databaseUrl: 'postgresql://postgres.abcdefgh:pw@aws-0.pooler.supabase.com:5432/postgres',
};

describe('registerSchema', () => {
  it('splits and normalises hosts', () => {
    expect(registerSchema.parse(base).hosts).toEqual(['acme.example.com', 'clinic.acme.com']);
  });
  it('refuses a bad slug, no hosts, a bad URL and missing keys', () => {
    expect(err(registerSchema.safeParse({ ...base, slug: 'Acme Co' }))).toBe('Use 2–40 lower-case letters, digits or hyphens.');
    expect(err(registerSchema.safeParse({ ...base, hosts: '  ' }))).toBe('Enter at least one address.');
    expect(err(registerSchema.safeParse({ ...base, hosts: 'acme.example.com/x' }))).toBe('Not a valid address: acme.example.com/x');
    expect(err(registerSchema.safeParse({ ...base, supabaseUrl: 'https://evil.example.com' }))).toBe('Enter the project URL, e.g. https://abcd.supabase.co');
    expect(err(registerSchema.safeParse({ ...base, serviceRoleKey: '' }))).toBe('Paste the key.');
    expect(err(registerSchema.safeParse({ ...base, databaseUrl: 'mysql://x' }))).toBe('Paste the session pooler URI.');
  });
  it('accepts a local stack URL (development)', () => {
    expect(registerSchema.safeParse({ ...base, supabaseUrl: 'http://127.0.0.1:54421' }).success).toBe(true);
  });
});

describe('statusSchema', () => {
  const s = { slug: 'acme', status: 'suspended', reason: 'Unpaid invoice', confirm: 'acme' };
  it('needs a reason and the typed slug', () => {
    expect(statusSchema.parse(s)).toMatchObject({ reason: 'Unpaid invoice' });
    expect(err(statusSchema.safeParse({ ...s, reason: ' x ' }))).toBe('Give a reason (3–300 characters).');
    expect(err(statusSchema.safeParse({ ...s, confirm: 'acm' }))).toBe('Type the company’s slug to confirm.');
  });
});

describe('firstAdminSchema', () => {
  it('normalises the email', () => {
    expect(firstAdminSchema.parse({ slug: 'acme', email: ' Owner@Acme.COM ', fullName: 'Dr Owner' })).toEqual({ slug: 'acme', email: 'owner@acme.com', fullName: 'Dr Owner' });
  });
});
```

`src/lib/console/companies.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { companyHealth } from './companies';

function controlWith(row: object | null, secret: string | null = 'svc') {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    rpc: async () => ({ data: secret, error: null }),
  } as never;
}
const row = { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' };

function companyCounting(users: number, patients: number) {
  return (() => ({
    from: (table: string) => ({
      select: () => {
        const result = { count: table === 'patients' ? patients : users, error: null };
        return Object.assign(Promise.resolve(result), { eq: () => Promise.resolve(result), limit: () => Promise.resolve({ data: [], error: null }) });
      },
    }),
  })) as never;
}

describe('companyHealth', () => {
  it('reports OK with counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const h = await companyHealth(controlWith(row), 'acme', { connect: companyCounting(4, 120), fetchImpl });
    expect(h).toEqual({ problems: [], users: 4, patients: 120 });
  });

  it('reports a missing company and a missing service key', async () => {
    expect((await companyHealth(controlWith(null), 'nope')).problems).toEqual(['Unknown company nope']);
    expect((await companyHealth(controlWith(row, null), 'acme')).problems).toEqual(['No service key in Vault']);
  });

  it('times out a project that never answers, without waiting for it', async () => {
    vi.useFakeTimers();
    const hang = () => new Promise<Response>(() => {});
    const pending = companyHealth(controlWith(row), 'acme', { connect: companyCounting(1, 1), fetchImpl: hang as never, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ problems: ["Couldn't check: timed out"], users: null, patients: null });
    vi.useRealTimers();
  });
});
```

`src/lib/console/first-admin.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFirstAdmin } from './first-admin';

function fakeCompany(existing: string | null, profileError: string | null = null) {
  const calls: string[] = [];
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing ? { user_id: existing } : null, error: null }) }) }),
      update: (values: object) => ({ eq: async () => { calls.push(`update ${JSON.stringify(values)}`); return { error: profileError ? { message: profileError } : null }; } }),
    }),
    auth: { admin: {
      createUser: vi.fn(async () => { calls.push('create'); return { data: { user: { id: 'new-id' } }, error: null }; }),
      updateUserById: vi.fn(async (id: string) => { calls.push(`reset ${id}`); return { data: {}, error: null }; }),
      deleteUser: vi.fn(async (id: string) => { calls.push(`delete ${id}`); return { data: {}, error: null }; }),
    } },
  };
  return { client: client as never, calls };
}

describe('createFirstAdmin', () => {
  it('creates a confirmed user and makes them an active admin', async () => {
    const { client, calls } = fakeCompany(null);
    const r = await createFirstAdmin(client, { email: ' Owner@Acme.com ', fullName: 'Dr Owner' });
    expect(r.created).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    expect(calls).toEqual(['create', 'update {"full_name":"Dr Owner","role":"admin","active":true,"delegate_id":null}']);
  });

  it('resets the password of an existing user instead', async () => {
    const { client, calls } = fakeCompany('old-id');
    const r = await createFirstAdmin(client, { email: 'owner@acme.com', fullName: 'Dr Owner' });
    expect(r.created).toBe(false);
    expect(calls[0]).toBe('reset old-id');
  });

  it('removes a just-created user when the profile can’t be set', async () => {
    const { client, calls } = fakeCompany(null, 'permission denied');
    await expect(createFirstAdmin(client, { email: 'owner@acme.com', fullName: 'Dr Owner' })).rejects.toThrow('The login was not finished: permission denied');
    expect(calls.at(-1)).toBe('delete new-id');
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npm test -- src/lib/console` → FAIL (missing modules).

- [ ] **Step 3: Implement** `src/lib/console/schemas.ts`

```ts
import { z } from 'zod';
import { normaliseHost } from '@/lib/tenant/host';

const slug = z.string().trim().regex(/^[a-z0-9-]{2,40}$/, { message: 'Use 2–40 lower-case letters, digits or hyphens.' });
const name = z.string().trim().min(2, { message: 'Enter the company name (2–120 characters).' }).max(120, { message: 'Enter the company name (2–120 characters).' });
const key = z.string().trim().min(20, { message: 'Paste the key.' });
const supabaseUrl = z.string().trim().refine(
  (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) || /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(v),
  { message: 'Enter the project URL, e.g. https://abcd.supabase.co' },
);
const databaseUrl = z.string().trim().regex(/^postgres(ql)?:\/\//, { message: 'Paste the session pooler URI.' });
const hosts = z.string().transform((raw, ctx) => {
  const parts = raw.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
  if (!parts.length) {
    ctx.addIssue({ code: 'custom', message: 'Enter at least one address.' });
    return z.NEVER;
  }
  const out: string[] = [];
  for (const part of parts) {
    const host = normaliseHost(part);
    if (!host || part.includes('/')) {
      ctx.addIssue({ code: 'custom', message: `Not a valid address: ${part}` });
      return z.NEVER;
    }
    if (!out.includes(host)) out.push(host);
  }
  return out;
});
const reason = z.string().trim().min(3, { message: 'Give a reason (3–300 characters).' }).max(300, { message: 'Give a reason (3–300 characters).' });

export const registerSchema = z.object({ slug, name, hosts, supabaseUrl, anonKey: key, serviceRoleKey: key, databaseUrl });
export const updateSchema = z.object({ slug, name, hosts });
export const secretsSchema = z.object({ slug, supabaseUrl, anonKey: key, serviceRoleKey: key, databaseUrl });
export const statusSchema = z
  .object({ slug, status: z.enum(['active', 'suspended']), reason, confirm: z.string().trim() })
  .refine((s) => s.confirm === s.slug, { message: 'Type the company’s slug to confirm.' });
export const firstAdminSchema = z.object({
  slug,
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  fullName: z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100),
});
```

(`normaliseHost` rejects IPs and paths; check that `normaliseHost('acme.example.com/x')` is null — the extra `part.includes('/')` keeps the message right either way.)

- [ ] **Step 4: Implement** `src/lib/console/companies.ts`

```ts
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkTenant } from '@/lib/tenant/check';

export type CompanyRow = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended'; supabase_url: string; anon_key: string };
export type CompanyHealth = { problems: string[]; users: number | null; patients: number | null };

const COLUMNS = 'slug, name, hosts, status, supabase_url, anon_key';

export async function listCompanies(control: SupabaseClient): Promise<CompanyRow[]> {
  const { data, error } = await control.from('tenants').select(COLUMNS).order('slug');
  if (error) throw new Error('Could not load the companies.');
  return (data ?? []) as CompanyRow[];
}

export async function getCompany(control: SupabaseClient, slug: string): Promise<CompanyRow | null> {
  const { data } = await control.from('tenants').select(COLUMNS).eq('slug', slug).maybeSingle();
  return (data as CompanyRow | null) ?? null;
}

/** Change history; secrets never live in tenants rows, so `changed` is safe to show. */
export async function companyAudit(control: SupabaseClient, slug: string) {
  const { data } = await control.from('tenant_audit').select('at, action, actor, reason, before, after').eq('slug', slug).order('at', { ascending: false }).limit(50);
  return ((data ?? []) as { at: string; action: string; actor: string; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]).map((r) => ({
    at: r.at, action: r.action, actor: r.actor, reason: r.reason,
    changed: Object.keys(r.after ?? {}).filter((k) => k !== 'updated_at' && JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k])),
  }));
}

export async function serviceKeyOf(control: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await control.rpc('tenant_secret', { p_slug: slug, p_name: 'service_role_key' });
  return (data as string | null) ?? null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

const connectDefault = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Is the company's project answering with its keys, and how many active logins / patients (counts only). */
export async function companyHealth(
  control: SupabaseClient,
  slug: string,
  opts: { timeoutMs?: number; connect?: (url: string, key: string) => SupabaseClient; fetchImpl?: typeof fetch } = {},
): Promise<CompanyHealth> {
  const company = await getCompany(control, slug);
  if (!company) return { problems: [`Unknown company ${slug}`], users: null, patients: null };
  const serviceRoleKey = await serviceKeyOf(control, slug);
  if (!serviceRoleKey) return { problems: ['No service key in Vault'], users: null, patients: null };
  try {
    return await withTimeout((async () => {
      const problems = await checkTenant({ supabaseUrl: company.supabase_url, anonKey: company.anon_key, serviceRoleKey }, opts.fetchImpl);
      if (problems.length) return { problems, users: null, patients: null };
      const db = (opts.connect ?? connectDefault)(company.supabase_url, serviceRoleKey);
      const [users, patients] = await Promise.all([
        db.from('profiles').select('user_id', { count: 'exact', head: true }).eq('active', true),
        db.from('patients').select('id', { count: 'exact', head: true }),
      ]);
      return { problems: [], users: users.count ?? null, patients: patients.count ?? null };
    })(), opts.timeoutMs ?? 5000);
  } catch (e) {
    return { problems: [`Couldn't check: ${(e as Error).message}`], users: null, patients: null };
  }
}
```

Note: `checkTenant` creates its own Supabase client internally from the URL/key; for the unit test, the fake `fetchImpl` covers the anon check, and the service-key read inside `checkTenant` would hit the network. Make `checkTenant` accept an optional `connect` too (Task 1 moved it; extend its signature to `checkTenant(t, fetchImpl = fetch, connect = connectDefault)` and pass `opts.connect` through) so the test needs no network. The `companyCounting` fake already answers `.from('profiles').select().limit()`.

- [ ] **Step 5: Implement** `src/lib/console/first-admin.ts`

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';

/** Creates (or resets) a company's admin login with a one-time password; no half-made account on failure. */
export async function createFirstAdmin(company: SupabaseClient, a: { email: string; fullName: string }): Promise<{ password: string; created: boolean }> {
  const email = a.email.trim().toLowerCase();
  const password = temporaryPassword();
  const { data: existing } = await company.from('profiles').select('user_id').eq('email', email).maybeSingle();
  let userId: string;
  let created = false;
  if (existing?.user_id) {
    const { error } = await company.auth.admin.updateUserById(existing.user_id, { password, ban_duration: 'none' });
    if (error) throw new Error(`The password could not be reset: ${error.message}`);
    userId = existing.user_id;
  } else {
    const { data, error } = await company.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) throw new Error(`The login could not be created: ${error?.message ?? 'unknown error'}`);
    userId = data.user.id;
    created = true;
  }
  const { error: profileError } = await company.from('profiles').update({ full_name: a.fullName, role: 'admin', active: true, delegate_id: null }).eq('user_id', userId);
  if (profileError) {
    if (created) await company.auth.admin.deleteUser(userId);
    throw new Error(`The login was not finished: ${profileError.message}`);
  }
  return { password, created };
}
```

- [ ] **Step 6: Run the tests** — `npm test -- src/lib/console` → PASS; then `npx tsc --noEmit && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/console src/lib/tenant/check.ts
git commit -m "feat(console): form schemas, company health with counts and timeout, first admin"
```

---

### Task 5: Console pages and actions

**Files:**
- Create: `src/app/console/(admin)/actions.ts`, `src/app/console/(admin)/companies-table.tsx`, `src/app/console/(admin)/companies/new/page.tsx`, `src/app/console/(admin)/companies/new/register-form.tsx`, `src/app/console/(admin)/companies/[slug]/page.tsx`, `src/app/console/(admin)/companies/[slug]/forms.tsx`
- Modify: `src/app/console/(admin)/page.tsx` (replace the temporary heading)

**Interfaces:**
- Consumes: everything from Tasks 3–4 (`requireConsoleAdmin`, `createConsoleServiceClient`, schemas, `listCompanies`, `getCompany`, `companyAudit`, `companyHealth`, `serviceKeyOf`, `createFirstAdmin`, `checkTenant`); control rpc functions from Task 1.
- Produces (server actions, all start with `await requireConsoleAdmin()`):
  - `checkCompany(slug: string): Promise<CompanyHealth>`
  - `registerCompany(prev: FormState, formData: FormData): Promise<FormState>` (redirects to `/console/companies/<slug>` on success)
  - `updateCompany`, `setCompanyStatus`, `replaceCompanyKeys` — `(prev: FormState, formData: FormData) => Promise<FormState>`
  - `firstAdmin(prev: FirstAdminState, formData: FormData): Promise<FirstAdminState>` where `FirstAdminState = FormState & { password?: string; email?: string }`
  - `FormState` from `src/lib/patients/form-state.ts` (`failed()` keeps typed values; never echo key fields back — strip `anonKey`, `serviceRoleKey`, `databaseUrl` from `values`).

- [ ] **Step 1: Actions** `src/app/console/(admin)/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { companyHealth, getCompany, serviceKeyOf, type CompanyHealth } from '@/lib/console/companies';
import { createFirstAdmin } from '@/lib/console/first-admin';
import { firstAdminSchema, registerSchema, secretsSchema, statusSchema, updateSchema } from '@/lib/console/schemas';
import { checkTenant } from '@/lib/tenant/check';
import { failed, type FormState } from '@/lib/patients/form-state';

const SECRET_FIELDS = ['anonKey', 'serviceRoleKey', 'databaseUrl'];
/** Keeps what was typed after an error, except keys: they are never sent back to the browser. */
function failedWithoutSecrets(message: string, formData: FormData): FormState {
  const state = failed(message, formData);
  for (const k of SECRET_FIELDS) delete state.values?.[k];
  return state;
}
const fields = (formData: FormData) => Object.fromEntries(formData);

export async function checkCompany(slug: string): Promise<CompanyHealth> {
  await requireConsoleAdmin();
  return companyHealth(createConsoleServiceClient(), slug);
}

export async function registerCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = registerSchema.safeParse(fields(formData));
  if (!parsed.success) return failedWithoutSecrets(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const problems = await checkTenant({ supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, serviceRoleKey: c.serviceRoleKey });
  if (problems.length) return failedWithoutSecrets(`Not saved — the project didn't pass the check: ${problems.join('; ')}`, formData);
  const { error } = await createConsoleServiceClient().rpc('console_register_tenant', {
    p_slug: c.slug, p_name: c.name, p_hosts: c.hosts, p_supabase_url: c.supabaseUrl, p_anon_key: c.anonKey,
    p_service_role_key: c.serviceRoleKey, p_database_url: c.databaseUrl, p_actor: admin.email,
  });
  if (error) return failedWithoutSecrets(error.message, formData);
  revalidatePath('/console');
  redirect(`/console/companies/${c.slug}`);
}

export async function updateCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = updateSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const { error } = await createConsoleServiceClient().rpc('console_update_tenant', {
    p_slug: parsed.data.slug, p_name: parsed.data.name, p_hosts: parsed.data.hosts, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  revalidatePath(`/console/companies/${parsed.data.slug}`);
  return { ok: 'Saved.' };
}

export async function setCompanyStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = statusSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const s = parsed.data;
  const { error } = await createConsoleServiceClient().rpc('console_set_status', {
    p_slug: s.slug, p_status: s.status, p_reason: s.reason, p_actor: admin.email,
  });
  if (error) return failed(error.message, formData);
  revalidatePath(`/console/companies/${s.slug}`);
  revalidatePath('/console');
  return { ok: s.status === 'suspended' ? 'Suspended. Its users see “temporarily unavailable” within about a minute.' : 'Reactivated.' };
}

export async function replaceCompanyKeys(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireConsoleAdmin();
  const parsed = secretsSchema.safeParse(fields(formData));
  if (!parsed.success) return failedWithoutSecrets(parsed.error.issues[0].message, formData);
  const k = parsed.data;
  const problems = await checkTenant({ supabaseUrl: k.supabaseUrl, anonKey: k.anonKey, serviceRoleKey: k.serviceRoleKey });
  if (problems.length) return failedWithoutSecrets(`Not saved — the project didn't pass the check: ${problems.join('; ')}`, formData);
  const { error } = await createConsoleServiceClient().rpc('console_replace_secrets', {
    p_slug: k.slug, p_supabase_url: k.supabaseUrl, p_anon_key: k.anonKey, p_service_role_key: k.serviceRoleKey,
    p_database_url: k.databaseUrl, p_actor: admin.email,
  });
  if (error) return failedWithoutSecrets(error.message, formData);
  revalidatePath(`/console/companies/${k.slug}`);
  return { ok: 'Keys replaced.' };
}

export type FirstAdminState = FormState & { password?: string; email?: string };

export async function firstAdmin(_prev: FirstAdminState, formData: FormData): Promise<FirstAdminState> {
  await requireConsoleAdmin();
  const parsed = firstAdminSchema.safeParse(fields(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const control = createConsoleServiceClient();
  const company = await getCompany(control, parsed.data.slug);
  const key = company && (await serviceKeyOf(control, parsed.data.slug));
  if (!company || !key) return failed(`Unknown company ${parsed.data.slug}`, formData);
  try {
    const db = createClient(company.supabase_url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await createFirstAdmin(db, { email: parsed.data.email, fullName: parsed.data.fullName });
    return { ok: r.created ? 'Admin login created.' : 'Password reset for the existing login.', password: r.password, email: parsed.data.email };
  } catch (e) {
    return failed((e as Error).message, formData);
  }
}
```

- [ ] **Step 2: Companies page** `src/app/console/(admin)/page.tsx` (server) loads `listCompanies(createConsoleServiceClient())` after `requireConsoleAdmin()`, renders `<div className="page-header"><h1>Companies</h1><Link className="btn" href="/console/companies/new">Add company</Link></div>` and `<CompaniesTable companies={rows} />`.

  `companies-table.tsx` (client): `className="table"` with columns Company (link to `/console/companies/<slug>`, with the slug under it in `text-muted`), Addresses, Status (`badge badge-ok` Active / `badge badge-bad` Suspended), Health, Users, Patients; every `<td>` has `data-label`. A `HealthCell` per row calls `checkCompany(slug)` in a `useEffect` and shows `Checking…`, then `OK` (`text-ok`) or the problems joined with "; " (`text-bad`), and the counts (`—` when null). Each row is independent (one hanging company never blocks the others). Give each row `data-testid={`company-${slug}`}`.

- [ ] **Step 3: Add company** — `companies/new/page.tsx` (heading "Add company", the note: "The Supabase project must already exist and be migrated (`ENV_FILE=… npm run db:migrate`). Keys are checked before anything is saved, and never shown again.") and `register-form.tsx` (client, `useActionState(registerCompany, {})`): inputs with labels "Slug", "Name", "Addresses (one per line)" (textarea), "Supabase URL", "Anon key", "Service role key", "Database URL (session pooler)"; key inputs `type="password"` `autoComplete="off"` and **no** `defaultValue`; other inputs `defaultValue={valueOf(state, …)}`; error in `role="alert"`; button "Check and add".

- [ ] **Step 4: Company page** — `companies/[slug]/page.tsx` (server): `requireConsoleAdmin()`, `getCompany` (404 via `notFound()` when null), `companyAudit`; heading = company name with status badge; then four cards from `forms.tsx` (client components, each `useActionState` + `key` remount on success per CLAUDE.md's React 19 gotcha):
  - **Details**: name, addresses (textarea with `hosts.join('\n')`), hidden slug; button "Save" → `updateCompany`.
  - **Status**: shows current status; textarea "Reason"; input "Type the slug to confirm"; hidden `status` = the opposite of the current one; button "Suspend company" (`btn-danger`) or "Reactivate company" → `setCompanyStatus`; success in `role="status"`.
  - **Replace keys**: the four key fields (write-only as above) + hidden slug; button "Check and replace keys" → `replaceCompanyKeys`.
  - **First admin**: "Email", "Full name", hidden slug; button "Create admin login" → `firstAdmin`; on success show the existing `TemporaryPassword` component (`src/components/temporary-password.tsx`, check its props) with the email and password, plus "Shown once. Hand it over in person; they change it under Account security."
  - **History**: `className="table"` — When (`formatDate`/`formatTime` of `at`), Who, What (`action` + changed fields), Reason.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/console/(admin)"
git commit -m "feat(console): companies with health and counts, add, edit, suspend, replace keys, first admin"
```

---

### Task 6: `console:admin` and the local console setup

**Files:**
- Create: `scripts/console-admin.ts`, `scripts/console-admin.test.ts`, `scripts/console-local.ts`
- Modify: `package.json` (scripts), `.gitignore` (`.env.console` is covered by `.env*` — check)

**Interfaces:**
- Consumes: `migrateTarget(['--control'], env)` (label), `migrate(dir, config)`, `pgConfig`, `registerTenant` (Task 1), `temporaryPassword`, `ensureUser(admin, { email, password })` (`scripts/users.ts`).
- Produces: `npm run console:admin -- <email>`; `npm run console:local`; `parseConsoleAdminArgs(argv): { email: string }`.

- [ ] **Step 1: Write the failing test** `scripts/console-admin.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseConsoleAdminArgs } from './console-admin';

describe('parseConsoleAdminArgs', () => {
  it('takes one email, lower-cased', () => {
    expect(parseConsoleAdminArgs([' Owner@Example.com '])).toEqual({ email: 'owner@example.com' });
  });
  it('refuses anything else', () => {
    expect(() => parseConsoleAdminArgs([])).toThrow('Usage: npm run console:admin -- <email>');
    expect(() => parseConsoleAdminArgs(['not-an-email'])).toThrow('Usage: npm run console:admin -- <email>');
  });
});
```

Run `npm test -- console-admin` → FAIL.

- [ ] **Step 2: Implement** `scripts/console-admin.ts`

```ts
import './load-env';
import { createClient } from '@supabase/supabase-js';
import { ensureUser } from './users';
import { migrateTarget } from './migrate-target';
import { temporaryPassword } from '../src/lib/admin/passwords';

export function parseConsoleAdminArgs(argv: string[]): { email: string } {
  const email = (argv[0] ?? '').trim().toLowerCase();
  if (argv.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run console:admin -- <email>');
  return { email };
}

/** Creates (or resets) a console admin in the control project; needs CONTROL_SUPABASE_URL and CONTROL_SERVICE_ROLE_KEY. */
async function main() {
  const { email } = parseConsoleAdminArgs(process.argv.slice(2));
  console.log(`Target project: ${migrateTarget(['--control'], process.env).label}`);
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY missing: add the service key to the env file for this command, then remove it.');
  const control = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = temporaryPassword();
  const userId = await ensureUser(control, { email, password });
  const { error } = await control.from('console_admins').upsert({ user_id: userId, email, active: true });
  if (error) throw new Error(`Could not list ${email} as a console admin: ${error.message}`);
  console.log(`Console admin ready: ${email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in on the console address and set up 2FA at first sign-in.');
}

if (process.argv[1]?.endsWith('console-admin.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
```

(`migrateTarget(['--control'])` needs `CONTROL_DATABASE_URL` only for its config, not the label — if it throws when that is unset, compute the label with `targetLabel(process.env.CONTROL_SUPABASE_URL)` prefixed by `control ` instead.)

Run `npm test -- console-admin` → PASS.

- [ ] **Step 3: Implement** `scripts/console-local.ts` — local E2E setup: the **dev2** stack plays the control project (keeps the main stack free of control tables, so the DB tests that apply the control schema in a transaction keep working).

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { migrate } from './migrate';
import { pgConfig } from './db';
import { registerTenant } from './tenants';
import { envFileText } from './tenant-env';

/**
 * Local console E2E: the dev2 stack (npm run db:dev2:start) becomes the control project, with companies
 * "dev" (localhost → main stack) and "dev2" (tenant2.localhost → dev2 stack). Writes .env.console for the
 * dev server: set -a; source .env.console; set +a; npx playwright test console
 */
async function main() {
  const dev = parse(readFileSync('.env.local'));
  const dev2 = parse(readFileSync('.env.dev2'));
  const control = new Client(pgConfig({ DATABASE_URL: dev2.DATABASE_URL }));
  await migrate(path.join(process.cwd(), 'supabase', 'control', 'migrations'), pgConfig({ DATABASE_URL: dev2.DATABASE_URL }));
  await control.connect();
  try {
    await registerTenant(control, {
      slug: 'dev', name: 'Dev Academy', hosts: ['localhost'], supabaseUrl: dev.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: dev.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceRoleKey: dev.SUPABASE_SERVICE_ROLE_KEY, databaseUrl: dev.DATABASE_URL,
    });
    await registerTenant(control, {
      slug: 'dev2', name: 'Dev Company Two', hosts: ['tenant2.localhost'], supabaseUrl: dev2.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: dev2.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceRoleKey: dev2.SUPABASE_SERVICE_ROLE_KEY, databaseUrl: dev2.DATABASE_URL,
    });
  } finally {
    await control.end();
  }
  writeFileSync('.env.console', envFileText({
    CONTROL_SUPABASE_URL: dev2.NEXT_PUBLIC_SUPABASE_URL,
    CONTROL_SERVICE_ROLE_KEY: dev2.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_CONTROL_ANON_KEY: dev2.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    CONSOLE_HOST: 'console.localhost',
  }), { mode: 0o600 });
  console.log('Control project: dev2 stack. Companies: dev (localhost), dev2 (tenant2.localhost). Wrote .env.console.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 4: npm scripts** in `package.json`: `"console:admin": "tsx scripts/console-admin.ts"`, `"console:local": "tsx scripts/console-local.ts"`. Confirm `.env.console` is git-ignored (`git check-ignore -v web/.env.console`).

- [ ] **Step 5: Smoke run** (both stacks up: `npm run db:dev2:start`, then `ENV_FILE=.env.dev2 npm run db:migrate`): `npm run console:local` → the success line; running it twice is fine (upserts).

- [ ] **Step 6: Typecheck, lint, tests, commit**

Run: `npx tsc --noEmit && npm run lint && npm test`

```bash
git add scripts/console-admin.ts scripts/console-admin.test.ts scripts/console-local.ts package.json
git commit -m "feat(console): console:admin command and a local two-stack console setup"
```

---

### Task 7: End-to-end tests, runbook and notes

**Files:**
- Create: `tests/e2e/console.spec.ts`
- Modify: `docs/operations.md` (§G), `CLAUDE.md`

**Interfaces:**
- Consumes: the console UI (Tasks 3–5): labels "Email", "Password", "Authentication code", "Set up authenticator", "Code from app", "Activate"; buttons "Sign in", "Verify", "Add company", "Check and add", "Suspend company", "Reactivate company", "Create admin login"; row test ids `company-<slug>`; `.env.console` from Task 6.

- [ ] **Step 1: Write the spec** `tests/e2e/console.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';

// Runs only in local console mode: npm run console:local; set -a; source .env.console; set +a; npx playwright test console
test.skip(!process.env.CONSOLE_HOST, 'needs CONSOLE_HOST (npm run console:local)');

const C = 'http://console.localhost:3000';
const control = () => createClient(process.env.CONTROL_SUPABASE_URL!, process.env.CONTROL_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = `Console-${Date.now()}-pw`;
const email = `icm-console-${Date.now()}@example.com`;
let userId = '';
let secret = '';

async function signIn(page: Page, who = email, password = PASSWORD) {
  await page.goto(`${C}/console/login`);
  await page.getByLabel('Email').fill(who);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const { data, error } = await control().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  userId = data.user!.id;
  const { error: e2 } = await control().from('console_admins').insert({ user_id: userId, email });
  if (e2) throw e2;
});

test.afterAll(async () => {
  if (userId) await control().auth.admin.deleteUser(userId);
  await control().rpc('console_set_status', { p_slug: 'dev2', p_status: 'active', p_reason: 'E2E cleanup', p_actor: 'e2e' });
});

test('the console host serves only the console, company hosts never serve it', async ({ page }) => {
  expect((await page.goto(`${C}/patients`))!.status()).toBe(404);
  expect((await page.goto('http://localhost:3000/console'))!.status()).toBe(404);
  expect((await page.goto('http://tenant2.localhost:3000/console/login'))!.status()).toBe(404);
});

test('a console admin signs in with password and sets up 2FA, then sees healthy companies', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/console\/mfa\/setup$/);
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Code from app').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Activate' }).click();
  if (/\/console\/login\/mfa$/.test(page.url())) {
    await page.waitForTimeout(31_000); // a fresh TOTP window: the activation code can't be reused
    await page.getByLabel('Authentication code').fill(authenticator.generate(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  for (const slug of ['dev', 'dev2']) await expect(page.getByTestId(`company-${slug}`)).toContainText('OK');
});

test('a signed-in control user who is not a console admin is refused', async ({ page }) => {
  const other = `icm-console-no-${Date.now()}@example.com`;
  const { data } = await control().auth.admin.createUser({ email: other, password: PASSWORD, email_confirm: true });
  try {
    await signIn(page, other);
    await expect(page.getByRole('alert').filter({ hasText: 'Not a console admin.' })).toBeVisible();
  } finally {
    await control().auth.admin.deleteUser(data.user!.id);
  }
});

async function signInWith2fa(page: Page) {
  await signIn(page);
  await expect(page).toHaveURL(/\/console\/login\/mfa$/);
  await page.getByLabel('Authentication code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
}

test('suspending a company takes its site offline; reactivating brings it back', async ({ page }) => {
  await signInWith2fa(page);
  await page.goto(`${C}/console/companies/dev2`);
  await page.getByLabel('Reason').fill('E2E suspension');
  await page.getByLabel('Type the slug to confirm').fill('dev2');
  await page.getByRole('button', { name: 'Suspend company' }).click();
  await expect(page.getByRole('status')).toContainText('Suspended');
  await expect.poll(async () => (await page.request.get('http://127.0.0.1:3000/login', { headers: { host: 'tenant2.localhost:3000' } })).status(), { timeout: 90_000 }).toBe(503);
  await page.getByLabel('Reason').fill('E2E done');
  await page.getByLabel('Type the slug to confirm').fill('dev2');
  await page.getByRole('button', { name: 'Reactivate company' }).click();
  await expect.poll(async () => (await page.request.get('http://127.0.0.1:3000/login', { headers: { host: 'tenant2.localhost:3000' } })).status(), { timeout: 90_000 }).toBe(200);
  await expect(page.getByRole('table')).toContainText('E2E suspension');
});

test('a first admin created in the console can sign in on the company', async ({ page, browser }) => {
  await signInWith2fa(page);
  await page.goto(`${C}/console/companies/dev2`);
  const adminEmail = `icm-first-admin-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Full name').fill('E2E First Admin');
  await page.getByRole('button', { name: 'Create admin login' }).click();
  const password = (await page.getByTestId('temporary-password').textContent())!.trim();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('http://tenant2.localhost:3000/login');
  await p2.getByLabel('Email').fill(adminEmail);
  await p2.getByLabel('Password').fill(password);
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith('/login'));
  await ctx.close();
  const dev2 = parse(readFileSync('.env.dev2'));
  const db = createClient(dev2.NEXT_PUBLIC_SUPABASE_URL, dev2.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await db.from('profiles').select('user_id').eq('email', adminEmail).maybeSingle();
  if (data) await db.auth.admin.deleteUser(data.user_id);
});

test('adding a company checks its keys first', async ({ page }) => {
  test.skip(!existsSync('.env.dev2'), 'needs the dev2 stack');
  const dev2 = parse(readFileSync('.env.dev2'));
  await signInWith2fa(page);
  await page.getByRole('link', { name: 'Add company' }).click();
  const slug = `zz-e2e-${Date.now().toString(36)}`;
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Name').fill('E2E Added Co');
  await page.getByLabel('Addresses (one per line)').fill(`${slug}.localhost`);
  await page.getByLabel('Supabase URL').fill(dev2.NEXT_PUBLIC_SUPABASE_URL);
  await page.getByLabel('Anon key').fill('not-a-real-key-not-a-real-key');
  await page.getByLabel('Service role key').fill(dev2.SUPABASE_SERVICE_ROLE_KEY);
  await page.getByLabel('Database URL (session pooler)').fill(dev2.DATABASE_URL);
  await page.getByRole('button', { name: 'Check and add' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "didn't pass the check" })).toBeVisible();
  await page.getByLabel('Anon key').fill(dev2.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await page.getByLabel('Service role key').fill(dev2.SUPABASE_SERVICE_ROLE_KEY);
  await page.getByLabel('Database URL (session pooler)').fill(dev2.DATABASE_URL);
  await page.getByRole('button', { name: 'Check and add' }).click();
  await expect(page).toHaveURL(new RegExp(`/console/companies/${slug}$`));
  await page.goto(`${C}/console`);
  await expect(page.getByTestId(`company-${slug}`)).toContainText('OK');
  const pg = await import('pg');
  const c = new pg.Client({ connectionString: dev2.DATABASE_URL });
  await c.connect();
  await c.query('delete from public.tenants where slug = $1', [slug]);
  await c.query("delete from vault.secrets where name like 'tenant/' || $1 || '/%'", [slug]);
  await c.end();
});
```

Notes: `TemporaryPassword` must expose the password in an element with `data-testid="temporary-password"` — check `src/components/temporary-password.tsx` and use its existing test id if it has one (adjust the selector, not the component, if one exists). The 2FA TOTP code can only be used once per 30 s window, which is why the second sign-in may need a fresh window: if `Verify` fails with an "already used" error, wait for the next window (`await page.waitForTimeout(31_000)`) before the next code — add a small `freshCode` helper like `tests/e2e/mfa.spec.ts` has.

- [ ] **Step 2: Run it.** Nothing on :3000 first (`Get-NetTCPConnection -LocalPort 3000`); both stacks up; `npm run console:local`; then
`set -a; source .env.console; set +a; npx playwright test console --project=chromium` → 6 passed.
Then without the env (new shell): `npx playwright test console mfa auth isolation --project=chromium` → console skipped, `mfa` and `auth` pass (2FA components refactored in Task 3), isolation skipped. Stop the dev server and `npm run db:dev2:stop` at the end.

- [ ] **Step 3: Runbook.** In `docs/operations.md` §G add "**Console**":
  - What it is (address = `CONSOLE_HOST`; sign in with a console admin account and an authenticator app; 15-minute idle sign-out).
  - Setting it up (once, after merging part 4): 1) Vercel → Domains → add the console address to the project; Environment Variables (Production) → `CONSOLE_HOST` = that address, `NEXT_PUBLIC_CONTROL_ANON_KEY` = control anon key; re-run Release. 2) Control project → Authentication → Sign In / Providers: disable new sign-ups; Multi-Factor: enable TOTP. 3) Add `CONTROL_SERVICE_ROLE_KEY` to `.env.prod` temporarily, run `ENV_FILE=.env.prod npm run console:admin -- you@example.com`, then remove the key line. 4) Sign in, set up 2FA, check the academy row shows OK.
  - Using it: health/counts, suspend (reason + slug), add company (project must exist and be migrated), replace keys, first admin (one-time password), history. `tenant:register`/`tenant:check` still work and are recorded as `script`.
  - Local: `npm run console:local` then `set -a; source .env.console; set +a; npm run dev` → `http://console.localhost:3000/console`.

- [ ] **Step 4: CLAUDE.md.** Commands block: add `npm run console:admin -- you@example.com   # console admin in the control project (needs CONTROL_SERVICE_ROLE_KEY in the env file)` and `npm run console:local   # dev2 stack as control project + .env.console for console E2E`. Architecture: one short paragraph "**Console (part 4)**" — `CONSOLE_HOST` routed first by `routeConsole`; control-project Auth with mandatory TOTP and `console_admins`; `requireConsoleAdmin()` on every page/action; writes via `console_*` definer functions with the admin's email as `actor` (control 0002); company hosts 404 on `/console`. Update the multi-tenant status line to "parts 1–4 done; part 5 (onboarding) not started".

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/console.spec.ts ../docs/operations.md ../CLAUDE.md
git commit -m "test(e2e): console end to end; docs: console setup and use"
```
