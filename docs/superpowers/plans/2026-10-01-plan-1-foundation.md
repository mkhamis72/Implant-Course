# Plan 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js + Supabase app where invited organizers sign in (email verified,
optional TOTP 2FA), see an app shell, get signed out when idle, and Admins manage users and
settings, with every change audit-logged.

**Architecture:** Next.js 15 App Router app in `web/`, talking to a hosted Supabase dev project.
Authorization lives in Postgres (RLS + helper functions); SQL migrations are applied by a
small Node runner. DB behaviour is tested from Vitest through `pg` inside rolled-back
transactions, impersonating users via `request.jwt.claims`. UI flows are tested with Playwright
against the dev project.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `@supabase/ssr`,
`@supabase/supabase-js` v2, Zod, `pg`, Vitest, Testing Library, Playwright, `otplib@12.0.1`,
`tsx`, `dotenv`.

**Spec:** `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`
**Roadmap:** `docs/superpowers/plans/2026-10-01-roadmap.md` (this is Plan 1 of 5)

## Global Constraints

- All app code lives in `web/`. Every command below runs in `web/` unless it says otherwise.
- Next.js major version 15 (`create-next-app@15`); middleware file is `src/middleware.ts`.
- Roles are exactly `admin` and `organizer`. Delegates never get accounts.
- Accounts are invite-only. **Email verification required.** **TOTP 2FA optional per user.**
- Patients are never hard-deleted (applies from Plan 2; nothing in Plan 1 deletes clinical data).
- `audit_log` is insert-only; nothing may update or delete it.
- RLS enabled on every table; `anon` has no table privileges.
- Settings defaults: `expiry_alert_days` = 60 (1–365), `session_timeout_minutes` = 30 (5–480).
- English UI. Error messages are actionable sentences (spec §7).
- Secrets only in `web/.env.local` (git-ignored) and hosting env vars. `.env.example` is committed.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Public sign-up accidentally left on in Supabase** → the self-registered user gets an
   inactive profile, can read no data, and is shown "Account deactivated". Pinned in Task 3
   (`new auth user gets an inactive organizer profile`, `inactive user sees only own profile`)
   and Task 6 (`inactive user lands on deactivated page`).
2. **The only admin deactivates or demotes themself** → blocked with "At least one active admin
   is required." Pinned in Task 3 (`last active admin cannot be deactivated or demoted`) and
   Task 10 (no Deactivate button on own row).
3. **Expired, reused or truncated invite link** → friendly error page, not a crash. Pinned in
   Task 7 (`invalid invite token shows friendly error`).
4. **2FA-enrolled user with only a password session opens any protected URL** → always sent
   to `/login/mfa`. Pinned in Task 5 (`decideRedirect` unit tests) and Task 8 (E2E).
5. **Invite email with capitals/spaces, or an email that already exists** → normalized, and a
   clear "A user with this email already exists." message. Pinned in Task 10 (schema unit test
   + E2E duplicate invite).

---

## File Structure (Plan 1)

```
web/
  .env.example                      env var template (committed)
  package.json                      scripts added in Task 1/2
  vitest.config.ts                  unit tests (jsdom) — src/**/*.test.ts(x)
  vitest.setup.ts
  vitest.db.config.ts               DB tests (node) — tests/db/**/*.test.ts
  playwright.config.ts              E2E — tests/e2e
  scripts/
    load-env.ts                     loads .env.local for scripts/tests
    db.ts                           pgConfig()
    migrate.ts                      migrate(): applies supabase/migrations/*.sql in order
    migrate-cli.ts                  `npm run db:migrate`
    users.ts                        adminClient(), ensureUser(), setProfile()
    create-admin.ts                 `npm run create-admin -- <email> "<Name>"`
  supabase/migrations/
    0001_foundation.sql             profiles, settings, roles, RLS, last-admin guard
    0002_audit.sql                  audit_log + generic audit trigger
  tests/
    support/test-users.ts           TEST_USERS + ensureTestUsers() (shared by DB + E2E)
    db/global-setup.ts, helpers.ts, profiles.test.ts, audit.test.ts
    e2e/global-setup.ts, helpers.ts, auth.spec.ts, invite.spec.ts, mfa.spec.ts, admin.spec.ts
  src/
    middleware.ts
    lib/env.ts
    lib/supabase/{client,server,admin,middleware}.ts
    lib/auth/redirects.ts (+ .test.ts)   pure routing decision for middleware
    lib/auth/errors.ts (+ .test.ts)      Supabase auth error → message
    lib/auth/session.ts                  getCurrentProfile(), requireAdmin(), getSettings()
    lib/admin/schemas.ts (+ .test.ts)    Zod schemas for admin forms
    lib/idle.ts (+ .test.ts)             createIdleTimer()
    components/nav-items.ts (+ .test.ts)
    components/nav.tsx, idle-timer.tsx
    app/globals.css, layout.tsx
    app/actions/auth.ts                  signOut()
    app/login/{page,login-form,actions}.tsx|ts
    app/login/mfa/{page,mfa-form,actions}.tsx|ts
    app/auth/confirm/route.ts, app/auth/error/page.tsx
    app/account/set-password/{page,form,actions}.tsx|ts
    app/deactivated/page.tsx
    app/(app)/layout.tsx, page.tsx (Dashboard)
    app/(app)/account/security/{page,enroll-totp,actions}.tsx|ts
    app/(app)/admin/layout.tsx
    app/(app)/admin/users/{page,invite-form,user-row,actions}.tsx|ts
    app/(app)/admin/settings/{page,settings-form,actions}.tsx|ts
```

---

### Task 1: Scaffold the Next.js app with unit testing

**Files:**
- Create: `web/` (via create-next-app), `web/vitest.config.ts`, `web/vitest.setup.ts`
- Create: `web/src/components/nav-items.ts`, `web/src/components/nav-items.test.ts`
- Modify: `web/.gitignore`, `web/package.json`

**Interfaces:**
- Produces: `NavItem`, `NAV_ITEMS`, `visibleNavItems(role: 'admin' | 'organizer'): NavItem[]`
  in `@/components/nav-items` (later plans append items to `NAV_ITEMS`).
- Produces: `npm test` runs unit tests.

- [ ] **Step 1: Create the app** (from the repo root `D:\Claude\Claude Code\Implant Course`)

```bash
npx create-next-app@15 web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
```
Expected: `web/` created, `Success! Created web`.

- [ ] **Step 2: Install test tooling and runtime libraries** (in `web/`)

```bash
npm install @supabase/supabase-js @supabase/ssr zod server-only
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event pg @types/pg tsx dotenv @playwright/test otplib@12.0.1
npm pkg set scripts.test="vitest run"
```

- [ ] **Step 3: Allow `.env.example` to be committed** — append to `web/.gitignore`:

```
!.env.example
```

- [ ] **Step 4: Add Vitest config**

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

`web/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write the failing test** — `web/src/components/nav-items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { visibleNavItems } from './nav-items';

