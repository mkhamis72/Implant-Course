import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { migrate } from './migrate';
import { pgConfig } from './db';
import { registerTenant } from './tenants';
import { envFileText } from './tenant-env';
import { isLocalHost } from './test-guard';

type Vars = Record<string, string | undefined>;

/** Refuses to touch anything but local stacks: control DDL and the stored keys must never go to a hosted project. */
export function assertLocalStacks(dev: Vars, dev2: Vars): void {
  const local = [dev.NEXT_PUBLIC_SUPABASE_URL, dev.DATABASE_URL, dev2.NEXT_PUBLIC_SUPABASE_URL, dev2.DATABASE_URL].every((v) => {
    try {
      return !!v && isLocalHost(new URL(v).hostname);
    } catch {
      return false;
    }
  });
  if (!local) throw new Error('console:local only runs against local stacks (127.0.0.1/localhost); check .env.local and .env.dev2.');
}

/**
 * Local console E2E: the dev2 stack (npm run db:dev2:start) becomes the control project, with companies
 * "dev" (localhost → main stack) and "dev2" (tenant2.localhost → dev2 stack). Writes .env.console for the
 * dev server: set -a; source .env.console; set +a; npx playwright test console
 */
async function main() {
  const dev = parse(readFileSync('.env.local'));
  const dev2 = parse(readFileSync('.env.dev2'));
  assertLocalStacks(dev, dev2);
  console.log(`Target project: control ${new URL(dev2.NEXT_PUBLIC_SUPABASE_URL).host}`);
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

if (process.argv[1]?.endsWith('console-local.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
