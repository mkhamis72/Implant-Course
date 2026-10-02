import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function checklist(c: Client, items: string[]): Promise<string> {
  return (await c.query("select public.create_checklist('Polish probe', $1::text[]) as id", [items])).rows[0].id;
}

describe('templates', () => {
  it('a General template cannot be the automatic default', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(
        c,
        () => c.query("select public.save_template(null, 'General default', 'general', true, array['One'])"),
        /General templates are not attached automatically/,
      );
    });
  });
});

describe('checklist items', () => {
  it('can only be assigned to an active organizer', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await checklist(c, ['Call the lab']);
      await refused(
        c,
        () => c.query('update public.checklist_items set assignee_id = $1 where checklist_id = $2', [users.inactive, id]),
        /active organizer/,
      );
      const ok = await c.query('update public.checklist_items set assignee_id = $1 where checklist_id = $2 returning 1', [users.organizer, id]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it('the 200-item limit counts items, not positions', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await checklist(c, ['A', 'B', 'C']);
      await c.query("delete from public.checklist_items where checklist_id = $1 and text in ('A', 'B')", [id]);
      const more = Array.from({ length: 199 }, (_, i) => `Item ${i}`);
      await c.query('select public.add_checklist_items($1, $2::text[])', [id, more]);
      const { rows } = await c.query('select count(*)::int as n from public.checklist_items where checklist_id = $1', [id]);
      expect(rows[0].n).toBe(200);
    });
  });

  it('ticking an already ticked item keeps who ticked it first', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await checklist(c, ['Sterilise kit']);
      const item = (await c.query('select id from public.checklist_items where checklist_id = $1', [id])).rows[0].id;
      await c.query('select public.toggle_checklist_item($1, true)', [item]);
      const first = (await c.query('select done_by, done_at from public.checklist_items where id = $1', [item])).rows[0];
      await actAs(c, users.admin);
      await c.query('select public.toggle_checklist_item($1, true)', [item]);
      const after = (await c.query('select done_by, done_at from public.checklist_items where id = $1', [item])).rows[0];
      expect(after).toEqual(first);
    });
  });
});
