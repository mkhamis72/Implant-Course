import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

/** As the console does it: the service role, no signed-in user. */
async function provision(c: Client, slug: string, name: string): Promise<string> {
  await asPostgres(c);
  await c.query('set local role service_role');
  const { rows } = await c.query('select public.provision_company($1, $2) as id', [slug, name]);
  await asPostgres(c);
  return rows[0].id;
}

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const list = async (c: Client, id: string) =>
  (await c.query('select hosts, status from public.companies where id = $1', [id])).rows[0];
const logOf = async (c: Client, slug: string) =>
  (await c.query('select action, actor, reason, before, after from public.company_log where slug = $1 order by id', [slug])).rows;

describe('company list in production (0104)', () => {
  it('a new company starts with no addresses and active', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-new', 'Zz New');
      expect(await list(c, id)).toEqual({ hosts: [], status: 'active' });
    });
  });

  it('cleans addresses', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await c.query(`update public.companies set hosts = array['Zz-A.Imploid.net.:443', 'zz-a.imploid.net'] where id = $1`, [id]);
      expect((await list(c, id)).hosts).toEqual(['zz-a.imploid.net']);
    });
  });

  it('refuses an invalid address', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await refused(c, `update public.companies set hosts = array['bad host'] where id = $1`, [id], /Invalid host/);
    });
  });

  it('refuses an address another company holds', async () => {
    await withTx(async (c) => {
      const a = await provision(c, 'zz-a', 'Zz A');
      const b = await provision(c, 'zz-b', 'Zz B');
      await c.query(`update public.companies set hosts = array['zz-a.imploid.net'] where id = $1`, [a]);
      await refused(c, `update public.companies set hosts = array['ZZ-A.imploid.net'] where id = $1`, [b], /already used by zz-a/);
    });
  });

  it('lets a company change its slug and keep its addresses', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await c.query(`update public.companies set hosts = array['zz-a.imploid.net'] where id = $1`, [id]);
      await c.query(`update public.companies set slug = 'zz-renamed' where id = $1`, [id]);
      expect((await list(c, id)).hosts).toEqual(['zz-a.imploid.net']);
    });
  });

  it('refuses an unknown status', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await refused(c, `update public.companies set status = 'paused' where id = $1`, [id], /check constraint/);
    });
  });

  it('records list changes with actor and reason', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await c.query(`select set_config('app.actor', 'owner@example.com', true), set_config('app.reason', 'unpaid', true)`);
      await c.query(`update public.companies set status = 'suspended' where id = $1`, [id]);
      const rows = await logOf(c, 'zz-a');
      expect(rows.at(-1)).toMatchObject({
        action: 'update', actor: 'owner@example.com', reason: 'unpaid',
        before: { slug: 'zz-a', name: 'Zz A', hosts: [], status: 'active' },
        after: { slug: 'zz-a', name: 'Zz A', hosts: [], status: 'suspended' },
      });
    });
  });

  it('records nothing while app.list_copy is on', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      const before = (await logOf(c, 'zz-a')).length;
      await c.query(`select set_config('app.list_copy', 'on', true)`);
      await c.query(`update public.companies set hosts = array['zz-a.imploid.net'] where id = $1`, [id]);
      expect(await logOf(c, 'zz-a')).toHaveLength(before);
    });
  });

  it('records nothing when no list column changed', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      const before = (await logOf(c, 'zz-a')).length;
      await c.query(`update public.companies set created_at = created_at - interval '1 day' where id = $1`, [id]);
      expect(await logOf(c, 'zz-a')).toHaveLength(before);
    });
  });

  it('gives company users nothing on the change log', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, 'select * from public.company_log', [], /permission denied/);
    });
  });
});
