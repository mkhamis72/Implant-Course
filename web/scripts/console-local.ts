import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { migrate } from './migrate';
import { pgConfig } from './db';
import { registerTenant } from './tenants';
import { ACADEMY_COMPANY_ID } from '../src/lib/tenant/types';
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
 * "dev" (localhost → main stack, academy) and "dev2" (tenant2.localhost → main stack, company console-e2e). Writes .env.console for the
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
      companyId: ACADEMY_COMPANY_ID,
    });
    // Company two lives in the MAIN stack too (the shared database): dev2 is only the control project, so no
    // company schema sits next to the control tables (its sign-up trigger would refuse the console admins).
    const company = new Client(pgConfig({ DATABASE_URL: dev.DATABASE_URL }));
    await company.connect();
    let secondCompany: string;
    try {
      const found = (await company.query('select id from public.companies where slug = $1', ['console-e2e'])).rows[0]?.id as string | undefined;
      secondCompany = found ?? (await company.query('select public.provision_company($1, $2) as id', ['console-e2e', 'Console E2E Company'])).rows[0].id;
    } finally {
      await company.end();
    }
    await registerTenant(control, {
      slug: 'dev2', name: 'Dev Company Two', hosts: ['tenant2.localhost'], supabaseUrl: dev.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: dev.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceRoleKey: dev.SUPABASE_SERVICE_ROLE_KEY, databaseUrl: dev.DATABASE_URL,
      companyId: secondCompany,
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
  console.log('Control project: dev2 stack. Control only; companies dev (localhost, academy) and dev2 (tenant2.localhost, console-e2e) are both in the main stack. Wrote .env.console.');
}

if (process.argv[1]?.endsWith('console-local.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
