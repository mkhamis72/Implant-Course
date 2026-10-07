# Multi-tenant part 3: Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One release migrates the control project and every registered company and deploys only if all succeed; every company and the control registry are backed up nightly into their own encrypted files; scripts can target one company with `--tenant <slug>`.

**Architecture:** A new `scripts/tenant-env.ts` reads companies from the control database (`public.tenants` plus Vault via `public.tenant_secret`) and turns each into the env a script needs, printing GitHub `::add-mask::` lines for secrets first. `db:migrate` gains `--tenant` and `--all-tenants`; `create-user` and `catalog-export` gain `--tenant`; a `tenants:export` command writes one shell-sourceable env file per company for the backup workflow. `release.yml` migrates control then all companies before deploying; `backup.yml` loops over the exported companies.

**Tech Stack:** Node + tsx scripts, `pg`, Vitest (unit + DB), GitHub Actions (bash, `pg_dump`, `gpg`), Supabase Vault.

**Spec:** `docs/superpowers/specs/2026-10-07-multi-tenant-3-operations-design.md`

## Global Constraints

- Run every command from `web/` (Git Bash on Windows). No Python; script with Node. Write files containing `\` with the Write/Edit tools, not heredocs or `node -e`.
- No Prettier; single quotes; 2-space indent; match the surrounding comment density.
- Never print `.env*` contents or any database URL, service key or anon key. Under `GITHUB_ACTIONS=true`, every secret value read from the control project is printed as `::add-mask::<value>` before anything else is printed.
- Every script prints `Target project: …` first. For a company: `Target project: <slug> <host>` (host of its Supabase URL).
- Companies are processed in slug order, active **and suspended**.
- `--all-tenants` stops at the first failure with a non-zero exit, and the error names the company: `Company <slug>: <message>`.
- Without `--tenant` / `--all-tenants`, every script behaves exactly as today (env file).
- Error texts exactly: `No company <slug> in the control project.`; `Company <slug> has no <name> in Vault; register it again with tenant:register.`; `Usage: --tenant <slug>`; `No companies in the control project.`
- GitHub secrets the workflows use after this change: `CONTROL_DATABASE_URL` (secret), `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY` (keep-awake of the control project), plus the existing `PROD_DATABASE_CA_CERT` (shared Supabase CA), `BACKUP_PASSPHRASE`, `VERCEL_DEPLOY_HOOK_URL`. Every secret is cleaned with the existing `clean()` helper before use.
- Backups: data only; `--schema=public --schema=app_private --schema=auth`; `--exclude-table=app_private.schema_migrations --exclude-table=auth.schema_migrations`; piped straight into `gpg --symmetric --cipher-algo AES256`; refuse to run without `BACKUP_PASSPHRASE`; files `out/<slug>-YYYY-MM-DD.dump.gpg` and `out/control-YYYY-MM-DD.dump.gpg`; one artifact `backups-<run id>`, retention 14 days.
- `scripts/workflows.test.ts` must stay green and keep pinning every existing safety property.
- App migrations (`supabase/migrations/`) and control migrations are untouched.

## Review Focus

1. **A secret printed before it is masked** (e.g. an error message containing a database URL, or a `Target project` line printed before the mask lines): `loadCompanies` reads every company and prints all mask lines before returning, so nothing about a company is printed earlier; `Target project` lines carry only slug and host; error messages never contain the URL. Tests in Task 1 (`maskLines` covers all three values; `companyLabel` is slug + host only) and Task 2 (`migrateAllTenants` error contains the slug and pg's message, not the URL).
2. **`--tenant` given without a slug, or the slug looks like another flag** (`--tenant --role admin`): refused with `Usage: --tenant <slug>`, never treated as company `--role`. Test in Task 1 (`takeTenantArg`).
3. **A company registered without one of its Vault secrets**: the run stops with the "register it again" message naming the secret, before anything is migrated or dumped. Test in Task 1 (DB test) and Task 2 (`loadCompanies` before the loop).
4. **A value containing a single quote or `$` in the exported env file** (database passwords can contain them): the file sources back to the exact value. Test in Task 4 (`envFileText` round-trip through `bash -c`).
5. **No companies registered** (empty control registry): migrate and backup fail loudly instead of "succeeding" with nothing done. Tests in Task 2 (`No companies in the control project.`) and Task 6 (backup refuses an empty export).

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/tenant-env.ts` | Control-db access (`withControl`, `listTenants`, `tenantSecrets`), company env (`tenantEnvFrom`), masking (`maskLines`), `--tenant` parsing and overlay (`takeTenantArg`, `applyTenantArg`), `loadCompanies`, `envFileText` |
| `scripts/tenant-env.test.ts` | Unit tests for the pure parts |
| `scripts/migrate-all.ts` (+ test) | `migrateAllTenants(companies, ca, run, log)` |
| `scripts/migrate-cli.ts` | `--tenant`, `--all-tenants` |
| `scripts/create-user.ts`, `scripts/catalog-export.ts` | `--tenant` |
| `scripts/tenants-export.ts` | `npm run tenants:export -- --dir <dir>` |
| `tests/db/control.test.ts` | `listTenants` / `tenantSecrets` against the control schema |
| `.github/workflows/release.yml`, `backup.yml`, `scripts/workflows.test.ts` | Workflows and their pinned safety properties |
| `docs/operations.md`, `CLAUDE.md` | Runbook and project notes |

---

### Task 1: Company resolution (`scripts/tenant-env.ts`)

**Files:**
- Create: `scripts/tenant-env.ts`, `scripts/tenant-env.test.ts`
- Modify: `tests/db/control.test.ts` (add a describe block at the end)