describe('visibleNavItems', () => {
  it('shows Admin to admins', () => {
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual(['Dashboard', 'Admin']);
  });
  it('hides Admin from organizers', () => {
    expect(visibleNavItems('organizer').map((i) => i.label)).toEqual(['Dashboard']);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./nav-items"`.

- [ ] **Step 7: Implement** — `web/src/components/nav-items.ts`:

```ts
export type Role = 'admin' | 'organizer';

export type NavItem = { href: string; label: string; adminOnly?: boolean };

// Later plans add entries here (Patients, Schedule, Inventory, ...), keeping Admin last.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/admin/users', label: 'Admin', adminOnly: true },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit** (from repo root)

```bash
git add web
git commit -m "chore: scaffold Next.js app with Vitest" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hosted dev database, migration runner and DB test harness

**Manual prerequisite (the human partner does this; the implementer stops and asks if
`.env.local` is missing):**
1. supabase.com → New project, name `implant-course-dev`, region **Central EU (Frankfurt)**.
2. Authentication → Sign In / Providers → Email: **Confirm email ON**, **Allow new users to
   sign up OFF**. Authentication → Multi-Factor → **TOTP enabled**.
3. Authentication → URL Configuration: Site URL `http://localhost:3000`; Redirect URLs
   `http://localhost:3000/**`.
4. Authentication → Emails → Templates: in **Invite user**, set the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`; in **Confirm signup**
   to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; in **Reset
   password** to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
5. Note: Supabase's built-in email only delivers to the project's team members. Before real
   invites go out, configure custom SMTP (Authentication → Emails → SMTP). Tests do not need it.
6. Copy values into `web/.env.local` (template below). `DATABASE_URL` = Connect → **Session
   pooler** URI (port 5432), password filled in, **without** any `?sslmode=` suffix. Optionally
   download the SSL certificate (Database → Settings → SSL) and set `DATABASE_CA_CERT` to its path.

**Files:**
- Create: `web/.env.example`, `web/scripts/load-env.ts`, `web/scripts/db.ts`,
  `web/scripts/migrate.ts`, `web/scripts/migrate-cli.ts`, `web/scripts/users.ts`,
  `web/tests/support/test-users.ts`, `web/vitest.db.config.ts`,
  `web/tests/db/global-setup.ts`, `web/tests/db/helpers.ts`, `web/tests/db/harness.test.ts`,
  `web/supabase/migrations/.gitkeep`

**Interfaces:**
- Produces: `pgConfig(): pg.ClientConfig` (`scripts/db.ts`).
- Produces: `migrate(dir?: string): Promise<string[]>` returns names applied (`scripts/migrate.ts`).
- Produces: `adminClient(): SupabaseClient`, `ensureUser(admin, {email, password, emailConfirm?}): Promise<string>`,
  `setProfile(pg: Client, userId: string, p: {full_name: string; role: 'admin'|'organizer'; active: boolean}): Promise<void>` (`scripts/users.ts`).
- Produces: `TEST_USERS` (keys `admin|organizer|inactive|unverified|mfa|target`, each `{email}`),
  `TEST_PASSWORD`, `TestUserIds` type, `ensureTestUsers(): Promise<TestUserIds>` (`tests/support/test-users.ts`).
- Produces: `withTx(fn)`, `actAs(c, userId | null)`, `asPostgres(c)` (`tests/db/helpers.ts`);
  `inject('testUsers')` in DB tests.
- Produces: `npm run db:migrate`, `npm run test:db`.

- [ ] **Step 1: Env template** — `web/.env.example`:

```
# Supabase project (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key — server only>
# Session pooler URI, port 5432, no ?sslmode suffix
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
# Optional: path to the Supabase SSL root certificate
DATABASE_CA_CERT=
SITE_URL=http://localhost:3000
TEST_USER_PASSWORD=Test-password-123!
```

- [ ] **Step 2: Script helpers**

`web/scripts/load-env.ts`:
```ts
import { config } from 'dotenv';

config({ path: '.env.local' });
```

`web/scripts/db.ts`:
```ts
import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';

export function pgConfig(): ClientConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
  const ca = process.env.DATABASE_CA_CERT;
  return {
    connectionString,
    ssl: ca ? { ca: readFileSync(ca, 'utf8') } : { rejectUnauthorized: false },
  };
}
```

`web/scripts/migrate.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { pgConfig } from './db';

export async function migrate(
  dir = path.join(process.cwd(), 'supabase', 'migrations'),
): Promise<string[]> {
  const client = new Client(pgConfig());
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create schema if not exists app_private;
      create table if not exists app_private.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );`);
    const { rows } = await client.query<{ name: string }>(
      'select name from app_private.schema_migrations',
    );
    const done = new Set(rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into app_private.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}
```

`web/scripts/migrate-cli.ts`:
```ts
import './load-env';
import { migrate } from './migrate';

migrate()
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
```

`web/scripts/users.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'pg';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL / service role key missing (see .env.example)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensureUser(
  admin: SupabaseClient,
  opts: { email: string; password: string; emailConfirm?: boolean },
): Promise<string> {
  const email = opts.email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const existing = data.users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
        password: opts.password,
        ban_duration: 'none',
      });
      if (updateError) throw updateError;
      return existing.id;
    }
    if (data.users.length < 1000) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: opts.password,
    email_confirm: opts.emailConfirm ?? true,
  });
  if (error) throw error;
  return data.user.id;
}

export async function setProfile(
  pg: Client,
  userId: string,
  p: { full_name: string; role: 'admin' | 'organizer'; active: boolean },
): Promise<void> {
  // Upsert: users created before migration 0001 existed have no profile row yet.
  await pg.query(
    `insert into public.profiles (user_id, email, full_name, role, active)
     select u.id, lower(u.email), $2, $3, $4 from auth.users u where u.id = $1
     on conflict (user_id) do update
       set full_name = excluded.full_name, role = excluded.role, active = excluded.active`,
    [userId, p.full_name, p.role, p.active],
  );
}
```

- [ ] **Step 3: Shared test users** — `web/tests/support/test-users.ts`:

```ts
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, ensureUser, setProfile } from '../../scripts/users';

export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'Test-password-123!';

export const TEST_USERS = {
  admin: { email: 'icm-test-admin@example.com' },
  organizer: { email: 'icm-test-organizer@example.com' },
  inactive: { email: 'icm-test-inactive@example.com' },
  unverified: { email: 'icm-test-unverified@example.com' },
  mfa: { email: 'icm-test-mfa@example.com' },
  target: { email: 'icm-test-target@example.com' },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;
export type TestUserIds = Record<TestUserKey, string>;

const PROFILES: Record<TestUserKey, { full_name: string; role: 'admin' | 'organizer'; active: boolean }> = {
  admin: { full_name: 'Test Admin', role: 'admin', active: true },
  organizer: { full_name: 'Test Organizer', role: 'organizer', active: true },
  inactive: { full_name: 'Test Inactive', role: 'organizer', active: false },
  unverified: { full_name: 'Test Unverified', role: 'organizer', active: true },
  mfa: { full_name: 'Test Mfa', role: 'organizer', active: true },
  target: { full_name: 'Test Target', role: 'organizer', active: true },
};

/** Idempotently creates the test users and resets their profiles, bans and 2FA factors. */
export async function ensureTestUsers(): Promise<TestUserIds> {
  const admin = adminClient();
  const ids = {} as TestUserIds;
  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    ids[key] = await ensureUser(admin, {
      email: TEST_USERS[key].email,
      password: TEST_PASSWORD,
      emailConfirm: key !== 'unverified',
    });
  }
  const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: ids.mfa });
  if (error) throw error;
  for (const factor of factors.factors) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: ids.mfa });
  }
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    // Profiles table exists only after migration 0001; skip silently before that.
    const { rows } = await pg.query("select to_regclass('public.profiles') as t");
    if (rows[0].t) {
      for (const key of Object.keys(PROFILES) as TestUserKey[]) {
        await setProfile(pg, ids[key], PROFILES[key]);
      }
    }
  } finally {
    await pg.end();
  }
  return ids;
}
```

- [ ] **Step 4: DB test harness**

`web/vitest.db.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/global-setup.ts'],
    setupFiles: ['./scripts/load-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
```

`web/tests/db/global-setup.ts`:
```ts
import '../../scripts/load-env';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../scripts/migrate';
import { ensureTestUsers, type TestUserIds } from '../support/test-users';

declare module 'vitest' {
  export interface ProvidedContext {
    testUsers: TestUserIds;
  }
}

export default async function setup(project: TestProject) {
  await migrate();
  project.provide('testUsers', await ensureTestUsers());
}
```

`web/tests/db/helpers.ts`:
```ts
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';

/** Runs fn inside a transaction that is always rolled back. */
export async function withTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(pgConfig());
  await c.connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => {});
    await c.end();
  }
}

/** Impersonates a Supabase user (or anon when userId is null) for the rest of the transaction. */
export async function actAs(c: Client, userId: string | null): Promise<void> {
  await c.query('reset role');
  if (userId === null) {
    await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await c.query('set local role anon');
    return;
  }
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await c.query('set local role authenticated');
}

/** Back to the connection's own (postgres) role, bypassing RLS. */
export async function asPostgres(c: Client): Promise<void> {
  await c.query('reset role');
}
```

- [ ] **Step 5: Write the harness smoke test** — `web/tests/db/harness.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';

describe('db harness', () => {
  it('impersonates a user via auth.uid()', async () => {
    const users = inject('testUsers');
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query('select auth.uid() as uid');
      expect(rows[0].uid).toBe(users.organizer);
    });
  });
});
```

- [ ] **Step 6: Add scripts and run the smoke test**

```bash
mkdir -p supabase/migrations && touch supabase/migrations/.gitkeep
npm pkg set scripts.db:migrate="tsx scripts/migrate-cli.ts" scripts.test:db="vitest run -c vitest.db.config.ts"
npm run test:db
```
Expected: PASS (1 test). If it fails with `DATABASE_URL is not set`, the manual prerequisite is
incomplete — stop and ask the human partner.

- [ ] **Step 7: Commit** (from repo root)

```bash
git add web
git commit -m "chore: add migration runner and DB test harness for hosted dev project" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Profiles, roles, settings and RLS (migration 0001)

**Files:**
- Create: `web/supabase/migrations/0001_foundation.sql`
- Test: `web/tests/db/profiles.test.ts`

**Interfaces:**
- Consumes: `withTx`, `actAs`, `asPostgres`, `inject('testUsers')`, `adminClient()` (Task 2).
- Produces (SQL): type `public.user_role`; tables `public.profiles(user_id, full_name, email,
  role, active, created_at, updated_at)`, `public.settings(id=true, expiry_alert_days,
  session_timeout_minutes, updated_at)`; functions `public.is_active_user()`,
  `public.is_admin()`, `app_private.set_updated_at()`; last-admin guard raising with
  `hint = 'last_admin'`.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/profiles.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { adminClient } from '../../scripts/users';

const users = inject('testUsers');

describe('profiles & settings', () => {
  it('new auth user gets an inactive organizer profile', async () => {
    const admin = adminClient();
    const email = `icm-new-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Xx-123456789!', email_confirm: true });
    expect(error).toBeNull();
    try {
      await withTx(async (c) => {
        const { rows } = await c.query('select role, active, email from public.profiles where user_id = $1', [data.user!.id]);
        expect(rows).toEqual([{ role: 'organizer', active: false, email }]);
      });
    } finally {
      await admin.auth.admin.deleteUser(data.user!.id);
    }
  });

  it('active organizer can read profiles and settings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const profiles = await c.query('select user_id from public.profiles');
      expect(profiles.rows.map((r) => r.user_id)).toEqual(expect.arrayContaining([users.admin, users.organizer]));
      const settings = await c.query('select expiry_alert_days, session_timeout_minutes from public.settings');
      expect(settings.rows).toHaveLength(1);
    });
  });

  it('inactive user sees only own profile and no settings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      const profiles = await c.query('select user_id from public.profiles');
      expect(profiles.rows).toEqual([{ user_id: users.inactive }]);
      const settings = await c.query('select * from public.settings');
      expect(settings.rows).toHaveLength(0);
    });
  });

  it('anon has no access', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      await expect(c.query('select * from public.profiles')).rejects.toThrow(/permission denied/);
    });
  });

  it('organizer cannot change settings or roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const s = await c.query('update public.settings set expiry_alert_days = 10');
      expect(s.rowCount).toBe(0);
      const p = await c.query("update public.profiles set role = 'admin' where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(0);
    });
  });

  it('admin can change settings and roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const s = await c.query('update public.settings set expiry_alert_days = 90');
      expect(s.rowCount).toBe(1);
      const p = await c.query("update public.profiles set role = 'admin' where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(1);
    });
  });

  it('settings values are range-checked', async () => {
    await withTx(async (c) => {
      await expect(c.query('update public.settings set session_timeout_minutes = 1')).rejects.toThrow(/check constraint/);
    });
  });

  it('last active admin cannot be deactivated or demoted', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query("update public.profiles set active = false where role = 'admin' and user_id <> $1", [users.admin]);
      await c.query('savepoint s');
      await expect(c.query('update public.profiles set active = false where user_id = $1', [users.admin]))
        .rejects.toThrow(/last active admin/);
      await c.query('rollback to savepoint s');
      await expect(c.query("update public.profiles set role = 'organizer' where user_id = $1", [users.admin]))
        .rejects.toThrow(/last active admin/);
    });
  });

  it('updated_at is set by the database, not the caller', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set updated_at = '2000-01-01'");
      const { rows } = await c.query('select extract(year from updated_at)::int as y from public.settings');
      expect(rows[0].y).not.toBe(2000);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -- profiles`
Expected: FAIL — `relation "public.profiles" does not exist`.

- [ ] **Step 3: Write the migration** — `web/supabase/migrations/0001_foundation.sql`:

```sql
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.user_role as enum ('admin', 'organizer');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role public.user_role not null default 'organizer',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settings (
  id boolean primary key default true check (id),
  expiry_alert_days int not null default 60 check (expiry_alert_days between 1 and 365),
  session_timeout_minutes int not null default 30 check (session_timeout_minutes between 5 and 480),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create function app_private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();
create trigger settings_set_updated_at before update on public.settings
  for each row execute function app_private.set_updated_at();

-- Every auth user gets an inactive organizer profile; an Admin activates it on invite.
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.active);
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create function app_private.protect_last_admin() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and active and user_id <> old.user_id
    ) then
      raise exception 'Cannot remove the last active admin' using hint = 'last_admin';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect_last_admin before update on public.profiles
  for each row execute function app_private.protect_last_admin();

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
revoke all on public.profiles, public.settings from anon;

