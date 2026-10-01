# Plan 3 — Inventory & Implant Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers keep a surgical + prosthetic catalog (pre-filled with sample systems),
receive stock in batches (optional lot / expiry), and record each implant's life on the
patient's chart — plan, place (with placing/assisting delegate and supervisor, deducting one
unit from the chosen batch), fit components (cover screw → healing abutment → Ti-base / MUA /
abutment → final restoration, each deducted), and follow-ups — with a lot → patient recall
lookup and an append-only stock ledger.

**Architecture:** Catalog, delegates, stock batches, an append-only movement ledger and the
implant tables, all behind RLS. Users may write the catalog and delegates directly (column
grants); every stock or implant change goes through SECURITY DEFINER functions that check
`is_active_user()` first, lock the batch row, validate, write the ledger and keep
`tooth_status` in step — one transaction each. Business errors are raised with
`hint = 'user'` and shown verbatim; anything else is logged and shown generically.

**Tech Stack:** as Plans 1–2.

**Spec:** `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md` (§4.5 sites/
components/follow-ups, §4.6, §5.1, §5.4–5.7, §6 Inventory + Odontogram badges + Implants tab)
**Roadmap:** `docs/superpowers/plans/2026-10-01-roadmap.md` (Plan 3 of 5)

## Global Constraints

- All Plan 1–2 constraints apply (code in `web/`, commit trailer, RLS everywhere, anon has no
  privileges, no hard deletes, audit trigger on every new table, column-level grants for any
  table users write directly, actionable error sentences, Cairo "today").
- **Scope ruling (roadmap change):** placement *requires* a placing delegate (spec §5.4), so a
  minimal `delegates` registry moves from Plan 4 into Plan 3. Plan 4 adds courses/sessions/
  slots and the `course_id` / `session_id` / `slot_id` columns on `implant_sites`.
- **Catalog starts pre-filled** (user decision) with sample systems — Straumann BLX/BLT, Nobel
  Biocare NobelActive, Neodent Helix GM, MIS C1, Osstem TSIII in typical sizes, their standard
  components, and two grafts/membranes — all flagged `is_sample` ("Sample — verify") with empty
  reference codes until the organizers check them against their supplier.
- Product categories (spec §4.6): surgical = implant, cover screw, healing abutment, graft,
  membrane; prosthetic = Ti-base, multi-unit, straight/angled abutment, scan body, impression
  coping, analog, prosthetic screw (+ other).
- Lot number and expiry are **optional**. A batch without a lot shows as "No lot"; expiry rules
  apply only when expiry is set; recall lookup covers lot-numbered batches.
- `stock_movements` is **append-only** for everyone (corrections are new adjust movements).
- Stock never goes negative; an expired batch or a batch of another product is refused.
- Placing requires product (implant), stock batch, placement date, placing delegate (active)
  and supervising organizer (active). Assisting delegate optional and different.
- One active implant (planned / placed / restored) per patient + tooth.
- Component badge abbreviations: CS, HA, TB, MUA, AB, CR.
- `tooth_status` follows the implant: planned → `implant_planned`, placed → `implant_placed`,
  final restoration → `restored`, failed follow-up → `failed`, cancelled plan → `missing`.
- E2E-created catalog rows/delegates are named `E2E …` and deactivated in teardown; E2E
  patients that have stock movements are kept (the ledger is immutable).

## Review Focus

1. **Two organizers taking the last unit of a batch at the same moment** → one succeeds, the
   other is told the batch is empty; stock never negative. Pinned in Task 4
   (`concurrent placement waits for the batch lock`, `empty batch is refused`).
2. **A batch that expired, belongs to another product, or is empty is chosen (stale page or
   crafted request)** → refused with a specific sentence. Pinned in Task 4
   (`expired / wrong-product / empty batch`) and Task 6 (`availableLots`).
3. **Fitting a component that doesn't match its type (e.g. a Ti-base product recorded as a
   healing abutment), or to a tooth with no placed implant** → refused. Pinned in Task 5.
4. **Waste/return entered as a positive number, or an adjustment that would go below zero, or
   no reason given** → refused with a clear message. Pinned in Task 3 and Task 6 (`adjustSchema`).
5. **Someone calls the stock/implant functions or writes the tables directly with a valid
   token but an inactive account, an aal1 token with 2FA, or forged columns** → refused.
   Pinned in Task 3 (`inactive users cannot receive stock`, `direct writes are refused`) and
   Task 4 (`2FA user with aal1 cannot place`).

---

## File Structure (Plan 3)

```
web/supabase/migrations/
  0007_delegates.sql            delegates + RLS + grants
  0008_catalog.sql              product_type enum, products (+ generated category), sample seed
  0009_stock.sql                stock_lots, stock_movements (append-only), views, receive/adjust,
                                inventory_overview(), search_lots(), helper functions
  0010_implant_sites.sql        implant_sites, site_components, implant_followups, plan/cancel/place,
                                patient_history() now includes implant_sites
  0011_components_followups.sql fit_component(), record_followup(), lot_usage()
web/tests/db/
  fixtures.ts                   makePatient/makeProduct/makeDelegate/receive/onHand/place
  delegates.test.ts, catalog.test.ts, stock.test.ts, implants.test.ts, components.test.ts
web/tests/e2e/
  api.ts                        apiAs(email), seedImplantStock(), seedProduct(), seedDelegate()
  delegates.spec.ts, inventory.spec.ts, implants.spec.ts, implants-tab.spec.ts
  patients.ts, global-teardown.ts (modified)
web/src/lib/
  dates.ts (+test)              isRealDate, todayIso (Cairo), addDays — moved from patients/schemas
  inventory/types.ts            enums, labels, row types, ChartData
  inventory/labels.ts (+test)   productLabel, lotLabel, fmtMm
  inventory/lots.ts (+test)     availableLots, stockFlags
  inventory/components.ts (+test) COMPONENT_ACCEPTS, acceptsProduct, currentComponent, activeSite, badgesFor
  inventory/schemas.ts (+test)  productSchema, receiveSchema, adjustSchema, delegateSchema,
                                planSchema, placeSchema, componentSchema, followupSchema
  db-errors.ts (+test)          userMessage
  patients/history.ts (+test)   + implant_sites wording
web/src/components/
  nav-items.ts (+test)          + Inventory, Delegates
  odontogram/odontogram.tsx (+test)  + badges prop
web/src/app/(app)/
  delegates/page.tsx, delegate-form.tsx, actions.ts, [id]/page.tsx
  inventory/layout.tsx, page.tsx
  inventory/products/new/page.tsx, product-form.tsx, actions.ts, [id]/page.tsx
  inventory/receive/page.tsx, receive-form.tsx, actions.ts
  inventory/lots/[id]/page.tsx, adjust-form.tsx, actions.ts
  inventory/recall/page.tsx
  patients/[id]/chart-data.ts   loadChartData (server-only)
  patients/[id]/page.tsx, chart-panel.tsx (modified)
  patients/[id]/implant-section.tsx, implant-forms.tsx, implant-actions.ts
  patients/[id]/patient-tabs.tsx (+ Implants), implants/page.tsx
```

---

### Task 1: Delegates registry (migration 0007)

**Files:**
- Create: `web/supabase/migrations/0007_delegates.sql`, `web/tests/db/fixtures.ts`
- Test: `web/tests/db/delegates.test.ts`

**Interfaces:**
- Produces (SQL): `public.delegates(id, full_name, phone, email, licence_no, notes, active,
  created_at, created_by, updated_at)`; users may insert/update only
  `(full_name, phone, email, licence_no, notes, active)`; no delete.
- Produces (TS test fixtures, extended in later tasks): `makePatient(c, name?)`,
  `makeDelegate(c, name?)`.

- [ ] **Step 1: Fixtures** — `web/tests/db/fixtures.ts`:

```ts
import type { Client } from 'pg';

export async function makePatient(c: Client, name = 'Inventory Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeDelegate(c: Client, name = 'Test Delegate'): Promise<string> {
  const { rows } = await c.query('insert into public.delegates (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/delegates.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { makeDelegate } from './fixtures';

const users = inject('testUsers');

describe('delegates', () => {
  it('active organizers add and edit delegates', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeDelegate(c, 'Dr Karim Adel');
      await c.query("update public.delegates set licence_no = 'EG-123', active = false where id = $1", [id]);
      const { rows } = await c.query('select licence_no, active, created_by from public.delegates where id = $1', [id]);
      expect(rows[0]).toEqual({ licence_no: 'EG-123', active: false, created_by: users.organizer });
    });
  });

  it('inactive users see none and cannot add', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await makeDelegate(c);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.delegates')).rows).toHaveLength(0);
      await expect(makeDelegate(c)).rejects.toThrow(/row-level security/);
    });
  });

  it('delegates cannot be deleted, and creator/timestamps cannot be forged', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeDelegate(c);
      await c.query('savepoint s');
      await expect(c.query('delete from public.delegates where id = $1', [id])).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint s');
      await expect(
        c.query("insert into public.delegates (full_name, created_by) values ('X Y', $1)", [users.admin]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:db -- delegates`
Expected: FAIL — `relation "public.delegates" does not exist`.

- [ ] **Step 4: Migration** — `web/supabase/migrations/0007_delegates.sql`:

```sql
create table public.delegates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 120),
  licence_no text not null default '' check (length(licence_no) <= 60),
  notes text not null default '' check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger delegates_set_updated_at before update on public.delegates
  for each row execute function app_private.set_updated_at();
create trigger delegates_audit after insert or update or delete on public.delegates
  for each row execute function app_private.audit_row('id');

revoke all on public.delegates from anon;
revoke insert, update, delete, truncate on public.delegates from authenticated;
grant insert (full_name, phone, email, licence_no, notes, active) on public.delegates to authenticated;
grant update (full_name, phone, email, licence_no, notes, active) on public.delegates to authenticated;

alter table public.delegates enable row level security;
create policy delegates_select on public.delegates for select to authenticated using (public.is_active_user());
create policy delegates_insert on public.delegates for insert to authenticated with check (public.is_active_user());
create policy delegates_update on public.delegates for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0007_delegates.sql web/tests/db/fixtures.ts web/tests/db/delegates.test.ts
git commit -m "feat(db): delegates registry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Product catalog with sample seed (migration 0008)

**Files:**
- Create: `web/supabase/migrations/0008_catalog.sql`
- Modify: `web/tests/db/fixtures.ts` (add `makeProduct`)
- Test: `web/tests/db/catalog.test.ts`

**Interfaces:**
- Produces (SQL): enum `public.product_type` (implant, cover_screw, healing_abutment, graft,
  membrane, ti_base, multi_unit, abutment_straight, abutment_angled, scan_body,
  impression_coping, analog, prosthetic_screw, other); `public.product_category(product_type)`;
  `public.products(id, type, category [generated], brand, system, platform, diameter_mm,
  length_mm, ref_code, description, reorder_level, active, is_sample, created_at, created_by,
  updated_at)`. Implants require diameter and length. Users insert/update the descriptive
  columns only; no delete.
- Produces (fixture): `makeProduct(c, type = 'implant', brand = 'Test Brand'): Promise<string>`.

- [ ] **Step 1: Add the fixture** — append to `web/tests/db/fixtures.ts`:

```ts
export async function makeProduct(c: Client, type = 'implant', brand = 'Test Brand'): Promise<string> {
  const implant = type === 'implant';
  const { rows } = await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm)
     values ($1, $2, 'T1', $3, $4) returning id`,
    [type, brand, implant ? 4.0 : null, implant ? 10 : null],
  );
  return rows[0].id;
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/catalog.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { makeProduct } from './fixtures';

const users = inject('testUsers');

describe('product catalog', () => {
  it('ships a sample catalog flagged for verification', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query(
        `select type, count(*)::int as n from public.products where is_sample group by type`,
      );
      const counts = Object.fromEntries(rows.map((r) => [r.type, r.n]));
      expect(counts.implant).toBe(84);
      expect(counts.healing_abutment).toBe(12);
      expect(counts.ti_base).toBe(6);
      expect(counts.graft).toBe(2);
      expect(counts.membrane).toBe(1);
      const straumann = await c.query(
        "select count(*)::int as n from public.products where brand = 'Straumann' and system = 'BLX' and type = 'implant'",
      );
      expect(straumann.rows[0].n).toBe(12);
    });
  });

  it('derives the category from the type', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const implant = await makeProduct(c, 'implant');
      const tibase = await makeProduct(c, 'ti_base');
      const { rows } = await c.query('select id, category from public.products where id in ($1, $2)', [implant, tibase]);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.category]));
      expect(byId[implant]).toBe('surgical');
      expect(byId[tibase]).toBe('prosthetic');
    });
  });

  it('implants need a diameter and a length', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expect(
        c.query("insert into public.products (type, brand) values ('implant', 'X')"),
      ).rejects.toThrow(/products_implant_size/);
    });
  });

  it('users cannot delete products, forge the creator or set the category', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c);
      for (const sql of [
        'delete from public.products where id = $1',
        "update public.products set created_by = null where id = $1",
      ]) {
        await c.query('savepoint s');
        await expect(c.query(sql, [id])).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint s');
      }
      await expect(c.query("update public.products set category = 'x' where id = $1", [id])).rejects.toThrow(
        /permission denied|generated column/,
      );
    });
  });

  it('inactive users see no products', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.products limit 1')).rows).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- catalog` → FAIL
  (`relation "public.products" does not exist`).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0008_catalog.sql`:

```sql
create type public.product_type as enum (
  'implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane',
  'ti_base', 'multi_unit', 'abutment_straight', 'abutment_angled', 'scan_body',
  'impression_coping', 'analog', 'prosthetic_screw', 'other'
);

create function public.product_category(t public.product_type) returns text
language sql immutable as $$
  select case when t in ('implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane')
              then 'surgical' else 'prosthetic' end;
$$;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  type public.product_type not null,
  category text generated always as (public.product_category(type)) stored,
  brand text not null check (length(trim(brand)) between 1 and 60),
  system text not null default '' check (length(system) <= 60),
  platform text not null default '' check (length(platform) <= 40),
  diameter_mm numeric(4, 2) check (diameter_mm between 2 and 9),
  length_mm numeric(4, 1) check (length_mm between 4 and 25),
  ref_code text not null default '' check (length(ref_code) <= 60),
  description text not null default '' check (length(description) <= 200),
  reorder_level int not null default 0 check (reorder_level between 0 and 10000),
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint products_implant_size check (type <> 'implant' or (diameter_mm is not null and length_mm is not null))
);
create index products_brand_idx on public.products (brand, system);

create trigger products_set_updated_at before update on public.products
  for each row execute function app_private.set_updated_at();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function app_private.audit_row('id');

revoke all on public.products from anon;
revoke insert, update, delete, truncate on public.products from authenticated;
grant insert (type, brand, system, platform, diameter_mm, length_mm, ref_code, description, reorder_level, active)
  on public.products to authenticated;
grant update (type, brand, system, platform, diameter_mm, length_mm, ref_code, description, reorder_level, active, is_sample)
  on public.products to authenticated;

alter table public.products enable row level security;
create policy products_select on public.products for select to authenticated using (public.is_active_user());
create policy products_insert on public.products for insert to authenticated with check (public.is_active_user());
create policy products_update on public.products for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Sample catalog (user decision). Reference codes are left empty: verify with the supplier.
with systems (brand, system, diameters, lengths) as (
  values
    ('Straumann', 'BLX', array[3.75, 4.0, 4.5, 5.0]::numeric[], array[8, 10, 12]::numeric[]),
    ('Straumann', 'BLT', array[3.3, 4.1, 4.8]::numeric[], array[8, 10, 12, 14]::numeric[]),
    ('Nobel Biocare', 'NobelActive', array[3.5, 4.3, 5.0]::numeric[], array[8.5, 10, 11.5, 13]::numeric[]),
    ('Neodent', 'Helix GM', array[3.5, 3.75, 4.0, 4.3, 5.0]::numeric[], array[8, 10, 11.5, 13]::numeric[]),
    ('MIS', 'C1', array[3.75, 4.2, 5.0]::numeric[], array[8, 10, 11.5, 13]::numeric[]),
    ('Osstem', 'TSIII', array[3.5, 4.0, 4.5, 5.0]::numeric[], array[8.5, 10, 11.5, 13]::numeric[])
)
insert into public.products (type, brand, system, diameter_mm, length_mm, is_sample)
select 'implant', s.brand, s.system, d, l, true
from systems s cross join lateral unnest(s.diameters) d cross join lateral unnest(s.lengths) l;

insert into public.products (type, brand, system, description, is_sample)
select c.type::public.product_type, s.brand, s.system, c.description, true
from (values ('Straumann', 'BLX'), ('Straumann', 'BLT'), ('Nobel Biocare', 'NobelActive'),
             ('Neodent', 'Helix GM'), ('MIS', 'C1'), ('Osstem', 'TSIII')) as s (brand, system)
cross join (values
  ('cover_screw', 'Cover screw'),
  ('healing_abutment', 'Healing abutment 3.5 mm'),
  ('healing_abutment', 'Healing abutment 5 mm'),
  ('ti_base', 'Ti-base'),
  ('multi_unit', 'Multi-unit abutment'),
  ('abutment_straight', 'Straight abutment'),
  ('abutment_angled', 'Angled abutment 15°'),
  ('scan_body', 'Scan body'),
  ('impression_coping', 'Impression coping'),
  ('analog', 'Lab analog'),
  ('prosthetic_screw', 'Prosthetic screw')
) as c (type, description);

insert into public.products (type, brand, system, description, is_sample) values
  ('graft', 'Geistlich', 'Bio-Oss', 'Granules 0.25–1 mm, 0.5 g', true),
  ('graft', 'Geistlich', 'Bio-Oss', 'Granules 0.25–1 mm, 1 g', true),
  ('membrane', 'Geistlich', 'Bio-Gide', '25 × 25 mm', true);
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0008_catalog.sql web/tests/db/fixtures.ts web/tests/db/catalog.test.ts
git commit -m "feat(db): product catalog with sample implant systems" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stock batches, ledger, receive and adjust (migration 0009)

