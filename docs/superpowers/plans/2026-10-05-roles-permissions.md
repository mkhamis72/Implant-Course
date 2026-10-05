# Roles & Permissions (PR C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three kinds of user:
- **Admin:** full access.
- **Organizer:** access per panel, set by an admin to None, View or Edit.
- **Delegate:** a login that sees only its own schedule and report.

Everything is enforced in Postgres.

**Architecture:**
- **Migration `0029`** adds the `delegate` role.
- **Migration `0030`** adds `user_permissions`, the helpers `can()` and `require_perm()`, and **restrictive** RLS policies per area. Restrictive policies AND with the existing policies, so those stay untouched.
- **Every write function** is redefined so that `require_active()` becomes `require_perm(area,'edit')`.
- **Delegates read only through two security-definer functions,** `my_schedule()` and `my_report()`. `is_active_user()` now means *staff*, so every existing policy shuts delegates out.
- **App:** a permission-aware session, nav, page guards and action guards; edit controls hidden; an admin grid; "Create login"; the `/my` pages.

**Tech Stack:** Postgres RLS and plpgsql on Supabase, Next.js 15 server components and actions, Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-roles-permissions-design.md`

**Run every command from `web/`.** Branch: `roles-permissions`, cut from `lectures-and-course-reports`, because 0030 redefines 0028's talk functions.

## Global Constraints

- Areas, exactly: `patients`, `schedule`, `courses`, `checklists`, `inventory`, `delegates`. Levels: `view`, `edit`. `edit` implies `view`. No row means None.
- SQL functions:
  - use `security definer set search_path = ''`;
  - revoke from `public, anon` and grant to `authenticated`;
  - raise business errors with `app_private.fail(...)`.
- Never edit an applied migration.
  - Dry-run 0030 in a rolled-back transaction before `npm run test:db` applies it. Script: `.superpowers/sdd/<plan>/dry-run.ts`, run with `NODE_PATH="$PWD/node_modules" ALLOW_TEST_FIXTURES=1 npx tsx <file>`.
  - A fix after the migration is applied goes into a new migration.
- Each write function is redefined from its **latest** definition. Before copying, re-check with `grep -n "function public.<name>(" supabase/migrations/*.sql | tail -1`.
- Release compatibility:
  - Existing organizers are backfilled to `edit` everywhere. The previous app version keeps working: same functions, same signatures, and organizers can still do everything.
  - No delegates exist until the new app ships.
- Error copy:
  - Permission failures say exactly `You don't have permission to <view|edit> <Area label>.`
  - Area labels: Patients, Schedule, Courses, Checklists, Inventory, Delegates.
- Write files containing `\` with the Write/Edit tools, not heredocs (CLAUDE.md gotcha).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A delegate token calling the REST API directly** (`/rest/v1/patients`, `/rest/v1/rpc/place_implant`) must get no rows or a refusal.
   - Task 3: loop over every table, and call every write function.
2. **An organizer with View on Patients only** opens the patient chart without errors and sees no edit forms. Saving through a forged action call is refused by the database.
   - Task 2 matrix.
   - Task 5: View hides controls.
3. **The E2E `organizer` test user must keep full Edit.** `ensureTestUsers()` re-runs `setProfile` at every setup, and the default-View trigger would otherwise downgrade a re-created organizer.
   - Task 6: `setPermissions` in `test-users.ts`.
4. **Demoting an admin to organizer** leaves them with View everywhere (the default trigger), not None and not Edit.
   - Task 1 test.
5. **A deactivated delegate login** gets nothing from `my_schedule` or `my_report`, and `/my` redirects to `/deactivated`.
   - Task 3 test and the Task 7 layout.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0029_delegate_role.sql` | enum value |
| `supabase/migrations/0030_permissions.sql` | table, helpers, restrictive policies, write-function guards, delegate readers |
| `tests/db/permissions.test.ts` | helpers, defaults, matrix, guard rail |
| `tests/db/delegate-access.test.ts` | delegate isolation and readers |
| `tests/db/fixtures.ts` | `setPerms(c, userId, perms)` |
| `src/lib/auth/permissions.ts` (+test) | `AREAS`, `AREA_LABELS`, `Permissions`, `canView`, `canEdit`, `permissionMessage` |
| `src/lib/auth/session.ts` | `Profile` with `delegate_id` and permissions; `requirePermission`, `requireDelegate`, `checkPermission` |
| `src/components/nav-items.ts` (+test) | `area` per item, `visibleNavItems(profile)`, `DELEGATE_NAV` |
| `src/app/(app)/layout.tsx`, `src/components/nav.tsx` | delegate redirect; nav takes a profile |
| staff pages and actions (≈45 files, listed in Task 5) | guards, and `canEdit` for controls |
| `src/lib/admin/passwords.ts` (+test), `scripts/users.ts`, `scripts/create-user*.ts` | shared temporary password; delegate role |
| `src/app/(app)/admin/users/*` | permission grid, create login, Delegate label |
| `src/app/(app)/delegates/[id]/create-login.tsx`, `delegates/actions.ts` | delegate login |
| `src/app/(delegate)/my/{layout,page}.tsx`, `my/report/page.tsx`, `my/report.csv/route.ts` | delegate area |
| `tests/support/test-users.ts` | `viewer` and `delegate` users; organizer permissions pinned |
| `tests/e2e/permissions.spec.ts`, `tests/e2e/delegate-portal.spec.ts` | E2E |
| `docs/operations.md`, `CLAUDE.md` | docs |

---

### Task 1: Enum, permission table, helpers, defaults

**Files:**
- Create: `supabase/migrations/0029_delegate_role.sql`
- Create: `supabase/migrations/0030_permissions.sql`, part 1 (Tasks 2 and 3 append to the **same file before it is applied**)
- Create: `tests/db/permissions.test.ts`
- Modify: `tests/db/fixtures.ts`

**Because 0030 is applied once:** write Tasks 1–3's SQL and their DB tests first. Dry-run all of 0030, then run `test:db` once. Commit after each task's tests pass. Tasks 1–3 share a single RED (the tests written) and a single GREEN (the migration applied).

**Interfaces:**
- Produces, in SQL:
  - `public.user_permissions(user_id, area, level)`
  - `profiles.delegate_id`
  - `public.is_active_user()`, now staff only
  - `public.is_delegate_user()`
  - `public.my_delegate_id()`
  - `public.can(text,text)`
  - `app_private.require_perm(text,text)`
  - `public.set_user_permissions(uuid, jsonb)`
- Produces, as a fixture: `setPerms(c, user, { patients?: 'view'|'edit'|null, … })`.

- [ ] **Step 1: Write the tests.**

Add to `tests/db/fixtures.ts`:

```ts
export type Perms = Partial<Record<'patients' | 'schedule' | 'courses' | 'checklists' | 'inventory' | 'delegates', 'view' | 'edit' | null>>;

/** Sets a user's area permissions directly (bypasses RLS; call as postgres). Unlisted areas become None. */
export async function setPerms(c: Client, user: string, perms: Perms): Promise<void> {
  await c.query('delete from public.user_permissions where user_id = $1', [user]);
  for (const [area, level] of Object.entries(perms)) {
    if (level) await c.query('insert into public.user_permissions (user_id, area, level) values ($1, $2, $3)', [user, area, level]);
  }
}
```

Create `tests/db/permissions.test.ts` with the helper tests:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { setPerms } from './fixtures';

const users = inject('testUsers');
const AREAS = ['patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates'];

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}
const can = async (c: Client, area: string, level: string) =>
  (await c.query('select public.can($1, $2) as ok', [area, level])).rows[0].ok as boolean;

describe('permissions: helpers and defaults', () => {
  it('a new organizer starts with View everywhere; an admin demoted to organizer too', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-perm-new@example.com') returning id`,
      );
      const perms = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [rows[0].id]);
      expect(perms.rows).toEqual([...AREAS].sort().map((area) => ({ area, level: 'view' })));
      await c.query(`update public.profiles set role = 'admin', active = true where user_id = $1`, [rows[0].id]);
      await c.query('delete from public.user_permissions where user_id = $1', [rows[0].id]);
      await c.query(`update public.profiles set role = 'organizer' where user_id = $1`, [rows[0].id]);
      const again = await c.query('select count(*)::int as n from public.user_permissions where user_id = $1 and level = $2', [rows[0].id, 'view']);
      expect(again.rows[0].n).toBe(6);
    });
  });

  it('can(): admin passes everything; organizer per row; edit implies view', async () => {
    await withTx(async (c) => {
      await setPerms(c, users.target, { inventory: 'edit', courses: 'view' });
      await actAs(c, users.admin);
      expect(await can(c, 'patients', 'edit')).toBe(true);
      await actAs(c, users.target);
      expect(await can(c, 'inventory', 'view')).toBe(true);
      expect(await can(c, 'inventory', 'edit')).toBe(true);
      expect(await can(c, 'courses', 'view')).toBe(true);
      expect(await can(c, 'courses', 'edit')).toBe(false);
      expect(await can(c, 'patients', 'view')).toBe(false);
      await actAs(c, users.inactive);
      expect(await can(c, 'inventory', 'view')).toBe(false);
    });
  });

  it('set_user_permissions: admin only, not on self, organizers only; replaces rows', async () => {
    await withTx(async (c) => {
      const grid = JSON.stringify({ patients: 'edit', schedule: 'view', inventory: null });
      await actAs(c, users.organizer);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, grid]), /Only an admin/);
      await actAs(c, users.admin);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.admin, grid]), /your own/);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, '{"bogus":"edit"}']), /Unknown area/);
      await c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, grid]);
      const { rows } = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [users.target]);
      expect(rows).toEqual([{ area: 'patients', level: 'edit' }, { area: 'schedule', level: 'view' }]);
    });
  });

  it('organizers read only their own permission rows; nobody writes them directly', async () => {
    await withTx(async (c) => {
      await actAs(c, users.target);
      const { rows } = await c.query('select distinct user_id from public.user_permissions');
      expect(rows.every((r) => r.user_id === users.target)).toBe(true);
      await refused(c, () => c.query(`insert into public.user_permissions values ($1, 'patients', 'edit')`, [users.target]), /permission denied/);
    });
  });

  it('a delegate profile is not an active user', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const d = (await c.query(`insert into public.delegates (full_name) values ('Zz Perm Delegate') returning id`)).rows[0].id;
      await c.query(`update public.profiles set role = 'delegate', delegate_id = $2, active = true where user_id = $1`, [users.target, d]);
      await actAs(c, users.target);
      const r = await c.query('select public.is_active_user() as staff, public.is_delegate_user() as delegate, public.my_delegate_id() as me');
      expect(r.rows[0]).toEqual({ staff: false, delegate: true, me: d });
      await asPostgres(c);
      await refused(c, () => c.query(`update public.profiles set delegate_id = null where user_id = $1`, [users.target]), /profiles_delegate_link/);
    });
  });
});
```

The matrix and guard rail are added in Task 2.

- [ ] **Step 2: Write `0029_delegate_role.sql` and apply it on its own.**

```sql
-- A login for a delegate. Used from 0030 on (a new enum value can't be used in the transaction that adds it).
alter type public.user_role add value 'delegate';
```

Run `npm run db:migrate`. Expected: `0029_delegate_role.sql` is applied. It's the only pending file, because 0030 doesn't exist yet.

- [ ] **Step 3: Write part 1 of `0030_permissions.sql`.**

```sql
-- Roles & permissions: organizers get None/View/Edit per area; delegates see only their own data
-- through my_schedule()/my_report(). is_active_user() now means active *staff*.

create table public.user_permissions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  area text not null check (area in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates')),
  level text not null check (level in ('view', 'edit')),
  primary key (user_id, area)
);
create trigger user_permissions_audit after insert or update or delete on public.user_permissions
  for each row execute function app_private.audit_row('user_id');
revoke all on public.user_permissions from public, anon, authenticated;
grant select on public.user_permissions to authenticated;
alter table public.user_permissions enable row level security;
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

alter table public.profiles add column delegate_id uuid unique references public.delegates (id);
alter table public.profiles add constraint profiles_delegate_link check ((role = 'delegate') = (delegate_id is not null));

-- Existing organizers keep full access, so behaviour is unchanged on release.
insert into public.user_permissions (user_id, area, level)
select p.user_id, a.area, 'edit'
from public.profiles p
cross join (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area)
where p.role = 'organizer';

-- Anyone who is, or becomes, an organizer without permissions starts with View everywhere.
create function app_private.default_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'organizer' and not exists (select 1 from public.user_permissions where user_id = new.user_id) then
    insert into public.user_permissions (user_id, area, level)
    select new.user_id, a.area, 'view'
    from (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area);
  end if;
  return new;
end $$;
create trigger profiles_default_permissions after insert or update of role on public.profiles
  for each row execute function app_private.default_permissions();

-- Staff only: delegates are shut out of every existing policy and of require_active().
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.active and p.role in ('admin', 'organizer')
    );