create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() or user_id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_select on public.settings for select to authenticated
  using (public.is_active_user());
create policy settings_admin_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 4: Run tests to verify they pass** (global setup applies the migration, then
  re-runs `ensureTestUsers`, which now sets the profiles)

Run: `npm run test:db`
Expected: PASS (harness + 9 profiles tests).

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0001_foundation.sql web/tests/db/profiles.test.ts
git commit -m "feat(db): profiles, roles, settings with RLS and last-admin guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Audit log (migration 0002)

**Files:**
- Create: `web/supabase/migrations/0002_audit.sql`
- Test: `web/tests/db/audit.test.ts`

**Interfaces:**
- Produces (SQL): `public.audit_log(id, table_name, row_id, action, user_id, at, before, after)`;
  trigger function `app_private.audit_row()` taking the primary-key column name as its
  argument. **Every later plan attaches it to new tables:**
  `create trigger <t>_audit after insert or update or delete on public.<t> for each row execute function app_private.audit_row('id');`

- [ ] **Step 1: Write the failing tests** — `web/tests/db/audit.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

describe('audit_log', () => {
  it('records who changed settings with before/after values', async () => {
    await withTx(async (c) => {
      const { rows: [orig] } = await c.query('select expiry_alert_days from public.settings');
      await actAs(c, users.admin);
      await c.query('update public.settings set expiry_alert_days = $1', [orig.expiry_alert_days === 61 ? 62 : 61]);
      await asPostgres(c);
      const { rows: [log] } = await c.query(
        "select action, user_id, before, after, row_id from public.audit_log where table_name = 'settings' order by id desc limit 1",
      );
      expect(log.action).toBe('UPDATE');
      expect(log.user_id).toBe(users.admin);
      expect(log.row_id).toBe('true');
      expect(log.before.expiry_alert_days).toBe(orig.expiry_alert_days);
      expect(log.after.expiry_alert_days).not.toBe(orig.expiry_alert_days);
    });
  });

  it('records profile changes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query("update public.profiles set full_name = 'Renamed' where user_id = $1", [users.target]);
      await asPostgres(c);
      const { rows } = await c.query(
        "select after->>'full_name' as name from public.audit_log where table_name = 'profiles' and row_id = $1 order by id desc limit 1",
        [users.target],
      );
      expect(rows[0].name).toBe('Renamed');
    });
  });

  it('active users can read it, inactive users cannot', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set expiry_alert_days = expiry_alert_days");
      await actAs(c, users.organizer);
      expect((await c.query('select id from public.audit_log limit 1')).rows).toHaveLength(1);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.audit_log limit 1')).rows).toHaveLength(0);
    });
  });

  it('users cannot write to it directly', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await expect(
        c.query("insert into public.audit_log (table_name, action) values ('x', 'INSERT')"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('is immutable even for the postgres role', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set expiry_alert_days = expiry_alert_days");
      await c.query('savepoint s');
      await expect(c.query('update public.audit_log set action = action')).rejects.toThrow(/append-only/);
      await c.query('rollback to savepoint s');
      await expect(c.query('delete from public.audit_log')).rejects.toThrow(/append-only/);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -- audit`
Expected: FAIL — `relation "public.audit_log" does not exist`.

- [ ] **Step 3: Write the migration** — `web/supabase/migrations/0002_audit.sql`:

```sql
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  user_id uuid,
  at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
create index audit_log_table_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_active_user());

create function app_private.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function app_private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app_private.audit_immutable();

-- Usage: execute function app_private.audit_row('<primary key column>')
create function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  insert into public.audit_log (table_name, row_id, action, user_id, before, after)
  values (
    tg_table_name,
    coalesce(v_after, v_before) ->> tg_argv[0],
    tg_op,
    auth.uid(),
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app_private.audit_row('user_id');
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function app_private.audit_row('id');
```

- [ ] **Step 4: Run all DB tests**

Run: `npm run test:db`
Expected: PASS (harness + profiles + 5 audit tests).

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0002_audit.sql web/tests/db/audit.test.ts
git commit -m "feat(db): append-only audit log with generic row trigger" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Supabase clients, routing decision and auth error messages

**Files:**
- Create: `web/src/lib/env.ts`, `web/src/lib/supabase/client.ts`, `web/src/lib/supabase/server.ts`,
  `web/src/lib/supabase/admin.ts`, `web/src/lib/supabase/middleware.ts`, `web/src/middleware.ts`
