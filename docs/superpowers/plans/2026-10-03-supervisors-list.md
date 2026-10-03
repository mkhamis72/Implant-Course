# Supervisors List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervisors are chosen from an admin-maintained list of names (Admin → Supervisors) instead of user accounts.

**Architecture:** A new `public.supervisors` table is backfilled from `profiles` **reusing each profile's id**, so existing `surgery_slots.supervisor_id` / `implant_sites.supervisor_id` values stay valid. Release 1 (migration 0024) adds the table, a second FK on each column to `supervisors`, and switches the functions and app to it while keeping the old FKs to `profiles` (the previous app version embeds names through them). Release 2 (migration 0025) drops the `profiles` FKs, which lets name-only supervisors be saved.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase/Postgres (plpgsql, RLS), Zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-supervisors-list-design.md`

## Global Constraints

- All commands run from `web/`. DB tests: `npm run test:db -- <name>` (applies pending migrations to the **dev** project first). Never target prod.
- Never edit an applied migration. Function changes are `create or replace` of the **latest** definition: `create_surgery_slot` → `0021_booking_and_search.sql`, `place_implant` → `0020_clinical_accuracy.sql`, `lot_usage` → `0020_clinical_accuracy.sql`, `slot_conflicts` → `0014_surgery_slots.sql`.
- Release 1 must not drop or rename anything: the FKs `surgery_slots_supervisor_id_fkey` and `implant_sites_supervisor_id_fkey` (to `profiles`) stay until migration 0025.
- New public tables get no privileges by default (0019): grant explicitly.
- Name rules: supervisor `full_name` trimmed, 2–120 characters.
- Error messages from plpgsql use `app_private.fail('…')`; the new supervisor message is exactly `Choose an active supervisor.`
- Styling: named tokens and shared classes only (`.card`, `.input`, `.btn`, `text-muted`, `text-warn` …).
- Windows: write files containing `\` with the Write/Edit tools; files are CRLF in git.
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A deactivated supervisor still names past records.** Organizers must be able to read inactive supervisor rows (RLS filters on the viewer, not `active`). Test in Task 1.
2. **The current user isn't on the list.** The booking form must start with no supervisor chosen, not with an id missing from the dropdown. Test in Task 3.
3. **A booking whose supervisor was deactivated is later placed.** The placement form pre-fills that id; saving must be refused with "Choose an active supervisor." rather than succeeding silently. DB test in Task 1.
4. **Renaming a supervisor renames past records.** `lot_usage` returns the new name. Test in Task 1.
5. **A blank or too-long name in the admin form** is rejected with a clear message. Schema test in Task 2.

---

### Task 1: Migration 0024 — supervisors table, backfill, functions

**Files:**
- Create: `web/supabase/migrations/0024_supervisors.sql`
- Create: `web/tests/db/supervisors.test.ts`
- Modify: `web/tests/support/test-users.ts` (ensure each test user has a matching supervisor)
- Modify: `web/tests/db/implants.test.ts:76` (new message)

**Interfaces:**
- Produces: table `public.supervisors (id uuid, full_name text, active boolean, created_at, updated_at)`; FKs `surgery_slots_supervisor_ref_fkey`, `implant_sites_supervisor_ref_fkey`; functions keep their signatures.

- [ ] **Step 1: Make test users get a supervisor row.** In `ensureTestUsers()` in `tests/support/test-users.ts`, after the `for … setProfile(…)` loop inside `if (rows[0].t) { … }`, add:

```ts
      // Supervisors exist only after migration 0024; each test user supervises under its own id.
      const sup = await pg.query("select to_regclass('public.supervisors') as t");
      if (sup.rows[0].t) {
        for (const key of Object.keys(PROFILES) as TestUserKey[]) {
          await pg.query(
            `insert into public.supervisors (id, full_name, active) values ($1, $2, $3)
             on conflict (id) do update set full_name = excluded.full_name, active = excluded.active`,
            [ids[key], PROFILES[key].full_name, PROFILES[key].active],
          );
        }
      }