$$;

create function public.is_delegate_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.active and p.role = 'delegate' and p.delegate_id is not null
    );
$$;

create function public.my_delegate_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.delegate_id from public.profiles p where p.user_id = auth.uid();
$$;

create function public.can(p_area text, p_level text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or (public.is_active_user() and exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.area = p_area
        and (up.level = 'edit' or p_level = 'view')
    ));
$$;

create function app_private.area_label(p_area text) returns text
language sql immutable set search_path = '' as $$
  select initcap(p_area);
$$;

create function app_private.require_perm(p_area text, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.can(p_area, p_level) then
    raise exception using
      message = format('You don''t have permission to %s %s.', p_level, app_private.area_label(p_area)),
      errcode = '42501', hint = 'user';
  end if;
end $$;

create function public.set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_level text;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change permissions.');
  end if;
  if p_user = auth.uid() then
    perform app_private.fail('You cannot change your own permissions.');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user and role = 'organizer') then
    perform app_private.fail('Permissions apply to organizers only.');
  end if;
  for v_key, v_level in select key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb)) loop
    if v_key not in ('patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates') then
      perform app_private.fail(format('Unknown area: %s.', v_key));
    end if;
    if v_level is not null and v_level not in ('view', 'edit') then
      perform app_private.fail(format('Unknown level: %s.', v_level));
    end if;
  end loop;
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, area, level)
  select p_user, key, value #>> '{}' from jsonb_each(coalesce(p_perms, '{}'::jsonb))
  where value #>> '{}' is not null;
