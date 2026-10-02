# Production Deployment (Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app deployable to a production pilot:
- scripts that work against prod;
- email-off and pilot switches;
- security headers;
- release and backup workflows;
- operations and go-live docs;
- the guided first deployment.

**Architecture:**
- **Code changes:** small and test-first.
  - env-file selection for scripts;
  - `create-user`;
  - feature flags;
  - CSP headers;
  - catalog export.
- **GitHub Actions:**
  - `release.yml` runs tests, migrates prod, then calls the Vercel deploy hook;
  - `backup.yml` runs a nightly encrypted `pg_dump`.
- **Manual provisioning:** Supabase, Vercel and GitHub secrets are done by the admin in Task 9, guided step by step. Claude never handles secret values.

**Tech Stack:** Next.js 15, Supabase, Vitest, Playwright, GitHub Actions (ubuntu-latest, PostgreSQL 17 client, gpg), Vercel deploy hooks.

**Spec:** `docs/superpowers/specs/2026-10-02-production-deployment-design.md`

## Global Constraints

- **Secrets:** Claude never reads, prints or pastes secret values. Never print `web/.env.local` or `web/.env.production.local`.
- **Test guard:** DB and E2E tests and fixtures only ever target the allow-listed dev project. `scripts/test-guard.ts` stays unchanged.
- **TLS:** prod connections verify TLS. `pgConfig()` requires `DATABASE_CA_CERT` unless `ALLOW_TEST_FIXTURES=1`.
- **Migrations:**
  - backward-compatible with the previous app version;
  - applied before the new code is deployed.
- **Copy (exact strings):**
  - Email-off message: `Email isn't set up yet. Create accounts with npm run create-user (see docs/operations.md).`
  - Pilot banner: `Pilot: only test patients or patients who consented to the pilot.`
- **Defaults:** `EMAIL_ENABLED` is on unless exactly `false`. `NEXT_PUBLIC_PILOT` is on only when exactly `1`.
- **Backups:**
  - encrypted with `gpg --symmetric --cipher-algo AES256` before leaving the runner;
  - artifacts kept 14 days.
- **Region:** Frankfurt (Supabase `eu-central-1`, Vercel functions `fra1`).

## Review Focus

1. **A mistyped `ENV_FILE`** (e.g. `.env.prod.local`): scripts must stop with an error, not run against whatever environment is left over. Test in Task 1.
2. **Running `create-user` against the wrong project:** the script prints the target host before it changes anything, so the admin can tell dev from prod. Test of the output helper in Task 2.
3. **CSP blocking a real flow:** MFA QR code (data: image), browser-side Supabase calls, Next dev runtime (`unsafe-eval` in dev only). Covered by the full E2E suite, including `mfa.spec.ts`, plus a header test in Task 5.
4. **A failed test or migration in CI must not deploy:** the jobs are ordered with `needs:`, and the deploy step lives in the migrate job after the migration. Checked by Task 7's YAML review and the first real run in Task 10.
5. **Missing `BACKUP_PASSPHRASE`:** the backup must fail, never upload an unencrypted dump. An explicit check plus `set -euo pipefail` in Task 8, and the dump is written only inside the encrypting pipe.

---

### Task 1: `ENV_FILE` selects the environment file for scripts

**Files:**
- Create: `web/scripts/env-file.ts`, `web/scripts/env-file.test.ts`
- Modify: `web/scripts/load-env.ts`

**Interfaces:**
- Produces: `resolveEnvFile(env: Record<string, string | undefined>, exists: (path: string) => boolean): string`.
  - Returns `.env.local` when `ENV_FILE` is unset or empty.
  - Returns `ENV_FILE` when that file exists.
  - Throws when `ENV_FILE` is set but missing.

