import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { makeDelegate } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const EXISTS = /A user with this email already exists/;

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the test admin as its active admin. */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-pending', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
    [b, users.admin]);
  return b;
}

async function members(c: Client, user: string) {
  await asPostgres(c);
  return (await c.query(
    'select company_id, role, active, delegate_id from public.company_members where user_id = $1 order by company_id',
    [user])).rows;
}

async function signUp(c: Client, email: string): Promise<string> {
  await asPostgres(c);
  return (await c.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id;
}

const pendingCount = async (c: Client, email: string) => {
  await asPostgres(c);
  return (await c.query('select count(*)::int as n from app_private.pending_logins where email = $1', [email])).rows[0].n;
};

const profileOf = async (c: Client, user: string) => {
  await asPostgres(c);
  return (await c.query('select full_name, role, active, delegate_id from public.profiles where user_id = $1', [user])).rows[0];
};

const deleteDelegate = async (c: Client, delegate: string) =>
  (await c.query('select public.delete_delegate($1) as login', [delegate])).rows[0].login as string | null;

describe('create_pending_login and handle_new_user (0088)', () => {
  it("gives a new login exactly the pending company's membership, with its name", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.create_pending_login(' Zz-Pending-B@Example.com ', 'Zz Pending B', 'organizer', null)`);
      const id = await signUp(c, 'zz-pending-b@example.com');
      expect(await members(c, id)).toEqual([{ company_id: b, role: 'organizer', active: true, delegate_id: null }]);
      expect((await profileOf(c, id)).full_name).toBe('Zz Pending B');
      expect(await pendingCount(c, 'zz-pending-b@example.com')).toBe(0);
    });
  });

  it("an academy delegate login: the role and delegate reach the member row and the profile mirror", async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Pending Delegate');
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-d@example.com', 'Zz Pending D', 'delegate', $1)`, [d]);
      const id = await signUp(c, 'Zz-Pending-D@example.com');
      expect(await members(c, id)).toEqual([{ company_id: ACADEMY_ID, role: 'delegate', active: true, delegate_id: d }]);
      expect(await profileOf(c, id)).toEqual({ full_name: 'Zz Pending D', role: 'delegate', active: true, delegate_id: d });
      expect(await pendingCount(c, 'zz-pending-d@example.com')).toBe(0);
    });
  });

  it('a second call replaces the pending row', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-twice@example.com', 'First', 'organizer', null)`);
      await c.query(`select public.create_pending_login('zz-pending-twice@example.com', 'Second', 'admin', null)`);
      expect(await pendingCount(c, 'zz-pending-twice@example.com')).toBe(1);
      const id = await signUp(c, 'zz-pending-twice@example.com');
      expect(await members(c, id)).toEqual([{ company_id: ACADEMY_ID, role: 'admin', active: true, delegate_id: null }]);
      expect((await profileOf(c, id)).full_name).toBe('Second');
    });
  });

  it('ignores and deletes a pending row older than 7 days', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.create_pending_login('zz-pending-old@example.com', 'Zz Old', 'organizer', null)`);
      await asPostgres(c);
      await c.query(`update app_private.pending_logins set created_at = now() - interval '8 days' where email = 'zz-pending-old@example.com'`);
      const id = await signUp(c, 'zz-pending-old@example.com');
      expect(await members(c, id)).toEqual([{ company_id: ACADEMY_ID, role: 'organizer', active: false, delegate_id: null }]);
      expect((await profileOf(c, id)).full_name).toBe('');
      expect(await pendingCount(c, 'zz-pending-old@example.com')).toBe(0);
    });
  });

  it("cancel_pending_login removes only the caller's company row, admins only", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.create_pending_login('zz-pending-cancel@example.com', 'Zz B', 'organizer', null)`);
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-cancel@example.com', 'Zz A', 'organizer', null)`);
      await actAsBound(c, users.organizer);
      await refused(c, () => c.query(`select public.cancel_pending_login('zz-pending-cancel@example.com')`), /Only admins can do this/);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.cancel_pending_login(' Zz-Pending-Cancel@Example.com ')`);
      await asPostgres(c);
      expect((await c.query(
        `select company_id from app_private.pending_logins where email = 'zz-pending-cancel@example.com'`)).rows)
        .toEqual([{ company_id: ACADEMY_ID }]);
    });
  });

  it('without a pending row a new login is still an inactive academy member (previous app version)', async () => {
    await withTx(async (c) => {
      const id = await signUp(c, 'zz-pending-none@example.com');
      expect(await members(c, id)).toEqual([{ company_id: ACADEMY_ID, role: 'organizer', active: false, delegate_id: null }]);
    });
  });

  it('is admin-only, and the pending table is closed to the API', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.organizer);
      await refused(c, () => c.query(`select public.create_pending_login('zz-pending-x@example.com', 'X', 'organizer', null)`),
        /Only admins can do this/);
      await refused(c, () => c.query('select * from app_private.pending_logins'), /permission denied/);
    });
  });

  it('refuses a delegate role without a delegate, and a delegate link on a staff role', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Pending Mismatch');
      await actAsBound(c, users.admin);
      await refused(c, () => c.query(`select public.create_pending_login('zz-pending-m@example.com', 'M', 'delegate', null)`),
        /Invalid request/);
      await refused(c, () => c.query(`select public.create_pending_login('zz-pending-m@example.com', 'M', 'organizer', $1)`, [d]),
        /Invalid request/);
    });
  });
});

describe('add_existing_member (0088)', () => {
  it("adds an academy user to company B, once", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const id = await signUp(c, 'zz-pending-existing@example.com');
      await actAsBound(c, users.admin, b);
      const added = (await c.query(
        `select public.add_existing_member('Zz-Pending-Existing@Example.com', 'organizer', null) as id`)).rows[0].id;
      expect(added).toBe(id);
      expect(await members(c, id)).toEqual(expect.arrayContaining([
        { company_id: b, role: 'organizer', active: true, delegate_id: null },
        { company_id: ACADEMY_ID, role: 'organizer', active: false, delegate_id: null },
      ]));
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.add_existing_member('zz-pending-existing@example.com', 'organizer', null)`), EXISTS);
    });
  });

  it("refuses another company's delegate", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await signUp(c, 'zz-pending-foreign@example.com');
      const academyDelegate = (await c.query(
        `insert into public.delegates (company_id, full_name) values ($1, 'Zz Pending Academy Delegate') returning id`, [ACADEMY_ID])).rows[0].id;
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.add_existing_member('zz-pending-foreign@example.com', 'delegate', $1)`, [academyDelegate]),
        /Delegate not found/);
    });
  });

  it('refuses a delegate who already has a login here', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const d = (await c.query(
        `insert into public.delegates (company_id, full_name) values ($1, 'Zz Pending Taken') returning id`, [b])).rows[0].id;
      const first = await signUp(c, 'zz-pending-taken1@example.com');
      await signUp(c, 'zz-pending-taken2@example.com');
      await c.query(`insert into public.company_members (company_id, user_id, role, active, delegate_id) values ($1, $2, 'delegate', true, $3)`,
        [b, first, d]);
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.add_existing_member('zz-pending-taken2@example.com', 'delegate', $1)`, [d]),
        /This delegate already has a login\./);
    });
  });

  it('is admin-only and needs an existing profile', async () => {
    await withTx(async (c) => {
      await actAsBound(c, users.organizer);
      await refused(c, () => c.query(`select public.add_existing_member($1, 'organizer', null)`, ['zz-nobody@example.com']),
        /Only admins can do this/);
      await actAsBound(c, users.admin);
      await refused(c, () => c.query(`select public.add_existing_member($1, 'organizer', null)`, ['zz-nobody@example.com']),
        /User not found/);
    });
  });
});