end $$;
```

Check `app_private.fail` before relying on it: look at its definition with `grep -n "function app_private.fail" supabase/migrations/*.sql`. If it uses `errcode 'P0001'` with hint `'user'`, `require_perm` matches it by passing `hint = 'user'`. Check that `userMessage()` in `src/lib/db-errors.ts` keys on the hint and not on the errcode. If it keys on the errcode, use `perform app_private.fail(format(...))` instead of the raw `raise`.

Grants, at the end of 0030 part 1:

```sql
revoke execute on function public.is_delegate_user() from public, anon;
revoke execute on function public.my_delegate_id() from public, anon;
revoke execute on function public.can(text, text) from public, anon;
revoke execute on function app_private.require_perm(text, text) from public, anon;
revoke execute on function app_private.default_permissions() from public, anon;
revoke execute on function public.set_user_permissions(uuid, jsonb) from public, anon;
grant execute on function public.is_delegate_user() to authenticated;
grant execute on function public.my_delegate_id() to authenticated;
grant execute on function public.can(text, text) to authenticated;
grant execute on function public.set_user_permissions(uuid, jsonb) to authenticated;
```

- [ ] **Steps 4–6:** continue with Tasks 2 and 3's SQL and tests. Then dry-run, apply, and verify (Task 3, Step 5).

---

### Task 2: Restrictive area policies and guards in the write functions (0030 part 2)

**Interfaces:**
- Consumes: `can()` and `require_perm()` (Task 1).
- Produces: the area enforcement on every table and every write function.

- [ ] **Step 1: Write the matrix and guard-rail tests.** Append to `tests/db/permissions.test.ts`:

```ts
import { makeProduct, makeCourse, receive } from './fixtures';

// One representative table and function per area: [area, select sql, write fn (returns promise)].
describe('permissions: area matrix', () => {
  const cases: { area: string; select: string; write: (c: Client) => Promise<unknown> }[] = [
    { area: 'patients', select: 'select 1 from public.medical_history limit 1',
      write: (c) => c.query(`insert into public.patients (full_name) values ('Zz Perm Patient')`) },
    { area: 'schedule', select: 'select 1 from public.surgery_slots limit 1',
      write: (c) => c.query(`select public.cancel_surgery_slot('00000000-0000-0000-0000-000000000000', 'reason')`) },
    { area: 'courses', select: 'select 1 from public.courses limit 1',
      write: (c) => makeCourse(c) },
    { area: 'checklists', select: 'select 1 from public.checklists limit 1',
      write: (c) => c.query(`select public.toggle_checklist_item('00000000-0000-0000-0000-000000000000')`) },
    { area: 'inventory', select: 'select 1 from public.stock_movements limit 1',
      write: async (c) => receive(c, await makeProduct(c), 1, 'ZZPERM') },
    { area: 'delegates', select: 'select 1 from public.delegates limit 1',
      write: (c) => c.query(`insert into public.delegates (full_name) values ('Zz Perm Del')`) },
  ];

  for (const k of cases) {
    it(`${k.area}: None hides rows and refuses writes; View reads; Edit writes`, async () => {
      await withTx(async (c) => {
        await setPerms(c, users.target, {});
        await actAs(c, users.target);
        if (k.area !== 'delegates') {
          // delegates is a reference list readable by all staff
          const none = await c.query(k.select.replace('select 1', 'select count(*)::int as n').replace(' limit 1', ''));
          expect(none.rows[0].n).toBe(0);
        }
        await refused(c, () => k.write(c), /permission|row-level security/);
        await asPostgres(c);
        await setPerms(c, users.target, { [k.area]: 'view' });
        await actAs(c, users.target);
        await refused(c, () => k.write(c), /permission|row-level security/);
        await asPostgres(c);
        await setPerms(c, users.target, { [k.area]: 'edit' });
        await actAs(c, users.target);
        await c.query('savepoint w');
        await k.write(c).catch((e: Error) => {
          // Edit passes the permission check; a business error (e.g. "Booking not found") is fine.
          expect(e.message).not.toMatch(/permission|row-level security/);
        });
        await c.query('rollback to savepoint w');
      });
    });
  }

  it('patients are readable with Schedule view (names on the schedule), but not medical history', async () => {
    await withTx(async (c) => {
      await c.query(`insert into public.patients (full_name) values ('Zz Perm Sched Patient')`);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      const p = await c.query(`select count(*)::int as n from public.patients where full_name = 'Zz Perm Sched Patient'`);
      expect(p.rows[0].n).toBe(1);
      const mh = await c.query('select count(*)::int as n from public.medical_history');
      expect(mh.rows[0].n).toBe(0);
    });
  });

  it('the permission message names the area', async () => {
    await withTx(async (c) => {
      await setPerms(c, users.target, { inventory: 'view' });
      await actAs(c, users.target);
      const product = await makeProduct(c).catch(() => null); // products insert needs inventory edit
      expect(product).toBeNull();
      await refused(c, () => c.query(`select public.adjust_stock('00000000-0000-0000-0000-000000000000', 1, 'x')`), /You don't have permission to edit Inventory\./);
    });
  });
});

describe('permissions: guard rail', () => {
  it('every public security-definer function checks a permission or is allow-listed', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.prosrc not like '%require_perm(%'`);
      const allow = new Set(['is_active_user', 'is_admin', 'is_delegate_user', 'my_delegate_id', 'can',
        'set_user_permissions', 'my_schedule', 'my_report', 'next_file_no']);
      expect(rows.map((r) => r.proname).filter((n) => !allow.has(n)).sort()).toEqual([]);
    });
  });

  it('every public table has an area policy or is on the shared-reference list', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname
                          and pp.permissive = 'RESTRICTIVE')`);
      const shared = new Set(['profiles', 'settings', 'user_permissions', 'chairs', 'supervisors', 'lecturers', 'stock_lots']);
      expect(rows.map((r) => r.relname).filter((n) => !shared.has(n)).sort()).toEqual([]);
    });
  });
});
```

Adjust the placeholder-uuid calls to match each function's real signature. Check `\df public.adjust_stock` and the latest definitions when writing them. The point is to reach the permission check, which runs first.

- [ ] **Step 2: Append part 2 to `0030_permissions.sql`: restrictive policies.**

Restrictive policies AND with the existing permissive ones, which stay as they are (including the visit-notes author check and the tooth-status whitelist). Pattern, with exactly these rows:

```sql
-- Area enforcement: restrictive policies AND with the existing permissive ones.
create function app_private.area_policies(p_table text, p_area text, p_read_area_sql text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_read text := coalesce(p_read_area_sql, format('public.can(%L, ''view'')', p_area));
begin
  execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)',
    p_table || '_area_read', p_table, v_read);
  execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.can(%L, ''edit''))',
    p_table || '_area_insert', p_table, p_area);
  execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.can(%L, ''edit'')) with check (public.can(%L, ''edit''))',
    p_table || '_area_update', p_table, p_area, p_area);
  execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.can(%L, ''edit''))',
    p_table || '_area_delete', p_table, p_area);
end $$;

select app_private.area_policies('patients', 'patients', 'public.can(''patients'', ''view'') or public.can(''schedule'', ''view'')');
select app_private.area_policies(t, 'patients') from unnest(array[
  'medical_history', 'visit_notes', 'tooth_status', 'implant_sites', 'site_components', 'implant_followups', 'audit_log']) t;
select app_private.area_policies(t, 'schedule') from unnest(array[
  'surgery_slots', 'slot_delegates', 'slot_planned_implants', 'talks']) t;
select app_private.area_policies(t, 'courses') from unnest(array['courses', 'sessions', 'enrollments']) t;
select app_private.area_policies(t, 'checklists') from unnest(array[
  'checklist_templates', 'template_items', 'checklists', 'checklist_items']) t;
select app_private.area_policies('stock_movements', 'inventory');
-- Reference lists: every staff member reads them; writes need the owning area.
select app_private.area_policies('products', 'inventory', 'true');
select app_private.area_policies('delegates', 'delegates', 'true');
drop function app_private.area_policies(text, text, text);
```

- `audit_log` holds every table's history, and only the patient History tab and admins read it. Giving it patients/view is deliberate.
- Run `select tablename from pg_tables where schemaname='public'` in the dry-run to confirm the list covers every table, so the guard-rail test passes.
- Inserts made inside security-definer functions run as the function owner, who bypasses RLS. Restrictive policies therefore never block the write functions themselves; those are guarded by `require_perm`.

- [ ] **Step 3: Append part 2b: guards in the write functions.**

For each row below, open the file at the given line. Copy the whole `create … function … $$;` statement verbatim, change `create function` to `create or replace function`, and replace the single line `perform app_private.require_active();` with `perform app_private.require_perm('<area>', 'edit');`. Do not change anything else.

If a function has no `require_active()` line (re-read it), add the `require_perm` line as the first statement after `begin`.

| Area | Function | Latest definition |
|---|---|---|
| patients | plan_implant | 0027:16 |
| patients | place_implant | 0027:174 |
| patients | cancel_planned_implant | 0010:141 |
| patients | set_implant_technique | 0027:279 |
| patients | fit_component | 0020:136 |
| patients | record_followup | 0020:201 |
| patients | void_component | 0015:129 |
| patients | void_followup | 0015:93 |
| patients | correct_batch | 0017:186 |
| patients | delete_patient | 0027:417 |
| schedule | create_surgery_slot | 0027:42 |
| schedule | update_surgery_slot | 0027:294 |
| schedule | set_slot_status | 0027:370 |
| schedule | cancel_surgery_slot | 0014:210 |
| schedule | create_talk | 0028:105 |
| schedule | update_talk | 0028:130 |
| schedule | delete_talk | 0028:154 |
| inventory | receive_stock | 0020:233 |
| inventory | adjust_stock | 0009:109 |
| courses | delete_course | 0027:440 |
| checklists | create_checklist | 0018:143 |
| checklists | add_checklist_items | 0022:49 |
| checklists | save_template | 0022:6 |
| checklists | toggle_checklist_item | 0022:72 |
| checklists | move_checklist_item | 0018:211 |

`next_file_no` (0006:40) has no `require_active()` call and is used only as the `patients.file_no` default. Patient inserts already need patients/edit through the restrictive insert policy. It stays unchanged and is **allow-listed** in the guard-rail test.

All cross-table trigger functions are `security definer`, so the restrictive policies never block them. They are `audit_row`, `create_medical_history`, `session_checklist`, `slot_checklist`, `check_assignee`, `protect_used_product` and `check_session_in_course`. For example, a Courses-only editor creating a session still gets its auto-attached checklist. If a new invoker trigger writes another area's table, it must become security definer.

`create or replace` keeps existing grants, so no grant changes are needed. Signatures are unchanged.

---

### Task 3: Delegate readers, delegate isolation tests, apply 0030

**Files:**
- Create: `tests/db/delegate-access.test.ts`
- Append to `0030`: part 3

**Interfaces:**
- Produces:
  - `public.my_schedule(p_from date, p_to date)` returns `table(kind text, starts_at timestamptz, ends_at timestamptz, title text, course text, place text, lead text, my_role text, patient_name text, file_no text, teeth text)`
  - `public.my_report()` returns `delegate_report`'s columns

- [ ] **Step 1: Tests.** `tests/db/delegate-access.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { addTalk, book, enroll, makeChair, makeCourse, makeDelegate, makeLecturer, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

/** Turns the `target` test user into a delegate login for a fresh delegate, inside the transaction. */
async function asDelegate(c: Client) {
  await asPostgres(c);
  const me = await makeDelegate(c, 'Zz Me Delegate');
  await c.query(`update public.profiles set role = 'delegate', delegate_id = $2, active = true where user_id = $1`, [users.target, me]);
  return me;
}

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  const lecturer = await makeLecturer(c, 'Zz Prof Delegate View');
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const other = await makeCourse(c);
  const surgery = await makeSession(c, course);
  const lecture = await makeSession(c, course, 'lecture');
  const otherLecture = await makeSession(c, other, 'lecture');
  const someoneElse = await makeDelegate(c, 'Zz Someone Else');
  await enroll(c, course, someoneElse);
  const p1 = await makePatient(c, 'Zz Mine Patient');
  const p2 = await makePatient(c, 'Zz Other Patient');
  return { chair, lecturer, course, other, surgery, lecture, otherLecture, someoneElse, p1, p2 };
}

