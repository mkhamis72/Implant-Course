import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

// Error alerts (0107): the app records its server errors in public.error_log; the hourly check reads them and
// remembers how far it got in public.error_alert_state. Only the service role touches either table.
const users = inject('testUsers');

async function asServiceRole(c: Client) {
  await asPostgres(c);
  await c.query('set local role service_role');
}

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('error log (0107)', () => {
  it('the service role adds and reads errors; the time is set by the database', async () => {
    await withTx(async (c) => {
      await asServiceRole(c);
      await c.query(`insert into public.error_log (message, path) values ('sendEmail failed: Invalid login', '/console/account')`);
      const { rows } = await c.query(`select message, path, at <= now() as past from public.error_log where message like 'sendEmail failed%'`);
      expect(rows).toEqual([{ message: 'sendEmail failed: Invalid login', path: '/console/account', past: true }]);
    });
  });

  it('refuses an empty or overlong message', async () => {
    await withTx(async (c) => {
      await asServiceRole(c);
      await refused(c, `insert into public.error_log (message) values ('')`, [], /check/);
      await refused(c, 'insert into public.error_log (message) values ($1)', ['x'.repeat(1001)], /check/);
    });
  });

  it('gives company users and anonymous callers nothing', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, 'select * from public.error_log', [], /permission denied/);
      await refused(c, `insert into public.error_log (message) values ('x')`, [], /permission denied/);
      await refused(c, 'select * from public.error_alert_state', [], /permission denied/);
      await asPostgres(c);
      await c.query('set local role anon');
      await refused(c, `insert into public.error_log (message) values ('x')`, [], /permission denied/);
    });
  });

  it('the alert state holds one row the service role moves forward', async () => {
    await withTx(async (c) => {
      await asServiceRole(c);
      await c.query(`insert into public.error_alert_state (id, checked_at) values (1, now()) on conflict (id) do update set checked_at = excluded.checked_at`);
      await refused(c, `insert into public.error_alert_state (id, checked_at) values (2, now())`, [], /check/);
      expect((await c.query('select count(*)::int as n from public.error_alert_state')).rows[0].n).toBe(1);
    });
  });
});
