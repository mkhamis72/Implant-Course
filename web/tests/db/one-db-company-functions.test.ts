import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asPostgres, asCompany } from './helpers';
import { makeDelegate, makePatient, makeProduct, pendingLogin, place, receive } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const NOT_FOUND = /User not found\./;
const SHARED = /This user also belongs to another company\. Ask support to change their sign-in details\./;
const NOT_ORGANIZER = /Choose an active organizer\./;

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the test admin as its active admin. */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-fns', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
    [b, users.admin]);
  return b;
}

describe('admin functions act on the caller\'s company (0090)', () => {
  it("refuses a B admin for an academy-only user", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.set_user_permissions($1, '{"patients":"edit"}')`, [users.target]), NOT_FOUND);
      await refused(c, () => c.query(`select public.admin_set_name($1, 'Zz Renamed')`, [users.target]), NOT_FOUND);
      await refused(c, () => c.query(`select public.admin_change_email($1, 'zz-company-fns@example.com')`, [users.target]), NOT_FOUND);
      await refused(c, () => c.query(`select public.admin_record_event($1, 'invite_resent')`, [users.target]), NOT_FOUND);
      await refused(c, () => c.query('select * from public.admin_user_history($1)', [users.target]), NOT_FOUND);
    });
  });

  it("writes permissions and events for the caller's company only", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.target]);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.set_user_permissions($1, '{"patients":"edit"}')`, [users.target]);
      await c.query(`select public.admin_record_event($1, 'invite_resent')`, [users.target]);
      const history = (await c.query('select kind from public.admin_user_history($1)', [users.target])).rows;
      expect(history).toEqual([{ kind: 'invite_resent' }]);
      await asPostgres(c);
      expect((await c.query(
        `select area, level from public.user_permissions where company_id = $1 and user_id = $2`, [b, users.target])).rows)
        .toEqual([{ area: 'patients', level: 'edit' }]);
      expect((await c.query(
        `select count(*)::int as n from public.user_permissions where company_id = $1 and user_id = $2`, [ACADEMY_ID, users.target]))
        .rows[0].n).toBeGreaterThan(0);
      expect((await c.query(
        `select company_id from public.admin_events where user_id = $1 and kind = 'invite_resent'`, [users.target])).rows)
        .toEqual([{ company_id: b }]);
    });
  });

  it("refuses a B admin changing the name or email of a user shared with academy; a B-only user's are changed", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.target]);
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query(`select public.admin_set_name($1, 'Zz Renamed')`, [users.target]), SHARED);
      await refused(c, () => c.query(`select public.admin_change_email($1, 'zz-company-fns-shared@example.com')`, [users.target]), SHARED);

      await pendingLogin(c, 'zz-company-fns-b@example.com', { company: b });
      const only = (await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-company-fns-b@example.com') returning id`)).rows[0].id;
      await actAsBound(c, users.admin, b);
      await c.query(`select public.admin_set_name($1, 'Zz B Only')`, [only]);
      await c.query(`select public.admin_change_email($1, 'zz-company-fns-b2@example.com')`, [only]);
      await asPostgres(c);
      expect((await c.query('select full_name, email from public.profiles where user_id = $1', [only])).rows)
        .toEqual([{ full_name: 'Zz B Only', email: 'zz-company-fns-b2@example.com' }]);
    });
  });

  it('refuses an unbound admin', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { session_id: crypto.randomUUID() });
      await refused(c, () => c.query('select public.delete_user($1)', [users.target]), /Not allowed/);
      await refused(c, () => c.query(`select public.create_pending_login('zz-company-fns@example.com', 'X', 'organizer', null)`),
        /Only admins can do this\./);
    });
  });

  it('lets a B admin create a pending login for B', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      await c.query(`select public.create_pending_login('zz-company-fns-new@example.com', 'Zz New', 'organizer', null)`);
      await asPostgres(c);
      const id = (await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-company-fns-new@example.com') returning id`)).rows[0].id;
      expect((await c.query('select company_id, role, active from public.company_members where user_id = $1', [id])).rows)
        .toEqual([{ company_id: b, role: 'organizer', active: true }]);
      // An organizer membership gets View defaults in its own company (0090: default_permissions on company_members).
      expect((await c.query('select distinct company_id, level from public.user_permissions where user_id = $1', [id])).rows)
        .toEqual([{ company_id: b, level: 'view' }]);
    });
  });
});