describe('delegate logins', () => {
  it('see no table rows except their own profile', async () => {
    await withTx(async (c) => {
      await asDelegate(c);
      const { rows: tables } = await c.query(`select tablename from pg_tables where schemaname = 'public' order by 1`);
      await actAs(c, users.target);
      for (const { tablename } of tables) {
        await c.query('savepoint s');
        try {
          const r = await c.query(`select count(*)::int as n from public.${tablename}`);
          const expected = tablename === 'profiles' || tablename === 'user_permissions' ? r.rows[0].n : 0;
          expect({ tablename, n: r.rows[0].n }).toEqual({ tablename, n: expected });
          if (tablename === 'profiles') expect(r.rows[0].n).toBe(1);
        } catch (e) {
          expect((e as Error).message).toMatch(/permission denied/);
        }
        await c.query('rollback to savepoint s');
      }
    });
  });

  it('cannot call staff write functions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await asDelegate(c);
      await actAs(c, users.target);
      for (const sql of [
        `select public.create_talk('${w.lecture}', '09:00', '10:00', '${w.lecturer}', 'Nope')`,
        `select public.plan_implant('${w.p1}', 36::smallint)`,
        `select public.delete_course('${w.course}')`,
      ]) {
        await c.query('savepoint s');
        await expect(c.query(sql)).rejects.toThrow(/permission|not active|denied/i);
        await c.query('rollback to savepoint s');
      }
    });
  });

  it('my_schedule shows my bookings and my courses’ talks only; my_report shows my implants only', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const me = await asDelegate(c);
      await actAs(c, users.organizer);
      await enroll(c, w.course, me);
      await book(c, { session: w.surgery, chair: w.chair, patient: w.p1, supervisor: users.organizer, placing: [me], implants: [{ tooth: 36 }] });
      await book(c, { session: w.surgery, chair: w.chair, patient: w.p2, supervisor: users.organizer, placing: [w.someoneElse], start: '11:00', end: '12:00' });
      await addTalk(c, { session: w.lecture, lecturer: w.lecturer, topic: 'Mine talk' });
      await addTalk(c, { session: w.otherLecture, lecturer: w.lecturer, start: '11:00', end: '12:00', topic: 'Other course talk' });
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1, 'ZZDEL');
      await place(c, { patient: w.p1, tooth: 46, product, lot, delegate: me, supervisor: users.organizer, technique: 'guided' });

      await actAs(c, users.target);
      const s = await c.query(`select kind, title, my_role, patient_name from public.my_schedule('2030-03-01', '2030-03-05') order by starts_at`);
      expect(s.rows).toEqual([
        { kind: 'surgery', title: 'Test Session', my_role: 'placing', patient_name: 'Zz Mine Patient' },
        { kind: 'lecture', title: 'Mine talk', my_role: null, patient_name: null },
      ]);
      const r = await c.query('select patient_name, tooth from public.my_report()');
      expect(r.rows).toEqual([{ patient_name: 'Zz Mine Patient', tooth: 46 }]);

      await asPostgres(c);
      await c.query('update public.profiles set active = false where user_id = $1', [users.target]);
      await actAs(c, users.target);
      await c.query('savepoint s');
      await expect(c.query(`select * from public.my_schedule('2030-03-01', '2030-03-05')`)).rejects.toThrow(/delegate/i);
      await c.query('rollback to savepoint s');
    });
  });

  it('staff cannot call the delegate readers', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expect(c.query('select * from public.my_report()')).rejects.toThrow(/delegate/i);
    });
  });
});
```

`world()` makes two lecture sessions on 2030-03-02, one in each course, plus the surgery session. The talks are timed so they don't clash for the shared lecturer.

- [ ] **Step 2: Append part 3 to 0030: the delegate readers.**

```sql
-- Delegates read only through these: their own bookings, their courses' talks, their own implants.
create function public.my_schedule(p_from date, p_to date)
returns table (
  kind text, starts_at timestamptz, ends_at timestamptz, title text, course text, place text, lead text,
  my_role text, patient_name text, file_no text, teeth text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select 'surgery'::text, o.starts_at, o.ends_at, se.title, c.name, ch.name, sv.full_name, sd.role::text,
         p.full_name, p.file_no,
         (select string_agg(spi.tooth::text, ', ' order by spi.tooth) from public.slot_planned_implants spi where spi.slot_id = o.id)
  from public.surgery_slots o
  join public.slot_delegates sd on sd.slot_id = o.id and sd.delegate_id = v_me
  join public.sessions se on se.id = o.session_id
  join public.courses c on c.id = se.course_id
  join public.chairs ch on ch.id = o.chair_id
  join public.patients p on p.id = o.patient_id
  left join public.supervisors sv on sv.id = o.supervisor_id
  where o.status <> 'cancelled' and se.date between p_from and p_to
  union all
  select se.type::text, t.starts_at, t.ends_at, t.topic, c.name, se.room, l.full_name, null, null, null, null
  from public.talks t
  join public.sessions se on se.id = t.session_id
  join public.courses c on c.id = se.course_id
  join public.lecturers l on l.id = t.lecturer_id
  where se.date between p_from and p_to
    and exists (select 1 from public.enrollments e where e.course_id = se.course_id and e.delegate_id = v_me)
  order by 2;
end $$;

create function public.my_report()
returns table (
  site_id uuid, role text, course_name text, patient_name text, file_no text, tooth smallint,
  state public.site_state, placed_on date, brand text, system text, platform text, diameter_mm numeric,
  length_mm numeric, description text, lot_no text, last_outcome public.followup_outcome, technique text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select s.id, case when s.placing_delegate_id = v_me then 'placing' else 'assisting' end,
         c.name, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = v_me or s.assisting_delegate_id = v_me)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
end $$;

revoke execute on function public.my_schedule(date, date) from public, anon;
revoke execute on function public.my_report() from public, anon;
grant execute on function public.my_schedule(date, date) to authenticated;
grant execute on function public.my_report() to authenticated;
```

- [ ] **Step 3: Run the DB tests and verify RED.** Run `npm run test:db -- permissions delegate-access`. Expected: FAIL, with `relation "public.user_permissions" does not exist` or a missing function.

- [ ] **Step 4: Dry-run 0030.**
  - 0029 must already be applied. A new enum value can't be used in the transaction that adds it, and 0030's check constraint uses it.
  - So Task 1, Step 2 ends by running `npm run db:migrate` while **only 0029 exists** (0030 isn't created until Step 3). That applies 0029 alone to dev.
  - Then copy PR A's `dry-run.ts` pattern into this plan's workspace. It runs `begin` → 0030 → checks → `rollback`.
  - Checks:
    - (a) the file applies;
    - (b) `select tablename from pg_tables where schemaname='public'` gives no table that lacks a restrictive policy, except the shared list;
    - (c) as `icm-test-organizer`, a write function such as `place_implant` with bogus ids gets past the permission check to a business error;
    - (d) as an organizer with only `view`, the same call fails with "You don't have permission to edit Patients."

- [ ] **Step 5: Apply and verify GREEN.** Run `npm run test:db -- permissions delegate-access`: PASS. Then run `npm run test:db` (full): PASS.
  - Existing suites act as `users.organizer`, which keeps edit through the backfill, but `ensureTestUsers` runs at global setup **before** the migrations apply.
  - If any existing suite fails with a permission error, fix it in Task 6's `test-users.ts` change (pin organizer permissions), pulled forward. Record a Ruling.

- [ ] **Step 6: Commit (one commit for Tasks 1–3).**

```bash
git add supabase/migrations/0029_delegate_role.sql supabase/migrations/0030_permissions.sql tests/db
git commit -m "feat(db): delegate role, per-area permissions, delegate-only readers (0029, 0030)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Permission helpers, session, nav, delegate redirect

**Files:**
- Create: `src/lib/auth/permissions.ts` + `permissions.test.ts`
- Modify: `src/lib/auth/session.ts`, `src/components/nav-items.ts` + test, `src/components/nav.tsx`, `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces:
  - `AREAS`, `type Area`, `AREA_LABELS`, `type Permissions = Partial<Record<Area,'view'|'edit'>>`
  - `canView(p: {role, permissions}, area)`, `canEdit(...)`
  - `permissionMessage(level, area)`
  - `Profile.role: 'admin'|'organizer'|'delegate'`, `Profile.delegate_id`, `Profile.permissions`
  - `requirePermission(area, level): Promise<Profile>` (redirect), `checkPermission(area,'edit'): Promise<string|null>` (for actions: an error message or null), `requireDelegate()`
  - `visibleNavItems(profile)`, `DELEGATE_NAV`

- [ ] **Step 1: Failing unit tests.** `src/lib/auth/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AREAS, canEdit, canView, permissionMessage } from './permissions';

