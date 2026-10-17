# Research Readiness Part 2b (Complications and Failure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complications registry (events at any time, editable as they evolve, voided rather than deleted) and structured implant failure (date, type, reason, notes; editable; early/late derived), wired into visits, History, the odontogram and the Implants tab.

**Architecture:** Migration `0047` adds `implant_complications` with `record_complication` / `update_complication` / `void_complication`; migration `0048` adds failure columns on `implant_sites` with `record_failure` / `correct_failure`, and redefines `record_visit` (a "failed" outcome now carries failure details), `void_followup` (undoing a failure clears its details), `implant_visits` and `recall_list` (visits end at the failure date). TypeScript rules in `src/lib/implants/complications.ts` and `src/lib/implants/failure.ts`; UI blocks on the chart's implant panel; a warning marker on the odontogram.

**Tech Stack:** Next.js 15 App Router (server actions), React 19, Tailwind v4, Zod v4, Supabase Postgres (plpgsql, RLS), Vitest (unit, component, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-research-followups-complications-design.md` (section "2b — Complications and failure").

## Global Constraints

- **Prerequisite:** research part 2a (`feat/research-visits`, migrations 0045–0046, `src/lib/visits/`, `patients/[id]/visits.tsx`) is merged to `master`. Branch `feat/research-complications` from `master` after that. If `web/supabase/migrations/0046_visit_status.sql` is not on `master`, stop.
- Run every command from `web/`. Windows + Git Bash: write files containing `\` with the Write/Edit tools; files are CRLF in git. No Prettier; match surrounding style.
- Empty means not recorded, never "no". An open complication is one with no resolved date.
- Complication categories/types (exact values): surgical `intraoperative_injury`, `haemorrhage`, `nerve_symptoms`, `sinus_complication`, `wound_dehiscence`, `infection`, `graft_exposure_loss`, `early_osseointegration_loss`, `other`; biological `mucositis`, `peri_implantitis`, `progressive_bone_loss`, `suppuration`, `persistent_pain`, `soft_tissue_recession`, `other`; mechanical `implant_fracture`, `abutment_fracture`, `screw_loosening`, `screw_fracture`, `restoration_fracture`, `loss_of_retention`, `prosthetic_remake`, `other`. Severity `mild` / `moderate` / `severe`.
- Failure types `lost` / `removed` / `failed_in_place`; reasons `no_osseointegration` / `peri_implantitis` / `fracture` / `malposition` / `other`.
- Text limits: other type ≤ 120; treatment, notes, failure notes ≤ 1000.
- Peri-implantitis and mucositis are recorded by the clinician; the form shows the 2017 World Workshop case definitions. No automatic diagnosis.
- Early vs late failure is derived (TypeScript): early when the failure date is before the first non-voided Ti-base / multi-unit / abutment / final-restoration component; late otherwise. Not stored.
- Public `security definer` functions: `set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, errors via `app_private.fail(...)`, `revoke execute … from public, anon; grant execute … to authenticated;`. `app_private` functions are called only from definer functions (authenticated has no usage on `app_private`).
- Migrations are additive, never edited once `npm run test:db` has applied them; dry-run each in a rolled-back transaction first (script as `.mts` in your scratchpad with `file:///` imports, e.g. `import { pgConfig } from 'file:///D:/Claude/Claude Code/Implant Course/web/scripts/db.ts';`, run with `NODE_PATH=node_modules npx tsx --env-file=.env.local <script> <migration> [check SQL…]`). If a defect appears after a migration was applied, stop and report.
- Redefinitions copy the **latest** definition (search later migrations first) and change only what the task says; same signature, so grants are kept.
- Styling: named tokens and shared classes (`badge`, `badge-ok|warn|bad`, `.btn`, `.btn-secondary`, `.btn-danger`, `.input`, `.label`, `.table` with `data-label` on every `<td>`).
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.

## Review Focus

1. **Undoing the visit that recorded a failure** (voiding it) — the implant returns to placed/restored and its failure details are cleared, so it no longer shows a failure box or "Edit failure details" for a failure that didn't happen (Task 2 DB test).
2. **A failed implant's earlier missed visits** — visits whose window closed before the failure date still show as missed on the chart, but the implant never appears on the recall list (Task 2 DB test).
3. **Editing a complication someone else just resolved** — the stale edit is refused with "changed by someone else", not silently reopening it (Task 1 DB test; Task 5 component sends the version it opened with).
4. **Switching the category after choosing a type** — the type list resets so a surgical type can't be saved under "biological"; the database refuses it anyway (Task 3 schema test; Task 1 DB test).
5. **Recording a "failed" visit on an implant whose failure is already recorded** — no second set of failure details is asked for or accepted (Task 2 DB test; Task 5 form hides the fields).

---

### Task 1: Migration 0047 — complications

**Files:**
- Create: `web/supabase/migrations/0047_complications.sql`
- Create: `web/tests/db/complications.test.ts`
- Modify: `web/tests/db/permissions.test.ts` (patient-area audit tables list)

**Interfaces:**
- Produces (DB): table `implant_complications` (columns below); functions
  - `public.record_complication(p_site uuid, p_details jsonb) returns uuid`
  - `public.update_complication(p_complication uuid, p_details jsonb, p_expected_updated_at timestamptz) returns void`
  - `public.void_complication(p_complication uuid, p_reason text) returns void`
- Details JSON keys (exact): `category`, `type`, `other_type`, `noticed_on` (`YYYY-MM-DD`), `severity`, `treatment`, `resolved_on`, `followup_id`, `notes`.
- Error messages (exact): `'Complications are recorded for placed implants.'`, `'Unknown detail: %s.'`, `'Choose the complication category.'`, `'Choose the complication type.'`, `'Describe the other complication.'`, `'Enter when the complication was noticed (from the placement date to today).'`, `'The resolved date must be on or after the date noticed, and not in the future.'`, `'Choose the severity from the list.'`, `'Choose a visit of this implant.'`, `'Keep the text shorter (other type 120, treatment and notes 1000 characters).'`, `'Complication not found.'`, `'This complication was changed by someone else. Reload to see it.'`.

- [ ] **Step 1: Create the branch**

```bash
cd web && git checkout master && git pull && git log --oneline -1 -- supabase/migrations/0046_visit_status.sql && git checkout -b feat/research-complications
```
Expected: the `git log` line prints a commit. If not, stop.

- [ ] **Step 2: Write the failing DB tests**

Create `web/tests/db/complications.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function placedSite(c: Client, daysAgo = 60, name = 'Zz Complication Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'CMP');
  const delegate = await makeDelegate(c, 'Zz Complication Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}
const daysAgo = async (c: Client, n: number) => (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

const record = async (c: Client, site: string, d: Record<string, unknown>) =>
  (await c.query('select public.record_complication($1, $2::jsonb) as id', [site, JSON.stringify(d)])).rows[0].id as string;
const update = (c: Client, id: string, d: Record<string, unknown>, expected: string | null) =>
  c.query('select public.update_complication($1, $2::jsonb, $3::timestamptz)', [id, JSON.stringify(d), expected]);
const row = async (c: Client, id: string) =>
  (await c.query(`select category, type, other_type, noticed_on::text, severity, treatment, resolved_on::text, followup_id, notes,
                         voided_at, voided_reason, updated_at::text as updated_at
                  from public.implant_complications where id = $1`, [id])).rows[0];

describe('record_complication', () => {
  it('records a complication; open until resolved', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 10);
      const id = await record(c, site, { category: 'biological', type: 'mucositis', noticed_on: noticed, severity: 'mild', treatment: ' OHI ' });
      expect(await row(c, id)).toMatchObject({
        category: 'biological', type: 'mucositis', other_type: '', noticed_on: noticed, severity: 'mild', treatment: 'OHI', resolved_on: null,
      });
    });
  });

  it('refuses a type outside its category, other without text, unknown details and bad dates', async () => {
    await withTx(async (c) => {
      const { site, placedOn } = await placedSite(c);
      const ok = { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 5) };
      await refused(c, () => record(c, site, { ...ok, category: '' }), /Choose the complication category/);
      await refused(c, () => record(c, site, { ...ok, type: 'mucositis' }), /Choose the complication type/);
      await refused(c, () => record(c, site, { ...ok, type: 'other' }), /Describe the other complication/);
      await refused(c, () => record(c, site, { ...ok, colour: 'red' }), /Unknown detail: colour/);
      const before = (await c.query('select ($1::date - 1)::text as d', [placedOn])).rows[0].d;
      await refused(c, () => record(c, site, { ...ok, noticed_on: before }), /from the placement date to today/);
      await refused(c, () => record(c, site, { ...ok, noticed_on: '2999-01-01' }), /from the placement date to today/);
      await refused(c, () => record(c, site, { ...ok, noticed_on: '2026-02-30' }), /from the placement date to today/);
      await refused(c, () => record(c, site, { ...ok, resolved_on: await daysAgo(c, 6) }), /on or after the date noticed/);
      await refused(c, () => record(c, site, { ...ok, severity: 'awful' }), /Choose the severity from the list/);
      await refused(c, () => record(c, site, { ...ok, notes: 'x'.repeat(1001) }), /Keep the text shorter/);
      await record(c, site, { ...ok, type: 'other', other_type: 'Haematoma' });
    });
  });

  it('links a complication to a visit of the same implant only', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const visit = (await c.query(
        `select public.record_visit($1, public.cairo_today(), null, 'Pain review', 'attended', 'complication', '{}'::jsonb, '') as id`, [site],
      )).rows[0].id;
      const other = await placedSite(c, 60, 'Zz Complication Other');
      const d = { category: 'biological', type: 'persistent_pain', noticed_on: await daysAgo(c, 0) };
      await refused(c, () => record(c, other.site, { ...d, followup_id: visit }), /Choose a visit of this implant/);
      await refused(c, () => record(c, site, { ...d, followup_id: 'not-a-uuid' }), /Choose a visit of this implant/);
      const id = await record(c, site, { ...d, followup_id: visit });
      expect((await row(c, id)).followup_id).toBe(visit);
    });
  });

  it('refuses a planned implant and needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await asPostgres(c);
      const planned = (await c.query(`insert into public.implant_sites (patient_id, tooth, state) values ($1, 11, 'planned') returning id`, [patient])).rows[0].id;
      await actAs(c, users.organizer);
      const d = { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 1) };
      await refused(c, () => record(c, planned, d), /Complications are recorded for placed implants/);
      await actAs(c, users.viewer);
      await refused(c, () => record(c, site, d), /permission to edit Patients/);
    });
  });
});

describe('update_complication and void_complication', () => {
  it('adds treatment and resolves with the version it read; a stale version is refused', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 10);
      const id = await record(c, site, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed });
      const first = await row(c, id);
      const resolved = await daysAgo(c, 2);
      await update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed, treatment: 'Debridement', resolved_on: resolved }, first.updated_at);
      expect(await row(c, id)).toMatchObject({ treatment: 'Debridement', resolved_on: resolved });
      await refused(c, () => update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed }, '2026-01-01T00:00:00Z'), /changed by someone else/);
      await refused(c, () => update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed }, null), /changed by someone else/);
    });
  });

  it('voids with a reason; a voided complication cannot be edited or voided again', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 3);
      const id = await record(c, site, { category: 'mechanical', type: 'screw_loosening', noticed_on: noticed });
      await refused(c, () => c.query(`select public.void_complication($1, 'x')`, [id]), /at least 3 characters/);
      await c.query(`select public.void_complication($1, 'Wrong implant')`, [id]);
      expect(await row(c, id)).toMatchObject({ voided_reason: 'Wrong implant' });
      expect((await row(c, id)).voided_at).not.toBeNull();
      const v = (await row(c, id)).updated_at;
      await refused(c, () => update(c, id, { category: 'mechanical', type: 'screw_loosening', noticed_on: noticed }, v), /Complication not found/);
      await refused(c, () => c.query(`select public.void_complication($1, 'Again please')`, [id]), /Complication not found/);
    });
  });
});

describe('complications: access and history', () => {
  it('View on Patients reads; Schedule-only users and delegates read nothing', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await record(c, site, { category: 'surgical', type: 'wound_dehiscence', noticed_on: await daysAgo(c, 50) });
      await actAs(c, users.viewer);
      expect((await c.query('select count(*)::int as n from public.implant_complications where site_id = $1', [site])).rows[0].n).toBe(1);
      await refused(c, () => c.query('delete from public.implant_complications where site_id = $1', [site]), /permission denied/);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect((await c.query('select count(*)::int as n from public.implant_complications where site_id = $1', [site])).rows[0].n).toBe(0);
      await actAs(c, users.delegate);
      expect((await c.query('select count(*)::int as n from public.implant_complications')).rows[0].n).toBe(0);
    });
  });

  it('appears in the patient History', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await record(c, site, { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 1) });
      const { rows } = await c.query('select table_name, action from public.patient_history($1)', [patient]);
      expect(rows).toEqual(expect.arrayContaining([{ table_name: 'implant_complications', action: 'INSERT' }]));
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run db:status` (start with `npm run db:start` if down), then `npm run test:db -- complications`
Expected: FAIL — `function public.record_complication(uuid, jsonb) does not exist`.

- [ ] **Step 4: Write the migration**

Create `web/supabase/migrations/0047_complications.sql`:

```sql
-- Research readiness, part 2b: complications as their own events, at any time, optionally linked to the visit
-- where they were found. Editable as they evolve (treatment, resolution); removed by voiding, never deleted.
-- Peri-implantitis and mucositis are the clinician's diagnosis; nothing here diagnoses automatically.
create table public.implant_complications (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  category text not null check (category in ('surgical', 'biological', 'mechanical')),
  type text not null,
  other_type text not null default '' check (length(other_type) <= 120),
  noticed_on date not null,
  severity text check (severity in ('mild', 'moderate', 'severe')),
  treatment text not null default '' check (length(treatment) <= 1000),
  resolved_on date check (resolved_on >= noticed_on),
  followup_id uuid references public.implant_followups (id) on delete set null,
  notes text not null default '' check (length(notes) <= 1000),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_complications_type_in_category check (
    (category = 'surgical' and type in ('intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication',
      'wound_dehiscence', 'infection', 'graft_exposure_loss', 'early_osseointegration_loss', 'other'))
    or (category = 'biological' and type in ('mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration',
      'persistent_pain', 'soft_tissue_recession', 'other'))
    or (category = 'mechanical' and type in ('implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture',
      'restoration_fracture', 'loss_of_retention', 'prosthetic_remake', 'other'))
  ),
  constraint implant_complications_other_named check (type <> 'other' or length(trim(other_type)) > 0)
);
create index implant_complications_site_idx on public.implant_complications (site_id);

create trigger implant_complications_set_updated_at before update on public.implant_complications
  for each row execute function app_private.set_updated_at();
create trigger implant_complications_audit after insert or update or delete on public.implant_complications
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_complications from public, anon, authenticated;
grant select on public.implant_complications to authenticated;
alter table public.implant_complications enable row level security;
create policy implant_complications_select on public.implant_complications for select to authenticated
  using (public.is_active_user());
create policy implant_complications_area_read on public.implant_complications as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- A date detail (YYYY-MM-DD) or null; anything else fails with the message.
create function app_private.detail_date(p jsonb, k text, message text) returns date
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app_private.fail(message); end if;
  begin
    return v::date;
  exception when others then
    perform app_private.fail(message);
  end;
  return null;
end $$;

-- Validates a complication's details for a locked, placed site and returns them as a row of the table
-- (only the detail columns are filled).
create function app_private.complication_details(v_site public.implant_sites, p jsonb)
returns public.implant_complications
language plpgsql stable set search_path = '' as $$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  r public.implant_complications;
  v_unknown text;
  v_when text := 'Enter when the complication was noticed (from the placement date to today).';
begin
  if jsonb_typeof(d) <> 'object' then perform app_private.fail('Unknown detail: (not an object).'); end if;
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(d) k
  where not (k = any (array['category', 'type', 'other_type', 'noticed_on', 'severity', 'treatment', 'resolved_on', 'followup_id', 'notes']));
  if v_unknown is not null then perform app_private.fail(format('Unknown detail: %s.', v_unknown)); end if;

  r.category := nullif(trim(d ->> 'category'), '');
  if r.category is null or r.category not in ('surgical', 'biological', 'mechanical') then
    perform app_private.fail('Choose the complication category.');
  end if;
  r.type := nullif(trim(d ->> 'type'), '');
  if r.type is null or not (r.type = any (case r.category
      when 'surgical' then array['intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication',
        'wound_dehiscence', 'infection', 'graft_exposure_loss', 'early_osseointegration_loss', 'other']
      when 'biological' then array['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration',
        'persistent_pain', 'soft_tissue_recession', 'other']
      else array['implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture', 'restoration_fracture',
        'loss_of_retention', 'prosthetic_remake', 'other'] end)) then
    perform app_private.fail('Choose the complication type.');
  end if;
  r.other_type := coalesce(trim(d ->> 'other_type'), '');
  if r.type = 'other' and r.other_type = '' then perform app_private.fail('Describe the other complication.'); end if;
  if r.type <> 'other' then r.other_type := ''; end if;

  r.noticed_on := app_private.detail_date(d, 'noticed_on', v_when);
  if r.noticed_on is null or r.noticed_on < v_site.placed_on or r.noticed_on > public.cairo_today() then
    perform app_private.fail(v_when);
  end if;
  r.resolved_on := app_private.detail_date(d, 'resolved_on',
    'The resolved date must be on or after the date noticed, and not in the future.');
  if r.resolved_on is not null and (r.resolved_on < r.noticed_on or r.resolved_on > public.cairo_today()) then
    perform app_private.fail('The resolved date must be on or after the date noticed, and not in the future.');
  end if;

  r.severity := nullif(trim(d ->> 'severity'), '');
  if r.severity is not null and r.severity not in ('mild', 'moderate', 'severe') then
    perform app_private.fail('Choose the severity from the list.');
  end if;

  if nullif(trim(d ->> 'followup_id'), '') is not null then
    if (d ->> 'followup_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app_private.fail('Choose a visit of this implant.');
    end if;
    r.followup_id := (d ->> 'followup_id')::uuid;
    if not exists (select 1 from public.implant_followups f where f.id = r.followup_id and f.site_id = v_site.id and f.voided_at is null) then
      perform app_private.fail('Choose a visit of this implant.');
    end if;
  end if;

  r.treatment := coalesce(trim(d ->> 'treatment'), '');
  r.notes := coalesce(trim(d ->> 'notes'), '');
  if length(r.other_type) > 120 or length(r.treatment) > 1000 or length(r.notes) > 1000 then
    perform app_private.fail('Keep the text shorter (other type 120, treatment and notes 1000 characters).');
  end if;
  return r;
end $$;

create function app_private.lock_complication_site(p_site uuid) returns public.implant_sites
language plpgsql set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Complications are recorded for placed implants.');
  end if;
  return v_site;
end $$;

revoke execute on function app_private.detail_date(jsonb, text, text) from public;
revoke execute on function app_private.complication_details(public.implant_sites, jsonb) from public;
revoke execute on function app_private.lock_complication_site(uuid) from public;

create function public.record_complication(p_site uuid, p_details jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  r public.implant_complications;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_complication_site(p_site);
  r := app_private.complication_details(v_site, p_details);
  insert into public.implant_complications (site_id, category, type, other_type, noticed_on, severity, treatment, resolved_on, followup_id, notes)
  values (p_site, r.category, r.type, r.other_type, r.noticed_on, r.severity, r.treatment, r.resolved_on, r.followup_id, r.notes)
  returning id into v_id;
  return v_id;
end $$;

create function public.update_complication(p_complication uuid, p_details jsonb, p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.implant_complications;
  v_site public.implant_sites;
  r public.implant_complications;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
  v_site := app_private.lock_complication_site(v_c.site_id);
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null for update;
  if not found then perform app_private.fail('Complication not found.'); end if;
  if p_expected_updated_at is null or v_c.updated_at <> p_expected_updated_at then
    perform app_private.fail('This complication was changed by someone else. Reload to see it.');
  end if;
  r := app_private.complication_details(v_site, p_details);
  update public.implant_complications
  set category = r.category, type = r.type, other_type = r.other_type, noticed_on = r.noticed_on, severity = r.severity,
      treatment = r.treatment, resolved_on = r.resolved_on, followup_id = r.followup_id, notes = r.notes
  where id = p_complication;
end $$;

create function public.void_complication(p_complication uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.implant_complications;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this complication');
  select * into v_c from public.implant_complications where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
  perform 1 from public.implant_sites where id = v_c.site_id for update;
  update public.implant_complications
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_complication and voided_at is null;
  if not found then perform app_private.fail('Complication not found.'); end if;
end $$;

revoke execute on function public.record_complication(uuid, jsonb) from public, anon;
grant execute on function public.record_complication(uuid, jsonb) to authenticated;
revoke execute on function public.update_complication(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.update_complication(uuid, jsonb, timestamptz) to authenticated;
revoke execute on function public.void_complication(uuid, text) from public, anon;
grant execute on function public.void_complication(uuid, text) to authenticated;
```

Then append redefinitions of `patient_history` and the `audit_log_area_read` policy, copied from their **latest** definitions (in `0044_implant_surgery.sql`, unless a later migration redefines them — check with `grep -n "function public.patient_history\|policy audit_log_area_read" supabase/migrations/*.sql`), each adding `'implant_complications'`: to the site-keyed `table_name in (…)` list of `patient_history`, and to the Patients-view `table_name in (…)` list of the policy (`drop policy audit_log_area_read on public.audit_log;` then `create policy …` as before). Precede them with:

```sql
-- History tab and the audit-log read rule cover complications (latest definitions: 0044).
```

In `web/tests/db/permissions.test.ts`, add `'implant_complications'` to the list of patient-area audit tables (the test the part-1 implementer updated for `implant_surgery` / `implant_grafts`).

- [ ] **Step 5: Dry-run the migration**

```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<scratchpad>/dry-run.mts" supabase/migrations/0047_complications.sql \
  "select count(*) as n from public.implant_complications"
```
Expected: `OK: migration applies`, `n` = 0. In the same dry-run, call `record_complication` on a missing site as `authenticated` (claims of the organizer test user + `set local role authenticated`, as `tests/db/helpers.ts` `actAs` does) and confirm the business error "Complications are recorded for placed implants." — not "permission denied for schema app_private".

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:db -- complications permissions research-capture visits`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0047_complications.sql tests/db/complications.test.ts tests/db/permissions.test.ts
git commit -m "feat(db): complications registry with record/update/void (0047)"
```

---

### Task 2: Migration 0048 — implant failure

**Files:**
- Create: `web/supabase/migrations/0048_implant_failure.sql`
- Create: `web/tests/db/failure.test.ts`

**Interfaces:**
- Consumes: `record_visit`, `implant_visits`, `recall_list` (2a, in `0045_visit_records.sql` / `0046_visit_status.sql`); `void_followup` (latest `0030_permissions.sql`); `app_private.detail_date` (Task 1).
- Produces (DB):
  - `implant_sites` columns `failed_on date`, `failure_type text` (`lost`/`removed`/`failed_in_place`), `failure_reason text` (`no_osseointegration`/`peri_implantitis`/`fracture`/`malposition`/`other`), `failure_notes text not null default ''`.
  - `public.record_failure(p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text) returns void`
  - `public.correct_failure(p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text, p_expected_updated_at timestamptz) returns void`
  - `record_visit` (same signature): findings may also carry `failed_on`, `failure_type`, `failure_reason`, `failure_notes`.
  - Error messages (exact): `'Failure details are recorded for placed implants.'`, `'Enter the failure date (from the placement date to today).'`, `'Choose the failure type.'`, `'Choose the failure reason.'`, `'Keep the failure notes under 1000 characters.'`, `'This implant''s failure is already recorded. Edit the failure details instead.'`, `'No failure details are recorded for this implant.'`, `'This implant was changed by someone else. Reload to see it.'`, `'Failure details are recorded only with a "failed" outcome.'`.

- [ ] **Step 1: Write the failing DB tests**

Create `web/tests/db/failure.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

// Kept local: importing another test file would register its tests here too.
async function placedSite(c: Client, daysAgo = 60, name = 'Zz Failure Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'FLR');
  const delegate = await makeDelegate(c, 'Zz Failure Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}
const daysAgo = async (c: Client, n: number) => (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;
const site = async (c: Client, id: string) =>
  (await c.query(`select state, failed_on::text, failure_type, failure_reason, failure_notes, updated_at::text as updated_at
                  from public.implant_sites where id = $1`, [id])).rows[0];
const toothStatus = async (c: Client, patient: string) =>
  (await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 46', [patient])).rows[0]?.status;
const recordFailure = (c: Client, id: string, failedOn: string | null, type: string | null, reason: string | null, notes = '') =>
  c.query('select public.record_failure($1, $2::date, $3, $4, $5)', [id, failedOn, type, reason, notes]);
const visit = (c: Client, id: string, outcome: string | null, findings: Record<string, unknown> = {}, attendance = 'attended') =>
  c.query(`select public.record_visit($1, public.cairo_today(), null, 'Review', $2, $3::public.followup_outcome, $4::jsonb, '') as id`,
    [id, attendance, outcome, JSON.stringify(findings)]);

describe('record_failure', () => {
  it('records the failure, fails the implant and the tooth', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const on = await daysAgo(c, 5);
      await recordFailure(c, s.site, on, 'removed', 'peri_implantitis', ' bone loss ');
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failed_on: on, failure_type: 'removed', failure_reason: 'peri_implantitis', failure_notes: 'bone loss' });
      expect(await toothStatus(c, s.patient)).toBe('failed');
    });
  });

  it('refuses bad dates and values; adds details to an old failure but not twice', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const before = (await c.query('select ($1::date - 1)::text as d', [s.placedOn])).rows[0].d;
      await refused(c, () => recordFailure(c, s.site, before, 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, () => recordFailure(c, s.site, '2999-01-01', 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, () => recordFailure(c, s.site, null, 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, () => recordFailure(c, s.site, await daysAgo(c, 1), 'gone', 'fracture'), /Choose the failure type/);
      await refused(c, () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'bad luck'), /Choose the failure reason/);
      // An old failure: failed through record_followup, no details yet.
      await c.query(`select public.record_followup($1, public.cairo_today(), '3-month', 'failed', '')`, [s.site]);
      expect((await site(c, s.site)).failure_type).toBeNull();
      await recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'no_osseointegration');
      await refused(c, () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'other'), /failure is already recorded/);
    });
  });

  it('needs Edit on Patients and a placed implant', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await actAs(c, users.viewer);
      await refused(c, () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'fracture'), /permission to edit Patients/);
    });
  });
});

describe('correct_failure', () => {
  it('edits recorded details with the version it read; stale or missing details are refused', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const correct = (on: string, type: string, reason: string, expected: string | null) =>
        c.query('select public.correct_failure($1, $2::date, $3, $4, $5, $6::timestamptz)', [s.site, on, type, reason, '', expected]);
      await refused(c, async () => correct(await daysAgo(c, 2), 'lost', 'fracture', (await site(c, s.site)).updated_at), /No failure details are recorded/);
      await recordFailure(c, s.site, await daysAgo(c, 5), 'removed', 'peri_implantitis');
      const v = (await site(c, s.site)).updated_at;
      const on = await daysAgo(c, 4);
      await correct(on, 'lost', 'no_osseointegration', v);
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failed_on: on, failure_type: 'lost', failure_reason: 'no_osseointegration' });
      await refused(c, () => correct(on, 'lost', 'fracture', '2026-01-01T00:00:00Z'), /changed by someone else/);
    });
  });
});

describe('failure through a visit', () => {
  it('a failed visit records visit and failure together; failed_on defaults to the visit date', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'no_osseointegration' });
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failure_type: 'lost', failed_on: await daysAgo(c, 0) });
    });
  });

  it('a failed visit without failure details records nothing', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await refused(c, () => visit(c, s.site, 'failed', { failure_type: 'lost' }), /Choose the failure reason/);
      expect((await site(c, s.site)).state).toBe('placed');
      expect((await c.query('select count(*)::int as n from public.implant_followups where site_id = $1', [s.site])).rows[0].n).toBe(0);
    });
  });

  it('refuses failure details without a failed outcome, and a second set on an already failed implant', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await refused(c, () => visit(c, s.site, 'ok', { failure_type: 'lost', failure_reason: 'fracture' }), /only with a "failed" outcome/);
      await visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'fracture' });
      await refused(c, () => visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'fracture' }), /failure is already recorded/);
      await visit(c, s.site, 'failed');
    });
  });

  it('voiding the visit that recorded the failure restores the implant and clears the details', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const id = (await visit(c, s.site, 'failed', { failure_type: 'removed', failure_reason: 'malposition' })).rows[0].id;
      await c.query(`select public.void_followup($1, 'Wrong tooth')`, [id]);
      expect(await site(c, s.site)).toMatchObject({ state: 'placed', failed_on: null, failure_type: null, failure_reason: null, failure_notes: '' });
      expect(await toothStatus(c, s.patient)).toBe('implant_placed');
    });
  });
});

describe('visits after a failure', () => {
  it('keeps visits missed before the failure, drops later ones, and keeps the implant off the recall list', async () => {
    await withTx(async (c) => {
      // Placed 120 days ago: early review (window to day 21) and osseointegration (to day 112) missed.
      const s = await placedSite(c, 120, 'Zz Failure Visits');
      await recordFailure(c, s.site, await daysAgo(c, 4), 'lost', 'no_osseointegration'); // failed on day 116
      const { rows } = await c.query('select visit_key, status from public.implant_visits($1)', [s.patient]);
      expect(rows).toEqual([{ visit_key: 'early_review', status: 'missed' }, { visit_key: 'osseointegration', status: 'missed' }]);
      expect((await c.query('select count(*)::int as n from public.recall_list() where patient_id = $1', [s.patient])).rows[0].n).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:db -- failure`
Expected: FAIL — `function public.record_failure(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `web/supabase/migrations/0048_implant_failure.sql`. It has five parts.

**Part A — columns and the shared failure helper:**

```sql
-- Research readiness, part 2b: structured implant failure. Recorded with a "failed" visit (record_visit) or, for
-- implants failed before this, with record_failure; editable with correct_failure. Early vs late is derived in
-- the app, not stored. Undoing the failed visit (void_followup) clears the details with the failure.
alter table public.implant_sites
  add column failed_on date,
  add column failure_type text check (failure_type in ('lost', 'removed', 'failed_in_place')),
  add column failure_reason text check (failure_reason in ('no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other')),
  add column failure_notes text not null default '' check (length(failure_notes) <= 1000);

-- Validates and writes failure details on a locked site, failing the implant and the tooth.
create function app_private.apply_failure(v_site public.implant_sites, p_failed_on date, p_type text, p_reason text, p_notes text)
returns void
language plpgsql set search_path = '' as $$
begin
  if p_failed_on is null or p_failed_on < v_site.placed_on or p_failed_on > public.cairo_today() then
    perform app_private.fail('Enter the failure date (from the placement date to today).');
  end if;
  if p_type is null or p_type not in ('lost', 'removed', 'failed_in_place') then
    perform app_private.fail('Choose the failure type.');
  end if;
  if p_reason is null or p_reason not in ('no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other') then
    perform app_private.fail('Choose the failure reason.');
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    perform app_private.fail('Keep the failure notes under 1000 characters.');
  end if;
  update public.implant_sites
  set state = 'failed', failed_on = p_failed_on, failure_type = p_type, failure_reason = p_reason,
      failure_notes = coalesce(trim(p_notes), '')
  where id = v_site.id;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
end $$;
revoke execute on function app_private.apply_failure(public.implant_sites, date, text, text, text) from public;
```

**Part B — `record_failure` and `correct_failure`:**

```sql
create function public.record_failure(p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Failure details are recorded for placed implants.');
  end if;
  if v_site.failure_type is not null then
    perform app_private.fail('This implant''s failure is already recorded. Edit the failure details instead.');
  end if;
  perform app_private.apply_failure(v_site, p_failed_on, p_type, p_reason, p_notes);
end $$;

create function public.correct_failure(
  p_site uuid, p_failed_on date, p_type text, p_reason text, p_notes text, p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.failure_type is null then
    perform app_private.fail('No failure details are recorded for this implant.');
  end if;
  if p_expected_updated_at is null or v_site.updated_at <> p_expected_updated_at then
    perform app_private.fail('This implant was changed by someone else. Reload to see it.');
  end if;
  perform app_private.apply_failure(v_site, p_failed_on, p_type, p_reason, p_notes);
end $$;

revoke execute on function public.record_failure(uuid, date, text, text, text) from public, anon;
grant execute on function public.record_failure(uuid, date, text, text, text) to authenticated;
revoke execute on function public.correct_failure(uuid, date, text, text, text, timestamptz) from public, anon;
grant execute on function public.correct_failure(uuid, date, text, text, text, timestamptz) to authenticated;
```

**Part C — `record_visit` (`create or replace`, same signature).** Copy the latest definition (from `0045_visit_records.sql`, unless a later migration redefines it) and make exactly these changes:
1. Add to the `declare` block: `c_failure_keys constant text[] := array['failed_on', 'failure_type', 'failure_reason', 'failure_notes'];` and `v_has_failure boolean;`.
2. In the unknown-key check, accept the failure keys too: `where not (k = any (c_keys || c_failure_keys))`.
3. Right after that unknown-key check, add:
   ```sql
   v_has_failure := exists (select 1 from jsonb_each_text(v_f) e where e.key = any (c_failure_keys) and nullif(trim(e.value), '') is not null);
   if v_has_failure and p_outcome is distinct from 'failed' then
     perform app_private.fail('Failure details are recorded only with a "failed" outcome.');
   end if;
   if v_has_failure and v_site.failure_type is not null then
     perform app_private.fail('This implant''s failure is already recorded. Edit the failure details instead.');
   end if;
   ```
   (The existing "findings only when attended" check still applies to these keys, since a not-attended visit has no outcome.)
4. Replace the final block

   ```sql
   if p_outcome = 'failed' and v_site.state <> 'failed' then
     update public.implant_sites set state = 'failed' where id = p_site;
     perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
   end if;
   ```
   with
   ```sql
   if p_outcome = 'failed' and v_site.state <> 'failed' then
     -- The failure details arrive with the visit; a failed visit on a working implant must carry them.
     perform app_private.apply_failure(v_site,
       coalesce(app_private.detail_date(v_f, 'failed_on', 'Enter the failure date (from the placement date to today).'), p_date),
       nullif(trim(v_f ->> 'failure_type'), ''), nullif(trim(v_f ->> 'failure_reason'), ''), coalesce(v_f ->> 'failure_notes', ''));
   end if;
   ```
   (`apply_failure` refuses missing type/reason; the whole call — visit row included — rolls back.)

**Part D — `void_followup` (`create or replace`, same signature).** Copy the latest definition (`0030_permissions.sql`, the block after the comment `-- void_followup: latest 0015_corrections.sql:93 …`; check no later migration redefines it) and change exactly one line: `update public.implant_sites set state = v_state where id = v_site.id;` becomes

```sql
    update public.implant_sites
    set state = v_state, failed_on = null, failure_type = null, failure_reason = null, failure_notes = ''
    where id = v_site.id;
```

**Part E — `implant_visits` and `recall_list` (`create or replace`, same signatures).** Copy the latest definitions (`0046_visit_status.sql`) and change:
- in `implant_visits`, the condition `and (s.state in ('placed', 'restored') or f.id is not null)` becomes
  ```sql
      and (s.state in ('placed', 'restored') or f.id is not null
           -- A failed implant keeps the visits whose window closed before it failed.
           or (s.failed_on is not null and s.placed_on + v.window_end < s.failed_on))
  ```
- in `recall_list`, the condition `and exists (select 1 from public.implant_sites s where s.patient_id = p.id and s.state in ('placed', 'restored'))` becomes
  ```sql
      and exists (select 1 from public.implant_sites s where s.id = v.site_id and s.state in ('placed', 'restored'))
  ```

- [ ] **Step 4: Dry-run the migration**

```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<scratchpad>/dry-run.mts" supabase/migrations/0048_implant_failure.sql \
  "select count(*) filter (where failure_type is not null) as n from public.implant_sites"
```
Expected: `OK: migration applies`, `n` = 0. Also call `record_failure` on a missing site as `authenticated` (as in Task 1) and confirm the business error, not "permission denied for schema app_private".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:db -- failure visits complications corrections implants permissions`
Expected: PASS (2a's visit tests and the existing corrections/void tests must stay green).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0048_implant_failure.sql tests/db/failure.test.ts
git commit -m "feat(db): structured implant failure; failed visits carry details; visits end at failure (0048)"
```

---

### Task 3: Complication and failure rules in TypeScript

**Files:**
- Create: `web/src/lib/implants/complications.ts`, `web/src/lib/implants/complications.test.ts`, `web/src/lib/implants/failure.ts`, `web/src/lib/implants/failure.test.ts`
- Modify: `web/src/lib/visits/visits.ts` (failure fields in `visitSchema` / `toFindings`), `web/src/lib/visits/visits.test.ts`

**Interfaces:**
- Consumes: `isRealDate`, `todayIso`; `formatDate`; `visitSchema`, `toFindings` (2a); `ImplantSite['components']` shape (`component_type`, `fitted_on`, `voided_at`).
- Produces:
  - `complications.ts`: `COMPLICATION_CATEGORIES`, `type ComplicationCategory`, `CATEGORY_LABELS`, `COMPLICATION_TYPES: Record<ComplicationCategory, readonly string[]>`, `TYPE_LABELS: Record<string, string>`, `SEVERITIES`, `SEVERITY_LABELS`, `CASE_DEFINITIONS: Partial<Record<string, string>>` (keys `mucositis`, `peri_implantitis`), `type ImplantComplication`, `isOpen(c)`, `describeComplication(c)`, `openComplicationTeeth(sites)`, `complicationSchema`, `toDetails(v)`.
  - `failure.ts`: `FAILURE_TYPES`, `FAILURE_TYPE_LABELS`, `FAILURE_REASONS`, `FAILURE_REASON_LABELS`, `failureTiming(site): 'early' | 'late' | null`, `describeFailure(site): string`, `failureSchema`.
  - `visitSchema` gains `needsFailure`, `failedOn`, `failureType`, `failureReason`, `failureNotes`; `toFindings` adds `failed_on`, `failure_type`, `failure_reason`, `failure_notes` when given.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/implants/complications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  COMPLICATION_TYPES, complicationSchema, describeComplication, isOpen, openComplicationTeeth, toDetails, type ImplantComplication,
} from './complications';

const base: ImplantComplication = {
  id: 'c1', site_id: 's1', category: 'biological', type: 'peri_implantitis', other_type: '', noticed_on: '2026-09-01', severity: 'moderate',
  treatment: 'Debridement', resolved_on: null, followup_id: null, notes: '', voided_at: null, voided_reason: '', updated_at: '2026-09-01T10:00:00Z',
};
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

describe('complications', () => {
  it('lists types per category, each with "other" last', () => {
    expect(COMPLICATION_TYPES.biological).toEqual(['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration', 'persistent_pain', 'soft_tissue_recession', 'other']);
    expect(COMPLICATION_TYPES.surgical.at(-1)).toBe('other');
    expect(COMPLICATION_TYPES.mechanical).toContain('screw_loosening');
  });
  it('is open until resolved; voided ones are neither open nor counted', () => {
    expect(isOpen(base)).toBe(true);
    expect(isOpen({ ...base, resolved_on: '2026-09-20' })).toBe(false);
    expect(isOpen({ ...base, voided_at: '2026-09-02T00:00:00Z' })).toBe(false);
  });
  it('describes a complication', () => {
    expect(describeComplication(base)).toMatch(/^Peri-implantitis · Moderate · noticed .+ · Debridement$/);
    expect(describeComplication({ ...base, type: 'other', other_type: 'Haematoma', severity: null, treatment: '' })).toMatch(/^Other: Haematoma · noticed /);
  });
  it('finds the teeth with an open complication', () => {
    const sites = [
      { tooth: 46, complications: [base] }, { tooth: 36, complications: [{ ...base, resolved_on: '2026-09-02' }] }, { tooth: 11, complications: [] },
    ];
    expect(openComplicationTeeth(sites)).toEqual({ 46: true });
  });
});

describe('complicationSchema', () => {
  const ok = { ...ids, complicationId: '', expectedUpdatedAt: '', category: 'mechanical', type: 'screw_loosening', otherType: '', noticedOn: '2026-09-01' };
  it('parses a complication; blank = not recorded', () => {
    expect(complicationSchema.parse({ ...ok, severity: '', treatment: ' Retightened ', resolvedOn: '', followupId: '', notes: '' })).toMatchObject({
      ...ok, complicationId: null, expectedUpdatedAt: null, severity: null, treatment: 'Retightened', resolvedOn: null, followupId: null,
    });
  });
  it('refuses a type from another category, other without text, and a resolved date before noticed', () => {
    expect(firstError(complicationSchema.safeParse({ ...ok, type: 'mucositis' }))).toBe('Choose the complication type.');
    expect(firstError(complicationSchema.safeParse({ ...ok, type: 'other' }))).toBe('Describe the other complication.');
    expect(firstError(complicationSchema.safeParse({ ...ok, resolvedOn: '2026-08-01' }))).toBe('The resolved date must be on or after the date noticed, and not in the future.');
    expect(firstError(complicationSchema.safeParse({ ...ok, noticedOn: '2999-01-01' }))).toBe('Enter when the complication was noticed (today or earlier).');
    expect(firstError(complicationSchema.safeParse({ ...ok, category: '' }))).toBe('Choose the complication category.');
  });
  it('turns the form into the database details', () => {
    const v = complicationSchema.parse({ ...ok, severity: 'mild', resolvedOn: '2026-09-05', followupId: '00000000-0000-4000-8000-000000000009' });
    expect(toDetails(v)).toEqual({
      category: 'mechanical', type: 'screw_loosening', other_type: '', noticed_on: '2026-09-01', severity: 'mild', treatment: '',
      resolved_on: '2026-09-05', followup_id: '00000000-0000-4000-8000-000000000009', notes: '',
    });
  });
});
```

Create `web/src/lib/implants/failure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeFailure, failureSchema, failureTiming } from './failure';

const site = (failed_on: string | null, components: { component_type: string; fitted_on: string; voided_at: string | null }[] = []) =>
  ({ failed_on, failure_type: 'removed', failure_reason: 'peri_implantitis', failure_notes: '', components }) as never;

describe('failure', () => {
  it('is early before the first abutment-level component, late from then on', () => {
    expect(failureTiming(site(null))).toBeNull();
    expect(failureTiming(site('2026-05-01'))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'healing_abutment', fitted_on: '2026-03-01', voided_at: null }]))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'ti_base', fitted_on: '2026-04-01', voided_at: null }]))).toBe('late');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'abutment', fitted_on: '2026-04-01', voided_at: '2026-04-02T00:00:00Z' }]))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'final_restoration', fitted_on: '2026-05-01', voided_at: null }]))).toBe('late');
  });
  it('describes a failure', () => {
    expect(describeFailure(site('2026-05-01'))).toMatch(/^Removed · Peri-implantitis · .+ · early$/);
  });
  it('parses the failure form', () => {
    const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
    expect(failureSchema.parse({ ...ids, expectedUpdatedAt: '', failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' }))
      .toEqual({ ...ids, expectedUpdatedAt: null, failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' });
    expect(failureSchema.safeParse({ ...ids, failedOn: '2026-05-01', failureType: '', failureReason: 'fracture' }).error?.issues[0].message)
      .toBe('Choose the failure type.');
  });
});
```

Add to `web/src/lib/visits/visits.test.ts`:

```ts
describe('visitSchema: failure', () => {
  const failedVisit = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002',
    date: '2026-05-01', visitKey: '', checkType: 'Mobile', attendance: 'attended', outcome: 'failed', needsFailure: '1' };
  it('needs the failure type and reason when a working implant fails', () => {
    expect(visitSchema.safeParse({ ...failedVisit, failureReason: 'fracture' }).error?.issues[0].message).toBe('Choose the failure type.');
    expect(visitSchema.safeParse({ ...failedVisit, failureType: 'lost' }).error?.issues[0].message).toBe('Choose the failure reason.');
  });
  it('sends the failure with the findings, and nothing when the outcome is not failed', () => {
    const v = visitSchema.parse({ ...failedVisit, failureType: 'lost', failureReason: 'fracture', failedOn: '2026-04-30', failureNotes: ' cracked ' });
    expect(toFindings(v)).toEqual({ failed_on: '2026-04-30', failure_type: 'lost', failure_reason: 'fracture', failure_notes: 'cracked' });
    const ok = visitSchema.parse({ ...failedVisit, outcome: 'ok', failureType: 'lost', failureReason: 'fracture' });
    expect(toFindings(ok)).toEqual({});
  });
  it('asks for nothing when the implant has already failed', () => {
    expect(visitSchema.safeParse({ ...failedVisit, needsFailure: '' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- implants/complications implants/failure visits/visits`
Expected: FAIL — modules missing; the visit failure tests fail.

- [ ] **Step 3: Implement**

Create `web/src/lib/implants/complications.ts`:

```ts
import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';

export const COMPLICATION_CATEGORIES = ['surgical', 'biological', 'mechanical'] as const;
export type ComplicationCategory = (typeof COMPLICATION_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ComplicationCategory, string> = {
  surgical: 'Surgical', biological: 'Biological', mechanical: 'Mechanical / prosthetic',
};

export const COMPLICATION_TYPES: Record<ComplicationCategory, readonly string[]> = {
  surgical: ['intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication', 'wound_dehiscence', 'infection',
    'graft_exposure_loss', 'early_osseointegration_loss', 'other'],
  biological: ['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration', 'persistent_pain', 'soft_tissue_recession', 'other'],
  mechanical: ['implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture', 'restoration_fracture',
    'loss_of_retention', 'prosthetic_remake', 'other'],
};
export const TYPE_LABELS: Record<string, string> = {
  intraoperative_injury: 'Intraoperative injury', haemorrhage: 'Haemorrhage', nerve_symptoms: 'Nerve symptoms',
  sinus_complication: 'Sinus complication', wound_dehiscence: 'Wound dehiscence', infection: 'Infection',
  graft_exposure_loss: 'Graft exposure / loss', early_osseointegration_loss: 'Early loss of osseointegration',
  mucositis: 'Peri-implant mucositis', peri_implantitis: 'Peri-implantitis', progressive_bone_loss: 'Progressive bone loss',
  suppuration: 'Suppuration', persistent_pain: 'Persistent pain', soft_tissue_recession: 'Soft-tissue recession',
  implant_fracture: 'Implant fracture', abutment_fracture: 'Abutment fracture', screw_loosening: 'Screw loosening',
  screw_fracture: 'Screw fracture', restoration_fracture: 'Restoration fracture / chipping', loss_of_retention: 'Loss of retention',
  prosthetic_remake: 'Prosthetic remake', other: 'Other',
};

export const SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

/** 2017 World Workshop case definitions, shown as guidance only. */
export const CASE_DEFINITIONS: Partial<Record<string, string>> = {
  mucositis: 'Bleeding and/or suppuration on gentle probing, with or without increased probing depth, and no bone loss beyond initial bone remodelling.',
  peri_implantitis: 'Bleeding and/or suppuration on gentle probing, increased probing depth compared with previous examinations, and bone loss beyond initial bone remodelling. Without previous data: probing depth ≥ 6 mm with bleeding, and bone level ≥ 3 mm apical to the most coronal part of the intraosseous implant.',
};

export type ImplantComplication = {
  id: string;
  site_id: string;
  category: ComplicationCategory;
  type: string;
  other_type: string;
  noticed_on: string;
  severity: Severity | null;
  treatment: string;
  resolved_on: string | null;
  followup_id: string | null;
  notes: string;
  voided_at: string | null;
  voided_reason: string;
  updated_at: string;
};

export const isOpen = (c: ImplantComplication) => !c.voided_at && c.resolved_on === null;

export function describeComplication(c: ImplantComplication): string {
  return [
    c.type === 'other' ? `Other: ${c.other_type}` : TYPE_LABELS[c.type] ?? c.type,
    c.severity ? SEVERITY_LABELS[c.severity] : null,
    `noticed ${formatDate(c.noticed_on)}`,
    c.resolved_on ? `resolved ${formatDate(c.resolved_on)}` : null,
    c.treatment || null,
  ].filter(Boolean).join(' · ');
}

export function openComplicationTeeth(sites: readonly { tooth: number; complications: readonly ImplantComplication[] }[]): Partial<Record<number, boolean>> {
  const teeth: Partial<Record<number, boolean>> = {};
  for (const s of sites) if (s.complications.some(isOpen)) teeth[s.tooth] = true;
  return teeth;
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const RESOLVED = 'The resolved date must be on or after the date noticed, and not in the future.';

export const complicationSchema = z
  .object({
    complicationId: z.preprocess(blankToNull, z.string().uuid().nullable()),
    expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
    siteId: z.string().uuid({ message: 'Implant not found.' }),
    patientId: z.string().uuid({ message: 'Patient not found.' }),
    category: z.enum(COMPLICATION_CATEGORIES, { message: 'Choose the complication category.' }),
    type: z.string().min(1, { message: 'Choose the complication type.' }),
    otherType: z.string().trim().max(120, { message: 'Keep the description under 120 characters.' }).default(''),
    noticedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter when the complication was noticed (today or earlier).' }),
    severity: z.preprocess(blankToNull, z.enum(SEVERITIES, { message: 'Choose the severity from the list.' }).nullable()),
    treatment: z.string().trim().max(1000, { message: 'Keep the treatment under 1000 characters.' }).default(''),
    resolvedOn: z.preprocess(blankToNull, z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: RESOLVED }).nullable()),
    followupId: z.preprocess(blankToNull, z.string().uuid({ message: 'Choose a visit of this implant.' }).nullable()),
    notes: z.string().trim().max(1000, { message: 'Keep the notes under 1000 characters.' }).default(''),
  })
  .superRefine((v, ctx) => {
    if (!COMPLICATION_TYPES[v.category].includes(v.type)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Choose the complication type.' });
    } else if (v.type === 'other' && !v.otherType) {
      ctx.addIssue({ code: 'custom', path: ['otherType'], message: 'Describe the other complication.' });
    }
    if (v.resolvedOn && v.resolvedOn < v.noticedOn) ctx.addIssue({ code: 'custom', path: ['resolvedOn'], message: RESOLVED });
  });

export type ComplicationInput = z.output<typeof complicationSchema>;

export function toDetails(v: ComplicationInput) {
  return {
    category: v.category, type: v.type, other_type: v.type === 'other' ? v.otherType : '', noticed_on: v.noticedOn,
    severity: v.severity, treatment: v.treatment, resolved_on: v.resolvedOn, followup_id: v.followupId, notes: v.notes,
  };
}
```

Create `web/src/lib/implants/failure.ts`:

```ts
import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';

export const FAILURE_TYPES = ['lost', 'removed', 'failed_in_place'] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];
export const FAILURE_TYPE_LABELS: Record<FailureType, string> = { lost: 'Lost', removed: 'Removed', failed_in_place: 'Failed in place' };

export const FAILURE_REASONS = ['no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  no_osseointegration: 'No osseointegration', peri_implantitis: 'Peri-implantitis', fracture: 'Fracture', malposition: 'Malposition', other: 'Other',
};

/** Components at abutment level or beyond: a failure after the first of these is late. */
const ABUTMENT_LEVEL = ['ti_base', 'multi_unit', 'abutment', 'final_restoration'];

type FailureSite = {
  failed_on: string | null;
  failure_type: FailureType | null;
  failure_reason: FailureReason | null;
  failure_notes: string;
  components: readonly { component_type: string; fitted_on: string; voided_at: string | null }[];
};

export function failureTiming(site: FailureSite): 'early' | 'late' | null {
  if (!site.failed_on) return null;
  const first = site.components
    .filter((c) => !c.voided_at && ABUTMENT_LEVEL.includes(c.component_type))
    .map((c) => c.fitted_on)
    .sort()[0];
  return first !== undefined && first <= site.failed_on ? 'late' : 'early';
}

export function describeFailure(site: FailureSite): string {
  return [
    site.failure_type ? FAILURE_TYPE_LABELS[site.failure_type] : null,
    site.failure_reason ? FAILURE_REASON_LABELS[site.failure_reason] : null,
    site.failed_on ? formatDate(site.failed_on) : null,
    failureTiming(site),
  ].filter(Boolean).join(' · ');
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);

export const failureSchema = z.object({
  siteId: z.string().uuid({ message: 'Implant not found.' }),
  patientId: z.string().uuid({ message: 'Patient not found.' }),
  expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
  failedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the failure date (today or earlier).' }),
  failureType: z.enum(FAILURE_TYPES, { message: 'Choose the failure type.' }),
  failureReason: z.enum(FAILURE_REASONS, { message: 'Choose the failure reason.' }),
  failureNotes: z.string().trim().max(1000, { message: 'Keep the failure notes under 1000 characters.' }).default(''),
});
```

In `web/src/lib/visits/visits.ts`:
- import `{ FAILURE_REASONS, FAILURE_TYPES }` from `@/lib/implants/failure`.
- add to the `visitSchema` object:
  ```ts
    needsFailure: z.preprocess((v) => v === '1' || v === true, z.boolean()).default(false),
    failedOn: z.preprocess(blankToNull, z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the failure date (today or earlier).' }).nullable()),
    failureType: choice(FAILURE_TYPES, 'Choose the failure type.'),
    failureReason: choice(FAILURE_REASONS, 'Choose the failure reason.'),
    failureNotes: text(1000),
  ```
- add to `superRefine`:
  ```ts
    if (v.attendance === 'attended' && v.outcome === 'failed' && v.needsFailure) {
      if (!v.failureType) ctx.addIssue({ code: 'custom', path: ['failureType'], message: 'Choose the failure type.' });
      else if (!v.failureReason) ctx.addIssue({ code: 'custom', path: ['failureReason'], message: 'Choose the failure reason.' });
    }
  ```
- in `transform`, clear the failure fields unless this is an attended failed visit on a working implant: at the start of the transform body add
  ```ts
    const failing = v.attendance === 'attended' && v.outcome === 'failed' && v.needsFailure;
    if (!failing) v = { ...v, failedOn: null, failureType: null, failureReason: null, failureNotes: '' };
  ```
  (change the transform's parameter to `(input) => { let v = input; … }` so it can be reassigned).
- in `toFindings`, add `failed_on: v.failedOn, failure_type: v.failureType, failure_reason: v.failureReason, failure_notes: v.failureNotes` to `all`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- implants/complications implants/failure visits` → PASS. `npx tsc --noEmit`, `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/implants src/lib/visits
git commit -m "feat(implants): complication and failure rules; failure details in the visit schema"
```

---

### Task 4: Data, actions and History

**Files:**
- Create: `web/src/app/(app)/patients/[id]/outcome-actions.ts`, `web/src/app/(app)/patients/[id]/outcome-actions.test.ts`
- Modify: `web/src/lib/inventory/types.ts` (`ImplantSite`), `web/src/app/(app)/patients/[id]/chart-data.ts` (`SITE_SELECT`, `sortSite`), `web/src/lib/patients/history.ts`, `web/src/lib/patients/history.test.ts`

**Interfaces:**
- Consumes: `complicationSchema`, `toDetails`, `ImplantComplication`, `TYPE_LABELS` (Task 3); `failureSchema`, `FAILURE_TYPE_LABELS`, `FAILURE_REASON_LABELS`, `FailureType`, `FailureReason` (Task 3); DB functions (Tasks 1–2).
- Produces:
  - `ImplantSite` gains `updated_at: string; failed_on: string | null; failure_type: FailureType | null; failure_reason: FailureReason | null; failure_notes: string; complications: ImplantComplication[]`.
  - Server actions (each `Promise<{ error?: string }>`): `saveComplication(input)` (records when `complicationId` is empty, otherwise updates), `voidComplication(input: { patientId: string; complicationId: string; reason: string })`, `saveFailure(input)` (records when `expectedUpdatedAt` is empty — no details yet — otherwise corrects).
  - History lines: `Complication recorded: <type>`, `Complication resolved: <type>`, `Complication updated: <type>`, `Complication removed from the record: <type> (<reason>)`; `Implant on tooth N: failure recorded — <Type> (<Reason>)`; `Implant on tooth N: failure details corrected: <fields>`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/(app)/patients/[id]/outcome-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { saveComplication, saveFailure, voidComplication } from './outcome-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
const comp = { ...ids, category: 'biological', type: 'mucositis', otherType: '', noticedOn: '2026-09-01', severity: '', treatment: '', resolvedOn: '', followupId: '', notes: '' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('outcome actions', () => {
  it('records a new complication, updates an existing one with its version', async () => {
    await saveComplication({ ...comp, complicationId: '', expectedUpdatedAt: '' });
    expect(rpc).toHaveBeenCalledWith('record_complication', { p_site: ids.siteId, p_details: expect.objectContaining({ category: 'biological', type: 'mucositis', severity: null }) });
    const id = '00000000-0000-4000-8000-000000000009';
    await saveComplication({ ...comp, complicationId: id, expectedUpdatedAt: '2026-09-01T10:00:00.5+00:00', resolvedOn: '2026-09-10' });
    expect(rpc).toHaveBeenLastCalledWith('update_complication', {
      p_complication: id, p_details: expect.objectContaining({ resolved_on: '2026-09-10' }), p_expected_updated_at: '2026-09-01T10:00:00.5+00:00',
    });
  });

  it('voids a complication with a reason', async () => {
    await voidComplication({ patientId: ids.patientId, complicationId: '00000000-0000-4000-8000-000000000009', reason: 'Wrong tooth' });
    expect(rpc).toHaveBeenCalledWith('void_complication', { p_complication: '00000000-0000-4000-8000-000000000009', p_reason: 'Wrong tooth' });
  });

  it('records failure details when none exist, corrects them otherwise', async () => {
    const f = { ...ids, failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' };
    await saveFailure({ ...f, expectedUpdatedAt: '' });
    expect(rpc).toHaveBeenCalledWith('record_failure', { p_site: ids.siteId, p_failed_on: '2026-05-01', p_type: 'lost', p_reason: 'fracture', p_notes: '' });
    await saveFailure({ ...f, expectedUpdatedAt: '2026-05-02T00:00:00Z' });
    expect(rpc).toHaveBeenLastCalledWith('correct_failure', {
      p_site: ids.siteId, p_failed_on: '2026-05-01', p_type: 'lost', p_reason: 'fracture', p_notes: '', p_expected_updated_at: '2026-05-02T00:00:00Z',
    });
  });

  it('shows business errors verbatim and validates before calling the database', async () => {
    rpc.mockResolvedValue({ error: { message: 'This complication was changed by someone else. Reload to see it.', hint: 'user' } });
    expect(await saveComplication({ ...comp, complicationId: '00000000-0000-4000-8000-000000000009', expectedUpdatedAt: 'x' }))
      .toEqual({ error: 'This complication was changed by someone else. Reload to see it.' });
    rpc.mockClear();
    expect(await saveComplication({ ...comp, type: 'screw_loosening' })).toEqual({ error: 'Choose the complication type.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

Add to `web/src/lib/patients/history.test.ts`:

```ts
describe('describeChange: complications and failure', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A' };
  it('describes complications', () => {
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'INSERT', before: null, after: { type: 'peri_implantitis', resolved_on: null } }))
      .toBe('Complication recorded: Peri-implantitis');
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'UPDATE',
      before: { type: 'peri_implantitis', resolved_on: null, voided_at: null }, after: { type: 'peri_implantitis', resolved_on: '2026-10-01', voided_at: null } }))
      .toBe('Complication resolved: Peri-implantitis');
    expect(describeChange({ ...base, table_name: 'implant_complications', action: 'UPDATE',
      before: { type: 'infection', voided_at: null }, after: { type: 'infection', voided_at: '2026-10-02', voided_reason: 'Wrong tooth' } }))
      .toBe('Complication removed from the record: Infection (Wrong tooth)');
  });
  it('describes failure details on the implant', () => {
    expect(describeChange({ ...base, table_name: 'implant_sites', action: 'UPDATE',
      before: { tooth: 46, state: 'placed', failure_type: null }, after: { tooth: 46, state: 'failed', failure_type: 'removed', failure_reason: 'peri_implantitis' } }))
      .toBe('Implant on tooth 46: failure recorded — Removed (Peri-implantitis)');
    expect(describeChange({ ...base, table_name: 'implant_sites', action: 'UPDATE',
      before: { tooth: 46, state: 'failed', failure_type: 'removed', failed_on: '2026-05-01', failure_reason: 'fracture' },
      after: { tooth: 46, state: 'failed', failure_type: 'lost', failed_on: '2026-05-01', failure_reason: 'fracture' } }))
      .toBe('Implant on tooth 46: failure details corrected: failure type');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- outcome-actions history` → FAIL.

- [ ] **Step 3: Implement**

Create `web/src/app/(app)/patients/[id]/outcome-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { complicationSchema, toDetails } from '@/lib/implants/complications';
import { failureSchema } from '@/lib/implants/failure';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function saveComplication(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = complicationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return v.complicationId
    ? run(v.patientId, 'update_complication', { p_complication: v.complicationId, p_details: toDetails(v), p_expected_updated_at: v.expectedUpdatedAt })
    : run(v.patientId, 'record_complication', { p_site: v.siteId, p_details: toDetails(v) });
}

export async function voidComplication(input: { patientId: string; complicationId: string; reason: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'void_complication', { p_complication: input.complicationId, p_reason: input.reason });
}

export async function saveFailure(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = failureSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  const fields = { p_site: f.siteId, p_failed_on: f.failedOn, p_type: f.failureType, p_reason: f.failureReason, p_notes: f.failureNotes };
  return f.expectedUpdatedAt
    ? run(f.patientId, 'correct_failure', { ...fields, p_expected_updated_at: f.expectedUpdatedAt })
    : run(f.patientId, 'record_failure', fields);
}
```

In `web/src/lib/inventory/types.ts`, import `type ImplantComplication` from `@/lib/implants/complications` and `type FailureReason, type FailureType` from `@/lib/implants/failure`, and add to `ImplantSite`: `updated_at: string; failed_on: string | null; failure_type: FailureType | null; failure_reason: FailureReason | null; failure_notes: string; complications: ImplantComplication[];`.

In `web/src/app/(app)/patients/[id]/chart-data.ts`: add `updated_at, failed_on, failure_type, failure_reason, failure_notes,` to the first line of `SITE_SELECT` (after `created_at,`) and `complications:implant_complications(*),` before `slot:`; in `sortSite` add
```ts
    complications: [...(site.complications ?? [])].sort((a, b) => (a.noticed_on < b.noticed_on ? 1 : a.noticed_on > b.noticed_on ? -1 : 0)),
```

In `web/src/lib/patients/history.ts`:
- import `TYPE_LABELS` from `@/lib/implants/complications` and `FAILURE_REASON_LABELS`, `FAILURE_TYPE_LABELS`, `type FailureReason`, `type FailureType` from `@/lib/implants/failure`.
- add `const FAILURE_FIELD_LABELS: Record<string, string> = { failed_on: 'failure date', failure_type: 'failure type', failure_reason: 'failure reason', failure_notes: 'failure notes' };`
- in `case 'implant_sites'`, right after the `INSERT` line, add:
  ```ts
      if (e.after?.failure_type && !e.before.failure_type) {
        const type = FAILURE_TYPE_LABELS[e.after.failure_type as FailureType] ?? String(e.after.failure_type);
        const reason = FAILURE_REASON_LABELS[e.after.failure_reason as FailureReason] ?? String(e.after.failure_reason);
        return `Implant on tooth ${tooth}: failure recorded — ${type} (${reason})`;
      }
      if (e.after?.failure_type && e.before.failure_type) {
        const corrected = changedFields(e.before, e.after, FAILURE_FIELD_LABELS);
        if (corrected.length) return `Implant on tooth ${tooth}: failure details corrected: ${corrected.join(', ')}`;
      }
  ```
- add before `default:`:
  ```ts
    case 'implant_complications': {
      const row = e.after ?? e.before;
      const label = row?.type === 'other' && row?.other_type ? `Other: ${row.other_type}` : TYPE_LABELS[row?.type as string] ?? String(row?.type);
      if (e.action === 'INSERT') return `Complication recorded: ${label}`;
      if (e.after?.voided_at && !e.before?.voided_at) return `Complication removed from the record: ${label} (${e.after.voided_reason})`;
      if (e.after?.resolved_on && !e.before?.resolved_on) return `Complication resolved: ${label}`;
      return `Complication updated: ${label}`;
    }
  ```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- outcome-actions history chart-panel visits surgical-details corrections components` → PASS. `npx tsc --noEmit` → clean (add `complications: [], updated_at: …, failed_on: null, failure_type: null, failure_reason: null, failure_notes: ''` to fixtures typed as `ImplantSite` without `as unknown as`, where tsc asks).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/patients/[id]" src/lib/inventory/types.ts src/lib/patients/history.ts src/lib/patients/history.test.ts
git commit -m "feat(implants): complication and failure actions; failure and complications on the site; History lines"
```

---

### Task 5: Complications block, failure box and failed visits

**Files:**
- Create: `web/src/app/(app)/patients/[id]/complications.tsx`, `web/src/app/(app)/patients/[id]/complications.test.tsx`, `web/src/app/(app)/patients/[id]/failure-box.tsx`, `web/src/app/(app)/patients/[id]/failure-box.test.tsx`
- Modify: `web/src/app/(app)/patients/[id]/implant-section.tsx` (render both in `SiteDetails`), `web/src/app/(app)/patients/[id]/visits.tsx` (failure fields in `RecordVisitForm`), `web/src/app/(app)/patients/[id]/visits.test.tsx`

**Interfaces:**
- Consumes: `saveComplication`, `voidComplication`, `saveFailure` (Task 4); Task 3 helpers; `Field`, `Footer`, `useSubmit` from `implant-forms.tsx`.
- Produces:
  - `Complications({ site, patientId, editable })` — `<div data-testid="complications">` with heading "Complications", open items first (`badge badge-bad` "Open"), resolved muted (`badge` "Resolved"); buttons "Add complication", per item "Edit complication", "Remove from record" (reveals "Reason for removing" input and "Remove complication" button). Form controls: "Category", "Type", "Describe" (type other only), "Noticed on", "Severity", "Treatment", "Resolved on", "Found at visit", "Notes"; save "Save complication". The case definition shows under the Type select for mucositis / peri-implantitis.
  - `FailureBox({ site, patientId, editable })` — on a failed site, `<div data-testid="failure">` with heading "Failure", `describeFailure(site)` or "Failure details not recorded."; button "Add failure details" (no details) or "Edit failure details"; form controls "Failure date", "Failure type", "Failure reason", "Failure notes"; save "Save failure details".
  - `RecordVisitForm`: when outcome is "failed" and the implant isn't failed yet, shows "Failure date" (defaults to the visit date), "Failure type", "Failure reason", "Failure notes", and sends `needsFailure: '1'`.

- [ ] **Step 1: Write the failing component tests**

Create `web/src/app/(app)/patients/[id]/complications.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';
import type { ImplantComplication } from '@/lib/implants/complications';

vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
import { Complications } from './complications';
import { saveComplication, voidComplication } from './outcome-actions';

const open: ImplantComplication = {
  id: 'c1', site_id: 's1', category: 'biological', type: 'peri_implantitis', other_type: '', noticed_on: '2026-09-01', severity: 'moderate',
  treatment: '', resolved_on: null, followup_id: null, notes: '', voided_at: null, voided_reason: '', updated_at: '2026-09-01T10:00:00.5+00:00',
};
const resolved = { ...open, id: 'c2', type: 'mucositis', resolved_on: '2026-08-20', noticed_on: '2026-08-01' };
const site = (complications: ImplantComplication[]) =>
  ({ id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10', followups: [], complications }) as unknown as ImplantSite;

beforeEach(() => {
  vi.mocked(saveComplication).mockReset().mockResolvedValue({});
  vi.mocked(voidComplication).mockReset().mockResolvedValue({});
});

describe('<Complications>', () => {
  it('lists open complications first with a bad badge, resolved ones after', () => {
    render(<Complications site={site([resolved, open])} patientId="pt" editable />);
    const items = within(screen.getByTestId('complications')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Peri-implantitis');
    expect(within(items[0]).getByText('Open')).toHaveClass('badge-bad');
    expect(items[1]).toHaveTextContent('Peri-implant mucositis');
    expect(within(items[1]).getByText('Resolved')).toBeInTheDocument();
  });

  it('adds a complication; the type list follows the category and resets when it changes', async () => {
    render(<Complications site={site([])} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Add complication' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'biological' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'peri_implantitis' } });
    expect(screen.getByText(/increased probing depth compared with previous examinations/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'mechanical' } });
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'screw_loosening' } });
    fireEvent.change(screen.getByLabelText('Noticed on'), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save complication' }));
    expect(vi.mocked(saveComplication)).toHaveBeenCalledWith(expect.objectContaining({
      complicationId: '', expectedUpdatedAt: '', siteId: 's1', patientId: 'pt', category: 'mechanical', type: 'screw_loosening', noticedOn: '2026-09-10',
    }));
  });

  it('edits with the version it opened with, and removes with a reason', async () => {
    const { rerender } = render(<Complications site={site([open])} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit complication' }));
    rerender(<Complications site={site([{ ...open, updated_at: '2026-09-02T09:00:00+00:00' }])} patientId="pt" editable />);
    fireEvent.change(screen.getByLabelText('Resolved on'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save complication' }));
    expect(vi.mocked(saveComplication)).toHaveBeenCalledWith(expect.objectContaining({
      complicationId: 'c1', expectedUpdatedAt: '2026-09-01T10:00:00.5+00:00', resolvedOn: '2026-09-15',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from record' }));
    fireEvent.change(screen.getByLabelText('Reason for removing'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove complication' }));
    expect(vi.mocked(voidComplication)).toHaveBeenCalledWith({ patientId: 'pt', complicationId: 'c1', reason: 'Duplicate entry' });
  });

  it('shows nothing to edit for viewers', () => {
    render(<Complications site={site([open])} patientId="pt" editable={false} />);
    expect(screen.queryByRole('button', { name: 'Add complication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit complication' })).not.toBeInTheDocument();
  });
});
```

Create `web/src/app/(app)/patients/[id]/failure-box.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';

vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));
vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
import { FailureBox } from './failure-box';
import { saveFailure } from './outcome-actions';

const failed = (over: Partial<ImplantSite> = {}) => ({
  id: 's1', tooth: 46, state: 'failed', placed_on: '2026-03-10', updated_at: '2026-05-02T08:00:00.5+00:00', components: [],
  failed_on: null, failure_type: null, failure_reason: null, failure_notes: '', ...over,
}) as unknown as ImplantSite;

beforeEach(() => vi.mocked(saveFailure).mockReset().mockResolvedValue({}));

describe('<FailureBox>', () => {
  it('asks for details on an old failure and records them without a version', () => {
    render(<FailureBox site={failed()} patientId="pt" editable />);
    expect(screen.getByTestId('failure')).toHaveTextContent('Failure details not recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Add failure details' }));
    fireEvent.change(screen.getByLabelText('Failure date'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure type' }), { target: { value: 'lost' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure reason' }), { target: { value: 'no_osseointegration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save failure details' }));
    expect(vi.mocked(saveFailure)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', expectedUpdatedAt: '', failedOn: '2026-05-01', failureType: 'lost', failureReason: 'no_osseointegration', failureNotes: '',
    });
  });

  it('shows recorded details with early/late and edits them with the version it opened with', () => {
    render(<FailureBox site={failed({ failed_on: '2026-05-01', failure_type: 'removed', failure_reason: 'peri_implantitis' })} patientId="pt" editable />);
    expect(screen.getByTestId('failure')).toHaveTextContent(/Removed · Peri-implantitis · .+ · early/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit failure details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save failure details' }));
    expect(vi.mocked(saveFailure)).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: '2026-05-02T08:00:00.5+00:00', failureType: 'removed' }));
  });

  it('renders nothing for an implant that has not failed', () => {
    const { container } = render(<FailureBox site={failed({ state: 'placed' } as Partial<ImplantSite>)} patientId="pt" editable />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Add to `web/src/app/(app)/patients/[id]/visits.test.tsx` (its `site` fixture is `placed`):

```tsx
describe('<RecordVisitForm> failure', () => {
  it('asks for failure details when a working implant fails, defaulting the date to the visit date', () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Failure type' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'failed' } });
    expect(screen.getByLabelText('Failure date')).toHaveValue('2026-06-01');
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure type' }), { target: { value: 'removed' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Failure reason' }), { target: { value: 'fracture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    expect(vi.mocked(recordVisit)).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', needsFailure: '1', failedOn: '2026-06-01', failureType: 'removed', failureReason: 'fracture',
    }));
  });

  it('asks for nothing more when the implant has already failed', () => {
    const failedSite = { ...site, state: 'failed' } as unknown as ImplantSite;
    render(<RecordVisitForm patientId="pt" site={failedSite} data={data} onDone={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'failed' } });
    expect(screen.queryByRole('combobox', { name: 'Failure type' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- complications failure-box patients/\\[id\\]/visits` → FAIL.

- [ ] **Step 3: Write the components**

Create `web/src/app/(app)/patients/[id]/complications.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import {
  CASE_DEFINITIONS, CATEGORY_LABELS, COMPLICATION_CATEGORIES, COMPLICATION_TYPES, SEVERITIES, SEVERITY_LABELS, TYPE_LABELS,
  describeComplication, isOpen, type ComplicationCategory, type ImplantComplication,
} from '@/lib/implants/complications';
import { Field, Footer, useSubmit } from './implant-forms';
import { saveComplication, voidComplication } from './outcome-actions';

type Props = { site: ImplantSite; patientId: string; editable: boolean };

export function Complications({ site, patientId, editable }: Props) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const live = (site.complications ?? []).filter((c) => !c.voided_at);
  const ordered = [...live.filter(isOpen), ...live.filter((c) => !isOpen(c))];
  return (
    <div data-testid="complications" className="space-y-2">
      <h4 className="font-medium">Complications</h4>
      {ordered.length === 0 && editing !== 'new' && <p className="text-muted">None recorded.</p>}
      <ul className="space-y-1">
        {ordered.map((c) => (
          <li key={c.id} className={isOpen(c) ? '' : 'text-muted'}>
            {editing === c.id ? (
              <ComplicationForm site={site} patientId={patientId} complication={c} onDone={() => setEditing(null)} />
            ) : (
              <ComplicationRow c={c} patientId={patientId} editable={editable} onEdit={() => setEditing(c.id)} />
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' && <ComplicationForm site={site} patientId={patientId} complication={null} onDone={() => setEditing(null)} />}
      {editable && editing === null && (
        <button type="button" className="btn-secondary btn" onClick={() => setEditing('new')}>Add complication</button>
      )}
    </div>
  );
}

function ComplicationRow({ c, patientId, editable, onEdit }: { c: ImplantComplication; patientId: string; editable: boolean; onEdit: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const result = await voidComplication({ patientId, complicationId: c.id, reason });
      if (result.error) setError(result.error);
    });
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={isOpen(c) ? 'badge badge-bad' : 'badge'}>{isOpen(c) ? 'Open' : 'Resolved'}</span>
        <span>{describeComplication(c)}</span>
        {editable && !removing && (
          <>
            <button type="button" className="btn-secondary btn" onClick={onEdit}>Edit complication</button>
            <button type="button" className="btn-secondary btn" onClick={() => setRemoving(true)}>Remove from record</button>
          </>
        )}
      </div>
      {removing && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Reason for removing</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Remove complication</button>
          <button type="button" className="btn-secondary btn" onClick={() => setRemoving(false)}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

function ComplicationForm({ site, patientId, complication, onDone }: {
  site: ImplantSite; patientId: string; complication: ImplantComplication | null; onDone: () => void;
}) {
  // The version this form opened with, so a stale edit is refused rather than overwriting someone else's.
  const [version] = useState(complication?.updated_at ?? '');
  const [v, setV] = useState({
    category: complication?.category ?? '', type: complication?.type ?? '', otherType: complication?.other_type ?? '',
    noticedOn: complication?.noticed_on ?? '', severity: complication?.severity ?? '', treatment: complication?.treatment ?? '',
    resolvedOn: complication?.resolved_on ?? '', followupId: complication?.followup_id ?? '', notes: complication?.notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) =>
    setV((cur) => ({ ...cur, [key]: value, ...(key === 'category' ? { type: '', otherType: '' } : {}) }));
  const { error, pending, submit } = useSubmit(saveComplication, onDone);
  const types = v.category ? COMPLICATION_TYPES[v.category as ComplicationCategory] : [];
  const visits = site.followups.filter((f) => !f.voided_at);
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ complicationId: complication?.id ?? '', expectedUpdatedAt: version, siteId: site.id, patientId, ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" required>
          <select className="input" aria-required="true" value={v.category} onChange={(e) => set('category')(e.target.value)}>
            <option value="">Choose…</option>
            {COMPLICATION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Type" required>
          <select className="input" aria-required="true" value={v.type} onChange={(e) => set('type')(e.target.value)} disabled={!v.category}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      {CASE_DEFINITIONS[v.type] && <p className="text-sm text-muted">{CASE_DEFINITIONS[v.type]}</p>}
      {v.type === 'other' && (
        <Field label="Describe">
          <input className="input" value={v.otherType} maxLength={120} onChange={(e) => set('otherType')(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Noticed on" required>
          <input className="input" type="date" aria-required="true" value={v.noticedOn} onChange={(e) => set('noticedOn')(e.target.value)} />
        </Field>
        <Field label="Severity">
          <select className="input" value={v.severity} onChange={(e) => set('severity')(e.target.value)}>
            <option value="">— not recorded</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Resolved on">
          <input className="input" type="date" value={v.resolvedOn} onChange={(e) => set('resolvedOn')(e.target.value)} />
        </Field>
        <Field label="Found at visit">
          <select className="input" value={v.followupId} onChange={(e) => set('followupId')(e.target.value)}>
            <option value="">—</option>
            {visits.map((f) => <option key={f.id} value={f.id}>{formatDate(f.date)} · {f.check_type}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Treatment">
        <input className="input" value={v.treatment} maxLength={1000} onChange={(e) => set('treatment')(e.target.value)} />
      </Field>
      <Field label="Notes">
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save complication" onCancel={onDone} />
    </form>
  );
}
```

Create `web/src/app/(app)/patients/[id]/failure-box.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import { FAILURE_REASONS, FAILURE_REASON_LABELS, FAILURE_TYPES, FAILURE_TYPE_LABELS, describeFailure } from '@/lib/implants/failure';
import { Field, Footer, useSubmit } from './implant-forms';
import { saveFailure } from './outcome-actions';

export function FailureBox({ site, patientId, editable }: { site: ImplantSite; patientId: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  if (site.state !== 'failed') return null;
  const recorded = site.failure_type !== null;
  return (
    <div data-testid="failure" className="space-y-2 rounded-lg border border-line px-3 py-2.5">
      <h4 className="font-medium">Failure</h4>
      {editing ? (
        <FailureForm site={site} patientId={patientId} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className={recorded ? '' : 'text-muted'}>{recorded ? describeFailure(site) : 'Failure details not recorded.'}</p>
          {site.failure_notes && <p className="text-muted">{site.failure_notes}</p>}
          {editable && (
            <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>
              {recorded ? 'Edit failure details' : 'Add failure details'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FailureForm({ site, patientId, onDone }: { site: ImplantSite; patientId: string; onDone: () => void }) {
  // Recording (no details yet) sends no version; correcting sends the version the form opened with.
  const [version] = useState(site.failure_type !== null ? site.updated_at : '');
  const [v, setV] = useState({
    failedOn: site.failed_on ?? '', failureType: site.failure_type ?? '', failureReason: site.failure_reason ?? '', failureNotes: site.failure_notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveFailure, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ siteId: site.id, patientId, expectedUpdatedAt: version, ...v }); }}>
      <FailureFields values={v} set={set} />
      <Footer error={error} pending={pending} saveLabel="Save failure details" onCancel={onDone} />
    </form>
  );
}

/** Failure date, type, reason and notes — shared with the Record visit form. */
export function FailureFields({ values, set }: {
  values: { failedOn: string; failureType: string; failureReason: string; failureNotes: string };
  set: (key: 'failedOn' | 'failureType' | 'failureReason' | 'failureNotes') => (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Failure date" required>
        <input className="input" type="date" aria-required="true" value={values.failedOn} onChange={(e) => set('failedOn')(e.target.value)} />
      </Field>
      <Field label="Failure type" required>
        <select className="input" aria-required="true" value={values.failureType} onChange={(e) => set('failureType')(e.target.value)}>
          <option value="">Choose…</option>
          {FAILURE_TYPES.map((t) => <option key={t} value={t}>{FAILURE_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Failure reason" required>
        <select className="input" aria-required="true" value={values.failureReason} onChange={(e) => set('failureReason')(e.target.value)}>
          <option value="">Choose…</option>
          {FAILURE_REASONS.map((r) => <option key={r} value={r}>{FAILURE_REASON_LABELS[r]}</option>)}
        </select>
      </Field>
      <Field label="Failure notes">
        <input className="input" value={values.failureNotes} maxLength={1000} onChange={(e) => set('failureNotes')(e.target.value)} />
      </Field>
    </div>
  );
}
```

- [ ] **Step 4: Wire them in**

In `web/src/app/(app)/patients/[id]/visits.tsx` (`RecordVisitForm`):
- import `{ FailureFields } from './failure-box'`.
- add `failedOn: '', failureType: '', failureReason: '', failureNotes: ''` to the initial state.
- compute `const needsFailure = v.attendance === 'attended' && v.outcome === 'failed' && site.state !== 'failed';`.
- right after the Outcome/Pain grid, render
  ```tsx
            {needsFailure && (
              <FailureFields values={{ ...v, failedOn: v.failedOn || v.date }} set={(k) => set(k)} />
            )}
  ```
- submit `{ patientId, siteId: site.id, ...v, failedOn: v.failedOn || v.date, needsFailure: needsFailure ? '1' : '' }`.

In `web/src/app/(app)/patients/[id]/implant-section.tsx` `SiteDetails`: import `{ Complications } from './complications'` and `{ FailureBox } from './failure-box'`; directly after `<Visits site={site} visits={data.visits} />` render
```tsx
      <FailureBox site={site} patientId={patientId} editable={data.editable} />
      <Complications site={site} patientId={patientId} editable={data.editable} />
```
Add `vi.mock('./outcome-actions', () => ({ saveComplication: vi.fn(), voidComplication: vi.fn(), saveFailure: vi.fn() }));` to `chart-panel.test.tsx` and `visits.test.tsx` (and any other test that renders these files).

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `npm test -- complications failure-box visits chart-panel surgical-details` → PASS. `npx tsc --noEmit`, `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/patients/[id]"
git commit -m "feat(implants): complications block, failure box, failure details on failed visits"
```

---

### Task 6: Odontogram marker, Implants tab column, E2E and verification

**Files:**
- Modify: `web/src/components/odontogram/odontogram.tsx`, `web/src/components/odontogram/odontogram.test.tsx`, `web/src/app/(app)/patients/[id]/chart-panel.tsx`, `web/src/app/(app)/patients/[id]/implants/page.tsx`, `CLAUDE.md`
- Create: `web/tests/e2e/complications.spec.ts`

**Interfaces:**
- Consumes: `openComplicationTeeth`, `isOpen` (Task 3); `ImplantSite.complications` (Task 4); UI (Task 5).
- Produces: `Odontogram` prop `alerts?: Partial<Record<number, boolean>>` — a warn-coloured marker (`data-alert`) and the tooth's accessible name gains ", open complication"; Implants tab cell `data-testid="open-complications"`.

- [ ] **Step 1: Write the failing odontogram test**

Add to `web/src/components/odontogram/odontogram.test.tsx` (use the file's existing render helper/props pattern):

```tsx
it('marks a tooth with an open complication, in its name and with a marker', () => {
  const { container } = render(<Odontogram statuses={{ 46: 'implant_placed' }} selected={[]} onSelect={() => {}} alerts={{ 46: true }} />);
  expect(screen.getByRole('button', { name: 'Tooth 46, Implant placed, open complication' })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-alert]')).toHaveLength(1);
});
```
(Check `STATE_LABELS.implant_placed` in `src/lib/patients/types.ts` and use its exact text in the expected name.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- odontogram` → FAIL.

- [ ] **Step 3: Implement the marker**

In `web/src/components/odontogram/odontogram.tsx`:
- add to `Props`: `/** Teeth whose implant has an open complication. */ alerts?: Partial<Record<number, boolean>>;`
- pass `alert={alerts?.[box.fdi] ?? false}` to `<Tooth>`, add `alert: boolean` to its props.
- the aria-label becomes ``aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}${badge ? `, ${badge}` : ''}${alert ? ', open complication' : ''}`}``.
- after the badge block, render
  ```tsx
      {alert && (
        <circle data-alert cx={box.x + TOOTH_W - 4} cy={box.y + (box.jaw === 'upper' ? 6 : TOOTH_H - 6)} r={6}
          style={{ fill: 'var(--color-warn)', stroke: 'var(--color-surface)' }} strokeWidth={2} />
      )}
  ```

In `web/src/app/(app)/patients/[id]/chart-panel.tsx`: `const alerts = useMemo(() => openComplicationTeeth(data.sites), [data.sites]);` and pass `alerts={alerts}` to `<Odontogram>` (import from `@/lib/implants/complications`).

In `web/src/app/(app)/patients/[id]/implants/page.tsx`: add `<th>Open complications</th>` after `<th>Next visit</th>` and
```tsx
                  <td data-label="Open complications" data-testid="open-complications">{(s.complications ?? []).filter(isOpen).length || '—'}</td>
```
(import `isOpen` from `@/lib/implants/complications`).

Run: `npm test -- odontogram chart-panel` → PASS.

- [ ] **Step 4: Write the E2E spec**

Create `web/tests/e2e/complications.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

const today = () => new Date().toISOString().slice(0, 10);

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Comp'), qty: 1, lot: `E2E-C${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Comp'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Complication patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
    p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { patientId };
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Tooth details' });

test('adds and resolves a complication; the chart, Implants tab and History follow', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const box = panel(page).getByTestId('complications');
  await box.getByRole('button', { name: 'Add complication' }).click();
  await box.getByRole('combobox', { name: 'Category' }).selectOption('biological');
  await box.getByRole('combobox', { name: 'Type' }).selectOption('mucositis');
  await box.getByLabel('Noticed on').fill(today());
  await box.getByRole('button', { name: 'Save complication' }).click();
  await expect(box.getByText('Open')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tooth 36, .*open complication/ })).toBeVisible();

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('open-complications')).toHaveText('1');

  await page.goto(`/patients/${patientId}?tooth=36`);
  await box.getByRole('button', { name: 'Edit complication' }).click();
  await box.getByLabel('Resolved on').fill(today());
  await box.getByRole('button', { name: 'Save complication' }).click();
  await expect(box.getByText('Resolved')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tooth 36, .*open complication/ })).toHaveCount(0);

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText('Complication recorded: Peri-implant mucositis')).toBeVisible();
  await expect(page.getByText('Complication resolved: Peri-implant mucositis')).toBeVisible();
});

test('a failed visit records the failure; the failure box shows it and it can be edited', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
  await panel(page).getByRole('combobox', { name: 'Failure type' }).selectOption('removed');
  await panel(page).getByRole('combobox', { name: 'Failure reason' }).selectOption('malposition');
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
  await expect(page.getByRole('button', { name: /Tooth 36, Failed implant/ })).toBeVisible();

  // The failed implant is now under "Earlier implants on this tooth".
  await panel(page).getByText(/Earlier implants on this tooth/).click();
  const failure = panel(page).getByTestId('failure');
  await expect(failure).toContainText('Removed · Malposition');
  await failure.getByRole('button', { name: 'Edit failure details' }).click();
  await failure.getByRole('combobox', { name: 'Failure reason' }).selectOption('fracture');
  await failure.getByRole('button', { name: 'Save failure details' }).click();
  await expect(failure).toContainText('Removed · Fracture');

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText(/failure recorded — Removed \(Malposition\)/)).toBeVisible();
  await expect(page.getByText(/failure details corrected: failure reason/)).toBeVisible();
});
```

- [ ] **Step 5: Run the E2E specs**

Check free memory and that nothing listens on :3000. Run: `npx playwright test complications visits implants chart history --project=chromium` → PASS.

- [ ] **Step 6: Document in CLAUDE.md**

In the root `CLAUDE.md`, under **Architecture**, after the "Follow-up visits (0045–0046)" bullet, add:

```markdown
- **Complications and failure (0047–0048).** `implant_complications` (category → type, noticed/resolved dates, severity, treatment, optional visit link) are written through `record_complication` / `update_complication` (optimistic on `updated_at`) / `void_complication` (details as jsonb, validated in SQL); open = no resolved date; open ones mark the tooth on the odontogram. Failure lives on `implant_sites` (`failed_on`, `failure_type`, `failure_reason`, `failure_notes`): a "failed" visit must carry the details (`record_visit` → `app_private.apply_failure`), old failures get them through `record_failure`, edits through `correct_failure` (optimistic on `implant_sites.updated_at`); voiding the failed visit clears them. Early vs late is derived in TS (`src/lib/implants/failure.ts`), never stored. Visits of a failed implant stop at the failure date. Peri-implantitis/mucositis are clinician-recorded; the form only shows the 2017 case definitions.
```

- [ ] **Step 7: Full verification**

Run: `./scripts/ship.sh verify complications visits implants chart history`
Expected: tsc, lint, unit, `test:db` and the named E2E specs pass. If it refuses because the tree isn't committed, commit first and rerun.

- [ ] **Step 8: Commit**

```bash
git add src/components/odontogram "src/app/(app)/patients/[id]" tests/e2e/complications.spec.ts ../CLAUDE.md
git commit -m "feat(implants): open-complication marker on the odontogram; Implants tab column; E2E; docs"
```

- [ ] **Step 9: Hand off**

Do not push or merge. Report the branch, the verify output, and the follow-up still owed after 2a deploys: drop `record_followup` (spec, "Follow-up PR"). The owner runs `./scripts/ship.sh ship`.
