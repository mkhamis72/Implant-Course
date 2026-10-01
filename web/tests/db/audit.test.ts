import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

describe('audit_log', () => {
  it('records who changed settings with before/after values', async () => {
    await withTx(async (c) => {
      const { rows: [orig] } = await c.query('select expiry_alert_days from public.settings');
      await actAs(c, users.admin);
      await c.query('update public.settings set expiry_alert_days = $1', [orig.expiry_alert_days === 61 ? 62 : 61]);
      await asPostgres(c);
      const { rows: [log] } = await c.query(
        "select action, user_id, before, after, row_id from public.audit_log where table_name = 'settings' order by id desc limit 1",
      );
      expect(log.action).toBe('UPDATE');
      expect(log.user_id).toBe(users.admin);
      expect(log.row_id).toBe('true');
      expect(log.before.expiry_alert_days).toBe(orig.expiry_alert_days);
      expect(log.after.expiry_alert_days).not.toBe(orig.expiry_alert_days);
    });
  });

  it('records profile changes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query("update public.profiles set full_name = 'Renamed' where user_id = $1", [users.target]);
      await asPostgres(c);
      const { rows } = await c.query(
        "select after->>'full_name' as name from public.audit_log where table_name = 'profiles' and row_id = $1 order by id desc limit 1",
        [users.target],
      );
      expect(rows[0].name).toBe('Renamed');
    });
  });

  it('active users can read it, inactive users cannot', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set expiry_alert_days = expiry_alert_days");
      await actAs(c, users.organizer);
      expect((await c.query('select id from public.audit_log limit 1')).rows).toHaveLength(1);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.audit_log limit 1')).rows).toHaveLength(0);
    });
  });

  it('users cannot write to it directly', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await expect(
        c.query("insert into public.audit_log (table_name, action) values ('x', 'INSERT')"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('is immutable even for the postgres role', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set expiry_alert_days = expiry_alert_days");
      await c.query('savepoint s');
      await expect(c.query('update public.audit_log set action = action')).rejects.toThrow(/append-only/);
      await c.query('rollback to savepoint s');
      await expect(c.query('delete from public.audit_log')).rejects.toThrow(/append-only/);
    });
  });
});
