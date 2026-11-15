import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { checkPair } from '../../scripts/isolation-check';

/** checkPair runs its own transaction and always rolls it back, so it gets its own connection (not withTx). */
async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(pgConfig());
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('isolation check (scripts/isolation-check.ts)', () => {
  it('a company-b admin sees none of academy\'s rows, and does see its own settings', async () => {
    const r = await withClient((c) => checkPair(c, 'company-b', 'academy'));
    expect(r.skipped).toBeUndefined();
    expect(r.ownSettings).toBe(1);
    expect(r.counts.length).toBeGreaterThan(30);
    expect(r.counts.filter((x) => x.visible !== null && x.visible > 0)).toEqual([]);
    // The zeros mean something: academy holds rows in the tables that were checked.
    expect(r.counts.find((x) => x.table === 'settings')?.present).toBe(1);
  });

  it('control: pointed at its own company, the same check sees the rows (it would catch a leak)', async () => {
    const r = await withClient((c) => checkPair(c, 'academy', 'academy'));
    expect(r.counts.find((x) => x.table === 'settings')?.visible).toBe(1);
  });

  it('leaves nothing behind: the session it made is rolled back', async () => {
    const before = await withClient(async (c) => (await c.query('select count(*)::int n from self_auth.session')).rows[0].n);
    await withClient((c) => checkPair(c, 'company-b', 'academy'));
    const after = await withClient(async (c) => (await c.query('select count(*)::int n from self_auth.session')).rows[0].n);
    expect(after).toBe(before);
  });
});