- [ ] **Step 1: Write the failing test** (`web/scripts/env-file.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { resolveEnvFile } from './env-file';

describe('resolveEnvFile', () => {
  it('uses .env.local by default', () => {
    expect(resolveEnvFile({}, () => false)).toBe('.env.local');
    expect(resolveEnvFile({ ENV_FILE: '' }, () => false)).toBe('.env.local');
  });
  it('uses ENV_FILE when the file exists', () => {
    expect(resolveEnvFile({ ENV_FILE: '.env.production.local' }, () => true)).toBe('.env.production.local');
  });
  it('refuses a missing ENV_FILE instead of silently using another environment', () => {
    expect(() => resolveEnvFile({ ENV_FILE: '.env.prod.local' }, () => false)).toThrow(/\.env\.prod\.local/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `cd web && npm test -- env-file`. Expected: FAIL, `Failed to resolve import "./env-file"`.

- [ ] **Step 3: Implement** (`web/scripts/env-file.ts`)

```ts
type Env = Record<string, string | undefined>;

/**
 * Which env file scripts load: .env.local (dev) unless ENV_FILE names another, e.g.
 * ENV_FILE=.env.production.local for the prod account and catalog scripts.
 */
export function resolveEnvFile(env: Env, exists: (path: string) => boolean): string {
  const chosen = env.ENV_FILE;
  if (!chosen) return '.env.local';
  if (!exists(chosen)) throw new Error(`ENV_FILE=${chosen} was not found in ${process.cwd()}. Check the file name.`);
  return chosen;
}
```

`web/scripts/load-env.ts`:

```ts
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { resolveEnvFile } from './env-file';

config({ path: resolveEnvFile(process.env, existsSync) });
```

- [ ] **Step 4: Run it and watch it pass.** Run: `npm test -- env-file`. Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/env-file.ts web/scripts/env-file.test.ts web/scripts/load-env.ts
git commit -m "feat(scripts): ENV_FILE selects the environment file; a missing file is an error"
```

### Task 2: `create-user` replaces `create-admin`

**Files:**
- Create: `web/scripts/create-user-args.ts`, `web/scripts/create-user-args.test.ts`, `web/scripts/create-user.ts`
- Delete: `web/scripts/create-admin.ts`
- Modify: `web/package.json` (scripts), `web/README.md` (setup step 5)

**Interfaces:**
- Consumes: `ensureUser(admin, { email, password })` and `setProfile(pg, userId, { full_name, role, active })` from `scripts/users.ts`; `adminClient()`; `pgConfig()`.
- Produces:
  - `parseCreateUserArgs(argv: string[]): { email: string; fullName: string; role: 'admin' | 'organizer' } | { error: string }`;
  - `targetLabel(supabaseUrl: string | undefined): string`.

- [ ] **Step 1: Write the failing test** (`web/scripts/create-user-args.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { parseCreateUserArgs, targetLabel } from './create-user-args';

describe('parseCreateUserArgs', () => {
  it('defaults to organizer and joins the name', () => {
    expect(parseCreateUserArgs(['Dr.A@Example.com ', 'Amal', 'Hassan'])).toEqual({
      email: 'dr.a@example.com', fullName: 'Amal Hassan', role: 'organizer',
    });
  });
  it('accepts --role before or after the other arguments', () => {
    expect(parseCreateUserArgs(['--role', 'admin', 'a@x.com', 'Dr A'])).toMatchObject({ role: 'admin' });
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role=organizer'])).toMatchObject({ role: 'organizer' });
  });
  it('refuses an unknown role, a missing name or a bad email', () => {
    expect(parseCreateUserArgs(['a@x.com', 'Dr A', '--role', 'owner'])).toEqual({ error: 'Unknown role "owner". Use organizer or admin.' });
    expect(parseCreateUserArgs(['a@x.com'])).toHaveProperty('error');
    expect(parseCreateUserArgs(['not-an-email', 'Dr A'])).toHaveProperty('error');
  });
});

describe('targetLabel', () => {
  it('names the Supabase project the script will change', () => {
    expect(targetLabel('https://abcd1234.supabase.co')).toBe('abcd1234.supabase.co');
    expect(targetLabel(undefined)).toBe('(NEXT_PUBLIC_SUPABASE_URL not set)');
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `npm test -- create-user-args`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`web/scripts/create-user-args.ts`)

```ts
export type Role = 'admin' | 'organizer';
export type CreateUserArgs = { email: string; fullName: string; role: Role };

export const USAGE = 'Usage: npm run create-user -- <email> "<Full Name>" [--role organizer|admin]';

export function parseCreateUserArgs(argv: string[]): CreateUserArgs | { error: string } {
  let role = 'organizer';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--role') role = argv[++i] ?? '';
    else if (a.startsWith('--role=')) role = a.slice('--role='.length);
    else rest.push(a);
  }
  if (role !== 'admin' && role !== 'organizer') return { error: `Unknown role "${role}". Use organizer or admin.` };
  const [rawEmail, ...nameParts] = rest;
  const email = (rawEmail ?? '').trim().toLowerCase();
  const fullName = nameParts.join(' ').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) return { error: USAGE };
  return { email, fullName, role };
}

/** The Supabase host a script is about to change, printed first so dev and prod can't be confused. */
export function targetLabel(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return '(NEXT_PUBLIC_SUPABASE_URL not set)';
  return new URL(supabaseUrl).host;
}
```

`web/scripts/create-user.ts`:

```ts
import './load-env';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { pgConfig } from './db';
import { adminClient, ensureUser, setProfile } from './users';
import { parseCreateUserArgs, targetLabel } from './create-user-args';