**Interfaces:**
- Consumes: `migrateTarget(['--control'], env)` (existing, `scripts/migrate-target.ts`) → `{ dir, config, label }`; `pgConfig` (existing).
- Produces:
  - `type Env = Record<string, string | undefined>`
  - `type TenantRow = { slug: string; name: string; status: 'active' | 'suspended'; supabase_url: string; anon_key: string }`
  - `type TenantSecrets = { serviceRoleKey: string; databaseUrl: string }`
  - `type Company = { tenant: TenantRow; secrets: TenantSecrets }`
  - `withControl<T>(env: Env, fn: (c: Client) => Promise<T>): Promise<T>`
  - `listTenants(c: Client): Promise<TenantRow[]>` (slug order, all statuses)
  - `tenantSecrets(c: Client, slug: string): Promise<TenantSecrets>`
  - `tenantEnvFrom(company: Company, caPath: string | undefined): Env` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_CA_CERT`
  - `maskLines(company: Company, env: Env): string[]`
  - `companyLabel(t: TenantRow): string` → `'<slug> <host>'`
  - `takeTenantArg(argv: string[]): { slug: string | null; rest: string[] }`
  - `loadCompanies(env: Env, log: (line: string) => void, only?: string): Promise<Company[]>` (masks every company's secrets via `log` before returning)
  - `applyTenantArg(argv: string[], env: Env, log?): Promise<{ argv: string[]; label: string | null }>` (overlays the company env onto `env`)
  - `envFileText(vars: Record<string, string>): string`

- [ ] **Step 1: Write the failing unit tests** `scripts/tenant-env.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { companyLabel, envFileText, maskLines, takeTenantArg, tenantEnvFrom, type Company } from './tenant-env';

const academy: Company = {
  tenant: { slug: 'academy', name: 'Implant Course Academy', status: 'active', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon-key' },
  secrets: { serviceRoleKey: 'svc-key', databaseUrl: 'postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres' },
};

describe('takeTenantArg', () => {
  it('takes the slug and leaves the other arguments in order', () => {
    expect(takeTenantArg(['--tenant', 'academy', 'a@b.com', 'Name', '--role', 'admin'])).toEqual({
      slug: 'academy', rest: ['a@b.com', 'Name', '--role', 'admin'],
    });
    expect(takeTenantArg(['a@b.com', '--tenant', 'academy'])).toEqual({ slug: 'academy', rest: ['a@b.com'] });
  });
  it('is a no-op without --tenant', () => {
    expect(takeTenantArg(['--control'])).toEqual({ slug: null, rest: ['--control'] });
  });
  it('refuses --tenant without a slug or followed by another flag', () => {
    expect(() => takeTenantArg(['--tenant'])).toThrow('Usage: --tenant <slug>');
    expect(() => takeTenantArg(['--tenant', '--role', 'admin'])).toThrow('Usage: --tenant <slug>');
  });
});

describe('company env', () => {
  it('maps a company to the env a script reads', () => {
    expect(tenantEnvFrom(academy, '/tmp/ca.crt')).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
      DATABASE_URL: 'postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres',
      DATABASE_CA_CERT: '/tmp/ca.crt',
    });
  });
  it('labels a company by slug and host', () => {
    expect(companyLabel(academy.tenant)).toBe('academy abcdefgh.supabase.co');
  });
});

describe('maskLines', () => {
  it('masks every secret value under GitHub Actions only', () => {
    expect(maskLines(academy, { GITHUB_ACTIONS: 'true' })).toEqual([
      '::add-mask::svc-key',
      '::add-mask::postgresql://postgres.abcdefgh:pw@pooler.example:5432/postgres',
      '::add-mask::anon-key',
    ]);
    expect(maskLines(academy, {})).toEqual([]);
  });
});