```

- [ ] **Step 2: Write the failing DB test** `tests/db/supervisors.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('supervisors', () => {
  it('every profile has a supervisor with the same id', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        'select count(*)::int as n from public.profiles p where not exists (select 1 from public.supervisors s where s.id = p.user_id)',
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('organizers read all supervisors, including inactive ones; only admins write', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query('select active from public.supervisors where id = $1', [users.inactive]);
      expect(rows).toEqual([{ active: false }]);
      await refused(c, () => c.query(`insert into public.supervisors (full_name) values ('Zz Sup Nope')`), /row-level security/);
      await actAs(c, users.admin);
      const added = await c.query(`insert into public.supervisors (full_name) values ('Zz Sup Visiting') returning id`);
      await c.query('update public.supervisors set active = false where id = $1', [added.rows[0].id]);
    });
  });

  it('placing with an inactive supervisor is refused; renames show in lot usage', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const implant = await makeProduct(c);
      const lot = await receive(c, implant, 2, 'SUP');
      const delegate = await makeDelegate(c);
      await refused(
        c,
        () => place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.inactive }),
        /Choose an active supervisor/,
      );
      await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
      await asPostgres(c);
      await c.query(`update public.supervisors set full_name = 'Zz Renamed Sup' where id = $1`, [users.organizer]);
      await actAs(c, users.organizer);
      const { rows } = await c.query('select supervisor from public.lot_usage($1)', [lot]);
      expect(rows).toEqual([{ supervisor: 'Zz Renamed Sup' }]);
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:db -- supervisors`
Expected: FAIL — `relation "public.supervisors" does not exist`.

- [ ] **Step 4: Write `supabase/migrations/0024_supervisors.sql`:**

```sql
-- Supervisors: a list of names maintained by admins, independent of user accounts.
-- Existing accounts are copied in with their own ids, so existing supervisor_id values stay valid.

create table public.supervisors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger supervisors_set_updated_at before update on public.supervisors
  for each row execute function app_private.set_updated_at();
create trigger supervisors_audit after insert or update or delete on public.supervisors
  for each row execute function app_private.audit_row('id');

revoke all on public.supervisors from public, anon, authenticated;
grant select on public.supervisors to authenticated;
grant insert (full_name, active) on public.supervisors to authenticated;
grant update (full_name, active) on public.supervisors to authenticated;
alter table public.supervisors enable row level security;
create policy supervisors_select on public.supervisors for select to authenticated using (public.is_active_user());
create policy supervisors_insert on public.supervisors for insert to authenticated with check (public.is_admin());
create policy supervisors_update on public.supervisors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.supervisors (id, full_name, active)
select user_id,
       left(case when length(trim(coalesce(full_name, ''))) >= 2 then trim(full_name) else email end, 120),
       active
from public.profiles;

-- Release 1 keeps the FKs to profiles (the previous app version embeds through them); 0025 drops them.
alter table public.surgery_slots
  add constraint surgery_slots_supervisor_ref_fkey foreign key (supervisor_id) references public.supervisors (id);
alter table public.implant_sites
  add constraint implant_sites_supervisor_ref_fkey foreign key (supervisor_id) references public.supervisors (id);