**Files:**
- Create: `web/supabase/migrations/0009_stock.sql`
- Modify: `web/tests/db/fixtures.ts` (add `receive`, `onHand`)
- Test: `web/tests/db/stock.test.ts`

**Interfaces:**
- Produces (SQL):
  - enum `public.movement_reason` (receive, use, adjust, waste, return);
  - `public.stock_lots(id, product_id, lot_no?, expiry?, received_on, qty_received, notes, created_at, created_by → profiles)`;
  - `public.stock_movements(id, stock_lot_id, delta, reason, implant_site_id?, site_component_id?, patient_id?, note, reverses_movement_id?, created_at, created_by → profiles)` — append-only;
  - views (security invoker) `public.stock_on_hand(stock_lot_id, product_id, lot_no, expiry, received_on, qty_received, on_hand)`;
  - `public.receive_stock(p_product uuid, p_qty int, p_lot_no text = null, p_expiry date = null, p_received_on date = null, p_notes text = '') returns uuid` (lot id);
  - `public.adjust_stock(p_lot uuid, p_delta int, p_reason movement_reason, p_note text) returns uuid` (movement id);
  - `public.inventory_overview(q text = '', p_category text = '', include_all boolean = false)` returns product columns + `on_hand int, nearest_expiry date`;
  - `public.search_lots(q text)` returns lot + product columns + `on_hand`;
  - helpers `app_private.fail(text)` (raises with `hint = 'user'`), `app_private.require_active()`, `app_private.lot_on_hand(uuid)`.
- Produces (fixtures): `receive(c, product, qty, lot = 'L1', expiry = null): Promise<string>`, `onHand(c, lot): Promise<number>`.

- [ ] **Step 1: Fixtures** — append to `web/tests/db/fixtures.ts`:

```ts
export async function receive(
  c: Client,
  product: string,
  qty: number,
  lot: string | null = 'L1',
  expiry: string | null = null,
): Promise<string> {
  const { rows } = await c.query(
    'select public.receive_stock(p_product => $1, p_qty => $2, p_lot_no => $3, p_expiry => $4) as id',
    [product, qty, lot, expiry],
  );
  return rows[0].id;
}

export async function onHand(c: Client, lot: string): Promise<number> {
  const { rows } = await c.query('select on_hand from public.stock_on_hand where stock_lot_id = $1', [lot]);
  return rows[0].on_hand;
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/stock.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeProduct, onHand, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('receiving stock', () => {
  it('creates a batch and a receive movement; lot and expiry are optional', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const withLot = await receive(c, product, 5, 'A123', '2030-01-31');
      const noLot = await receive(c, product, 2, null, null);
      expect(await onHand(c, withLot)).toBe(5);
      expect(await onHand(c, noLot)).toBe(2);
      const { rows } = await c.query(
        'select reason, delta, created_by from public.stock_movements where stock_lot_id = $1',
        [withLot],
      );
      expect(rows).toEqual([{ reason: 'receive', delta: 5, created_by: users.organizer }]);
    });
  });

  it('refuses bad quantities and inactive products with user-facing messages', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await refused(c, 'select public.receive_stock($1, 0)', [product], /Enter a quantity between 1 and 100000/);
      await c.query('update public.products set active = false where id = $1', [product]);
      await refused(c, 'select public.receive_stock($1, 1)', [product], /Choose an active product/);
    });
  });

  it('inactive users cannot receive stock', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await actAs(c, users.inactive);
      await expect(c.query('select public.receive_stock($1, 1)', [product])).rejects.toThrow(/Not allowed/);
    });
  });
});

describe('adjusting stock', () => {
  it('waste takes stock out, adjustments go either way, a reason is required', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 3);
      await c.query("select public.adjust_stock($1, -1, 'waste', 'Dropped on floor')", [lot]);
      await c.query("select public.adjust_stock($1, 2, 'adjust', 'Stock count correction')", [lot]);
      expect(await onHand(c, lot)).toBe(4);
      await refused(c, "select public.adjust_stock($1, 1, 'waste', 'oops')", [lot], /Waste and returns take stock out/);
      await refused(c, "select public.adjust_stock($1, -1, 'adjust', ' ')", [lot], /Explain the change/);
      await refused(c, "select public.adjust_stock($1, 1, 'receive', 'x x x')", [lot], /Choose adjust, waste or return/);
    });
  });

  it('stock never goes negative', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 2);
      await refused(c, "select public.adjust_stock($1, -3, 'return', 'Back to supplier')", [lot], /Only 2 left in this batch/);
    });
  });
});

describe('the ledger', () => {
  it('direct writes to batches and movements are refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1);
      await refused(c, "insert into public.stock_lots (product_id, qty_received) values ($1, 5)", [product], /permission denied/);
      await refused(c, "insert into public.stock_movements (stock_lot_id, delta, reason) values ($1, 9, 'adjust')", [lot], /permission denied/);
      await refused(c, 'update public.stock_movements set delta = 99 where stock_lot_id = $1', [lot], /permission denied/);
    });
  });

  it('movements are immutable even for the postgres role', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 1);
      await asPostgres(c);
      await refused(c, 'update public.stock_movements set delta = 99 where stock_lot_id = $1', [lot], /append-only/);
      await refused(c, 'delete from public.stock_movements where stock_lot_id = $1', [lot], /append-only/);
    });
  });
});

describe('overview and lot search', () => {
  it('reports on hand and nearest expiry per product; lists stocked products by default', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c, 'implant', 'Zz Overview Brand');
      await receive(c, product, 3, 'B1', '2031-05-01');
      await receive(c, product, 2, 'B2', '2030-02-01');
      const { rows } = await c.query("select on_hand, nearest_expiry::text from public.inventory_overview('Zz Overview')");
      expect(rows).toEqual([{ on_hand: 5, nearest_expiry: '2030-02-01' }]);
      const unstocked = await makeProduct(c, 'implant', 'Zz Unstocked Brand');
      expect((await c.query("select id from public.inventory_overview('Zz Unstocked')")).rows).toHaveLength(0);
      const all = await c.query("select id from public.inventory_overview('Zz Unstocked', '', true)");
      expect(all.rows.map((r) => r.id)).toEqual([unstocked]);
    });
  });

  it('finds batches by lot number, case-insensitively and literally', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await receive(c, product, 1, 'ZZLOT-9_1');
      await receive(c, product, 1, 'ZZLOT-991');
      const { rows } = await c.query("select lot_no from public.search_lots('zzlot-9_')");
      expect(rows.map((r) => r.lot_no)).toEqual(['ZZLOT-9_1']);
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- stock` → FAIL
  (`function public.receive_stock(...) does not exist`).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0009_stock.sql`:

```sql
-- Helpers for SECURITY DEFINER business functions -------------------------------------------
create function app_private.fail(msg text) returns void
language plpgsql as $$
begin
  raise exception using message = msg, hint = 'user', errcode = 'P0001';
end $$;

create function app_private.require_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;

-- Stock batches and the ledger ---------------------------------------------------------------
create type public.movement_reason as enum ('receive', 'use', 'adjust', 'waste', 'return');

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  lot_no text check (lot_no is null or length(trim(lot_no)) between 1 and 60),
  expiry date,
  received_on date not null default current_date,
  qty_received int not null check (qty_received between 1 and 100000),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index stock_lots_product_idx on public.stock_lots (product_id);
create index stock_lots_lot_no_idx on public.stock_lots (upper(lot_no));

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_lot_id uuid not null references public.stock_lots (id),
  delta int not null check (delta <> 0),
  reason public.movement_reason not null,
  implant_site_id uuid,
  site_component_id uuid,
  patient_id uuid references public.patients (id),
  note text not null default '' check (length(note) <= 500),
  reverses_movement_id uuid references public.stock_movements (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index stock_movements_lot_idx on public.stock_movements (stock_lot_id);
create index stock_movements_patient_idx on public.stock_movements (patient_id);

create function app_private.ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is append-only';
end $$;

create trigger stock_movements_no_change before update or delete on public.stock_movements
  for each row execute function app_private.ledger_immutable();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function app_private.ledger_immutable();

create trigger stock_lots_audit after insert or update or delete on public.stock_lots
  for each row execute function app_private.audit_row('id');

revoke all on public.stock_lots, public.stock_movements from anon;
revoke insert, update, delete, truncate on public.stock_lots, public.stock_movements from authenticated;

alter table public.stock_lots enable row level security;
alter table public.stock_movements enable row level security;
create policy stock_lots_select on public.stock_lots for select to authenticated using (public.is_active_user());
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.is_active_user());

create view public.stock_on_hand with (security_invoker = true) as
  select l.id as stock_lot_id, l.product_id, l.lot_no, l.expiry, l.received_on, l.qty_received,
         coalesce(sum(m.delta), 0)::int as on_hand
  from public.stock_lots l
  left join public.stock_movements m on m.stock_lot_id = l.id
  group by l.id;

create function app_private.lot_on_hand(p_lot uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(delta), 0)::int from public.stock_movements where stock_lot_id = p_lot;
$$;

-- Business functions ---------------------------------------------------------------------------
create function public.receive_stock(
  p_product uuid, p_qty int, p_lot_no text default null, p_expiry date default null,
  p_received_on date default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lot uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.products where id = p_product and active) then
    perform app_private.fail('Choose an active product from the catalog.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    perform app_private.fail('Enter a quantity between 1 and 100000.');
  end if;
  if coalesce(p_received_on, current_date) > current_date + 1 then
    perform app_private.fail('The received date cannot be in the future.');
  end if;
  insert into public.stock_lots (product_id, lot_no, expiry, received_on, qty_received, notes)
  values (p_product, nullif(trim(p_lot_no), ''), p_expiry, coalesce(p_received_on, current_date), p_qty, coalesce(p_notes, ''))
  returning id into v_lot;
  insert into public.stock_movements (stock_lot_id, delta, reason) values (v_lot, p_qty, 'receive');
  return v_lot;
end $$;

create function public.adjust_stock(p_lot uuid, p_delta int, p_reason public.movement_reason, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_on_hand int;
  v_id uuid;
begin
  perform app_private.require_active();
  if p_reason not in ('adjust', 'waste', 'return') then
    perform app_private.fail('Choose adjust, waste or return.');
  end if;
  if p_delta is null or p_delta = 0 then
    perform app_private.fail('Enter a quantity other than zero.');
  end if;
  if p_reason in ('waste', 'return') and p_delta > 0 then
    perform app_private.fail('Waste and returns take stock out: the quantity must be negative.');
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform app_private.fail('Explain the change (at least 3 characters).');
  end if;
  perform 1 from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Stock batch not found.');
  end if;
  v_on_hand := app_private.lot_on_hand(p_lot);
  if v_on_hand + p_delta < 0 then
    perform app_private.fail(format('Only %s left in this batch.', v_on_hand));
  end if;
  insert into public.stock_movements (stock_lot_id, delta, reason, note)
  values (p_lot, p_delta, p_reason, trim(p_note))
  returning id into v_id;
  return v_id;
end $$;

create function public.inventory_overview(q text default '', p_category text default '', include_all boolean default false)
returns table (
  id uuid, type public.product_type, category text, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, ref_code text, description text, reorder_level int,
  active boolean, is_sample boolean, on_hand int, nearest_expiry date
)
language sql stable security invoker set search_path = '' as $$
  with term as (
    select replace(replace(replace(coalesce(trim(q), ''), '\', '\\'), '%', '\%'), '_', '\_') as pat
  ),
  stock as (
    select s.product_id, sum(s.on_hand)::int as on_hand, min(s.expiry) filter (where s.on_hand > 0) as nearest_expiry
    from public.stock_on_hand s group by s.product_id
  )
  select p.id, p.type, p.category, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm,
         p.ref_code, p.description, p.reorder_level, p.active, p.is_sample,
         coalesce(st.on_hand, 0), st.nearest_expiry
  from public.products p
  cross join term t
  left join stock st on st.product_id = p.id
  where (include_all or (p.active and (coalesce(st.on_hand, 0) > 0 or p.reorder_level > 0)))
    and (coalesce(p_category, '') = '' or p.category = p_category)
    and (t.pat = ''
         or (p.brand || ' ' || p.system || ' ' || p.platform || ' ' || p.description || ' ' || p.ref_code)
            ilike '%' || t.pat || '%' escape '\')
  order by p.brand, p.system, p.type, p.diameter_mm nulls first, p.length_mm nulls first, p.description;
$$;

create function public.search_lots(q text)
returns table (
  stock_lot_id uuid, lot_no text, expiry date, received_on date, on_hand int,
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text
)
language sql stable security invoker set search_path = '' as $$
  select s.stock_lot_id, s.lot_no, s.expiry, s.received_on, s.on_hand,
         p.id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.description
  from public.stock_on_hand s
  join public.products p on p.id = s.product_id
  where length(trim(coalesce(q, ''))) > 0
    and s.lot_no ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  order by s.received_on desc
  limit 100;
$$;

revoke execute on function public.receive_stock(uuid, int, text, date, date, text) from public, anon;
revoke execute on function public.adjust_stock(uuid, int, public.movement_reason, text) from public, anon;
revoke execute on function public.inventory_overview(text, text, boolean) from public, anon;
revoke execute on function public.search_lots(text) from public, anon;
grant execute on function public.receive_stock(uuid, int, text, date, date, text) to authenticated;
grant execute on function public.adjust_stock(uuid, int, public.movement_reason, text) to authenticated;
grant execute on function public.inventory_overview(text, text, boolean) to authenticated;
grant execute on function public.search_lots(text) to authenticated;
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0009_stock.sql web/tests/db/fixtures.ts web/tests/db/stock.test.ts
git commit -m "feat(db): stock batches, append-only ledger, receive and adjust functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Implant sites — plan, cancel, place (migration 0010)

**Files:**
- Create: `web/supabase/migrations/0010_implant_sites.sql`
- Modify: `web/tests/db/fixtures.ts` (add `place`)
- Test: `web/tests/db/implants.test.ts`

**Interfaces:**
- Produces (SQL):
  - enums `public.site_state` (planned, placed, restored, failed, removed),
    `public.component_type` (cover_screw, healing_abutment, ti_base, multi_unit, abutment,
    final_restoration), `public.followup_outcome` (ok, integrated, failed, complication);
  - tables `public.implant_sites`, `public.site_components`, `public.implant_followups`
    (read-only for users; audited); FKs from `stock_movements.implant_site_id/site_component_id`;
  - `public.plan_implant(p_patient uuid, p_tooth smallint, p_product uuid = null, p_notes text = '') returns uuid`;
  - `public.cancel_planned_implant(p_site uuid) returns void`;
  - `public.place_implant(p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
    p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid = null, p_torque numeric = null,
    p_graft text = '', p_notes text = '') returns uuid`;
  - helpers `app_private.set_tooth(uuid, smallint, tooth_state)`,
    `app_private.take_one(p_lot, p_product, p_patient, p_site, p_component)`;
  - `public.patient_history()` now also returns `implant_sites` rows for the patient.
- Produces (fixture): `place(c, a: { patient; tooth; product; lot; delegate; supervisor; assistant?; placedOn? }): Promise<string>`.

- [ ] **Step 1: Fixture** — append to `web/tests/db/fixtures.ts`:

```ts
export async function place(
  c: Client,
  a: { patient: string; tooth: number; product: string; lot: string; delegate: string; supervisor: string; assistant?: string; placedOn?: string },
): Promise<string> {
  const { rows } = await c.query(
    `select public.place_implant(
       p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4,
       p_placed_on => coalesce($5::date, current_date), p_placing_delegate => $6, p_supervisor => $7,
       p_assisting_delegate => $8) as id`,
    [a.patient, a.tooth, a.product, a.lot, a.placedOn ?? null, a.delegate, a.supervisor, a.assistant ?? null],
  );
  return rows[0].id;
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/db/implants.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const product = await makeProduct(c);
  const lot = await receive(c, product, 2, 'IMP-1', '2031-01-01');
  const delegate = await makeDelegate(c, 'Dr Placing');
  return { patient, product, lot, delegate, supervisor: users.organizer };
}

async function toothStatus(c: Client, patient: string, tooth: number) {
  const { rows } = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = $2', [patient, tooth]);
  return rows[0]?.status ?? 'present';
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('placing an implant', () => {
  it('deducts one unit, links the patient, records who placed it and updates the chart', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const assistant = await makeDelegate(c, 'Dr Assisting');
      const site = await place(c, { ...s, tooth: 36, assistant });
      expect(await onHand(c, s.lot)).toBe(1);
      const { rows } = await c.query(
        'select state, placing_delegate_id, assisting_delegate_id, supervisor_id, stock_lot_id from public.implant_sites where id = $1',
        [site],
      );
      expect(rows[0]).toEqual({
        state: 'placed', placing_delegate_id: s.delegate, assisting_delegate_id: assistant,
        supervisor_id: users.organizer, stock_lot_id: s.lot,
      });
      const m = await c.query("select patient_id, implant_site_id, delta from public.stock_movements where reason = 'use' and stock_lot_id = $1", [s.lot]);
      expect(m.rows).toEqual([{ patient_id: s.patient, implant_site_id: site, delta: -1 }]);
      expect(await toothStatus(c, s.patient, 36)).toBe('implant_placed');
    });
  });

  it('a batch without a lot number or expiry is accepted', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const bare = await receive(c, s.product, 1, null, null);
      await place(c, { ...s, lot: bare, tooth: 46 });
      expect(await onHand(c, bare)).toBe(0);
    });
  });

  it('refuses an expired, wrong-product or empty batch', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const expired = await receive(c, s.product, 1, 'OLD-1', '2020-01-31');
      await refused(c, () => place(c, { ...s, lot: expired, tooth: 11 }), /Lot OLD-1 expired on 2020-01-31/);
      const other = await receive(c, await makeProduct(c), 1, 'OTHER');
      await refused(c, () => place(c, { ...s, lot: other, tooth: 11 }), /different product/);
      const single = await receive(c, s.product, 1, 'ONE');
      await place(c, { ...s, lot: single, tooth: 11 });
      await refused(c, () => place(c, { ...s, lot: single, tooth: 21 }), /This stock batch is empty/);
    });
  });

  it('requires an active placing delegate, a different assistant and an active supervisor', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => place(c, { ...s, tooth: 36, assistant: s.delegate }), /someone other than the placing delegate/);
      await refused(c, () => place(c, { ...s, tooth: 36, supervisor: users.inactive }), /Choose the supervising organizer/);
      await c.query('update public.delegates set active = false where id = $1', [s.delegate]);
      await refused(c, () => place(c, { ...s, tooth: 36 }), /Choose the delegate who placed the implant/);
    });
  });

  it('one implant per tooth; a planned implant is completed by placement', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = (await c.query('select public.plan_implant($1, 36::smallint, $2) as id', [s.patient, s.product])).rows[0].id;
      expect(await toothStatus(c, s.patient, 36)).toBe('implant_planned');
      const site = await place(c, { ...s, tooth: 36 });
      expect(site).toBe(planned);
      await refused(c, () => place(c, { ...s, tooth: 36 }), /Tooth 36 already has an implant/);
      await refused(
        c,
        () => c.query('select public.plan_implant($1, 36::smallint)', [s.patient]),
        /Tooth 36 already has an implant record/,
      );
    });
  });

  it('a cancelled plan frees the tooth and marks it missing', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = (await c.query('select public.plan_implant($1, 24::smallint) as id', [s.patient])).rows[0].id;
      await c.query('select public.cancel_planned_implant($1)', [planned]);
      expect(await toothStatus(c, s.patient, 24)).toBe('missing');
      const site = await place(c, { ...s, tooth: 24 });
      expect(site).not.toBe(planned);
    });
  });

  it('users cannot write implant tables directly', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(
        c,
        () => c.query("insert into public.implant_sites (patient_id, tooth, state) values ($1, 36, 'planned')", [s.patient]),
        /permission denied/,
      );
    });
  });

  it('2FA user with aal1 cannot place', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 't', 'totp', 'verified', now(), now(), 'x')`,
        [users.organizer],
      );
      await actAs(c, users.organizer, { aal: 'aal1' });
      await expect(place(c, { ...s, tooth: 36 })).rejects.toThrow(/Not allowed/);
    });
  });

  it('placements show up in the patient history', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await place(c, { ...s, tooth: 36 });
      const { rows } = await c.query("select table_name from public.patient_history($1) where table_name = 'implant_sites'", [s.patient]);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});

