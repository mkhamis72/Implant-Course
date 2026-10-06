# Multi-tenant part 1: Tenant-aware App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deployment of the app serves several companies, each from its own Supabase project, chosen by the request's host. Production stays unchanged until a control project is switched on.

**Architecture:**
- A new `src/lib/tenant/` module resolves the host to a tenant through a registry. The registry is either *static* (today's env vars as one `default` tenant, or a git-ignored `tenants.local.json` for local multi-tenant testing) or the *control* Supabase project (`tenants` table plus Vault secrets, cached 60 s, stale for at most 10 min).
- The middleware (Node runtime) routes each request, strips any client `x-tenant` header, sets the trusted one, and sets that tenant's CSP. Every Supabase client reads the current tenant instead of build-time env.

**Tech Stack:** Next.js 15.5 App Router (Node.js middleware), `@supabase/ssr` / `@supabase/supabase-js`, Postgres plpgsql plus Supabase Vault, Vitest (jsdom unit, node DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-multi-tenant-1-tenant-aware-app-design.md`

## Global Constraints

- Run every command from `web/` (Git Bash on Windows). `gh` is `"/c/Program Files/GitHub CLI/gh.exe"`. There's no Python; script with Node.
- Match the surrounding code: no Prettier, single quotes, 2-space indent, the same comment density.
- Never print `.env*` contents. Never commit `tenants.local.json` or `.env*`.
- **Single-tenant mode must behave exactly as today:** when neither `CONTROL_SUPABASE_URL` nor `TENANTS_FILE` is set, the tenant `default` is built from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` and matches any host.
- `TENANTS_FILE` is refused when `NODE_ENV=production`.
- Registry cache: fresh for **60 s**. On control failure, serve the last registry for at most **10 min**, then 503 "Service unavailable". Never guess a tenant.
- Vault secrets are named `tenant/<slug>/service_role_key` and `tenant/<slug>/database_url`, readable only through `public.tenant_secret(p_slug, p_name)`, executable by `service_role` only.
- Unknown host: **404**. Suspended tenant: **503** "This site is temporarily unavailable". No Supabase call in either case.
- Missing service key or Vault failure in an admin action: the user sees exactly **"This action isn't available right now. Please try again later."**
- App migrations (`supabase/migrations/`) are untouched in part 1. Control migrations live in `supabase/control/migrations/`, applied with `npm run db:migrate -- --control`.
- Auto mode blocks Claude from changing production settings or starting production deploys. Those rollout steps are the **owner's** (Task 12).

## Review Focus

1. **Host header variants:** `Academy.Example.com:443`, a trailing dot (`academy.example.com.`) and upper case must match `academy.example.com`. Test in Task 1.
2. **Missing or garbage host** (empty, an IP like `203.0.113.5`, `evil.com/x`) in control or local mode → 404, never the first or `default` tenant. Test in Task 4.
3. **Control project down past the cache:** within 10 min the last registry is served; after that, "unavailable". Never another tenant. Test in Task 2.
4. **A tenant suspended while its users have live sessions:** the very next request, including a server action POST and `/api/activity`, gets 503. Tests in Task 4 (route) and Task 11 (E2E).
5. **The same host listed by two tenants** (a misconfigured local file or a control race): the local loader throws, and the control trigger refuses the write. Tests in Task 3 and Task 9.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/tenant/types.ts` | `Tenant` type, `TENANT_HEADER`, error classes, user-facing messages |
| `src/lib/tenant/host.ts` | `normaliseHost(raw)`: header → canonical host or null |
| `src/lib/tenant/control.ts` | Fetch tenants and secrets from the control project; 60 s cache with a 10 min stale window |
| `src/lib/tenant/static.ts` | Single-tenant `default` and the local `tenants.local.json` registry |
| `src/lib/tenant/registry.ts` | Picks the source; `findTenantByHost`, `findTenantBySlug`, `tenantServiceKey` |
| `src/lib/tenant/route.ts` | Pure middleware decision: `routeHost(host)` → tenant / not-found / suspended / unavailable |
| `src/lib/tenant/current.ts` | `currentTenant()`, `requestOrigin()` for server code (reads trusted headers) |
| `src/lib/security-headers.ts` | Split into `contentSecurityPolicy()` + `staticSecurityHeaders()` (+ existing `securityHeaders()`) |
| `src/lib/supabase/{middleware,server,admin,client}.ts`, `src/middleware.ts` | Use the tenant |
| `src/components/idle-timer.tsx`, `src/app/(app)/layout.tsx` | Browser client gets tenant URL/key via props |
| `src/lib/admin/{create-login,auth-accounts}.ts`, `src/app/(app)/admin/users/actions.ts` | `await createAdminClient()`; unavailable message |
| `supabase/control/migrations/0001_control_registry.sql` | Control schema |
| `scripts/migrate.ts`, `scripts/migrate-cli.ts`, `scripts/migrate-target.ts` | `--control` target |
| `scripts/tenants.ts`, `scripts/tenant-register.ts`, `scripts/tenant-check.ts` | Register academy, self-check |
| `tests/db/control.test.ts` | Control schema (rolled back on dev) |
| `tests/e2e/isolation.spec.ts` | Two-company isolation |

---

### Task 1: Tenant types and host normalisation

**Files:**
- Create: `src/lib/tenant/types.ts`, `src/lib/tenant/host.ts`
- Test: `src/lib/tenant/host.test.ts`

**Interfaces:**
- Produces:
  - `type Tenant = { slug: string; hosts: string[]; supabaseUrl: string; anonKey: string; status: 'active' | 'suspended' }`
  - `TENANT_HEADER = 'x-tenant'`
  - `ADMIN_UNAVAILABLE` message
  - `class RegistryUnavailableError extends Error`
  - `normaliseHost(raw: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test** `src/lib/tenant/host.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normaliseHost } from './host';

describe('normaliseHost', () => {
  it.each([
    ['academy.example.com', 'academy.example.com'],
    ['Academy.Example.COM', 'academy.example.com'],
    ['academy.example.com:443', 'academy.example.com'],
    ['academy.example.com.', 'academy.example.com'],
    ['localhost:3000', 'localhost'],
    ['tenant2.localhost:3000', 'tenant2.localhost'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseHost(raw)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'evil.com/x', 'a b.com', '203.0.113.5', '[::1]:3000', '-bad.com', 'x'.repeat(254)])(
    'rejects %s',
    (raw) => {
      expect(normaliseHost(raw as string)).toBeNull();
    },
  );
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/lib/tenant/host`
Expected: FAIL, "Failed to resolve import ./host".

- [ ] **Step 3: Implement** `src/lib/tenant/types.ts`

```ts
/** One company: its own Supabase project, reached on its own host names. */
export type Tenant = {
  slug: string;
  hosts: string[];
  supabaseUrl: string;
  anonKey: string;
  status: 'active' | 'suspended';
};

/** Set by the middleware on the forwarded request; any value sent by the browser is removed first. */
export const TENANT_HEADER = 'x-tenant';

export const ADMIN_UNAVAILABLE = "This action isn't available right now. Please try again later.";

/** The control project could not be reached and the cached registry is too old to trust. */
export class RegistryUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Tenant registry unavailable', { cause });
    this.name = 'RegistryUnavailableError';
  }
}
```

and `src/lib/tenant/host.ts`:

```ts
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The Host header as a canonical host name: lower case, no port, no trailing dot.
 * IP addresses and anything that isn't a host name give null (they never match a company).
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (!host || host.startsWith('[')) return null;
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  return host;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- src/lib/tenant/host`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/types.ts src/lib/tenant/host.ts src/lib/tenant/host.test.ts
git commit -m "feat(tenant): Tenant type and host normalisation"
```

---

### Task 2: Control registry client with a cache and stale window

**Files:**
- Create: `src/lib/tenant/control.ts`
- Test: `src/lib/tenant/control.test.ts`

**Interfaces:**
- Consumes: `Tenant`, `RegistryUnavailableError` (Task 1).
- Produces:
  - `controlTenants(now?: number): Promise<Tenant[]>`
  - `controlSecret(slug: string, name: 'service_role_key' | 'database_url', now?: number): Promise<string>`
  - `resetControlCache(): void` (tests only)
  - `FRESH_MS = 60_000`, `STALE_MS = 600_000`
  - The control client is created from `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY`.

- [ ] **Step 1: Write the failing test** `src/lib/tenant/control.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { select, rpc } = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select }), rpc }),
}));
import { controlTenants, controlSecret, resetControlCache, FRESH_MS, STALE_MS } from './control';
import { RegistryUnavailableError } from './types';

