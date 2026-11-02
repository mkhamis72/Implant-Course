import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const S0 = '0e5e5520-0000-4000-8000-000000000000';
const S1 = '0e5e5520-0000-4000-8000-000000000001';
const S2 = '0e5e5520-0000-4000-8000-000000000002';
const S3 = '0e5e5520-0000-4000-8000-000000000003';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function authSession(c: Client, id: string, user: string) {
  await c.query('insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())', [id, user]);
}

async function boundRow(c: Client, session: string, company: string, user: string) {
  await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)', [session, company, user]);
}

async function boundSessions(c: Client) {
  await asPostgres(c);
  const { rows } = await c.query('select session_id from app.session_companies where session_id = any($1) order by session_id',
    [[S0, S1, S2, S3]]);
  return rows.map((r) => r.session_id);
}

describe('bind_my_session / my_session_company (0086)', () => {
  it('binds the session, and my_session_company() returns its company', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await authSession(c, S1, users.organizer);
      await actAs(c, users.organizer, { session_id: S1 });
      expect((await c.query('select public.my_session_company() as id')).rows[0].id).toBeNull();
      await c.query('select public.bind_my_session($1)', [ACADEMY_ID]);
      expect((await c.query('select public.my_session_company() as id')).rows[0].id).toBe(ACADEMY_ID);
    });
  });

  it("removes the caller's stale rows only, keeping live sessions and other users' rows", async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await authSession(c, S1, users.organizer);
      await authSession(c, S3, users.organizer);
      await boundRow(c, S0, ACADEMY_ID, users.organizer); // stale: no auth.sessions row
      await boundRow(c, S2, ACADEMY_ID, users.admin); // another user's stale row
      await boundRow(c, S3, ACADEMY_ID, users.organizer); // the caller's other live session
      await actAs(c, users.organizer, { session_id: S1 });
      await c.query('select public.bind_my_session($1)', [ACADEMY_ID]);
      expect(await boundSessions(c)).toEqual([S1, S2, S3]);
    });
  });

  it('never removes the session it has just bound', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer, { session_id: S1 }); // no auth.sessions row for S1
      await c.query('select public.bind_my_session($1)', [ACADEMY_ID]);
      expect(await boundSessions(c)).toEqual([S1]);
    });
  });

  it('refuses a company the user does not belong to', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const other = (await c.query(`insert into public.companies (slug, name) values ('zz-other', 'Other') returning id`)).rows[0].id;
      await authSession(c, S1, users.organizer);
      await actAs(c, users.organizer, { session_id: S1 });
      await refused(c, () => c.query('select public.bind_my_session($1)', [other]), /You do not have access to this company\./);
    });
  });

  it('is closed to anon', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      await refused(c, () => c.query('select public.bind_my_session($1)', [ACADEMY_ID]), /permission denied/);
      await refused(c, () => c.query('select public.my_session_company()'), /permission denied/);
    });
  });
});

describe('branding_for / branding_logo_for (0086)', () => {
  it("returns a company's branding and logo to anon, and nothing for an unknown company", async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query('select public.update_branding($1, $2, $3)', ['Zz Session Academy', '#7c2d12', null]);
      await c.query('select public.set_branding_logo($1, $2)', [PNG, 'image/png']);
      await actAs(c, null);
      const pub = (await c.query('select * from public.branding_public()')).rows[0];
      const row = (await c.query('select * from public.branding_for($1)', [ACADEMY_ID])).rows;
      expect(row).toEqual([pub]);
      expect(row[0]).toMatchObject({ name: 'Zz Session Academy', brand_color: '#7c2d12', has_logo: true });
      const logo = (await c.query('select * from public.branding_logo_for($1)', [ACADEMY_ID])).rows;
      expect(logo).toHaveLength(1);
      expect(logo[0].content_type).toBe('image/png');
      expect(Buffer.compare(logo[0].bytes, PNG)).toBe(0);

      expect((await c.query('select * from public.branding_for(gen_random_uuid())')).rows).toEqual([]);
      expect((await c.query('select * from public.branding_logo_for(gen_random_uuid())')).rows).toEqual([]);
    });
  });
});