describe('concurrency', () => {
  it('concurrent placement waits for the batch lock', async () => {
    // Setup is committed so a second connection can see it; the ledger keeps these rows.
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await a.connect();
    await b.connect();
    try {
      await a.query('begin');
      await actAs(a, users.organizer);
      const s1 = await setup(a);
      const p2 = await makePatient(a, 'Second Patient');
      await a.query('commit');

      await a.query('begin');
      await actAs(a, users.organizer);
      await place(a, { ...s1, tooth: 36 }); // holds the batch row lock

      await b.query('begin');
      await actAs(b, users.organizer);
      await b.query("set local statement_timeout = '2s'");
      await expect(place(b, { ...s1, patient: p2, tooth: 36 })).rejects.toThrow(/statement timeout/);
      await b.query('rollback');
      await a.query('rollback');
    } finally {
      await a.end();
      await b.end();
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npm run test:db -- implants` → FAIL
  (`function public.place_implant(...) does not exist`).

- [ ] **Step 4: Migration** — `web/supabase/migrations/0010_implant_sites.sql`:

```sql
create type public.site_state as enum ('planned', 'placed', 'restored', 'failed', 'removed');
create type public.component_type as enum (
  'cover_screw', 'healing_abutment', 'ti_base', 'multi_unit', 'abutment', 'final_restoration'
);
create type public.followup_outcome as enum ('ok', 'integrated', 'failed', 'complication');

create table public.implant_sites (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  tooth public.fdi_tooth not null,
  state public.site_state not null default 'planned',
  product_id uuid references public.products (id),
  stock_lot_id uuid references public.stock_lots (id),
  placed_on date,
  torque_ncm numeric(5, 1) check (torque_ncm between 0 and 150),
  graft text not null default '' check (length(graft) <= 200),
  placing_delegate_id uuid references public.delegates (id),
  assisting_delegate_id uuid references public.delegates (id),
  supervisor_id uuid references public.profiles (user_id),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_sites_placed_details check (
    state in ('planned', 'removed')
    or (product_id is not null and stock_lot_id is not null and placed_on is not null
        and placing_delegate_id is not null and supervisor_id is not null)
  )
);
create unique index implant_sites_one_active on public.implant_sites (patient_id, tooth)
  where state not in ('failed', 'removed');
create index implant_sites_patient_idx on public.implant_sites (patient_id);

create table public.site_components (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  component_type public.component_type not null,
  product_id uuid references public.products (id),
  stock_lot_id uuid references public.stock_lots (id),
  fitted_on date not null,
  fitted_by_delegate_id uuid references public.delegates (id),
  fitted_by_organizer_id uuid references public.profiles (user_id),
  removed_on date,
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create unique index site_components_one_current on public.site_components (site_id) where removed_on is null;

create table public.implant_followups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  date date not null,
  check_type text not null check (length(trim(check_type)) between 1 and 60),
  outcome public.followup_outcome not null,
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index implant_followups_site_idx on public.implant_followups (site_id, date);

alter table public.stock_movements
  add constraint stock_movements_implant_site_fk foreign key (implant_site_id) references public.implant_sites (id),
  add constraint stock_movements_site_component_fk foreign key (site_component_id) references public.site_components (id);

create trigger implant_sites_set_updated_at before update on public.implant_sites
  for each row execute function app_private.set_updated_at();
create trigger implant_sites_audit after insert or update or delete on public.implant_sites
  for each row execute function app_private.audit_row('id');
create trigger site_components_audit after insert or update or delete on public.site_components
  for each row execute function app_private.audit_row('id');
create trigger implant_followups_audit after insert or update or delete on public.implant_followups
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_sites, public.site_components, public.implant_followups from anon;
revoke insert, update, delete, truncate on public.implant_sites, public.site_components, public.implant_followups
  from authenticated;
alter table public.implant_sites enable row level security;
alter table public.site_components enable row level security;
alter table public.implant_followups enable row level security;
create policy implant_sites_select on public.implant_sites for select to authenticated using (public.is_active_user());
create policy site_components_select on public.site_components for select to authenticated using (public.is_active_user());
create policy implant_followups_select on public.implant_followups for select to authenticated using (public.is_active_user());

-- Helpers ----------------------------------------------------------------------------------------
create function app_private.set_tooth(p_patient uuid, p_tooth smallint, p_status public.tooth_state) returns void
language sql security definer set search_path = '' as $$
  insert into public.tooth_status (patient_id, tooth, status) values (p_patient, p_tooth, p_status)
  on conflict (patient_id, tooth) do update set status = excluded.status;
$$;

-- Takes one unit from a batch (locked), after checking product, expiry and stock.
create function app_private.take_one(p_lot uuid, p_product uuid, p_patient uuid, p_site uuid, p_component uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  select * into v_lot from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Choose a stock batch.');
  end if;
  if v_lot.product_id <> p_product then
    perform app_private.fail('That stock batch is for a different product.');
  end if;
  if v_lot.expiry is not null and v_lot.expiry < current_date then
    perform app_private.fail(format('Lot %s expired on %s. Choose another batch.',
      coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD')));
  end if;
  if app_private.lot_on_hand(p_lot) < 1 then
    perform app_private.fail('This stock batch is empty. Choose another batch or receive stock first.');
  end if;
  insert into public.stock_movements (stock_lot_id, delta, reason, implant_site_id, site_component_id, patient_id)
  values (p_lot, -1, 'use', p_site, p_component, p_patient);
end $$;

-- Business functions -------------------------------------------------------------------------------
create function public.plan_implant(p_patient uuid, p_tooth smallint, p_product uuid default null, p_notes text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if exists (select 1 from public.implant_sites where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')) then
    perform app_private.fail(format('Tooth %s already has an implant record.', p_tooth));
  end if;
  insert into public.implant_sites (patient_id, tooth, state, product_id, notes)
  values (p_patient, p_tooth, 'planned', p_product, coalesce(p_notes, ''))
  returning id into v_id;
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_planned');
  return v_id;
end $$;

create function public.cancel_planned_implant(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state <> 'planned' then
    perform app_private.fail('Only a planned implant can be cancelled.');
  end if;
  update public.implant_sites set state = 'removed' where id = p_site;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'missing');
end $$;

create function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > current_date + 1 then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if p_placing_delegate is null or not exists (select 1 from public.delegates where id = p_placing_delegate and active) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  if found then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, '')
    ) returning id into v_id;
  end if;

  perform app_private.take_one(p_lot, p_product, p_patient, v_id, null);
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');
  return v_id;
end $$;

revoke execute on function public.plan_implant(uuid, smallint, uuid, text) from public, anon;
revoke execute on function public.cancel_planned_implant(uuid) from public, anon;
revoke execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.plan_implant(uuid, smallint, uuid, text) to authenticated;
grant execute on function public.cancel_planned_implant(uuid) to authenticated;
grant execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text) to authenticated;

-- History now includes the patient's implant records.
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
  order by a.id desc
  limit 500;
$$;
```

- [ ] **Step 5: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/0010_implant_sites.sql web/tests/db/fixtures.ts web/tests/db/implants.test.ts
git commit -m "feat(db): implant sites with plan, cancel and place functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Components, follow-ups and recall (migration 0011)

**Files:**
- Create: `web/supabase/migrations/0011_components_followups.sql`
- Test: `web/tests/db/components.test.ts`

**Interfaces:**
- Produces (SQL):
  - `app_private.component_accepts(component_type, product_type) returns boolean`
    (cover_screw→cover_screw, healing_abutment→healing_abutment, ti_base→ti_base,
    multi_unit→multi_unit, abutment→abutment_straight|abutment_angled, final_restoration→other);
  - `public.fit_component(p_site uuid, p_type component_type, p_fitted_on date, p_product uuid = null,
    p_lot uuid = null, p_by_delegate uuid = null, p_by_organizer uuid = null, p_notes text = '') returns uuid`;
  - `public.record_followup(p_site uuid, p_date date, p_check_type text, p_outcome followup_outcome, p_notes text = '') returns uuid`;
  - `public.lot_usage(p_lot uuid)` returns `(movement_id uuid, used_on date, patient_id uuid, patient_name text,
    file_no text, tooth smallint, item text, placing_delegate text, supervisor text)`.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/components.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function placed(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 1, 'IMP');
  const delegate = await makeDelegate(c);
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
  return { patient, site, delegate, implantLot: lot };
}

async function fit(c: Client, site: string, type: string, product: string | null, lot: string | null, by: string) {
  const { rows } = await c.query(
    `select public.fit_component(p_site => $1, p_type => $2, p_fitted_on => current_date,
       p_product => $3, p_lot => $4, p_by_delegate => $5) as id`,
    [site, type, product, lot, by],
  );
  return rows[0].id as string;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('components', () => {
  it('fitting a component deducts stock and closes the previous component', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 2, 'HA-1');
      const tb = await makeProduct(c, 'ti_base');
      const tbLot = await receive(c, tb, 1, 'TB-1');
      const first = await fit(c, s.site, 'healing_abutment', ha, haLot, s.delegate);
      const second = await fit(c, s.site, 'ti_base', tb, tbLot, s.delegate);
      expect(await onHand(c, haLot)).toBe(1);
      expect(await onHand(c, tbLot)).toBe(0);
      const { rows } = await c.query('select id, removed_on is null as current from public.site_components where site_id = $1 order by created_at', [s.site]);
      expect(rows).toEqual([{ id: first, current: false }, { id: second, current: true }]);
      const m = await c.query('select site_component_id, patient_id from public.stock_movements where stock_lot_id = $1 and reason = $2', [tbLot, 'use']);
      expect(m.rows).toEqual([{ site_component_id: second, patient_id: s.patient }]);
    });
  });

  it('a lab-made final restoration needs no product and marks the tooth restored', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await fit(c, s.site, 'final_restoration', null, null, s.delegate);
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('restored');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('restored');
    });
  });

  it('refuses mismatched products, a product without a batch, and nobody fitting it', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const tb = await makeProduct(c, 'ti_base');
      const tbLot = await receive(c, tb, 1);
      await refused(c, () => fit(c, s.site, 'healing_abutment', tb, tbLot, s.delegate), /not a healing abutment/);
      await refused(c, () => fit(c, s.site, 'ti_base', tb, null, s.delegate), /Choose the stock batch used/);
      await refused(
        c,
        () => c.query("select public.fit_component(p_site => $1, p_type => 'cover_screw', p_fitted_on => current_date)", [s.site]),
        /Choose who fitted the component/,
      );
    });
  });

  it('components need a placed implant', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [patient])).rows[0].id;
      const delegate = await makeDelegate(c);
      await refused(c, () => fit(c, planned, 'cover_screw', null, null, delegate), /only be fitted to a placed implant/);
    });
  });
});

describe('follow-ups', () => {
  it('a failed follow-up marks the implant and tooth failed and frees the tooth', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await c.query("select public.record_followup($1, current_date, '2-week', 'ok')", [s.site]);
      await c.query("select public.record_followup($1, current_date, '3-month', 'failed', 'Mobile')", [s.site]);
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('failed');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('failed');
      const again = await c.query('select public.plan_implant($1, 36::smallint) as id', [s.patient]);
      expect(again.rows[0].id).toBeTruthy();
    });
  });

  it('refuses follow-ups dated before placement or for planned implants', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await refused(
        c,
        () => c.query("select public.record_followup($1, current_date - 30, '2-week', 'ok')", [s.site]),
        /cannot be before the implant was placed/,
      );
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [s.patient])).rows[0].id;
      await refused(c, () => c.query("select public.record_followup($1, current_date, 'x', 'ok')", [planned]), /placed implants/);
    });
  });
});

describe('recall', () => {
  it('lot_usage lists every patient, tooth, item and delegate a batch was used for', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const { rows } = await c.query('select patient_id, tooth, item, placing_delegate, supervisor from public.lot_usage($1)', [s.implantLot]);
      expect(rows).toEqual([
        { patient_id: s.patient, tooth: 36, item: 'implant', placing_delegate: 'Test Delegate', supervisor: 'Test Organizer' },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm run test:db -- components` → FAIL
  (`function public.fit_component(...) does not exist`).

- [ ] **Step 3: Migration** — `web/supabase/migrations/0011_components_followups.sql`:

```sql
create function app_private.component_accepts(p_component public.component_type, p_product public.product_type)
returns boolean
language sql immutable as $$
  select case p_component
    when 'cover_screw' then p_product = 'cover_screw'
    when 'healing_abutment' then p_product = 'healing_abutment'
    when 'ti_base' then p_product = 'ti_base'
    when 'multi_unit' then p_product = 'multi_unit'
    when 'abutment' then p_product in ('abutment_straight', 'abutment_angled')
    when 'final_restoration' then p_product = 'other'
  end;
$$;

create function public.fit_component(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid default null,
  p_lot uuid default null, p_by_delegate uuid default null, p_by_organizer uuid default null,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > current_date + 1 then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_by_organizer is not null and not exists (select 1 from public.profiles where user_id = p_by_organizer and active) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if p_lot is null then
      perform app_private.fail('Choose the stock batch used.');
    end if;
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id, fitted_by_organizer_id, notes
  ) values (
    p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate, p_by_organizer, coalesce(p_notes, '')
  ) returning id into v_id;

  if p_product is not null then
    perform app_private.take_one(p_lot, p_product, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

create function public.record_followup(
  p_site uuid, p_date date, p_check_type text, p_outcome public.followup_outcome, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Follow-ups are recorded for placed implants.');
  end if;
  if p_date is null or p_date > current_date + 1 then
    perform app_private.fail('Enter the follow-up date (today or earlier).');
  end if;
  if p_date < v_site.placed_on then
    perform app_private.fail('A follow-up cannot be before the implant was placed.');
  end if;
  if length(trim(coalesce(p_check_type, ''))) = 0 then
    perform app_private.fail('Enter the check (e.g. 3-month).');
  end if;
  insert into public.implant_followups (site_id, date, check_type, outcome, notes)
  values (p_site, p_date, trim(p_check_type), p_outcome, coalesce(p_notes, ''))
  returning id into v_id;
  if p_outcome = 'failed' and v_site.state <> 'failed' then
    update public.implant_sites set state = 'failed' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
  return v_id;
end $$;

create function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         d.full_name, coalesce(nullif(pr.full_name, ''), pr.email)
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.profiles pr on pr.user_id = s.supervisor_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
  order by 2 desc, p.full_name;
$$;

revoke execute on function public.fit_component(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.record_followup(uuid, date, text, public.followup_outcome, text) from public, anon;
revoke execute on function public.lot_usage(uuid) from public, anon;
grant execute on function public.fit_component(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.record_followup(uuid, date, text, public.followup_outcome, text) to authenticated;
grant execute on function public.lot_usage(uuid) to authenticated;
```

- [ ] **Step 4: Run all DB tests** — `npm run test:db` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0011_components_followups.sql web/tests/db/components.test.ts
git commit -m "feat(db): component fitting, follow-ups and lot recall" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Inventory domain logic (TypeScript)

**Files:**
- Create: `web/src/lib/dates.ts`, `web/src/lib/db-errors.ts`,
  `web/src/lib/inventory/{types,labels,lots,components,schemas}.ts`
- Modify: `web/src/lib/patients/schemas.ts` (import `isRealDate`/`todayIso` from `@/lib/dates`),
  `web/src/lib/patients/history.ts` (+ `implant_sites`)
- Test: `web/src/lib/dates.test.ts`, `web/src/lib/db-errors.test.ts`,
  `web/src/lib/inventory/{labels,lots,components,schemas}.test.ts`, `web/src/lib/patients/history.test.ts` (append)

**Interfaces:**
- Produces:
  - `isRealDate(v)`, `todayIso()` (Cairo), `addDays(iso, n)` — `@/lib/dates`.
  - `userMessage(error): string | null` — `@/lib/db-errors`.
  - `PRODUCT_TYPES`, `ProductType`, `PRODUCT_TYPE_LABELS`, `categoryOf(t)`, `Product`, `LotOnHand`,
    `COMPONENT_TYPES`, `ComponentType`, `COMPONENT_LABELS`, `COMPONENT_BADGES`, `SITE_STATE_LABELS`,
    `SiteState`, `FOLLOWUP_OUTCOMES`, `FollowupOutcome`, `OUTCOME_LABELS`, `MOVEMENT_REASON_LABELS`,
    `Option`, `SiteComponent`, `Followup`, `ImplantSite`, `ChartData` — `@/lib/inventory/types`.
  - `fmtMm(n, minDecimals)`, `productLabel(p)`, `lotLabel(lot)` — `@/lib/inventory/labels`.
  - `availableLots(lots, productId, today)`, `stockFlags(row, today, alertDays)` — `@/lib/inventory/lots`.
  - `COMPONENT_ACCEPTS`, `acceptsProduct(componentType, productType)`, `currentComponent(site)`,
    `activeSite(sites, tooth)`, `badgesFor(sites)` — `@/lib/inventory/components`.
  - `productSchema`, `receiveSchema`, `adjustSchema` (→ `{ stock_lot_id, delta, reason, note }`),
    `delegateSchema`, `planSchema`, `placeSchema`, `componentSchema`, `followupSchema` — `@/lib/inventory/schemas`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/dates.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, isRealDate, todayIso } from './dates';

afterEach(() => vi.useRealTimers());

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('28/02/2026')).toBe(false);
  });
  it('gives today in Cairo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T22:30:00Z'));
    expect(todayIso()).toBe('2026-10-02');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
```

`web/src/lib/db-errors.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { userMessage } from './db-errors';

describe('userMessage', () => {
  it('passes through business messages raised with hint=user', () => {
    expect(userMessage({ message: 'Lot A1 expired on 2020-01-31. Choose another batch.', hint: 'user', code: 'P0001' })).toBe(
      'Lot A1 expired on 2020-01-31. Choose another batch.',
    );
  });
  it('explains permission errors and hides everything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage({ message: 'Not allowed', code: '42501' })).toBe(
      'You are not allowed to do that. Your session may have ended — sign in again.',
    );
    expect(userMessage({ message: 'syntax error at or near', code: '42601' })).toBe('Something went wrong. Please try again.');
    expect(userMessage(null)).toBeNull();
  });
});
```

`web/src/lib/inventory/labels.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fmtMm, lotLabel, productLabel } from './labels';

