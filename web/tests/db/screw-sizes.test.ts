import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { insertSelfAuthUser, pendingLogin, setPerms } from './fixtures';

// Screw sizes (0148): a company's list of abutment and prosthetic screw sizes per implant system, written only
// by admins through save_screw_size / set_screw_size_active, read by staff with Patients view.

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const save = async (c: Client, o: Partial<Record<string, unknown>> = {}) =>
  (await c.query(
    `select public.save_screw_size(p_id => $1, p_brand => $2, p_system => $3, p_kind => $4, p_label => $5,
       p_driver_interface => $6, p_driver_size => $7, p_driver_ref => $8, p_torque => $9) as id`,
    [o.id ?? null, o.brand ?? 'Zz Brand', o.system ?? 'Zz System', o.kind ?? 'abutment_screw', o.label ?? 'M1.6 x 5',
      o.interface ?? 'Hex', o.size ?? '1.25', o.ref ?? 'SD-1', "torque" in o ? o.torque : 25],
  )).rows[0].id as string;

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(`select count(*)::int as n from (${sql}) x`, params)).rows[0].n as number;

describe('screw sizes', () => {
  it('an admin saves, edits and switches off a size; the row stays', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await save(c);
      let row = (await c.query('select * from public.screw_sizes where id = $1', [id])).rows[0];
      expect(row).toMatchObject({ brand: 'Zz Brand', system: 'Zz System', kind: 'abutment_screw', label: 'M1.6 x 5',
        driver_interface: 'Hex', driver_size: '1.25', driver_ref: 'SD-1', active: true });
      expect(Number(row.torque_ncm)).toBe(25);

      expect(await save(c, { id, label: 'M1.8 x 6', torque: null, ref: '' })).toBe(id);
      row = (await c.query('select * from public.screw_sizes where id = $1', [id])).rows[0];
      expect(row.label).toBe('M1.8 x 6');
      expect(row.torque_ncm).toBeNull();
      expect(row.driver_ref).toBe('');

      await c.query('select public.set_screw_size_active(p_id => $1, p_active => false)', [id]);
      expect((await c.query('select active from public.screw_sizes where id = $1', [id])).rows[0].active).toBe(false);
      await c.query('select public.set_screw_size_active(p_id => $1, p_active => true)', [id]);
      expect((await c.query('select active from public.screw_sizes where id = $1', [id])).rows[0].active).toBe(true);
    });
  });

  it('an organizer cannot save or switch off a size, nor write the table directly', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await save(c);
      await actAs(c, users.organizer);
      await refused(c, () => save(c, { label: 'Other' }), /Only an admin/);
      await refused(c, () => c.query('select public.set_screw_size_active($1, false)', [id]), /Only an admin/);
      await refused(c, () => c.query(`insert into public.screw_sizes (brand, system, kind, label) values ('a','b','abutment_screw','c')`), /permission denied/);
    });
  });

  it('refuses a duplicate label with a user message, and bad values', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await save(c);
      await refused(c, () => save(c), /already/i);
      // Same label under the other kind is fine.
      await save(c, { kind: 'prosthetic_screw' });
      await refused(c, () => save(c, { label: 'Hot', torque: 151 }), /torque/i);
      await refused(c, () => save(c, { label: 'Cold', torque: -1 }), /torque/i);
      await refused(c, () => save(c, { label: '' }), /size/i);
      await refused(c, () => save(c, { label: 'x'.repeat(41) }), /size/i);
      await refused(c, () => save(c, { label: 'Bad kind', kind: 'cover_screw' }), /abutment|prosthetic/i);
      await refused(c, () => save(c, { id: crypto.randomUUID() }), /not found/i);
    });
  });

  it('a viewer reads sizes; a user without Patients view reads none; an admin always reads', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await save(c);
      await actAs(c, users.viewer);
      expect(await count(c, 'select 1 from public.screw_sizes where id = $1', [id])).toBe(1);
      await asPostgres(c);
      await setPerms(c, users.viewer, { inventory: 'edit' });
      await actAs(c, users.viewer);
      expect(await count(c, 'select 1 from public.screw_sizes where id = $1', [id])).toBe(0);
      await actAs(c, users.admin);
      expect(await count(c, 'select 1 from public.screw_sizes where id = $1', [id])).toBe(1);
    });
  });

  it("company B cannot read or change company A's sizes", async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await save(c);
      await asPostgres(c);
      await c.query("select set_config('request.jwt.claims', '', true)");
      const tag = Math.random().toString(36).slice(2, 8);
      const company = (await c.query('insert into public.companies (slug, name) values ($1, $2) returning id',
        [`zz-screw-${tag}`, 'Zz Screw B'])).rows[0].id as string;
      const email = `zz-screw-${tag}-admin@example.com`;
      await pendingLogin(c, email, { company, role: 'admin', fullName: 'Zz Screw admin' });
      const adminB = await insertSelfAuthUser(c, { email, companyId: company });
      await actAsBound(c, adminB, company);
      expect(await count(c, 'select 1 from public.screw_sizes')).toBe(0);
      await refused(c, () => c.query('select public.set_screw_size_active($1, false)', [id]), /not found/i);
      await refused(c, () => save(c, { id }), /not found/i);
      // The same label is free in B.
      await save(c);
    });
  });
});