const org = (permissions = {}) => ({ role: 'organizer' as const, permissions });

describe('permissions', () => {
  it('admins can do everything; delegates nothing', () => {
    for (const a of AREAS) {
      expect(canEdit({ role: 'admin', permissions: {} }, a)).toBe(true);
      expect(canView({ role: 'delegate', permissions: { [a]: 'edit' } }, a)).toBe(false);
    }
  });
  it('organizers follow their rows; edit implies view', () => {
    const p = org({ inventory: 'edit', courses: 'view' });
    expect(canView(p, 'inventory')).toBe(true);
    expect(canEdit(p, 'inventory')).toBe(true);
    expect(canView(p, 'courses')).toBe(true);
    expect(canEdit(p, 'courses')).toBe(false);
    expect(canView(p, 'patients')).toBe(false);
  });
  it('words the refusal like the database does', () => {
    expect(permissionMessage('edit', 'inventory')).toBe("You don't have permission to edit Inventory.");
  });
});
```

In `src/components/nav-items.test.ts`, replace the `visibleNavItems(role)` cases:

```ts
import { DELEGATE_NAV, visibleNavItems } from './nav-items';

it('shows panels by permission and Admin only to admins', () => {
  const labels = (p: Parameters<typeof visibleNavItems>[0]) => visibleNavItems(p).map((i) => i.label);
  expect(labels({ role: 'admin', permissions: {} })).toEqual(['Dashboard', 'Patients', 'Schedule', 'Courses', 'Checklists', 'Inventory', 'Delegates', 'Admin']);
  expect(labels({ role: 'organizer', permissions: { inventory: 'view', courses: 'edit' } })).toEqual(['Dashboard', 'Courses', 'Inventory']);
  expect(labels({ role: 'delegate', permissions: {} })).toEqual(DELEGATE_NAV.map((i) => i.label));
});
```

- [ ] **Step 2: Run them and verify RED.** `npm test -- permissions nav-items`

- [ ] **Step 3: Implement.**

`src/lib/auth/permissions.ts`:

```ts
export const AREAS = ['patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates'] as const;
export type Area = (typeof AREAS)[number];
export type Level = 'view' | 'edit';
export type Permissions = Partial<Record<Area, Level>>;
export type Role = 'admin' | 'organizer' | 'delegate';
export const AREA_LABELS: Record<Area, string> = {
  patients: 'Patients', schedule: 'Schedule', courses: 'Courses', checklists: 'Checklists', inventory: 'Inventory', delegates: 'Delegates',
};