describe('envFileText', () => {
  it('writes one single-quoted assignment per line', () => {
    expect(envFileText({ SLUG: 'academy', DATABASE_URL: "postgres://u:p'w$x@h/db" })).toBe(
      "SLUG='academy'\nDATABASE_URL='postgres://u:p'\\''w$x@h/db'\n",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- scripts/tenant-env`
Expected: FAIL, "Failed to resolve import './tenant-env'".

- [ ] **Step 3: Implement** `scripts/tenant-env.ts`

```ts
import { Client } from 'pg';
import { migrateTarget } from './migrate-target';

/**
 * Companies as the operations scripts see them: rows of the control project's `tenants` table plus their
 * Vault secrets, turned into the env a script reads. Under GitHub Actions every secret is masked first.
 */
export type Env = Record<string, string | undefined>;
export type TenantRow = { slug: string; name: string; status: 'active' | 'suspended'; supabase_url: string; anon_key: string };
export type TenantSecrets = { serviceRoleKey: string; databaseUrl: string };
export type Company = { tenant: TenantRow; secrets: TenantSecrets };

export async function withControl<T>(env: Env, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(migrateTarget(['--control'], env).config);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function listTenants(c: Client): Promise<TenantRow[]> {
  const { rows } = await c.query<TenantRow>('select slug, name, status, supabase_url, anon_key from public.tenants order by slug');
  return rows;
}

export async function tenantSecrets(c: Client, slug: string): Promise<TenantSecrets> {
  const read = async (name: 'service_role_key' | 'database_url') => {
    const { rows } = await c.query<{ value: string | null }>('select public.tenant_secret($1, $2) as value', [slug, name]);
    if (!rows[0]?.value) throw new Error(`Company ${slug} has no ${name} in Vault; register it again with tenant:register.`);
    return rows[0].value;
  };
  return { serviceRoleKey: await read('service_role_key'), databaseUrl: await read('database_url') };
}

export function tenantEnvFrom({ tenant, secrets }: Company, caPath: string | undefined): Env {
  return {
    NEXT_PUBLIC_SUPABASE_URL: tenant.supabase_url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: tenant.anon_key,
    SUPABASE_SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    DATABASE_URL: secrets.databaseUrl,
    DATABASE_CA_CERT: caPath,
  };
}

export function maskLines({ tenant, secrets }: Company, env: Env): string[] {
  if (env.GITHUB_ACTIONS !== 'true') return [];
  return [secrets.serviceRoleKey, secrets.databaseUrl, tenant.anon_key].map((v) => `::add-mask::${v}`);
}

export function companyLabel(t: TenantRow): string {
  return `${t.slug} ${new URL(t.supabase_url).host}`;
}

export function takeTenantArg(argv: string[]): { slug: string | null; rest: string[] } {
  const i = argv.indexOf('--tenant');
  if (i === -1) return { slug: null, rest: argv };
  const slug = argv[i + 1];
  if (!slug || slug.startsWith('--')) throw new Error('Usage: --tenant <slug>');
  return { slug, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

/** Every company (or just `only`), secrets read and masked before anything else is printed. */
export async function loadCompanies(env: Env, log: (line: string) => void, only?: string): Promise<Company[]> {
  const companies = await withControl(env, async (c) => {
    const tenants = (await listTenants(c)).filter((t) => !only || t.slug === only);
    if (only && !tenants.length) throw new Error(`No company ${only} in the control project.`);
    const out: Company[] = [];
    for (const tenant of tenants) out.push({ tenant, secrets: await tenantSecrets(c, tenant.slug) });
    return out;
  });
  for (const company of companies) for (const line of maskLines(company, env)) log(line);
  return companies;
}

/** `--tenant <slug>`: point this script at that company by overlaying its env; the label is for "Target project". */
export async function applyTenantArg(
  argv: string[],
  env: Env,
  log: (line: string) => void = console.log,
): Promise<{ argv: string[]; label: string | null }> {
  const { slug, rest } = takeTenantArg(argv);
  if (!slug) return { argv, label: null };
  const [company] = await loadCompanies(env, log, slug);
  Object.assign(env, tenantEnvFrom(company, env.CONTROL_DATABASE_CA_CERT ?? env.DATABASE_CA_CERT));
  return { argv: rest, label: companyLabel(company.tenant) };
}

/** A file `source`-able by bash: each value single-quoted, embedded quotes as '\''. */
export function envFileText(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}='${v.replaceAll("'", "'\\''")}'\n`).join('');
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test -- scripts/tenant-env`
Expected: PASS.

- [ ] **Step 5: Add the failing DB tests** at the end of `tests/db/control.test.ts` (it already has `withControl` for the rolled-back control schema — note: that helper shadows the script's name; import the script's functions only):

```ts
import { listTenants, tenantSecrets } from '../../scripts/tenant-env';

describe('operations: reading companies from the control project', () => {
  it('lists every company, suspended ones too, in slug order', async () => {
    await withControl(async (c) => {
      await registerTenant(c, { ...academy, slug: 'zz-b', hosts: ['b.example.com'] });
      await registerTenant(c, { ...academy, slug: 'zz-a', hosts: ['a.example.com'] });
      await c.query(`update public.tenants set status = 'suspended' where slug = 'zz-b'`);
      const mine = (await listTenants(c)).filter((t) => t.slug.startsWith('zz-'));
      expect(mine.map((t) => [t.slug, t.status])).toEqual([['zz-a', 'active'], ['zz-b', 'suspended']]);
      expect(mine[0]).toMatchObject({ supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' });
    });
  });

  it('reads both Vault secrets, and names a missing one', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      expect(await tenantSecrets(c, 'zz-academy')).toEqual({ serviceRoleKey: 'svc-secret', databaseUrl: 'postgres://secret' });
      await c.query(`delete from vault.secrets where name = 'tenant/zz-academy/database_url'`);
      await expect(tenantSecrets(c, 'zz-academy')).rejects.toThrow(
        'Company zz-academy has no database_url in Vault; register it again with tenant:register.',
      );
    });
  });
});
```

Put the `import` line with the file's other imports at the top (not mid-file).

- [ ] **Step 6: Run the DB tests**

Run: `npm run test:db -- control`
Expected: PASS (all control tests, including the two new ones). If deleting from `vault.secrets` is refused for the test role, delete via `asPostgres(c)` first (the file already imports it) and say so in the report.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add scripts/tenant-env.ts scripts/tenant-env.test.ts tests/db/control.test.ts
git commit -m "feat(ops): read companies and their secrets from the control project"
```

---

### Task 2: `db:migrate -- --tenant` and `--all-tenants`

**Files:**
- Create: `scripts/migrate-all.ts`, `scripts/migrate-all.test.ts`
- Modify: `scripts/migrate-cli.ts`

**Interfaces:**
- Consumes: `Company`, `tenantEnvFrom`, `companyLabel`, `loadCompanies`, `applyTenantArg`, `Env` (Task 1); `migrate(dir, config)` (existing, returns applied file names); `migrateTarget(argv, env)`; `pgConfig(env)`.
- Produces: `migrateAllTenants(companies: Company[], caPath: string | undefined, run: (dir: string, config: ClientConfig) => Promise<string[]>, log: (line: string) => void): Promise<void>`; CLI flags `--tenant <slug>`, `--all-tenants`.

- [ ] **Step 1: Write the failing test** `scripts/migrate-all.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { migrateAllTenants } from './migrate-all';
import type { Company } from './tenant-env';

const company = (slug: string): Company => ({
  tenant: { slug, name: slug, status: 'active', supabase_url: `https://${slug}ref.supabase.co`, anon_key: 'anon' },
  secrets: { serviceRoleKey: 'svc', databaseUrl: `postgresql://postgres.${slug}:pw@127.0.0.1:5432/postgres` },
});

describe('migrateAllTenants', () => {
  it('migrates every company in the given order, printing its target first', async () => {
    const log: string[] = [];
    const run = vi.fn().mockResolvedValueOnce(['0041_x.sql']).mockResolvedValueOnce([]);
    await migrateAllTenants([company('aa'), company('bb')], undefined, run, (l) => log.push(l));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toMatchObject({ connectionString: 'postgresql://postgres.aa:pw@127.0.0.1:5432/postgres' });
    expect(log).toEqual([
      'Target project: aa aaref.supabase.co', 'Applied: 0041_x.sql',
      'Target project: bb bbref.supabase.co', 'Database is up to date.',
    ]);
  });

  it('stops at the first failure, naming the company and never the database URL', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Migration 0041_x.sql failed: boom')).mockResolvedValue([]);
    const err = await migrateAllTenants([company('aa'), company('bb')], undefined, run, () => {}).catch((e: Error) => e);
    expect((err as Error).message).toBe('Company aa: Migration 0041_x.sql failed: boom');
    expect((err as Error).message).not.toContain('postgresql://');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty registry', async () => {
    await expect(migrateAllTenants([], undefined, vi.fn(), () => {})).rejects.toThrow('No companies in the control project.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- scripts/migrate-all`
Expected: FAIL ("Failed to resolve import './migrate-all'").

- [ ] **Step 3: Implement** `scripts/migrate-all.ts`

```ts
import path from 'node:path';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { companyLabel, tenantEnvFrom, type Company } from './tenant-env';

/** Applies the app migrations to every company in turn; the first failure stops the run (nothing is deployed). */
export async function migrateAllTenants(
  companies: Company[],
  caPath: string | undefined,
  run: (dir: string, config: ClientConfig) => Promise<string[]>,
  log: (line: string) => void,
): Promise<void> {
  if (!companies.length) throw new Error('No companies in the control project.');
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  for (const company of companies) {
    log(`Target project: ${companyLabel(company.tenant)}`);
    let applied: string[];
    try {
      applied = await run(dir, pgConfig(tenantEnvFrom(company, caPath)));
    } catch (error) {
      throw new Error(`Company ${company.tenant.slug}: ${(error as Error).message}`);
    }
    log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  }
}
```

(`pgConfig` returns `ssl: false` for 127.0.0.1 URLs, so the test needs no CA.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- scripts/migrate-all`
Expected: PASS.

- [ ] **Step 5: Wire the flags into** `scripts/migrate-cli.ts` (replace the whole file):

```ts
import './load-env';
import { migrate } from './migrate';
import { migrateTarget } from './migrate-target';
import { migrateAllTenants } from './migrate-all';
import { applyTenantArg, loadCompanies } from './tenant-env';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--all-tenants')) {
    const companies = await loadCompanies(process.env, console.log);
    await migrateAllTenants(companies, process.env.CONTROL_DATABASE_CA_CERT ?? process.env.DATABASE_CA_CERT, migrate, console.log);
    return;
  }
  const { argv: rest, label } = await applyTenantArg(argv, process.env);
  const target = migrateTarget(rest, process.env);
  // Printed first so a migration against the wrong project (e.g. a leftover ENV_FILE) is visible.
  console.log(`Target project: ${label ?? target.label}`);
  const applied = await migrate(target.dir, target.config);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 6: Check today's behaviour is unchanged**

Run: `npm run db:migrate`
Expected: first line `Target project: 127.0.0.1:54321`, then `Database is up to date.`
Run: `npm run db:migrate -- --tenant`
Expected: `Usage: --tenant <slug>` and exit code 1.

- [ ] **Step 7: Typecheck, lint, full unit tests, commit**

Run: `npx tsc --noEmit && npm run lint && npm test`

```bash
git add scripts/migrate-all.ts scripts/migrate-all.test.ts scripts/migrate-cli.ts
git commit -m "feat(ops): db:migrate --tenant <slug> and --all-tenants"
```

---

### Task 3: `--tenant` for `create-user` and `catalog-export`

**Files:**
- Modify: `scripts/create-user.ts`, `scripts/catalog-export.ts`
- Test: `scripts/create-user-args.test.ts` (add one case)

**Interfaces:**
- Consumes: `applyTenantArg(argv, env)` (Task 1); `parseCreateUserArgs`, `targetLabel` (existing).

- [ ] **Step 1: Write the failing test** — add to `scripts/create-user-args.test.ts` (inside its existing `describe`):

```ts
  it('parses the arguments left after --tenant is taken out', () => {
    const { rest } = takeTenantArg(['--tenant', 'academy', 'a@b.com', 'Some Name', '--role', 'admin']);
    expect(parseCreateUserArgs(rest)).toMatchObject({ email: 'a@b.com', fullName: 'Some Name', role: 'admin' });
  });
```

with `import { takeTenantArg } from './tenant-env';` at the top. (Check the existing test file for the exact shape `parseCreateUserArgs` returns and adapt the `toMatchObject` keys if they differ — keep the assertion that email, name and role survive.)

- [ ] **Step 2: Run it**

Run: `npm test -- create-user-args`
Expected: PASS already (the parser is unchanged and `takeTenantArg` exists from Task 1) — this pins the contract the script relies on. If it fails, the parser rejects leftover flags; fix the script integration accordingly.

- [ ] **Step 3: Use it in** `scripts/create-user.ts`: replace the first lines of `main()` with

```ts
async function main() {
  const { argv, label } = await applyTenantArg(process.argv.slice(2), process.env);
  const args = parseCreateUserArgs(argv);
  if ('error' in args) {
    console.error(args.error);
    process.exit(1);
  }
  console.log(`Target project: ${label ?? targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
```

and add `import { applyTenantArg } from './tenant-env';`. Note `adminClient()` and `pgConfig()` read `process.env`, which `applyTenantArg` has overlaid, so the rest of the script needs no change. Check `adminClient()` in `scripts/users.ts` reads the env at call time (not at import); if it reads at import, move that read into the function.

- [ ] **Step 4: Use it in** `scripts/catalog-export.ts`: at the start of `main()`:

```ts
  const { label } = await applyTenantArg(process.argv.slice(2), process.env);
  console.log(`Target project: ${label ?? targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
```

(replacing the existing `console.log` line) and add the import.

- [ ] **Step 5: Check today's behaviour is unchanged**

Run: `npm run catalog-export` → first line `Target project: 127.0.0.1:54321`, writes `catalog-<date>.csv`; delete that CSV afterwards (don't commit it).
Run: `npm run create-user -- --tenant` → `Usage: --tenant <slug>`, exit 1.

- [ ] **Step 6: Typecheck, lint, tests, commit**

Run: `npx tsc --noEmit && npm run lint && npm test`

```bash
git add scripts/create-user.ts scripts/catalog-export.ts scripts/create-user-args.test.ts
git commit -m "feat(ops): create-user and catalog-export take --tenant <slug>"
```

---

### Task 4: `npm run tenants:export` (env files for the backup workflow)

**Files:**
- Create: `scripts/tenants-export.ts`, `scripts/tenants-export.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `loadCompanies`, `envFileText`, `Company` (Task 1).
- Produces: `exportFiles(companies: Company[]): { file: string; text: string }[]` (file = `<slug>.env`; keys `SLUG`, `DATABASE_URL`, `SUPABASE_URL`, `ANON_KEY`); CLI `npm run tenants:export -- --dir <dir>`.

- [ ] **Step 1: Write the failing test** `scripts/tenants-export.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportFiles } from './tenants-export';
import type { Company } from './tenant-env';

const tricky: Company = {
  tenant: { slug: 'academy', name: 'A', status: 'suspended', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' },
  secrets: { serviceRoleKey: 'svc', databaseUrl: "postgresql://postgres.abcdefgh:p'a$s`w\"d@pooler:5432/postgres" },
};

describe('exportFiles', () => {
  it('writes one file per company with exactly the four variables the backup needs', () => {
    const [f] = exportFiles([tricky]);
    expect(f.file).toBe('academy.env');
    expect(f.text.split('\n').filter(Boolean).map((l) => l.split('=')[0])).toEqual(['SLUG', 'DATABASE_URL', 'SUPABASE_URL', 'ANON_KEY']);
    expect(f.text).not.toContain('svc');
  });

  it('sources back to the exact values in bash, quotes and $ included', () => {
    const [f] = exportFiles([tricky]);
    const dir = mkdtempSync(path.join(tmpdir(), 'tenants-'));
    writeFileSync(path.join(dir, f.file), f.text);
    const out = execFileSync('bash', ['-c', `source "${path.join(dir, f.file).replaceAll('\\', '/')}" && printf '%s' "$DATABASE_URL"`]).toString();
    expect(out).toBe(tricky.secrets.databaseUrl);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tenants-export`
Expected: FAIL ("Failed to resolve import './tenants-export'").

- [ ] **Step 3: Implement** `scripts/tenants-export.ts`

```ts
import './load-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { envFileText, loadCompanies, type Company } from './tenant-env';
import { migrateTarget } from './migrate-target';

/**
 * For the backup workflow: one bash-sourceable file per company in --dir (mode 600, runner temp only,
 * never uploaded). Holds only what a dump and the keep-awake ping need; no service keys.
 */
export function exportFiles(companies: Company[]): { file: string; text: string }[] {
  return companies.map(({ tenant, secrets }) => ({
    file: `${tenant.slug}.env`,
    text: envFileText({ SLUG: tenant.slug, DATABASE_URL: secrets.databaseUrl, SUPABASE_URL: tenant.supabase_url, ANON_KEY: tenant.anon_key }),
  }));
}

async function main() {
  const i = process.argv.indexOf('--dir');
  const dir = i > -1 ? process.argv[i + 1] : undefined;
  if (!dir) throw new Error('Usage: npm run tenants:export -- --dir <directory>');
  console.log(`Target project: ${migrateTarget(['--control'], process.env).label}`);
  const companies = await loadCompanies(process.env, console.log);
  if (!companies.length) throw new Error('No companies in the control project.');
  mkdirSync(dir, { recursive: true });
  for (const f of exportFiles(companies)) writeFileSync(path.join(dir, f.file), f.text, { mode: 0o600 });
  console.log(`Exported ${companies.length} companies: ${companies.map((c) => c.tenant.slug).join(', ')}`);
}

if (process.argv[1]?.endsWith('tenants-export.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
```

Note: `loadCompanies` prints the mask lines before `Exported …`, and the `Target project` line contains only the control host. Because `migrateTarget` is called before masks are printed, make sure its label never contains a secret (it's the host of `CONTROL_SUPABASE_URL` — safe).

- [ ] **Step 4: Add the npm script** in `package.json` next to `tenant:check`:

```json
    "tenants:export": "tsx scripts/tenants-export.ts",
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tenants-export`
Expected: PASS (Git Bash provides `bash` on Windows; CI is Linux).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add scripts/tenants-export.ts scripts/tenants-export.test.ts package.json
git commit -m "feat(ops): tenants:export writes one env file per company for backups"
```

---

### Task 5: Release migrates the control project and every company

**Files:**
- Modify: `.github/workflows/release.yml` (the "Migrate production" step), `scripts/workflows.test.ts` (release tests)

**Interfaces:**
- Consumes: `npm run db:migrate -- --control` (existing), `npm run db:migrate -- --all-tenants` (Task 2).

- [ ] **Step 1: Update the tests first** in `scripts/workflows.test.ts`.
  In `describe('release.yml')` add:

```ts
  it('migrates the control project, then every company, then deploys', () => {
    const run = runOf(deploy, 'Migrate');
    const control = run.indexOf('npm run db:migrate -- --control');
    const all = run.indexOf('npm run db:migrate -- --all-tenants');
    expect(control).toBeGreaterThan(-1);
    expect(all).toBeGreaterThan(control);
    expect(run).not.toContain('PROD_DATABASE_URL');
    expect(run.indexOf('CONTROL_DATABASE_URL secret is missing')).toBeLessThan(control);
    expect(run).toContain('set -euo pipefail');
  });
```

  In `describe('secrets are cleaned of stray line endings before use')`, change the release test to:

```ts
  it('release: control database URL, CA certificate and deploy hook', () => {
    expect(cleans(runOf(release, 'Migrate'), 'CONTROL_DATABASE_URL')).toBe(true);
    expect(cleans(runOf(release, 'Migrate'), 'PROD_DATABASE_CA_CERT')).toBe(true);
    expect(cleans(runOf(release, 'Deploy'), 'HOOK')).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- workflows`
Expected: FAIL (the step still migrates `PROD_DATABASE_URL`).

- [ ] **Step 3: Replace the migrate step** in `.github/workflows/release.yml` (the whole `- name: Migrate production (verified TLS)` step) with:

```yaml
      - name: Migrate the control project, then every company (verified TLS)
        env:
          CONTROL_DATABASE_URL: ${{ secrets.CONTROL_DATABASE_URL }}
          CONTROL_SUPABASE_URL: ${{ secrets.CONTROL_SUPABASE_URL }}
          PROD_DATABASE_CA_CERT: ${{ secrets.PROD_DATABASE_CA_CERT }}
        run: |
          set -euo pipefail
          clean() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          CONTROL_DATABASE_URL="$(clean "$CONTROL_DATABASE_URL")"
          CONTROL_SUPABASE_URL="$(clean "$CONTROL_SUPABASE_URL")"
          PROD_DATABASE_CA_CERT="$(clean "$PROD_DATABASE_CA_CERT")"
          test -n "$CONTROL_DATABASE_URL" || { echo "CONTROL_DATABASE_URL secret is missing"; exit 1; }
          test -n "$PROD_DATABASE_CA_CERT" || { echo "PROD_DATABASE_CA_CERT secret is missing"; exit 1; }
          # The Supabase CA is shared by every project: it verifies the control project and each company.
          printf '%s\n' "$PROD_DATABASE_CA_CERT" > "$RUNNER_TEMP/prod-ca.crt"
          export CONTROL_DATABASE_URL CONTROL_SUPABASE_URL DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt"
          npm run db:migrate -- --control
          # Stops at the first company that fails; the deploy below then never runs.
          npm run db:migrate -- --all-tenants
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- workflows`
Expected: PASS (new test and every existing release test, e.g. "Migrate" before "Deploy").

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml scripts/workflows.test.ts
git commit -m "ci(release): migrate the control project and every company before deploying"
```

---

### Task 6: Nightly backup and verify for every company

**Files:**
- Modify: `.github/workflows/backup.yml` (backup and verify jobs), `scripts/workflows.test.ts` (backup tests)

**Interfaces:**
- Consumes: `npm run tenants:export -- --dir <dir>` (Task 4) producing `<slug>.env` files with `SLUG`, `DATABASE_URL`, `SUPABASE_URL`, `ANON_KEY`.

- [ ] **Step 1: Update the tests first** in `scripts/workflows.test.ts`. Replace the backup parts of `describe('secrets are cleaned…')` and `describe('backup.yml')` with:

```ts
  it('backup and verify: passphrase, control database URL, CA certificate and control keep-awake keys', () => {
    const dump = runOf(backup.backup, 'Dump');
    for (const n of ['PASSPHRASE', 'CONTROL_DATABASE_URL', 'CA']) expect(cleans(dump, n)).toBe(true);
    for (const n of ['CONTROL_DATABASE_URL', 'CA']) expect(cleans(runOf(backup.backup, 'Export'), n)).toBe(true);
    for (const n of ['CONTROL_SUPABASE_URL', 'CONTROL_ANON_KEY']) expect(cleans(runOf(backup.backup, 'Keep'), n)).toBe(true);
    expect(cleans(runOf(backup.verify, 'Decrypt'), 'PASSPHRASE')).toBe(true);
  });
```

```ts
describe('backup.yml', () => {
  const { jobs } = load('backup.yml');
  const dump = runOf(jobs.backup, 'Dump');

  it('refuses to run without the passphrase, before dumping anything', () => {
    expect(dump.indexOf('BACKUP_PASSPHRASE secret is missing')).toBeGreaterThan(-1);
    expect(dump.indexOf('BACKUP_PASSPHRASE secret is missing')).toBeLessThan(dump.indexOf('pg_dump'));
  });
  it('dumps the data a restore needs for each company: app tables and sign-in accounts, without migration bookkeeping', () => {
    expect(dump).toContain('--data-only');
    expect(dump).toContain('--schema=auth');
    expect(dump).toContain('--exclude-table=app_private.schema_migrations');
    expect(dump).toContain('--exclude-table=auth.schema_migrations');
    expect(dump).toContain('out/$SLUG-$day.dump.gpg');
  });
  it('encrypts every dump on the way out (the plain dump never touches disk)', () => {
    expect(dump).toMatch(/encrypt\(\) \{ gpg [^}]*--symmetric --cipher-algo AES256/);
    expect(dump.match(/\| encrypt /g)?.length).toBe(2);
    expect(dump).not.toMatch(/pg_dump[^\n]*> /);
  });
  it('backs up every exported company, refusing an empty export', () => {
    expect(runOf(jobs.backup, 'Export')).toContain('npm run tenants:export -- --dir "$RUNNER_TEMP/tenants"');
    expect(dump).toContain('No companies were exported');
  });
  it('keeps going past a failed company but fails the run at the end, naming it', () => {
    expect(dump).toContain('failed+=');
    expect(runOf(jobs.backup, 'Fail')).toContain('exit 1');
  });
  it('backs up only the registry from the control project', () => {
    expect(dump).toContain('--table=public.tenants --table=public.tenant_audit');
    expect(dump).toContain('out/control-$day.dump.gpg');
  });
  it('uploads one artifact per night', () => {
    const upload = jobs.backup.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with).toMatchObject({ name: 'backups-${{ github.run_id }}', path: 'web/out/*.dump.gpg', 'retention-days': 14 });
  });
  it('uses the newest PostgreSQL client, never a pinned older one', () => {
    for (const job of Object.values(jobs)) expect(JSON.stringify(job)).not.toContain('postgresql/17');
  });
  it('keeps every company and the control project awake with an endpoint the anon key may call', () => {
    const keep = runOf(jobs.backup, 'Keep');
    expect(keep).toContain('/auth/v1/health');
    expect(keep).toContain('"$RUNNER_TEMP"/tenants/*.env');
    expect(keep).toContain('CONTROL_SUPABASE_URL');
  });
  it('verify mode checks every file: companies have patients and sign-in accounts, control has tenants', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    expect(verify).toContain('TABLE DATA public patients');
    expect(verify).toContain('TABLE DATA auth users');
    expect(verify).toContain('TABLE DATA public tenants');
    expect(verify).toContain('for f in in/*.dump.gpg');
    expect(runOf(jobs.verify, 'Download')).toContain('startswith("backups-")');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- workflows`
Expected: FAIL (backup.yml still dumps one database).

- [ ] **Step 3: Rewrite the backup job** in `.github/workflows/backup.yml`. Keep the file header, triggers, permissions and the comment block; replace `jobs.backup` with:

```yaml
  backup:
    if: github.event_name == 'schedule' || inputs.mode == 'backup'
    runs-on: ubuntu-latest
    environment: production
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - name: Install the newest PostgreSQL client (a newer pg_dump can read any older server)
        run: |
          set -euo pipefail
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client
          echo "PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)" >> "$GITHUB_ENV"
      - name: Export the companies from the control project (secrets masked)
        env:
          CONTROL_DATABASE_URL: ${{ secrets.CONTROL_DATABASE_URL }}
          CONTROL_SUPABASE_URL: ${{ secrets.CONTROL_SUPABASE_URL }}
          CA: ${{ secrets.PROD_DATABASE_CA_CERT }}
        run: |
          set -euo pipefail
          clean() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          CONTROL_DATABASE_URL="$(clean "$CONTROL_DATABASE_URL")"
          CONTROL_SUPABASE_URL="$(clean "$CONTROL_SUPABASE_URL")"
          CA="$(clean "$CA")"
          test -n "$CONTROL_DATABASE_URL" && test -n "$CA" || { echo "Control database secrets are missing"; exit 1; }
          printf '%s\n' "$CA" > "$RUNNER_TEMP/ca.crt"
          CONTROL_DATABASE_URL="$CONTROL_DATABASE_URL" CONTROL_SUPABASE_URL="$CONTROL_SUPABASE_URL" \
            DATABASE_CA_CERT="$RUNNER_TEMP/ca.crt" npm run tenants:export -- --dir "$RUNNER_TEMP/tenants"
      - name: Dump and encrypt each company and the control registry (the plain dump never touches disk)
        env:
          CONTROL_DATABASE_URL: ${{ secrets.CONTROL_DATABASE_URL }}
          CA: ${{ secrets.PROD_DATABASE_CA_CERT }}
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          clean() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          PASSPHRASE="$(clean "$PASSPHRASE")"
          CONTROL_DATABASE_URL="$(clean "$CONTROL_DATABASE_URL")"
          CA="$(clean "$CA")"
          test -n "$PASSPHRASE" || { echo "BACKUP_PASSPHRASE secret is missing: refusing to back up unencrypted"; exit 1; }
          test -n "$CONTROL_DATABASE_URL" && test -n "$CA" || { echo "Database secrets are missing"; exit 1; }
          printf '%s\n' "$CA" > "$RUNNER_TEMP/ca.crt"
          export PGSSLMODE=verify-full PGSSLROOTCERT="$RUNNER_TEMP/ca.crt"
          encrypt() { gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 3 3<<<"$PASSPHRASE" --output "$1"; }
          shopt -s nullglob
          files=("$RUNNER_TEMP"/tenants/*.env)
          [ ${#files[@]} -gt 0 ] || { echo "No companies were exported"; exit 1; }
          mkdir -p out
          day=$(date -u +%F)
          failed=()
          for f in "${files[@]}"; do
            slug=$(basename "$f" .env)
            # A failed company is recorded and the others are still backed up; the run fails at the end.
            if ! ( set -euo pipefail; source "$f"
                   "$PG_BIN/pg_dump" --data-only --format=custom --no-owner \
                     --schema=public --schema=app_private --schema=auth \
                     --exclude-table=app_private.schema_migrations --exclude-table=auth.schema_migrations \
                     "$DATABASE_URL" \
                     | encrypt "out/$SLUG-$day.dump.gpg" ); then
              rm -f "out/$slug-$day.dump.gpg"
              failed+=("$slug")
            fi
          done
          if ! "$PG_BIN/pg_dump" --data-only --format=custom --no-owner --table=public.tenants --table=public.tenant_audit \
                 "$CONTROL_DATABASE_URL" \
                 | encrypt "out/control-$day.dump.gpg"; then
            rm -f "out/control-$day.dump.gpg"
            failed+=(control)
          fi
          ls -l out
          printf '%s\n' "${failed[@]}" > "$RUNNER_TEMP/failed.txt"
      - uses: actions/upload-artifact@v7
        with:
          name: backups-${{ github.run_id }}
          path: web/out/*.dump.gpg
          retention-days: 14
          if-no-files-found: error
      - name: Keep every company and the control project awake (auth health check)
        env:
          CONTROL_SUPABASE_URL: ${{ secrets.CONTROL_SUPABASE_URL }}
          CONTROL_ANON_KEY: ${{ secrets.CONTROL_ANON_KEY }}
        run: |
          set -euo pipefail
          clean() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          CONTROL_SUPABASE_URL="$(clean "$CONTROL_SUPABASE_URL")"
          CONTROL_ANON_KEY="$(clean "$CONTROL_ANON_KEY")"
          for f in "$RUNNER_TEMP"/tenants/*.env; do
            ( source "$f"; curl --fail --silent --show-error "$SUPABASE_URL/auth/v1/health" -H "apikey: $ANON_KEY" -o /dev/null )
          done
          test -n "$CONTROL_SUPABASE_URL" && test -n "$CONTROL_ANON_KEY" || { echo "CONTROL_SUPABASE_URL / CONTROL_ANON_KEY secrets are missing"; exit 1; }
          curl --fail --silent --show-error "$CONTROL_SUPABASE_URL/auth/v1/health" -H "apikey: $CONTROL_ANON_KEY" -o /dev/null
      - name: Fail if any backup failed
        run: |
          failed=$(grep -v '^$' "$RUNNER_TEMP/failed.txt" || true)
          if [ -n "$failed" ]; then echo "Backup failed for: $(echo $failed)"; exit 1; fi
          echo "Every company and the control registry were backed up."
```

Notes for the implementer: the upload-artifact `path` is relative to the repo root (it ignores `working-directory`), hence `web/out/*.dump.gpg`. The keep-awake step runs even if a company's dump failed (the fail step is last).

- [ ] **Step 4: Rewrite the verify job's download and decrypt steps** (keep its PostgreSQL client step):

```yaml
      - name: Download the latest backup
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          # backups-* since part 3; prod-backup-* is the older single-company name (kept 14 days).
          latest=$(gh api "repos/${{ github.repository }}/actions/artifacts?per_page=100" \
            --jq '[.artifacts[] | select((.name | startswith("backups-")) or (.name | startswith("prod-backup-"))) | select(.expired == false)] | sort_by(.created_at) | last | "\(.workflow_run.id) \(.name)"')
          read -r run_id name <<<"$latest"
          test -n "${name:-}" && test "$name" != "null" || { echo "No backup artifact found"; exit 1; }
          echo "Verifying $name"
          gh run download "$run_id" --repo "${{ github.repository }}" --name "$name" --dir in
      - name: Decrypt and list every file (fails if one is unreadable or missing patients, accounts or companies)
        env:
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          clean() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
          PASSPHRASE="$(clean "$PASSPHRASE")"
          bad=()
          for f in in/*.dump.gpg; do
            name=$(basename "$f" .dump.gpg)
            if ! gpg --batch --pinentry-mode loopback --decrypt --passphrase-fd 3 3<<<"$PASSPHRASE" "$f" > "$RUNNER_TEMP/check.dump" \
               || ! "$PG_BIN/pg_restore" --list "$RUNNER_TEMP/check.dump" > "$RUNNER_TEMP/list.txt"; then
              bad+=("$name: unreadable"); continue
            fi
            echo "$name: $(grep -c 'TABLE DATA' "$RUNNER_TEMP/list.txt") tables with data"
            case "$name" in
              control-*) grep -q "TABLE DATA public tenants" "$RUNNER_TEMP/list.txt" || bad+=("$name: companies missing") ;;
              *) grep -q "TABLE DATA public patients" "$RUNNER_TEMP/list.txt" || bad+=("$name: patients missing")
                 grep -q "TABLE DATA auth users" "$RUNNER_TEMP/list.txt" || bad+=("$name: sign-in accounts missing") ;;
            esac
          done
          rm -f "$RUNNER_TEMP/check.dump"
          if [ ${#bad[@]} -gt 0 ]; then printf 'Backup problem: %s\n' "${bad[@]}"; exit 1; fi
          echo "Every backup is readable and complete."
```

- [ ] **Step 5: Check the YAML parses and the tests pass**

Run: `npm test -- workflows`
Expected: PASS. Also run `npx tsx -e "require('yaml').parse(require('fs').readFileSync('../.github/workflows/backup.yml','utf8'));console.log('ok')"` (or rely on the test's `load`, which parses it).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/backup.yml scripts/workflows.test.ts
git commit -m "ci(backup): back up and verify every company and the control registry"
```

---

### Task 7: Runbook, project notes and full verification

**Files:**
- Modify: `docs/operations.md` (§C Releases, §D Backups and restore, §G Control project), `CLAUDE.md` (Commands block, Production section)

- [ ] **Step 1: Update** `docs/operations.md`:
  - **§C Releases:** add a sentence: "A release migrates the control project (`db:migrate -- --control`), then every registered company in slug order (`db:migrate -- --all-tenants`, suspended ones too), and deploys only if all succeeded. A failure stops the run before the deploy and names the company; fix it and re-run Release (companies already migrated are skipped as up to date)."
  - **§D Backups and restore:** replace the first bullet list and the restore steps with per-company wording:
    - Backup runs nightly and writes one encrypted file per company, `<slug>-<date>.dump.gpg`, plus `control-<date>.dump.gpg` (the company registry only), in the artifact `backups-*`, kept 14 days. A failure for one company doesn't stop the others; the run turns red and names it.
    - Monthly verify: Actions → Backup → mode `verify` → "Every backup is readable and complete."
    - **Restore one company** (others are untouched): 1. download the newest `backups-*` artifact and decrypt `<slug>-<date>.dump.gpg`; 2. create a fresh Supabase project (Frankfurt, §A.1 auth settings); 3. re-register the company with the new project's URL, keys and database URL: `ENV_FILE=.env.prod npm run tenant:register -- <slug> "<Name>" <hosts…>` with the new values in the env file it reads; 4. `ENV_FILE=.env.prod npm run db:migrate -- --tenant <slug>` (check out the backup's commit first if it's older than the newest migrations, as before); 5. `pg_restore --data-only --no-owner -f data.sql <slug>.dump`; 6. load with the existing `psql … TRUNCATE public.settings, public.products, public.branding CASCADE … -f data.sql` command against the new project; 7. `ENV_FILE=.env.prod npm run tenant:check -- <slug>`. Sign-in accounts come back with the data.
    - **Restore the control project:** create a fresh project; `ENV_FILE=.env.prod npm run db:migrate -- --control` (with `CONTROL_*` pointing at it); load `control-<date>.dump` the same way (no TRUNCATE needed); re-run `tenant:register` for every company (Vault secrets aren't in the backup); update `CONTROL_SUPABASE_URL`/`CONTROL_SERVICE_ROLE_KEY` in Vercel and `CONTROL_DATABASE_URL`/`CONTROL_SUPABASE_URL`/`CONTROL_ANON_KEY` in GitHub; re-run Release.
  - **§G Control project:** add "GitHub secrets (production environment): `CONTROL_DATABASE_URL` ⟨secret⟩ (session pooler URI of the control project), `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY`. Release and Backup read every company from the control project with them; `PROD_DATABASE_URL` is no longer used by either and can be deleted after a restore rehearsal." and "Scripts take `--tenant <slug>`: `ENV_FILE=.env.prod npm run create-user -- --tenant academy you@example.com \"Name\"`, `npm run catalog-export -- --tenant academy`, `npm run db:migrate -- --tenant academy`. `.env.prod` then only needs `CONTROL_SUPABASE_URL`, `CONTROL_DATABASE_URL` and `DATABASE_CA_CERT`."

- [ ] **Step 2: Update** `CLAUDE.md`:
  - Commands block, after the `create-user` line:

```bash
npm run db:migrate -- --tenant academy      # one company from the control project (ENV_FILE=.env.prod); --all-tenants = every company, stops at the first failure
npm run tenants:export -- --dir <dir>       # backup workflow: one env file per company (masked under GitHub Actions)
```

  - Production section, replace the sentence about scripts targeting prod with: "Scripts target a company with `--tenant <slug>` (read from the control project via `CONTROL_DATABASE_URL` in `.env.prod`); without it they use `ENV_FILE` as before. Release migrates the control project then every company (`--all-tenants`) before deploying; Backup writes one encrypted file per company plus the control registry (`backups-*`). GitHub needs `CONTROL_DATABASE_URL`, `CONTROL_SUPABASE_URL`, `CONTROL_ANON_KEY` (production environment)."

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add ../docs/operations.md ../CLAUDE.md
git commit -m "docs: per-company releases, backups, restores and --tenant scripts"
```