- Create: `web/src/lib/auth/redirects.ts`, `web/src/lib/auth/errors.ts`
- Test: `web/src/lib/auth/redirects.test.ts`, `web/src/lib/auth/errors.test.ts`

**Interfaces:**
- Produces: `publicEnv`, `serverEnv()` (`@/lib/env`).
- Produces: `createClient()` browser (`@/lib/supabase/client`); `createClient(): Promise<SupabaseClient>`
  server (`@/lib/supabase/server`); `createAdminClient()` (`@/lib/supabase/admin`, server-only).
- Produces: `classifyPath(path): 'public' | 'mfa' | 'protected'`;
  `decideRedirect({ path, hasUser, aal }): string | null` where
  `aal: { current: string | null; next: string | null } | null` (`@/lib/auth/redirects`).
- Produces: `mapAuthError(error): string`, `GENERIC_AUTH_ERROR` (`@/lib/auth/errors`).

- [ ] **Step 1: Write the failing tests**

`web/src/lib/auth/redirects.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifyPath, decideRedirect } from './redirects';

const aal1 = { current: 'aal1', next: 'aal1' };
const needsMfa = { current: 'aal1', next: 'aal2' };
const aal2 = { current: 'aal2', next: 'aal2' };

describe('classifyPath', () => {
  it.each([
    ['/login', 'public'],
    ['/auth/confirm', 'public'],
    ['/auth/error', 'public'],
    ['/login/mfa', 'mfa'],
    ['/', 'protected'],
    ['/admin/users', 'protected'],
    ['/account/set-password', 'protected'],
    ['/deactivated', 'protected'],
    ['/loginx', 'protected'],
  ])('%s is %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
});

describe('decideRedirect', () => {
  it('sends anonymous users on protected pages to /login', () => {
    expect(decideRedirect({ path: '/', hasUser: false, aal: null })).toBe('/login');
  });
  it('sends anonymous users on /login/mfa to /login', () => {
    expect(decideRedirect({ path: '/login/mfa', hasUser: false, aal: null })).toBe('/login');
  });
  it('lets anonymous users see public pages', () => {
    expect(decideRedirect({ path: '/login', hasUser: false, aal: null })).toBeNull();
    expect(decideRedirect({ path: '/auth/confirm', hasUser: false, aal: null })).toBeNull();
  });
  it('lets signed-in users without 2FA through', () => {
    expect(decideRedirect({ path: '/admin/users', hasUser: true, aal: aal1 })).toBeNull();
  });
  it('forces 2FA users with a password-only session to /login/mfa on every protected page', () => {
    for (const path of ['/', '/admin/users', '/account/security', '/deactivated']) {
      expect(decideRedirect({ path, hasUser: true, aal: needsMfa })).toBe('/login/mfa');
    }
  });
  it('keeps 2FA users on /login/mfa until verified', () => {
    expect(decideRedirect({ path: '/login/mfa', hasUser: true, aal: needsMfa })).toBeNull();
  });
  it('sends fully signed-in users away from /login and /login/mfa', () => {
    expect(decideRedirect({ path: '/login', hasUser: true, aal: aal2 })).toBe('/');
    expect(decideRedirect({ path: '/login/mfa', hasUser: true, aal: aal1 })).toBe('/');
  });
  it('sends half-signed-in users from /login to /login/mfa', () => {
    expect(decideRedirect({ path: '/login', hasUser: true, aal: needsMfa })).toBe('/login/mfa');
  });
  it('never redirects the confirm route (invite links must work while signed in)', () => {
    expect(decideRedirect({ path: '/auth/confirm', hasUser: true, aal: aal2 })).toBeNull();
  });
});
```

`web/src/lib/auth/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapAuthError, GENERIC_AUTH_ERROR } from './errors';

describe('mapAuthError', () => {
  it.each([
    ['invalid_credentials', 'Incorrect email or password.'],
    ['email_not_confirmed', 'Please verify your email first — check your inbox for the verification link.'],
    ['user_banned', 'This account has been deactivated. Contact an admin.'],
    ['otp_expired', 'This link is invalid or has expired. Ask an admin to send a new invite.'],
    ['mfa_verification_failed', 'That code is not correct. Check your authenticator app and try again.'],
    ['email_exists', 'A user with this email already exists.'],
    ['missing_token', 'This link is incomplete. Open the link from your email again.'],
  ])('maps %s', (code, message) => {
    expect(mapAuthError({ code, message: 'raw' })).toBe(message);
    expect(mapAuthError(code)).toBe(message);
  });

  it('maps the legacy "already been registered" 422 to email_exists', () => {
    expect(
      mapAuthError({ status: 422, message: 'A user with this email address has already been registered' }),
    ).toBe('A user with this email already exists.');
  });

  it('falls back to a generic message and never leaks raw text', () => {
    expect(mapAuthError({ code: 'weird', message: 'stack trace...' })).toBe(GENERIC_AUTH_ERROR);
    expect(mapAuthError(null)).toBe(GENERIC_AUTH_ERROR);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./redirects` and `./errors`.

- [ ] **Step 3: Implement the pure modules**

`web/src/lib/auth/redirects.ts`:
```ts
export type PathKind = 'public' | 'mfa' | 'protected';
export type Aal = { current: string | null; next: string | null } | null;

const PUBLIC_PATHS = new Set(['/login', '/auth/confirm', '/auth/error']);

export function classifyPath(path: string): PathKind {
  if (PUBLIC_PATHS.has(path)) return 'public';
  if (path === '/login/mfa') return 'mfa';
  return 'protected';
}

function needsMfa(aal: Aal): boolean {
  return aal?.next === 'aal2' && aal.current !== 'aal2';
}

/** Returns the path to redirect to, or null to let the request through. */
export function decideRedirect(input: { path: string; hasUser: boolean; aal: Aal }): string | null {
  const { path, hasUser, aal } = input;
  const kind = classifyPath(path);
  if (kind === 'public') {
    if (path === '/login' && hasUser) return needsMfa(aal) ? '/login/mfa' : '/';
    return null;
  }
  if (!hasUser) return '/login';
  if (kind === 'mfa') return needsMfa(aal) ? null : '/';
  return needsMfa(aal) ? '/login/mfa' : null;
}
```

`web/src/lib/auth/errors.ts`:
```ts
type AuthLikeError = { code?: string; message: string; status?: number };

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please verify your email first — check your inbox for the verification link.',
  user_banned: 'This account has been deactivated. Contact an admin.',
  otp_expired: 'This link is invalid or has expired. Ask an admin to send a new invite.',
  mfa_verification_failed: 'That code is not correct. Check your authenticator app and try again.',
  mfa_challenge_expired: 'The code expired. Enter the current code from your app.',
  same_password: 'Choose a password different from your current one.',
  weak_password: 'That password is too weak. Use at least 10 characters.',
  email_exists: 'A user with this email already exists.',
  missing_token: 'This link is incomplete. Open the link from your email again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
};

export const GENERIC_AUTH_ERROR = 'Something went wrong. Please try again.';

export function mapAuthError(error: AuthLikeError | string | null | undefined): string {
  if (!error) return GENERIC_AUTH_ERROR;
  const code = typeof error === 'string' ? error : error.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (typeof error !== 'string' && error.status === 422 && /already been registered/i.test(error.message)) {
    return MESSAGES.email_exists;
  }
  return GENERIC_AUTH_ERROR;
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS (nav-items, redirects, errors).

- [ ] **Step 5: Supabase clients and middleware**

`web/src/lib/env.ts`:
```ts
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

// Direct process.env.NEXT_PUBLIC_* access so Next.js inlines them into client bundles.
export const publicEnv = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

export function serverEnv() {
  return {
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    siteUrl: process.env.SITE_URL ?? 'http://localhost:3000',
  };
}
```

`web/src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
```

`web/src/lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes them.
        }
      },
    },
  });
}
```

`web/src/lib/supabase/admin.ts`:
```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/** Service-role client. Use ONLY for auth admin operations (invite, ban); data writes go through the user's client so RLS and audit apply. */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl, serverEnv().serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

`web/src/lib/supabase/middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { decideRedirect, type Aal } from '@/lib/auth/redirects';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let aal: Aal = null;
  if (user) {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = data ? { current: data.currentLevel, next: data.nextLevel } : null;
  }

  const target = decideRedirect({ path: request.nextUrl.pathname, hasUser: !!user, aal });
  if (!target) return response;

  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = '';
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
```