describe('delete_delegate with shared logins (0088)', () => {
  it("keeps the profile and B membership of an academy delegate login that B also has", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Pending Shared Delegate');
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-shared@example.com', 'Zz Shared', 'delegate', $1)`, [d]);
      const login = await signUp(c, 'zz-pending-shared@example.com');
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, login]);
      await actAsBound(c, users.admin);
      expect(await deleteDelegate(c, d)).toBe(login);
      expect(await members(c, login)).toEqual([{ company_id: b, role: 'organizer', active: true, delegate_id: null }]);
      expect(await profileOf(c, login)).toMatchObject({ active: false, delegate_id: null });
      expect((await c.query('select count(*)::int as n from public.delegates where id = $1', [d])).rows[0].n).toBe(0);
    });
  });

  it("removes a B delegate login's B membership only, called while bound to B", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const d = (await c.query(
        `insert into public.delegates (company_id, full_name) values ($1, 'Zz Pending B Delegate') returning id`, [b])).rows[0].id;
      const login = await signUp(c, 'zz-pending-bdel@example.com');
      await c.query(`update public.profiles set active = true where user_id = $1`, [login]);
      await c.query(`insert into public.company_members (company_id, user_id, role, active, delegate_id) values ($1, $2, 'delegate', true, $3)`,
        [b, login, d]);
      await actAsBound(c, users.admin, b);
      expect(await deleteDelegate(c, d)).toBe(login);
      expect(await members(c, login)).toEqual([{ company_id: ACADEMY_ID, role: 'organizer', active: true, delegate_id: null }]);
      expect(await profileOf(c, login)).toBeDefined();
    });
  });

  it('removes the profile of a delegate login with no other membership, and its pending rows', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Pending Lone Delegate');
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-lone@example.com', 'Zz Lone', 'delegate', $1)`, [d]);
      const login = await signUp(c, 'zz-pending-lone@example.com');
      await actAsBound(c, users.admin);
      await c.query(`select public.create_pending_login('zz-pending-later@example.com', 'Zz Later', 'delegate', $1)`, [d]);
      await actAsBound(c, users.admin);
      expect(await deleteDelegate(c, d)).toBe(login);
      expect(await profileOf(c, login)).toBeUndefined();
      expect(await members(c, login)).toEqual([]);
      expect(await pendingCount(c, 'zz-pending-later@example.com')).toBe(0);
    });
  });

  it("refuses another company's delegate", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const d = (await c.query(
        `insert into public.delegates (company_id, full_name) values ($1, 'Zz Pending Other') returning id`, [b])).rows[0].id;
      await actAsBound(c, users.admin);
      await refused(c, () => deleteDelegate(c, d), /Delegate not found/);
    });
  });
});