const base = { brand: 'Straumann', system: 'BLX', platform: '', description: '', diameter_mm: null, length_mm: null };

describe('labels', () => {
  it('formats sizes the way dentists write them', () => {
    expect(fmtMm(4, 1)).toBe('4.0');
    expect(fmtMm(3.75, 1)).toBe('3.75');
    expect(fmtMm(10, 0)).toBe('10');
    expect(fmtMm(11.5, 0)).toBe('11.5');
  });
  it('labels implants by size and components by description', () => {
    expect(productLabel({ ...base, type: 'implant', diameter_mm: 4, length_mm: 10 })).toBe('Straumann BLX Ø4.0 × 10 mm');
    expect(productLabel({ ...base, type: 'healing_abutment', description: 'Healing abutment 5 mm' })).toBe(
      'Straumann BLX · Healing abutment 5 mm',
    );
    expect(productLabel({ ...base, type: 'ti_base', platform: 'RC' })).toBe('Straumann BLX · RC · Ti-base');
  });
  it('labels batches with lot, expiry and stock', () => {
    expect(lotLabel({ lot_no: 'A123', expiry: '2027-03-01', on_hand: 5 })).toBe('Lot A123 · exp 2027-03-01 · 5 left');
    expect(lotLabel({ lot_no: null, expiry: null, on_hand: 1 })).toBe('No lot · 1 left');
  });
});
```

`web/src/lib/inventory/lots.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { availableLots, stockFlags } from './lots';
import type { LotOnHand } from './types';

const lot = (id: string, extra: Partial<LotOnHand>): LotOnHand => ({
  stock_lot_id: id, product_id: 'p', lot_no: id, expiry: null, received_on: '2026-01-01', qty_received: 5, on_hand: 1, ...extra,
});

describe('availableLots', () => {
  it('offers usable batches of the product, soonest expiry first, no-expiry last', () => {
    const lots = [
      lot('no-expiry', {}),
      lot('late', { expiry: '2028-01-01' }),
      lot('soon', { expiry: '2026-12-01' }),
      lot('expired', { expiry: '2026-09-30' }),
      lot('empty', { on_hand: 0, expiry: '2026-11-01' }),
      lot('other', { product_id: 'q', expiry: '2026-10-15' }),
    ];
    expect(availableLots(lots, 'p', '2026-10-01').map((l) => l.stock_lot_id)).toEqual(['soon', 'late', 'no-expiry']);
  });
  it('a batch expiring today is still usable', () => {
    expect(availableLots([lot('today', { expiry: '2026-10-01' })], 'p', '2026-10-01')).toHaveLength(1);
  });
});

describe('stockFlags', () => {
  it('flags low stock and soon-expiring stock', () => {
    expect(stockFlags({ on_hand: 2, reorder_level: 3, nearest_expiry: '2026-11-15' }, '2026-10-01', 60)).toEqual({ low: true, expiring: true });
    expect(stockFlags({ on_hand: 4, reorder_level: 3, nearest_expiry: '2027-06-01' }, '2026-10-01', 60)).toEqual({ low: false, expiring: false });
    expect(stockFlags({ on_hand: 0, reorder_level: 0, nearest_expiry: null }, '2026-10-01', 60)).toEqual({ low: false, expiring: false });
  });
});
```

`web/src/lib/inventory/components.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { acceptsProduct, activeSite, badgesFor, currentComponent } from './components';
import type { ImplantSite, SiteComponent } from './types';

const comp = (type: SiteComponent['component_type'], removed_on: string | null): SiteComponent => ({
  id: type, component_type: type, fitted_on: '2026-01-01', removed_on, notes: '', product: null, lot: null,
  fitted_by_delegate: null, fitted_by_organizer: null,
});

const site = (tooth: number, state: ImplantSite['state'], components: SiteComponent[] = []): ImplantSite => ({
  id: `${tooth}-${state}`, tooth, state, placed_on: '2026-01-01', torque_ncm: null, graft: '', notes: '', product: null,
  lot: null, placing: null, assisting: null, supervisor: null, components, followups: [], created_at: '2026-01-01T00:00:00Z',
});

describe('component rules', () => {
  it('matches products to component types', () => {
    expect(acceptsProduct('abutment', 'abutment_angled')).toBe(true);
    expect(acceptsProduct('healing_abutment', 'ti_base')).toBe(false);
    expect(acceptsProduct('final_restoration', 'other')).toBe(true);
  });
  it('finds the current component and active site', () => {
    const s = site(36, 'placed', [comp('healing_abutment', '2026-02-01'), comp('ti_base', null)]);
    expect(currentComponent(s)?.component_type).toBe('ti_base');
    expect(activeSite([site(36, 'failed'), s], 36)).toBe(s);
    expect(activeSite([site(36, 'failed')], 36)).toBeNull();
  });
  it('builds chart badges for active implants only', () => {
    expect(
      badgesFor([
        site(36, 'placed', [comp('ti_base', null)]),
        site(46, 'restored', [comp('final_restoration', null)]),
        site(11, 'failed', [comp('healing_abutment', null)]),
        site(21, 'planned'),
      ]),
    ).toEqual({ 36: 'TB', 46: 'CR' });
  });
});
```

`web/src/lib/inventory/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { adjustSchema, componentSchema, delegateSchema, placeSchema, productSchema, receiveSchema } from './schemas';

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('productSchema', () => {
  it('requires sizes for implants and coerces form strings', () => {
    expect(productSchema.parse({ type: 'implant', brand: ' MIS ', diameter_mm: '3.75', length_mm: '11.5', reorder_level: '2' })).toMatchObject({
      brand: 'MIS', diameter_mm: 3.75, length_mm: 11.5, reorder_level: 2,
    });
    expect(err(productSchema.safeParse({ type: 'implant', brand: 'MIS' }))).toBe('Implants need a diameter and a length.');
    expect(productSchema.parse({ type: 'ti_base', brand: 'MIS', diameter_mm: '' })).toMatchObject({ diameter_mm: null });
  });
});

describe('receiveSchema', () => {
  it('validates quantity and optional dates', () => {
    expect(receiveSchema.parse({ product_id: id, quantity: '5', lot_no: ' A1 ', expiry: '', received_on: '2026-01-10' })).toEqual({
      product_id: id, quantity: 5, lot_no: 'A1', expiry: null, received_on: '2026-01-10', notes: '',
    });
    expect(err(receiveSchema.safeParse({ product_id: id, quantity: '0', received_on: '2026-01-10' }))).toBe('Enter a quantity of at least 1.');
    expect(err(receiveSchema.safeParse({ product_id: '', quantity: '1', received_on: '2026-01-10' }))).toBe('Choose a product.');
  });
});

describe('adjustSchema', () => {
  it('turns direction + quantity into a signed delta', () => {
    expect(adjustSchema.parse({ stock_lot_id: id, direction: 'out', quantity: '2', reason: 'waste', note: 'Dropped' })).toEqual({
      stock_lot_id: id, delta: -2, reason: 'waste', note: 'Dropped',
    });
  });
  it('refuses waste going in and a missing reason', () => {
    expect(err(adjustSchema.safeParse({ stock_lot_id: id, direction: 'in', quantity: '1', reason: 'return', note: 'xxx' }))).toBe(
      'Waste and returns take stock out.',
    );
    expect(err(adjustSchema.safeParse({ stock_lot_id: id, direction: 'out', quantity: '1', reason: 'adjust', note: ' ' }))).toBe(
      'Explain the change (at least 3 characters).',
    );
  });
});

describe('delegateSchema', () => {
  it('normalizes and validates', () => {
    expect(delegateSchema.parse({ full_name: ' Dr Karim ', email: ' K@X.COM ', active: 'on' })).toMatchObject({
      full_name: 'Dr Karim', email: 'k@x.com', active: true,
    });
    expect(err(delegateSchema.safeParse({ full_name: 'K' }))).toBe('Enter the delegate’s full name (at least 2 characters).');
  });
});

describe('placeSchema / componentSchema', () => {
  const place = { patientId: id, tooth: 36, productId: id, lotId: id, placedOn: '2026-01-10', placingDelegateId: id, supervisorId: id };
  it('accepts a complete placement and optional fields as null', () => {
    expect(placeSchema.parse({ ...place, assistingDelegateId: '', torque: '' })).toMatchObject({ assistingDelegateId: null, torque: null });
  });
  it('names the first missing piece', () => {
    expect(err(placeSchema.safeParse({ ...place, lotId: '' }))).toBe('Choose a stock batch.');
    expect(err(placeSchema.safeParse({ ...place, placingDelegateId: '' }))).toBe('Choose the delegate who placed the implant.');
    expect(err(placeSchema.safeParse({ ...place, torque: '200' }))).toBe('Enter an insertion torque between 0 and 150 Ncm.');
  });
  it('components need a batch when a product is chosen, and someone who fitted them', () => {
    const c = { siteId: id, patientId: id, componentType: 'ti_base', fittedOn: '2026-01-10', byDelegateId: id };
    expect(componentSchema.safeParse({ ...c, productId: id, lotId: '' }).success).toBe(false);
    expect(err(componentSchema.safeParse({ ...c, byDelegateId: '', byOrganizerId: '' }))).toBe('Choose who fitted the component.');
    expect(componentSchema.parse({ ...c, componentType: 'final_restoration' })).toMatchObject({ productId: null, lotId: null });
  });
});
```

Append to `web/src/lib/patients/history.test.ts` (inside the file, after the last `describe`):
```ts
describe('describeChange — implants', () => {
  it('describes implant records', () => {
    expect(describeChange(entry({ table_name: 'implant_sites', action: 'INSERT', after: { tooth: 36, state: 'planned' } }))).toBe(
      'Implant on tooth 36: Planned',
    );
    expect(
      describeChange(entry({ table_name: 'implant_sites', before: { tooth: 36, state: 'planned' }, after: { tooth: 36, state: 'placed' } })),
    ).toBe('Implant on tooth 36: Planned → Placed');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (unresolved imports; history test fails with
  `implant_sites insert`).

- [ ] **Step 3: Implement**

`web/src/lib/dates.ts`:
```ts
import { APP_TIME_ZONE } from '@/lib/format';

export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in the clinic's time zone (en-CA formats as YYYY-MM-DD). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

In `web/src/lib/patients/schemas.ts`: delete the local `isRealDate` and `todayIso` functions and the
`APP_TIME_ZONE` import, and add `import { isRealDate, todayIso } from '@/lib/dates';`.

`web/src/lib/db-errors.ts`:
```ts
type DbError = { message: string; hint?: string | null; code?: string } | null | undefined;

/** Business errors (raised with hint = 'user') are shown as-is; everything else is logged and hidden. */
export function userMessage(error: DbError): string | null {
  if (!error) return null;
  if (error.hint === 'user') return error.message;
  if (error.code === '42501') return 'You are not allowed to do that. Your session may have ended — sign in again.';
  console.error('Database error:', error.message);
  return 'Something went wrong. Please try again.';
}
```

`web/src/lib/inventory/types.ts`:
```ts
import type { ToothState } from '@/lib/patients/types';

export const PRODUCT_TYPES = [
  'implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane', 'ti_base', 'multi_unit',
  'abutment_straight', 'abutment_angled', 'scan_body', 'impression_coping', 'analog', 'prosthetic_screw', 'other',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  implant: 'Implant', cover_screw: 'Cover screw', healing_abutment: 'Healing abutment', graft: 'Bone graft',
  membrane: 'Membrane', ti_base: 'Ti-base', multi_unit: 'Multi-unit abutment', abutment_straight: 'Straight abutment',
  abutment_angled: 'Angled abutment', scan_body: 'Scan body', impression_coping: 'Impression coping', analog: 'Lab analog',
  prosthetic_screw: 'Prosthetic screw', other: 'Other',
};

const SURGICAL: readonly ProductType[] = ['implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane'];
export function categoryOf(t: ProductType): 'surgical' | 'prosthetic' {
  return SURGICAL.includes(t) ? 'surgical' : 'prosthetic';
}

export type Product = {
  id: string;
  type: ProductType;
  category: 'surgical' | 'prosthetic';
  brand: string;
  system: string;
  platform: string;
  diameter_mm: number | null;
  length_mm: number | null;
  ref_code: string;
  description: string;
  reorder_level: number;
  active: boolean;
  is_sample: boolean;
};

export type LotOnHand = {
  stock_lot_id: string;
  product_id: string;
  lot_no: string | null;
  expiry: string | null;
  received_on: string;
  qty_received: number;
  on_hand: number;
};

export const COMPONENT_TYPES = ['cover_screw', 'healing_abutment', 'ti_base', 'multi_unit', 'abutment', 'final_restoration'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const COMPONENT_LABELS: Record<ComponentType, string> = {
  cover_screw: 'Cover screw', healing_abutment: 'Healing abutment', ti_base: 'Ti-base', multi_unit: 'Multi-unit abutment',
  abutment: 'Abutment', final_restoration: 'Final restoration',
};
export const COMPONENT_BADGES: Record<ComponentType, string> = {
  cover_screw: 'CS', healing_abutment: 'HA', ti_base: 'TB', multi_unit: 'MUA', abutment: 'AB', final_restoration: 'CR',
};

export const SITE_STATES = ['planned', 'placed', 'restored', 'failed', 'removed'] as const;
export type SiteState = (typeof SITE_STATES)[number];
export const SITE_STATE_LABELS: Record<SiteState, string> = {
  planned: 'Planned', placed: 'Placed', restored: 'Restored', failed: 'Failed', removed: 'Cancelled',
};

export const FOLLOWUP_OUTCOMES = ['ok', 'integrated', 'failed', 'complication'] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  ok: 'OK', integrated: 'Integrated', failed: 'Failed', complication: 'Complication',
};

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  receive: 'Received', use: 'Used', adjust: 'Adjusted', waste: 'Wasted', return: 'Returned',
};

export type Option = { id: string; label: string };
type Person = { full_name: string } | null;
type Organizer = { full_name: string; email: string } | null;

export type SiteComponent = {
  id: string;
  component_type: ComponentType;
  fitted_on: string;
  removed_on: string | null;
  notes: string;
  product: Product | null;
  lot: { lot_no: string | null } | null;
  fitted_by_delegate: Person;
  fitted_by_organizer: Organizer;
};

export type Followup = { id: string; date: string; check_type: string; outcome: FollowupOutcome; notes: string };

export type ImplantSite = {
  id: string;
  tooth: number;
  state: SiteState;
  placed_on: string | null;
  torque_ncm: number | null;
  graft: string;
  notes: string;
  product: Product | null;
  lot: { lot_no: string | null; expiry: string | null } | null;
  placing: Person;
  assisting: Person;
  supervisor: Organizer;
  components: SiteComponent[];
  followups: Followup[];
  created_at: string;
};

export type ChartData = {
  statuses: Partial<Record<number, ToothState>>;
  sites: ImplantSite[];
  implants: Product[];
  componentProducts: Product[];
  lots: LotOnHand[];
  delegates: Option[];
  organizers: Option[];
  today: string;
  me: string;
};
```

`web/src/lib/inventory/labels.ts`:
```ts
import { PRODUCT_TYPE_LABELS, type LotOnHand, type Product } from './types';

/** 4 → "4.0" (minDecimals 1), 3.75 → "3.75", 10 → "10" (minDecimals 0), 11.5 → "11.5". */
export function fmtMm(n: number, minDecimals: number): string {
  const s = String(Number(n));
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  return Number(n).toFixed(Math.max(decimals, minDecimals));
}

type LabelInput = Pick<Product, 'type' | 'brand' | 'system' | 'platform' | 'description' | 'diameter_mm' | 'length_mm'>;

export function productLabel(p: LabelInput): string {
  const head = [p.brand, p.system].filter(Boolean).join(' ');
  if (p.type === 'implant' && p.diameter_mm !== null && p.length_mm !== null) {
    return `${head} Ø${fmtMm(p.diameter_mm, 1)} × ${fmtMm(p.length_mm, 0)} mm`;
  }
  return [head, p.platform, p.description || PRODUCT_TYPE_LABELS[p.type]].filter(Boolean).join(' · ');
}

export function lotLabel(lot: Pick<LotOnHand, 'lot_no' | 'expiry' | 'on_hand'>): string {
  const name = lot.lot_no ? `Lot ${lot.lot_no}` : 'No lot';
  return `${name}${lot.expiry ? ` · exp ${lot.expiry}` : ''} · ${lot.on_hand} left`;
}
```

`web/src/lib/inventory/lots.ts`:
```ts
import { addDays } from '@/lib/dates';
import type { LotOnHand } from './types';

/** Batches that can be used today for this product: in stock, not expired; soonest expiry first, no expiry last. */
export function availableLots(lots: readonly LotOnHand[], productId: string, today: string): LotOnHand[] {
  return lots
    .filter((l) => l.product_id === productId && l.on_hand > 0 && !(l.expiry && l.expiry < today))
    .sort((a, b) => {
      if (a.expiry !== b.expiry) {
        if (!a.expiry) return 1;
        if (!b.expiry) return -1;
        return a.expiry < b.expiry ? -1 : 1;
      }
      return a.received_on < b.received_on ? -1 : a.received_on > b.received_on ? 1 : 0;
    });
}

export function stockFlags(
  row: { on_hand: number; reorder_level: number; nearest_expiry: string | null },
  today: string,
  alertDays: number,
): { low: boolean; expiring: boolean } {
  return {
    low: row.reorder_level > 0 && row.on_hand <= row.reorder_level,
    expiring: row.nearest_expiry !== null && row.nearest_expiry <= addDays(today, alertDays),
  };
}
```

`web/src/lib/inventory/components.ts`:
```ts
import { COMPONENT_BADGES, type ComponentType, type ImplantSite, type ProductType, type SiteComponent } from './types';

/** Mirrors app_private.component_accepts in the database. */
export const COMPONENT_ACCEPTS: Record<ComponentType, readonly ProductType[]> = {
  cover_screw: ['cover_screw'],
  healing_abutment: ['healing_abutment'],
  ti_base: ['ti_base'],
  multi_unit: ['multi_unit'],
  abutment: ['abutment_straight', 'abutment_angled'],
  final_restoration: ['other'],
};

export function acceptsProduct(component: ComponentType, product: ProductType): boolean {
  return COMPONENT_ACCEPTS[component].includes(product);
}

export function currentComponent(site: ImplantSite): SiteComponent | null {
  return site.components.find((c) => c.removed_on === null) ?? null;
}

export function activeSite(sites: readonly ImplantSite[], tooth: number): ImplantSite | null {
  return sites.find((s) => s.tooth === tooth && (s.state === 'planned' || s.state === 'placed' || s.state === 'restored')) ?? null;
}

export function badgesFor(sites: readonly ImplantSite[]): Partial<Record<number, string>> {
  const badges: Partial<Record<number, string>> = {};
  for (const site of sites) {
    if (site.state !== 'placed' && site.state !== 'restored') continue;
    const current = currentComponent(site);
    if (current) badges[site.tooth] = COMPONENT_BADGES[current.component_type];
  }
  return badges;
}
```

`web/src/lib/inventory/schemas.ts`:
```ts
import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { COMPONENT_TYPES, FOLLOWUP_OUTCOMES, PRODUCT_TYPES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const pastDate = (message: string) => z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message });
const optionalNumber = (min: number, max: number, message: string) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).min(min, { message }).max(max, { message }).nullable());
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const productSchema = z
  .object({
    type: z.enum(PRODUCT_TYPES, { message: 'Choose the product type.' }),
    brand: z.string().trim().min(1, { message: 'Enter the brand.' }).max(60),
    system: text(60),
    platform: text(40),
    diameter_mm: optionalNumber(2, 9, 'Enter a diameter between 2 and 9 mm.'),
    length_mm: optionalNumber(4, 25, 'Enter a length between 4 and 25 mm.'),
    ref_code: text(60),
    description: text(200),
    reorder_level: z.preprocess((v) => (blankToNull(v) === null ? 0 : Number(v)), z.number().int().min(0).max(10000, { message: 'Enter a reorder level between 0 and 10000.' })),
  })
  .refine((p) => p.type !== 'implant' || (p.diameter_mm !== null && p.length_mm !== null), {
    message: 'Implants need a diameter and a length.',
  });

