# Plan 5 — Checklists & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers paste checklist text and get one checkbox per line; reusable templates
(per lecture / workshop / surgery session / surgery booking) attach automatically to new
sessions and bookings; any organizer can tick or untick items and everyone sees who ticked
each one and when; a Checklists section lists everything (Mine / Open / Templates); and the
Dashboard shows today's surgeries by chair, pull-list shortages for today and tomorrow,
low-stock and expiring stock, and my open checklist items.

**Architecture:** Four tables (`checklist_templates`, `template_items`, `checklists`,
`checklist_items`). Saving a template, creating a checklist, appending items, ticking and
reordering go through SECURITY DEFINER functions; item text/assignee/due date are edited
directly through column grants. Default templates attach via AFTER INSERT triggers on
`sessions` and `surgery_slots`. The paste parser lives in TypeScript (tested) and the SQL
side re-validates the cleaned lines.

**Tech Stack:** as Plans 1–4.

**Spec:** `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md` (§4.7, §5.2 step 4,
§5.9, §6 Dashboard + Checklists)
**Roadmap:** `docs/superpowers/plans/2026-10-01-roadmap.md` (Plan 5 of 5)

## Global Constraints

- All Plan 1–4 constraints apply (RLS, column grants, audit triggers, anon nothing, `hint='user'`
  errors via `userMessage`, Cairo "today", E2E rows named `E2E …`, alerts asserted in `main`,
  locate selects by role when their label wraps options).
- Template scopes: `general`, `lecture`, `workshop`, `surgery` (surgery session), `surgery_booking`.
  At most one default template per scope; making a template default un-defaults the previous one.
- Paste → items: split on newlines, trim, drop blank lines, strip leading bullets (`-`, `*`, `•`,
  `–`, `[ ]`, `[x]`, `1.`, `1)` and combinations like `- [ ]`); each remaining line is one item, in
  order; max 200 items, max 300 characters each.
- Ticking records `done_by` (the signed-in organizer) and `done_at`; unticking clears both. Only
  the tick function may write those columns. Ticked items show crossed off with "✓ Name · HH:MM".
- Items can be added (paste), edited (text, optional assignee, optional due date), moved up/down
  and deleted by any active organizer.
- A checklist belongs to a session, a surgery booking, or nothing (standalone) — never both.
- Dashboard widgets: today's surgeries by chair; pull-list shortages today and tomorrow; low-stock
  products (on hand ≤ reorder level); stock expiring within `expiry_alert_days`; my open items.

## Review Focus

1. **Pasted text with blank lines, Windows line endings, numbering, nested bullets, tabs, or 250
   lines / a 400-character line** → clean items or a clear limit message. Pinned in Task 2
   (`parseChecklistText`) and Task 1 (`item limits`).
2. **Two organizers ticking/unticking the same item** → last action wins, attribution always
   matches the current state, no stale "✓ name" on an unticked item. Pinned in Task 1 (`toggle`)
   and Task 4 (E2E two users).
3. **Forging `done_by` / `done_at` via the API** → refused. Pinned in Task 1.
4. **A session or booking created when no default template exists, or two defaults for one
   scope** → no checklist / previous default cleared. Pinned in Task 1.
5. **Dashboard on a day with no chairs, no surgeries, no stock issues and nothing assigned** →
   friendly empty states, no errors. Pinned in Task 6.

---

## File Structure (Plan 5)

```
web/supabase/migrations/0018_checklists.sql
web/tests/db/checklists.test.ts
web/tests/e2e/checklists.spec.ts, checklist-attach.spec.ts, dashboard.spec.ts
web/src/lib/checklists/parse.ts (+test)       parseChecklistText
web/src/lib/checklists/format.ts (+test)      progressOf, doneLabel, SCOPE_LABELS
web/src/lib/checklists/types.ts               ChecklistScope, Template, Checklist, ChecklistItem
web/src/lib/checklists/schemas.ts (+test)     templateSchema, newChecklistSchema, itemEditSchema, addItemsSchema
web/src/lib/schedule/queries.ts               SLOT_SELECT (moved from schedule/page.tsx)
web/src/components/nav-items.ts (+test)       + Checklists
web/src/app/(app)/checklists/
  page.tsx, new-checklist-form.tsx, actions.ts
  [id]/page.tsx, item-row.tsx, add-items-form.tsx, title-form.tsx
  templates/page.tsx, templates/template-form.tsx, templates/[id]/page.tsx, templates/new/page.tsx
web/src/app/(app)/courses/[id]/page.tsx       + checklist link per session
web/src/app/(app)/schedule/page.tsx           + checklist link per booking; uses SLOT_SELECT
web/src/app/(app)/page.tsx                    Dashboard
```

---

### Task 1: Checklist tables, functions and auto-attach (migration 0018)

**Files:**
- Create: `web/supabase/migrations/0018_checklists.sql`, `web/tests/db/checklists.test.ts`

**Interfaces:**
- Produces (SQL):
  - enum `checklist_scope` (general, lecture, workshop, surgery, surgery_booking);
  - `checklist_templates(id, name, applies_to, is_default, …)`, `template_items(id, template_id, position, text)`,
    `checklists(id, title, template_id?, session_id?, slot_id?, …)`,
    `checklist_items(id, checklist_id, position, text, assignee_id?, due_date?, done_by?, done_at?, created_at)`;
  - `public.save_template(p_template uuid, p_name text, p_applies_to checklist_scope, p_is_default boolean, p_items text[]) returns uuid`;
  - `public.create_checklist(p_title text, p_items text[] = '{}', p_template uuid = null, p_session uuid = null, p_slot uuid = null) returns uuid`;
  - `public.add_checklist_items(p_checklist uuid, p_items text[]) returns void`;
  - `public.toggle_checklist_item(p_item uuid, p_done boolean) returns void`;
  - `public.move_checklist_item(p_item uuid, p_direction int) returns void` (−1 up, +1 down);
  - triggers: new `sessions` row → default template for its type; new `surgery_slots` row → default
    `surgery_booking` template.
  - Direct writes: `checklists.title`; `checklist_items(text, assignee_id, due_date)` update; delete items;
    delete templates.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/checklists.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail** — `npm run test:db -- checklists` → FAIL (`function public.save_template … does not exist`).

- [ ] **Step 3: Migration** — `web/supabase/migrations/0018_checklists.sql`:

