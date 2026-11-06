import { expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { TEST_PASSWORD } from '../support/test-users';

// Two companies on the one local stack, from TENANTS_FILE: a.localhost = academy, b.localhost = company B
// (its entry names the company id). The specs that need them skip without such a file.

export const A = 'http://a.localhost:3000';
export const B = 'http://b.localhost:3000';
export const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
export const REFUSED = 'You do not have access to this company.';

type Entry = { slug: string; hosts: string[]; companyId?: string; status?: string };
export const tenantsFile = process.env.TENANTS_FILE;
const tenants: Entry[] = tenantsFile && existsSync(tenantsFile) ? JSON.parse(readFileSync(tenantsFile, 'utf8')) : [];
/** Company B's id, when TENANTS_FILE has a.localhost and b.localhost. */
export const companyB = tenants.some((t) => t.hosts.includes('a.localhost'))
  ? tenants.find((t) => t.hosts.includes('b.localhost'))?.companyId
  : undefined;
export const SKIP_REASON = 'needs TENANTS_FILE with a.localhost and b.localhost on one stack';

export async function withPg<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

/** Deletes the company and all its rows (as postgres, triggers off: the stock ledger and the audit log refuse
 *  deletes, and creating a company already logs a row in it). */
export async function purgeCompany(company: string) {
  await withPg(async (pg) => {
    await pg.query('begin');
    await pg.query('set local session_replication_role = replica');
    for (const { t } of (await pg.query('select t::text as t from app.company_tables() t')).rows) {
      await pg.query(`delete from ${t} where company_id = $1`, [company]);
    }
    await pg.query('delete from app.session_companies where company_id = $1', [company]);
    await pg.query('delete from public.companies where id = $1', [company]);
    await pg.query('commit');
  });
}

/**
 * Company B's browser session, signed in and bound to B through the API, then handed to the browser as B's
 * auth cookies. Signing in through B's login form doesn't work under `next dev` / `next start`: the
 * action's redirect is rendered by a fetch to the server's own origin (__NEXT_PRIVATE_ORIGIN,
 * localhost:3000, which is academy's here), and that request ends the B session as belonging elsewhere.
 */
export async function signInThroughApi(context: BrowserContext, email: string, company: string, origin = B) {
  let jar: { name: string; value: string }[] = [];
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar = [...jar.filter((c) => c.name !== name), ...(value ? [{ name, value }] : [])];
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  const { error: bindError } = await client.rpc('bind_my_session', { p_company: company });
  if (bindError) throw bindError;
  await context.addCookies(jar.map(({ name, value }) => ({ name, value, url: origin })));
}

/** Signs in on the company's host and waits for the Dashboard. */
export async function signIn(page: Page, email: string, origin = A) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