async function main() {
  const args = parseCreateUserArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    process.exit(1);
  }
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const password = randomBytes(12).toString('base64url');
  const userId = await ensureUser(adminClient(), { email: args.email, password });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: args.fullName, role: args.role, active: true });
  } finally {
    await pg.end();
  }
  console.log(`${args.role === 'admin' ? 'Admin' : 'Organizer'} ready: ${args.email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Hand it over in person. They sign in, then change it under Account security → Change password.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
```

In `web/package.json`, replace the `create-admin` script with:

```json
    "create-user": "tsx scripts/create-user.ts",
    "create-admin": "tsx scripts/create-user.ts --role admin",
    "catalog-export": "tsx scripts/catalog-export.ts"
```

(`catalog-export` is implemented in Task 6. Adding it here keeps `package.json` edits to one task.) Delete `web/scripts/create-admin.ts`. In `web/README.md`, replace step 5 with:
`5. npm run create-user -- you@example.com "Your Name" --role admin — prints a temporary password (re-run to reset it).`

- [ ] **Step 4: Run and check.**
  - Run: `npm test -- create-user-args` → expect 4 passed.
  - Run: `npx tsc --noEmit` → expect no output.
  - Run: `ENV_FILE=.env.local npm run create-user -- bad` → expect the usage line and exit 1, with no database access.

- [ ] **Step 5: Commit**

```bash
git add -A web/scripts web/package.json web/README.md
git commit -m "feat(scripts): create-user for organizers and admins; prints the target project first"
```

### Task 3: `EMAIL_ENABLED=false` replaces the invite form

**Files:**
- Create: `web/src/lib/flags.ts`, `web/src/lib/flags.test.ts`, `web/src/app/(app)/admin/users/actions.test.ts`
- Modify: `web/src/app/(app)/admin/users/page.tsx`, `web/src/app/(app)/admin/users/actions.ts`, `web/.env.example`

**Interfaces:**
- Produces (in `src/lib/flags.ts`):
  - `emailEnabled(env?): boolean`;
  - `pilotMode(env?): boolean` (used in Task 4);
  - `EMAIL_OFF_MESSAGE: string`;
  - `PILOT_MESSAGE: string` (used in Task 4).

- [ ] **Step 1: Write the failing tests**

`web/src/lib/flags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emailEnabled, pilotMode } from './flags';

describe('flags', () => {
  it('email is on unless EMAIL_ENABLED is exactly "false"', () => {
    expect(emailEnabled({})).toBe(true);
    expect(emailEnabled({ EMAIL_ENABLED: 'true' })).toBe(true);
    expect(emailEnabled({ EMAIL_ENABLED: 'false' })).toBe(false);
  });
  it('pilot mode is on only when NEXT_PUBLIC_PILOT is exactly "1"', () => {
    expect(pilotMode({})).toBe(false);
    expect(pilotMode({ NEXT_PUBLIC_PILOT: '0' })).toBe(false);
    expect(pilotMode({ NEXT_PUBLIC_PILOT: '1' })).toBe(true);
  });
});
```

`web/src/app/(app)/admin/users/actions.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

const createAdminClient = vi.fn();
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ siteUrl: 'http://localhost:3000', serviceRoleKey: 'x' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { inviteUser } from './actions';
import { EMAIL_OFF_MESSAGE } from '@/lib/flags';

afterEach(() => vi.unstubAllEnvs());

describe('inviteUser with email off', () => {
  it('refuses without contacting Supabase', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const form = new FormData();
    form.set('email', 'new@example.com');
    form.set('full_name', 'Dr New');
    form.set('role', 'organizer');
    expect(await inviteUser({}, form)).toEqual({ error: EMAIL_OFF_MESSAGE });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run: `npm test -- flags admin/users`. Expected: FAIL. `./flags` is not found, and `inviteUser` calls `createAdminClient`.

- [ ] **Step 3: Implement** (`web/src/lib/flags.ts`)

```ts
type Env = Record<string, string | undefined>;

export const EMAIL_OFF_MESSAGE = "Email isn't set up yet. Create accounts with npm run create-user (see docs/operations.md).";
export const PILOT_MESSAGE = 'Pilot: only test patients or patients who consented to the pilot.';

/** Invites need working email (Supabase SMTP). Off in the pilot: EMAIL_ENABLED=false. */
export function emailEnabled(env: Env = process.env): boolean {
  return env.EMAIL_ENABLED !== 'false';
}

/** Pilot banner on every signed-in page: NEXT_PUBLIC_PILOT=1. */
export function pilotMode(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_PILOT === '1';
}
```

In `actions.ts`, import `{ EMAIL_OFF_MESSAGE, emailEnabled } from '@/lib/flags'`. Add this line directly after `await requireAdmin();` in `inviteUser`:

```ts
  if (!emailEnabled()) return { error: EMAIL_OFF_MESSAGE };
```

In `page.tsx`, import `{ EMAIL_OFF_MESSAGE, emailEnabled } from '@/lib/flags'` and replace `<InviteForm />` with:

```tsx
      {emailEnabled() ? (
        <InviteForm />
      ) : (
        <p data-testid="email-off" className="card rule rule-warn text-sm">{EMAIL_OFF_MESSAGE}</p>
      )}
```

Append to `web/.env.example`:

```
# Production pilot switches (set in Vercel). EMAIL_ENABLED=false hides invites until SMTP is set up;
# NEXT_PUBLIC_PILOT=1 shows the pilot banner.
EMAIL_ENABLED=true
NEXT_PUBLIC_PILOT=0
# Scripts load .env.local unless ENV_FILE names another file, e.g. ENV_FILE=.env.production.local
```

- [ ] **Step 4: Run them and watch them pass.** Run: `npm test -- flags admin/users`. Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/flags.ts web/src/lib/flags.test.ts "web/src/app/(app)/admin/users" web/.env.example
git commit -m "feat: EMAIL_ENABLED=false replaces invites with the create-user instruction"
```

### Task 4: Pilot banner

**Files:**
- Create: `web/src/components/pilot-banner.tsx`, `web/src/components/pilot-banner.test.tsx`
- Modify: `web/src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `pilotMode()` and `PILOT_MESSAGE` from Task 3.
- Produces: `<PilotBanner show={boolean} />`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PilotBanner } from './pilot-banner';
import { PILOT_MESSAGE } from '@/lib/flags';

describe('<PilotBanner>', () => {
  it('shows the pilot rule only in pilot mode', () => {
    const { rerender } = render(<PilotBanner show />);
    expect(screen.getByRole('note')).toHaveTextContent(PILOT_MESSAGE);
    rerender(<PilotBanner show={false} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `npm test -- pilot-banner`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`web/src/components/pilot-banner.tsx`)

```tsx
import { PILOT_MESSAGE } from '@/lib/flags';

export function PilotBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="note" className="mb-4 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn print:hidden">
      {PILOT_MESSAGE}
    </p>
  );
}
```

In `web/src/app/(app)/layout.tsx`, import `{ PilotBanner } from '@/components/pilot-banner'` and `{ pilotMode } from '@/lib/flags'`. Change the inner container to:

```tsx
        <div className="mx-auto max-w-6xl">
          <PilotBanner show={pilotMode()} />
          {children}
        </div>