`web/src/middleware.ts`:
```ts
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; unit tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(auth): Supabase clients, middleware routing and auth error messages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Login, sign-out, app shell and deactivated page (+ Playwright setup)

**Files:**
- Create: `web/playwright.config.ts`, `web/tests/e2e/global-setup.ts`, `web/tests/e2e/helpers.ts`,
  `web/tests/e2e/auth.spec.ts`
- Create: `web/src/lib/auth/session.ts`, `web/src/app/actions/auth.ts`,
  `web/src/app/login/page.tsx`, `web/src/app/login/login-form.tsx`, `web/src/app/login/actions.ts`,
  `web/src/app/deactivated/page.tsx`, `web/src/app/(app)/layout.tsx`, `web/src/app/(app)/page.tsx`,
  `web/src/components/nav.tsx`
- Modify: `web/src/app/globals.css`, `web/src/app/layout.tsx`; Delete: `web/src/app/page.tsx`

**Interfaces:**
- Consumes: `createClient` (server), `mapAuthError`, `visibleNavItems`, `TEST_USERS`, `TEST_PASSWORD`, `ensureTestUsers`.
- Produces: `Profile` type, `getCurrentProfile(): Promise<Profile | null>`, `requireAdmin(): Promise<Profile>`,
  `getSettings(): Promise<{ expiry_alert_days: number; session_timeout_minutes: number }>` (`@/lib/auth/session`).
- Produces: `signOut()` server action (`@/app/actions/auth`).
- Produces: `login(page, email, password?)` E2E helper (`tests/e2e/helpers.ts`).
- Produces: CSS classes `.input`, `.btn`, `.btn-secondary`, `.card`, `.label` in `globals.css`.

- [ ] **Step 1: Playwright config and helpers**

```bash
npx playwright install chromium
npm pkg set scripts.test:e2e="playwright test"
```

`web/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
import './scripts/load-env';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

`web/tests/e2e/global-setup.ts`:
```ts
import '../../scripts/load-env';
import { migrate } from '../../scripts/migrate';
import { ensureTestUsers } from '../support/test-users';

export default async function globalSetup() {
  await migrate();
  await ensureTestUsers();
}
```

`web/tests/e2e/helpers.ts`:
```ts
import { expect, type Page } from '@playwright/test';
import { TEST_PASSWORD } from '../support/test-users';

export async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

export async function expectDashboard(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
```

- [ ] **Step 2: Write the failing E2E tests** — `web/tests/e2e/auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_PASSWORD } from '../support/test-users';
import { login, expectDashboard } from './helpers';

test('anonymous visitor is sent to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('organizer signs in, sees shell without Admin, and signs out', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await expectDashboard(page);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows a clear message and keeps the email', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USERS.organizer.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
  await expect(page.getByLabel('Email')).toHaveValue(TEST_USERS.organizer.email);
});

test('unverified email cannot sign in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USERS.unverified.email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Please verify your email first');
});

test('inactive user lands on deactivated page', async ({ page }) => {
  await login(page, TEST_USERS.inactive.email);
  await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
});

test('signed-in user visiting /login goes to dashboard', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/login');
  await expectDashboard(page);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:e2e -- auth.spec.ts`
Expected: FAIL — `/login` has no "Email" field (default Next.js page).

- [ ] **Step 4: Base styles and root layout**

Replace `web/src/app/globals.css` with:
```css
@import "tailwindcss";

:root {
  color-scheme: light;
}

body {
  background: #f6f7f9;
  color: #1f2937;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

.label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
.input {
  width: 100%; border: 1px solid #cbd5e1; border-radius: 0.375rem;
  padding: 0.5rem 0.75rem; background: #fff;
}
.input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
.btn {
  display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 0.375rem;
  padding: 0.5rem 1rem; background: #1d4ed8; color: #fff; font-weight: 500;
}
.btn:disabled { opacity: 0.6; }
.btn-secondary { background: #fff; color: #1f2937; border: 1px solid #cbd5e1; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; }
```

Replace `web/src/app/layout.tsx` with:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Implant Course Manager',
  description: 'Patients, implants, inventory and courses for implant-course organizers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Delete `web/src/app/page.tsx` (replaced by `(app)/page.tsx`).

- [ ] **Step 5: Session helpers and sign-out**

`web/src/lib/auth/session.ts`:
```ts
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/components/nav-items';

export type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
};

export type Settings = { expiry_alert_days: number; session_timeout_minutes: number };

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active')
    .eq('user_id', user.id)
    .single();
  return (data as Profile | null) ?? null;
});

export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || profile.role !== 'admin') redirect('/');
  return profile;
}

export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('expiry_alert_days, session_timeout_minutes')
    .single();
  if (error || !data) throw new Error('Could not load settings');
  return data as Settings;
});
```

`web/src/app/actions/auth.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 6: Login page**

`web/src/app/login/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error), email };
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  redirect(data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2' ? '/login/mfa' : '/');
}
```

`web/src/app/login/login-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button className="btn w-full justify-center" disabled={pending}>
        Sign in
      </button>
    </form>
  );
}
```

`web/src/app/login/page.tsx`:
```tsx
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm">
      <div className="card space-y-6">
        <h1 className="text-xl font-semibold">Implant Course Manager</h1>
        {reason === 'idle' && (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">You were signed out after a period of inactivity.</p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: App shell, dashboard and deactivated page**

`web/src/components/nav.tsx`:
```tsx
import Link from 'next/link';
import { visibleNavItems, type Role } from './nav-items';
import { signOut } from '@/app/actions/auth';

export function Nav({ role, name }: { role: Role; name: string }) {
  return (
    <aside className="flex w-56 flex-col border-r border-gray-200 bg-white p-4">
      <div className="mb-6 font-semibold">Implant Course Manager</div>
      <nav className="flex flex-1 flex-col gap-1">
        {visibleNavItems(role).map((item) => (
          <Link key={item.href} href={item.href} className="rounded px-2 py-1.5 hover:bg-gray-100">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2 border-t border-gray-200 pt-4 text-sm">
        <div className="truncate text-gray-600">{name}</div>
        <Link href="/account/security" className="block hover:underline">
          Account security
        </Link>
        <form action={signOut}>
          <button className="text-left hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
```

`web/src/app/(app)/layout.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { getCurrentProfile } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  return (
    <div className="flex min-h-screen">
      <Nav role={profile.role} name={profile.full_name || profile.email} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

`web/src/app/(app)/page.tsx`:
```tsx
import { getCurrentProfile } from '@/lib/auth/session';

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">Welcome, {profile?.full_name || profile?.email}.</p>
    </div>
  );
}
```

`web/src/app/deactivated/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/lib/auth/session';
import { signOut } from '@/app/actions/auth';

export default async function DeactivatedPage() {
  const profile = await getCurrentProfile();
  if (profile?.active) redirect('/');
  return (
    <main className="mx-auto mt-24 max-w-md">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Account deactivated</h1>
        <p className="text-gray-700">Your account is not active. Ask an admin to activate it.</p>
        <form action={signOut}>
          <button className="btn-secondary btn">Sign out</button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Run E2E tests**

Run: `npm run test:e2e -- auth.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add web
git commit -m "feat(auth): login, sign-out, app shell and deactivated page with E2E tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Invite acceptance — confirm route, error page, set password

**Files:**
- Create: `web/src/app/auth/confirm/route.ts`, `web/src/app/auth/error/page.tsx`,
  `web/src/app/account/set-password/page.tsx`, `web/src/app/account/set-password/form.tsx`,
  `web/src/app/account/set-password/actions.ts`
- Test: `web/tests/e2e/invite.spec.ts`

**Interfaces:**
- Consumes: `createClient` (server), `mapAuthError`, `adminClient`, `setProfile`, `pgConfig`.
- Produces: route `GET /auth/confirm?token_hash&type` → `/account/set-password` (invite, recovery),
  `/` (email), or `/auth/error?code=<code>`; page `/account/set-password` (also used for
  "Change password").

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/invite.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, setProfile } from '../../scripts/users';
import { expectDashboard } from './helpers';

test('invited user accepts invite, sets a password and reaches the dashboard', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-invite-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email });
  expect(error).toBeNull();
  const userId = data.user!.id;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: 'Invited Organizer', role: 'organizer', active: true });
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
    await expect(page).toHaveURL(/\/account\/set-password$/);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Fresh-password-123');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expectDashboard(page);
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(userId);
  }
});

test('mismatched passwords are rejected', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-invite-mm-${Date.now()}@example.com`;
  const { data } = await admin.auth.admin.generateLink({ type: 'invite', email });
  try {
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Different-password-1');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  } finally {
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});

test('invalid invite token shows friendly error', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=invite');
  await expect(page).toHaveURL(/\/auth\/error/);
  await expect(page.getByText('This link is invalid or has expired. Ask an admin to send a new invite.')).toBeVisible();
});