```sql
create type public.checklist_scope as enum ('general', 'lecture', 'workshop', 'surgery', 'surgery_booking');

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  applies_to public.checklist_scope not null default 'general',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);
create unique index checklist_templates_one_default on public.checklist_templates (applies_to) where is_default;

create table public.template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id) on delete cascade,
  position int not null,
  text text not null check (length(trim(text)) between 1 and 300),
  unique (template_id, position)
);

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  template_id uuid references public.checklist_templates (id) on delete set null,
  session_id uuid references public.sessions (id) on delete cascade,
  slot_id uuid references public.surgery_slots (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint checklists_one_owner check (num_nonnulls(session_id, slot_id) <= 1)
);
create index checklists_session_idx on public.checklists (session_id);
create index checklists_slot_idx on public.checklists (slot_id);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists (id) on delete cascade,
  position int not null,
  text text not null check (length(trim(text)) between 1 and 300),
  assignee_id uuid references public.profiles (user_id),
  due_date date,
  done_by uuid references public.profiles (user_id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  constraint checklist_items_position unique (checklist_id, position) deferrable initially deferred,
  constraint checklist_items_done_pair check ((done_by is null) = (done_at is null))
);
create index checklist_items_assignee_idx on public.checklist_items (assignee_id) where done_at is null;

create trigger checklist_templates_set_updated_at before update on public.checklist_templates for each row execute function app_private.set_updated_at();
create trigger checklists_set_updated_at before update on public.checklists for each row execute function app_private.set_updated_at();
create trigger checklist_templates_audit after insert or update or delete on public.checklist_templates for each row execute function app_private.audit_row('id');
create trigger template_items_audit after insert or update or delete on public.template_items for each row execute function app_private.audit_row('id');
create trigger checklists_audit after insert or update or delete on public.checklists for each row execute function app_private.audit_row('id');
create trigger checklist_items_audit after insert or update or delete on public.checklist_items for each row execute function app_private.audit_row('id');

revoke all on public.checklist_templates, public.template_items, public.checklists, public.checklist_items from anon;
revoke insert, update, delete, truncate on public.checklist_templates, public.template_items, public.checklists, public.checklist_items from authenticated;
grant delete on public.checklist_templates to authenticated;
grant update (title) on public.checklists to authenticated;
grant update (text, assignee_id, due_date) on public.checklist_items to authenticated;
grant delete on public.checklist_items to authenticated;

alter table public.checklist_templates enable row level security;
alter table public.template_items enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
create policy checklist_templates_select on public.checklist_templates for select to authenticated using (public.is_active_user());
create policy checklist_templates_delete on public.checklist_templates for delete to authenticated using (public.is_active_user());
create policy template_items_select on public.template_items for select to authenticated using (public.is_active_user());
create policy checklists_select on public.checklists for select to authenticated using (public.is_active_user());
create policy checklists_update on public.checklists for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy checklist_items_select on public.checklist_items for select to authenticated using (public.is_active_user());
create policy checklist_items_update on public.checklist_items for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy checklist_items_delete on public.checklist_items for delete to authenticated using (public.is_active_user());

-- Trimmed, non-empty lines with limits (the UI also parses bullets; this is the safety net).
create function app_private.clean_items(p_items text[]) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v text[];
begin
  select coalesce(array_agg(trim(x) order by ord), '{}')
  into v
  from unnest(coalesce(p_items, '{}')) with ordinality as t (x, ord)
  where length(trim(coalesce(x, ''))) > 0;
  if coalesce(array_length(v, 1), 0) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  if exists (select 1 from unnest(v) x where length(x) > 300) then
    perform app_private.fail('Each item can be at most 300 characters.');
  end if;
  return v;
end $$;

create function app_private.insert_items(p_checklist uuid, p_items text[], p_after int) returns void
language sql security definer set search_path = '' as $$
  insert into public.checklist_items (checklist_id, position, text)
  select p_checklist, p_after + ord::int, x
  from unnest(p_items) with ordinality as t (x, ord);
$$;

create function public.save_template(
  p_template uuid, p_name text, p_applies_to public.checklist_scope, p_is_default boolean, p_items text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_name, ''))) < 2 then
    perform app_private.fail('Enter the template name (at least 2 characters).');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  if p_is_default then
    update public.checklist_templates set is_default = false
    where applies_to = p_applies_to and is_default and id is distinct from p_template;
  end if;
  if p_template is null then
    insert into public.checklist_templates (name, applies_to, is_default)
    values (trim(p_name), p_applies_to, coalesce(p_is_default, false))
    returning id into v_id;
  else
    update public.checklist_templates
    set name = trim(p_name), applies_to = p_applies_to, is_default = coalesce(p_is_default, false)
    where id = p_template
    returning id into v_id;
    if v_id is null then
      perform app_private.fail('Template not found.');
    end if;
    delete from public.template_items where template_id = v_id;
  end if;
  insert into public.template_items (template_id, position, text)
  select v_id, ord::int, x from unnest(v_items) with ordinality as t (x, ord);
  return v_id;
end $$;

create function public.create_checklist(
  p_title text, p_items text[] default '{}', p_template uuid default null,
  p_session uuid default null, p_slot uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_title, ''))) < 2 then
    perform app_private.fail('Enter the checklist title (at least 2 characters).');
  end if;
  if p_session is not null and p_slot is not null then
    perform app_private.fail('A checklist belongs to either a session or a surgery booking, not both.');
  end if;
  if p_template is not null and not exists (select 1 from public.checklist_templates where id = p_template) then
    perform app_private.fail('Template not found.');
  end if;
  v_items := app_private.clean_items(
    coalesce((select array_agg(text order by position) from public.template_items where template_id = p_template), '{}')
    || coalesce(p_items, '{}')
  );
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  insert into public.checklists (title, template_id, session_id, slot_id)
  values (trim(p_title), p_template, p_session, p_slot)
  returning id into v_id;
  perform app_private.insert_items(v_id, v_items, 0);
  return v_id;
end $$;

create function public.add_checklist_items(p_checklist uuid, p_items text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_max int;
begin
  perform app_private.require_active();
  perform 1 from public.checklists where id = p_checklist for update;
  if not found then
    perform app_private.fail('Checklist not found.');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  select coalesce(max(position), 0) into v_max from public.checklist_items where checklist_id = p_checklist;
  if v_max + array_length(v_items, 1) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  perform app_private.insert_items(p_checklist, v_items, v_max);
end $$;

create function public.toggle_checklist_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  update public.checklist_items
  set done_by = case when p_done then auth.uid() end,
      done_at = case when p_done then now() end
  where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
end $$;

create function public.move_checklist_item(p_item uuid, p_direction int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.checklist_items;
  v_other public.checklist_items;
begin
  perform app_private.require_active();
  select * into v_item from public.checklist_items where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
  perform 1 from public.checklists where id = v_item.checklist_id for update;
  if p_direction < 0 then
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position < v_item.position order by position desc limit 1;
  else
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position > v_item.position order by position asc limit 1;
  end if;
  if v_other.id is null then
    return;
  end if;
  update public.checklist_items set position = v_other.position where id = v_item.id;
  update public.checklist_items set position = v_item.position where id = v_other.id;
end $$;

-- Auto-attach the default template for a scope (no-op when there is none).
create function app_private.attach_default(p_scope public.checklist_scope, p_title text, p_session uuid, p_slot uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_template uuid;
  v_id uuid;
begin
  select id into v_template from public.checklist_templates where applies_to = p_scope and is_default;
  if v_template is null then
    return;
  end if;
  insert into public.checklists (title, template_id, session_id, slot_id)
  values (left(p_title, 120), v_template, p_session, p_slot)
  returning id into v_id;
  perform app_private.insert_items(
    v_id, (select array_agg(text order by position) from public.template_items where template_id = v_template), 0
  );
end $$;

create function app_private.session_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.attach_default(new.type::text::public.checklist_scope, new.title || ' — checklist', new.id, null);
  return new;
end $$;

create function app_private.slot_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.attach_default(
    'surgery_booking',
    'Surgery checklist — ' || coalesce((select full_name from public.patients where id = new.patient_id), 'patient'),
    null, new.id
  );
  return new;
end $$;

create trigger sessions_attach_checklist after insert on public.sessions
  for each row execute function app_private.session_checklist();
create trigger surgery_slots_attach_checklist after insert on public.surgery_slots
  for each row execute function app_private.slot_checklist();

revoke execute on function public.save_template(uuid, text, public.checklist_scope, boolean, text[]) from public, anon;
revoke execute on function public.create_checklist(text, text[], uuid, uuid, uuid) from public, anon;
revoke execute on function public.add_checklist_items(uuid, text[]) from public, anon;
revoke execute on function public.toggle_checklist_item(uuid, boolean) from public, anon;
revoke execute on function public.move_checklist_item(uuid, int) from public, anon;
grant execute on function public.save_template(uuid, text, public.checklist_scope, boolean, text[]) to authenticated;
grant execute on function public.create_checklist(text, text[], uuid, uuid, uuid) to authenticated;
grant execute on function public.add_checklist_items(uuid, text[]) to authenticated;
grant execute on function public.toggle_checklist_item(uuid, boolean) to authenticated;
grant execute on function public.move_checklist_item(uuid, int) to authenticated;
```