export const receiveSchema = z.object({
  product_id: requiredId('Choose a product.'),
  quantity: z.coerce.number().int({ message: 'Enter a whole number.' }).min(1, { message: 'Enter a quantity of at least 1.' }).max(100000),
  lot_no: text(60),
  expiry: z.preprocess(blankToNull, z.string().refine(isRealDate, { message: 'Enter a valid expiry date or leave it empty.' }).nullable()),
  received_on: pastDate('Enter the date received (today or earlier).'),
  notes: text(500),
});

export const adjustSchema = z
  .object({
    stock_lot_id: requiredId('Stock batch not found.'),
    direction: z.enum(['out', 'in']),
    quantity: z.coerce.number().int().min(1, { message: 'Enter a quantity of at least 1.' }).max(100000),
    reason: z.enum(['adjust', 'waste', 'return'], { message: 'Choose adjust, waste or return.' }),
    note: z.string().trim().min(3, { message: 'Explain the change (at least 3 characters).' }).max(500),
  })
  .refine((a) => a.reason === 'adjust' || a.direction === 'out', { message: 'Waste and returns take stock out.' })
  .transform((a) => ({ stock_lot_id: a.stock_lot_id, delta: a.direction === 'out' ? -a.quantity : a.quantity, reason: a.reason, note: a.note }));

export const delegateSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the delegate’s full name (at least 2 characters).' }).max(120),
  phone: text(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .default('')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, { message: 'Enter a valid email address or leave it empty.' }),
  licence_no: text(60),
  notes: text(1000),
  active: checkbox,
});

const tooth = z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' });

export const planSchema = z.object({
  patientId: requiredId('Patient not found.'),
  tooth,
  productId: optionalId,
  notes: text(1000),
});

export const placeSchema = z.object({
  patientId: requiredId('Patient not found.'),
  tooth,
  productId: requiredId('Choose the implant.'),
  lotId: requiredId('Choose a stock batch.'),
  placedOn: pastDate('Enter the placement date (today or earlier).'),
  placingDelegateId: requiredId('Choose the delegate who placed the implant.'),
  assistingDelegateId: optionalId,
  supervisorId: requiredId('Choose the supervising organizer.'),
  torque: optionalNumber(0, 150, 'Enter an insertion torque between 0 and 150 Ncm.'),
  graft: text(200),
  notes: text(1000),
});

export const componentSchema = z
  .object({
    siteId: requiredId('Implant not found.'),
    patientId: requiredId('Patient not found.'),
    componentType: z.enum(COMPONENT_TYPES, { message: 'Choose the component.' }),
    fittedOn: pastDate('Enter the date the component was fitted (today or earlier).'),
    productId: optionalId,
    lotId: optionalId,
    byDelegateId: optionalId,
    byOrganizerId: optionalId,
    notes: text(1000),
  })
  .refine((c) => c.productId === null || c.lotId !== null, { message: 'Choose the stock batch used.' })
  .refine((c) => c.byDelegateId !== null || c.byOrganizerId !== null, { message: 'Choose who fitted the component.' });

export const followupSchema = z.object({
  siteId: requiredId('Implant not found.'),
  patientId: requiredId('Patient not found.'),
  date: pastDate('Enter the follow-up date (today or earlier).'),
  checkType: z.string().trim().min(1, { message: 'Enter the check (e.g. 3-month).' }).max(60),
  outcome: z.enum(FOLLOWUP_OUTCOMES, { message: 'Choose the outcome.' }),
  notes: text(1000),
});
```

In `web/src/lib/patients/history.ts`, add before `default:` in `describeChange`:
```ts
    case 'implant_sites': {
      const tooth = (e.after ?? e.before)?.tooth;
      const label = (v: unknown) => SITE_STATE_LABELS[v as SiteState] ?? String(v);
      if (e.action === 'INSERT' || !e.before) return `Implant on tooth ${tooth}: ${label(e.after?.state)}`;
      if (e.before.state === e.after?.state) return `Implant on tooth ${tooth} updated`;
      return `Implant on tooth ${tooth}: ${label(e.before.state)} → ${label(e.after?.state)}`;
    }
```
and add at the top: `import { SITE_STATE_LABELS, type SiteState } from '@/lib/inventory/types';`.

- [ ] **Step 4: Run unit tests** — `npm test` → PASS. Also `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "feat(inventory): domain logic for labels, batches, components, validation and DB errors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Component badges on the odontogram

**Files:**
- Modify: `web/src/components/odontogram/odontogram.tsx`
- Test: `web/src/components/odontogram/odontogram.test.tsx` (append)

**Interfaces:**
- Produces: `<Odontogram … badges?={Partial<Record<number, string>>} />`; each badge renders as
  `<text data-badge>` inside its tooth button and is included in the accessible name
  (`"Tooth 36, Implant placed, TB"`).

- [ ] **Step 1: Write the failing test** — append to `odontogram.test.tsx`:

```tsx
describe('<Odontogram> badges', () => {
  it('shows the current component badge and announces it', () => {
    render(<Odontogram statuses={{ 36: 'implant_placed' }} badges={{ 36: 'TB' }} selected={[]} onSelect={vi.fn()} />);
    const tooth = screen.getByRole('button', { name: 'Tooth 36, Implant placed, TB' });
    expect(tooth.querySelector('[data-badge]')?.textContent).toBe('TB');
    expect(screen.getByRole('button', { name: 'Tooth 46, Present' }).querySelector('[data-badge]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- odontogram` → FAIL (no button with that name).

- [ ] **Step 3: Implement** — in `web/src/components/odontogram/odontogram.tsx`:
  - add `badges?: Partial<Record<number, string>>;` to `Props`;
  - add `badge: string | undefined` to the `Tooth` props and pass `badge={badges?.[box.fdi]}` from
    `Odontogram` (destructure `badges` in `Odontogram`);
  - change the tooth's `aria-label` to
    ``aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}${badge ? `, ${badge}` : ''}`}``;
  - render, right after the transformed `<g>` that holds `ToothGraphic`:

```tsx
      {badge && (
        <g data-badge>
          <rect x={box.x + 4} y={box.y + (box.jaw === 'upper' ? 96 : 20)} width={TOOTH_W - 8} height={16} rx={3} fill="#1e3a8a" />
          <text
            x={box.x + TOOTH_W / 2}
            y={box.y + (box.jaw === 'upper' ? 108 : 32)}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill="#ffffff"
          >
            {badge}
          </text>
        </g>
      )}
```

  The `data-badge` element's text content is exactly the badge (the `<rect>` has no text).

- [ ] **Step 4: Run unit tests** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/odontogram
git commit -m "feat(odontogram): component badges on implant teeth" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Delegates pages (+ E2E API helpers and teardown)

**Files:**
- Create: `web/tests/e2e/api.ts`, `web/tests/e2e/delegates.spec.ts`
- Create: `web/src/app/(app)/delegates/{page,delegate-form,actions}.tsx|ts`, `web/src/app/(app)/delegates/[id]/page.tsx`
- Modify: `web/src/components/nav-items.ts` (+ test), `web/tests/e2e/patients.ts`, `web/tests/e2e/global-teardown.ts`

**Interfaces:**
- Consumes: `delegateSchema`, `FormState`, `failed`, `valueOf`, `checkedOf`, `requireActiveUser`, `userMessage`.
- Produces: actions `createDelegate(prev, fd)`, `updateDelegate(prev, fd)`; E2E `apiAs(email)`,
  `seedProduct(api, fields)`, `seedImplantStock(api, { brand, qty, lot, expiry })`, `seedDelegate(api, name)`;
  teardown `deactivateE2eCatalog()`.

- [ ] **Step 1: Nav (test first)** — in `web/src/components/nav-items.test.ts` expect
  `['Dashboard', 'Patients', 'Inventory', 'Delegates', 'Admin']` (admin) and
  `['Dashboard', 'Patients', 'Inventory', 'Delegates']` (organizer). Run `npm test -- nav-items` → FAIL.
  Then in `nav-items.ts` add after Patients:

```ts
  { href: '/inventory', label: 'Inventory' },
  { href: '/delegates', label: 'Delegates' },
```

Run `npm test -- nav-items` → PASS.

- [ ] **Step 2: E2E API helpers** — `web/tests/e2e/api.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEST_PASSWORD } from '../support/test-users';

/** A Supabase client signed in as a test user: goes through the same RLS and functions as the app. */
export async function apiAs(email: string): Promise<SupabaseClient> {
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await api.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  return api;
}