test('link without a token shows friendly error', async ({ page }) => {
  await page.goto('/auth/confirm');
  await expect(page.getByText('This link is incomplete. Open the link from your email again.')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e -- invite.spec.ts`
Expected: FAIL — `/auth/confirm` returns 404.

- [ ] **Step 3: Implement the confirm route and error page**

`web/src/app/auth/confirm/route.ts`:
```ts
import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'signup'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    redirect('/auth/error?code=missing_token');
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    // Any verification failure (bad, used or expired token) reads as "invalid or expired".
    redirect(`/auth/error?code=${error.code === 'over_request_rate_limit' ? error.code : 'otp_expired'}`);
  }
  redirect(type === 'invite' || type === 'recovery' ? '/account/set-password' : '/');
}
```

`web/src/app/auth/error/page.tsx`:
```tsx
import Link from 'next/link';
import { mapAuthError } from '@/lib/auth/errors';

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-md">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Link problem</h1>
        <p className="text-gray-700">{mapAuthError(code ?? 'otp_expired')}</p>
        <Link href="/login" className="btn-secondary btn">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Implement set-password**

`web/src/app/account/set-password/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';

export type SetPasswordState = { error?: string };

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: mapAuthError(error) };
  redirect('/');
}
```

`web/src/app/account/set-password/form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { setPassword, type SetPasswordState } from './actions';

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">New password</span>
        <input className="input" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <label className="block">
        <span className="label">Confirm password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button className="btn" disabled={pending}>
        Save password
      </button>
    </form>
  );
}
```

`web/src/app/account/set-password/page.tsx`:
```tsx
import { SetPasswordForm } from './form';

export default function SetPasswordPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-gray-600">At least 10 characters.</p>
        <SetPasswordForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run E2E tests**

Run: `npm run test:e2e -- invite.spec.ts auth.spec.ts`
Expected: PASS (4 invite + 6 auth tests).

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(auth): invite acceptance with confirm route, error page and set-password" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Optional TOTP two-factor authentication

**Files:**
- Create: `web/src/app/(app)/account/security/page.tsx`, `.../security/enroll-totp.tsx`,
  `.../security/actions.ts`, `web/src/app/login/mfa/page.tsx`, `web/src/app/login/mfa/mfa-form.tsx`,
  `web/src/app/login/mfa/actions.ts`
- Test: `web/tests/e2e/mfa.spec.ts`

**Interfaces:**
- Consumes: `createClient` (server), `mapAuthError`, `signOut`, `login`, `expectDashboard`.
- Produces: `startEnroll(): Promise<Enrollment | { error: string }>`,
  `confirmEnroll(factorId: string, code: string): Promise<{ ok: true } | { error: string }>`,
  `removeFactor(formData: FormData): Promise<void>`; `verifyMfa(prev, formData)`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/mfa.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';
import { TEST_USERS } from '../support/test-users';
import { login, expectDashboard } from './helpers';

async function freshCode(secret: string, notThis: string): Promise<string> {
  let code = authenticator.generate(secret);
  while (code === notThis) {
    await new Promise((r) => setTimeout(r, 1000));
    code = authenticator.generate(secret);
  }
  return code;
}

test('user enables 2FA, must use it at next sign-in, then removes it', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, TEST_USERS.mfa.email);
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const firstCode = authenticator.generate(secret);
  await page.getByLabel('Code from app').fill(firstCode);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Authenticator active')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, TEST_USERS.mfa.email);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\/mfa$/);

  await page.getByLabel('Authentication code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not correct. Check your authenticator app and try again.');

  await page.getByLabel('Authentication code').fill(await freshCode(secret, firstCode));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expectDashboard(page);

  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Remove authenticator' }).click();
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e -- mfa.spec.ts`
Expected: FAIL — `/account/security` returns 404.

- [ ] **Step 3: Implement security page actions** — `web/src/app/(app)/account/security/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';

export type Enrollment = { factorId: string; qrCode: string; secret: string };

export async function startEnroll(): Promise<Enrollment | { error: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString()}`,
  });
  if (error) return { error: mapAuthError(error) };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnroll(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) return { error: mapAuthError(error) };
  revalidatePath('/account/security');
  return { ok: true };
}

export async function removeFactor(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: String(formData.get('factor_id')) });
  if (error) throw new Error(mapAuthError(error));
  revalidatePath('/account/security');
}
```

- [ ] **Step 4: Enrollment component** — `web/src/app/(app)/account/security/enroll-totp.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmEnroll, startEnroll, type Enrollment } from './actions';

export function EnrollTotp() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      const result = await startEnroll();
      if ('error' in result) setError(result.error);
      else setEnrollment(result);
    });
  }

  function activate(event: React.FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmEnroll(enrollment.factorId, code);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEnrollment(null);
      setCode('');
      router.refresh();
    });
  }

  if (!enrollment) {
    return (
      <div className="space-y-2">
        <button className="btn" onClick={begin} disabled={pending}>
          Set up authenticator
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4">
      <p className="text-sm text-gray-700">
        Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), or enter the key manually.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qrCode} alt="Authenticator QR code" width={180} height={180} />
      <p className="text-sm">
        Key: <code data-testid="totp-secret" className="rounded bg-gray-100 px-1">{enrollment.secret}</code>
      </p>
      <label className="block max-w-xs">
        <span className="label">Code from app</span>
        <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn" disabled={pending}>
        Activate
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Security page** — `web/src/app/(app)/account/security/page.tsx`:

```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { EnrollTotp } from './enroll-totp';
import { removeFactor } from './actions';

export default async function SecurityPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Account security</h1>
      <section className="card space-y-4">
        <h2 className="font-semibold">Two-factor authentication (optional)</h2>
        {verified.length > 0 ? (
          <div className="space-y-3">
            <p className="text-green-800">Authenticator active</p>
            {verified.map((factor) => (
              <form key={factor.id} action={removeFactor}>
                <input type="hidden" name="factor_id" value={factor.id} />
                <button className="btn-secondary btn">Remove authenticator</button>
              </form>
            ))}
          </div>
        ) : (
          <EnrollTotp />
        )}
      </section>
      <section className="card space-y-2">
        <h2 className="font-semibold">Password</h2>
        <Link href="/account/set-password" className="text-blue-700 hover:underline">
          Change password
        </Link>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: MFA challenge at sign-in**

`web/src/app/login/mfa/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';

export type MfaState = { error?: string };

export async function verifyMfa(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const supabase = await createClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  const factor = data.totp.find((f) => f.status === 'verified');
  if (!factor) redirect('/');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: mapAuthError(error) };
  redirect('/');
}
```

`web/src/app/login/mfa/mfa-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { verifyMfa, type MfaState } from './actions';

export function MfaForm() {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfa, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Authentication code</span>
        <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button className="btn w-full justify-center" disabled={pending}>
        Verify
      </button>
    </form>
  );
}
```

`web/src/app/login/mfa/page.tsx`:
```tsx
import { MfaForm } from './mfa-form';
import { signOut } from '@/app/actions/auth';

export default function MfaPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Two-factor authentication</h1>
        <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
        <MfaForm />
        <form action={signOut}>
          <button className="text-sm hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Run E2E tests**

Run: `npm run test:e2e`
Expected: PASS (auth, invite, mfa).

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(auth): optional TOTP two-factor enrolment and sign-in challenge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Idle session timeout

**Files:**
- Create: `web/src/lib/idle.ts`, `web/src/components/idle-timer.tsx`
- Modify: `web/src/app/(app)/layout.tsx`
- Test: `web/src/lib/idle.test.ts`, `web/src/components/idle-timer.test.tsx`

**Interfaces:**
- Consumes: `getSettings()` (Task 6), browser `createClient()` (Task 5).
- Produces: `createIdleTimer(timeoutMs: number, onIdle: () => void): { reset(): void; stop(): void }`;
  `<IdleTimer timeoutMinutes={number} onIdle?={() => void} />`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/idle.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleTimer } from './idle';

