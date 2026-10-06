import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** A fresh login (as postgres): the auth trigger gives it an inactive organizer profile. */
async function newUser(c: Client, email: string, profile: { role?: string; delegate_id?: string } = {}): Promise<string> {
  await asPostgres(c);
  const id = (await c.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id;
  await c.query(
    `update public.profiles set full_name = 'Zz Remove ' || $2, role = $3, delegate_id = $4, active = true where user_id = $1`,
    [id, email, profile.role ?? 'organizer', profile.delegate_id ?? null],
  );
  return id;
}

const deleteUser = (c: Client, user: string) => c.query('select public.delete_user($1)', [user]);
const deleteDelegate = async (c: Client, delegate: string) =>
  (await c.query('select public.delete_delegate($1) as login', [delegate])).rows[0].login as string | null;
const count = async (c: Client, sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0].n as number;

describe('delete_user', () => {
  it('an admin removes a user without records; their permissions go too', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-remove-clean@example.com');
      await actAs(c, users.admin);
      await deleteUser(c, id);
      await asPostgres(c);
      expect(await count(c, 'select count(*)::int as n from public.profiles where user_id = $1', [id])).toBe(0);
      expect(await count(c, 'select count(*)::int as n from public.user_permissions where user_id = $1', [id])).toBe(0);
    });
  });

  it('only admins, and never themselves', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-remove-guard@example.com');
      await actAs(c, users.organizer);
      await refused(c, () => deleteUser(c, id), /Only an admin can remove users/);
      await actAs(c, users.admin);
      await refused(c, () => deleteUser(c, users.admin), /can't remove your own/);
      await refused(c, () => deleteUser(c, '00000000-0000-0000-0000-000000000000'), /User not found/);
    });
  });

  it('a user with records is refused and pointed to Deactivate', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-remove-records@example.com');
      await setPerms(c, id, { inventory: 'edit' });
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await actAs(c, id);
      await receive(c, product, 1, 'ZZREMOVE');
      await actAs(c, users.admin);
      await refused(c, () => deleteUser(c, id), /has records .* Deactivate them instead/);
    });
  });
});

describe('delete_delegate', () => {
  it('needs Delegates edit', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Remove Delegate');
      await setPerms(c, users.target, { delegates: 'view' });
      await actAs(c, users.target);
      await refused(c, () => deleteDelegate(c, d), /permission to edit Delegates/);
    });
  });

  it('removes a delegate and their course enrollments', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Remove Enrolled');
      await enroll(c, await makeCourse(c), d);
      expect(await deleteDelegate(c, d)).toBeNull();
      expect(await count(c, 'select count(*)::int as n from public.delegates where id = $1', [d])).toBe(0);
      expect(await count(c, 'select count(*)::int as n from public.enrollments where delegate_id = $1', [d])).toBe(0);
    });
  });

  it('refuses a delegate with implant records or surgery bookings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const placed = await makeDelegate(c, 'Zz Remove Placed');
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1, 'ZZREMOVEDEL');
      await place(c, { patient: await makePatient(c, 'Zz Remove Patient'), tooth: 36, product, lot, delegate: placed, supervisor: users.organizer });
      await refused(c, () => deleteDelegate(c, placed), /implant records/);

      await actAs(c, users.admin);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const booked = await makeDelegate(c, 'Zz Remove Booked');
      const course = await makeCourse(c);
      await enroll(c, course, booked);
      await book(c, { session: await makeSession(c, course), chair, patient: await makePatient(c, 'Zz Remove Booked Patient'), supervisor: users.organizer, placing: [booked] });
      await refused(c, () => deleteDelegate(c, booked), /surgery bookings/);
    });
  });

  it('a delegate with a login: admins only, and the login id comes back with the profile gone', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const d = await makeDelegate(c, 'Zz Remove With Login');
      const login = await newUser(c, 'zz-remove-delegate-login@example.com', { role: 'delegate', delegate_id: d });
      // Before 0037 a delegate login could be given checklist tasks: removal unassigns them.
      await c.query('set local session_replication_role = replica');
      const list = (await c.query(`insert into public.checklists (title) values ('Zz Delegate tasks') returning id`)).rows[0].id;
      const item = (await c.query(
        `insert into public.checklist_items (checklist_id, position, text, assignee_id) values ($1, 1, 'Task', $2) returning id`,
        [list, login],
      )).rows[0].id;
      await c.query('set local session_replication_role = origin');
      await actAs(c, users.organizer);
      await refused(c, () => deleteDelegate(c, d), /Only an admin can remove a delegate who has a login/);
      await actAs(c, users.admin);
      expect(await deleteDelegate(c, d)).toBe(login);
      await asPostgres(c);
      expect(await count(c, 'select count(*)::int as n from public.profiles where user_id = $1', [login])).toBe(0);
      expect((await c.query('select assignee_id from public.checklist_items where id = $1', [item])).rows[0].assignee_id).toBeNull();
    });
  });
});

describe('checklist assignees', () => {
  it('are organizers or admins, never delegate logins', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const list = (await c.query(`insert into public.checklists (title) values ('Zz Assignee list') returning id`)).rows[0].id;
      const assign = (user: string, position: number) =>
        c.query(`insert into public.checklist_items (checklist_id, position, text, assignee_id) values ($1, $2, 'Task', $3)`, [list, position, user]);
      await assign(users.organizer, 1);
      await assign(users.admin, 2);
      await refused(c, () => assign(users.delegate, 3), /organizer or admin/);
    });
  });
});
