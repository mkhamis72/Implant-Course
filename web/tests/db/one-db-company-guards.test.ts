import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';

// 0089: the guards and auth helpers read the caller's company_members row for the bound company.

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** Company B (as postgres), with the user as a member. */
async function companyB(c: Client, user: string, member: { role?: string; active?: boolean; mfa?: boolean } = {}) {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-guards', 'Zz B') returning id`)).rows[0].id;
  await c.query(
    `insert into public.company_members (company_id, user_id, role, active, mfa_setup_required) values ($1, $2, $3, $4, $5)`,
    [b, user, member.role ?? 'organizer', member.active ?? true, member.mfa ?? false]);
  return b as string;
}

const isActive = async (c: Client) => (await c.query('select public.is_active_user() as v')).rows[0].v as boolean;
const canEditPatients = async (c: Client) => (await c.query(`select public.can('patients', 'edit') as v`)).rows[0].v as boolean;

async function mfaFlag(c: Client, company: string, user: string) {
  await asPostgres(c);
  return (await c.query('select mfa_setup_required as v from public.company_members where company_id = $1 and user_id = $2',
    [company, user])).rows[0].v as boolean;
}

describe('guards read the bound company (0089)', () => {
  it('an organizer active in academy and inactive in B is active only when bound to academy', async () => {
    await withTx(async (c) => {
      const b = await companyB(c, users.organizer, { active: false });
      await actAsBound(c, users.organizer, ACADEMY_ID);
      expect(await isActive(c)).toBe(true);
      await actAsBound(c, users.organizer, b);
      expect(await isActive(c)).toBe(false);
      expect(await canEditPatients(c)).toBe(false);
    });
  });

  it("can() follows the bound company's user_permissions", async () => {
    await withTx(async (c) => {
      const b = await companyB(c, users.viewer);
      // The viewer's Patients permission moves to B (one row per user and area until 0091).
      await c.query(`delete from public.user_permissions where user_id = $1 and area = 'patients'`, [users.viewer]);
      await c.query(`insert into public.user_permissions (company_id, user_id, area, level) values ($1, $2, 'patients', 'edit')`,
        [b, users.viewer]);
      await actAsBound(c, users.viewer, ACADEMY_ID);
      expect(await canEditPatients(c)).toBe(false);
      await actAsBound(c, users.viewer, b);
      expect(await canEditPatients(c)).toBe(true);
    });
  });

  it('an unbound session gets no access', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { session_id: crypto.randomUUID() });
      expect(await isActive(c)).toBe(false);
      expect((await c.query('select public.is_admin() as v')).rows[0].v).toBe(false);
      await actAs(c, users.delegate, { session_id: crypto.randomUUID() });
      expect((await c.query('select public.is_delegate_user() as v, public.my_delegate_id() as d')).rows[0])
        .toEqual({ v: false, d: null });
    });
  });

  it('the 2FA setup flag is per company, and mfa_setup_done clears only the bound one', async () => {
    await withTx(async (c) => {
      const b = await companyB(c, users.viewer, { mfa: true });
      await actAsBound(c, users.viewer, ACADEMY_ID);
      expect(await isActive(c)).toBe(true);
      await actAsBound(c, users.viewer, b);
      expect(await isActive(c)).toBe(false);

      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 'zz-company-guards', 'totp', 'verified', clock_timestamp(), clock_timestamp(), 'x')`,
        [users.viewer]);
      await c.query(`update public.company_members set mfa_setup_required = true where company_id = $1 and user_id = $2`,
        [ACADEMY_ID, users.viewer]);
      await actAs(c, users.viewer, { session_id: crypto.randomUUID(), aal: 'aal2' });
      await c.query('select public.bind_my_session($1)', [b]);
      await c.query('select public.mfa_setup_done()');
      expect(await mfaFlag(c, b, users.viewer)).toBe(false);
      expect(await mfaFlag(c, ACADEMY_ID, users.viewer)).toBe(true);
    });
  });
});