describe('createIdleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the timeout with no activity', () => {
    const onIdle = vi.fn();
    createIdleTimer(1000, onIdle);
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('activity pushes the deadline back', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer(1000, onIdle);
    vi.advanceTimersByTime(800);
    timer.reset();
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stop cancels it', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer(1000, onIdle);
    timer.stop();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
```

`web/src/components/idle-timer.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { IdleTimer } from './idle-timer';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));

describe('<IdleTimer>', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls onIdle after the configured minutes, reset by key presses', () => {
    const onIdle = vi.fn();
    render(<IdleTimer timeoutMinutes={5} onIdle={onIdle} />);
    vi.advanceTimersByTime(4 * 60_000);
    fireEvent.keyDown(window);
    vi.advanceTimersByTime(4 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./idle` and `./idle-timer`.

- [ ] **Step 3: Implement**

`web/src/lib/idle.ts`:
```ts
export function createIdleTimer(timeoutMs: number, onIdle: () => void) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let fired = false;

  function stop() {
    if (handle) clearTimeout(handle);
    handle = undefined;
  }

  function reset() {
    if (fired) return;
    stop();
    handle = setTimeout(() => {
      fired = true;
      onIdle();
    }, timeoutMs);
  }

  reset();
  return { reset, stop };
}
```

`web/src/components/idle-timer.tsx`:
```tsx
'use client';

import { useEffect } from 'react';
import { createIdleTimer } from '@/lib/idle';
import { createClient } from '@/lib/supabase/client';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

async function signOutForIdle() {
  await createClient().auth.signOut();
  window.location.assign('/login?reason=idle');
}

export function IdleTimer({ timeoutMinutes, onIdle = signOutForIdle }: { timeoutMinutes: number; onIdle?: () => void }) {
  useEffect(() => {
    const timer = createIdleTimer(timeoutMinutes * 60_000, onIdle);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, timer.reset, { passive: true }));
    return () => {
      timer.stop();
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, timer.reset));
    };
  }, [timeoutMinutes, onIdle]);
  return null;
}
```

- [ ] **Step 4: Mount it in the app shell** — in `web/src/app/(app)/layout.tsx`, change the
  imports and return value to:

```tsx
import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { IdleTimer } from '@/components/idle-timer';
import { getCurrentProfile, getSettings } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen">
      <Nav role={profile.role} name={profile.full_name || profile.email} />
      <main className="flex-1 p-6">{children}</main>
      <IdleTimer timeoutMinutes={settings.session_timeout_minutes} />
    </div>
  );
}
```

- [ ] **Step 5: Run unit and E2E tests**

Run: `npm test && npm run test:e2e -- auth.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(auth): sign out after configurable idle timeout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin — users (invite, role, deactivate)

**Files:**
- Create: `web/src/lib/admin/schemas.ts`, `web/src/app/(app)/admin/layout.tsx`,
  `web/src/app/(app)/admin/users/page.tsx`, `.../users/invite-form.tsx`, `.../users/user-row.tsx`,
  `.../users/actions.ts`
- Test: `web/src/lib/admin/schemas.test.ts`, `web/tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `getCurrentProfile`, `Profile`, `createClient` (server),
  `createAdminClient`, `serverEnv`, `mapAuthError`.
- Produces: `inviteSchema`, `setRoleSchema`, `setActiveSchema`, `settingsSchema` (`@/lib/admin/schemas`);
  `ActionState = { ok?: string; error?: string }`; actions `inviteUser`, `setUserRole`, `setUserActive`.

- [ ] **Step 1: Write failing schema tests** — `web/src/lib/admin/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inviteSchema, settingsSchema, setActiveSchema } from './schemas';

describe('inviteSchema', () => {
  it('normalizes email and name', () => {
    expect(
      inviteSchema.parse({ email: '  Dr.Ali@Clinic.COM ', full_name: '  Ali Hassan ', role: 'organizer' }),
    ).toEqual({ email: 'dr.ali@clinic.com', full_name: 'Ali Hassan', role: 'organizer' });
  });
  it('rejects bad email, short name and unknown role', () => {
    expect(inviteSchema.safeParse({ email: 'nope', full_name: 'Ali', role: 'organizer' }).error?.issues[0].message)
      .toBe('Enter a valid email address.');
    expect(inviteSchema.safeParse({ email: 'a@b.co', full_name: 'A', role: 'organizer' }).error?.issues[0].message)
      .toBe('Enter the full name (at least 2 characters).');
    expect(inviteSchema.safeParse({ email: 'a@b.co', full_name: 'Ali', role: 'delegate' }).success).toBe(false);
  });
});

describe('settingsSchema', () => {
  it('coerces form strings and enforces ranges', () => {
    expect(settingsSchema.parse({ expiry_alert_days: '60', session_timeout_minutes: '30' })).toEqual({
      expiry_alert_days: 60,
      session_timeout_minutes: 30,
    });
    expect(settingsSchema.safeParse({ expiry_alert_days: '0', session_timeout_minutes: '30' }).success).toBe(false);
    expect(settingsSchema.safeParse({ expiry_alert_days: '60', session_timeout_minutes: '481' }).success).toBe(false);
    expect(settingsSchema.safeParse({ expiry_alert_days: '6.5', session_timeout_minutes: '30' }).success).toBe(false);
  });
});

describe('setActiveSchema', () => {
  it('parses the hidden form values', () => {
    expect(
      setActiveSchema.parse({ user_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', active: 'false' }),
    ).toEqual({ user_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', active: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./schemas`.

- [ ] **Step 3: Implement schemas** — `web/src/lib/admin/schemas.ts`:

```ts
import { z } from 'zod';

const role = z.enum(['admin', 'organizer']);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  full_name: z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100),
  role,
});

export const setRoleSchema = z.object({ user_id: z.string().uuid(), role });

export const setActiveSchema = z.object({
  user_id: z.string().uuid(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const settingsSchema = z.object({
  expiry_alert_days: z.coerce
    .number()
    .int({ message: 'Expiry alert must be a whole number of days.' })
    .min(1, { message: 'Expiry alert must be between 1 and 365 days.' })
    .max(365, { message: 'Expiry alert must be between 1 and 365 days.' }),
  session_timeout_minutes: z.coerce
    .number()
    .int({ message: 'Session timeout must be a whole number of minutes.' })
    .min(5, { message: 'Session timeout must be between 5 and 480 minutes.' })
    .max(480, { message: 'Session timeout must be between 5 and 480 minutes.' }),
});

export type ActionState = { ok?: string; error?: string };
```

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the failing E2E tests** — `web/tests/e2e/admin.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';

test.describe('admin users', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.admin.email);
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });

  test('lists users with their roles and status', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.organizer.email}`);
    await expect(row).toContainText('Test Organizer');
    await expect(row).toContainText('Active');
  });

  test('cannot deactivate or demote own account', async ({ page }) => {
    const own = page.getByTestId(`user-row-${TEST_USERS.admin.email}`);
    await expect(own.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
    await expect(own.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(own).toContainText('(you)');
  });

  test('deactivates and reactivates a user', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.target.email}`);
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expect(row).toContainText('Active');
  });

  test('changes a role and back', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.target.email}`);
    await row.getByLabel('Role').selectOption('admin');
    await row.getByRole('button', { name: 'Change role' }).click();
    await expect(row.getByText('Role updated.')).toBeVisible();
    await row.getByLabel('Role').selectOption('organizer');
    await row.getByRole('button', { name: 'Change role' }).click();
    await expect(row.getByText('Role updated.')).toBeVisible();
  });

  test('invite form validates and reports duplicates', async ({ page }) => {
    const form = page.getByTestId('invite-form');
    await form.getByLabel('Full name').fill('Someone');
    await form.getByLabel('Email').fill(`  ${TEST_USERS.organizer.email.toUpperCase()} `);
    await form.getByRole('button', { name: 'Send invite' }).click();
    await expect(form.getByRole('alert')).toHaveText('A user with this email already exists.');
  });
});

test('organizer is redirected away from admin pages', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm run test:e2e -- admin.spec.ts`
Expected: FAIL — `/admin/users` returns 404.

- [ ] **Step 7: Admin layout** — `web/src/app/(app)/admin/layout.tsx`:

```tsx
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b border-gray-200 pb-2 text-sm">
        <Link href="/admin/users" className="hover:underline">Users</Link>
        <Link href="/admin/settings" className="hover:underline">Settings</Link>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 8: User actions** — `web/src/app/(app)/admin/users/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/session';
import { mapAuthError } from '@/lib/auth/errors';
import { serverEnv } from '@/lib/env';
import { inviteSchema, setActiveSchema, setRoleSchema, type ActionState } from '@/lib/admin/schemas';

const LAST_ADMIN = 'At least one active admin is required.';

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, full_name, role } = parsed.data;

  const { data, error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${serverEnv().siteUrl}/auth/confirm`,
  });
  if (error) return { error: mapAuthError(error) };

  // Activate through the admin's own session so RLS and the audit log record who did it.
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name, role, active: true })
    .eq('user_id', data.user.id);
  if (profileError) return { error: profileError.message };

  revalidatePath('/admin/users');
  return { ok: `Invitation sent to ${email}.` };
}