const row = { slug: 'academy', hosts: ['academy.example.com'], supabase_url: 'https://a.supabase.co', anon_key: 'anon', status: 'active' };
const tenant = { slug: 'academy', hosts: ['academy.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  resetControlCache();
  process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
  process.env.CONTROL_SERVICE_ROLE_KEY = 'control-key';
});

describe('controlTenants', () => {
  it('maps rows and serves them from cache while fresh', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    expect(await controlTenants(0)).toEqual([tenant]);
    expect(await controlTenants(FRESH_MS - 1)).toEqual([tenant]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('refetches once fresh time is over', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    await controlTenants(0);
    await controlTenants(FRESH_MS + 1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('serves the last registry for up to 10 minutes when the control project fails', async () => {
    select.mockResolvedValueOnce({ data: [row], error: null });
    await controlTenants(0);
    select.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await controlTenants(STALE_MS - 1)).toEqual([tenant]);
    await expect(controlTenants(STALE_MS + 1)).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('is unavailable when the very first fetch fails', async () => {
    select.mockRejectedValue(new Error('network'));
    await expect(controlTenants(0)).rejects.toBeInstanceOf(RegistryUnavailableError);
  });
});

describe('controlSecret', () => {
  it('reads through tenant_secret and caches', async () => {
    rpc.mockResolvedValue({ data: 'service-key', error: null });
    expect(await controlSecret('academy', 'service_role_key', 0)).toBe('service-key');
    expect(await controlSecret('academy', 'service_role_key', 1000)).toBe('service-key');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('tenant_secret', { p_slug: 'academy', p_name: 'service_role_key' });
  });

  it('throws when the secret is missing', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(controlSecret('academy', 'service_role_key', 0)).rejects.toThrow(/missing/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/lib/tenant/control`
Expected: FAIL, "Failed to resolve import ./control".

- [ ] **Step 3: Implement** `src/lib/tenant/control.ts`

```ts
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RegistryUnavailableError, type Tenant } from './types';

export const FRESH_MS = 60_000;
/** After this the cached registry is too old to route by: requests get "service unavailable". */
export const STALE_MS = 10 * 60_000;
const SECRET_MS = 5 * 60_000;

type Row = { slug: string; hosts: string[]; supabase_url: string; anon_key: string; status: 'active' | 'suspended' };

let cache: { tenants: Tenant[]; fetchedAt: number } | null = null;
const secrets = new Map<string, { value: string; fetchedAt: number }>();

export function resetControlCache(): void {
  cache = null;
  secrets.clear();
}

function control(): SupabaseClient {
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY are not set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fetchTenants(): Promise<Tenant[]> {
  const { data, error } = await control().from('tenants').select('slug, hosts, supabase_url, anon_key, status');
  if (error || !data) throw new Error(error?.message ?? 'no data');
  return (data as Row[]).map((r) => ({
    slug: r.slug, hosts: r.hosts, supabaseUrl: r.supabase_url, anonKey: r.anon_key, status: r.status,
  }));
}

/** All companies from the control project: fresh for 60 s, then refetched; a failed refetch keeps the old list for 10 min. */
export async function controlTenants(now = Date.now()): Promise<Tenant[]> {
  if (cache && now - cache.fetchedAt < FRESH_MS) return cache.tenants;
  try {
    const tenants = await fetchTenants();
    cache = { tenants, fetchedAt: now };
    return tenants;
  } catch (error) {
    if (cache && now - cache.fetchedAt < STALE_MS) {
      console.error('Tenant registry refresh failed; serving the cached registry', error);
      return cache.tenants;
    }
    throw new RegistryUnavailableError(error);
  }
}

/** A company's secret from the control project's Vault (cached 5 min). */
export async function controlSecret(slug: string, name: 'service_role_key' | 'database_url', now = Date.now()): Promise<string> {
  const key = `${slug}/${name}`;
  const hit = secrets.get(key);
  if (hit && now - hit.fetchedAt < SECRET_MS) return hit.value;
  const { data, error } = await control().rpc('tenant_secret', { p_slug: slug, p_name: name });
  if (error || typeof data !== 'string' || !data) throw new Error(`Secret ${key} is missing or unreadable`);
  secrets.set(key, { value: data, fetchedAt: now });
  return data;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- src/lib/tenant/control`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/control.ts src/lib/tenant/control.test.ts
git commit -m "feat(tenant): control-project registry with 60 s cache and 10 min stale window"
```

---

### Task 3: Static registries (single tenant and local file)

**Files:**
- Create: `src/lib/tenant/static.ts`
- Modify: `web/.gitignore` (add `tenants.local.json`)
- Test: `src/lib/tenant/static.test.ts`

**Interfaces:**
- Consumes: `Tenant`, `normaliseHost` (Task 1).
- Produces:
  - `type StaticTenant = Tenant & { serviceRoleKey: string }`
  - `staticTenants(env?: Record<string, string | undefined>, read?: (path: string) => string): StaticTenant[]`
  - `ANY_HOST = '*'`
  - The single-tenant `default` has `hosts: ['*']`.

- [ ] **Step 1: Write the failing test** `src/lib/tenant/static.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { staticTenants, ANY_HOST } from './static';

const single = { NEXT_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const file = (tenants: unknown) => () => JSON.stringify(tenants);
const local = (slug: string, hosts: string[], status = 'active') => ({
  slug, hosts, supabaseUrl: `https://${slug}.supabase.co`, anonKey: 'anon', serviceRoleKey: 'svc', status,
});

describe('staticTenants', () => {
  it('without TENANTS_FILE: one default tenant from today’s env vars, on any host', () => {
    expect(staticTenants(single)).toEqual([
      { slug: 'default', hosts: [ANY_HOST], supabaseUrl: 'https://dev.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc', status: 'active' },
    ]);
  });

  it('needs the env vars in single-tenant mode', () => {
    expect(() => staticTenants({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('reads the local file, normalising hosts', () => {
    const env = { TENANTS_FILE: 'tenants.local.json', NODE_ENV: 'development' };
    const tenants = staticTenants(env, file([local('dev', ['LOCALHOST:3000']), local('dev2', ['tenant2.localhost'], 'suspended')]));
    expect(tenants.map((t) => [t.slug, t.hosts, t.status])).toEqual([
      ['dev', ['localhost'], 'active'],
      ['dev2', ['tenant2.localhost'], 'suspended'],
    ]);
  });

  it('refuses the local file in production', () => {
    expect(() => staticTenants({ TENANTS_FILE: 'x.json', NODE_ENV: 'production' }, file([]))).toThrow(/production/);
  });

  it('refuses a host listed by two tenants', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([local('a', ['localhost']), local('b', ['localhost'])]))).toThrow(/localhost.*two tenants/);
  });

  it('refuses malformed entries', () => {
    const env = { TENANTS_FILE: 'x.json', NODE_ENV: 'development' };
    expect(() => staticTenants(env, file([{ slug: 'a', hosts: [] }]))).toThrow(/Invalid tenant/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/lib/tenant/static`
Expected: FAIL, "Failed to resolve import ./static".

- [ ] **Step 3: Implement** `src/lib/tenant/static.ts`

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { normaliseHost } from './host';
import type { Tenant } from './types';

export type StaticTenant = Tenant & { serviceRoleKey: string };
type Env = Record<string, string | undefined>;

/** The single-tenant default matches every host. */
export const ANY_HOST = '*';

const entry = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  hosts: z.array(z.string()).min(1),
  supabaseUrl: z.string().url(),
  anonKey: z.string().min(1),
  serviceRoleKey: z.string().min(1),
  status: z.enum(['active', 'suspended']).default('active'),
});

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

/**
 * The registry without a control project. No TENANTS_FILE: today's single project, as tenant "default".
 * TENANTS_FILE (local development and isolation tests only): a list of companies, never in production.
 */
export function staticTenants(env: Env = process.env, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): StaticTenant[] {
  const path = env.TENANTS_FILE;
  if (!path) {
    return [{
      slug: 'default',
      hosts: [ANY_HOST],
      supabaseUrl: required(env, 'NEXT_PUBLIC_SUPABASE_URL'),
      anonKey: required(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
      status: 'active',
    }];
  }
  if (env.NODE_ENV === 'production') throw new Error('TENANTS_FILE is for local development only and is refused in production.');
  const parsed = z.array(entry).safeParse(JSON.parse(read(path)));
  if (!parsed.success) throw new Error(`Invalid tenant in ${path}: ${parsed.error.issues[0].message}`);
  const seen = new Map<string, string>();
  return parsed.data.map((t) => {
    const hosts = t.hosts.map((h) => {
      const host = normaliseHost(h);
      if (!host) throw new Error(`Invalid tenant in ${path}: bad host ${h}`);
      const owner = seen.get(host);
      if (owner) throw new Error(`Host ${host} is listed by two tenants (${owner}, ${t.slug})`);
      seen.set(host, t.slug);
      return host;
    });
    return { ...t, hosts };
  });
}
```

Append to `web/.gitignore`:

```
# local multi-tenant registry (holds dev service keys)
tenants.local.json
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- src/lib/tenant/static`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/static.ts src/lib/tenant/static.test.ts .gitignore
git commit -m "feat(tenant): single-tenant default and local tenants file registry"
```

---

### Task 4: Registry facade and the middleware routing decision

**Files:**
- Create: `src/lib/tenant/registry.ts`, `src/lib/tenant/route.ts`
- Test: `src/lib/tenant/registry.test.ts`, `src/lib/tenant/route.test.ts`

**Interfaces:**
- Consumes: `controlTenants`, `controlSecret` (Task 2); `staticTenants`, `ANY_HOST` (Task 3); `normaliseHost` (Task 1).
- Produces:
  - `findTenantByHost(host: string): Promise<Tenant | null>` (host already normalised)
  - `findTenantBySlug(slug: string): Promise<Tenant | null>`
  - `tenantServiceKey(slug: string): Promise<string>`
  - `type Route = { kind: 'tenant'; tenant: Tenant } | { kind: 'not-found' } | { kind: 'suspended' } | { kind: 'unavailable' }`
  - `routeHost(rawHost: string | null): Promise<Route>`

- [ ] **Step 1: Write the failing tests**

`src/lib/tenant/registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { controlTenants, controlSecret } = vi.hoisted(() => ({ controlTenants: vi.fn(), controlSecret: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./control', () => ({ controlTenants, controlSecret }));
import { findTenantByHost, findTenantBySlug, tenantServiceKey } from './registry';

const a = { slug: 'a', hosts: ['a.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active' as const };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ['CONTROL_SUPABASE_URL', 'TENANTS_FILE']) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dev.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
});

describe('single-tenant mode', () => {
  it('serves the default tenant on any host, with the env service key', async () => {
    expect((await findTenantByHost('anything.example'))?.slug).toBe('default');
    expect((await findTenantBySlug('default'))?.supabaseUrl).toBe('https://dev.supabase.co');
    expect(await tenantServiceKey('default')).toBe('svc');
    expect(controlTenants).not.toHaveBeenCalled();
  });
});

describe('control mode', () => {
  beforeEach(() => {
    process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
    controlTenants.mockResolvedValue([a]);
  });
  it('matches only listed hosts', async () => {
    expect(await findTenantByHost('a.example.com')).toEqual(a);
    expect(await findTenantByHost('b.example.com')).toBeNull();
    expect(await findTenantBySlug('a')).toEqual(a);
  });
  it('reads the service key from Vault', async () => {
    controlSecret.mockResolvedValue('vault-key');
    expect(await tenantServiceKey('a')).toBe('vault-key');
    expect(controlSecret).toHaveBeenCalledWith('a', 'service_role_key');
  });
});
```

`src/lib/tenant/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistryUnavailableError } from './types';

const { findTenantByHost } = vi.hoisted(() => ({ findTenantByHost: vi.fn() }));
vi.mock('./registry', () => ({ findTenantByHost }));
import { routeHost } from './route';

const active = { slug: 'a', hosts: ['a.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'k', status: 'active' as const };

beforeEach(() => vi.clearAllMocks());

describe('routeHost', () => {
  it('routes a known host (normalised first)', async () => {
    findTenantByHost.mockResolvedValue(active);
    expect(await routeHost('A.Example.com:443')).toEqual({ kind: 'tenant', tenant: active });
    expect(findTenantByHost).toHaveBeenCalledWith('a.example.com');
  });
  it('an unknown host is not found', async () => {
    findTenantByHost.mockResolvedValue(null);
    expect(await routeHost('nobody.example.com')).toEqual({ kind: 'not-found' });
  });
  it.each([null, '', '203.0.113.5', 'evil.com/x'])('a missing or invalid host (%s) is not found without a lookup', async (host) => {
    expect(await routeHost(host)).toEqual({ kind: 'not-found' });
    expect(findTenantByHost).not.toHaveBeenCalled();
  });
  it('a suspended company is suspended', async () => {
    findTenantByHost.mockResolvedValue({ ...active, status: 'suspended' });
    expect(await routeHost('a.example.com')).toEqual({ kind: 'suspended' });
  });
  it('an unreachable registry is unavailable, never a guess', async () => {
    findTenantByHost.mockRejectedValue(new RegistryUnavailableError());
    expect(await routeHost('a.example.com')).toEqual({ kind: 'unavailable' });
  });
});
```

Note: in single-tenant mode `findTenantByHost` matches any *valid* host. `routeHost(null)` → not-found would break requests without a Host header. Every HTTP/1.1 request has one, and Vercel always sets it, so this is acceptable and matches the spec.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- src/lib/tenant/registry src/lib/tenant/route`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`src/lib/tenant/registry.ts`:

```ts
import 'server-only';
import { controlSecret, controlTenants } from './control';
import { ANY_HOST, staticTenants, type StaticTenant } from './static';
import type { Tenant } from './types';

const usesControl = () => Boolean(process.env.CONTROL_SUPABASE_URL);
const publicPart = ({ serviceRoleKey: _secret, ...t }: StaticTenant): Tenant => t;

async function all(): Promise<Tenant[]> {
  return usesControl() ? controlTenants() : staticTenants().map(publicPart);
}

export async function findTenantByHost(host: string): Promise<Tenant | null> {
  return (await all()).find((t) => t.hosts.includes(host) || t.hosts.includes(ANY_HOST)) ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  return (await all()).find((t) => t.slug === slug) ?? null;
}

/** The company's service-role key: Vault in control mode, the static registry otherwise. */
export async function tenantServiceKey(slug: string): Promise<string> {
  if (usesControl()) return controlSecret(slug, 'service_role_key');
  const t = staticTenants().find((s) => s.slug === slug);
  if (!t) throw new Error(`Unknown tenant ${slug}`);
  return t.serviceRoleKey;
}
```

`src/lib/tenant/route.ts`:

```ts
import { normaliseHost } from './host';
import { findTenantByHost } from './registry';
import { RegistryUnavailableError, type Tenant } from './types';

export type Route = { kind: 'tenant'; tenant: Tenant } | { kind: 'not-found' } | { kind: 'suspended' } | { kind: 'unavailable' };

/** Which company a request is for, decided from its Host header only. */
export async function routeHost(rawHost: string | null): Promise<Route> {
  const host = normaliseHost(rawHost);
  if (!host) return { kind: 'not-found' };
  try {
    const tenant = await findTenantByHost(host);
    if (!tenant) return { kind: 'not-found' };
    return tenant.status === 'active' ? { kind: 'tenant', tenant } : { kind: 'suspended' };
  } catch (error) {
    if (error instanceof RegistryUnavailableError) return { kind: 'unavailable' };
    throw error;
  }
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npm test -- src/lib/tenant`
Expected: PASS (all tenant tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/registry.ts src/lib/tenant/route.ts src/lib/tenant/registry.test.ts src/lib/tenant/route.test.ts
git commit -m "feat(tenant): registry facade and host routing decision"
```

---

### Task 5: Per-tenant security headers

**Files:**
- Modify: `src/lib/security-headers.ts`, `next.config.ts`
- Test: `src/lib/security-headers.test.ts`

**Interfaces:**
- Produces:
  - `contentSecurityPolicy(supabaseUrl: string, dev: boolean): string`
  - `staticSecurityHeaders(): Header[]` (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy)
  - `securityHeaders(supabaseUrl, dev)`, which stays and equals CSP + the static ones.

- [ ] **Step 1: Add the failing tests** (append to `src/lib/security-headers.test.ts`, and add `contentSecurityPolicy, staticSecurityHeaders` to its import)

```ts
describe('per-tenant split', () => {
  it('builds the CSP for the given company only', () => {
    const csp = contentSecurityPolicy('https://tenantb.supabase.co', false);
    expect(csp).toContain("connect-src 'self' https://tenantb.supabase.co wss://tenantb.supabase.co");
    expect(csp).not.toContain('abcd.supabase.co');
  });
  it('the static headers carry no CSP (it depends on the company)', () => {
    expect(staticSecurityHeaders().map((h) => h.key)).toEqual([
      'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy',
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- security-headers`
Expected: FAIL, "contentSecurityPolicy is not a function".

- [ ] **Step 3: Implement.** Replace the body of `src/lib/security-headers.ts`:

```ts
export type Header = { key: string; value: string };

/**
 * The CSP allows only this site and the company's Supabase project; inline scripts/styles are needed by
 * Next.js, eval only by the dev runtime. Set per request by the middleware (the project depends on the host).
 */
export function contentSecurityPolicy(supabaseUrl: string, dev: boolean): string {
  const supabase = new URL(supabaseUrl);
  return [
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
}

/** Headers that are the same for every company: applied to every route in next.config.ts. */
export function staticSecurityHeaders(): Header[] {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}

export function securityHeaders(supabaseUrl: string, dev: boolean): Header[] {
  return [{ key: 'Content-Security-Policy', value: contentSecurityPolicy(supabaseUrl, dev) }, ...staticSecurityHeaders()];
}
```

Replace `headers()` in `next.config.ts`, and change its import to `staticSecurityHeaders`:

```ts
  async headers() {
    // The CSP depends on the company and is set per request by the middleware.
    return [{ source: '/:path*', headers: staticSecurityHeaders() }];
  },
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npm test -- security-headers`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/security-headers.ts src/lib/security-headers.test.ts next.config.ts
git commit -m "refactor(headers): per-tenant CSP, static headers stay in next.config"
```

---

### Task 6: Middleware routes by tenant

**Files:**
- Modify: `src/middleware.ts`, `src/lib/supabase/middleware.ts`
- Create: `src/lib/tenant/responses.ts`
- Test: `src/lib/tenant/responses.test.ts`

**Interfaces:**
- Consumes:
  - `routeHost` (Task 4)
  - `TENANT_HEADER` (Task 1)
  - `contentSecurityPolicy` (Task 5)
- Produces:
  - `forwardHeaders(incoming: Headers, slug: string): Headers`, which removes any incoming `x-tenant` and sets the trusted value.
  - `blockedResponse(kind: 'not-found' | 'suspended' | 'unavailable'): Response`, giving 404, 503 or 503 with fixed messages.
  - After this task, every forwarded request carries a trusted `x-tenant`.

- [ ] **Step 1: Write the failing test** `src/lib/tenant/responses.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { blockedResponse, forwardHeaders } from './responses';

describe('forwardHeaders', () => {
  it('replaces a spoofed x-tenant with the trusted slug and keeps other headers', () => {
    const h = forwardHeaders(new Headers({ 'x-tenant': 'other-company', cookie: 'a=1' }), 'academy');
    expect(h.get('x-tenant')).toBe('academy');
    expect(h.get('cookie')).toBe('a=1');
  });
});

describe('blockedResponse', () => {
  it.each([
    ['not-found', 404, 'Not found'],
    ['suspended', 503, 'This site is temporarily unavailable'],
    ['unavailable', 503, 'Service unavailable'],
  ] as const)('%s → %i', async (kind, status, text) => {
    const r = blockedResponse(kind);
    expect(r.status).toBe(status);
    expect(await r.text()).toContain(text);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/lib/tenant/responses`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement** `src/lib/tenant/responses.ts`

```ts
import { TENANT_HEADER } from './types';

/** Request headers to forward: whatever the browser sent as x-tenant is replaced by the routed company. */
export function forwardHeaders(incoming: Headers, slug: string): Headers {
  const headers = new Headers(incoming);
  headers.delete(TENANT_HEADER);
  headers.set(TENANT_HEADER, slug);
  return headers;
}

const PAGES = {
  'not-found': { status: 404, title: 'Not found', body: 'There is no site at this address.' },
  suspended: { status: 503, title: 'This site is temporarily unavailable', body: 'Please try again later or contact your course organizer.' },
  unavailable: { status: 503, title: 'Service unavailable', body: 'Please try again in a few minutes.' },
} as const;

/** Plain pages for requests that don't reach a company: no app shell, no Supabase call, nothing about other companies. */
export function blockedResponse(kind: keyof typeof PAGES): Response {
  const p = PAGES[kind];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${p.title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>${p.title}</h1><p>${p.body}</p></body></html>`;
  return new Response(html, { status: p.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
```

Change `src/lib/supabase/middleware.ts`:
- Imports: add `import { routeHost } from '@/lib/tenant/route';`, `import { blockedResponse, forwardHeaders } from '@/lib/tenant/responses';` and `import { contentSecurityPolicy } from '@/lib/security-headers';`. Remove `import { publicEnv } from '@/lib/env';`.
- Replace the start of `updateSession`, up to and including the `createServerClient(...)` call, with:

```ts
export async function updateSession(request: NextRequest) {
  const route = await routeHost(request.headers.get('host'));
  if (route.kind !== 'tenant') return blockedResponse(route.kind);
  const { tenant } = route;
  // Rebuilt after cookie changes too, so server code always sees the routed company, never a browser-sent one.
  const next = () => NextResponse.next({ request: { headers: forwardHeaders(request.headers, tenant.slug) } });

  let response = next();
  const supabase = createServerClient(tenant.supabaseUrl, tenant.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
```

- Change the two return points at the end so that every response, including redirects, carries the company's CSP:

```ts
  const csp = contentSecurityPolicy(tenant.supabaseUrl, process.env.NODE_ENV !== 'production');
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };
```

Wrap each existing `return …` in `updateSession` (the idle redirect, the final `target ? redirectTo(...) : response`) as `return withCsp(…)`. Declare `withCsp` right after `const { tenant } = route;` so it's in scope for the idle branch.

Change `src/middleware.ts` `config` to run on Node, so `fs` (the local file) and the in-memory cache work:

```ts
export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- src/lib/tenant && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 5: Smoke-check single-tenant mode**

Run: `npx playwright test auth headers idle --project=chromium`
Expected: all pass. The default tenant serves `localhost`, and `headers.spec` still sees the CSP with the dev Supabase origin.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/lib/supabase/middleware.ts src/lib/tenant/responses.ts src/lib/tenant/responses.test.ts
git commit -m "feat(tenant): middleware routes by host, strips x-tenant, per-tenant CSP"
```

---

### Task 7: Server code uses the current tenant

**Files:**
- Create: `src/lib/tenant/current.ts`
- Modify:
  - `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/client.ts`
  - `src/components/idle-timer.tsx`, `src/app/(app)/layout.tsx`
  - `src/lib/admin/create-login.ts`, `src/lib/admin/auth-accounts.ts`, `src/app/(app)/admin/users/actions.ts`
  - `src/lib/env.ts`
- Test:
  - `src/lib/tenant/current.test.ts`
  - Update `src/lib/admin/create-login.test.ts`, `src/app/(app)/admin/users/actions.test.ts`

**Interfaces:**
- Consumes:
  - `TENANT_HEADER`, `ADMIN_UNAVAILABLE` (Task 1)
  - `findTenantBySlug`, `tenantServiceKey` (Task 4)
- Produces:
  - `currentTenant(): Promise<Tenant>`, which throws `Error('No company for this request')` if the header is missing or the tenant is unknown or inactive.
  - `requestOrigin(): Promise<string>`, e.g. `https://academy.example.com` or `http://localhost:3000`.
  - `createAdminClient(): Promise<SupabaseClient>`, now async, which throws `Error(ADMIN_UNAVAILABLE)` when the key can't be read.
  - Browser `createClient(url: string, anonKey: string)`.
  - `<IdleTimer supabase={{ url, anonKey }} …/>`.

- [ ] **Step 1: Write the failing test** `src/lib/tenant/current.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { headerMap, findTenantBySlug } = vi.hoisted(() => ({ headerMap: new Map<string, string>(), findTenantBySlug: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => headerMap.get(k) ?? null }) }));
vi.mock('./registry', () => ({ findTenantBySlug }));
import { currentTenant, requestOrigin } from './current';

const t = { slug: 'academy', hosts: ['academy.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'k', status: 'active' };

beforeEach(() => {
  headerMap.clear();
  vi.clearAllMocks();
});

describe('currentTenant', () => {
  it('resolves the trusted header', async () => {
    headerMap.set('x-tenant', 'academy');
    findTenantBySlug.mockResolvedValue(t);
    expect(await currentTenant()).toEqual(t);
  });
  it('throws without a routed company', async () => {
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
  it('throws for a suspended company', async () => {
    headerMap.set('x-tenant', 'academy');
    findTenantBySlug.mockResolvedValue({ ...t, status: 'suspended' });
    await expect(currentTenant()).rejects.toThrow('No company for this request');
  });
});

describe('requestOrigin', () => {
  it('uses the Host header and https in production', async () => {
    headerMap.set('host', 'academy.example.com');
    headerMap.set('x-forwarded-proto', 'https');
    expect(await requestOrigin()).toBe('https://academy.example.com');
  });
  it('falls back to http for localhost', async () => {
    headerMap.set('host', 'localhost:3000');
    expect(await requestOrigin()).toBe('http://localhost:3000');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/lib/tenant/current`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement** `src/lib/tenant/current.ts`

```ts
import 'server-only';
import { headers } from 'next/headers';
import { findTenantBySlug } from './registry';
import { TENANT_HEADER, type Tenant } from './types';

/** The company this request was routed to by the middleware. Pages, actions and route handlers only. */
export async function currentTenant(): Promise<Tenant> {
  const slug = (await headers()).get(TENANT_HEADER);
  const tenant = slug ? await findTenantBySlug(slug) : null;
  if (!tenant || tenant.status !== 'active') throw new Error('No company for this request');
  return tenant;
}

/** This request's own origin (each company has its own host), e.g. for invite links. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.includes('.localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
```

`src/lib/supabase/server.ts`: replace `import { publicEnv } from '@/lib/env';` with `import { currentTenant } from '@/lib/tenant/current';`, and the client creation with:

```ts
export async function createClient() {
  const [cookieStore, tenant] = await Promise.all([cookies(), currentTenant()]);
  return createServerClient(tenant.supabaseUrl, tenant.anonKey, {
```

(the cookie handlers stay unchanged).

`src/lib/supabase/admin.ts`:

```ts
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentTenant } from '@/lib/tenant/current';
import { tenantServiceKey } from '@/lib/tenant/registry';
import { ADMIN_UNAVAILABLE } from '@/lib/tenant/types';

/** Service-role client for the current company. Use ONLY for auth admin operations (invite, ban); data writes go through the user's client so RLS and audit apply. */
export async function createAdminClient(): Promise<SupabaseClient> {
  const tenant = await currentTenant();
  let key: string;
  try {
    key = await tenantServiceKey(tenant.slug);
  } catch (error) {
    console.error(`Service key for ${tenant.slug} unavailable`, error);
    throw new Error(ADMIN_UNAVAILABLE);
  }
  return createClient(tenant.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

`src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

/** Browser client for the current company: its URL and public key come from the server-rendered layout. */
export function createClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
```

`src/components/idle-timer.tsx`:
- Change `signOutForIdle` to `async function signOutForIdle(supabase: { url: string; anonKey: string }) { await createClient(supabase.url, supabase.anonKey).auth.signOut({ scope: 'local' }); window.location.assign('/login?reason=idle'); }`.
- Change the component signature to `export function IdleTimer({ timeoutMinutes, supabase, onIdle }: { timeoutMinutes: number; supabase?: { url: string; anonKey: string }; onIdle?: () => void })`.
- At the top of the `useEffect` callback add `const handleIdle = onIdle ?? (() => supabase && signOutForIdle(supabase));`, pass `handleIdle` to `createIdleTimer`, and set the effect deps to `[timeoutMinutes, onIdle, supabase?.url, supabase?.anonKey]`.

`src/app/(app)/layout.tsx`: import `currentTenant` from `@/lib/tenant/current`. After `const settings = await getSettings();` add `const tenant = await currentTenant();`, and render `<IdleTimer timeoutMinutes={settings.session_timeout_minutes} supabase={{ url: tenant.supabaseUrl, anonKey: tenant.anonKey }} />`.

`src/lib/admin/create-login.ts`:
- Replace `import { serverEnv } from '@/lib/env';` with `import { requestOrigin } from '@/lib/tenant/current';`.
- Replace `const admin = createAdminClient();` with:

```ts
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
```

- Replace the invite call's `redirectTo` with `${await requestOrigin()}/auth/confirm`.
- The cleanup branch keeps `await admin.auth.admin.deleteUser(...)`.

`src/lib/admin/auth-accounts.ts`: replace both function bodies:

```ts
export async function deleteAuthUser(userId: string): Promise<string | null> {
  const prefix = 'The user was removed from the app, but their sign-in account was not deleted: ';
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return prefix + (error as Error).message;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  return error ? prefix + mapAuthError(error) : null;
}

export async function setTemporaryPassword(userId: string): Promise<{ password: string } | { error: string }> {
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  return error ? { error: mapAuthError(error) } : { password };
}
```

`src/app/(app)/admin/users/actions.ts` (`setUserActive`): replace `await createAdminClient().auth.admin.updateUserById(` with:

```ts
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  const { error: banError } = await admin.auth.admin.updateUserById(
```

`src/lib/env.ts`: delete `publicEnv` and `serverEnv`. Leave the file with a comment only, or remove it if nothing imports it. Check with `grep -rn "lib/env" src scripts`: `scripts/*` read `process.env` directly and don't import it. Remove the file if unused, and delete `SITE_URL` from `.env.example` in Task 10.

Update the mocks:
- `src/lib/admin/create-login.test.ts`: replace the `@/lib/env` mock with `vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'http://localhost:3000' }));`, and make the admin mock async: `createAdminClient: async () => ({ auth: { admin: auth } })`.
- `src/app/(app)/admin/users/actions.test.ts`: remove the `@/lib/env` mock line. It's no longer imported.

Add to `create-login.test.ts`:

```ts
it('reports an unavailable admin connection without creating anything', async () => {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  vi.mocked(createAdminClient).mockRejectedValueOnce(new Error("This action isn't available right now. Please try again later."));
  expect(await createLogin({ email: 'x@example.com', full_name: 'X', role: 'organizer' })).toEqual({
    error: "This action isn't available right now. Please try again later.",
  });
});
```

For `vi.mocked` to work, declare the admin mock as `createAdminClient: vi.fn(async () => ({ auth: { admin: auth } }))`.

- [ ] **Step 4: Run all unit tests, typecheck and lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass (304 + new).

- [ ] **Step 5: Regression in single-tenant mode** (no `TENANTS_FILE`, no `CONTROL_*` in `.env.local`)

Run: `npx playwright test admin delegates invite idle auth patients --project=chromium`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A src .env.example
git commit -m "feat(tenant): Supabase clients, idle timer and invites use the routed company"
```

---

### Task 8: Migrate script `--control` target

**Files:**
- Create: `scripts/migrate-target.ts`, `scripts/migrate-target.test.ts`
- Modify: `scripts/migrate.ts`, `scripts/migrate-cli.ts`, `package.json` (no change needed: args pass through `npm run db:migrate -- --control`)

**Interfaces:**
- Produces:
  - `migrateTarget(argv: string[], env: Env): { dir: string; config: ClientConfig; label: string }`
  - `migrate(dir?: string, config?: ClientConfig)`
- Control env vars: `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, and an optional `CONTROL_DATABASE_CA_CERT` (default `DATABASE_CA_CERT`).

- [ ] **Step 1: Write the failing test** `scripts/migrate-target.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('node:fs', () => ({ readFileSync: () => 'CA' }));
import path from 'node:path';
import { migrateTarget } from './migrate-target';

const env = {
  DATABASE_URL: 'postgres://app', NEXT_PUBLIC_SUPABASE_URL: 'https://app.supabase.co', DATABASE_CA_CERT: 'ca.crt',
  CONTROL_DATABASE_URL: 'postgres://control', CONTROL_SUPABASE_URL: 'https://ctl.supabase.co',
};

describe('migrateTarget', () => {
  it('defaults to the app database and migrations', () => {
    const t = migrateTarget([], env);
    expect(t.dir).toBe(path.join(process.cwd(), 'supabase', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://app');
    expect(t.label).toBe('app.supabase.co');
  });
  it('--control targets the control project and its migrations', () => {
    const t = migrateTarget(['--control'], env);
    expect(t.dir).toBe(path.join(process.cwd(), 'supabase', 'control', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://control');
    expect(t.label).toBe('control ctl.supabase.co');
  });
  it('--control needs CONTROL_DATABASE_URL', () => {
    expect(() => migrateTarget(['--control'], { ...env, CONTROL_DATABASE_URL: undefined })).toThrow(/CONTROL_DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- scripts/migrate-target`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement** `scripts/migrate-target.ts`

```ts
import path from 'node:path';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { targetLabel } from './create-user-args';

type Env = Record<string, string | undefined>;

/** Which database and migration folder `npm run db:migrate [-- --control]` uses. */
export function migrateTarget(argv: string[], env: Env): { dir: string; config: ClientConfig; label: string } {
  if (argv.includes('--control')) {
    if (!env.CONTROL_DATABASE_URL) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
    return {
      dir: path.join(process.cwd(), 'supabase', 'control', 'migrations'),
      config: pgConfig({ DATABASE_URL: env.CONTROL_DATABASE_URL, DATABASE_CA_CERT: env.CONTROL_DATABASE_CA_CERT ?? env.DATABASE_CA_CERT }),
      label: `control ${targetLabel(env.CONTROL_SUPABASE_URL)}`,
    };
  }
  return { dir: path.join(process.cwd(), 'supabase', 'migrations'), config: pgConfig(env), label: targetLabel(env.NEXT_PUBLIC_SUPABASE_URL) };
}
```

`scripts/migrate.ts`: change the signature to `export async function migrate(dir = path.join(process.cwd(), 'supabase', 'migrations'), config: ClientConfig = pgConfig()): Promise<string[]>`, use `new Client(config)`, and add `import type { ClientConfig } from 'pg';`.

`scripts/migrate-cli.ts`:

```ts
import './load-env';
import { migrate } from './migrate';
import { migrateTarget } from './migrate-target';

const target = migrateTarget(process.argv.slice(2), process.env);
// Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
console.log(`Target project: ${target.label}`);

migrate(target.dir, target.config)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
```

`scripts/workflows.test.ts` pins the release workflow, which runs `npm run db:migrate` without arguments. That's unchanged, so it stays green.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate.ts scripts/migrate-cli.ts scripts/migrate-target.ts scripts/migrate-target.test.ts
git commit -m "feat(scripts): db:migrate -- --control targets the control project"
```

---

### Task 9: Control schema, plus registration and self-check scripts

**Files:**
- Create:
  - `supabase/control/migrations/0001_control_registry.sql`
  - `scripts/tenants.ts`, `scripts/tenant-register.ts`, `scripts/tenant-check.ts`
  - `tests/db/control.test.ts`, `scripts/tenants.test.ts`
- Modify: `package.json` (scripts `tenant:register`, `tenant:check`)

**Interfaces:**
- Produces:
  - SQL: `public.tenants`, `public.tenant_audit`, `public.tenant_secret(p_slug text, p_name text) returns text`.
  - TS: `registerTenant(client: pg.Client, t: { slug; name; hosts: string[]; supabaseUrl; anonKey; serviceRoleKey; databaseUrl }): Promise<void>`, an upsert of the row plus both Vault secrets.
  - `checkTenant(t: { supabaseUrl; anonKey; serviceRoleKey }, fetchImpl?: typeof fetch): Promise<string[]>`, which returns a list of problems (empty means OK).
  - `parseRegisterArgs(argv): { slug; name; hosts }`.

The audit table is named `tenant_audit`, not `audit_log`. That way the control migration can be dry-run on the dev database, which already has an app `audit_log`. This is a deliberate refinement of the spec's wording.

- [ ] **Step 1: Write the failing DB test** `tests/db/control.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { registerTenant } from '../../scripts/tenants';

const CONTROL_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0001_control_registry.sql'), 'utf8');

/** The control schema applied inside the test's own (rolled-back) transaction on the dev database. */
async function withControl(fn: (c: Client) => Promise<void>) {
  await withTx(async (c) => {
    await c.query(CONTROL_SQL);
    await fn(c);
  });
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const academy = {
  slug: 'zz-academy', name: 'Zz Academy', hosts: ['Academy.Example.com'], supabaseUrl: 'https://abcdefgh.supabase.co',
  anonKey: 'anon', serviceRoleKey: 'svc-secret', databaseUrl: 'postgres://secret',
};

describe('control registry', () => {
  it('registers a company: hosts normalised, secrets in Vault, audit row written', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      const t = (await c.query(`select hosts, status from public.tenants where slug = 'zz-academy'`)).rows[0];
      expect(t).toEqual({ hosts: ['academy.example.com'], status: 'active' });
      await c.query('set local role service_role');
      expect((await c.query(`select public.tenant_secret('zz-academy', 'service_role_key') as s`)).rows[0].s).toBe('svc-secret');
      await asPostgres(c);
      expect((await c.query(`select count(*)::int as n from public.tenant_audit where slug = 'zz-academy'`)).rows[0].n).toBeGreaterThan(0);
    });
  });

  it('registering again updates the row and the secrets (no duplicates)', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      await registerTenant(c, { ...academy, serviceRoleKey: 'rotated' });
      await c.query('set local role service_role');
      expect((await c.query(`select public.tenant_secret('zz-academy', 'service_role_key') as s`)).rows[0].s).toBe('rotated');
    });
  });

  it('a host belongs to one company only', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      await refused(c, () => registerTenant(c, { ...academy, slug: 'zz-other', hosts: ['academy.example.com'] }), /already used by zz-academy/);
    });
  });

  it('anon and signed-in users can read nothing and call no secret function', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      for (const who of [null, '00000000-0000-0000-0000-000000000001']) {
        await actAs(c, who);
        await refused(c, () => c.query('select * from public.tenants'), /permission denied/);
        await refused(c, () => c.query(`select public.tenant_secret('zz-academy', 'service_role_key')`), /permission denied/);
      }
    });
  });

  it('only the two known secret names can be read', async () => {
    await withControl(async (c) => {
      await c.query('set local role service_role');
      await refused(c, () => c.query(`select public.tenant_secret('zz-academy', 'anything')`), /Unknown secret/);
    });
  });
});
```

`scripts/tenants.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) }),
}));
import { checkTenant, parseRegisterArgs } from './tenants';

describe('parseRegisterArgs', () => {
  it('slug, name and one or more hosts', () => {
    expect(parseRegisterArgs(['academy', 'The Academy', 'implant-course.vercel.app', 'www.academy.com'])).toEqual({
      slug: 'academy', name: 'The Academy', hosts: ['implant-course.vercel.app', 'www.academy.com'],
    });
  });
  it('needs at least one host', () => {
    expect(() => parseRegisterArgs(['academy', 'The Academy'])).toThrow(/Usage/);
  });
});

describe('checkTenant', () => {
  const t = { supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc' };
  it('ok when the anon key and service key both work', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('https://a.supabase.co/auth/v1/settings', { headers: { apikey: 'anon' } });
  });
  it('reports a wrong anon key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    expect(await checkTenant(t, fetchImpl as unknown as typeof fetch)).toEqual(['Anon key rejected by https://a.supabase.co (401)']);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- scripts/tenants && npm run test:db -- control`
Expected: FAIL, unresolved imports or a missing SQL file. (`test:db` applies no app migrations here, because none are pending.)

- [ ] **Step 3: Implement the schema** `supabase/control/migrations/0001_control_registry.sql`

```sql
-- Control project: the registry of companies (tenants). It holds no patient data. Only the service role
-- (the app server, the release workflow, the owner's scripts) reads or writes it.

create table public.tenants (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  hosts text[] not null check (cardinality(hosts) > 0),
  supabase_url text not null check (supabase_url ~ '^https://[a-z0-9]+\.supabase\.co$'),
  anon_key text not null check (length(anon_key) > 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  slug text not null,
  action text not null,
  actor text not null default current_user,
  before jsonb,
  after jsonb
);

-- Hosts: lower case, no port or trailing dot, each used by one company only.
create function public.tenants_normalise() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_host text;
  v_owner text;
begin
  new.hosts := array(select distinct regexp_replace(regexp_replace(lower(trim(h)), ':\d+$', ''), '\.$', '') from unnest(new.hosts) h);
  foreach v_host in array new.hosts loop
    if v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
      raise exception 'Invalid host: %', v_host;
    end if;
  end loop;
  lock table public.tenants in share row exclusive mode;
  select t.slug into v_owner from public.tenants t where t.slug <> new.slug and t.hosts && new.hosts limit 1;
  if v_owner is not null then
    raise exception 'A host of % is already used by %', new.slug, v_owner;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tenants_normalise before insert or update on public.tenants
  for each row execute function public.tenants_normalise();

create function public.tenants_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.tenant_audit (slug, action, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger tenants_audit after insert or update or delete on public.tenants
  for each row execute function public.tenants_audit();

alter table public.tenants enable row level security;
alter table public.tenant_audit enable row level security;
revoke all on public.tenants, public.tenant_audit from public, anon, authenticated;
grant select, insert, update, delete on public.tenants to service_role;
grant select on public.tenant_audit to service_role;
revoke execute on function public.tenants_normalise(), public.tenants_audit() from public, anon, authenticated;

-- Company secrets live in Vault as tenant/<slug>/<name>; this is the only way to read them.
create function public.tenant_secret(p_slug text, p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if p_name not in ('service_role_key', 'database_url') then
    raise exception 'Unknown secret %', p_name;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'tenant/' || p_slug || '/' || p_name;
  return v_secret;
end $$;
revoke execute on function public.tenant_secret(text, text) from public, anon, authenticated;
grant execute on function public.tenant_secret(text, text) to service_role;
```

- [ ] **Step 4: Implement the scripts.** `scripts/tenants.ts`:

```ts
import type { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

export type RegisterInput = {
  slug: string; name: string; hosts: string[]; supabaseUrl: string; anonKey: string; serviceRoleKey: string; databaseUrl: string;
};

export function parseRegisterArgs(argv: string[]): { slug: string; name: string; hosts: string[] } {
  const [slug, name, ...hosts] = argv;
  if (!slug || !name || hosts.length === 0) throw new Error('Usage: npm run tenant:register -- <slug> "<name>" <host> [more hosts]');
  return { slug, name, hosts };
}

async function upsertSecret(c: Client, name: string, value: string) {
  const { rows } = await c.query('select id from vault.secrets where name = $1', [name]);
  if (rows[0]) await c.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await c.query('select vault.create_secret($1, $2)', [value, name]);
}

/** Adds or updates a company in the control project (run with a postgres connection to it). */
export async function registerTenant(c: Client, t: RegisterInput): Promise<void> {
  await c.query(
    `insert into public.tenants (slug, name, hosts, supabase_url, anon_key)
     values ($1, $2, $3, $4, $5)
     on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts,
       supabase_url = excluded.supabase_url, anon_key = excluded.anon_key`,
    [t.slug, t.name, t.hosts, t.supabaseUrl, t.anonKey],
  );
  await upsertSecret(c, `tenant/${t.slug}/service_role_key`, t.serviceRoleKey);
  await upsertSecret(c, `tenant/${t.slug}/database_url`, t.databaseUrl);
}

/** Problems with a company's URL and keys (empty when both the public and the service key work). */
export async function checkTenant(
  t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const problems: string[] = [];
  const res = await fetchImpl(`${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
  if (!res.ok) problems.push(`Anon key rejected by ${t.supabaseUrl} (${res.status})`);
  const admin = createClient(t.supabaseUrl, t.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from('profiles').select('user_id').limit(1);
  if (error) problems.push(`Service key can't read profiles: ${error.message}`);
  return problems;
}
```

`scripts/tenant-register.ts`, which registers the company described by the loaded `ENV_FILE`:

```ts
import './load-env';
import { Client } from 'pg';
import { migrateTarget } from './migrate-target';
import { checkTenant, parseRegisterArgs, registerTenant } from './tenants';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in the ENV_FILE`);
  return v;
}

async function main() {
  const args = parseRegisterArgs(process.argv.slice(2));
  const company = {
    ...args,
    supabaseUrl: need('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    databaseUrl: need('DATABASE_URL'),
  };
  const target = migrateTarget(['--control'], process.env);
  console.log(`Target project: ${target.label}; company ${args.slug} → ${new URL(company.supabaseUrl).host}`);
  const problems = await checkTenant(company);
  if (problems.length) throw new Error(`Not registered:\n- ${problems.join('\n- ')}`);
  const c = new Client(target.config);
  await c.connect();
  try {
    await c.query('begin');
    await registerTenant(c, company);
    await c.query('commit');
  } catch (error) {
    await c.query('rollback');
    throw error;
  } finally {
    await c.end();
  }
  console.log(`Registered ${args.slug}: ${args.hosts.join(', ')}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

`scripts/tenant-check.ts`, which checks a registered company with keys read from the control project:

```ts
import './load-env';
import { Client } from 'pg';
import { migrateTarget } from './migrate-target';
import { checkTenant } from './tenants';

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Usage: npm run tenant:check -- <slug>');
  const c = new Client(migrateTarget(['--control'], process.env).config);
  await c.connect();
  try {
    const t = (await c.query('select supabase_url, anon_key, status from public.tenants where slug = $1', [slug])).rows[0];
    if (!t) throw new Error(`No company ${slug} in the control project`);
    const key = (await c.query(`select decrypted_secret from vault.decrypted_secrets where name = $1`, [`tenant/${slug}/service_role_key`])).rows[0];
    if (!key) throw new Error(`No service key in Vault for ${slug}`);
    const problems = await checkTenant({ supabaseUrl: t.supabase_url, anonKey: t.anon_key, serviceRoleKey: key.decrypted_secret });
    console.log(problems.length ? `PROBLEMS for ${slug} (${t.status}):\n- ${problems.join('\n- ')}` : `${slug} (${t.status}): OK`);
    if (problems.length) process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

`package.json` scripts: add `"tenant:register": "tsx scripts/tenant-register.ts",` and `"tenant:check": "tsx scripts/tenant-check.ts",`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- scripts/tenants && npm run test:db -- control`
Expected: PASS (2 + 5 tests). The control schema is applied and rolled back inside each test, so nothing persists on dev.

- [ ] **Step 6: Commit**

```bash
git add supabase/control scripts/tenants.ts scripts/tenants.test.ts scripts/tenant-register.ts scripts/tenant-check.ts tests/db/control.test.ts package.json
git commit -m "feat(control): tenants registry schema, Vault secrets, register and check scripts"
```

---

### Task 10: Docs and env template

**Files:**
- Modify: `.env.example`, `../CLAUDE.md`, `../docs/operations.md`

- [ ] **Step 1: `.env.example`.** Remove the `SITE_URL=…` line. Add:

```
# Multi-tenant (see docs/operations.md "Control project"). Leave unset for a single company (today's setup).
# App server: the control project that lists the companies.
CONTROL_SUPABASE_URL=
CONTROL_SERVICE_ROLE_KEY=
# Owner scripts only (db:migrate -- --control, tenant:register, tenant:check), in .env.prod; never in Vercel.
CONTROL_DATABASE_URL=
CONTROL_DATABASE_CA_CERT=
# Local isolation tests only: tenants.local.json (git-ignored, refused in production).
# TENANTS_FILE=tenants.local.json
```

- [ ] **Step 2: `CLAUDE.md`.** Under **Architecture**, after the Stack line, add:

```
**Companies (multi-tenant, part 1):** one Supabase project per company behind one app. `src/lib/tenant/` routes by Host: middleware (Node runtime) → `routeHost()` → registry → sets the trusted `x-tenant` (any browser-sent one is dropped) and that company's CSP. Server code gets it with `currentTenant()`; `createClient()` / `createAdminClient()` (async) use it. Registry: none configured = today's env vars as tenant `default`; `TENANTS_FILE` = local list (dev/isolation E2E only); `CONTROL_SUPABASE_URL` = the control project (`tenants`, Vault `tenant/<slug>/…`, cache 60 s, stale ≤ 10 min). Control migrations: `supabase/control/migrations/`, `npm run db:migrate -- --control`. Unknown host 404, suspended 503.
```

- [ ] **Step 3: `docs/operations.md`.** Append this section:

````markdown
## G. Control project (companies)

The app serves each company from its own Supabase project. Without `CONTROL_SUPABASE_URL` it serves one company (tenant `default`) from the `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` env vars, as before.

**Set up (once, owner):**
1. Create the project `implant-course-control` (Frankfurt). Until Supabase Pro, it lives in the separate free org "Implant Course Dev".
2. In `web/.env.prod` add `CONTROL_SUPABASE_URL`, `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩ and `CONTROL_DATABASE_URL` ⟨secret⟩ (Session pooler). The Supabase CA certificate is shared, so `DATABASE_CA_CERT` covers it; otherwise set `CONTROL_DATABASE_CA_CERT`.
3. Apply the control schema: `ENV_FILE=.env.prod npm run db:migrate -- --control`. The first line must read `Target project: control <ref>.supabase.co`.

**Register a company** (its project's keys come from the loaded env file; for the academy that's `.env.prod`):

```bash
ENV_FILE=.env.prod npm run tenant:register -- academy "Implant Course Academy" implant-course.vercel.app
ENV_FILE=.env.prod npm run tenant:check -- academy        # → academy (active): OK
```

**Switch production to the control project:** in Vercel (Production) add `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩, then run Release. To roll back, remove both and run Release again.

Unknown hosts get 404; a suspended company gets 503. If the control project is down, the app keeps routing from its last list for 10 minutes, then shows "Service unavailable".
````

- [ ] **Step 4: Commit**

```bash
git add .env.example ../CLAUDE.md ../docs/operations.md
git commit -m "docs: multi-tenant part 1 (control project, tenant runtime, env vars)"
```

---

### Task 11: Second dev company and the isolation E2E tests

**Files:**
- Create: `tests/e2e/isolation.spec.ts`
- Local only, never committed: `web/.env.dev2`, `web/tenants.local.json`

**Owner prerequisite** (Claude can't create Supabase accounts or projects):
1. In Supabase, create a new **free organisation** (e.g. "Implant Course Dev") and in it a project `implant-course-dev2` (Frankfurt).
2. Copy its URL, anon key, service role key and session-pooler `DATABASE_URL` into `web/.env.dev2`, using `Read-Host -AsSecureString` prompts as in the memory note, with `ALLOW_TEST_FIXTURES=1`.
3. Apply the app migrations: `ENV_FILE=.env.dev2 npm run db:migrate`. The output must say `Target project: <dev2 ref>.supabase.co`.

**Claude then writes `tenants.local.json`.** Claude generates it from `.env.local` and `.env.dev2` with a small Node script, without printing values:

```json
[
  { "slug": "dev", "hosts": ["localhost"], "supabaseUrl": "<dev url>", "anonKey": "<dev anon>", "serviceRoleKey": "<dev service>" },
  { "slug": "dev2", "hosts": ["tenant2.localhost"], "supabaseUrl": "<dev2 url>", "anonKey": "<dev2 anon>", "serviceRoleKey": "<dev2 service>" },
  { "slug": "paused", "hosts": ["paused.localhost"], "supabaseUrl": "<dev url>", "anonKey": "<dev anon>", "serviceRoleKey": "<dev service>", "status": "suspended" }
]
```

- [ ] **Step 1: Write the isolation tests** `tests/e2e/isolation.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs } from './api';

// Runs only with a local two-company registry: TENANTS_FILE=tenants.local.json npx playwright test isolation
const file = process.env.TENANTS_FILE;
test.skip(!file || !existsSync(file), 'needs TENANTS_FILE (two dev companies)');

const tenants = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { slug: string; supabaseUrl: string; serviceRoleKey: string }[]) : [];
const dev2 = tenants.find((t) => t.slug === 'dev2');
const B = 'http://tenant2.localhost:3000';
const PASSWORD = `Dev2-${Date.now()}-pw`;

test.describe('company isolation', () => {
  let dev2Email = '';
  let dev2UserId = '';

  test.beforeAll(async () => {
    const admin = createClient(dev2!.supabaseUrl, dev2!.serviceRoleKey, { auth: { persistSession: false } });
    dev2Email = `icm-dev2-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email: dev2Email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    dev2UserId = data.user!.id;
    await admin.from('profiles').update({ full_name: 'Dev2 Admin', role: 'admin', active: true }).eq('user_id', dev2UserId);
  });

  test.afterAll(async () => {
    const admin = createClient(dev2!.supabaseUrl, dev2!.serviceRoleKey, { auth: { persistSession: false } });
    if (dev2UserId) await admin.auth.admin.deleteUser(dev2UserId);
  });

  test("company A's user cannot sign in on company B", async ({ page }) => {
    await page.goto(`${B}/login`);
    await page.getByLabel('Email').fill(TEST_USERS.organizer.email);
    await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
  });

  test("A's session cookie is not accepted on B", async ({ page, context }) => {
    await login(page, TEST_USERS.organizer.email);
    const cookies = await context.cookies('http://localhost:3000');
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: B })));
    await page.goto(`${B}/`);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("data created on A never appears on B", async ({ page }) => {
    const name = uniqueName('Isolation Patient');
    const api = await apiAs(TEST_USERS.organizer.email);
    const { error } = await api.from('patients').insert({ full_name: name });
    expect(error).toBeNull();
    await page.goto(`${B}/login`);
    await page.getByLabel('Email').fill(dev2Email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.goto(`${B}/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('a browser-sent x-tenant header is ignored', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-tenant': 'dev2' });
    await login(page, TEST_USERS.organizer.email);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('an unknown host gets 404 and a suspended company 503, also for API calls', async ({ page, request }) => {
    expect((await page.goto('http://nobody.localhost:3000/login'))!.status()).toBe(404);
    const paused = await page.goto('http://paused.localhost:3000/login');
    expect(paused!.status()).toBe(503);
    await expect(page.getByRole('heading', { name: 'This site is temporarily unavailable' })).toBeVisible();
    expect((await request.post('http://paused.localhost:3000/api/activity')).status()).toBe(503);
  });
});
```

- [ ] **Step 2: Run them in two-company mode.** First make sure nothing is listening on :3000 (`Get-NetTCPConnection -LocalPort 3000`), so Playwright starts a server with the env.

Run: `TENANTS_FILE=tenants.local.json npx playwright test isolation --project=chromium`
Expected: 5 passed.

- [ ] **Step 3: Run them in single-tenant mode.** Stop that server first.

Run: `npx playwright test isolation --project=chromium`
Expected: 5 skipped.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/isolation.spec.ts
git commit -m "test(e2e): two-company isolation (sign-in, cookies, data, x-tenant, 404/503)"
```

---

### Task 12: Full regression, ship, then switch production to the control project

- [ ] **Step 1: Full checks in single-tenant mode**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`
Then the E2E suite in parts: `npx playwright test admin auth checklists courses delegates delete headers idle invite --project=chromium`, and the remaining specs similarly. Check free memory first.
Expected: all green; the isolation spec is skipped.

- [ ] **Step 2: Release 1 (owner).** Push the branch and open a PR (Claude). The **owner** merges or runs `./scripts/ship.sh ship`. Production now runs the tenant runtime in single-tenant mode. Claude checks read-only that the release is green and that the site works (log in, dashboard).

- [ ] **Step 3: Create the control project (owner).**
1. In the free org from Task 11, create the project `implant-course-control` (Frankfurt).
2. Add these to `web/.env.prod`, using `Read-Host -AsSecureString` prompts: `CONTROL_SUPABASE_URL`, `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩ and `CONTROL_DATABASE_URL` ⟨secret⟩ (session pooler). The Supabase CA is shared across projects, so `DATABASE_CA_CERT=prod-ca.crt` also covers it; otherwise set `CONTROL_DATABASE_CA_CERT`.
3. Apply the schema: `ENV_FILE=.env.prod npm run db:migrate -- --control`. The first line must be `Target project: control <control ref>.supabase.co`, followed by `Applied: 0001_control_registry.sql`.

- [ ] **Step 4: Register the academy (owner runs, Claude guides)**

Run: `ENV_FILE=.env.prod npm run tenant:register -- academy "Implant Course Academy" implant-course.vercel.app`
Expected: `Registered academy: implant-course.vercel.app`.
Then: `ENV_FILE=.env.prod npm run tenant:check -- academy` → `academy (active): OK`.

- [ ] **Step 5: Switch production (owner).** In Vercel (Production), add `CONTROL_SUPABASE_URL` and `CONTROL_SERVICE_ROLE_KEY` ⟨secret⟩, then re-run Release. Claude verifies read-only:
- the release is green;
- `https://implant-course.vercel.app/login` returns 200;
- an unknown Vercel alias of the project returns 404.

The owner signs in and checks the dashboard, an invite (Admin → Users shows "Send invite") and Reset password, which use the service key from Vault.
**Rollback:** remove the two `CONTROL_*` vars in Vercel and re-run Release. Production then goes back to single-tenant mode from the existing env vars.

- [ ] **Step 6: Update memory.** Record the control project's ref, its org, and the fact that production routes through it, in `production-environment.md`.
