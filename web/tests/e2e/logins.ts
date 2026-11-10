import { expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { ensureTenantUser, setProfile } from '../../scripts/users';
import { nodeAuth } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';

/** A throwaway academy login (Self-Auth account, profile, membership) with a known password; deleted afterwards. */
export async function withLogin(
  prefix: string,
  fn: (u: { id: string; email: string; password: string }) => Promise<void>,
  opts: { fullName?: string; password?: string } = {},
) {
  const email = `icm-${prefix}-${Date.now()}@example.com`;
  const password = opts.password ?? 'Tools-password-123';
  const pg = new Client(pgConfig());
  await pg.connect();
  let id = '';
  try {
    id = await ensureTenantUser({ email, password, pending: { pg } });
    await setProfile(pg, id, { full_name: opts.fullName ?? 'E2E Tools Tester', role: 'organizer', active: true });
    await fn({ id, email, password });
  } finally {
    await pg.end();
    if (id) await (await nodeAuth()).admin.deleteUser(ACADEMY_COMPANY_ID, id).catch(() => {});
  }
}

/** Mailpit (the local stack's mail catcher): the link in the newest email with this subject to this address. */
export async function mailedLink(to: string, subject: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const messages: { ID: string; Subject: string }[] = (await res.json()).messages ?? [];
        id = messages.find((m) => m.Subject === subject)?.ID ?? '';
        return id;
      },
      { timeout: 20_000 },
    )
    .not.toBe('');
  const html: string = (await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json()).HTML;
  const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
  // The email names the app's host; the test browser uses its own base URL, so keep only path and query.
  return new URL(href).pathname + new URL(href).search;
}