export async function setUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  if (parsed.data.user_id === me.user_id) return { error: 'You cannot change your own role.' };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update({ role: parsed.data.role }).eq('user_id', parsed.data.user_id);
  if (error) return { error: error.hint === 'last_admin' ? LAST_ADMIN : error.message };
  revalidatePath('/admin/users');
  return { ok: 'Role updated.' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const { user_id, active } = parsed.data;
  if (user_id === me.user_id) return { error: 'You cannot deactivate your own account.' };

  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update({ active }).eq('user_id', user_id);
  if (error) return { error: error.hint === 'last_admin' ? LAST_ADMIN : error.message };

  // Ban/unban in Auth so a deactivated user cannot sign in or refresh their session.
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) return { error: mapAuthError(banError) };

  revalidatePath('/admin/users');
  return { ok: active ? 'User reactivated.' : 'User deactivated.' };
}
```

- [ ] **Step 9: Invite form** — `web/src/app/(app)/admin/users/invite-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { inviteUser } from './actions';
import type { ActionState } from '@/lib/admin/schemas';

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, {});
  return (
    <form action={action} data-testid="invite-form" className="card grid gap-4 sm:grid-cols-4 sm:items-end">
      <label className="block">
        <span className="label">Full name</span>
        <input className="input" name="full_name" required />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="text" inputMode="email" required />
      </label>
      <label className="block">
        <span className="label">Role</span>
        <select className="input" name="role" defaultValue="organizer">
          <option value="organizer">Organizer</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button className="btn justify-center" disabled={pending}>
        Send invite
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-4">{state.ok}</p>}
    </form>
  );
}
```

- [ ] **Step 10: User row** — `web/src/app/(app)/admin/users/user-row.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { setUserActive, setUserRole } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import type { Profile } from '@/lib/auth/session';

export function UserRow({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState<ActionState, FormData>(setUserRole, {});
  const [activeState, activeAction, activePending] = useActionState<ActionState, FormData>(setUserActive, {});
  const message = roleState.error ?? activeState.error ?? roleState.ok ?? activeState.ok;
  const isError = Boolean(roleState.error ?? activeState.error);

  return (
    <tr data-testid={`user-row-${user.email}`} className="border-t border-gray-200 align-top">
      <td className="py-2 pr-4">
        {user.full_name || '—'} {isSelf && <span className="text-gray-500">(you)</span>}
      </td>
      <td className="py-2 pr-4">{user.email}</td>
      <td className="py-2 pr-4">
        {isSelf ? (
          <span className="capitalize">{user.role}</span>
        ) : (
          <form action={roleAction} className="flex gap-2">
            <input type="hidden" name="user_id" value={user.user_id} />
            <label>
              <span className="sr-only">Role</span>
              <select className="input py-1" name="role" defaultValue={user.role} aria-label="Role">
                <option value="organizer">Organizer</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className="btn-secondary btn py-1" disabled={rolePending}>
              Change role
            </button>
          </form>
        )}
      </td>
      <td className="py-2 pr-4">{user.active ? 'Active' : 'Inactive'}</td>
      <td className="py-2">
        {!isSelf && (
          <form action={activeAction}>
            <input type="hidden" name="user_id" value={user.user_id} />
            <input type="hidden" name="active" value={user.active ? 'false' : 'true'} />
            <button className="btn-secondary btn py-1" disabled={activePending}>
              {user.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </form>
        )}
        {message && (
          <p role={isError ? 'alert' : undefined} className={`mt-1 text-sm ${isError ? 'text-red-700' : 'text-green-800'}`}>
            {message}
          </p>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 11: Users page** — `web/src/app/(app)/admin/users/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow } from './user-row';

export default async function UsersPage() {
  const me = await getCurrentProfile();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active')
    .order('full_name');
  if (error) throw new Error('Could not load users');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <InviteForm />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {(users as Profile[]).map((user) => (
              <UserRow key={user.user_id} user={user} isSelf={user.user_id === me?.user_id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Run E2E tests**

Run: `npm run test:e2e -- admin.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 13: Commit**

```bash
git add web
git commit -m "feat(admin): user list, invites, role changes and deactivation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Admin — settings

**Files:**
- Create: `web/src/app/(app)/admin/settings/page.tsx`, `.../settings/settings-form.tsx`,
  `.../settings/actions.ts`
- Modify: `web/tests/e2e/admin.spec.ts` (append test)

**Interfaces:**
- Consumes: `settingsSchema`, `ActionState`, `requireAdmin`, `getSettings`, `Settings`.
- Produces: action `updateSettings(prev, formData)`.

- [ ] **Step 1: Append the failing E2E test** to `web/tests/e2e/admin.spec.ts`:

```ts
test('admin edits settings with validation', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const timeout = page.getByLabel('Session timeout (minutes)');
  const original = await timeout.inputValue();

  await timeout.fill('2');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert')).toHaveText('Session timeout must be between 5 and 480 minutes.');

  await timeout.fill('45');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Session timeout (minutes)')).toHaveValue('45');

  await page.getByLabel('Session timeout (minutes)').fill(original);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e -- admin.spec.ts -g "settings"`
Expected: FAIL — `/admin/settings` returns 404.

- [ ] **Step 3: Implement**

`web/src/app/(app)/admin/settings/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { settingsSchema, type ActionState } from '@/lib/admin/schemas';

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('settings').update(parsed.data).eq('id', true);
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return { ok: 'Settings saved.' };
}
```

`web/src/app/(app)/admin/settings/settings-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { updateSettings } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import type { Settings } from '@/lib/auth/session';

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSettings, {});
  return (
    <form action={action} className="card max-w-md space-y-4">
      <label className="block">
        <span className="label">Expiry alert (days)</span>
        <input className="input" name="expiry_alert_days" type="number" defaultValue={settings.expiry_alert_days} />
      </label>
      <label className="block">
        <span className="label">Session timeout (minutes)</span>
        <input className="input" name="session_timeout_minutes" type="number" defaultValue={settings.session_timeout_minutes} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save settings
      </button>
    </form>
  );
}
```

`web/src/app/(app)/admin/settings/page.tsx`:
```tsx
import { getSettings } from '@/lib/auth/session';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  );
}
```

Note: the inputs deliberately have no `min`/`max` attributes so server-side validation messages
are what the user sees (and what the test checks).

- [ ] **Step 4: Run all E2E tests**

Run: `npm run test:e2e`
Expected: PASS (auth, invite, mfa, admin).

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(admin): clinic settings page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Bootstrap admin script and setup README

**Files:**
- Create: `web/scripts/create-admin.ts`, `web/README.md` (replace create-next-app's)

**Interfaces:**
- Consumes: `adminClient`, `ensureUser`, `setProfile`, `pgConfig`.
- Produces: `npm run create-admin -- <email> "<Full Name>"`.

- [ ] **Step 1: Implement the script** — `web/scripts/create-admin.ts`:

```ts
import './load-env';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { pgConfig } from './db';
import { adminClient, ensureUser, setProfile } from './users';

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email || nameParts.length === 0) {
    console.error('Usage: npm run create-admin -- <email> "<Full Name>"');
    process.exit(1);
  }
  const password = randomBytes(12).toString('base64url');
  const userId = await ensureUser(adminClient(), { email, password });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: nameParts.join(' '), role: 'admin', active: true });
  } finally {
    await pg.end();
  }
  console.log(`Admin ready: ${email.trim().toLowerCase()}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in, then change it under Account security → Change password.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
```

```bash
npm pkg set scripts.create-admin="tsx scripts/create-admin.ts"
```

- [ ] **Step 2: Verify it** (uses a throwaway address; then remove that user)

Run: `npm run create-admin -- icm-bootstrap-check@example.com "Bootstrap Check"`
Expected: prints `Admin ready: icm-bootstrap-check@example.com` and a temporary password.
Then sign in at `http://localhost:3000/login` with it (dev server running) and confirm the
**Admin** link is visible. Delete the user in the Supabase dashboard (Authentication → Users).

- [ ] **Step 3: README** — replace `web/README.md` with:

````markdown
# Implant Course Manager — web app

Spec: `../docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`

## First-time setup
1. Create the Supabase project and auth settings described in
   `../docs/superpowers/plans/2026-10-01-plan-1-foundation.md` → Task 2 (manual prerequisite).
2. `cp .env.example .env.local` and fill it in.
3. `npm install`
4. `npm run db:migrate`
5. `npm run create-admin -- you@example.com "Your Name"` — prints a temporary password.
6. `npm run dev` → http://localhost:3000

## Tests
- `npm test` — unit tests
- `npm run test:db` — database tests against the dev project (each test rolls back)
- `npm run test:e2e` — browser tests (starts the dev server; creates `icm-test-*@example.com` users)

## Production notes
- Configure custom SMTP in Supabase before inviting real users.
- Confirm hosting location with a legal advisor under Egypt PDPL (Law 151/2020) before go-live.
````

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "chore: bootstrap admin script and setup README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