- [ ] **Step 4: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0018_checklists.sql web/tests/db/checklists.test.ts
git commit -m "feat(db): checklists, templates, ticking with attribution and auto-attach" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Checklist domain logic (TypeScript)

**Files:**
- Create: `web/src/lib/checklists/{parse,format,types,schemas}.ts`
- Test: `web/src/lib/checklists/{parse,format,schemas}.test.ts`

**Interfaces:**
- Produces: `parseChecklistText(text): string[]`; `progressOf(items): { done: number; total: number; label: string }`;
  `doneLabel(name, at, today?): string`; `SCOPES`, `ChecklistScope`, `SCOPE_LABELS`; types `Template`,
  `ChecklistItem`, `ChecklistSummary`; `templateSchema`, `newChecklistSchema`, `itemEditSchema`, `addItemsSchema`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/checklists/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseChecklistText } from './parse';

describe('parseChecklistText', () => {
  it('turns each non-blank line into an item', () => {
    expect(parseChecklistText('Consent signed\r\n\r\n  CBCT reviewed  \n\tKits sterilised\n')).toEqual([
      'Consent signed', 'CBCT reviewed', 'Kits sterilised',
    ]);
  });
  it('strips bullets, numbering and task boxes', () => {
    expect(
      parseChecklistText('- One\n* Two\n• Three\n– Four\n1. Five\n2) Six\n[ ] Seven\n[x] Eight\n- [ ] Nine\n  - [X] Ten'),
    ).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']);
  });
  it('keeps hyphens and numbers inside the text', () => {
    expect(parseChecklistText('3-month review\n10 implants counted\nX-ray taken')).toEqual([
      '3-month review', '10 implants counted', 'X-ray taken',
    ]);
  });
  it('drops lines that were only a bullet', () => {
    expect(parseChecklistText('-\n* \n[ ]\nReal')).toEqual(['Real']);
  });
});
```

`web/src/lib/checklists/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { doneLabel, progressOf } from './format';

