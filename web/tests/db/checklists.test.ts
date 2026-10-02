import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeSession } from './fixtures';

const users = inject('testUsers');

async function template(c: Client, name: string, scope: string, isDefault: boolean, items: string[]): Promise<string> {
  const { rows } = await c.query('select public.save_template(null, $1, $2, $3, $4::text[]) as id', [name, scope, isDefault, items]);
  return rows[0].id;
}

async function items(c: Client, checklist: string) {
  const { rows } = await c.query(
    'select text, position, done_by, done_at is not null as done from public.checklist_items where checklist_id = $1 order by position',
    [checklist],
  );
  return rows;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('templates', () => {
  it('saves items in order and replaces them on edit', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await template(c, 'Zz Lecture prep', 'lecture', false, ['  Projector ', '', 'Handouts']);
      let rows = (await c.query('select text from public.template_items where template_id = $1 order by position', [id])).rows;
      expect(rows.map((r) => r.text)).toEqual(['Projector', 'Handouts']);
      await c.query("select public.save_template($1, 'Zz Lecture prep', 'lecture', false, '{Room booked}')", [id]);
      rows = (await c.query('select text from public.template_items where template_id = $1', [id])).rows;
      expect(rows.map((r) => r.text)).toEqual(['Room booked']);
    });
  });

  it('only one default per scope', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const first = await template(c, 'Zz Surgery A', 'surgery_booking', true, ['Consent signed']);
      const second = await template(c, 'Zz Surgery B', 'surgery_booking', true, ['CBCT reviewed']);
      const { rows } = await c.query('select id from public.checklist_templates where applies_to = $1 and is_default', ['surgery_booking']);
      expect(rows.map((r) => r.id)).toEqual([second]);
      expect(first).not.toBe(second);
    });
  });

  it('item limits', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, () => template(c, 'Zz Empty', 'general', false, ['', '  ']), /Add at least one item/);
      await refused(c, () => template(c, 'Zz Long', 'general', false, ['x'.repeat(301)]), /at most 300 characters/);
      await refused(c, () => template(c, 'Zz Many', 'general', false, Array.from({ length: 201 }, (_, i) => `Item ${i}`)), /at most 200 items/);
    });
  });
});

describe('checklists', () => {
  it('creates from pasted lines and from a template, appends, and reorders', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const t = await template(c, 'Zz Kit', 'general', false, ['Sterilise kit', 'Count implants']);
      const id = (await c.query("select public.create_checklist('Zz Day 1', '{Charge motor}', $1) as id", [t])).rows[0].id;
      expect((await items(c, id)).map((r) => r.text)).toEqual(['Sterilise kit', 'Count implants', 'Charge motor']);
      await c.query("select public.add_checklist_items($1, '{Print consent forms}')", [id]);
      const last = (await c.query('select id from public.checklist_items where checklist_id = $1 order by position desc limit 1', [id])).rows[0].id;
      await c.query('select public.move_checklist_item($1, -1)', [last]);
      expect((await items(c, id)).map((r) => r.text)).toEqual(['Sterilise kit', 'Count implants', 'Print consent forms', 'Charge motor']);
      await c.query('select public.move_checklist_item($1, -1)', [
        (await c.query("select id from public.checklist_items where checklist_id = $1 and text = 'Sterilise kit'", [id])).rows[0].id,
      ]);
      expect((await items(c, id))[0].text).toBe('Sterilise kit');
    });
  });

  it('toggle records and clears who ticked; done columns cannot be forged', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = (await c.query("select public.create_checklist('Zz Tick', '{One}') as id")).rows[0].id;
      const item = (await c.query('select id from public.checklist_items where checklist_id = $1', [id])).rows[0].id;
      await c.query('select public.toggle_checklist_item($1, true)', [item]);
      expect(await items(c, id)).toEqual([{ text: 'One', position: 1, done_by: users.organizer, done: true }]);
      await actAs(c, users.admin);
      await c.query('select public.toggle_checklist_item($1, false)', [item]);
      expect(await items(c, id)).toEqual([{ text: 'One', position: 1, done_by: null, done: false }]);
      await refused(c, () => c.query('update public.checklist_items set done_by = $1, done_at = now() where id = $2', [users.admin, item]), /permission denied/);
      const edit = await c.query("update public.checklist_items set text = 'One!', due_date = '2030-01-01' where id = $1", [item]);
      expect(edit.rowCount).toBe(1);
      await c.query('delete from public.checklist_items where id = $1', [item]);
    });
  });

  it('a checklist cannot belong to both a session and a booking; inactive users see nothing', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(
        c,
        () => c.query("select public.create_checklist('Zz Both', '{x}', null, gen_random_uuid(), gen_random_uuid())"),
        /either a session or a surgery booking/,
      );
      await c.query("select public.create_checklist('Zz Visible', '{x}')");
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.checklists')).rows).toHaveLength(0);
      await expect(c.query("select public.create_checklist('Zz No', '{x}')")).rejects.toThrow(/Not allowed/);
    });
  });
});

describe('auto-attach', () => {
  it('new sessions and bookings get the default template for their kind', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await template(c, 'Zz Surgery day', 'surgery', true, ['Room ready', 'Kits sterilised']);
      await template(c, 'Zz Per patient', 'surgery_booking', true, ['Consent signed', 'CBCT reviewed']);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const day = await c.query('select id, title from public.checklists where session_id = $1', [session]);
      expect(day.rows).toHaveLength(1);
      expect((await items(c, day.rows[0].id)).map((r) => r.text)).toEqual(['Room ready', 'Kits sterilised']);

      await actAs(c, users.admin);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const d = await makeDelegate(c);
      await enroll(c, course, d);
      const slot = await book(c, { session, chair, patient: await makePatient(c), supervisor: users.organizer, placing: [d] });
      const perPatient = await c.query('select id from public.checklists where slot_id = $1', [slot]);
      expect((await items(c, perPatient.rows[0].id)).map((r) => r.text)).toEqual(['Consent signed', 'CBCT reviewed']);
    });
  });

  it('no default template means no checklist', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      // Clear any real workshop default in the dev DB (inside this rolled-back transaction).
      await c.query(
        "select public.save_template(t.id, t.name, t.applies_to, false, array(select text from public.template_items ti where ti.template_id = t.id order by position)) from public.checklist_templates t where t.applies_to = 'workshop' and t.is_default",
      );
      const course = await makeCourse(c);
      const session = await makeSession(c, course, 'workshop');
      expect((await c.query('select id from public.checklists where session_id = $1', [session])).rows).toEqual([]);
    });
  });
});
