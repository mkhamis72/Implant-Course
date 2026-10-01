import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');

async function add(c: Client, full_name: string, extra: { phone?: string; file_no?: string; archived?: boolean } = {}) {
  const { rows } = await c.query(
    `insert into public.patients (full_name, phone, file_no, archived)
     values ($1, $2, coalesce($3, 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12)), $4) returning id`,
    [full_name, extra.phone ?? '', extra.file_no ?? null, extra.archived ?? false],
  );
  return rows[0].id as string;
}

async function search(c: Client, q: string, includeArchived = false): Promise<string[]> {
  const { rows } = await c.query('select full_name from public.search_patients($1, $2)', [q, includeArchived]);
  return rows.map((r) => r.full_name);
}

describe('search_patients', () => {
  it('finds by name, file number and phone digits', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await add(c, 'Zz Search Amira Fathy', { phone: '+20 100 555 1234', file_no: 'ZZ-77' });
      await add(c, 'Zz Search Omar Nabil', { phone: '01229998888' });
      expect(await search(c, 'amira')).toEqual(['Zz Search Amira Fathy']);
      expect(await search(c, 'zz-77')).toEqual(['Zz Search Amira Fathy']);
      expect(await search(c, '5551234')).toEqual(['Zz Search Amira Fathy']);
      expect(await search(c, '0122 999')).toEqual(['Zz Search Omar Nabil']);
    });
  });

  it('hides archived patients unless asked', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await add(c, 'Zz Search Archived One', { archived: true });
      expect(await search(c, 'Archived One')).toEqual([]);
      expect(await search(c, 'Archived One', true)).toEqual(['Zz Search Archived One']);
    });
  });

  it('search treats wildcard characters literally', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await add(c, 'Zz Search 100% Sure');
      await add(c, 'Zz Search Under_Score');
      await add(c, 'Zz Search Plain');
      expect(await search(c, '%')).toEqual(['Zz Search 100% Sure']);
      expect(await search(c, '_')).toEqual(['Zz Search Under_Score']);
      expect(await search(c, "a,b)'(\\")).toEqual([]);
    });
  });

  it('returns nothing for users who are not active', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await add(c, 'Zz Search Hidden');
      await actAs(c, users.inactive);
      expect(await search(c, 'Hidden')).toEqual([]);
    });
  });
});

describe('patient_history', () => {
  it('lists this patient’s changes, newest first, with the actor name — and nothing from other patients', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await add(c, 'Zz History Patient');
      const other = await add(c, 'Zz Other Patient');
      await c.query("update public.patients set phone = '0100' where id = $1", [id]);
      await c.query("update public.medical_history set diabetes = true where patient_id = $1", [id]);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'missing')", [id]);
      await c.query("insert into public.visit_notes (patient_id, text) values ($1, 'Reviewed')", [id]);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 11, 'missing')", [other]);

      const { rows } = await c.query('select table_name, action, actor from public.patient_history($1)', [id]);
      expect(rows.map((r) => `${r.table_name}:${r.action}`)).toEqual([
        'visit_notes:INSERT',
        'tooth_status:INSERT',
        'medical_history:UPDATE',
        'patients:UPDATE',
        'medical_history:INSERT',
        'patients:INSERT',
      ]);
      expect(new Set(rows.map((r) => r.actor))).toEqual(new Set(['Test Organizer']));
    });
  });
});