export async function seedProduct(
  api: SupabaseClient,
  fields: { type: string; brand: string; system?: string; description?: string; diameter_mm?: number; length_mm?: number },
): Promise<string> {
  const { data, error } = await api.from('products').insert({ system: 'E2E', ...fields }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function receiveStock(
  api: SupabaseClient,
  product: string,
  qty: number,
  lot: string | null,
  expiry: string | null,
): Promise<string> {
  const { data, error } = await api.rpc('receive_stock', { p_product: product, p_qty: qty, p_lot_no: lot, p_expiry: expiry });
  if (error) throw error;
  return data as string;
}

export async function seedImplantStock(
  api: SupabaseClient,
  o: { brand: string; qty: number; lot: string | null; expiry: string | null },
): Promise<{ productId: string; lotId: string }> {
  const productId = await seedProduct(api, { type: 'implant', brand: o.brand, diameter_mm: 4, length_mm: 10 });
  const lotId = await receiveStock(api, productId, o.qty, o.lot, o.expiry);
  return { productId, lotId };
}

export async function seedDelegate(api: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await api.from('delegates').insert({ full_name: name }).select('id').single();
  if (error) throw error;
  return data.id;
}
```

- [ ] **Step 3: Teardown** — in `web/tests/e2e/patients.ts` replace `deleteE2ePatients` with:

```ts
/**
 * E2E rows live in the dev project. Patients with stock movements stay (the ledger is immutable);
 * E2E catalog items and delegates are deactivated (they are referenced by the ledger).
 */
export async function deleteE2ePatients(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query(
      `delete from public.patients p where p.full_name like $1
       and not exists (select 1 from public.stock_movements m where m.patient_id = p.id)
       and not exists (select 1 from public.implant_sites s
                       join public.stock_movements m on m.implant_site_id = s.id where s.patient_id = p.id)`,
      [`${E2E_PREFIX}%`],
    );
  } finally {
    await pg.end();
  }
}

export async function deactivateE2eCatalog(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('update public.products set active = false where brand like $1 and active', [`${E2E_PREFIX}%`]);
    await pg.query('update public.delegates set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}
```

and in `web/tests/e2e/global-teardown.ts` import `deactivateE2eCatalog` and call it after
`deleteE2ePatients()`.

- [ ] **Step 4: Write the failing E2E tests** — `web/tests/e2e/delegates.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('adds, edits and deactivates a delegate', async ({ page }) => {
  const name = uniqueName('Dr Delegate');
  await page.getByRole('link', { name: 'Delegates' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Licence number').fill('EG-555');
  await page.getByRole('button', { name: 'Add delegate' }).click();
  const row = page.getByTestId(`delegate-row-${name}`);
  await expect(row).toContainText('EG-555');
  await expect(page.getByLabel('Full name')).toHaveValue('');

  await row.getByRole('link', { name }).click();
  await page.getByLabel('Phone').fill('0100 999 8888');
  await page.getByLabel('Active').uncheck();
  await page.getByRole('button', { name: 'Save delegate' }).click();
  await expect(page.getByText('Delegate saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Delegates' }).click();
  await expect(page.getByTestId(`delegate-row-${name}`)).toContainText('Inactive');
});

test('a too-short name is refused and the input kept', async ({ page }) => {
  await page.goto('/delegates');
  await page.getByLabel('Full name').fill('K');
  await page.getByLabel('Licence number').fill('EG-1');
  await page.getByRole('button', { name: 'Add delegate' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter the delegate’s full name (at least 2 characters).');
  await expect(page.getByLabel('Licence number')).toHaveValue('EG-1');
});
```

Run: `npm run test:e2e -- delegates.spec.ts` → FAIL (no Delegates link / 404).

- [ ] **Step 5: Implement**

`web/src/app/(app)/delegates/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { delegateSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = delegateSchema.safeParse({ ...Object.fromEntries(formData), active: 'on' });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('delegates').insert(parsed.data);
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/delegates');
  return { ok: `${parsed.data.full_name} added.` };
}

export async function updateDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const parsed = delegateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('delegates').update(parsed.data).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Delegate not found.', formData);
  revalidatePath('/delegates');
  revalidatePath(`/delegates/${id}`);
  return { ok: 'Delegate saved.' };
}
```

`web/src/app/(app)/delegates/delegate-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';

export type DelegateRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  licence_no: string;
  notes: string;
  active: boolean;
};

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  delegate?: DelegateRow;
};

export function DelegateForm({ action, delegate }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  // After a successful add, show empty fields again; after a failure, keep the typed values.
  const v = (key: keyof DelegateRow) => valueOf(state, key, state.ok && !delegate ? '' : ((delegate?.[key] as string) ?? ''));
  return (
    <form action={formAction} className="card grid max-w-2xl gap-4 sm:grid-cols-2" key={delegate ? delegate.id : state.ok}>
      {delegate && <input type="hidden" name="id" value={delegate.id} readOnly />}
      <label className="block">
        <span className="label">Full name</span>
        <input className="input" name="full_name" defaultValue={v('full_name')} />
      </label>
      <label className="block">
        <span className="label">Licence number</span>
        <input className="input" name="licence_no" defaultValue={v('licence_no')} />
      </label>
      <label className="block">
        <span className="label">Phone</span>
        <input className="input" name="phone" type="tel" defaultValue={v('phone')} />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="text" inputMode="email" defaultValue={v('email')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <input className="input" name="notes" defaultValue={v('notes')} />
      </label>
      {delegate && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={checkedOf(state, 'active', delegate.active)} />
          Active
        </label>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          {delegate ? 'Save delegate' : 'Add delegate'}
        </button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/delegates/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DelegateForm, type DelegateRow } from './delegate-form';
import { createDelegate } from './actions';

export default async function DelegatesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('delegates')
    .select('id, full_name, phone, email, licence_no, notes, active')
    .order('active', { ascending: false })
    .order('full_name');
  if (error) throw new Error('Could not load delegates');
  const delegates = (data ?? []) as DelegateRow[];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Delegates</h1>
      <section className="space-y-2">
        <h2 className="font-semibold">Add a delegate</h2>
        <DelegateForm action={createDelegate} />
      </section>
      <div className="card overflow-x-auto">
        {delegates.length === 0 ? (
          <p className="text-gray-600">No delegates yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Licence</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((d) => (
                <tr key={d.id} data-testid={`delegate-row-${d.full_name}`} className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/delegates/${d.id}`} className="text-blue-700 hover:underline">
                      {d.full_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{d.licence_no || '—'}</td>
                  <td className="py-2 pr-4">{d.phone || '—'}</td>
                  <td className="py-2">{d.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

`web/src/app/(app)/delegates/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { DelegateForm, type DelegateRow } from '../delegate-form';
import { updateDelegate } from '../actions';

export default async function DelegatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from('delegates')
    .select('id, full_name, phone, email, licence_no, notes, active')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const delegate = data as DelegateRow;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{delegate.full_name}</h1>
      <DelegateForm action={updateDelegate} delegate={delegate} />
    </div>
  );
}
```

Note: `key={state.ok}` on the add form remounts it after each successful add so the fields
clear; on failure the key is unchanged and `values` keep the input.

- [ ] **Step 6: Run E2E** — `npm run test:e2e -- delegates.spec.ts` → PASS (2).

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(delegates): delegate registry pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inventory — stock overview and catalog products

**Files:**
- Create: `web/src/app/(app)/inventory/layout.tsx`, `inventory/page.tsx`,
  `inventory/products/new/page.tsx`, `inventory/products/product-form.tsx`, `inventory/products/actions.ts`,
  `inventory/products/[id]/page.tsx`
- Test: `web/tests/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: `inventory_overview()`, `stock_on_hand`, `productSchema`, `productLabel`, `stockFlags`, `lotLabel`,
  `PRODUCT_TYPES`, `PRODUCT_TYPE_LABELS`, `getSettings`, `todayIso`, `FormState`.
- Produces: actions `createProduct`, `updateProduct`; stock rows `data-testid="stock-row-<product id>"`.

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/inventory.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, receiveStock, seedProduct } from './api';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('the sample catalog is visible and flagged', async ({ page }) => {
  await page.goto('/inventory?all=1&q=Straumann%20BLX');
  await expect(page.getByRole('main')).toContainText('Straumann BLX Ø4.0 × 10 mm');
  await expect(page.getByRole('main').getByText('Sample — verify').first()).toBeVisible();
});

test('adds a product and edits its reorder level', async ({ page }) => {
  const brand = uniqueName('Brand');
  await page.getByRole('link', { name: 'Inventory' }).click();
  await page.getByRole('link', { name: 'Add product' }).click();
  await page.getByLabel('Type').selectOption('implant');
  await page.getByLabel('Brand').fill(brand);
  await page.getByLabel('System').fill('X1');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Implants need a diameter and a length.');
  await expect(page.getByLabel('Brand')).toHaveValue(brand);
  await page.getByLabel('Diameter (mm)').fill('4.1');
  await page.getByLabel('Length (mm)').fill('10');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${brand} X1 Ø4.1 × 10 mm`);
  await page.getByLabel('Reorder level').fill('5');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product saved.')).toBeVisible();
});

test('stock overview shows on hand, low stock and expiring flags', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Stock');
  const product = await seedProduct(api, { type: 'healing_abutment', brand, description: 'HA 5 mm' });
  await api.from('products').update({ reorder_level: 5 }).eq('id', product);
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await receiveStock(api, product, 3, 'EXP-SOON', soon);
  await page.goto(`/inventory?q=${encodeURIComponent(brand)}`);
  const row = page.getByTestId(`stock-row-${product}`);
  await expect(row).toContainText('3');
  await expect(row).toContainText('Low stock');
  await expect(row).toContainText('Expiring');
});
```

Run: `npm run test:e2e -- inventory.spec.ts` → FAIL (no Inventory page).

- [ ] **Step 2: Implement**

`web/src/app/(app)/inventory/layout.tsx`:
```tsx
import Link from 'next/link';

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Inventory sections" className="flex flex-wrap gap-4 border-b border-gray-200 pb-2 text-sm">
        <Link href="/inventory" className="hover:underline">Stock</Link>
        <Link href="/inventory/receive" className="hover:underline">Receive stock</Link>
        <Link href="/inventory/products/new" className="hover:underline">Add product</Link>
        <Link href="/inventory/recall" className="hover:underline">Recall lookup</Link>
      </nav>
      {children}
    </div>
  );
}
```

`web/src/app/(app)/inventory/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import { PRODUCT_TYPE_LABELS, type Product } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';

type Row = Product & { on_hand: number; nearest_expiry: string | null };

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; all?: string }>;
}) {
  const { q = '', category = '', all } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, settings] = await Promise.all([
    supabase.rpc('inventory_overview', { q: String(q), p_category: String(category), include_all: all === '1' }),
    getSettings(),
  ]);
  if (error) throw new Error('Could not load stock');
  const rows = (data ?? []) as Row[];
  const today = todayIso();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Stock</h1>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Search products</span>
          <input className="input" name="q" defaultValue={q} placeholder="Brand, system, size or reference" />
        </label>
        <label className="block">
          <span className="label">Category</span>
          <select className="input" name="category" defaultValue={category}>
            <option value="">All</option>
            <option value="surgical">Surgical</option>
            <option value="prosthetic">Prosthetic</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={all === '1'} />
          Show the whole catalog
        </label>
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-gray-600">
            No stocked products match. Tick “Show the whole catalog” to see every product, or receive stock.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Product</th>
                <th className="pb-2">Type</th>
                <th className="pb-2 text-right">On hand</th>
                <th className="pb-2 text-right">Reorder at</th>
                <th className="pb-2">Nearest expiry</th>
                <th className="pb-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flags = stockFlags(r, today, settings.expiry_alert_days);
                return (
                  <tr key={r.id} data-testid={`stock-row-${r.id}`} className="border-t border-gray-200">
                    <td className="py-2 pr-4">
                      <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">
                        {productLabel(r)}
                      </Link>
                      {!r.active && <span className="ml-2 text-xs text-gray-500">(inactive)</span>}
                    </td>
                    <td className="py-2 pr-4">{PRODUCT_TYPE_LABELS[r.type]}</td>
                    <td className="py-2 pr-4 text-right font-medium">{r.on_hand}</td>
                    <td className="py-2 pr-4 text-right">{r.reorder_level || '—'}</td>
                    <td className="py-2 pr-4">{r.nearest_expiry ? formatDate(r.nearest_expiry) : '—'}</td>
                    <td className="space-x-1 py-2">
                      {flags.low && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">Low stock</span>}
                      {flags.expiring && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">Expiring</span>}
                      {r.is_sample && <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-700">Sample — verify</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

`web/src/app/(app)/inventory/products/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { productSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').insert(parsed.data).select('id').single();
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/inventory/products/${data.id}`);
}

export async function updateProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .update({ ...parsed.data, active: formData.get('active') === 'on', is_sample: formData.get('is_sample') === 'on' })
    .eq('id', id)
    .select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Product not found.', formData);
  revalidatePath(`/inventory/products/${id}`);
  revalidatePath('/inventory');
  return { ok: 'Product saved.' };
}
```

`web/src/app/(app)/inventory/products/product-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type Product } from '@/lib/inventory/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  product?: Product;
};

export function ProductForm({ action, product }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Product) => {
    const raw = product?.[key];
    return valueOf(state, key, raw === null || raw === undefined ? '' : String(raw));
  };
  return (
    <form action={formAction} className="card grid max-w-3xl gap-4 sm:grid-cols-3">
      {product && <input type="hidden" name="id" value={product.id} readOnly />}
      <label className="block">
        <span className="label">Type</span>
        <select className="input" name="type" defaultValue={v('type') || 'implant'}>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRODUCT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Brand</span>
        <input className="input" name="brand" defaultValue={v('brand')} />
      </label>
      <label className="block">
        <span className="label">System</span>
        <input className="input" name="system" defaultValue={v('system')} />
      </label>
      <label className="block">
        <span className="label">Diameter (mm)</span>
        <input className="input" name="diameter_mm" inputMode="decimal" defaultValue={v('diameter_mm')} />
      </label>
      <label className="block">
        <span className="label">Length (mm)</span>
        <input className="input" name="length_mm" inputMode="decimal" defaultValue={v('length_mm')} />
      </label>
      <label className="block">
        <span className="label">Platform</span>
        <input className="input" name="platform" defaultValue={v('platform')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Description</span>
        <input className="input" name="description" defaultValue={v('description')} />
      </label>
      <label className="block">
        <span className="label">Reference code</span>
        <input className="input" name="ref_code" defaultValue={v('ref_code')} />
      </label>
      <label className="block">
        <span className="label">Reorder level</span>
        <input className="input" name="reorder_level" inputMode="numeric" defaultValue={v('reorder_level') || '0'} />
      </label>
      {product && (
        <div className="flex flex-col justify-end gap-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={checkedOf(state, 'active', product.active)} />
            Active (offered when receiving and placing)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_sample" defaultChecked={checkedOf(state, 'is_sample', product.is_sample)} />
            Sample entry — not yet verified against the supplier
          </label>
        </div>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-3">{state.ok}</p>}
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>
          Save product
        </button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/inventory/products/new/page.tsx`:
```tsx
import { ProductForm } from '../product-form';
import { createProduct } from '../actions';

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add product</h1>
      <ProductForm action={createProduct} />
    </div>
  );
}
```

`web/src/app/(app)/inventory/products/[id]/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import type { LotOnHand, Product } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { ProductForm } from '../product-form';
import { updateProduct } from '../actions';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: product }, { data: lots }] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase.from('stock_on_hand').select('*').eq('product_id', id).order('received_on', { ascending: false }),
  ]);
  if (!product) notFound();
  const p = product as Product;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{productLabel(p)}</h1>
        <Link href={`/inventory/receive?product=${p.id}`} className="btn">
          Receive stock
        </Link>
      </div>
      <ProductForm action={updateProduct} product={p} />
      <section className="card space-y-3">
        <h2 className="font-semibold">Batches</h2>
        {(lots ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No stock received yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Lot</th>
                <th className="pb-2">Expiry</th>
                <th className="pb-2">Received</th>
                <th className="pb-2 text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {(lots as LotOnHand[]).map((l) => (
                <tr key={l.stock_lot_id} className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/inventory/lots/${l.stock_lot_id}`} className="text-blue-700 hover:underline">
                      {l.lot_no ?? 'No lot'}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{l.expiry ? formatDate(l.expiry) : '—'}</td>
                  <td className="py-2 pr-4">{formatDate(l.received_on)}</td>
                  <td className="py-2 text-right">{l.on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run E2E** — `npm run test:e2e -- inventory.spec.ts` → PASS (3).

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(inventory): stock overview with flags and product catalog pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Receive stock, batch page (ledger, adjust, used in) and recall lookup

**Files:**
- Create: `web/src/app/(app)/inventory/receive/{page,receive-form,actions}.tsx|ts`,
  `web/src/app/(app)/inventory/lots/[id]/{page,adjust-form,actions}.tsx|ts`,
  `web/src/app/(app)/inventory/recall/page.tsx`
- Test: `web/tests/e2e/inventory.spec.ts` (append)

**Interfaces:**
- Consumes: `receive_stock`, `adjust_stock`, `lot_usage`, `search_lots`, `receiveSchema`, `adjustSchema`,
  `productLabel`, `MOVEMENT_REASON_LABELS`, `userMessage`, `todayIso`.
- Produces: actions `receiveStock(prev, fd)` (redirects to the batch), `adjustStock(prev, fd)`;
  ledger rows `data-testid="ledger-row"`; usage rows `data-testid="usage-row"`.

- [ ] **Step 1: Append the failing E2E tests** to `web/tests/e2e/inventory.spec.ts`:

```ts
test('receives stock, adjusts it and shows the ledger', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Receive');
  const product = await seedProduct(api, { type: 'ti_base', brand });
  const lotNo = `E2E-L${Date.now()}`;

  await page.goto(`/inventory/receive?product=${product}`);
  await page.getByLabel('Quantity').fill('5');
  await page.getByLabel('Lot number (optional)').fill(lotNo);
  await page.getByLabel('Expiry (optional)').fill('2031-06-30');
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Lot ${lotNo}`);
  await expect(page.getByTestId('on-hand')).toHaveText('5');

  await page.getByLabel('Reason').selectOption('waste');
  await page.getByLabel('Quantity').fill('1');
  await page.getByLabel('Note').fill('Dropped during surgery');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByTestId('on-hand')).toHaveText('4');
  await expect(page.getByTestId('ledger-row')).toHaveCount(2);
  await expect(page.getByTestId('ledger-row').first()).toContainText('Wasted');
  await expect(page.getByTestId('ledger-row').first()).toContainText('-1');

  await page.getByLabel('Reason').selectOption('return');
  await page.getByLabel('Quantity').fill('9');
  await page.getByLabel('Note').fill('Back to supplier');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Only 4 left in this batch.');

  await page.getByRole('link', { name: 'Recall lookup' }).click();
  await page.getByLabel('Lot number').fill(lotNo.toLowerCase());
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByRole('link', { name: lotNo })).toBeVisible();
});

test('a batch can be received without a lot number', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const product = await seedProduct(api, { type: 'cover_screw', brand: uniqueName('NoLot') });
  await page.goto(`/inventory/receive?product=${product}`);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No lot number');
  await expect(page.getByTestId('on-hand')).toHaveText('2');
});
```

Run: `npm run test:e2e -- inventory.spec.ts` → the two new tests FAIL (404).

- [ ] **Step 2: Implement**

`web/src/app/(app)/inventory/receive/actions.ts`:
```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { receiveSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function receiveStock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = receiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const r = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('receive_stock', {
    p_product: r.product_id,
    p_qty: r.quantity,
    p_lot_no: r.lot_no || null,
    p_expiry: r.expiry,
    p_received_on: r.received_on,
    p_notes: r.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/inventory/lots/${data}`);
}
```

`web/src/app/(app)/inventory/receive/receive-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { receiveStock } from './actions';

type Group = { brand: string; options: { id: string; label: string }[] };

export function ReceiveForm({ groups, productId, today }: { groups: Group[]; productId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(receiveStock, {});
  return (
    <form action={action} className="card grid max-w-3xl gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="label">Product</span>
        <select className="input" name="product_id" defaultValue={valueOf(state, 'product_id', productId)}>
          <option value="">Choose a product…</option>
          {groups.map((g) => (
            <optgroup key={g.brand} label={g.brand}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Quantity</span>
        <input className="input" name="quantity" inputMode="numeric" defaultValue={valueOf(state, 'quantity', '')} />
      </label>
      <label className="block">
        <span className="label">Received on</span>
        <input className="input" name="received_on" type="date" defaultValue={valueOf(state, 'received_on', today)} />
      </label>
      <label className="block">
        <span className="label">Lot number (optional)</span>
        <input className="input" name="lot_no" defaultValue={valueOf(state, 'lot_no', '')} />
      </label>
      <label className="block">
        <span className="label">Expiry (optional)</span>
        <input className="input" name="expiry" type="date" defaultValue={valueOf(state, 'expiry', '')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes (optional)</span>
        <input className="input" name="notes" defaultValue={valueOf(state, 'notes', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          Receive
        </button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/inventory/receive/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import type { Product } from '@/lib/inventory/types';
import { ReceiveForm } from './receive-form';

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product = '' } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').select('*').eq('active', true);
  if (error) throw new Error('Could not load products');
  const products = (data ?? []) as Product[];
  const byBrand = new Map<string, { id: string; label: string }[]>();
  for (const p of products) {
    const list = byBrand.get(p.brand) ?? [];
    list.push({ id: p.id, label: productLabel(p) });
    byBrand.set(p.brand, list);
  }
  const groups = [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, options]) => ({ brand, options: options.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Receive stock</h1>
      <ReceiveForm groups={groups} productId={String(product)} today={todayIso()} />
    </div>
  );
}
```

`web/src/app/(app)/inventory/lots/[id]/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { adjustSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function adjustStock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const a = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('adjust_stock', { p_lot: a.stock_lot_id, p_delta: a.delta, p_reason: a.reason, p_note: a.note });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/inventory/lots/${a.stock_lot_id}`);
  return { ok: 'Change recorded.' };
}
```

`web/src/app/(app)/inventory/lots/[id]/adjust-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { adjustStock } from './actions';

export function AdjustForm({ lotId }: { lotId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(adjustStock, {});
  return (
    <form action={action} className="card grid max-w-3xl gap-4 sm:grid-cols-4" key={state.ok}>
      <h2 className="font-semibold sm:col-span-4">Record a change</h2>
      <input type="hidden" name="stock_lot_id" value={lotId} readOnly />
      <label className="block">
        <span className="label">Reason</span>
        <select className="input" name="reason" defaultValue={valueOf(state, 'reason', 'waste')}>
          <option value="waste">Waste</option>
          <option value="return">Return to supplier</option>
          <option value="adjust">Stock count correction</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Direction</span>
        <select className="input" name="direction" defaultValue={valueOf(state, 'direction', 'out')}>
          <option value="out">Take out</option>
          <option value="in">Add back</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Quantity</span>
        <input className="input" name="quantity" inputMode="numeric" defaultValue={valueOf(state, 'quantity', '1')} />
      </label>
      <label className="block sm:col-span-4">
        <span className="label">Note</span>
        <input className="input" name="note" defaultValue={valueOf(state, 'note', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-4">{state.ok}</p>}
      <div className="sm:col-span-4">
        <button className="btn-secondary btn" disabled={pending}>
          Record change
        </button>
      </div>
    </form>
  );
}
```

`web/src/app/(app)/inventory/lots/[id]/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, MOVEMENT_REASON_LABELS, type ComponentType, type LotOnHand, type Product } from '@/lib/inventory/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { AdjustForm } from './adjust-form';

type Movement = {
  id: string;
  delta: number;
  reason: string;
  note: string;
  created_at: string;
  creator: { full_name: string; email: string } | null;
  patient: { id: string; full_name: string; file_no: string } | null;
};

type Usage = {
  movement_id: string;
  used_on: string;
  patient_id: string;
  patient_name: string;
  file_no: string;
  tooth: number;
  item: string;
  placing_delegate: string | null;
  supervisor: string | null;
};

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: lot } = await supabase.from('stock_on_hand').select('*').eq('stock_lot_id', id).maybeSingle();
  if (!lot) notFound();
  const l = lot as LotOnHand;
  const [{ data: product }, { data: movements }, { data: usage }] = await Promise.all([
    supabase.from('products').select('*').eq('id', l.product_id).single(),
    supabase
      .from('stock_movements')
      .select('id, delta, reason, note, created_at, creator:profiles(full_name, email), patient:patients(id, full_name, file_no)')
      .eq('stock_lot_id', id)
      .order('created_at', { ascending: false }),
    supabase.rpc('lot_usage', { p_lot: id }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{l.lot_no ? `Lot ${l.lot_no}` : 'No lot number'}</h1>
        <p className="text-gray-600">
          <Link href={`/inventory/products/${l.product_id}`} className="text-blue-700 hover:underline">
            {product ? productLabel(product as Product) : 'Product'}
          </Link>
        </p>
      </div>
      <dl className="card grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-gray-500">On hand</dt>
          <dd className="text-2xl font-semibold" data-testid="on-hand">{l.on_hand}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Received</dt>
          <dd>{l.qty_received} on {formatDate(l.received_on)}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Expiry</dt>
          <dd>{l.expiry ? formatDate(l.expiry) : '—'}</dd>
        </div>
      </dl>
      <AdjustForm lotId={id} />
      <section className="card space-y-3">
        <h2 className="font-semibold">Used in (recall)</h2>
        {(usage ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">Not used for any patient yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Patient</th>
                <th className="pb-2">Tooth</th>
                <th className="pb-2">Item</th>
                <th className="pb-2">Placed by</th>
                <th className="pb-2">Supervisor</th>
              </tr>
            </thead>
            <tbody>
              {(usage as Usage[]).map((u) => (
                <tr key={u.movement_id} data-testid="usage-row" className="border-t border-gray-200">
                  <td className="py-2 pr-4">{formatDate(u.used_on)}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${u.patient_id}?tooth=${u.tooth}`} className="text-blue-700 hover:underline">
                      {u.patient_name}
                    </Link>{' '}
                    <span className="text-gray-500">({u.file_no})</span>
                  </td>
                  <td className="py-2 pr-4">{u.tooth}</td>
                  <td className="py-2 pr-4">{u.item === 'implant' ? 'Implant' : COMPONENT_LABELS[u.item as ComponentType]}</td>
                  <td className="py-2 pr-4">{u.placing_delegate ?? '—'}</td>
                  <td className="py-2">{u.supervisor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Ledger</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">When</th>
              <th className="pb-2">What</th>
              <th className="pb-2 text-right">Change</th>
              <th className="pb-2">By</th>
              <th className="pb-2">Note / patient</th>
            </tr>
          </thead>
          <tbody>
            {((movements ?? []) as unknown as Movement[]).map((m) => (
              <tr key={m.id} data-testid="ledger-row" className="border-t border-gray-200">
                <td className="py-2 pr-4">{formatDateTime(m.created_at)}</td>
                <td className="py-2 pr-4">{MOVEMENT_REASON_LABELS[m.reason] ?? m.reason}</td>
                <td className="py-2 pr-4 text-right font-mono">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td className="py-2 pr-4">{m.creator?.full_name || m.creator?.email || '—'}</td>
                <td className="py-2">
                  {m.patient ? (
                    <Link href={`/patients/${m.patient.id}`} className="text-blue-700 hover:underline">
                      {m.patient.full_name}
                    </Link>
                  ) : (
                    m.note || '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

`web/src/app/(app)/inventory/recall/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import type { ProductType } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';

type Hit = {
  stock_lot_id: string;
  lot_no: string;
  expiry: string | null;
  received_on: string;
  on_hand: number;
  type: ProductType;
  brand: string;
  system: string;
  platform: string;
  diameter_mm: number | null;
  length_mm: number | null;
  description: string;
};

export default async function RecallPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const { lot = '' } = await searchParams;
  const q = String(lot).trim();
  let hits: Hit[] = [];
  if (q) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('search_lots', { q });
    if (error) throw new Error('Could not search batches');
    hits = (data ?? []) as Hit[];
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Recall lookup</h1>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Lot number</span>
          <input className="input" name="lot" defaultValue={q} />
        </label>
        <button className="btn">Find</button>
      </form>
      {q && (
        <div className="card">
          {hits.length === 0 ? (
            <p className="text-gray-600">No batch with a lot number containing “{q}”.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {hits.map((h) => (
                <li key={h.stock_lot_id} className="flex flex-wrap gap-x-6 py-2 text-sm">
                  <Link href={`/inventory/lots/${h.stock_lot_id}`} className="font-medium text-blue-700 hover:underline">
                    {h.lot_no}
                  </Link>
                  <span>{productLabel(h)}</span>
                  <span className="text-gray-600">received {formatDate(h.received_on)}</span>
                  <span className="text-gray-600">{h.on_hand} on hand</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run E2E** — `npm run test:e2e -- inventory.spec.ts` → PASS (5).

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(inventory): receive stock, batch ledger with adjustments and recall lookup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Chart — plan, cancel and place implants

**Files:**
- Create: `web/src/app/(app)/patients/[id]/chart-data.ts`, `implant-actions.ts`, `implant-section.tsx`, `implant-forms.tsx`
- Modify: `web/src/app/(app)/patients/[id]/page.tsx`, `chart-panel.tsx`
- Test: `web/tests/e2e/implants.spec.ts`

**Interfaces:**
- Consumes: Task 4 functions, `ChartData`, `ImplantSite`, `availableLots`, `lotLabel`, `productLabel`,
  `activeSite`, `badgesFor`, `planSchema`, `placeSchema`, `userMessage`, `todayIso`, `getCurrentProfile`.
- Produces: `loadChartData(patientId): Promise<ChartData>`, `SITE_SELECT` (PostgREST select string,
  reused by Task 13); actions `planImplant`, `cancelPlan`, `placeImplant` returning `{ error?: string }`;
  `<ImplantSection patientId tooth status data />` (`aria-label="Implant record"`).

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/implants.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock } from './api';

async function setup(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Implant');
  const lotNo = `E2E-${Date.now()}`;
  const stock = await seedImplantStock(api, { brand, qty: 3, lot: lotNo, expiry: '2031-12-31' });
  await receiveStock(api, stock.productId, 1, `${lotNo}-OLD`, '2020-01-01');
  const delegate = uniqueName('Dr Placer');
  await seedDelegate(api, delegate);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Implant patient') });
  return { api, brand, lotNo, delegate, patientId, ...stock };
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test('places an implant from the chart and deducts stock', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByLabel('Implant', { exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  const batch = page.getByLabel('Stock batch');
  await expect(batch.locator('option')).toHaveText(['Choose a batch…', `Lot ${s.lotNo} · exp 2031-12-31 · 3 left`]);
  await batch.selectOption({ index: 1 });
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByLabel('Insertion torque (Ncm, optional)').fill('35');
  await page.getByRole('button', { name: 'Save placement' }).click();

  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();
  const details = panel(page).getByTestId('site-details');
  await expect(details).toContainText(s.delegate);
  await expect(details).toContainText('Test Organizer');
  await expect(details).toContainText(`Lot ${s.lotNo}`);
  await expect(details).toContainText('35 Ncm');

  await page.goto(`/inventory/lots/${s.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('2');
  await expect(page.getByTestId('usage-row')).toContainText(s.delegate);
});

test('plans an implant and cancels the plan', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Tooth 46, Present' }).click();
  await panel(page).getByRole('button', { name: 'Plan implant' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Implant planned' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Cancel plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Missing' })).toBeVisible();
});

test('missing fields are explained and nothing is saved', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 11, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByLabel('Implant', { exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Choose a stock batch.');
  await expect(page.getByRole('button', { name: 'Tooth 11, Present' })).toBeVisible();
});
```

Run: `npm run test:e2e -- implants.spec.ts` → FAIL (no "Place implant" button).

- [ ] **Step 2: Chart data loader** — `web/src/app/(app)/patients/[id]/chart-data.ts`:

```ts
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import type { ChartData, ImplantSite, LotOnHand, Product } from '@/lib/inventory/types';
import type { ToothState } from '@/lib/patients/types';

export const SITE_SELECT = `
  id, tooth, state, placed_on, torque_ncm, graft, notes, created_at,
  product:products(*),
  lot:stock_lots(lot_no, expiry),
  placing:delegates!implant_sites_placing_delegate_id_fkey(full_name),
  assisting:delegates!implant_sites_assisting_delegate_id_fkey(full_name),
  supervisor:profiles!implant_sites_supervisor_id_fkey(full_name, email),
  components:site_components(
    id, component_type, fitted_on, removed_on, notes,
    product:products(*), lot:stock_lots(lot_no),
    fitted_by_delegate:delegates(full_name),
    fitted_by_organizer:profiles!site_components_fitted_by_organizer_id_fkey(full_name, email)
  ),
  followups:implant_followups(id, date, check_type, outcome, notes)
`;

export function sortSite(site: ImplantSite): ImplantSite {
  return {
    ...site,
    components: [...site.components].sort((a, b) => (a.fitted_on < b.fitted_on ? -1 : a.fitted_on > b.fitted_on ? 1 : 0)),
    followups: [...site.followups].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

export async function loadChartData(patientId: string): Promise<ChartData> {
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [statuses, sites, products, lots, delegates, organizers] = await Promise.all([
    supabase.from('tooth_status').select('tooth, status').eq('patient_id', patientId),
    supabase.from('implant_sites').select(SITE_SELECT).eq('patient_id', patientId).order('created_at'),
    supabase.from('products').select('*').eq('active', true),
    supabase.from('stock_on_hand').select('*').gt('on_hand', 0),
    supabase.from('delegates').select('id, full_name').eq('active', true).order('full_name'),
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).order('full_name'),
  ]);
  for (const r of [statuses, sites, products, lots, delegates, organizers]) {
    if (r.error) throw new Error('Could not load the chart');
  }
  const statusMap: Partial<Record<number, ToothState>> = {};
  for (const row of statuses.data ?? []) statusMap[row.tooth as number] = row.status as ToothState;
  const all = (products.data ?? []) as Product[];
  const byLabel = (a: Product, b: Product) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true });
  return {
    statuses: statusMap,
    sites: ((sites.data ?? []) as unknown as ImplantSite[]).map(sortSite),
    implants: all.filter((p) => p.type === 'implant').sort(byLabel),
    componentProducts: all.filter((p) => p.type !== 'implant').sort(byLabel),
    lots: (lots.data ?? []) as LotOnHand[],
    delegates: (delegates.data ?? []).map((d) => ({ id: d.id as string, label: d.full_name as string })),
    organizers: (organizers.data ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string })),
    today: todayIso(),
    me: me?.user_id ?? '',
  };
}
```

- [ ] **Step 3: Actions** — `web/src/app/(app)/patients/[id]/implant-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { componentSchema, followupSchema, placeSchema, planSchema } from '@/lib/inventory/schemas';
import { userMessage } from '@/lib/db-errors';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function planImplant(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'plan_implant', { p_patient: p.patientId, p_tooth: p.tooth, p_product: p.productId, p_notes: p.notes });
}

export async function cancelPlan(input: { patientId: string; siteId: string }): Promise<Result> {
  await requireActiveUser();
  return run(input.patientId, 'cancel_planned_implant', { p_site: input.siteId });
}

export async function placeImplant(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'place_implant', {
    p_patient: p.patientId,
    p_tooth: p.tooth,
    p_product: p.productId,
    p_lot: p.lotId,
    p_placed_on: p.placedOn,
    p_placing_delegate: p.placingDelegateId,
    p_supervisor: p.supervisorId,
    p_assisting_delegate: p.assistingDelegateId,
    p_torque: p.torque,
    p_graft: p.graft,
    p_notes: p.notes,
  });
}

export async function fitComponent(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = componentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  return run(c.patientId, 'fit_component', {
    p_site: c.siteId,
    p_type: c.componentType,
    p_fitted_on: c.fittedOn,
    p_product: c.productId,
    p_lot: c.lotId,
    p_by_delegate: c.byDelegateId,
    p_by_organizer: c.byOrganizerId,
    p_notes: c.notes,
  });
}

export async function recordFollowup(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = followupSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  return run(f.patientId, 'record_followup', {
    p_site: f.siteId,
    p_date: f.date,
    p_check_type: f.checkType,
    p_outcome: f.outcome,
    p_notes: f.notes,
  });
}
```

- [ ] **Step 4: Forms** — `web/src/app/(app)/patients/[id]/implant-forms.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { availableLots } from '@/lib/inventory/lots';
import { lotLabel, productLabel } from '@/lib/inventory/labels';
import { acceptsProduct } from '@/lib/inventory/components';
import {
  COMPONENT_LABELS, COMPONENT_TYPES, FOLLOWUP_OUTCOMES, OUTCOME_LABELS,
  type ChartData, type ComponentType, type ImplantSite,
} from '@/lib/inventory/types';
import { fitComponent, placeImplant, planImplant, recordFollowup } from './implant-actions';

type Result = { error?: string };

function useSubmit(action: (input: Record<string, unknown>) => Promise<Result>, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(input: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const result = await action(input);
      if (result.error) setError(result.error);
      else onDone();
    });
  }
  return { error, pending, submit };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Footer({ error, pending, saveLabel, onCancel }: { error: string | null; pending: boolean; saveLabel: string; onCancel: () => void }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn" disabled={pending}>
          {saveLabel}
        </button>
        <button type="button" className="btn-secondary btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function BatchSelect({ data, productId, value, onChange }: { data: ChartData; productId: string; value: string; onChange: (v: string) => void }) {
  const lots = productId ? availableLots(data.lots, productId, data.today) : [];
  if (productId && lots.length === 0) {
    return (
      <p className="text-sm text-amber-900">
        No usable stock for this product.{' '}
        <Link href={`/inventory/receive?product=${productId}`} className="text-blue-700 underline">
          Receive stock
        </Link>
      </p>
    );
  }
  return (
    <Field label="Stock batch">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!productId}>
        <option value="">Choose a batch…</option>
        {lots.map((l) => (
          <option key={l.stock_lot_id} value={l.stock_lot_id}>
            {lotLabel(l)}
          </option>
        ))}
      </select>
    </Field>
  );
}

type Base = { patientId: string; tooth: number; data: ChartData; onDone: () => void };

export function PlanForm({ patientId, tooth, data, onDone }: Base) {
  const [productId, setProductId] = useState('');
  const [notes, setNotes] = useState('');
  const { error, pending, submit } = useSubmit(planImplant, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, tooth, productId, notes }); }}>
      <Field label="Implant (optional)">
        <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Not chosen yet</option>
          {data.implants.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save plan" onCancel={onDone} />
    </form>
  );
}

export function PlaceForm({ patientId, tooth, data, onDone, plannedProductId }: Base & { plannedProductId: string | null }) {
  const [v, setV] = useState({
    productId: plannedProductId ?? '', lotId: '', placedOn: data.today, placingDelegateId: '', assistingDelegateId: '',
    supervisorId: data.me, torque: '', graft: '', notes: '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value, ...(key === 'productId' ? { lotId: '' } : {}) }));
  const { error, pending, submit } = useSubmit(placeImplant, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, tooth, ...v }); }}>
      <Field label="Implant">
        <select className="input" value={v.productId} onChange={(e) => set('productId')(e.target.value)}>
          <option value="">Choose the implant…</option>
          {data.implants.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
        </select>
      </Field>
      <BatchSelect data={data} productId={v.productId} value={v.lotId} onChange={set('lotId')} />
      <Field label="Placement date">
        <input className="input" type="date" value={v.placedOn} onChange={(e) => set('placedOn')(e.target.value)} />
      </Field>
      <Field label="Placed by (delegate)">
        <select className="input" value={v.placingDelegateId} onChange={(e) => set('placingDelegateId')(e.target.value)}>
          <option value="">Choose the delegate…</option>
          {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Assisted by (optional)">
        <select className="input" value={v.assistingDelegateId} onChange={(e) => set('assistingDelegateId')(e.target.value)}>
          <option value="">Nobody</option>
          {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Supervisor">
        <select className="input" value={v.supervisorId} onChange={(e) => set('supervisorId')(e.target.value)}>
          <option value="">Choose the supervisor…</option>
          {data.organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Insertion torque (Ncm, optional)">
        <input className="input" inputMode="decimal" value={v.torque} onChange={(e) => set('torque')(e.target.value)} />
      </Field>
      <Field label="Graft (optional)">
        <input className="input" value={v.graft} onChange={(e) => set('graft')(e.target.value)} />
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save placement" onCancel={onDone} />
    </form>
  );
}

export function ComponentForm({ patientId, site, data, onDone }: { patientId: string; site: ImplantSite; data: ChartData; onDone: () => void }) {
  const [v, setV] = useState({
    componentType: 'healing_abutment' as ComponentType, productId: '', lotId: '', fittedOn: data.today,
    byDelegateId: '', byOrganizerId: data.me, notes: '',
  });
  const set = (key: keyof typeof v) => (value: string) =>
    setV((cur) => ({
      ...cur,
      [key]: value,
      ...(key === 'componentType' ? { productId: '', lotId: '' } : {}),
      ...(key === 'productId' ? { lotId: '' } : {}),
    }));
  const products = data.componentProducts.filter((p) => acceptsProduct(v.componentType, p.type));
  const { error, pending, submit } = useSubmit(fitComponent, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v }); }}>
      <Field label="Component">
        <select className="input" value={v.componentType} onChange={(e) => set('componentType')(e.target.value)}>
          {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{COMPONENT_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Product (optional)">
        <select className="input" value={v.productId} onChange={(e) => set('productId')(e.target.value)}>
          <option value="">{v.componentType === 'final_restoration' ? 'Lab-made / not from stock' : 'Not from stock'}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
        </select>
      </Field>
      {v.productId && <BatchSelect data={data} productId={v.productId} value={v.lotId} onChange={set('lotId')} />}
      <Field label="Fitted on">
        <input className="input" type="date" value={v.fittedOn} onChange={(e) => set('fittedOn')(e.target.value)} />
      </Field>
      <Field label="Fitted by (delegate)">
        <select className="input" value={v.byDelegateId} onChange={(e) => set('byDelegateId')(e.target.value)}>
          <option value="">—</option>
          {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Fitted by (organizer)">
        <select className="input" value={v.byOrganizerId} onChange={(e) => set('byOrganizerId')(e.target.value)}>
          <option value="">—</option>
          {data.organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save component" onCancel={onDone} />
    </form>
  );
}

export function FollowupForm({ patientId, site, data, onDone }: { patientId: string; site: ImplantSite; data: ChartData; onDone: () => void }) {
  const [v, setV] = useState({ date: data.today, checkType: '', outcome: 'ok', notes: '' });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(recordFollowup, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v }); }}>
      <Field label="Date">
        <input className="input" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} />
      </Field>
      <Field label="Check">
        <input className="input" list="check-types" value={v.checkType} onChange={(e) => set('checkType')(e.target.value)} />
        <datalist id="check-types">
          {['2-week', '6-week', '3-month', '6-month', '1-year'].map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="Outcome">
        <select className="input" value={v.outcome} onChange={(e) => set('outcome')(e.target.value)}>
          {FOLLOWUP_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save follow-up" onCancel={onDone} />
    </form>
  );
}
```

- [ ] **Step 5: Implant section** — `web/src/app/(app)/patients/[id]/implant-section.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { activeSite, currentComponent } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, SITE_STATE_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { isManualState, type ToothState } from '@/lib/patients/types';
import { formatDate } from '@/lib/format';
import { cancelPlan } from './implant-actions';
import { ComponentForm, FollowupForm, PlaceForm, PlanForm } from './implant-forms';

type Mode = 'none' | 'plan' | 'place' | 'component' | 'followup';

function SiteDetails({ site }: { site: ImplantSite }) {
  const current = currentComponent(site);
  const rows: [string, string][] = [
    ['State', SITE_STATE_LABELS[site.state]],
    ['Implant', site.product ? productLabel(site.product) : '—'],
    ['Batch', site.lot ? (site.lot.lot_no ? `Lot ${site.lot.lot_no}` : 'No lot') : '—'],
    ['Placed on', site.placed_on ? formatDate(site.placed_on) : '—'],
    ['Torque', site.torque_ncm !== null ? `${site.torque_ncm} Ncm` : '—'],
    ['Graft', site.graft || '—'],
    ['Placed by', site.placing?.full_name ?? '—'],
    ['Assisted by', site.assisting?.full_name ?? '—'],
    ['Supervisor', site.supervisor?.full_name || site.supervisor?.email || '—'],
    ['Current component', current ? COMPONENT_LABELS[current.component_type] : '—'],
  ];
  return (
    <div data-testid="site-details" className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {site.components.length > 0 && (
        <div>
          <h4 className="font-medium">Components</h4>
          <ol className="list-decimal pl-5" data-testid="component-history">
            {site.components.map((c) => (
              <li key={c.id}>
                {COMPONENT_LABELS[c.component_type]} — {formatDate(c.fitted_on)}
                {c.removed_on ? ` (until ${formatDate(c.removed_on)})` : ' (current)'}
              </li>
            ))}
          </ol>
        </div>
      )}
      {site.followups.length > 0 && (
        <div>
          <h4 className="font-medium">Follow-ups</h4>
          <ul data-testid="followups">
            {site.followups.map((f) => (
              <li key={f.id}>
                {formatDate(f.date)} · {f.check_type} · {OUTCOME_LABELS[f.outcome]}
                {f.notes ? ` — ${f.notes}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ImplantSection({ patientId, tooth, status, data }: { patientId: string; tooth: number; status: ToothState; data: ChartData }) {
  const [mode, setMode] = useState<Mode>('none');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const site = activeSite(data.sites, tooth);
  const earlier = data.sites.filter((s) => s.tooth === tooth && s !== site && s.state !== 'removed');
  const canStart = !site && (isManualState(status) || status === 'failed');
  const done = () => setMode('none');

  function cancel() {
    if (!site) return;
    setError(null);
    start(async () => {
      const result = await cancelPlan({ patientId, siteId: site.id });
      if (result.error) setError(result.error);
    });
  }

  return (
    <section aria-label="Implant record" className="space-y-3 border-t border-gray-200 pt-4">
      <h3 className="font-semibold">Implant</h3>
      {!site && <p className="text-sm text-gray-600">No implant on this tooth.</p>}
      {site?.state === 'planned' && (
        <p className="text-sm">
          Planned{site.product ? `: ${productLabel(site.product)}` : ' (implant not chosen yet)'}
        </p>
      )}
      {site && site.state !== 'planned' && <SiteDetails site={site} />}

      {mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <>
              <button className="btn-secondary btn" onClick={() => setMode('plan')}>Plan implant</button>
              <button className="btn" onClick={() => setMode('place')}>Place implant</button>
            </>
          )}
          {site?.state === 'planned' && (
            <>
              <button className="btn" onClick={() => setMode('place')}>Place implant</button>
              <button className="btn-secondary btn" disabled={pending} onClick={cancel}>Cancel plan</button>
            </>
          )}
          {site && (site.state === 'placed' || site.state === 'restored') && (
            <>
              <button className="btn-secondary btn" onClick={() => setMode('component')}>Add component</button>
              <button className="btn-secondary btn" onClick={() => setMode('followup')}>Add follow-up</button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {mode === 'plan' && <PlanForm patientId={patientId} tooth={tooth} data={data} onDone={done} />}
      {mode === 'place' && (
        <PlaceForm patientId={patientId} tooth={tooth} data={data} onDone={done} plannedProductId={site?.product?.id ?? null} />
      )}
      {mode === 'component' && site && <ComponentForm patientId={patientId} site={site} data={data} onDone={done} />}
      {mode === 'followup' && site && <FollowupForm patientId={patientId} site={site} data={data} onDone={done} />}

      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-700">Earlier implants on this tooth ({earlier.length})</summary>
          <div className="mt-2 space-y-4">
            {earlier.map((s) => <SiteDetails key={s.id} site={s} />)}
          </div>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Wire into the chart** — replace `web/src/app/(app)/patients/[id]/page.tsx`:

```tsx
import { isFdiTooth } from '@/lib/patients/fdi';
import { ChartPanel } from './chart-panel';
import { loadChartData } from './chart-data';

export default async function PatientChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tooth?: string }>;
}) {
  const { id } = await params;
  const { tooth } = await searchParams;
  const data = await loadChartData(id);
  const initial = Number(tooth);
  return <ChartPanel patientId={id} data={data} initialTooth={isFdiTooth(initial) ? initial : null} />;
}
```

In `web/src/app/(app)/patients/[id]/chart-panel.tsx`:
- change `Props` to `{ patientId: string; data: ChartData; initialTooth: number | null }` and read
  `const statuses = data.statuses;`;
- import `ChartData` from `@/lib/inventory/types`, `badgesFor` from `@/lib/inventory/components`,
  `ImplantSection` from `./implant-section`, and `useMemo` from React;
- add `const badges = useMemo(() => badgesFor(data.sites), [data.sites]);` and pass
  `badges={badges}` to `<Odontogram>`;
- after the `{error && …}` paragraph inside the selected-teeth branch, add:

```tsx
            {selected.length === 1 && (
              <ImplantSection key={selected[0]} patientId={patientId} tooth={selected[0]} status={statusOf(selected[0])} data={data} />
            )}
```

- [ ] **Step 7: Run E2E** — `npm run test:e2e -- implants.spec.ts chart.spec.ts` → PASS (3 + 4).

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(implants): plan, cancel and place implants from the chart with stock deduction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Chart — components, badges and follow-ups

**Files:**
- Test: `web/tests/e2e/implants.spec.ts` (append)
- (Implementation already shipped in Task 11's forms/section; this task proves the flows and fixes anything they expose.)

**Interfaces:**
- Consumes: `ComponentForm`, `FollowupForm`, `fit_component`, `record_followup`, badges.

- [ ] **Step 1: Append the E2E tests** to `web/tests/e2e/implants.spec.ts`:

```ts
async function placeOn(page: Page, s: Awaited<ReturnType<typeof setup>>, tooth: number) {
  await page.getByRole('button', { name: `Tooth ${tooth}, Present` }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByLabel('Implant', { exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  await page.getByLabel('Stock batch').selectOption({ index: 1 });
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: `Tooth ${tooth}, Implant placed` })).toBeVisible();
}

test('fits a healing abutment then a Ti-base: badges change and stock is deducted', async ({ page }) => {
  const s = await setup(page);
  const ha = await seedComponent(s.api, 'healing_abutment', `${s.brand} HA`, 2);
  const tb = await seedComponent(s.api, 'ti_base', `${s.brand} TB`, 1);
  await placeOn(page, s, 36);

  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Product (optional)').selectOption({ label: `${s.brand} E2E · ${s.brand} HA` });
  await page.getByLabel('Stock batch').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed, HA' })).toBeVisible();

  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Component').selectOption('ti_base');
  await page.getByLabel('Product (optional)').selectOption({ label: `${s.brand} E2E · ${s.brand} TB` });
  await page.getByLabel('Stock batch').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed, TB' })).toBeVisible();
  await expect(panel(page).getByTestId('component-history')).toContainText('Healing abutment');
  await expect(panel(page).getByTestId('component-history')).toContainText('(current)');

  await page.goto(`/inventory/lots/${ha.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('1');
  await page.goto(`/inventory/lots/${tb.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('0');
});

test('a failed follow-up marks the tooth as a failed implant', async ({ page }) => {
  const s = await setup(page);
  await placeOn(page, s, 26);
  await panel(page).getByRole('button', { name: 'Add follow-up' }).click();
  await page.getByLabel('Check').fill('3-month');
  await page.getByLabel('Outcome').selectOption('failed');
  await page.getByLabel('Notes (optional)').fill('Mobile, removed');
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 26, Failed implant' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Place implant' })).toBeVisible();
  await expect(panel(page).getByText('Earlier implants on this tooth (1)')).toBeVisible();
});

test('a final restoration from the lab marks the tooth restored', async ({ page }) => {
  const s = await setup(page);
  await placeOn(page, s, 14);
  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Component').selectOption('final_restoration');
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 14, Restored, CR' })).toBeVisible();
});
```

and add near the top of the file (after `setup`):

```ts
async function seedComponent(api: Awaited<ReturnType<typeof apiAs>>, type: string, description: string, qty: number) {
  const brand = description.split(' ').slice(0, 3).join(' ');
  const productId = (await api.from('products').insert({ type, brand, system: 'E2E', description }).select('id').single()).data!.id as string;
  const lotId = await receiveStock(api, productId, qty, `${description.replace(/\s+/g, '-')}-LOT`, '2031-12-31');
  return { productId, lotId };
}
```

Note: the component product label is `"<brand> E2E · <description>"`; `seedComponent` uses the first
three words of the description as the brand so the label the test selects is
`` `${s.brand} E2E · ${s.brand} HA` `` (s.brand is three words: `E2E Implant <stamp>`).

- [ ] **Step 2: Run** — `npm run test:e2e -- implants.spec.ts` → PASS (6). If a test fails, fix the
  code (not the test) using superpowers:systematic-debugging.

- [ ] **Step 3: Commit**

```bash
git add web
git commit -m "test(implants): components, badges and follow-ups end to end" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Implants tab on the patient page

**Files:**
- Create: `web/src/app/(app)/patients/[id]/implants/page.tsx`, `web/tests/e2e/implants-tab.spec.ts`
- Modify: `web/src/app/(app)/patients/[id]/patient-tabs.tsx`, `web/tests/e2e/patient-overview.spec.ts`

**Interfaces:**
- Consumes: `SITE_SELECT`, `sortSite`, `currentComponent`, labels.
- Produces: tab order `Chart, Implants, Overview, Notes, History`; rows `data-testid="implant-row"`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/implants-tab.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

test('lists the patient’s implants with who placed them, linking back to the chart', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Tab'), qty: 1, lot: `E2E-T${Date.now()}`, expiry: null });
  const delegateName = uniqueName('Dr Tab');
  const delegate = await seedDelegate(api, delegateName);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Tab patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant', {
    p_patient: patientId, p_tooth: 45, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();

  await page.getByRole('link', { name: 'Implants' }).click();
  const row = page.getByTestId('implant-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('45');
  await expect(row).toContainText('Placed');
  await expect(row).toContainText(delegateName);
  await row.getByRole('link', { name: '45' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 45, Implant placed' })).toHaveAttribute('aria-pressed', 'true');
});
```

In `web/tests/e2e/patient-overview.spec.ts` change the expected tab list to
`['Chart', 'Implants', 'Overview', 'Notes', 'History']`.

Run: `npm run test:e2e -- implants-tab.spec.ts patient-overview.spec.ts` → FAIL (no Implants tab).

- [ ] **Step 2: Implement**

In `patient-tabs.tsx` insert after the Chart entry:
```ts
    { href: `${base}/implants`, label: 'Implants' },
```

`web/src/app/(app)/patients/[id]/implants/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { currentComponent } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, SITE_STATE_LABELS, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { SITE_SELECT, sortSite } from '../chart-data';

export default async function ImplantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('implant_sites')
    .select(SITE_SELECT)
    .eq('patient_id', id)
    .neq('state', 'removed')
    .order('tooth');
  if (error) throw new Error('Could not load implants');
  const sites = ((data ?? []) as unknown as ImplantSite[]).map(sortSite);

  return (
    <section className="card overflow-x-auto">
      {sites.length === 0 ? (
        <p className="text-gray-600">No implants recorded for this patient.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Tooth</th>
              <th className="pb-2">State</th>
              <th className="pb-2">Implant</th>
              <th className="pb-2">Batch</th>
              <th className="pb-2">Placed</th>
              <th className="pb-2">Placed by</th>
              <th className="pb-2">Supervisor</th>
              <th className="pb-2">Component</th>
              <th className="pb-2">Last follow-up</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const current = currentComponent(s);
              const last = s.followups.at(-1);
              return (
                <tr key={s.id} data-testid="implant-row" className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${id}?tooth=${s.tooth}`} className="text-blue-700 hover:underline">
                      {s.tooth}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{SITE_STATE_LABELS[s.state]}</td>
                  <td className="py-2 pr-4">{s.product ? productLabel(s.product) : '—'}</td>
                  <td className="py-2 pr-4">{s.lot ? s.lot.lot_no ?? 'No lot' : '—'}</td>
                  <td className="py-2 pr-4">{s.placed_on ? formatDate(s.placed_on) : '—'}</td>
                  <td className="py-2 pr-4">{s.placing?.full_name ?? '—'}</td>
                  <td className="py-2 pr-4">{s.supervisor?.full_name || s.supervisor?.email || '—'}</td>
                  <td className="py-2 pr-4">{current ? COMPONENT_LABELS[current.component_type] : '—'}</td>
                  <td className="py-2">{last ? `${OUTCOME_LABELS[last.outcome]} (${last.check_type})` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(implants): implants tab on the patient page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
