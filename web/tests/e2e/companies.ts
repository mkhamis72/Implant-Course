import { expect, type BrowserContext, type Page } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { nodeAuth } from '../../scripts/self-auth-node';
import { TEST_PASSWORD } from '../support/test-users';

// Two companies on the one local stack (merge release 3: the app routes by public.companies). a.localhost = academy
// (npm run dev:companies, run by db:migrate); company B exists only while a spec needs it, on b.localhost
// (createCompanyB). paused.localhost is the suspended local company.

export const A = 'http://a.localhost:3000';
export const B = 'http://b.localhost:3000';
export const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
export const REFUSED = 'You do not have access to this company.';

export const COMPANY_B = 'b0000000-0000-4000-8000-0000000000b2';
/** Kept for the specs: company B's id. */
export const companyB: string = COMPANY_B;

/** Status of GET /login on the dev server with this Host (Node can't resolve *.localhost; Host is set by hand). */
export function statusOn(host: string, path = '/login'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: 3000, path, headers: { host: `${host}:3000` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Waits until the dev server answers this Host with the status (its company list is cached up to 60 s). */
export async function waitForStatus(host: string, status: number, timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < until) {
    last = await statusOn(host);
    if (last === status) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`${host} still answers ${last}, not ${status}, after ${timeoutMs / 1000} s`);
}

/** Company B on b.localhost, with a settings row (the signed-in pages need one); routable once this returns. */
export async function createCompanyB(): Promise<void> {
  await withPg(async (pg) => {
    await pg.query(
      `insert into public.companies (id, slug, name, hosts) values ($1, 'e2e-company-b', 'E2E Company B', '{b.localhost}')
       on conflict (id) do update set hosts = excluded.hosts, status = 'active'`,
      [COMPANY_B],
    );
    await pg.query('insert into public.settings (company_id) values ($1) on conflict do nothing', [COMPANY_B]);
  });
  await waitForStatus('b.localhost', 200);
}

/** Sets company B's status in the database and waits until the dev server routes by it. */
export async function setCompanyBStatus(status: 'active' | 'suspended'): Promise<void> {
  await withPg((pg) => pg.query('update public.companies set status = $2 where id = $1', [COMPANY_B, status]));
  await waitForStatus('b.localhost', status === 'active' ? 200 : 503);
}

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
 * Company B's browser session, signed in through Self-Auth and bound to B through the API, then handed to the
 * browser as B's session cookie (icm_session, host-only). Signing in through B's login form doesn't work under
 * `next dev` / `next start`: the action's redirect is rendered by a fetch to the server's own origin
 * (__NEXT_PRIVATE_ORIGIN, localhost:3000, which is academy's here), and that request ends the B session as
 * belonging elsewhere.
 */
export async function signInThroughApi(context: BrowserContext, email: string, company: string, origin = B) {
  const auth = await nodeAuth();
  const res = await auth.signIn({ companyId: company, email, password: TEST_PASSWORD });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.reason}`);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${await auth.issueDbToken(res.session)}` } },
  });
  const { error: bindError } = await client.rpc('bind_my_session', { p_company: company });
  if (bindError) throw bindError;
  await context.addCookies([{ name: 'icm_session', value: res.sessionToken, url: origin, httpOnly: true, sameSite: 'Lax' }]);
}

/** Signs in on the company's host and waits for the Dashboard. */
export async function signIn(page: Page, email: string, origin = A) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