-- Clash message names the supervisor from the list (latest: 0014).
create or replace function public.slot_conflicts(
  p_session uuid, p_chair uuid, p_start time, p_end time, p_patient uuid, p_supervisor uuid,
  p_delegates uuid[], p_exclude uuid default null
) returns table (kind text, message text)
language sql stable security invoker set search_path = '' as $$
  with me as (
    select public.cairo_ts(s.date, p_start) as s_at, public.cairo_ts(s.date, p_end) as e_at
    from public.sessions s where s.id = p_session
  ),
  other as (
    select o.id, o.chair_id, o.patient_id, o.supervisor_id, c.name as chair_name, p.full_name as patient_name,
           to_char(o.starts_at at time zone 'Africa/Cairo', 'HH24:MI') || '–' ||
           to_char(o.ends_at at time zone 'Africa/Cairo', 'HH24:MI') as span
    from public.surgery_slots o
    cross join me
    join public.chairs c on c.id = o.chair_id
    join public.patients p on p.id = o.patient_id
    where o.status <> 'cancelled'
      and (p_exclude is null or o.id <> p_exclude)
      and tstzrange(o.starts_at, o.ends_at) && tstzrange(me.s_at, me.e_at)
  )
  select 'chair', format('%s is already booked %s (%s).', chair_name, span, patient_name) from other where chair_id = p_chair
  union all
  select 'patient', format('%s already has a surgery %s.', patient_name, span) from other where patient_id = p_patient
  union all
  select 'supervisor', format('%s is already supervising %s (%s).',
           (select su.full_name from public.supervisors su where su.id = p_supervisor),
           span, patient_name)
  from other where supervisor_id = p_supervisor
  union all
  select 'delegate', format('%s is already booked %s (%s).', d.full_name, o.span, o.patient_name)
  from other o
  join public.slot_delegates sd on sd.slot_id = o.id
  join public.delegates d on d.id = sd.delegate_id
  where sd.delegate_id = any (p_delegates);
$$;

-- Recall: the supervisor's name comes from the list (latest: 0020).
create or replace function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         case when m.site_component_id is null then d.full_name
              else coalesce(fd.full_name, nullif(fo.full_name, ''), fo.email) end,
         su.full_name
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.supervisors su on su.id = s.supervisor_id
  left join public.delegates fd on fd.id = sc.fitted_by_delegate_id
  left join public.profiles fo on fo.user_id = sc.fitted_by_organizer_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by 2 desc, p.full_name;
