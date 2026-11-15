import { Client } from 'pg';

/**
 * The hourly Error alert check (.github/workflows/error-alert.yml): the errors the app recorded since the last run
 * (public.error_log, 0107), then every company address and the console. Exit 1 lists what is wrong, so the failed
 * run emails the owner. The marker moves on in the same transaction (each error is reported once) and entries older
 * than 30 days are deleted. Prints counts and masked messages only (the app masks them before recording).
 */
type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };
type ErrorRow = { at: Date; message: string };

const MAX_KINDS = 20;
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Equal messages grouped, most frequent first: "3× message (last 2026-11-15 10:05 UTC)". */
export function summarise(rows: ErrorRow[]): string[] {
  const groups = new Map<string, { n: number; last: Date }>();
  for (const r of rows) {
    const g = groups.get(r.message);
    if (g) {
      g.n += 1;
      if (r.at > g.last) g.last = r.at;
    } else {
      groups.set(r.message, { n: 1, last: r.at });
    }
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.getTime() - a[1].last.getTime());
  const lines = sorted.slice(0, MAX_KINDS).map(([m, g]) => `${g.n}× ${m} (last ${utc(g.last)})`);
  if (sorted.length > MAX_KINDS) lines.push(`… and ${sorted.length - MAX_KINDS} more kinds of error`);
  return lines;
}

/** The sign-in page of each active company's first address, and the console's. */
export function siteUrls(companies: { hosts: string[] | null }[], consoleHost: string | undefined): string[] {
  const urls = companies.map((c) => c.hosts?.[0]).filter((h): h is string => !!h).map((h) => `https://${h}/login`);
  if (consoleHost) urls.push(`https://${consoleHost}/console/login`);
  return urls;
}

/** Every address that does not answer 200 within 20 s, with why. */
export async function checkSites(urls: string[], fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const problems: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) problems.push(`${url} answered ${res.status}`);
    } catch (e) {
      problems.push(`${url} did not answer (${e instanceof Error ? e.message : 'error'})`);
    }
  }
  return problems;
}

export async function runErrorCheck(db: Db, fetchImpl: typeof fetch, consoleHost: string | undefined): Promise<{ ok: boolean; lines: string[] }> {
  await db.query('begin');
  let errors: ErrorRow[];
  let companies: { hosts: string[] | null }[];
  try {
    const marker = (await db.query('select checked_at from public.error_alert_state where id = 1')).rows[0] as { checked_at: Date } | undefined;
    errors = (marker
      ? await db.query('select at, message from public.error_log where at > $1 and at <= now() order by at', [marker.checked_at])
      : await db.query("select at, message from public.error_log where at > now() - interval '1 hour' and at <= now() order by at")).rows as ErrorRow[];
    await db.query('insert into public.error_alert_state (id, checked_at) values (1, now()) on conflict (id) do update set checked_at = excluded.checked_at');
    await db.query("delete from public.error_log where at < now() - interval '30 days'");
    companies = (await db.query("select hosts from public.companies where status = 'active' order by slug")).rows as { hosts: string[] | null }[];
    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => undefined);
    throw e;
  }
  const sites = await checkSites(siteUrls(companies, consoleHost), fetchImpl);
  const lines: string[] = [];
  if (errors.length) lines.push(`${errors.length} new error${errors.length === 1 ? '' : 's'} since the last check:`, ...summarise(errors).map((l) => `  ${l}`));
  if (sites.length) lines.push('Sites not answering:', ...sites.map((l) => `  ${l}`));
  return errors.length || sites.length ? { ok: false, lines } : { ok: true, lines: ['No new errors. Every site answers.'] };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/error-alert.ts')) {
  (async () => {
    await import('./load-env');
    const { pgConfig } = await import('./db');
    const c = new Client(pgConfig());
    await c.connect();
    try {
      const r = await runErrorCheck(c, fetch, process.env.CONSOLE_HOST);
      for (const l of r.lines) console.log(l);
      if (!r.ok) process.exitCode = 1;
    } finally {
      await c.end();
    }
  })().catch((e) => {
    console.error(`Error alert check could not run: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