describe('handle_new_user without a pending login (0090)', () => {
  it('refuses the sign-up', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await refused(c, () => c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-company-fns-none@example.com')`), /No pending login for this address\./);
    });
  });

  it('creates the membership from the fixture pending row', async () => {
    await withTx(async (c) => {
      await pendingLogin(c, 'zz-company-fns-fixture@example.com', { fullName: 'Zz Fixture' });
      const id = (await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-company-fns-fixture@example.com') returning id`)).rows[0].id;
      expect((await c.query('select company_id, role, active from public.company_members where user_id = $1', [id])).rows)
        .toEqual([{ company_id: ACADEMY_ID, role: 'organizer', active: true }]);
    });
  });
});

describe('the profile mirrors are gone (0090)', () => {
  it('a member write leaves profiles alone, and a profile write leaves members alone', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const before = (await c.query('select role, active from public.profiles where user_id = $1', [users.viewer])).rows[0];
      await c.query(`update public.company_members set active = false where company_id = $1 and user_id = $2`, [ACADEMY_ID, users.viewer]);
      expect((await c.query('select role, active from public.profiles where user_id = $1', [users.viewer])).rows[0]).toEqual(before);
      await c.query(`update public.profiles set full_name = 'Zz Mirror' where user_id = $1`, [users.viewer]);
      expect((await c.query('select active from public.company_members where company_id = $1 and user_id = $2',
        [ACADEMY_ID, users.viewer])).rows[0].active).toBe(false);
    });
  });
});

describe('check_assignee (0090)', () => {
  it("refuses an assignee who is staff of another company only", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.viewer]);
      await c.query('delete from public.company_members where company_id = $1 and user_id = $2', [ACADEMY_ID, users.viewer]);
      await asCompany(c);
      const list = (await c.query(`insert into public.checklists (title) values ('Zz Company Fns') returning id`)).rows[0].id;
      await refused(c, () => c.query(
        `insert into public.checklist_items (checklist_id, position, text, assignee_id) values ($1, 1, 'Task', $2)`, [list, users.viewer]),
        /Choose an active organizer or admin to assign this to\./);
      await c.query(
        `insert into public.checklist_items (checklist_id, position, text, assignee_id) values ($1, 1, 'Task', $2)`, [list, users.organizer]);
    });
  });
});

describe('fit_component_v2: fitted by organizer (0090)', () => {
  const fit = (c: Client, site: string, organizer: string) => c.query(
    `select public.fit_component_v2(p_site => $1, p_type => 'cover_screw', p_fitted_on => current_date,
       p_product => null, p_lot => null, p_by_delegate => null, p_by_organizer => $2, p_notes => '', p_course => null) as id`,
    [site, organizer]);

  it("accepts an active staff member of the implant's company only, and the row takes that company", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.viewer]);
      await c.query('delete from public.company_members where company_id = $1 and user_id = $2', [ACADEMY_ID, users.viewer]);
      await actAs(c, users.organizer);
      const implant = await makeProduct(c);
      const lot = await receive(c, implant, 1, 'ZZ-FNS');
      const site = await place(c, {
        patient: await makePatient(c, 'Zz Company Fns Patient'), tooth: 36, product: implant, lot,
        delegate: await makeDelegate(c, 'Zz Company Fns Delegate'), supervisor: users.organizer,
      });
      await actAs(c, users.organizer);
      await refused(c, () => fit(c, site, users.viewer), NOT_ORGANIZER); // a member of B only
      await refused(c, () => fit(c, site, users.delegate), NOT_ORGANIZER); // an active delegate login of academy
      const id = (await fit(c, site, users.organizer)).rows[0].id;
      await asPostgres(c);
      const { rows } = await c.query(
        `select sc.company_id, s.company_id as site_company from public.site_components sc
         join public.implant_sites s on s.id = sc.site_id where sc.id = $1`, [id]);
      expect(rows).toEqual([{ company_id: ACADEMY_ID, site_company: ACADEMY_ID }]);
    });
  });
});
