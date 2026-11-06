import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const pub = (c: Client) => c.query('select * from public.branding_for($1)', [ACADEMY_ID]).then((r) => r.rows[0]);
const update = (c: Client, name: string | null, brand: string | null, nav: string | null) =>
  c.query('select public.update_branding($1, $2, $3)', [name, brand, nav]);
const setLogo = (c: Client, bytes: Buffer, type = 'image/png') => c.query('select public.set_branding_logo($1, $2)', [bytes, type]);

describe('branding', () => {
  it('starts unbranded and is readable while signed out, but the tables are not', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      expect(await pub(c)).toMatchObject({ name: null, brand_color: null, nav_color: null, has_logo: false });
      expect((await c.query('select * from public.branding_logo_for($1)', [ACADEMY_ID])).rows).toEqual([]);
      await refused(c, () => c.query('select * from public.branding'), /permission denied/);
      await refused(c, () => c.query('select * from public.branding_logos'), /permission denied/);
      await refused(c, () => update(c, 'Acme Implants', null, null), /permission denied/);
    });
  });

  it('lets an admin set name, colours (normalised) and a logo; anon reads them back', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await update(c, '  Acme Implants ', '#7C2D12', ' #1e293b ');
      await setLogo(c, PNG);
      await actAs(c, null);
      const row = await pub(c);
      expect(row).toMatchObject({ name: 'Acme Implants', brand_color: '#7c2d12', nav_color: '#1e293b', has_logo: true });
      const logo = (await c.query('select * from public.branding_logo_for($1)', [ACADEMY_ID])).rows[0];
      expect(logo.content_type).toBe('image/png');
      expect(Buffer.compare(logo.bytes, PNG)).toBe(0);
    });
  });

  it('bumps the logo version on every upload and removal', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const v0 = (await pub(c)).logo_version as number;
      await setLogo(c, PNG);
      await setLogo(c, PNG, 'image/webp');
      expect((await pub(c)).logo_version).toBe(v0 + 2);
      await c.query('select public.clear_branding_logo()');
      expect(await pub(c)).toMatchObject({ logo_version: v0 + 3, has_logo: false });
      expect((await c.query('select * from public.branding_logo_for($1)', [ACADEMY_ID])).rows).toEqual([]);
    });
  });

  it('refuses non-admins, including an organizer with Edit everywhere and a delegate login', async () => {
    await withTx(async (c) => {
      for (const user of [users.organizer, users.delegate]) {
        await actAs(c, user);
        await refused(c, () => update(c, 'Acme Implants', null, null), /./);
        await refused(c, () => setLogo(c, PNG), /./);
        await refused(c, () => c.query('select public.clear_branding_logo()'), /./);
      }
      await actAs(c, users.organizer);
      await refused(c, () => update(c, 'Acme Implants', null, null), /Only an admin can change branding/);
    });
  });

  it('enforces formats and sizes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await refused(c, () => update(c, 'A', null, null), /branding_name_check/);
      await refused(c, () => update(c, null, 'red', null), /branding_brand_color_check/);
      await refused(c, () => update(c, null, null, '#12345'), /branding_nav_color_check/);
      await refused(c, () => setLogo(c, Buffer.alloc(204801, 1)), /branding_logos_bytes_check/);
      await refused(c, () => setLogo(c, PNG, 'image/svg+xml'), /branding_logos_content_type_check/);
      await update(c, '', '', '');
      expect(await pub(c)).toMatchObject({ name: null, brand_color: null, nav_color: null });
    });
  });

  it('records branding changes in the history without the logo bytes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await setLogo(c, PNG);
      await c.query('reset role');
      const { rows } = await c.query(
        `select count(*) filter (where table_name = 'branding')::int as branding,
                count(*) filter (where table_name = 'branding_logos')::int as logos,
                bool_and(not (coalesce(after, '{}'::jsonb) ? 'bytes')) as no_bytes
         from public.audit_log where table_name in ('branding', 'branding_logos')
           and at >= now()`,
      );
      expect(rows[0]).toEqual({ branding: 1, logos: 0, no_bytes: true });
    });
  });
});