describe('checklist format', () => {
  it('summarises progress', () => {
    expect(progressOf([{ done_at: 'x' }, { done_at: null }, { done_at: 'y' }])).toEqual({ done: 2, total: 3, label: '2/3 done' });
    expect(progressOf([])).toEqual({ done: 0, total: 0, label: 'No items' });
  });
  it('labels who ticked and when (time today, date otherwise, Cairo)', () => {
    expect(doneLabel('Dr Amira', '2026-01-15T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 12:05');
    expect(doneLabel('Dr Amira', '2026-01-14T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 14 Jan 2026, 12:05');
  });
});
```

`web/src/lib/checklists/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addItemsSchema, newChecklistSchema, templateSchema } from './schemas';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('checklist schemas', () => {
  it('parses pasted items', () => {
    expect(templateSchema.parse({ name: ' Surgery ', applies_to: 'surgery_booking', is_default: 'on', items: '- A\n- B' })).toEqual({
      id: null, name: 'Surgery', applies_to: 'surgery_booking', is_default: true, items: ['A', 'B'],
    });
    expect(newChecklistSchema.parse({ title: 'Day 1', items: '1. Room', template_id: '' })).toEqual({
      title: 'Day 1', items: ['Room'], template_id: null,
    });
  });
  it('needs items unless a template is chosen', () => {
    expect(err(newChecklistSchema.safeParse({ title: 'Day 1', items: '  \n' }))).toBe('Add at least one item (one per line) or choose a template.');
    expect(newChecklistSchema.safeParse({ title: 'Day 1', items: '', template_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' }).success).toBe(true);
    expect(err(addItemsSchema.safeParse({ checklist_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', items: '' }))).toBe(
      'Add at least one item (one per line).',
    );
  });
  it('enforces limits with clear messages', () => {
    expect(err(templateSchema.safeParse({ name: 'T', applies_to: 'general', items: 'a' }))).toBe('Enter the template name (at least 2 characters).');
    expect(err(templateSchema.safeParse({ name: 'Too long', applies_to: 'general', items: 'x'.repeat(301) }))).toBe(
      'Each item can be at most 300 characters.',
    );
    expect(err(templateSchema.safeParse({ name: 'Too many', applies_to: 'general', items: Array.from({ length: 201 }, (_, i) => `i${i}`).join('\n') }))).toBe(
      'A checklist can have at most 200 items.',
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (unresolved imports).

- [ ] **Step 3: Implement**

`web/src/lib/checklists/parse.ts`:
```ts
// "- ", "* ", "• ", "– ", "1. ", "2) ", "[ ]", "[x]" — possibly combined, e.g. "- [ ] item".
const BULLET = /^(?:[-*•–]\s+|\d+[.)]\s+|\[[ xX]?\]\s*)/;

/** One item per non-blank line, with leading bullets / numbering / task boxes removed. */
export function parseChecklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let s = line.trim();
      for (let i = 0; i < 3 && BULLET.test(s); i++) s = s.replace(BULLET, '').trim();
      if (/^(?:[-*•–]|\[[ xX]?\])$/.test(s)) return '';
      return s;
    })
    .filter((s) => s.length > 0);
}
```

`web/src/lib/checklists/types.ts`:
```ts
export const SCOPES = ['general', 'lecture', 'workshop', 'surgery', 'surgery_booking'] as const;
export type ChecklistScope = (typeof SCOPES)[number];

export type Template = { id: string; name: string; applies_to: ChecklistScope; is_default: boolean; items: { text: string; position: number }[] };

export type ChecklistItem = {
  id: string;
  position: number;
  text: string;
  assignee_id: string | null;
  due_date: string | null;
  done_at: string | null;
  done_by_profile: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
};

export type ChecklistSummary = {
  id: string;
  title: string;
  session: { id: string; title: string; date: string; course_id: string } | null;
  slot: { id: string; starts_at: string; patient: { full_name: string } | null } | null;
  items: { done_at: string | null; assignee_id: string | null }[];
};
```

`web/src/lib/checklists/format.ts`:
```ts
import { formatDateTime, formatTime } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import type { ChecklistScope } from './types';

export const SCOPE_LABELS: Record<ChecklistScope, string> = {
  general: 'General',
  lecture: 'Lecture',
  workshop: 'Workshop',
  surgery: 'Surgery session',
  surgery_booking: 'Surgery booking (per patient)',
};

export function progressOf(items: readonly { done_at: string | null }[]): { done: number; total: number; label: string } {
  const done = items.filter((i) => i.done_at).length;
  return { done, total: items.length, label: items.length ? `${done}/${items.length} done` : 'No items' };
}

/** "✓ Name · 14:32" when ticked today (Cairo), otherwise with the date. */
export function doneLabel(name: string, at: string, today: string = todayIso()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(at));
  return `✓ ${name} · ${day === today ? formatTime(at) : formatDateTime(at)}`;
}
```

`web/src/lib/checklists/schemas.ts`:
```ts
import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { parseChecklistText } from './parse';
import { SCOPES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());

function itemsField(required: boolean, emptyMessage: string) {
  return z
    .string()
    .default('')
    .transform((v, ctx) => {
      const items = parseChecklistText(v);
      if (required && items.length === 0) ctx.addIssue({ code: 'custom', message: emptyMessage });
      if (items.length > 200) ctx.addIssue({ code: 'custom', message: 'A checklist can have at most 200 items.' });
      if (items.some((i) => i.length > 300)) ctx.addIssue({ code: 'custom', message: 'Each item can be at most 300 characters.' });
      return items;
    });
}

export const templateSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, { message: 'Enter the template name (at least 2 characters).' }).max(120),
  applies_to: z.enum(SCOPES, { message: 'Choose what the template is for.' }),
  is_default: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  items: itemsField(true, 'Add at least one item (one per line).'),
});

export const newChecklistSchema = z
  .object({
    title: z.string().trim().min(2, { message: 'Enter the checklist title (at least 2 characters).' }).max(120),
    items: itemsField(false, ''),
    template_id: optionalId,
  })
  .refine((c) => c.items.length > 0 || c.template_id !== null, {
    message: 'Add at least one item (one per line) or choose a template.',
  });

export const addItemsSchema = z.object({
  checklist_id: z.string().uuid(),
  items: itemsField(true, 'Add at least one item (one per line).'),
});

export const itemEditSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1, { message: 'The item cannot be empty.' }).max(300, { message: 'Each item can be at most 300 characters.' }),
  assignee_id: optionalId,
  due_date: z.preprocess(blankToNull, z.string().refine(isRealDate, { message: 'Enter a valid due date or leave it empty.' }).nullable()),
});
```

Note: `newChecklistSchema.parse(...)` returns `{ title, items, template_id }` (no `id`) — matches the test.

- [ ] **Step 4: Run unit tests** — `npm test` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/checklists
git commit -m "feat(checklists): paste parser, progress and attribution labels, validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Templates pages

**Files:**
- Create: `web/src/app/(app)/checklists/actions.ts`, `checklists/templates/{page,template-form}.tsx`,
  `checklists/templates/new/page.tsx`, `checklists/templates/[id]/page.tsx`, `web/tests/e2e/checklists.spec.ts`
- Modify: `web/src/components/nav-items.ts` (+ test)

**Interfaces:**
- Produces: actions `saveTemplate(prev, fd)`, `deleteTemplate(fd)` (and later in Task 4: `createChecklist`, `addItems`,
  `toggleItem`, `moveItem`, `editItem`, `deleteItem`, `renameChecklist`); nav gains **Checklists** after Courses.

- [ ] **Step 1: Nav (test first)** — expected lists become
  `['Dashboard', 'Patients', 'Schedule', 'Courses', 'Checklists', 'Inventory', 'Delegates', 'Admin']` (admin) and the same
  without Admin. Run → FAIL. Insert after Courses: `{ href: '/checklists', label: 'Checklists' },`. Run → PASS.

- [ ] **Step 2: Write the failing E2E test** — `web/tests/e2e/checklists.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('creates a template by pasting text, then edits it', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.getByRole('link', { name: 'Checklists' }).click();
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('link', { name: 'New template' }).click();
  const name = uniqueName('Template');
  await page.getByLabel('Template name').fill(name);
  await page.getByRole('combobox', { name: 'Used for', exact: true }).selectOption('lecture');
  await page.getByLabel('Items (one per line)').fill('- Projector tested\n\n2. Handouts printed\n[ ] Attendance sheet');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByTestId('template-item')).toHaveText(['Projector tested', 'Handouts printed', 'Attendance sheet']);
  await page.getByLabel('Items (one per line)').fill('Projector tested\nMicrophone charged');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByTestId('template-item')).toHaveText(['Projector tested', 'Microphone charged']);
});
```

Run → FAIL.

- [ ] **Step 3: Implement**

`web/src/app/(app)/checklists/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { addItemsSchema, itemEditSchema, newChecklistSchema, templateSchema } from '@/lib/checklists/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

type Result = { error?: string };

export async function saveTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_template', {
    p_template: t.id, p_name: t.name, p_applies_to: t.applies_to, p_is_default: t.is_default, p_items: t.items,
  });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/checklists/templates');
  if (!t.id) redirect(`/checklists/templates/${data}`);
  revalidatePath(`/checklists/templates/${t.id}`);
  return { ok: 'Template saved.' };
}

export async function deleteTemplate(formData: FormData): Promise<void> {
  await requireActiveUser();
  const supabase = await createClient();
  await supabase.from('checklist_templates').delete().eq('id', String(formData.get('id') ?? ''));
  revalidatePath('/checklists/templates');
  redirect('/checklists/templates');
}

export async function createChecklist(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = newChecklistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_checklist', { p_title: c.title, p_items: c.items, p_template: c.template_id });
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/checklists/${data}`);
}

export async function addItems(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = addItemsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_checklist_items', { p_checklist: parsed.data.checklist_id, p_items: parsed.data.items });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/checklists/${parsed.data.checklist_id}`);
  return { ok: 'Items added.' };
}

export async function renameChecklist(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (title.length < 2) return failed('Enter the checklist title (at least 2 characters).', formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('checklists').update({ title }).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Checklist not found.', formData);
  revalidatePath(`/checklists/${id}`);
  return { ok: 'Saved.' };
}

export async function toggleItem(input: { id: string; checklistId: string; done: boolean }): Promise<Result> {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('toggle_checklist_item', { p_item: input.id, p_done: input.done });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

export async function moveItem(input: { id: string; checklistId: string; direction: -1 | 1 }): Promise<Result> {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_checklist_item', { p_item: input.id, p_direction: input.direction });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

export async function editItem(input: Record<string, unknown> & { checklistId: string }): Promise<Result> {
  await requireActiveUser();
  const parsed = itemEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from('checklist_items').update(fields).eq('id', id).select('id');
  if (error || !data?.length) return { error: userMessage(error) ?? 'Item not found.' };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

export async function deleteItem(input: { id: string; checklistId: string }): Promise<Result> {
  await requireActiveUser();
  const supabase = await createClient();
  const { error } = await supabase.from('checklist_items').delete().eq('id', input.id);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}
```

`web/src/app/(app)/checklists/templates/template-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { SCOPE_LABELS } from '@/lib/checklists/format';
import { SCOPES, type Template } from '@/lib/checklists/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { saveTemplate } from '../actions';

export function TemplateForm({ template }: { template?: Template }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTemplate, {});
  const itemsText = template ? template.items.map((i) => i.text).join('\n') : '';
  return (
    <form action={action} className="card max-w-3xl space-y-4">
      {template && <input type="hidden" name="id" value={template.id} readOnly />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Template name</span>
          <input className="input" name="name" defaultValue={valueOf(state, 'name', template?.name ?? '')} />
        </label>
        <label className="block">
          <span className="label">Used for</span>
          <select className="input" name="applies_to" defaultValue={valueOf(state, 'applies_to', template?.applies_to ?? 'general')}>
            {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_default" defaultChecked={checkedOf(state, 'is_default', template?.is_default ?? false)} />
        Attach automatically to every new session / booking of this kind
      </label>
      <label className="block">
        <span className="label">Items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={10} defaultValue={valueOf(state, 'items', itemsText)} />
      </label>
      <p className="text-xs text-gray-500">Paste a list: bullets, numbers and [ ] boxes are removed automatically.</p>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>Save template</button>
    </form>
  );
}
```

`web/src/app/(app)/checklists/templates/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SCOPE_LABELS } from '@/lib/checklists/format';
import type { ChecklistScope } from '@/lib/checklists/types';

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('checklist_templates')
    .select('id, name, applies_to, is_default, items:template_items(count)')
    .order('applies_to')
    .order('name');
  if (error) throw new Error('Could not load templates');
  const templates = (data ?? []) as unknown as { id: string; name: string; applies_to: ChecklistScope; is_default: boolean; items: { count: number }[] }[];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Checklist templates</h1>
        <Link href="/checklists/templates/new" className="btn">New template</Link>
      </div>
      <ul className="card divide-y divide-gray-100">
        {templates.length === 0 && <li className="text-gray-600">No templates yet.</li>}
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
            <Link href={`/checklists/templates/${t.id}`} className="font-medium text-blue-700 hover:underline">{t.name}</Link>
            <span>{SCOPE_LABELS[t.applies_to]}</span>
            <span className="text-gray-600">{t.items[0]?.count ?? 0} items</span>
            {t.is_default && <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-800">Attaches automatically</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`web/src/app/(app)/checklists/templates/new/page.tsx`:
```tsx
import { TemplateForm } from '../template-form';

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New template</h1>
      <TemplateForm />
    </div>
  );
}
```

`web/src/app/(app)/checklists/templates/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { Template } from '@/lib/checklists/types';
import { TemplateForm } from '../template-form';
import { deleteTemplate } from '../../actions';

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from('checklist_templates')
    .select('id, name, applies_to, is_default, items:template_items(text, position)')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Template;
  t.items.sort((a, b) => a.position - b.position);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.name}</h1>
      <ol className="card list-decimal space-y-1 pl-8 text-sm">
        {t.items.map((i) => <li key={i.position} data-testid="template-item">{i.text}</li>)}
      </ol>
      <TemplateForm key={t.items.map((i) => i.text).join('|')} template={t} />
      <form action={deleteTemplate}>
        <input type="hidden" name="id" value={t.id} />
        <button className="text-sm text-red-700 hover:underline">Delete template</button>
      </form>
    </div>
  );
}
```

Note: the `key` on `TemplateForm` remounts it after a save so the textarea shows the saved items; a
failed save keeps the key and the typed values.

- [ ] **Step 4: Run** — `npm run test:e2e -- checklists.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(checklists): templates created by pasting a list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Checklists section and the checklist page

**Files:**
- Create: `web/src/app/(app)/checklists/{page,new-checklist-form}.tsx`,
  `checklists/[id]/{page,item-row,add-items-form,title-form}.tsx`
- Test: `web/tests/e2e/checklists.spec.ts` (append)

**Interfaces:**
- Consumes: Task 3 actions, `progressOf`, `doneLabel`, `ChecklistItem`, `ChecklistSummary`.
- Produces: `/checklists?view=open|mine|all`; checklist page items `data-testid="checklist-item"` with a
  checkbox named by the item text.

- [ ] **Step 1: Append the failing E2E tests** to `web/tests/e2e/checklists.spec.ts`:

```ts
test('creates a checklist by pasting, two organizers tick and untick with attribution', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, TEST_USERS.organizer.email);
  await login(b, TEST_USERS.admin.email);

  await a.goto('/checklists');
  const title = uniqueName('Checklist');
  await a.getByLabel('Title').fill(title);
  await a.getByLabel('Items (one per line)').fill('* Implants counted\n* Motor charged\n* Consent forms printed');
  await a.getByRole('button', { name: 'Create checklist' }).click();
  await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(a.getByTestId('checklist-progress')).toHaveText('0/3 done');

  await a.getByRole('checkbox', { name: 'Motor charged' }).check();
  await expect(a.getByTestId('checklist-item').nth(1)).toContainText(/✓ Test Organizer · \d\d:\d\d/);
  await expect(a.getByTestId('checklist-progress')).toHaveText('1/3 done');

  await b.goto(a.url());
  await expect(b.getByRole('checkbox', { name: 'Motor charged' })).toBeChecked();
  await expect(b.getByTestId('checklist-item').nth(1)).toContainText('✓ Test Organizer');
  await b.getByRole('checkbox', { name: 'Motor charged' }).uncheck();
  await expect(b.getByTestId('checklist-item').nth(1)).not.toContainText('✓');

  await a.reload();
  await expect(a.getByRole('checkbox', { name: 'Motor charged' })).not.toBeChecked();
  await a.close();
  await b.close();
});

test('adds, edits, assigns, reorders and deletes items; "Mine" lists my open items', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/checklists');
  const title = uniqueName('Edit list');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Items (one per line)').fill('First\nSecond');
  await page.getByRole('button', { name: 'Create checklist' }).click();

  await page.getByLabel('Add items (one per line)').fill('Third');
  await page.getByRole('button', { name: 'Add items' }).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(3);

  const third = page.getByTestId('checklist-item').nth(2);
  await third.getByRole('button', { name: 'Move up' }).click();
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText('Third');

  const item = page.getByTestId('checklist-item').nth(1);
  await item.getByRole('button', { name: 'Edit' }).click();
  await item.getByLabel('Item text').fill('Third (edited)');
  await item.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption({ label: 'Test Organizer' });
  await item.getByLabel('Due date').fill('2031-01-15');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText('Third (edited)');
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText('Test Organizer');

  await page.goto('/checklists?view=mine');
  await expect(page.getByTestId('my-item').filter({ hasText: 'Third (edited)' })).toBeVisible();

  await page.getByTestId('my-item').filter({ hasText: 'Third (edited)' }).getByRole('link').click();
  await page.getByTestId('checklist-item').first().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);
});

test('pasting nothing is refused with a clear message', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/checklists');
  await page.getByLabel('Title').fill(uniqueName('Empty'));
  await page.getByLabel('Items (one per line)').fill('\n  \n- \n');
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Add at least one item (one per line) or choose a template.');
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`web/src/app/(app)/checklists/new-checklist-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { Option } from '@/lib/inventory/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { createChecklist } from './actions';

export function NewChecklistForm({ templates }: { templates: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createChecklist, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">New checklist</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Title</span>
          <input className="input" name="title" defaultValue={valueOf(state, 'title', '')} />
        </label>
        <label className="block">
          <span className="label">Start from template (optional)</span>
          <select className="input" name="template_id" defaultValue={valueOf(state, 'template_id', '')}>
            <option value="">No template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={5} defaultValue={valueOf(state, 'items', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>Create checklist</button>
    </form>
  );
}
```

`web/src/app/(app)/checklists/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { formatDate, formatDateTime } from '@/lib/format';
import { progressOf } from '@/lib/checklists/format';
import type { ChecklistSummary } from '@/lib/checklists/types';
import { NewChecklistForm } from './new-checklist-form';

const SUMMARY_SELECT = `
  id, title,
  session:sessions(id, title, date, course_id),
  slot:surgery_slots(id, starts_at, patient:patients(full_name)),
  items:checklist_items(done_at, assignee_id)
`;

function attachedTo(c: ChecklistSummary): string {
  if (c.session) return `Session · ${c.session.title} · ${formatDate(c.session.date)}`;
  if (c.slot) return `Surgery · ${c.slot.patient?.full_name ?? ''} · ${formatDateTime(c.slot.starts_at)}`;
  return 'Standalone';
}

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = 'open' } = await searchParams;
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [{ data: lists, error }, { data: templates }, { data: mine }] = await Promise.all([
    supabase.from('checklists').select(SUMMARY_SELECT).order('created_at', { ascending: false }).limit(300),
    supabase.from('checklist_templates').select('id, name').order('name'),
    supabase
      .from('checklist_items')
      .select('id, text, due_date, checklist:checklists(id, title)')
      .eq('assignee_id', me?.user_id ?? '')
      .is('done_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);
  if (error) throw new Error('Could not load checklists');
  const all = (lists ?? []) as unknown as ChecklistSummary[];
  const shown = view === 'all' ? all : all.filter((c) => c.items.some((i) => !i.done_at));
  const myItems = (mine ?? []) as unknown as { id: string; text: string; due_date: string | null; checklist: { id: string; title: string } }[];
  const tab = (key: string, label: string) => (
    <Link
      href={`/checklists?view=${key}`}
      aria-current={view === key ? 'page' : undefined}
      className={`border-b-2 px-3 py-2 text-sm ${view === key ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-gray-600'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Checklists</h1>
      <nav aria-label="Checklist views" className="flex gap-1 border-b border-gray-200">
        {tab('open', 'Open')}
        {tab('mine', 'Mine')}
        {tab('all', 'All')}
        <Link href="/checklists/templates" className="border-b-2 border-transparent px-3 py-2 text-sm text-gray-600">Templates</Link>
      </nav>
      {view === 'mine' ? (
        <ul className="card divide-y divide-gray-100">
          {myItems.length === 0 && <li className="text-gray-600">Nothing assigned to you is open.</li>}
          {myItems.map((i) => (
            <li key={i.id} data-testid="my-item" className="flex flex-wrap gap-x-6 py-2 text-sm">
              <span className="font-medium">{i.text}</span>
              <Link href={`/checklists/${i.checklist.id}`} className="text-blue-700 hover:underline">{i.checklist.title}</Link>
              {i.due_date && <span className="text-gray-600">due {formatDate(i.due_date)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="card divide-y divide-gray-100">
          {shown.length === 0 && <li className="text-gray-600">No checklists here.</li>}
          {shown.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
              <Link href={`/checklists/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.title}</Link>
              <span className="text-gray-600">{attachedTo(c)}</span>
              <span>{progressOf(c.items).label}</span>
            </li>
          ))}
        </ul>
      )}
      <NewChecklistForm templates={(templates ?? []).map((t) => ({ id: t.id as string, label: t.name as string }))} />
    </div>
  );
}
```

`web/src/app/(app)/checklists/[id]/item-row.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { doneLabel } from '@/lib/checklists/format';
import type { ChecklistItem } from '@/lib/checklists/types';
import type { Option } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { deleteItem, editItem, moveItem, toggleItem } from '../actions';

export function ItemRow({ item, checklistId, organizers, first, last }: {
  item: ChecklistItem; checklistId: string; organizers: Option[]; first: boolean; last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [assignee, setAssignee] = useState(item.assignee_id ?? '');
  const [due, setDue] = useState(item.due_date ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = Boolean(item.done_at);
  const who = item.done_by_profile?.full_name || item.done_by_profile?.email || 'someone';

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  };

  return (
    <li data-testid="checklist-item" className="space-y-1 border-t border-gray-100 py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-6 w-6 shrink-0"
          aria-label={item.text}
          checked={done}
          disabled={pending}
          onChange={(e) => run(() => toggleItem({ id: item.id, checklistId, done: e.target.checked }))}
        />
        <div className="flex-1">
          <p className={done ? 'text-gray-500 line-through' : ''}>{item.text}</p>
          <p className="text-xs text-gray-600">
            {done && item.done_at && <span className="mr-3 text-green-800">{doneLabel(who, item.done_at)}</span>}
            {item.assignee && <span className="mr-3">→ {item.assignee.full_name || item.assignee.email}</span>}
            {item.due_date && <span>due {formatDate(item.due_date)}</span>}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 text-xs">
          <button className="btn-secondary btn px-2 py-0.5" disabled={first || pending} onClick={() => run(() => moveItem({ id: item.id, checklistId, direction: -1 }))}>
            Move up
          </button>
          <button className="btn-secondary btn px-2 py-0.5" disabled={last || pending} onClick={() => run(() => moveItem({ id: item.id, checklistId, direction: 1 }))}>
            Move down
          </button>
          <button className="btn-secondary btn px-2 py-0.5" onClick={() => setEditing((e) => !e)}>Edit</button>
          <button className="btn-secondary btn px-2 py-0.5 text-red-700" disabled={pending} onClick={() => run(() => deleteItem({ id: item.id, checklistId }))}>
            Delete
          </button>
        </div>
      </div>
      {editing && (
        <form
          className="ml-9 grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => editItem({ id: item.id, checklistId, text, assignee_id: assignee, due_date: due }), () => setEditing(false));
          }}
        >
          <label className="block sm:col-span-2">
            <span className="sr-only">Item text</span>
            <input className="input py-1" aria-label="Item text" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <select className="input py-1" aria-label="Assigned to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody</option>
            {organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input className="input py-1" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn py-1 sm:col-span-4 sm:w-24" disabled={pending}>Save</button>
        </form>
      )}
      {error && <p role="alert" className="ml-9 text-sm text-red-700">{error}</p>}
    </li>
  );
}
```

`web/src/app/(app)/checklists/[id]/add-items-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { addItems } from '../actions';

export function AddItemsForm({ checklistId }: { checklistId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addItems, {});
  return (
    <form action={action} className="card space-y-2" key={state.ok}>
      <input type="hidden" name="checklist_id" value={checklistId} readOnly />
      <label className="block">
        <span className="label">Add items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={3} defaultValue={valueOf(state, 'items', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-secondary btn" disabled={pending}>Add items</button>
    </form>
  );
}
```

`web/src/app/(app)/checklists/[id]/title-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { renameChecklist } from '../actions';

export function TitleForm({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(renameChecklist, {});
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-gray-600">Rename</summary>
      <form action={action} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} readOnly />
        <input className="input max-w-md" name="title" aria-label="Checklist title" defaultValue={title} />
        <button className="btn-secondary btn" disabled={pending}>Save title</button>
        {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      </form>
    </details>
  );
}
```

`web/src/app/(app)/checklists/[id]/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime } from '@/lib/format';
import { progressOf } from '@/lib/checklists/format';
import type { ChecklistItem } from '@/lib/checklists/types';
import { ItemRow } from './item-row';
import { AddItemsForm } from './add-items-form';
import { TitleForm } from './title-form';

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: checklist }, { data: organizers }] = await Promise.all([
    supabase
      .from('checklists')
      .select(`
        id, title,
        session:sessions(id, title, date, course_id),
        slot:surgery_slots(id, starts_at, patient:patients(id, full_name)),
        items:checklist_items(
          id, position, text, assignee_id, due_date, done_at,
          done_by_profile:profiles!checklist_items_done_by_fkey(full_name, email),
          assignee:profiles!checklist_items_assignee_id_fkey(full_name, email)
        )
      `)
      .eq('id', id)
      .maybeSingle(),
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).order('full_name'),
  ]);
  if (!checklist) notFound();
  const c = checklist as unknown as {
    id: string; title: string;
    session: { id: string; title: string; date: string; course_id: string } | null;
    slot: { id: string; starts_at: string; patient: { id: string; full_name: string } | null } | null;
    items: ChecklistItem[];
  };
  const items = [...c.items].sort((a, b) => a.position - b.position);
  const options = (organizers ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string }));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-gray-600">
          {c.session && (
            <Link href={`/courses/${c.session.course_id}`} className="text-blue-700 hover:underline">
              Session · {c.session.title} · {formatDate(c.session.date)}
            </Link>
          )}
          {c.slot && (
            <Link href={`/schedule?date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(c.slot.starts_at))}`} className="text-blue-700 hover:underline">
              Surgery · {c.slot.patient?.full_name} · {formatDateTime(c.slot.starts_at)}
            </Link>
          )}
          {!c.session && !c.slot && 'Standalone checklist'}
          <span data-testid="checklist-progress" className="ml-4 font-medium">{progressOf(items).label}</span>
        </p>
        <TitleForm id={c.id} title={c.title} />
      </div>
      <ul className="card">
        {items.length === 0 && <li className="text-gray-600">No items yet.</li>}
        {items.map((item, i) => (
          <ItemRow key={item.id} item={item} checklistId={c.id} organizers={options} first={i === 0} last={i === items.length - 1} />
        ))}
      </ul>
      <AddItemsForm checklistId={c.id} />
    </div>
  );
}
```

- [ ] **Step 3: Run** — `npm run test:e2e -- checklists.spec.ts` → PASS (4).

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(checklists): checklists section, tick/untick with attribution, edit, assign, reorder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Checklists on sessions and bookings

**Files:**
- Create: `web/src/lib/schedule/queries.ts`, `web/tests/e2e/checklist-attach.spec.ts`
- Modify: `web/src/app/(app)/schedule/page.tsx` (use `SLOT_SELECT`; checklist link + progress per booking),
  `web/src/app/(app)/courses/[id]/page.tsx` (checklist link + progress per session),
  `web/src/lib/schedule/types.ts` (`SlotRow.checklists`)

**Interfaces:**
- Produces: `SLOT_SELECT` (adds `checklists(id, items:checklist_items(done_at))`); booking cards and session rows
  show a link `Checklist 2/5 done`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/checklist-attach.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

test('default templates attach to new sessions and bookings', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const dayItem = uniqueName('Room ready');
  const patientItem = uniqueName('Consent signed');
  for (const [scope, item] of [['surgery', dayItem], ['surgery_booking', patientItem]] as const) {
    const { error } = await api.rpc('save_template', {
      p_template: null, p_name: uniqueName(`Default ${scope}`), p_applies_to: scope, p_is_default: true, p_items: [item],
    });
    expect(error).toBeNull();
  }
  const day = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: uniqueName('Surgery day'), date: day });
  const chairId = await seedChair(admin, uniqueName('Chair'));
  const delegate = await seedDelegate(api, uniqueName('Dr Attach'));
  await enroll(api, courseId, delegate);

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Attach patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '08:00', p_end: '09:00', p_patient: patientId, p_supervisor: me,
    p_placing: [delegate], p_override_reason: 'E2E',
  });
  expect(error).toBeNull();

  await page.goto(`/courses/${courseId}`);
  await page.getByTestId('session-row').getByRole('link', { name: /Checklist 0\/1 done/ }).click();
  await expect(page.getByRole('checkbox', { name: dayItem })).toBeVisible();

  await page.goto(`/schedule?date=${day}`);
  const card = page.locator('[data-testid^="booking-"]').filter({ has: page.getByRole('link', { name: /Attach patient/ }) });
  await card.getByRole('link', { name: /Checklist 0\/1 done/ }).click();
  await page.getByRole('checkbox', { name: patientItem }).check();
  await expect(page.getByTestId('checklist-progress')).toHaveText('1/1 done');
});
```

Note for teardown: these defaults stay in the dev DB as the current defaults until replaced; that is
harmless (the names are `E2E …`) and each run makes its own new defaults.

Run → FAIL.

- [ ] **Step 2: Implement**

`web/src/lib/schedule/queries.ts`:
```ts
export const SLOT_SELECT = `
  id, starts_at, ends_at, status, override_reason, cancel_reason, chair_id,
  patient:patients(id, full_name, file_no),
  supervisor:profiles!surgery_slots_supervisor_id_fkey(full_name, email),
  session:sessions(title, course:courses(name)),
  delegates:slot_delegates(role, delegate:delegates(full_name)),
  implants:slot_planned_implants(tooth, product:products(*)),
  checklists(id, items:checklist_items(done_at))
`;
```

In `web/src/lib/schedule/types.ts` add to `SlotRow`: `checklists: { id: string; items: { done_at: string | null }[] }[];`

In `web/src/app/(app)/schedule/page.tsx`: delete the local `SLOT_SELECT` constant, import it from
`@/lib/schedule/queries`, import `progressOf` from `@/lib/checklists/format`, and inside the live booking card,
after the "Assisting" line, add:

```tsx
                  {b.checklists.map((cl) => (
                    <Link key={cl.id} href={`/checklists/${cl.id}`} className="block text-blue-800 hover:underline">
                      Checklist {progressOf(cl.items).label}
                    </Link>
                  ))}
```

In `web/src/app/(app)/courses/[id]/page.tsx`: change the sessions query to
`supabase.from('sessions').select('*, checklists(id, items:checklist_items(done_at))')…` (same filters/order),
type the rows as `(Session & { checklists: { id: string; items: { done_at: string | null }[] }[] })[]`, import
`progressOf`, and inside each `session-row` add:

```tsx
              {s.checklists.map((cl) => (
                <Link key={cl.id} href={`/checklists/${cl.id}`} className="text-blue-700 hover:underline">
                  Checklist {progressOf(cl.items).label}
                </Link>
              ))}
```

- [ ] **Step 3: Run** — `npm run test:e2e -- checklist-attach.spec.ts schedule.spec.ts courses.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(checklists): show attached checklists on sessions and surgery bookings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard

**Files:**
- Modify: `web/src/app/(app)/page.tsx`
- Test: `web/tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: `slots_on`, `SLOT_SELECT`, `pull_list`, `inventory_overview`, `stockFlags`, `getSettings`,
  `todayIso`, `addDays`, `productLabel`, `checklist_items`.
- Produces: widgets with headings "Today's surgeries", "Stock shortages for surgeries", "Low stock",
  "Expiring soon", "My open checklist items"; rows `data-testid="dash-surgery" | "dash-shortage" | "dash-low" | "dash-expiring" | "dash-my-item"`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/dashboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, receiveStock, seedChair, seedCourse, seedDelegate, seedProduct, seedSession } from './api';

test('dashboard shows today, shortages, stock alerts and my items', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const me = (await api.auth.getUser()).data.user!.id;

  const lowBrand = uniqueName('Low');
  const low = await seedProduct(api, { type: 'implant', brand: lowBrand, diameter_mm: 4, length_mm: 10 });
  await api.from('products').update({ reorder_level: 5 }).eq('id', low);
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await receiveStock(api, low, 1, `E2E-D${Date.now()}`, soon);

  const courseId = await seedCourse(api, { name: uniqueName('Today course'), start: today, end: today });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Today', date: today });
  const chairName = uniqueName('Chair');
  const chairId = await seedChair(admin, chairName);
  const delegate = await seedDelegate(api, uniqueName('Dr Today'));
  await enroll(api, courseId, delegate);

  await login(page, TEST_USERS.organizer.email);
  const patientName = uniqueName('Today patient');
  const patientId = await createPatientViaUi(page, { full_name: patientName });
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '23:00', p_end: '23:30', p_patient: patientId, p_supervisor: me,
    p_placing: [delegate], p_implants: [{ tooth: 36, product_id: low }, { tooth: 46, product_id: low }],
    p_override_reason: 'E2E dashboard',
  });
  expect(error).toBeNull();

  const { data: list } = await api.rpc('create_checklist', { p_title: uniqueName('Dash list'), p_items: ['Call the lab'] });
  const { data: item } = await api.from('checklist_items').select('id').eq('checklist_id', list as string).single();
  await api.from('checklist_items').update({ assignee_id: me }).eq('id', item!.id);

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('dash-surgery').filter({ hasText: patientName })).toContainText(chairName);
  await expect(page.getByTestId('dash-shortage').filter({ hasText: lowBrand })).toContainText('need 2, have 1');
  await expect(page.getByTestId('dash-low').filter({ hasText: lowBrand })).toBeVisible();
  await expect(page.getByTestId('dash-expiring').filter({ hasText: lowBrand })).toBeVisible();
  await expect(page.getByTestId('dash-my-item').filter({ hasText: 'Call the lab' })).toBeVisible();
});

test('empty states are friendly for an inactive-free view', async ({ page }) => {
  await login(page, TEST_USERS.mfa.email);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My open checklist items' })).toBeVisible();
  await expect(page.getByText('Nothing assigned to you is open.')).toBeVisible();
});
```

Note: the 23:00–23:30 booking keeps this test clear of other runs' bookings for the organizer
(it overrides any clash anyway). The second test signs in as the 2FA test user, who has no
factor enrolled at rest and no assigned items.

Run → FAIL.

- [ ] **Step 2: Implement** — replace `web/src/app/(app)/page.tsx`:

```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile, getSettings } from '@/lib/auth/session';
import { addDays, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import type { Product } from '@/lib/inventory/types';
import { SLOT_SELECT } from '@/lib/schedule/queries';
import type { PullRow, SlotRow } from '@/lib/schedule/types';

type StockRow = Product & { on_hand: number; nearest_expiry: string | null };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const [profile, settings] = await Promise.all([getCurrentProfile(), getSettings()]);
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const [slots, pullToday, pullTomorrow, stock, mine] = await Promise.all([
    supabase.rpc('slots_on', { p_date: today }).select(SLOT_SELECT),
    supabase.rpc('pull_list', { p_date: today }),
    supabase.rpc('pull_list', { p_date: tomorrow }),
    supabase.rpc('inventory_overview', { q: '', p_category: '', include_all: false }),
    supabase
      .from('checklist_items')
      .select('id, text, due_date, checklist:checklists(id, title)')
      .eq('assignee_id', profile?.user_id ?? '')
      .is('done_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
  ]);

  const surgeries = ((slots.data ?? []) as unknown as SlotRow[]).filter((s) => s.status !== 'cancelled');
  const { data: chairs } = await supabase.from('chairs').select('id, name');
  const chairName = new Map((chairs ?? []).map((c) => [c.id as string, c.name as string]));
  const shortages = [
    ...((pullToday.data ?? []) as PullRow[]).map((r) => ({ ...r, day: 'Today' })),
    ...((pullTomorrow.data ?? []) as PullRow[]).map((r) => ({ ...r, day: 'Tomorrow' })),
  ].filter((r) => r.product_id && r.needed > r.available);
  const stockRows = (stock.data ?? []) as StockRow[];
  const flagged = stockRows.map((r) => ({ r, f: stockFlags(r, today, settings.expiry_alert_days) }));
  const low = flagged.filter((x) => x.f.low).map((x) => x.r);
  const expiring = flagged.filter((x) => x.f.expiring).map((x) => x.r);
  const myItems = (mine.data ?? []) as unknown as { id: string; text: string; due_date: string | null; checklist: { id: string; title: string } }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-gray-600">Welcome, {profile?.full_name || profile?.email} · {formatDate(today)}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today's surgeries">
          {surgeries.length === 0 ? (
            <p className="text-sm text-gray-600">No surgeries booked today.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {surgeries.map((s) => (
                <li key={s.id} data-testid="dash-surgery" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span>
                  <span>{chairName.get(s.chair_id) ?? 'Chair'}</span>
                  {s.patient && (
                    <Link href={`/patients/${s.patient.id}`} className="text-blue-700 hover:underline">{s.patient.full_name}</Link>
                  )}
                  {s.implants.length > 0 && <span className="text-gray-600">teeth {s.implants.map((i) => i.tooth).join(', ')}</span>}
                  {s.status === 'done' && <span className="text-green-800">done</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/schedule?date=${today}`} className="text-sm text-blue-700 hover:underline">Open today’s schedule</Link>
        </Card>

        <Card title="Stock shortages for surgeries">
          {shortages.length === 0 ? (
            <p className="text-sm text-gray-600">Stock covers today’s and tomorrow’s planned implants.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {shortages.map((r) => (
                <li key={`${r.day}-${r.product_id}`} data-testid="dash-shortage" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{r.day}</span>
                  <span>{productLabel(r)}</span>
                  <span className="text-red-800">need {r.needed}, have {r.available}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Low stock">
          {low.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing is at or below its reorder level.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {low.map((r) => (
                <li key={r.id} data-testid="dash-low" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">{productLabel(r)}</Link>
                  <span>{r.on_hand} left (reorder at {r.reorder_level})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Expiring soon">
          {expiring.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing expires in the next {settings.expiry_alert_days} days.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {expiring.map((r) => (
                <li key={r.id} data-testid="dash-expiring" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">{productLabel(r)}</Link>
                  <span>{r.nearest_expiry ? `expires ${formatDate(r.nearest_expiry)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="My open checklist items">
          {myItems.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing assigned to you is open.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {myItems.map((i) => (
                <li key={i.id} data-testid="dash-my-item" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{i.text}</span>
                  <Link href={`/checklists/${i.checklist.id}`} className="text-blue-700 hover:underline">{i.checklist.title}</Link>
                  {i.due_date && <span className="text-gray-600">due {formatDate(i.due_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run** — `npm run test:e2e -- dashboard.spec.ts auth.spec.ts` → PASS.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`, then `npm run test:e2e` → all green.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(dashboard): today's surgeries, shortages, stock alerts and my checklist items" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