```

- [ ] **Step 4: Run and check.** Run: `npm test -- pilot-banner`, then `npx tsc --noEmit`. Expected: 1 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/pilot-banner.tsx web/src/components/pilot-banner.test.tsx "web/src/app/(app)/layout.tsx"
git commit -m "feat: pilot banner on signed-in pages when NEXT_PUBLIC_PILOT=1"
```

### Task 5: Security headers

**Files:**
- Create: `web/src/lib/security-headers.ts`, `web/src/lib/security-headers.test.ts`, `web/tests/e2e/headers.spec.ts`
- Modify: `web/next.config.ts`

**Interfaces:**
- Produces: `securityHeaders(supabaseUrl: string, dev: boolean): { key: string; value: string }[]`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/security-headers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { securityHeaders } from './security-headers';

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value ?? '';

describe('securityHeaders', () => {
  it('allows only this site and the Supabase project, and no framing', () => {
    const csp = get(securityHeaders('https://abcd.supabase.co', false), 'Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });
  it("adds 'unsafe-eval' only in development (Next dev runtime)", () => {
    expect(get(securityHeaders('https://abcd.supabase.co', true), 'Content-Security-Policy')).toContain("'unsafe-eval'");
  });
  it('sets HSTS, nosniff, referrer and permissions policies', () => {
    const h = securityHeaders('https://abcd.supabase.co', false);
    expect(get(h, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(get(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(h, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(get(h, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
```

`web/tests/e2e/headers.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('pages are served with the security headers', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
```

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npm test -- security-headers` → expect FAIL (module not found).
  - Run: `npx playwright test headers` → expect FAIL (no CSP header).

- [ ] **Step 3: Implement** (`web/src/lib/security-headers.ts`)

```ts
export type Header = { key: string; value: string };

/**
 * Response headers for every route. The CSP allows only this site and the Supabase project;
 * inline scripts/styles are needed by Next.js, eval only by the dev runtime.
 */
export function securityHeaders(supabaseUrl: string, dev: boolean): Header[] {
  const supabase = new URL(supabaseUrl);
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${supabase.origin} wss://${supabase.host}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}
```

`web/next.config.ts`:

```ts
import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // The dev badge sits over the nav's bottom-left Sign out button.
  devIndicators: false,
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set (see .env.example)');
    return [{ source: '/:path*', headers: securityHeaders(supabaseUrl, process.env.NODE_ENV !== 'production') }];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Run them and watch them pass, then the full suite.**
  - Run: `npm test -- security-headers` → expect 3 passed.
  - Stop any dev server, delete `web/.next`, then run `npx playwright test --global-timeout 2400000`.
  - Expect: everything green, including `headers.spec.ts`, `mfa.spec.ts` (QR code) and `mobile.spec.ts`.
  - If a flow is blocked, read the browser console for `Refused to …` and widen only that directive. Ledger the change as a ruling.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/security-headers.ts web/src/lib/security-headers.test.ts web/tests/e2e/headers.spec.ts web/next.config.ts
git commit -m "feat: security headers (CSP limited to the site and Supabase, HSTS, nosniff, no framing)"
```

### Task 6: Catalog export for checking the sample catalog

**Files:**
- Create: `web/scripts/catalog-csv.ts`, `web/scripts/catalog-csv.test.ts`, `web/scripts/catalog-export.ts`

**Interfaces:**
- Consumes: `toCsv(headers: string[], rows: Cell[][]): string` from `web/src/lib/csv.ts`; `pgConfig()`; `targetLabel()` from Task 2.
- Produces:
  - `CATALOG_HEADERS: string[]`;
  - `catalogRow(p: CatalogProduct): (string | number | null)[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CATALOG_HEADERS, catalogRow } from './catalog-csv';

describe('catalog CSV', () => {
  it('has one column per checked field, in order', () => {
    expect(CATALOG_HEADERS).toEqual(['Type', 'Brand', 'System', 'Platform', 'Diameter (mm)', 'Length (mm)', 'Ref code', 'Description', 'Sample', 'Active']);
  });
  it('maps a product to readable values', () => {
    expect(catalogRow({
      type: 'implant', brand: 'MIS', system: 'C1', platform: 'NP', diameter_mm: 3.75, length_mm: 13,
      ref_code: 'C1-37513', description: '', is_sample: true, active: true,
    })).toEqual(['Implant', 'MIS', 'C1', 'NP', 3.75, 13, 'C1-37513', '', 'yes — verify', 'yes']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `npm test -- catalog-csv`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`web/scripts/catalog-csv.ts`)

```ts
import { PRODUCT_TYPE_LABELS, type Product } from '../src/lib/inventory/types';

export type CatalogProduct = Pick<Product,
  'type' | 'brand' | 'system' | 'platform' | 'diameter_mm' | 'length_mm' | 'ref_code' | 'description' | 'is_sample' | 'active'>;

export const CATALOG_HEADERS = ['Type', 'Brand', 'System', 'Platform', 'Diameter (mm)', 'Length (mm)', 'Ref code', 'Description', 'Sample', 'Active'];

export function catalogRow(p: CatalogProduct): (string | number | null)[] {
  return [
    PRODUCT_TYPE_LABELS[p.type], p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.ref_code, p.description,
    p.is_sample ? 'yes — verify' : 'no', p.active ? 'yes' : 'no',
  ];
}
```

`PRODUCT_TYPE_LABELS` is exported from `web/src/lib/inventory/types.ts` (checked while writing this plan).

`web/scripts/catalog-export.ts`:

```ts
import './load-env';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { toCsv } from '../src/lib/csv';
import { CATALOG_HEADERS, catalogRow, type CatalogProduct } from './catalog-csv';
import { targetLabel } from './create-user-args';

async function main() {
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    const { rows } = await pg.query<CatalogProduct>(
      `select type, brand, system, platform, diameter_mm::float8 as diameter_mm, length_mm::float8 as length_mm,
              ref_code, description, is_sample, active
       from public.products order by type, brand, system, diameter_mm, length_mm`,
    );
    const file = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    writeFileSync(file, toCsv(CATALOG_HEADERS, rows.map(catalogRow)));
    console.log(`Wrote ${rows.length} products to ${file}`);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
```

- [ ] **Step 4: Run and check.**
  - Run: `npm test -- catalog-csv` → expect 2 passed.
  - Run: `npm run catalog-export` against dev → expect `Target project: <dev host>`, then `Wrote N products to catalog-<date>.csv`.
  - Delete the file afterwards. Root `.gitignore` has no `*.csv` rule, so add `web/catalog-*.csv` to `web/.gitignore`.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/catalog-csv.ts web/scripts/catalog-csv.test.ts web/scripts/catalog-export.ts web/.gitignore
git commit -m "feat(scripts): catalog-export writes the catalog to CSV for checking"
```

### Task 7: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`, `web/vercel.json`
- Modify: `CLAUDE.md` (migration rule), `web/package.json` (dev dependency `yaml`, for checking workflow files)

- [ ] **Step 0: Vercel project config** (`web/vercel.json`). Functions run in Frankfurt, next to the database. Pushes to `master` don't deploy by themselves, because only the release workflow's deploy hook deploys production.

```json
{
  "regions": ["fra1"],
  "git": { "deploymentEnabled": { "master": false } }
}
```

- [ ] **Step 1: Write the workflow** (`.github/workflows/release.yml`)

```yaml
name: Release
on:
  push:
    branches: [master]
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    env:
      # Unit tests and the build-time config need a Supabase URL; these are placeholders, not secrets.
      NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
      NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test

  migrate-and-deploy:
    needs: check
    runs-on: ubuntu-latest
    environment: production
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - name: Migrate production (verified TLS)
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
          PROD_DATABASE_CA_CERT: ${{ secrets.PROD_DATABASE_CA_CERT }}
        run: |
          set -euo pipefail
          test -n "$DATABASE_URL" || { echo "PROD_DATABASE_URL secret is missing"; exit 1; }
          test -n "$PROD_DATABASE_CA_CERT" || { echo "PROD_DATABASE_CA_CERT secret is missing"; exit 1; }
          printf '%s\n' "$PROD_DATABASE_CA_CERT" > "$RUNNER_TEMP/prod-ca.crt"
          DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt" npm run db:migrate
      - name: Deploy on Vercel (only after a successful migration)
        env:
          HOOK: ${{ secrets.VERCEL_DEPLOY_HOOK_URL }}
        run: |
          set -euo pipefail
          test -n "$HOOK" || { echo "VERCEL_DEPLOY_HOOK_URL secret is missing"; exit 1; }
          curl --fail --silent --show-error -X POST "$HOOK" > /dev/null
          echo "Vercel deployment triggered."
```

- [ ] **Step 2: Check the YAML and the ordering.**
  - Run `npm i -D yaml` in `web/`. It isn't installed today, and it's used only for these checks.
  - Then run `node -e "const y=require('yaml');const fs=require('fs');const d=y.parse(fs.readFileSync('../.github/workflows/release.yml','utf8'));console.log(Object.keys(d.jobs), d.jobs['migrate-and-deploy'].needs)"`.
  - Expected: `[ 'check', 'migrate-and-deploy' ] check`.
  - Confirm by reading that the deploy step comes after the migrate step in the same job, so a failed migration fails the job before deploying.

- [ ] **Step 3: Add the migration rule to `CLAUDE.md`**, under the Migrations paragraph:

```markdown
Releases (`.github/workflows/release.yml`) migrate production *before* the new code deploys, so the previous app version runs against the new schema for a few minutes: migrations must be backward-compatible (add, don't rename or drop in the same release).
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml web/vercel.json web/package.json web/package-lock.json CLAUDE.md
git commit -m "ci: release workflow — checks, migrate production, then deploy via Vercel hook"
```

### Task 8: Nightly encrypted backup and keep-alive

**Files:**
- Create: `.github/workflows/backup.yml`

- [ ] **Step 1: Write the workflow** (`.github/workflows/backup.yml`)

```yaml
name: Backup
on:
  schedule:
    - cron: '0 0 * * *' # 00:00 UTC = 02:00/03:00 Cairo
  workflow_dispatch:
    inputs:
      mode:
        description: 'backup or verify (decrypt the latest backup and list its contents)'
        required: true
        default: backup
        type: choice
        options: [backup, verify]

permissions:
  contents: read
  actions: read

jobs:
  backup:
    if: github.event_name == 'schedule' || inputs.mode == 'backup'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Install PostgreSQL 17 client
        run: |
          set -euo pipefail
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client-17
      - name: Dump and encrypt (the plain dump never touches disk)
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
          CA: ${{ secrets.PROD_DATABASE_CA_CERT }}
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          test -n "$PASSPHRASE" || { echo "BACKUP_PASSPHRASE secret is missing: refusing to back up unencrypted"; exit 1; }
          test -n "$DATABASE_URL" && test -n "$CA" || { echo "Database secrets are missing"; exit 1; }
          printf '%s\n' "$CA" > "$RUNNER_TEMP/ca.crt"
          export PGSSLMODE=verify-full PGSSLROOTCERT="$RUNNER_TEMP/ca.crt"
          mkdir -p out
          /usr/lib/postgresql/17/bin/pg_dump --format=custom --no-owner --schema=public --schema=app_private "$DATABASE_URL" \
            | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 3<<<"$PASSPHRASE" \
                  --output "out/prod-$(date -u +%F).dump.gpg"
          ls -l out
      - uses: actions/upload-artifact@v4
        with:
          name: prod-backup-${{ github.run_id }}
          path: out/*.dump.gpg
          retention-days: 14
          if-no-files-found: error
      - name: Keep the free project awake (REST request)
        env:
          URL: ${{ secrets.PROD_SUPABASE_URL }}
          ANON: ${{ secrets.PROD_SUPABASE_ANON_KEY }}
        run: curl --fail --silent --show-error "$URL/rest/v1/" -H "apikey: $ANON" -o /dev/null

  verify:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'verify'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Install PostgreSQL 17 client
        run: |
          set -euo pipefail
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client-17
      - name: Download the latest backup
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          name=$(gh api "repos/${{ github.repository }}/actions/artifacts?per_page=100" \
            --jq '[.artifacts[] | select(.name | startswith("prod-backup-")) | select(.expired == false)] | sort_by(.created_at) | last | .name')
          test -n "$name" && test "$name" != "null" || { echo "No backup artifact found"; exit 1; }
          gh run download --repo "${{ github.repository }}" --name "$name" --dir in
      - name: Decrypt and list (fails if unreadable)
        env:
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          f=$(ls in/*.dump.gpg | head -1)
          gpg --batch --decrypt --passphrase-fd 3 3<<<"$PASSPHRASE" "$f" > "$RUNNER_TEMP/check.dump"
          /usr/lib/postgresql/17/bin/pg_restore --list "$RUNNER_TEMP/check.dump" | grep -c "TABLE DATA" | xargs echo "Tables with data:"
          rm -f "$RUNNER_TEMP/check.dump"
```

Additional secrets this job uses: `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY`. Both are listed in Task 9.

- [ ] **Step 2: Check the YAML.** From `web/`, run: `node -e "const y=require('yaml');const fs=require('fs');const d=y.parse(fs.readFileSync('../.github/workflows/backup.yml','utf8'));console.log(Object.keys(d.jobs))"`. Expected: `[ 'backup', 'verify' ]`.

  Then confirm by reading:
  - `pg_dump` output only ever flows into `gpg`;
  - the passphrase check runs before the dump;
  - `if-no-files-found: error` is set.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backup.yml
git commit -m "ci: nightly encrypted production backup (14 days), keep-alive, and verify mode"
```

### Task 9: Operations and go-live docs, and the provisioning walk-through

**Files:**
- Create: `docs/operations.md`, `docs/go-live.md`

- [ ] **Step 1: Write `docs/operations.md`.** The provisioning steps the admin performs (Section A) are copied below verbatim, followed by Sections B–F. Every value marked ⟨secret⟩ is typed by the admin into the named place, never into chat.

```markdown
# Operations

## A. First-time provisioning (admin, once)

1. **Supabase prod project**:
   - New project, region **Central EU (Frankfurt)**, Free plan. Save the database password in your password manager ⟨secret⟩.
   - Authentication:
     - Sign In / Providers: Email on, **Allow new users to sign up: off**, **Confirm email: on**.
     - Multi-Factor: TOTP enabled.
     - Passwords: minimum length 10.
     - URL Configuration: Site URL = your Vercel production URL; Redirect URLs = `<vercel-url>/**`.
   - Database settings → SSL: download the CA certificate and save it as `web/prod-ca.crt` (`*.crt` is git-ignored).
   - Connect → Session pooler: copy the URI ⟨secret⟩.
2. **Local prod env file**: create `web/.env.production.local` with:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (session pooler), `DATABASE_CA_CERT=<path to the CA file>`, `ALLOW_TEST_FIXTURES=0`.
3. **Vercel**:
   - Import the GitHub repo. Root directory `web`. Framework Next.js. The committed `web/vercel.json` already pins functions to **fra1** and turns off automatic deploys of `master`, so the release workflow's hook is the only production trigger.
   - Environment variables (Production only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ⟨secret⟩, `SITE_URL=<vercel-url>`, `EMAIL_ENABLED=false`, `NEXT_PUBLIC_PILOT=1`.
   - Settings → Git → Deploy Hooks: create hook "release" on branch `master`; copy its URL ⟨secret⟩.
4. **GitHub** → repo → Settings → Environments → `production` → secrets:
   `PROD_DATABASE_URL`, `PROD_DATABASE_CA_CERT` (paste the PEM text), `VERCEL_DEPLOY_HOOK_URL`, `BACKUP_PASSPHRASE` (a long random passphrase, also stored in your password manager: without it backups cannot be read), `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`.
5. **First release**: Actions → Release → Run workflow. It migrates the empty prod database (0001–0022) and deploys.
6. **First admin**: `ENV_FILE=.env.production.local npm run create-user -- you@example.com "Your Name" --role admin` (from `web/`). Check the first line says the prod host.
7. **Smoke check** (Section F) and **first backup** (Actions → Backup → Run workflow, mode backup, then mode verify).

## B. Accounts (no email during the pilot)
- New organizer: `ENV_FILE=.env.production.local npm run create-user -- dr@example.com "Dr Name"` → hand the temporary password over in person; they change it under Account security.
- Reset a password: run the same command again for that email.
- Deactivate: Admin → Users in the app.

## C. Releases
- Merging to `master` runs **Release**: checks → migrate prod → deploy. A red run deploys nothing; fix and merge again, or re-run.
- Migrations must work with the previous app version (add, don't rename/drop in one release).

## D. Backups and restore
- **Backup** runs nightly. Artifacts `prod-backup-*` are kept 14 days.
- **Monthly**: Actions → Backup → Run workflow → mode `verify`. It must be green.
- **Restore**, if prod is lost or damaged:
  1. Download the artifact.
  2. Decrypt it: `gpg --decrypt prod-<date>.dump.gpg > prod.dump` (asks for the passphrase).
  3. Create a new Supabase project (Frankfurt) and run `npm run db:migrate` against it, with `ENV_FILE` pointing at its env file.
  4. Load the data: `pg_restore --data-only --disable-triggers --no-owner -d "<new session pooler URI>" prod.dump`.
  5. Point Vercel's environment variables and the GitHub secrets at the new project, then re-run Release.
  6. Recreate users with `create-user`. Auth accounts live in Supabase's `auth` schema, which the backup does not include.
- **Free plan pause**: if the project shows "Paused", open the Supabase dashboard → Restore project. The nightly backup's request normally prevents this.

## E. Keys and secrets
- Rotate the service role key or the database password in Supabase, then update `.env.production.local`, Vercel and the GitHub secrets, then re-run Release.
- Never paste keys into chats, tickets or code.

## F. Smoke check after a release
1. Open the production URL. The pilot banner is visible.
2. Sign in as admin. The dashboard loads.
3. Create a test patient (name starting "Pilot test"); add a checklist and tick an item.
4. Browser dev tools → Network → the page response carries `content-security-policy` and `strict-transport-security`.
5. Catalog: `ENV_FILE=.env.production.local npm run catalog-export` → check the CSV against supplier lists; fix products in the app (untick **Sample** when verified).
```

Also append `*.crt` to `web/.gitignore`, since certificates are not ignored today. Check: `git check-ignore -v web/prod-ca.crt` prints the matching rule.

- [ ] **Step 2: Write `docs/go-live.md`**

```markdown
# Go-live gate

Real courses and real patients start only when every line is ticked, dated and initialled.

- [ ] Vercel plan upgraded to **Pro** (Hobby is non-commercial only). Date: ____
- [ ] Supabase plan upgraded to **Pro**; daily backups on; decision on point-in-time recovery recorded: ____
- [ ] Domain chosen/bought: ____
- [ ] Resend: domain verified (SPF, DKIM); Supabase → Auth → SMTP set to Resend; invite and password-recovery email templates written and tested
- [ ] Vercel `EMAIL_ENABLED=true`; one invite tested end to end (email received, password set, dashboard reached)
- [ ] Written PDPL (Law 151/2020) advice on hosting patient data in Frankfurt, received and filed: ____
- [ ] Patient consent wording approved and in use
- [ ] Pilot data deleted, or kept with documented consent; pilot temporary passwords rotated
- [ ] Sample catalog fully verified: no product still flagged "Sample — verify" (`npm run catalog-export` shows none)
- [ ] `NEXT_PUBLIC_PILOT` removed in Vercel; Release re-run
- [ ] (Optional) custom domain on Vercel; Supabase Site URL and Redirect URLs updated
```

- [ ] **Step 3: Commit**

```bash
git add docs/operations.md docs/go-live.md web/.gitignore
git commit -m "docs: operations runbook (provisioning, accounts, releases, backups, restore) and go-live gate"
```

### Task 10: Full verification, review, merge, and the guided first deployment

- [ ] **Step 1: Full local suite.** Run in `web/`:
  - `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`;
  - `npx playwright test --global-timeout 2400000` (run in the background).
  - Expected: all green. Record the counts in the ledger.
- [ ] **Step 2: Final review.** Dispatch the whole-branch reviewer (most capable model) with the spec, this plan and its Review Focus. Fix Critical and Important findings test-first.
- [ ] **Step 3: PR.** Push `prod-deploy` and open PR #8 with the admin's approval. After the merge, **Release runs automatically and fails** at "Migrate production", because the secrets don't exist yet. That is expected and safe, since nothing deploys. Tell the admin so before merging.
- [ ] **Step 4: Guided provisioning.** Walk the admin through `docs/operations.md` §A steps 1–4, one at a time. Confirm each step by its visible result (the project exists, the secret names are listed), never by its value.
- [ ] **Step 5: First release.** The admin re-runs Release. Expected: `check` green, then "Applied: 0001_foundation.sql, …, 0022_checklist_polish.sql", then "Vercel deployment triggered", then a Vercel deployment "Ready".
- [ ] **Step 6: First admin, smoke check, first backup.** Follow §A steps 6–7 and §F. Expected:
  - the pilot banner is visible;
  - the headers are present;
  - Backup is green, and Verify reports a positive table count.