type Who = { role: Role; permissions: Permissions };

export function canView(p: Who, area: Area): boolean {
  if (p.role === 'admin') return true;
  return p.role === 'organizer' && Boolean(p.permissions[area]);
}

export function canEdit(p: Who, area: Area): boolean {
  if (p.role === 'admin') return true;
  return p.role === 'organizer' && p.permissions[area] === 'edit';
}

export function permissionMessage(level: Level, area: Area): string {
  return `You don't have permission to ${level} ${AREA_LABELS[area]}.`;
}
```

`src/components/nav-items.ts`:
- `Role` is re-exported from `@/lib/auth/permissions`.
- `NavItem` gains `area?: Area`.
- Items: Patients → `patients`, Schedule → `schedule`, Courses → `courses`, Checklists → `checklists`, Inventory → `inventory`, Delegates → `delegates`. Dashboard has no area. Admin stays `adminOnly`.

```ts
export const DELEGATE_NAV: NavItem[] = [
  { href: '/my', label: 'My schedule' },
  { href: '/my/report', label: 'My report' },
  { href: '/account/security', label: 'Account security' },
];

export function visibleNavItems(p: { role: Role; permissions: Permissions }): NavItem[] {
  if (p.role === 'delegate') return DELEGATE_NAV;
  return NAV_ITEMS.filter((item) => (item.adminOnly ? p.role === 'admin' : !item.area || canView(p, item.area)));
}
```

Update `nav.tsx`, and every caller of `visibleNavItems(role)`, to pass `{ role, permissions }`. Find them with `grep -rn "visibleNavItems\|<Nav " src`.

`src/lib/auth/session.ts`:
- `Profile` gains `role: Role` (from permissions.ts), `delegate_id: string | null` and `permissions: Permissions`.
- `getCurrentProfile` selects `'user_id, full_name, email, role, active, delegate_id, permissions:user_permissions(area, level)'` and maps the array into an object. Its fallback object gets `delegate_id: null, permissions: {}`.
- New and changed guards:

```ts
/** Staff only: a delegate login is sent to its own pages. */
export async function requireActiveUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  if (profile.role === 'delegate') redirect('/my');
  return profile;
}

/** Pages: without view permission the user goes back to the dashboard. */
export async function requirePermission(area: Area, level: Level = 'view'): Promise<Profile> {
  const profile = await requireActiveUser();
  if (!(level === 'edit' ? canEdit(profile, area) : canView(profile, area))) redirect('/');
  return profile;
}

/** Actions: an error message to return to the form, or null when allowed. */
export async function checkPermission(area: Area, level: Level = 'edit'): Promise<string | null> {
  const profile = await requireActiveUser();
  return (level === 'edit' ? canEdit(profile, area) : canView(profile, area)) ? null : permissionMessage(level, area);
}

export async function requireDelegate(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  if (profile.role !== 'delegate') redirect('/');
  return profile;
}
```

`src/app/(app)/layout.tsx`: after the inactive check, add `if (profile.role === 'delegate') redirect('/my');` and pass `profile` to `<Nav>`.

- [ ] **Step 4: Verify GREEN and typecheck.** Run `npm test -- permissions nav-items` and `npx tsc --noEmit`. Fix every compile error from the `Role` and `Profile` changes, for example `user-row.tsx` (Profile shape) and `admin/users/page.tsx` (select now needs `delegate_id`).

- [ ] **Step 5: Commit.** `feat(auth): permission-aware session, nav and delegate redirect`.

---

### Task 5: Staff pages and actions respect permissions

**Pattern.** Apply it to every file listed.

- **Page:** replace `requireActiveUser()` (or add it if missing) with `const profile = await requirePermission('<area>')`. Compute `const editable = canEdit(profile, '<area>')`. Wrap each edit control in `{editable && …}`: forms, "New …" links, Delete buttons, row Edit links, status buttons. For client components that receive data, pass `editable` as a prop where controls live inside them.
- **Action:** first line `await requireActiveUser();` becomes:

```ts
const denied = await checkPermission('<area>');
if (denied) return { error: denied };
```

  For actions returning `FormState` with values, use `return failed(denied, formData)`. For actions that `redirect` with no state, throw `new Error(denied)`.
- **Route handlers** (`delegates/[id]/report.csv`): return 403 when `!canView(profile,'delegates')`.

| Area | Pages | Actions |
|---|---|---|
| patients | `patients/page.tsx`, `patients/new/page.tsx`, `patients/[id]/page.tsx`, `[id]/overview/page.tsx`, `[id]/notes/page.tsx`, `[id]/implants/page.tsx`, `[id]/history/page.tsx` | `patients/actions.ts`, `[id]/chart-actions.ts`, `[id]/implant-actions.ts`, `[id]/notes/actions.ts`, `[id]/overview/actions.ts` |
| schedule | `schedule/page.tsx`, `schedule/new/page.tsx` (edit), `schedule/[id]/edit/page.tsx` (edit), `schedule/pull-list/page.tsx`, `_talks/day-view.tsx`, `_talks/new-talk-page.tsx` (edit), `_talks/edit-talk-page.tsx` (edit) | `schedule/actions.ts`, `_talks/actions.ts` |
| courses | `courses/page.tsx`, `courses/[id]/page.tsx` | `courses/actions.ts` |
| checklists | `checklists/page.tsx`, `checklists/[id]/page.tsx`, `templates/page.tsx`, `templates/new/page.tsx` (edit), `templates/[id]/page.tsx` | `checklists/actions.ts` |
| inventory | `inventory/page.tsx`, `products/new/page.tsx` (edit), `products/[id]/page.tsx`, `lots/[id]/page.tsx`, `receive/page.tsx` (edit), `recall/page.tsx` | `products/actions.ts`, `receive/actions.ts`, `lots/[id]/actions.ts` |
| delegates | `delegates/page.tsx`, `delegates/[id]/page.tsx` | `delegates/actions.ts` |

Pages marked "(edit)" call `requirePermission(area, 'edit')`.

**Cross-area cases.**
- **Placing an implant** reads lots, which every staff member can read. Showing the patient chart needs patients/view.
- **The surgery schedule** shows patient names, which schedule/view allows. Patient links render only with `canView(profile,'patients')`; otherwise the name shows as plain text.
- **The dashboard** (`(app)/page.tsx`) runs a widget's query only when the user can view its area:
  - today's surgeries and the pull lists: schedule;
  - stock: inventory;
  - my checklist items: checklists.

  A hidden widget renders nothing. It does not render the "Could not load" error.
- **The course page** links sessions to the schedule only with schedule/view.

- [ ] **Step 1: Failing tests.**

Component test for one representative control-hiding case, `src/app/(app)/schedule/_talks/day-view` → move the talk list rendering into a client-free `TalkList` component that takes an `editable` prop, then test it:

```tsx
render(<TalkList kind="lectures" talks={[talk]} editable={false} />);
expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull();
```

Only extract a component where a test needs it. Elsewhere the E2E covers it.

E2E: `tests/e2e/permissions.spec.ts` uses the `viewer` user from Task 6. Write it now; it fails until Task 6 seeds the user.

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';

test('a view-only organizer sees no edit controls but can use the panel they edit', async ({ page }) => {
  await login(page, TEST_USERS.viewer.email);
  await page.goto('/courses');
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create course' })).toHaveCount(0);
  await page.goto('/inventory/receive');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('an organizer without Patients access does not see the panel', async ({ page }) => {
  await login(page, TEST_USERS.viewer.email);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' })).toBeVisible();
  // viewer has view on Patients; the "no access" path is covered by unit tests of visibleNavItems
});
```