$$;
```

Then append **`create_surgery_slot`**: copy the whole statement from `0021_booking_and_search.sql` (from `create or replace function public.create_surgery_slot(` through its closing `end $$;`, lines 2–127) verbatim, changing only these two lines:

```sql
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
```
to
```sql
  if p_supervisor is null or not exists (select 1 from public.supervisors where id = p_supervisor and active) then
    perform app_private.fail('Choose an active supervisor.');
```

Then append **`place_implant`**: copy the whole statement from `0020_clinical_accuracy.sql` (from `create or replace function public.place_implant(` through its closing `end $$;`, lines 33–134) verbatim, with the same two-line change.

`create or replace` keeps the existing grants; no grant statements are needed for the four functions.

- [ ] **Step 5: Update the old message in `tests/db/implants.test.ts:76`:** replace `/Choose the supervising organizer/` with `/Choose an active supervisor/`. Run `grep -rn "supervising organizer" tests src` and update any other hit the same way.

- [ ] **Step 6: Run the DB tests**

Run: `npm run test:db`
Expected: all pass, including `supervisors`, `slots`, `implants`, `components` (its `lot_usage` assertion expects `'Test Organizer'`, now the copied supervisor name).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0024_supervisors.sql tests/db/supervisors.test.ts tests/db/implants.test.ts tests/support/test-users.ts
git commit -m "feat(db): supervisors list backfilled from accounts; functions validate and name supervisors from it"
```

---

### Task 2: Admin → Supervisors page

**Files:**
- Modify: `web/src/lib/schedule/schemas.ts` (add `supervisorSchema`), `web/src/lib/schedule/schemas.test.ts`
- Modify: `web/src/lib/schedule/types.ts` (add `Supervisor`)
- Create: `web/src/app/(app)/admin/supervisors/page.tsx`, `actions.ts`, `supervisor-row.tsx`
- Modify: `web/src/app/(app)/admin/layout.tsx` (nav item)
- Modify: `web/tests/e2e/patients.ts` (`deactivateE2eCatalog` also deactivates E2E supervisors)
- Create: `web/tests/e2e/supervisors.spec.ts`

**Interfaces:**
- Consumes: table `public.supervisors` (Task 1).
- Produces: `supervisorSchema: z.ZodObject<{ full_name: z.ZodString }>`; `type Supervisor = { id: string; full_name: string; active: boolean }`; route `/admin/supervisors`; row test id `supervisor-row-<full_name>`; labels "New supervisor", button "Add supervisor".

- [ ] **Step 1: Write the failing schema test** — append to `src/lib/schedule/schemas.test.ts` (add `supervisorSchema` to its import from `./schemas`):

```ts
describe('supervisorSchema', () => {
  it('trims the name and requires 2–120 characters', () => {
    expect(supervisorSchema.parse({ full_name: '  Prof. Laila Samir ' })).toEqual({ full_name: 'Prof. Laila Samir' });
    expect(supervisorSchema.safeParse({ full_name: '   ' }).success).toBe(false);
    expect(supervisorSchema.safeParse({ full_name: 'x'.repeat(121) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- schemas`
Expected: FAIL — `supervisorSchema` is not exported.

- [ ] **Step 3: Add the schema and type.** In `src/lib/schedule/schemas.ts`, after `chairSchema`:

```ts
export const supervisorSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the supervisor’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});
```

In `src/lib/schedule/types.ts`, after the `Chair` type:

```ts
export type Supervisor = { id: string; full_name: string; active: boolean };
```

- [ ] **Step 4: Run** `npm test -- schemas` — Expected: PASS.

- [ ] **Step 5: Create `src/app/(app)/admin/supervisors/actions.ts`:**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { supervisorSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function addSupervisor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = supervisorSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('supervisors').insert({ full_name: parsed.data.full_name });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/admin/supervisors');
  return { ok: 'Supervisor added.' };
}

export async function updateSupervisor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = supervisorSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('supervisors')
    .update({ full_name: parsed.data.full_name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? userMessage(error)! : 'Supervisor not found.', formData);
  revalidatePath('/admin/supervisors');
  return { ok: 'Saved.' };
}
```

- [ ] **Step 6: Create `src/app/(app)/admin/supervisors/supervisor-row.tsx`:**

```tsx
'use client';

import { useActionState } from 'react';
import type { Supervisor } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addSupervisor, updateSupervisor } from './actions';

export function SupervisorRow({ supervisor }: { supervisor: Supervisor }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSupervisor, {});
  return (
    <li data-testid={`supervisor-row-${supervisor.full_name}`} className="border-t border-line py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={supervisor.id} readOnly />
        <input className="input max-w-xs" name="full_name" aria-label="Name" defaultValue={supervisor.full_name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={supervisor.active} />
          Active
        </label>
        <span className="text-sm text-muted">{supervisor.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddSupervisor() {
  const [state, action, pending] = useActionState<FormState, FormData>(addSupervisor, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New supervisor</span>
        <input className="input" name="full_name" placeholder="e.g. Prof. Laila Samir" />
      </label>
      <button className="btn" disabled={pending}>
        Add supervisor
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Create `src/app/(app)/admin/supervisors/page.tsx`:**

```tsx
import { createClient } from '@/lib/supabase/server';
import type { Supervisor } from '@/lib/schedule/types';
import { AddSupervisor, SupervisorRow } from './supervisor-row';

export default async function SupervisorsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('supervisors').select('id, full_name, active').order('full_name');
  if (error) throw new Error('Could not load supervisors');
  return (
    <div className="space-y-6">
      <h1>Supervisors</h1>
      <p className="text-muted">The names offered as supervisor on bookings and implants. Inactive supervisors stay on past records.</p>
      <AddSupervisor />
      <ul className="card">
        {((data ?? []) as Supervisor[]).map((s) => (
          <SupervisorRow key={s.id} supervisor={s} />
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 8: Add the nav item** in `src/app/(app)/admin/layout.tsx`, after the Chairs item:

```tsx
          { href: '/admin/supervisors', label: 'Supervisors' },
```

- [ ] **Step 9: Clean up E2E supervisors.** In `tests/e2e/patients.ts` `deactivateE2eCatalog()`, after the chairs line:

```ts
    await pg.query('update public.supervisors set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
```

- [ ] **Step 10: Write `tests/e2e/supervisors.spec.ts`:**

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a supervisor', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/supervisors');
  const name = uniqueName('Prof');
  await page.getByLabel('New supervisor').fill(name);
  await page.getByRole('button', { name: 'Add supervisor' }).click();
  const row = page.getByTestId(`supervisor-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`supervisor-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open supervisor settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/supervisors');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
```

- [ ] **Step 11: Run** `npx tsc --noEmit`, `npm run lint`, `npx playwright test supervisors chairs` — Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/lib/schedule src/app/\(app\)/admin tests/e2e/supervisors.spec.ts tests/e2e/patients.ts
git commit -m "feat(admin): Admin → Supervisors page to add, rename and deactivate supervisors"
```

---

### Task 3: Booking form and schedule read supervisors

**Files:**
- Modify: `web/src/app/(app)/schedule/new/page.tsx`, `web/src/app/(app)/schedule/new/slot-form.tsx`, `web/src/app/(app)/schedule/new/slot-form.test.tsx`
- Modify: `web/src/lib/schedule/queries.ts`, `web/src/lib/schedule/types.ts:24`, `web/src/app/(app)/schedule/page.tsx:94`

**Interfaces:**
- Consumes: `public.supervisors`, FK `surgery_slots_supervisor_ref_fkey` (Task 1).
- Produces: `SlotForm` prop renamed `organizers` → `supervisors: Option[]`; `SlotRow.supervisor: { full_name: string } | null`.

- [ ] **Step 1: Write the failing component tests.** In `slot-form.test.tsx`, change `props` to use `supervisors: []` instead of `organizers: []`, and add:

```tsx
  it('starts with no supervisor when the current user is not on the list', () => {
    render(<SlotForm {...props} me="u-me" supervisors={[{ id: 'sup1', label: 'Prof. Laila Samir' }]} sessions={[]} />);
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('');
  });

  it('selects the current user when they are on the list', () => {
    render(<SlotForm {...props} me="sup1" supervisors={[{ id: 'sup1', label: 'Dr Me' }]} sessions={[]} />);
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('sup1');
  });

  it('points to Admin → Supervisors when the list is empty', () => {
    render(<SlotForm {...props} sessions={[]} />);
    expect(screen.getByText(/No supervisors yet/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run** `npm test -- slot-form` — Expected: FAIL (type error / no placeholder option / no hint).

- [ ] **Step 3: Update `slot-form.tsx`.** In `Props`, rename `organizers: Option[];` to `supervisors: Option[];`. Change the supervisor initial state to:

```tsx
  const [supervisorId, setSupervisorId] = useState(p.supervisors.some((s) => s.id === p.me) ? p.me : '');
```

Replace the Supervisor `<label>` block with:

```tsx
        <label className="block">
          <span className="label">Supervisor</span>
          <select className="input" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            <option value="">Choose a supervisor…</option>
            {p.supervisors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {p.supervisors.length === 0 && (
            <span className="mt-1 block text-sm text-warn">No supervisors yet — an admin can add them under Admin → Supervisors.</span>
          )}
        </label>
```

- [ ] **Step 4: Update `schedule/new/page.tsx`.** Replace the profiles query in `Promise.all` with:

```ts
    supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
```

rename the destructured `organizers` to `supervisors`, and pass:

```tsx
        supervisors={(supervisors ?? []).map((s) => ({ id: s.id as string, label: s.full_name as string }))}
```

in place of the `organizers={…}` prop.

- [ ] **Step 5: Read names from supervisors.** In `src/lib/schedule/queries.ts` replace the supervisor line with:

```ts
  supervisor:supervisors!surgery_slots_supervisor_ref_fkey(full_name),
```

In `src/lib/schedule/types.ts` change `supervisor: { full_name: string; email: string } | null;` to `supervisor: { full_name: string } | null;`. In `src/app/(app)/schedule/page.tsx:94` change the line to:

```tsx
                  <div>Supervisor: {b.supervisor?.full_name}</div>
```

Run `grep -rn "supervisor?.email\|supervisor.email" src` and apply the same change to any other `SlotRow` consumer (e.g. the pull list).

- [ ] **Step 6: Run** `npm test -- slot-form`, `npx tsc --noEmit`, `npm run lint`, `npx playwright test schedule pull-list slot-placement` — Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/schedule src/lib/schedule
git commit -m "feat(schedule): booking supervisor chosen from the supervisors list; names read from it"
```

---

### Task 4: Implant placement and implant views read supervisors

**Files:**
- Modify: `web/src/lib/inventory/types.ts` (`ImplantSite.supervisor`, `ChartData.supervisors`)
- Modify: `web/src/app/(app)/patients/[id]/chart-data.ts`, `implant-forms.tsx`, `implant-forms.test.tsx`, `implant-section.tsx:64`, `implants/page.tsx:56`

**Interfaces:**
- Consumes: `public.supervisors`, FK `implant_sites_supervisor_ref_fkey` (Task 1).
- Produces: `ChartData.supervisors: Option[]` (active supervisors, by name). `ChartData.organizers` stays — it is still used for "fitted by organizer".

- [ ] **Step 1: Write the failing component test.** In `implant-forms.test.tsx`, add `supervisors: []` to the shared chart-data fixture (next to `organizers: []`), and add this test (it renders `PlaceForm` like the file's `placeForm()` helper, with extra data):

```tsx
  it('offers the supervisors list and starts empty when the current user is not on it', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={{ ...data, me: 'u1', supervisors: [{ id: 'sup1', label: 'Prof. Laila Samir' }] }} onDone={() => {}} plannedProductId="p1" />);
    const select = screen.getByRole('combobox', { name: /Supervisor/ });
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Prof. Laila Samir' })).toBeInTheDocument();
  });
```


- [ ] **Step 2: Run** `npm test -- implant-forms` — Expected: FAIL.

- [ ] **Step 3: Types.** In `src/lib/inventory/types.ts` change `supervisor: Organizer;` in `ImplantSite` to `supervisor: { full_name: string } | null;`, and add `supervisors: Option[];` to `ChartData` after `organizers`.

- [ ] **Step 4: Loader.** In `chart-data.ts`, change the `SITE_SELECT` supervisor line to:

```ts
  supervisor:supervisors!implant_sites_supervisor_ref_fkey(full_name),
```

Add a seventh query to `Promise.all` and to the error-check loop:

```ts
    supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
```

(destructured as `supervisors`), and return:

```ts
    supervisors: (supervisors.data ?? []).map((s) => ({ id: s.id as string, label: s.full_name as string })),
```

- [ ] **Step 5: Placement form.** In `implant-forms.tsx`:
  - initial state: `supervisorId: slot?.supervisor_id ?? (data.supervisors.some((s) => s.id === data.me) ? data.me : ''),`
  - summary line 229: `nameOf(data.supervisors, v.supervisorId)` instead of `nameOf(data.organizers, v.supervisorId)`
  - supervisor select at line 247: `{data.supervisors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}`
  - leave line 304 (fitted-by organizer) on `data.organizers`.

- [ ] **Step 6: Views.** `implant-section.tsx:64` → ``site.supervisor ? `supervised by ${site.supervisor.full_name}` : null,``. `implants/page.tsx:56` → `{s.supervisor?.full_name || '—'}`. Run `grep -rn "implant_sites_supervisor_id_fkey\|surgery_slots_supervisor_id_fkey" src` — Expected: no hits.

- [ ] **Step 7: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npx playwright test implants implants-tab corrections slot-placement chart` — Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/inventory/types.ts src/app/\(app\)/patients
git commit -m "feat(implants): placement supervisor chosen from the supervisors list; names read from it"
```

---

### Task 5: Release 1 — verify and open PR 1

- [ ] **Step 1: Full verification.** Run `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`, `npm run test:e2e`. Expected: all pass. Report any failure with its output; do not proceed past a failure.
- [ ] **Step 2:** Push the branch and open PR 1 ("feat: supervisors list (release 1 of 2)"), noting in the body that release 2 (0025) must be merged right after, and that until then name-only supervisors can't be saved on a booking or implant.
- [ ] **Step 3: STOP.** The user merges PR 1 and the release must succeed before Task 6.

---

### Task 6: Release 2 — migration 0025 drops the profile FKs

**Files:**
- Create: `web/supabase/migrations/0025_supervisors_drop_profile_fk.sql`
- Modify: `web/tests/db/supervisors.test.ts`
- Create: `web/tests/e2e/supervisor-booking.spec.ts`

- [ ] **Step 1: Branch** from the updated `master`: `git checkout master && git pull && git checkout -b supervisors-drop-profile-fk`.

- [ ] **Step 2: Write the failing DB test** — append to `tests/db/supervisors.test.ts`, adding `book, enroll, makeChair, makeCourse, makeSession` to the fixtures import:

```ts
  it('a supervisor without an account can supervise a booking', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const sup = (await c.query(`insert into public.supervisors (full_name) values ('Zz Visiting Prof') returning id`)).rows[0].id;
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const delegate = await makeDelegate(c);
      await enroll(c, course, delegate);
      await asPostgres(c);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const slot = await book(c, { session, chair, patient, supervisor: sup, placing: [delegate] });
      const { rows } = await c.query('select supervisor_id from public.surgery_slots where id = $1', [slot]);
      expect(rows).toEqual([{ supervisor_id: sup }]);
    });
  });
```

(`makeChair` runs as postgres because only admins may insert chairs under RLS.)

- [ ] **Step 3: Run** `npm run test:db -- supervisors` — Expected: FAIL with a foreign-key violation on `surgery_slots_supervisor_id_fkey`.

- [ ] **Step 4: Write `supabase/migrations/0025_supervisors_drop_profile_fk.sql`:**

```sql
-- Release 2 of the supervisors list: supervisor ids no longer have to be user accounts.
-- The app reads names through *_supervisor_ref_fkey since release 1 (0024).
alter table public.surgery_slots drop constraint surgery_slots_supervisor_id_fkey;
alter table public.implant_sites drop constraint implant_sites_supervisor_id_fkey;
```

- [ ] **Step 5: Run** `npm run test:db` — Expected: all pass.

- [ ] **Step 6: Write `tests/e2e/supervisor-booking.spec.ts`** (seeds via the admin API, then books through the UI):

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

test('an organizer books a surgery with a name-only supervisor', async ({ page }) => {
  const adminApi = await apiAs(TEST_USERS.admin.email);
  const api = await apiAs(TEST_USERS.organizer.email);
  const prof = uniqueName('Prof');
  const { error } = await adminApi.from('supervisors').insert({ full_name: prof });
  expect(error).toBeNull();
  const date = randomFutureDate();
  const course = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const session = await seedSession(api, { courseId: course, type: 'surgery', title: 'Surgery day', date });
  const chair = uniqueName('Chair');
  await seedChair(adminApi, chair);
  const delegate = uniqueName('Dr D');
  await enroll(api, course, await seedDelegate(api, delegate));
  const patient = await api.from('patients').insert({ full_name: uniqueName('Sup patient') }).select('file_no').single();
  expect(patient.error).toBeNull();

  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/new?session=${session}`);
  await page.getByRole('combobox', { name: 'Chair' }).selectOption({ label: chair });
  await page.getByRole('combobox', { name: 'Supervisor' }).selectOption({ label: prof });
  await page.getByLabel('End').fill('10:00');
  await page.getByLabel('Patient (file number)').fill(patient.data!.file_no);
  await page.getByRole('combobox', { name: `Role of ${delegate}` }).selectOption('placing');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${date}`));
  await expect(page.getByText(`Supervisor: ${prof}`)).toBeVisible();
});
```


- [ ] **Step 7: Run** `npx playwright test supervisor-booking schedule` — Expected: PASS.

- [ ] **Step 8: Commit, push, open PR 2** ("feat: supervisors list (release 2 of 2) — name-only supervisors"). STOP for the user to merge.

```bash
git add supabase/migrations/0025_supervisors_drop_profile_fk.sql tests/db/supervisors.test.ts tests/e2e/supervisor-booking.spec.ts
git commit -m "feat(db): supervisors no longer need a user account (drop profile FKs)"
```
