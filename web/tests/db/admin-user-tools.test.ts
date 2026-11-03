import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { setPerms } from './fixtures';

const users = inject('testUsers');
const SELF = "You can't do this to your own account here. Use Account → Security.";
const ADMIN_ONLY = 'Only an admin can do this.';

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp | string) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const profile = async (c: Client, id: string) =>
  (await c.query(
    `select p.email, p.full_name, m.mfa_setup_required from public.profiles p
     left join public.company_members m on m.user_id = p.user_id and m.company_id = 'a7c0de00-0000-4000-8000-000000000001'
     where p.user_id = $1`, [id])).rows[0];

/** createdAt is SQL: clock_timestamp() (default) is later than anything recorded earlier in the transaction (now()). */
async function addVerifiedFactor(c: Client, userId: string, createdAt = 'clock_timestamp()') {
  await asPostgres(c);
  await c.query(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values (gen_random_uuid(), $1, 'zz-admin-tools-' || gen_random_uuid(), 'totp', 'verified', ${createdAt}, ${createdAt}, 'x')`,
    [userId],
  );
}

describe('admin user tools: guards', () => {
  it('every admin function refuses a non-admin', async () => {
    await withTx(async (c) => {
      const calls: [string, unknown[]][] = [
        ['select public.admin_change_email($1, $2)', [users.target, 'zz-new@example.com']],
        ['select public.admin_set_name($1, $2)', [users.target, 'Zz Name']],
        ['select public.admin_require_mfa_setup($1)', [users.target]],
        ['select public.admin_record_event($1, $2)', [users.target, 'invite_resent']],
        ['select public.admin_end_sessions($1)', [users.target]],
        ['select * from public.admin_user_history($1)', [users.target]],
      ];
      await actAs(c, users.organizer); // Edit on Delegates, but not an admin
      for (const [sql, args] of calls) await refused(c, () => c.query(sql, args), ADMIN_ONLY);
      await actAs(c, users.viewer); // View on Delegates only
      for (const [sql, args] of calls) await refused(c, () => c.query(sql, args), /permission|Only an admin/i);
    });
  });

  it('change email and reset 2FA refuse your own account; your own name is allowed', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await refused(c, () => c.query('select public.admin_change_email($1, $2)', [users.admin, 'zz-me@example.com']), SELF);
      await refused(c, () => c.query('select public.admin_require_mfa_setup($1)', [users.admin]), SELF);
      const before = (await profile(c, users.admin)).full_name;
      await c.query('select public.admin_set_name($1, $2)', [users.admin, before]);
    });
  });

  it('the flag and the email cannot be written directly, even by an admin', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await refused(
        c,
        () => c.query('update public.company_members set mfa_setup_required = true where user_id = $1', [users.target]),
        /permission denied/,
      );
      await refused(
        c,
        () => c.query("update public.profiles set email = 'zz-direct@example.com' where user_id = $1", [users.target]),
        /permission denied/,
      );
    });
  });
});

describe('admin_change_email', () => {
  it('trims, lower-cases and updates the profile; refuses duplicates and bad addresses', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_change_email($1, $2)', [users.target, '  Zz-New.Target@Example.COM ']);
      expect((await profile(c, users.target)).email).toBe('zz-new.target@example.com');
      await refused(
        c,
        () => c.query('select public.admin_change_email($1, $2)', [users.target, ' ICM-TEST-ORGANIZER@example.com']),
        'Another account already uses that email.',
      );
      await refused(c, () => c.query('select public.admin_change_email($1, $2)', [users.target, 'not-an-email']), /valid email/);
      await refused(c, () => c.query('select public.admin_change_email($1, $2)', [users.target, '   ']), /valid email/);
      await refused(
        c,
        () => c.query('select public.admin_change_email($1, $2)', ['00000000-0000-0000-0000-000000000000', 'zz-x@example.com']),
        /User not found/,
      );
    });
  });

  it('updates the linked delegate email and leaves other delegates alone', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const linked = (await c.query('select delegate_id from public.company_members where user_id = $1', [users.delegate])).rows[0].delegate_id;
      const other = (
        await c.query(`insert into public.delegates (full_name, email) values ('Zz Other Delegate', 'zz-other@example.com') returning id`)
      ).rows[0].id;
      await actAsBound(c, users.admin);
      await c.query('select public.admin_change_email($1, $2)', [users.delegate, 'Zz-Delegate-New@example.com']);
      await asPostgres(c);
      const emails = await c.query('select id, email from public.delegates where id = any($1)', [[linked, other]]);
      const byId = Object.fromEntries(emails.rows.map((r) => [r.id, r.email]));
      expect(byId[linked]).toBe('zz-delegate-new@example.com');
      expect(byId[other]).toBe('zz-other@example.com');
      // An unlinked organizer's change touches no delegate.
      await actAsBound(c, users.admin);
      await c.query('select public.admin_change_email($1, $2)', [users.target, 'zz-target-2@example.com']);
      await asPostgres(c);
      expect((await c.query('select email from public.delegates where id = $1', [other])).rows[0].email).toBe('zz-other@example.com');
    });
  });
});

describe('admin_set_name', () => {
  it('trims and accepts 1–120 characters', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_set_name($1, $2)', [users.target, '  Zz Renamed  ']);
      expect((await profile(c, users.target)).full_name).toBe('Zz Renamed');
      await c.query('select public.admin_set_name($1, $2)', [users.target, 'a'.repeat(120)]);
      await refused(c, () => c.query('select public.admin_set_name($1, $2)', [users.target, '   ']), /Enter a name/);
      await refused(c, () => c.query('select public.admin_set_name($1, $2)', [users.target, 'a'.repeat(121)]), /120 characters/);
    });
  });
});

describe('2FA reset flag', () => {
  it('admin_require_mfa_setup sets the flag and records an mfa_reset event', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_require_mfa_setup($1)', [users.target]);
      expect((await profile(c, users.target)).mfa_setup_required).toBe(true);
      const ev = await c.query('select kind, actor_id from public.admin_events where user_id = $1', [users.target]);
      expect(ev.rows).toEqual([{ kind: 'mfa_reset', actor_id: users.admin }]);
    });
  });

  it('mfa_setup_done needs aal2 and a verified factor, then clears the flag', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_require_mfa_setup($1)', [users.target]);
      await actAs(c, users.target, { aal: 'aal2' });
      await refused(c, () => c.query('select public.mfa_setup_done()'), /two-factor/);
      await addVerifiedFactor(c, users.target);
      await actAs(c, users.target, { aal: 'aal1' });
      await refused(c, () => c.query('select public.mfa_setup_done()'), /two-factor/);
      await actAs(c, users.target, { aal: 'aal2' });
      await c.query('select public.mfa_setup_done()');
      await asPostgres(c);
      expect((await profile(c, users.target)).mfa_setup_required).toBe(false);
    });
  });

  it('RLS refuses a flagged user (even at aal2 with a factor) but keeps their own profile and settings readable', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await setPerms(c, users.target, { patients: 'view' });
      const patient = (await c.query(`insert into public.patients (full_name) values ('Zz Flag Patient') returning id`)).rows[0].id;
      await addVerifiedFactor(c, users.target, "now() - interval '1 day'");
      const seesPatient = async () =>
        (await c.query('select 1 from public.patients where id = $1', [patient])).rows.length === 1;

      await actAs(c, users.target, { aal: 'aal2' });
      expect(await seesPatient()).toBe(true);

      await actAsBound(c, users.admin);
      await c.query('select public.admin_require_mfa_setup($1)', [users.target]);
      await actAs(c, users.target, { aal: 'aal2' });
      expect(await seesPatient()).toBe(false);
      expect((await c.query('select public.is_active_user() as v')).rows[0].v).toBe(false);
      const own = await c.query('select user_id from public.profiles where user_id = $1', [users.target]);
      expect(own.rows).toEqual([{ user_id: users.target }]);
      const flag = await c.query('select mfa_setup_required from public.company_members where user_id = $1', [users.target]);
      expect(flag.rows).toEqual([{ mfa_setup_required: true }]);
      expect((await c.query('select 1 from public.settings')).rows).toHaveLength(1);

      await addVerifiedFactor(c, users.target); // a new authenticator, after the reset
      await actAs(c, users.target, { aal: 'aal2' });
      await c.query('select public.mfa_setup_done()');
      expect(await seesPatient()).toBe(true);
    });
  });

  it('mfa_setup_done refuses a factor that survived the reset and accepts one created after it', async () => {
    await withTx(async (c) => {
      await addVerifiedFactor(c, users.target, "now() - interval '1 day'");
      await actAsBound(c, users.admin);
      await c.query('select public.admin_require_mfa_setup($1)', [users.target]);
      await actAs(c, users.target, { aal: 'aal2' });
      await refused(c, () => c.query('select public.mfa_setup_done()'), /two-factor/);
      await addVerifiedFactor(c, users.target);
      await actAs(c, users.target, { aal: 'aal2' });
      await c.query('select public.mfa_setup_done()');
      await asPostgres(c);
      expect((await profile(c, users.target)).mfa_setup_required).toBe(false);
    });
  });

  it('a flagged admin loses admin access until the flag is cleared', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('update public.company_members set mfa_setup_required = true where user_id = $1', [users.admin]);
      await actAsBound(c, users.admin);
      expect((await c.query('select public.is_admin() as v')).rows[0].v).toBe(false);
    });
  });

  it('admin_record_event records the allowed kinds only', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_record_event($1, $2)', [users.target, 'invite_resent']);
      await c.query('select public.admin_record_event($1, $2)', [users.target, 'email_change_incomplete']);
      await refused(c, () => c.query('select public.admin_record_event($1, $2)', [users.target, 'other']), /Unknown event/);
      const ev = await c.query('select kind from public.admin_events where user_id = $1 order by kind', [users.target]);
      expect(ev.rows.map((r) => r.kind)).toEqual(['email_change_incomplete', 'invite_resent']);
    });
  });

  it('admin_events is readable by admins only and not writable directly', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query('select public.admin_record_event($1, $2)', [users.target, 'invite_resent']);
      expect((await c.query('select 1 from public.admin_events where user_id = $1', [users.target])).rows).toHaveLength(1);
      await refused(
        c,
        () => c.query(`insert into public.admin_events (user_id, kind, actor_id) values ($1, 'invite_resent', $1)`, [users.target]),
        /permission denied/,
      );
      await actAs(c, users.organizer);
      expect((await c.query('select 1 from public.admin_events where user_id = $1', [users.target])).rows).toHaveLength(0);
    });
  });
});

describe('admin_end_sessions', () => {
  it("removes the user's academy-bound auth sessions and nobody else's", async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const session = async (u: string) => {
        const id = (await c.query(
          'insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now()) returning id',
          [u])).rows[0].id;
        await c.query(`insert into app.session_companies (session_id, company_id, user_id)
                       values ($1, 'a7c0de00-0000-4000-8000-000000000001', $2)`, [id, u]);
        return id;
      };
      const mine = await session(users.target);
      const theirs = await session(users.viewer);
      await actAsBound(c, users.admin);
      await c.query('select public.admin_end_sessions($1)', [users.target]);
      await asPostgres(c);
      const { rows } = await c.query('select id from auth.sessions where id = any($1)', [[mine, theirs]]);
      expect(rows.map((r) => r.id)).toEqual([theirs]);
    });
  });
});

describe('admin_user_history', () => {
  it('merges audited email/name changes and admin events, newest first, at most 10', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const adminName = (await profile(c, users.admin)).full_name;
      // Older history: 12 audited name changes and an admin event, dated in the past.
      for (let i = 0; i < 12; i++) {
        await c.query(
          `insert into public.audit_log (table_name, row_id, action, user_id, at, before, after)
           values ('profiles', $1, 'UPDATE', $2, now() - make_interval(days => 30 + $3::int),
                   jsonb_build_object('full_name', 'Old ' || $3::text, 'email', 'a@example.com'),
                   jsonb_build_object('full_name', 'New ' || $3::text, 'email', 'a@example.com'))`,
          [users.target, users.admin, i],
        );
      }
      // Not history: creation (insert), the first name after an invite, and unrelated column changes.
      await c.query(
        `insert into public.audit_log (table_name, row_id, action, user_id, at, before, after) values
           ('profiles', $1, 'INSERT', $2, now() - interval '1 day', null, '{"full_name":"X","email":"x@example.com"}'),
           ('profiles', $1, 'UPDATE', $2, now() - interval '1 day', '{"full_name":"","email":"x@example.com"}', '{"full_name":"X","email":"x@example.com"}'),
           ('profiles', $1, 'UPDATE', $2, now() - interval '1 day', '{"full_name":"X","email":"x@example.com","role":"organizer"}', '{"full_name":"X","email":"x@example.com","role":"admin"}')`,
        [users.target, users.admin],
      );
      await c.query(
        `insert into public.admin_events (user_id, kind, actor_id, at) values ($1, 'invite_resent', $2, now() - interval '2 hours')`,
        [users.target, users.admin],
      );
      // Newest: an email change and a 2FA reset made now.
      await actAsBound(c, users.admin);
      await c.query('select public.admin_change_email($1, $2)', [users.target, 'zz-history@example.com']);
      await asPostgres(c);
      await c.query(
        `insert into public.admin_events (user_id, kind, actor_id, at) values ($1, 'mfa_reset', $2, now() + interval '1 minute')`,
        [users.target, users.admin],
      );
      await actAsBound(c, users.admin);
      const { rows } = await c.query('select at, actor_name, kind from public.admin_user_history($1)', [users.target]);
      expect(rows).toHaveLength(10);
      expect(rows.slice(0, 3).map((r) => r.kind)).toEqual(['mfa_reset', 'email_changed', 'invite_resent']);
      expect(rows.slice(3).every((r) => r.kind === 'name_changed')).toBe(true);
      expect(rows.every((r) => r.actor_name === adminName)).toBe(true);
      const times = rows.map((r) => (r.at as Date).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      // Another user's history doesn't leak in.
      expect((await c.query(`select count(*)::int as n from public.admin_user_history($1) where kind = 'mfa_reset'`, [users.viewer])).rows[0].n).toBe(0);
    });
  });
});