Check the course form's button name in `courses/course-form.tsx` and use the real label.

- [ ] **Step 2: Implement panel by panel.** Commit after each area: `feat(permissions): <area> pages and actions`.

- [ ] **Step 3: Verify.**
  - `npx tsc --noEmit`, `npm test`, `npm run lint`.
  - `npx playwright test courses inventory schedule lectures patients checklists delegates`. All existing specs must stay green: the organizer has full edit.

---

### Task 6: Admin → Users: permission grid, create login, test users

**Files:**
- Create: `src/lib/admin/passwords.ts` + test
- Modify: `scripts/users.ts`, `scripts/create-user.ts`, `scripts/create-user-args.ts` (+test), `src/lib/admin/schemas.ts` (+test), `admin/users/{actions.ts,page.tsx,user-row.tsx}`, `tests/support/test-users.ts`
- Create: `admin/users/permission-grid.tsx`, `admin/users/create-login-form.tsx`

**Interfaces:**
- Produces:
  - `temporaryPassword(): string`
  - `createLogin(email, fullName, role, delegateId?) → { ok, password? } | { error }`, a server-only helper in `src/lib/admin/create-login.ts`
  - actions `savePermissions`, `createStaffLogin`
  - `TEST_USERS.viewer`, `TEST_USERS.delegate`

- [ ] **Step 1: Tests.**
  - `passwords.test.ts`: length ≥ 16, URL-safe, and two calls differ.
  - `schemas.test.ts`: `permissionsSchema` maps form fields `perm_<area>` with values `none|view|edit` to `{ area: level|null }`, and rejects unknown values.
  - `create-user-args.test.ts`: `--role delegate --delegate <uuid>` parses, and `--role delegate` without `--delegate` gives "A delegate login needs --delegate <id>."
  - Action test `admin/users/actions.test.ts`, extended:
    - with `EMAIL_ENABLED=false`, `createStaffLogin` returns `{ ok, password }` and calls `auth.admin.createUser` with `email_confirm: true`;
    - with email on, it calls `inviteUserByEmail`.
    - Mock the way the existing tests in that file do.
  - E2E, in `permissions.spec.ts`: as admin, open `/admin/users`, change `viewer`'s Patients to None, save, see "Permissions saved."; then reset it to View.

- [ ] **Step 2: Implement.**

`src/lib/admin/passwords.ts`:

```ts
import { randomBytes } from 'node:crypto';
/** A one-time password the admin hands over in person. */
export function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}
```

`scripts/create-user.ts` uses it. `scripts/users.ts` `setProfile` accepts `role: 'admin'|'organizer'|'delegate'` and `delegate_id?: string|null`, and writes `delegate_id` in the upsert. `create-user-args.ts` accepts `delegate` with a required `--delegate <uuid>`.

`src/lib/admin/schemas.ts`: `role` stays `z.enum(['admin','organizer'])` for invite and role changes. Add:

```ts
const levelField = z.enum(['none', 'view', 'edit']).transform((v) => (v === 'none' ? null : v));
export const permissionsSchema = z.object({
  user_id: z.string().uuid(),
  perm_patients: levelField, perm_schedule: levelField, perm_courses: levelField,
  perm_checklists: levelField, perm_inventory: levelField, perm_delegates: levelField,
}).transform(({ user_id, ...rest }) => ({
  user_id,
  perms: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k.replace('perm_', ''), v])),
}));
```

`admin/users/actions.ts`:

```ts
export async function savePermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = permissionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose None, View or Edit for every panel.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_permissions', { p_user: parsed.data.user_id, p_perms: parsed.data.perms });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Permissions saved.' };
}
```

`src/lib/admin/create-login.ts` (server-only) is shared by the staff and delegate logins:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { mapAuthError } from '@/lib/auth/errors';
import { updateProblem } from '@/lib/admin/results';
import { emailEnabled } from '@/lib/flags';
import { temporaryPassword } from './passwords';

type Result = { ok: string; password?: string } | { error: string };

/** Email on: an invite that verifies the address. Email off: a confirmed account with a one-time password. */
export async function createLogin(a: { email: string; full_name: string; role: 'admin' | 'organizer' | 'delegate'; delegate_id?: string | null }): Promise<Result> {
  const admin = createAdminClient();
  const password = emailEnabled() ? undefined : temporaryPassword();
  const { data, error } = password
    ? await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true })
    : await admin.auth.admin.inviteUserByEmail(a.email, { redirectTo: `${serverEnv().siteUrl}/auth/confirm` });
  if (error || !data.user) return { error: error ? mapAuthError(error) : 'Could not create the login.' };
  // Through the admin's own session so RLS and the audit log record who did it.
  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles')
      .update({ full_name: a.full_name, role: a.role, delegate_id: a.delegate_id ?? null, active: true })
      .eq('user_id', data.user.id).select('user_id'),
  );
  if (problem) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: `The login was not created: ${problem}` };
  }
  return password
    ? { ok: `Login created for ${a.email}.`, password }
    : { ok: `Invitation sent to ${a.email}. The link verifies their email address.` };
}
```

`inviteUser` now delegates to `createLogin` and is renamed `createStaffLogin`. The page always shows the form, with `InviteForm` renamed to `CreateLoginForm`:
- With email on, the button says "Send invitation".
- With email off, it says "Create login" and, after success, shows `Temporary password: <code>` with the hint "Hand it over in person. They change it under Account security."
- Remove the `EMAIL_OFF_MESSAGE` notice from this page. Keep the flag.

Profiles updates go through `profiles_admin_update`. `delegate_id` must be updatable by admins. Profiles currently has table-wide UPDATE, so no grant change is needed; confirm in the dry-run.

`user-row.tsx`:
- A delegate row shows the role "Delegate" (no select) and a link to the delegate.
- An organizer row gets `<PermissionGrid user={user} />` in an expandable `<details><summary>Permissions</summary>`: a `<form action={savePermissions}>` with, per area, a `<fieldset>` and `<legend>{AREA_LABELS[a]}</legend>` holding radios `perm_<area>` with values none/view/edit (`defaultChecked` from `user.permissions`), plus a "Save permissions" button.
- The page's select adds `delegate_id, permissions:user_permissions(area, level)` and maps them as in session.ts. Extract that mapping into `src/lib/auth/permissions.ts` as `toPermissions(rows)`, with a unit test.

`tests/support/test-users.ts`:
- Add `viewer: { email: 'icm-test-viewer@example.com' }` and `delegate: { email: 'icm-test-delegate@example.com' }`.
- PROFILES:
  - `viewer`: organizer, active.
  - `delegate`: role `delegate`, active. The `delegate_id` is set from a seeded delegate row named `'Test Delegate Login'`, upserted by name before `setProfile`.
- After profiles are set, pin permissions whenever `to_regclass('public.user_permissions')` exists:
  - every organizer test user except `viewer`: `edit` on all six areas;
  - `viewer`: `view` on all areas, and `edit` on `inventory`.
  - Use a `setPermissions(pg, id, perms)` helper in that file with a plain `delete` and `insert` over pg.
- Skip the supervisor insert for `delegate`.

- [ ] **Steps 3–5: Run the tests GREEN** (`npm test`, `npx playwright test permissions admin invite`). Run `npm run test:db` too, since the test users changed. Then commit: `feat(admin): permission grid and create-login for staff`.

---

### Task 7: Delegate login and delegate pages

**Files:**
- Create: `src/app/(app)/delegates/[id]/create-login.tsx`
- Modify: `delegates/actions.ts`, `delegates/[id]/page.tsx`
- Create:
  - `src/app/(delegate)/layout.tsx`
  - `src/app/(delegate)/my/page.tsx`
  - `src/app/(delegate)/my/report/page.tsx`
  - `src/app/(delegate)/my/report.csv/route.ts`
  - `src/lib/delegate-portal/week.ts` (+test: `weekOf(date)` returns Saturday–Friday, the clinic week in Egypt, with `prev` and `next`)
- Create: `tests/e2e/delegate-portal.spec.ts`

**Interfaces:**
- Consumes: `createLogin` (Task 6), `my_schedule` and `my_report` (Task 3), `requireDelegate` and `DELEGATE_NAV` (Task 4).

- [ ] **Step 1: Tests.**

`week.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { weekOf } from './week';
describe('weekOf', () => {
  it('runs Saturday to Friday', () => {
    expect(weekOf('2030-03-06')).toEqual({ from: '2030-03-02', to: '2030-03-08', prev: '2030-02-23', next: '2030-03-09' });
    expect(weekOf('2030-03-02').from).toBe('2030-03-02');
  });
});
```

`tests/e2e/delegate-portal.spec.ts`:
- Seed through the organizer API: a course on a random future date, a surgery session, a lecture session with a talk, two bookings (one with the test delegate's linked delegate placing, one with another delegate), and an enrolment of the linked delegate.
  - Find the linked delegate: `select delegate_id from profiles where email = icm-test-delegate@…`, read through the admin API.
- Then:
  1. Log in as `delegate`. The URL is `/my`.
  2. Go to `/my?date=<date>`. The page shows their booking's patient name and the talk topic, but not the other booking's patient.
  3. `page.goto('/patients')` ends on `/my`.
  4. `/my/report` shows the heading "My report", and "Download CSV" downloads a file whose name ends `.csv`.
  5. As admin, on a fresh delegate's page with an email, click "Create login". The page shows "Temporary password:" and "Login: active".

- [ ] **Step 2: Implement.**

`delegates/actions.ts`:

```ts
export async function createDelegateLogin(_prev: ActionState, formData: FormData): Promise<ActionState & { password?: string }> {
  await requireAdmin();
  const id = String(formData.get('delegate_id') ?? '');
  const supabase = await createClient();
  const { data: d } = await supabase.from('delegates').select('id, full_name, email').eq('id', id).maybeSingle();
  if (!d) return { error: 'Delegate not found.' };
  if (!d.email) return { error: 'Add the delegate’s email address first.' };
  const result = await createLogin({ email: d.email, full_name: d.full_name, role: 'delegate', delegate_id: d.id });
  if ('error' in result) return result;
  revalidatePath(`/delegates/${id}`);
  return result;
}
```

`delegates/[id]/page.tsx`:
- For admins, read `profiles.select('user_id, active').eq('delegate_id', id)`. Show "Login: active" or "Login: inactive" with a link to Admin → Users, or the `<CreateLogin delegateId=… hasEmail=… />` form.
- `create-login.tsx` shows the temporary password once, inside a `.card`.

`(delegate)/layout.tsx`:
- `const profile = await requireDelegate();`
- Render the same shell as `(app)/layout.tsx` (sidebar and main), with `<Nav>` given the delegate profile, which shows `DELEGATE_NAV`.
- Reuse the shell by extracting it from `(app)/layout.tsx` into `src/components/app-shell.tsx`, used by both layouts.

`/account/security` lives under `(app)`, whose layout now redirects delegates.
- Move the redirect out of `(app)/layout.tsx` into `requireActiveUser`, which pages already call.
- Make `account/security/page.tsx` use a new `requireSignedIn()` (active, any role).
- The `(app)` layout then lets delegates through only for `/account/*`. It can't see the path, so: `(app)/layout.tsx` keeps rendering for delegates with the delegate nav, and every staff page's `requirePermission` / `requireActiveUser` sends delegates to `/my`.
- Record a Ruling in the ledger if a different arrangement proves simpler.

`(delegate)/my/page.tsx`:
- `requireDelegate()`. Read `?date` with `readParams`, defaulting to `todayIso()`.
- `const w = weekOf(date)`, then `supabase.rpc('my_schedule', { p_from: w.from, p_to: w.to })`.
- Rows are grouped by day. Each row is a card showing the time (`formatTime`), a kind badge, the title, course, place and lead, plus "You: placing" with patient, file number and teeth for surgery.
- Previous and Next week links. Empty state: "Nothing scheduled this week."

`/my/report`: the table from `delegates/[id]/page.tsx`, built from `rpc('my_report')`, with a "Download CSV" link to `/my/report.csv`.

`report.csv/route.ts`: copy `delegates/[id]/report.csv/route.ts`. Use `getCurrentProfile()` and return 403 unless the role is delegate and the profile is active. Call `rpc('my_report')` and send the file with `csvFilename('my-report')`.

`/` (dashboard): `requireActiveUser` already sends delegates to `/my`.

- [ ] **Steps 3–5: Run GREEN** (`npm test -- week`, `npx playwright test delegate-portal`), then commit: `feat(delegates): delegate logins with My schedule and My report`.

---

### Task 8: Docs and full verification

- [ ] `docs/operations.md`, new section "Users and permissions":
  - creating staff and delegate logins (temporary password while `EMAIL_ENABLED=false`);
  - the permission grid;
  - enabling email verification: set SMTP in Supabase Auth → SMTP settings, set the site URL and redirect `…/auth/confirm`, then set `EMAIL_ENABLED=true` on Vercel;
  - `create-user --role delegate --delegate <id>`.
- [ ] `CLAUDE.md`, Architecture: a bullet on roles. It covers:
  - `is_active_user()` means staff;
  - per-area `can()` / `require_perm()`;
  - restrictive area policies;
  - every new security-definer write function must call `require_perm` (the guard-rail test enforces it);
  - delegates read only through `my_schedule` and `my_report`.
- [ ] Verification:
  - `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`;
  - the full E2E in two halves (as for PR A; check memory first);
  - `npx next build`;
  - manual: sign in as delegate, call `fetch('<supabase>/rest/v1/patients', { headers: { apikey, Authorization: 'Bearer ' + token } })` in devtools, and expect `[]`.
- [ ] Final whole-branch review (fresh reviewer on the most capable model), the fix pass, and the ledger. Ask before pushing.
