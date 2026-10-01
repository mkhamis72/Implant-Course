# Plan 2 — Patients & Odontogram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers can create, find and edit patients (demographics, implant-relevant medical
history, visit notes), and every patient profile opens on that patient's own interactive,
fully redrawn SVG odontogram where tooth statuses are set one at a time or in bulk, with a
full change history.

**Architecture:** Four new tables (`patients`, `medical_history`, `visit_notes`,
`tooth_status`) behind RLS that reuses Plan 1's `is_active_user()` (so the aal2 rule is
inherited), audited by `app_private.audit_row`. Search and per-patient history are SQL
functions. The odontogram is a pure-SVG React component built from tested geometry/visual
modules; the chart page wraps it with a selection side panel that calls a server action.

**Tech Stack:** as Plan 1 (Next.js 15, Supabase, Zod, Vitest, Testing Library, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-01-implant-course-manager-design.md` (§4.2, §4.5
`tooth_status`, §6 Patients + Odontogram, §7)
**Roadmap:** `docs/superpowers/plans/2026-10-01-roadmap.md` (Plan 2 of 5)

## Global Constraints

- All Plan 1 constraints still apply (code in `web/`, commands run in `web/`, commit trailer,
  English UI, actionable error sentences, RLS on every table, `anon` has no table privileges).
- **Patients are never hard-deleted** — `authenticated` has no DELETE on any Plan 2 table;
  patients are archived.
- Every new table gets `app_private.audit_row('<pk>')`.
- New tables: `revoke all ... from anon; revoke delete, truncate ... from authenticated`.
- Teeth are FDI 11–18, 21–28, 31–38, 41–48 only (domain `public.fdi_tooth`).
- Tooth statuses (exact enum, spec §4.5): `present`, `missing`, `extracted`,
  `implant_planned`, `implant_placed`, `restored`, `failed`. A tooth with no row is `present`.
- In Plan 2, users may set only `present`, `missing`, `extracted` by hand. The implant states
  are set by Plan 3/4 workflows (SECURITY DEFINER functions); RLS refuses manual writes to or
  from implant states.
- Opening a patient (`/patients/[id]`) shows **that patient's odontogram** as the default view;
  header strip shows name, file no., age, medical-alert badges; tabs: Chart, Overview, Notes,
  History (Implants tab arrives in Plan 3). `?tooth=36` pre-selects a tooth.
- Odontogram is a **fully redrawn SVG** (user decision): simplified incisor/canine/premolar/
  molar outlines in the supplied chart's FDI layout (upper 18→28, lower 48→38, quadrant lines).
- Optimistic concurrency on patient + medical-history edits: stale save →
  "This record was changed by <name> at <HH:MM>. Reload to see it."
- Forms keep the user's input when a save fails.
- Times shown in `Africa/Cairo`.
- E2E: alerts asserted via `page.getByRole('main').getByRole('alert')`; E2E patients are named
  `E2E …` and deleted in global teardown.

## Review Focus

1. **Manually changing a tooth that has an implant status** (written later by Plan 3/4) →
   refused with "Teeth 36 have implant records and can't be changed here."; the database also
   refuses. Pinned in Task 1 (`manual writes cannot touch implant states`) and Task 8
   (`implant teeth are locked in the panel`).
2. **Search text containing `%`, `_`, commas, quotes or brackets** → treated literally, never
   errors. Pinned in Task 2 (`search treats wildcard characters literally`).
3. **Two organizers editing the same patient at once** → the second save is refused with who/
   when, nothing silently overwritten. Pinned in Task 7 (`stale save shows who changed it`).
4. **Tooth lists typed in notes with bad numbers (19, 50, `abc`), duplicates or odd
   separators** → clear message or de-duplicated sorted list. Pinned in Task 3 (`parseTeeth`)
   and Task 9 (`invalid tooth in note is rejected`).
5. **Future/absurd date of birth or a duplicate file number** → actionable message and the
   typed values stay in the form. Pinned in Task 3 (`patientSchema`) and Task 6
   (`invalid DOB keeps input`, `duplicate file number`).

---

## File Structure (Plan 2)

```
web/
  supabase/migrations/
    0004_patients.sql                 tables, domain, enum, RLS, triggers, audit
    0005_patient_functions.sql        search_patients(), patient_history()
  tests/db/
    patients.test.ts, patient-functions.test.ts
  tests/e2e/
    patients.ts                       E2E helpers: uniqueName, createPatientViaUi, deleteE2ePatients
    global-teardown.ts
    patients.spec.ts, patient-overview.spec.ts, chart.spec.ts, notes.spec.ts, history.spec.ts
  src/lib/
    format.ts (+test)                 APP_TIME_ZONE, formatTime, formatDate
    patients/types.ts                 ToothState, MANUAL_STATES, STATE_LABELS, row types
    patients/fdi.ts (+test)           CHART_ORDER, isFdiTooth, toothType, parseTeeth
    patients/alerts.ts (+test)        medicalAlerts
    patients/age.ts (+test)           ageOn
    patients/schemas.ts (+test)       patientSchema, medicalHistorySchema, noteSchema, toothStatusSchema, toPatientRow
    patients/history.ts (+test)       describeChange
    patients/conflict.ts (+test)      formatConflict
    patients/conflict-server.ts       staleMessage (server-only)
    patients/form-state.ts            FormState type + valueOf/checkedOf helpers
    auth/session.ts                   + requireActiveUser()
  src/components/odontogram/
    layout.ts (+test)                 toothLayout, geometry constants
    shapes.ts (+test)                 toothShape
    visuals.ts (+test)                toothVisual
    tooth-graphic.tsx                 one tooth's SVG (shared by chart + legend)
    odontogram.tsx (+test)            interactive chart
    legend.tsx
  src/components/nav-items.ts         + Patients
  src/app/(app)/patients/
    page.tsx                          list + search
    new/page.tsx, new/patient-form.tsx (shared create/edit form), actions.ts
    [id]/layout.tsx                   header strip + tabs
    [id]/patient-tabs.tsx
    [id]/page.tsx                     Chart (default)
    [id]/chart-panel.tsx, [id]/chart-actions.ts
    [id]/overview/page.tsx, medical-history-form.tsx, archive-button.tsx
    [id]/notes/page.tsx, note-form.tsx
    [id]/history/page.tsx
```

---

### Task 1: Patient tables, RLS and audit (migration 0004)

**Files:**
- Create: `web/supabase/migrations/0004_patients.sql`
- Test: `web/tests/db/patients.test.ts`

**Interfaces:**
- Consumes: `withTx`, `actAs`, `asPostgres`, `inject('testUsers')` (Plan 1); `is_active_user()`,
  `app_private.set_updated_at()`, `app_private.audit_row()`.
- Produces (SQL): domain `public.fdi_tooth`; enum `public.tooth_state`; tables
  `public.patients(id, file_no, full_name, dob, sex, phone, email, address, archived,
  created_at, created_by, updated_at)`, `public.medical_history(patient_id, allergies,
  medications, diabetes, smoker, bisphosphonates, anticoagulants, radiotherapy_head_neck,
  osteoporosis, other_conditions, notes, updated_at)`, `public.visit_notes(id, patient_id,
  visit_date, author_id → profiles.user_id, text, teeth fdi_tooth[], created_at)`,
  `public.tooth_status(id, patient_id, tooth, status, updated_at)` unique (patient_id, tooth).
  A `medical_history` row is created automatically for each new patient.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/patients.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

async function newPatient(c: Client, name = 'Test Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

describe('patients', () => {
  it('an active organizer creates a patient with an auto file number, creator and medical history', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const { rows } = await c.query('select file_no, created_by from public.patients where id = $1', [id]);
      expect(rows[0].file_no).toMatch(/^P\d{5,}$/);
      expect(rows[0].created_by).toBe(users.organizer);
      const mh = await c.query('select diabetes, allergies from public.medical_history where patient_id = $1', [id]);
      expect(mh.rows).toEqual([{ diabetes: false, allergies: '' }]);
    });
  });

  it('inactive users and anon cannot see or create patients', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await newPatient(c);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.patients')).rows).toHaveLength(0);
      await c.query('savepoint s');
      await expect(newPatient(c)).rejects.toThrow(/row-level security/);
      await c.query('rollback to savepoint s');
      await actAs(c, null);
      await expect(c.query('select id from public.patients')).rejects.toThrow(/permission denied/);
    });
  });

  it('patients cannot be deleted by users (archive instead)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const id = await newPatient(c);
      await expect(c.query('delete from public.patients where id = $1', [id])).rejects.toThrow(/permission denied/);
    });
  });

  it('file numbers are unique', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await c.query("insert into public.patients (full_name, file_no) values ('A A', 'F-1')");
      await expect(c.query("insert into public.patients (full_name, file_no) values ('B B', 'F-1')")).rejects.toThrow(
        /duplicate key/,
      );
    });
  });

  it('tooth numbers must be FDI permanent teeth', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 48, 'missing')", [id]);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 19, 'missing')", [id]),
      ).rejects.toThrow(/fdi_tooth/);
      await c.query('rollback to savepoint s');
      await expect(
        c.query("insert into public.visit_notes (patient_id, text, teeth) values ($1, 'x', '{36,50}')", [id]),
      ).rejects.toThrow(/fdi_tooth/);
    });
  });

  it('one status row per tooth (upsert updates it)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const upsert = `insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, $2)
                      on conflict (patient_id, tooth) do update set status = excluded.status`;
      await c.query(upsert, [id, 'missing']);
      await c.query(upsert, [id, 'extracted']);
      const { rows } = await c.query('select status from public.tooth_status where patient_id = $1', [id]);
      expect(rows).toEqual([{ status: 'extracted' }]);
    });
  });

  it('manual writes cannot touch implant states', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'implant_placed')", [id]),
      ).rejects.toThrow(/row-level security/);
      await c.query('rollback to savepoint s');
      // Simulate a Plan 3 workflow writing an implant state (bypasses RLS as postgres).
      await asPostgres(c);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 46, 'implant_placed')", [id]);
      await actAs(c, users.organizer);
      const r = await c.query("update public.tooth_status set status = 'missing' where patient_id = $1 and tooth = 46", [id]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('notes are written as the signed-in author and cannot be edited or deleted', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      const { rows } = await c.query(
        "insert into public.visit_notes (patient_id, text, teeth) values ($1, 'Healing well', '{36}') returning author_id, visit_date",
        [id],
      );
      expect(rows[0].author_id).toBe(users.organizer);
      await c.query('savepoint s');
      await expect(
        c.query("insert into public.visit_notes (patient_id, text, author_id) values ($1, 'forged', $2)", [id, users.admin]),
      ).rejects.toThrow(/row-level security/);
      await c.query('rollback to savepoint s');
      await expect(c.query("update public.visit_notes set text = 'changed'")).rejects.toThrow(/permission denied/);
    });
  });

  it('changes are audited with the patient id', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await newPatient(c);
      await c.query("update public.patients set phone = '0100' where id = $1", [id]);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 36, 'missing')", [id]);
      await asPostgres(c);
      const { rows } = await c.query(
        `select table_name, action, user_id from public.audit_log
         where row_id = $1 or after->>'patient_id' = $1 order by id`,
        [id],
      );
      expect(rows.map((r) => `${r.table_name}:${r.action}`)).toEqual([
        'patients:INSERT',
        'medical_history:INSERT',
        'patients:UPDATE',
        'tooth_status:INSERT',
      ]);
      expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([users.organizer]));
    });
  });

  it('a 2FA user with an aal1 token sees no patients (inherits Plan 1 rule)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await newPatient(c);
      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 't', 'totp', 'verified', now(), now(), 'x')`,
        [users.organizer],
      );
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect((await c.query('select id from public.patients')).rows).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -- patients`
Expected: FAIL — `relation "public.patients" does not exist`.

- [ ] **Step 3: Write the migration** — `web/supabase/migrations/0004_patients.sql`:

```sql
create domain public.fdi_tooth as smallint
  check (value between 11 and 18 or value between 21 and 28 or value between 31 and 38 or value between 41 and 48);

create type public.tooth_state as enum (
  'present', 'missing', 'extracted', 'implant_planned', 'implant_placed', 'restored', 'failed'
);

create sequence public.patients_file_no_seq;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  file_no text not null unique
    default ('P' || lpad(nextval('public.patients_file_no_seq')::text, 5, '0'))
    check (length(trim(file_no)) between 1 and 30),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  dob date check (dob >= '1900-01-01'),
  sex text check (sex in ('female', 'male')),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.medical_history (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  allergies text not null default '',
  medications text not null default '',
  diabetes boolean not null default false,
  smoker boolean not null default false,
  bisphosphonates boolean not null default false,
  anticoagulants boolean not null default false,
  radiotherapy_head_neck boolean not null default false,
  osteoporosis boolean not null default false,
  other_conditions text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table public.visit_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  visit_date date not null default current_date,
  author_id uuid not null default auth.uid() references public.profiles (user_id),
  text text not null check (length(trim(text)) between 1 and 5000),
  teeth public.fdi_tooth[] not null default '{}',
  created_at timestamptz not null default now()
);
create index visit_notes_patient_idx on public.visit_notes (patient_id, visit_date desc, created_at desc);

create table public.tooth_status (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  tooth public.fdi_tooth not null,
  status public.tooth_state not null,
  updated_at timestamptz not null default now(),
  unique (patient_id, tooth)
);

create trigger patients_set_updated_at before update on public.patients
  for each row execute function app_private.set_updated_at();
create trigger medical_history_set_updated_at before update on public.medical_history
  for each row execute function app_private.set_updated_at();
create trigger tooth_status_set_updated_at before update on public.tooth_status
  for each row execute function app_private.set_updated_at();

-- Every patient has exactly one medical_history row.
create function app_private.create_medical_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.medical_history (patient_id) values (new.id);
  return new;
end $$;

create trigger patients_create_medical_history after insert on public.patients
  for each row execute function app_private.create_medical_history();

-- Privileges: no anon access; no deletes (patients are archived); notes are append-only.
revoke all on public.patients, public.medical_history, public.visit_notes, public.tooth_status from anon;
revoke delete, truncate on public.patients, public.medical_history, public.visit_notes, public.tooth_status
  from authenticated;
revoke insert on public.medical_history from authenticated;
revoke update on public.visit_notes from authenticated;
grant usage on sequence public.patients_file_no_seq to authenticated;

alter table public.patients enable row level security;
alter table public.medical_history enable row level security;
alter table public.visit_notes enable row level security;
alter table public.tooth_status enable row level security;

create policy patients_select on public.patients for select to authenticated using (public.is_active_user());
create policy patients_insert on public.patients for insert to authenticated with check (public.is_active_user());
create policy patients_update on public.patients for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy medical_history_select on public.medical_history for select to authenticated
  using (public.is_active_user());
create policy medical_history_update on public.medical_history for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy visit_notes_select on public.visit_notes for select to authenticated using (public.is_active_user());
create policy visit_notes_insert on public.visit_notes for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());

-- Users may only set and change the manual states; implant states belong to later workflows.
create policy tooth_status_select on public.tooth_status for select to authenticated using (public.is_active_user());
create policy tooth_status_insert on public.tooth_status for insert to authenticated
  with check (public.is_active_user() and status in ('present', 'missing', 'extracted'));
create policy tooth_status_update on public.tooth_status for update to authenticated
  using (public.is_active_user() and status in ('present', 'missing', 'extracted'))
  with check (public.is_active_user() and status in ('present', 'missing', 'extracted'));

create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function app_private.audit_row('id');
create trigger medical_history_audit after insert or update or delete on public.medical_history
  for each row execute function app_private.audit_row('patient_id');
create trigger visit_notes_audit after insert or update or delete on public.visit_notes
  for each row execute function app_private.audit_row('id');
create trigger tooth_status_audit after insert or update or delete on public.tooth_status
  for each row execute function app_private.audit_row('id');

create index audit_log_patient_idx on public.audit_log
  ((coalesce(after ->> 'patient_id', before ->> 'patient_id')));
```

- [ ] **Step 4: Run all DB tests**

Run: `npm run test:db`
Expected: PASS (Plan 1's 19 + 10 new).

- [ ] **Step 5: Commit** (from repo root)

```bash
git add web/supabase/migrations/0004_patients.sql web/tests/db/patients.test.ts
git commit -m "feat(db): patients, medical history, visit notes and tooth status with RLS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Patient search and history functions (migration 0005)

**Files:**
- Create: `web/supabase/migrations/0005_patient_functions.sql`
- Test: `web/tests/db/patient-functions.test.ts`

**Interfaces:**
- Produces (SQL): `public.search_patients(q text default '', include_archived boolean default false)
  returns setof public.patients` (name / file no. substring, case-insensitive; phone by digits;
  wildcards literal; ordered by name; max 50).
  `public.patient_history(p_patient uuid) returns table (id bigint, at timestamptz, table_name
  text, action text, actor text, before jsonb, after jsonb)` newest first, max 500.

- [ ] **Step 1: Write the failing tests** — `web/tests/db/patient-functions.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');

async function add(c: Client, full_name: string, extra: { phone?: string; file_no?: string; archived?: boolean } = {}) {
  const { rows } = await c.query(
    `insert into public.patients (full_name, phone, file_no, archived)
     values ($1, $2, coalesce($3, 'T-' || gen_random_uuid()), $4) returning id`,
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -- patient-functions`
Expected: FAIL — `function public.search_patients(unknown, boolean) does not exist`.

- [ ] **Step 3: Write the migration** — `web/supabase/migrations/0005_patient_functions.sql`:

```sql
create function public.search_patients(q text default '', include_archived boolean default false)
returns setof public.patients
language sql stable security invoker set search_path = '' as $$
  with term as (
    select
      replace(replace(replace(coalesce(trim(q), ''), '\', '\\'), '%', '\%'), '_', '\_') as text_pat,
      nullif(regexp_replace(coalesce(q, ''), '\D', '', 'g'), '') as digits
  )
  select p.*
  from public.patients p, term t
  where (include_archived or not p.archived)
    and (
      t.text_pat = ''
      or p.full_name ilike '%' || t.text_pat || '%' escape '\'
      or p.file_no ilike '%' || t.text_pat || '%' escape '\'
      or (t.digits is not null and regexp_replace(p.phone, '\D', '', 'g') like '%' || t.digits || '%')
    )
  order by p.full_name
  limit 50;
$$;

create function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
  order by a.id desc
  limit 500;
$$;

revoke execute on function public.search_patients(text, boolean) from public, anon;
revoke execute on function public.patient_history(uuid) from public, anon;
grant execute on function public.search_patients(text, boolean) to authenticated;
grant execute on function public.patient_history(uuid) to authenticated;
```

Note: the search phone clause only applies when the query contains digits, so a name search
never matches every phone number.

- [ ] **Step 4: Run all DB tests**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0005_patient_functions.sql web/tests/db/patient-functions.test.ts
git commit -m "feat(db): patient search and per-patient history functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Patient domain logic (types, teeth, alerts, age, schemas, history, conflict, format)

**Files:**
- Create: `web/src/lib/format.ts`, `web/src/lib/patients/{types,fdi,alerts,age,schemas,history,conflict,form-state}.ts`
- Test: `web/src/lib/format.test.ts`, `web/src/lib/patients/{fdi,alerts,age,schemas,history,conflict}.test.ts`

**Interfaces:**
- Produces:
  - `APP_TIME_ZONE = 'Africa/Cairo'`, `formatTime(iso: string): string` ("HH:MM"),
    `formatDateTime(iso: string): string` ("01 Oct 2026, 14:32"), `formatDate(isoDate: string): string` ("01 Oct 2026") — `@/lib/format`.
  - `TOOTH_STATES`, `ToothState`, `MANUAL_STATES`, `ManualState`, `isManualState(s)`,
    `STATE_LABELS: Record<ToothState, string>`, `Patient`, `MedicalHistory`, `VisitNote`,
    `HistoryEntry` — `@/lib/patients/types`.
  - `CHART_ORDER: { upper: number[]; lower: number[] }`, `isFdiTooth(n)`, `ToothType`,
    `toothType(fdi): ToothType`, `parseTeeth(input): { teeth: number[] } | { error: string }` — `@/lib/patients/fdi`.
  - `medicalAlerts(h): string[]` — `@/lib/patients/alerts`.
  - `ageOn(dob: string | null, today: Date): number | null` — `@/lib/patients/age`.
  - `patientSchema`, `PatientInput`, `toPatientRow(p)`, `medicalHistorySchema`, `noteSchema`,
    `toothStatusSchema` — `@/lib/patients/schemas`.
  - `describeChange(entry: HistoryEntry): string` — `@/lib/patients/history`.
  - `formatConflict(name: string | null, at: string | null): string` — `@/lib/patients/conflict`.
  - `FormState = { ok?: string; error?: string; values?: Record<string, string> }`,
    `valueOf(state, key, fallback)`, `checkedOf(state, key, fallback)` — `@/lib/patients/form-state`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatTime } from './format';

describe('format (Africa/Cairo)', () => {
  it('formats times as HH:MM in Cairo time', () => {
    expect(formatTime('2026-01-15T10:05:00Z')).toBe('12:05');
  });
  it('formats date-times and plain dates', () => {
    expect(formatDateTime('2026-01-15T10:05:00Z')).toBe('15 Jan 2026, 12:05');
    expect(formatDate('2026-01-15')).toBe('15 Jan 2026');
  });
});
```

`web/src/lib/patients/fdi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CHART_ORDER, isFdiTooth, parseTeeth, toothType } from './fdi';

describe('FDI teeth', () => {
  it('chart order matches the paper chart', () => {
    expect(CHART_ORDER.upper).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(CHART_ORDER.lower).toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]);
  });
  it('accepts only permanent FDI teeth', () => {
    expect([11, 18, 21, 28, 31, 38, 41, 48].every(isFdiTooth)).toBe(true);
    expect([10, 19, 20, 29, 50, 51, 9, 36.5, -36].some(isFdiTooth)).toBe(false);
  });
  it('knows tooth types', () => {
    expect([11, 22, 13, 34, 45, 16, 27, 38].map(toothType)).toEqual([
      'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar',
    ]);
  });
});

describe('parseTeeth', () => {
  it('accepts commas, spaces and semicolons, de-duplicates and sorts', () => {
    expect(parseTeeth(' 46, 36;36  11 ')).toEqual({ teeth: [11, 36, 46] });
  });
  it('treats empty input as no teeth', () => {
    expect(parseTeeth('   ')).toEqual({ teeth: [] });
  });
  it.each(['19', '50', 'abc', '3 6', '36a'])('rejects %s with an actionable message', (bad) => {
    const result = parseTeeth(`36, ${bad}`);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/is not a tooth number\. Use FDI numbers 11–48/);
  });
});
```

`web/src/lib/patients/alerts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { medicalAlerts } from './alerts';

const none = {
  allergies: '', bisphosphonates: false, anticoagulants: false, radiotherapy_head_neck: false,
  diabetes: false, osteoporosis: false, smoker: false,
};

describe('medicalAlerts', () => {
  it('is empty for a healthy history or no history', () => {
    expect(medicalAlerts(none)).toEqual([]);
    expect(medicalAlerts(null)).toEqual([]);
  });
  it('lists alerts most serious first', () => {
    expect(
      medicalAlerts({ ...none, allergies: 'Penicillin', smoker: true, bisphosphonates: true, diabetes: true }),
    ).toEqual(['Allergy: Penicillin', 'Bisphosphonates', 'Diabetes', 'Smoker']);
  });
  it.each(['none', 'NKDA', 'nil', 'No', 'n/a', '-'])('ignores "%s" as an allergy', (text) => {
    expect(medicalAlerts({ ...none, allergies: text })).toEqual([]);
  });
  it('shortens long allergy text', () => {
    const [alert] = medicalAlerts({ ...none, allergies: 'a'.repeat(60) });
    expect(alert).toHaveLength('Allergy: '.length + 40);
    expect(alert.endsWith('…')).toBe(true);
  });
});
```

`web/src/lib/patients/age.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ageOn } from './age';

describe('ageOn', () => {
  const today = new Date(2026, 9, 1); // 1 Oct 2026, local time
  it('counts completed years', () => {
    expect(ageOn('1980-10-01', today)).toBe(46);
    expect(ageOn('1980-10-02', today)).toBe(45);
  });
  it('is null without a valid date', () => {
    expect(ageOn(null, today)).toBeNull();
    expect(ageOn('garbage', today)).toBeNull();
  });
});
```

`web/src/lib/patients/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { medicalHistorySchema, noteSchema, patientSchema, toPatientRow, toothStatusSchema } from './schemas';

const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('patientSchema', () => {
  it('trims and normalizes, turning empty optionals into nulls / omitting file_no', () => {
    const parsed = patientSchema.parse({ full_name: '  Amira Fathy ', email: ' A@B.COM ', phone: ' 0100 ' });
    expect(parsed).toMatchObject({ full_name: 'Amira Fathy', email: 'a@b.com', phone: '0100', dob: '', sex: '' });
    expect(toPatientRow(parsed)).toEqual({
      full_name: 'Amira Fathy', dob: null, sex: null, phone: '0100', email: 'a@b.com', address: '',
    });
    expect(toPatientRow({ ...parsed, file_no: 'F-9' })).toMatchObject({ file_no: 'F-9' });
  });
  it('rejects a short name', () => {
    expect(firstError(patientSchema.safeParse({ full_name: 'A' }))).toBe(
      'Enter the patient’s full name (at least 2 characters).',
    );
  });
  it.each(['2999-01-01', '1899-12-31', '2026-02-30', '01/02/1990'])('rejects date of birth %s', (dob) => {
    expect(firstError(patientSchema.safeParse({ full_name: 'Amira', dob }))).toBe(
      'Enter a real date of birth (not in the future, after 1900).',
    );
  });
  it('rejects a bad email', () => {
    expect(firstError(patientSchema.safeParse({ full_name: 'Amira', email: 'nope' }))).toBe(
      'Enter a valid email address or leave it empty.',
    );
  });
});

describe('medicalHistorySchema', () => {
  it('reads checkboxes ("on" or missing) as booleans', () => {
    const parsed = medicalHistorySchema.parse({ diabetes: 'on', allergies: ' Latex ' });
    expect(parsed).toMatchObject({ diabetes: true, smoker: false, allergies: 'Latex' });
  });
});

describe('noteSchema', () => {
  it('parses teeth and trims text', () => {
    expect(noteSchema.parse({ visit_date: '2026-01-10', text: ' Sutures out ', teeth: '46, 36' })).toEqual({
      visit_date: '2026-01-10', text: 'Sutures out', teeth: [36, 46],
    });
  });
  it('rejects an empty note, a future date and bad teeth', () => {
    expect(firstError(noteSchema.safeParse({ visit_date: '2026-01-10', text: '  ' }))).toBe('Write the note.');
    expect(firstError(noteSchema.safeParse({ visit_date: '2999-01-01', text: 'x' }))).toBe(
      'Enter the visit date (today or earlier).',
    );
    expect(firstError(noteSchema.safeParse({ visit_date: '2026-01-10', text: 'x', teeth: '19' }))).toMatch(
      /"19" is not a tooth number/,
    );
  });
});

describe('toothStatusSchema', () => {
  const patient_id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('accepts manual statuses for valid teeth', () => {
    expect(toothStatusSchema.parse({ patient_id, teeth: [36, 46], status: 'missing' })).toEqual({
      patient_id, teeth: [36, 46], status: 'missing',
    });
  });
  it('refuses implant statuses, no teeth and invalid teeth', () => {
    expect(toothStatusSchema.safeParse({ patient_id, teeth: [36], status: 'implant_placed' }).success).toBe(false);
    expect(firstError(toothStatusSchema.safeParse({ patient_id, teeth: [], status: 'missing' }))).toBe(
      'Select at least one tooth.',
    );
    expect(toothStatusSchema.safeParse({ patient_id, teeth: [19], status: 'missing' }).success).toBe(false);
  });
});
```

`web/src/lib/patients/history.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { describeChange } from './history';
import type { HistoryEntry } from './types';

const entry = (e: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1, at: '2026-10-01T10:00:00Z', table_name: 'patients', action: 'UPDATE', actor: 'Dr A', before: null, after: null, ...e,
});

describe('describeChange', () => {
  it('describes patient creation, edits and archiving', () => {
    expect(describeChange(entry({ action: 'INSERT', after: { full_name: 'X' } }))).toBe('Patient created');
    expect(
      describeChange(entry({ before: { phone: '1', email: 'a', updated_at: 'x' }, after: { phone: '2', email: 'a', updated_at: 'y' } })),
    ).toBe('Patient details changed: phone');
    expect(describeChange(entry({ before: { archived: false }, after: { archived: true } }))).toBe('Patient archived');
    expect(describeChange(entry({ before: { archived: true }, after: { archived: false } }))).toBe('Patient restored');
  });
  it('describes medical history changes', () => {
    expect(
      describeChange(entry({ table_name: 'medical_history', before: { diabetes: false, smoker: false }, after: { diabetes: true, smoker: true } })),
    ).toBe('Medical history changed: diabetes, smoker');
    expect(describeChange(entry({ table_name: 'medical_history', action: 'INSERT', after: {} }))).toBe('Medical history started');
  });
  it('describes tooth status changes', () => {
    expect(describeChange(entry({ table_name: 'tooth_status', action: 'INSERT', after: { tooth: 36, status: 'missing' } }))).toBe(
      'Tooth 36: Present → Missing',
    );
    expect(
      describeChange(entry({ table_name: 'tooth_status', before: { tooth: 36, status: 'missing' }, after: { tooth: 36, status: 'extracted' } })),
    ).toBe('Tooth 36: Missing → Extracted');
  });
  it('describes notes', () => {
    expect(describeChange(entry({ table_name: 'visit_notes', action: 'INSERT', after: { teeth: [36, 46] } }))).toBe(
      'Note added (teeth 36, 46)',
    );
    expect(describeChange(entry({ table_name: 'visit_notes', action: 'INSERT', after: { teeth: [] } }))).toBe('Note added');
  });
});
```

`web/src/lib/patients/conflict.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatConflict } from './conflict';

describe('formatConflict', () => {
  it('names who and when', () => {
    expect(formatConflict('Dr Amira', '2026-01-15T10:05:00Z')).toBe(
      'This record was changed by Dr Amira at 12:05. Reload to see it.',
    );
  });
  it('falls back gracefully', () => {
    expect(formatConflict(null, null)).toBe('This record was changed by another user. Reload to see it.');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./format`, `./fdi`, `./alerts`, `./age`, `./schemas`, `./history`, `./conflict`.

- [ ] **Step 3: Implement**

`web/src/lib/format.ts`:
```ts
export const APP_TIME_ZONE = 'Africa/Cairo';

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TIME_ZONE });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TIME_ZONE,
});
const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** A plain calendar date ("YYYY-MM-DD") — no time zone shift. */
export function formatDate(isoDate: string): string {
  return date.format(new Date(`${isoDate}T00:00:00Z`));
}
```

`web/src/lib/patients/types.ts`:
```ts
export const TOOTH_STATES = [
  'present', 'missing', 'extracted', 'implant_planned', 'implant_placed', 'restored', 'failed',
] as const;
export type ToothState = (typeof TOOTH_STATES)[number];

/** States a user may set by hand; implant states come from implant workflows (Plans 3–4). */
export const MANUAL_STATES = ['present', 'missing', 'extracted'] as const;
export type ManualState = (typeof MANUAL_STATES)[number];

export function isManualState(state: string): state is ManualState {
  return (MANUAL_STATES as readonly string[]).includes(state);
}

export const STATE_LABELS: Record<ToothState, string> = {
  present: 'Present',
  missing: 'Missing',
  extracted: 'Extracted',
  implant_planned: 'Implant planned',
  implant_placed: 'Implant placed',
  restored: 'Restored',
  failed: 'Failed implant',
};

export type Patient = {
  id: string;
  file_no: string;
  full_name: string;
  dob: string | null;
  sex: 'female' | 'male' | null;
  phone: string;
  email: string;
  address: string;
  archived: boolean;
  updated_at: string;
};

export type MedicalHistory = {
  patient_id: string;
  allergies: string;
  medications: string;
  diabetes: boolean;
  smoker: boolean;
  bisphosphonates: boolean;
  anticoagulants: boolean;
  radiotherapy_head_neck: boolean;
  osteoporosis: boolean;
  other_conditions: string;
  notes: string;
  updated_at: string;
};

export type VisitNote = {
  id: string;
  visit_date: string;
  text: string;
  teeth: number[];
  created_at: string;
  author: { full_name: string; email: string } | null;
};

export type HistoryEntry = {
  id: number;
  at: string;
  table_name: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
```

`web/src/lib/patients/fdi.ts`:
```ts
export const CHART_ORDER = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
} as const;

export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';

export function isFdiTooth(n: number): boolean {
  const quadrant = Math.floor(n / 10);
  const position = n % 10;
  return Number.isInteger(n) && quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8;
}

export function toothType(fdi: number): ToothType {
  const position = fdi % 10;
  if (position <= 2) return 'incisor';
  if (position === 3) return 'canine';
  if (position <= 5) return 'premolar';
  return 'molar';
}

/** Parses "36, 46" / "36 46" / "36;46" into sorted unique FDI teeth. */
export function parseTeeth(input: string): { teeth: number[] } | { error: string } {
  const teeth = new Set<number>();
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const n = Number(token);
    if (!/^\d+$/.test(token) || !isFdiTooth(n)) {
      return { error: `"${token}" is not a tooth number. Use FDI numbers 11–48 (e.g. 36, 46).` };
    }
    teeth.add(n);
  }
  return { teeth: [...teeth].sort((a, b) => a - b) };
}
```

Note: `'3 6'` splits into `3` and `6`, both rejected — the test expects an error.

`web/src/lib/patients/alerts.ts`:
```ts
import type { MedicalHistory } from './types';

type AlertInput = Pick<
  MedicalHistory,
  'allergies' | 'bisphosphonates' | 'anticoagulants' | 'radiotherapy_head_neck' | 'diabetes' | 'osteoporosis' | 'smoker'
>;

const NO_ALLERGY = /^(none|nil|no|nkda|n\/a|-)$/i;
const MAX_ALLERGY = 40;

/** Implant-relevant alerts, most serious first. */
export function medicalAlerts(h: AlertInput | null): string[] {
  if (!h) return [];
  const alerts: string[] = [];
  const allergies = h.allergies.trim();
  if (allergies && !NO_ALLERGY.test(allergies)) {
    alerts.push(`Allergy: ${allergies.length > MAX_ALLERGY ? `${allergies.slice(0, MAX_ALLERGY - 1)}…` : allergies}`);
  }
  if (h.bisphosphonates) alerts.push('Bisphosphonates');
  if (h.anticoagulants) alerts.push('Anticoagulants');
  if (h.radiotherapy_head_neck) alerts.push('Head/neck radiotherapy');
  if (h.diabetes) alerts.push('Diabetes');
  if (h.osteoporosis) alerts.push('Osteoporosis');
  if (h.smoker) alerts.push('Smoker');
  return alerts;
}
```

`web/src/lib/patients/age.ts`:
```ts
export function ageOn(dob: string | null, today: Date): number | null {
  const match = dob?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  let age = today.getFullYear() - year;
  const month0 = today.getMonth() + 1;
  if (month0 < month || (month0 === month && today.getDate() < day)) age -= 1;
  return age;
}
```

`web/src/lib/patients/schemas.ts`:
```ts
import { z } from 'zod';
import { isFdiTooth, parseTeeth } from './fdi';
import { MANUAL_STATES } from './types';

const text = (max: number) => z.string().trim().max(max).default('');

function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const patientSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the patient’s full name (at least 2 characters).' }).max(120),
  file_no: z.string().trim().max(30, { message: 'File number is too long (max 30 characters).' }).default(''),
  dob: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || (isRealDate(v) && v >= '1900-01-01' && v <= todayIso()), {
      message: 'Enter a real date of birth (not in the future, after 1900).',
    }),
  sex: z.enum(['', 'female', 'male']).default(''),
  phone: text(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .default('')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, {
      message: 'Enter a valid email address or leave it empty.',
    }),
  address: text(300),
});

export type PatientInput = z.infer<typeof patientSchema>;

/** Row for insert/update. An empty file number is left out so the database assigns/keeps one. */
export function toPatientRow(p: PatientInput): Record<string, string | null> {
  const row: Record<string, string | null> = {
    full_name: p.full_name,
    dob: p.dob || null,
    sex: p.sex || null,
    phone: p.phone,
    email: p.email,
    address: p.address,
  };
  if (p.file_no) row.file_no = p.file_no;
  return row;
}

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const medicalHistorySchema = z.object({
  allergies: text(1000),
  medications: text(1000),
  diabetes: checkbox,
  smoker: checkbox,
  bisphosphonates: checkbox,
  anticoagulants: checkbox,
  radiotherapy_head_neck: checkbox,
  osteoporosis: checkbox,
  other_conditions: text(1000),
  notes: text(2000),
});

export const noteSchema = z.object({
  visit_date: z.string().refine((v) => isRealDate(v) && v <= todayIso(), {
    message: 'Enter the visit date (today or earlier).',
  }),
  text: z.string().trim().min(1, { message: 'Write the note.' }).max(5000, { message: 'The note is too long (max 5000 characters).' }),
  teeth: z
    .string()
    .default('')
    .transform((v, ctx) => {
      const result = parseTeeth(v);
      if ('error' in result) {
        ctx.addIssue({ code: 'custom', message: result.error });
        return z.NEVER;
      }
      return result.teeth;
    }),
});

export const toothStatusSchema = z.object({
  patient_id: z.string().uuid(),
  teeth: z
    .array(z.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }))
    .min(1, { message: 'Select at least one tooth.' }),
  status: z.enum(MANUAL_STATES),
});
```

`web/src/lib/patients/history.ts`:
```ts
import { STATE_LABELS, type HistoryEntry, type ToothState } from './types';

const FIELD_LABELS: Record<string, string> = {
  full_name: 'name', file_no: 'file number', dob: 'date of birth', sex: 'sex', phone: 'phone', email: 'email',
  address: 'address', allergies: 'allergies', medications: 'medications', diabetes: 'diabetes', smoker: 'smoker',
  bisphosphonates: 'bisphosphonates', anticoagulants: 'anticoagulants', radiotherapy_head_neck: 'head/neck radiotherapy',
  osteoporosis: 'osteoporosis', other_conditions: 'other conditions', notes: 'notes',
};

function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before || !after) return [];
  return Object.keys(FIELD_LABELS)
    .filter((key) => key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => FIELD_LABELS[key]);
}

function stateLabel(value: unknown): string {
  return STATE_LABELS[(value as ToothState) ?? 'present'] ?? String(value);
}

export function describeChange(e: HistoryEntry): string {
  const fields = changedFields(e.before, e.after);
  switch (e.table_name) {
    case 'patients': {
      if (e.action === 'INSERT') return 'Patient created';
      if (e.action === 'DELETE') return 'Patient deleted';
      if (e.before?.archived !== e.after?.archived) return e.after?.archived ? 'Patient archived' : 'Patient restored';
      return fields.length ? `Patient details changed: ${fields.join(', ')}` : 'Patient details saved (no changes)';
    }
    case 'medical_history': {
      if (e.action === 'INSERT') return 'Medical history started';
      return fields.length ? `Medical history changed: ${fields.join(', ')}` : 'Medical history saved (no changes)';
    }
    case 'tooth_status': {
      const tooth = (e.after ?? e.before)?.tooth;
      return `Tooth ${tooth}: ${stateLabel(e.before?.status)} → ${stateLabel(e.after?.status)}`;
    }
    case 'visit_notes': {
      const teeth = (e.after?.teeth as number[] | undefined) ?? [];
      return teeth.length ? `Note added (teeth ${teeth.join(', ')})` : 'Note added';
    }
    default:
      return `${e.table_name} ${e.action.toLowerCase()}`;
  }
}
```

`web/src/lib/patients/conflict.ts`:
```ts
import { formatTime } from '@/lib/format';

export function formatConflict(name: string | null, at: string | null): string {
  return `This record was changed by ${name || 'another user'}${at ? ` at ${formatTime(at)}` : ''}. Reload to see it.`;
}
```

`web/src/lib/patients/form-state.ts`:
```ts
/** Server-action state for forms that must keep the user's input after a failed save. */
export type FormState = { ok?: string; error?: string; values?: Record<string, string> };

export function failed(error: string, formData: FormData): FormState {
  const values: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return { error, values };
}

export function valueOf(state: FormState, key: string, fallback: string | null | undefined): string {
  return state.values?.[key] ?? fallback ?? '';
}

export function checkedOf(state: FormState, key: string, fallback: boolean): boolean {
  return state.values ? state.values[key] === 'on' : fallback;
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS (all previous + new).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "feat(patients): domain logic for teeth, alerts, age, validation, history and conflicts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Odontogram geometry, tooth shapes and status visuals

**Files:**
- Create: `web/src/components/odontogram/{layout,shapes,visuals}.ts`
- Test: `web/src/components/odontogram/{layout,shapes,visuals}.test.ts`

**Interfaces:**
- Consumes: `CHART_ORDER`, `toothType`, `ToothType` (`@/lib/patients/fdi`); `ToothState`, `TOOTH_STATES`.
- Produces:
  - `TOOTH_W = 40`, `TOOTH_H = 130`, `JAW_GAP = 46`, `CHART_WIDTH`, `CHART_HEIGHT`, `MIDLINE_X`,
    `ToothBox = { fdi; jaw: 'upper' | 'lower'; type: ToothType; x; y }`, `toothLayout(): ToothBox[]`.
  - `toothShape(type, jaw): { crown: string; roots: string }` — SVG path data in an upper-jaw
    frame (roots at y 0–80, crown at y 80–130, width 40); lower teeth are drawn flipped.
  - `ToothVisual`, `toothVisual(status): ToothVisual`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/odontogram/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CHART_HEIGHT, CHART_WIDTH, JAW_GAP, MIDLINE_X, TOOTH_H, TOOTH_W, toothLayout } from './layout';

describe('toothLayout', () => {
  const boxes = toothLayout();
  const byFdi = new Map(boxes.map((b) => [b.fdi, b]));

  it('has 32 unique teeth', () => {
    expect(new Set(boxes.map((b) => b.fdi)).size).toBe(32);
  });
  it('places the upper jaw on top and the lower jaw below the gap', () => {
    expect(byFdi.get(11)!.y).toBe(0);
    expect(byFdi.get(41)!.y).toBe(TOOTH_H + JAW_GAP);
    expect(byFdi.get(11)!.jaw).toBe('upper');
    expect(byFdi.get(36)!.jaw).toBe('lower');
  });
  it('runs 18→11 | 21→28 and 48→41 | 31→38 left to right, split at the midline', () => {
    expect(byFdi.get(18)!.x).toBe(0);
    expect(byFdi.get(48)!.x).toBe(0);
    expect(byFdi.get(11)!.x + TOOTH_W).toBeLessThan(MIDLINE_X);
    expect(byFdi.get(21)!.x).toBeGreaterThan(MIDLINE_X);
    expect(byFdi.get(31)!.x).toBe(byFdi.get(21)!.x);
    expect(byFdi.get(28)!.x + TOOTH_W).toBe(CHART_WIDTH);
    expect(CHART_HEIGHT).toBe(2 * TOOTH_H + JAW_GAP);
  });
  it('knows each tooth’s type', () => {
    expect(byFdi.get(13)!.type).toBe('canine');
    expect(byFdi.get(46)!.type).toBe('molar');
  });
});
```

`web/src/components/odontogram/shapes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toothShape } from './shapes';

const subpaths = (d: string) => d.split('M').filter((s) => s.trim()).length;

describe('toothShape', () => {
  it('gives every type a crown and roots', () => {
    for (const type of ['incisor', 'canine', 'premolar', 'molar'] as const) {
      const shape = toothShape(type, 'upper');
      expect(shape.crown).toMatch(/^M/);
      expect(shape.roots).toMatch(/^M/);
    }
  });
  it('draws three roots on upper molars and two on lower molars', () => {
    expect(subpaths(toothShape('molar', 'upper').roots)).toBe(3);
    expect(subpaths(toothShape('molar', 'lower').roots)).toBe(2);
    expect(subpaths(toothShape('incisor', 'lower').roots)).toBe(1);
  });
});
```

`web/src/components/odontogram/visuals.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TOOTH_STATES } from '@/lib/patients/types';
import { toothVisual } from './visuals';

describe('toothVisual', () => {
  it('gives every state a distinct look', () => {
    const looks = TOOTH_STATES.map((s) => JSON.stringify(toothVisual(s)));
    expect(new Set(looks).size).toBe(TOOTH_STATES.length);
  });
  it('shows a natural tooth only when present', () => {
    expect(toothVisual('present')).toMatchObject({ showRoots: true, glyph: 'none', dashed: false });
    expect(toothVisual('missing')).toMatchObject({ showRoots: false, glyph: 'none', dashed: true });
    expect(toothVisual('extracted')).toMatchObject({ showRoots: false, glyph: 'cross' });
  });
  it('draws a fixture for every implant state', () => {
    expect(toothVisual('implant_planned')).toMatchObject({ glyph: 'fixture', fixture: 'planned' });
    expect(toothVisual('implant_placed')).toMatchObject({ glyph: 'fixture', fixture: 'placed' });
    expect(toothVisual('restored')).toMatchObject({ glyph: 'fixture', fixture: 'placed', dashed: false });
    expect(toothVisual('failed')).toMatchObject({ glyph: 'fixture', fixture: 'failed' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./layout`, `./shapes`, `./visuals`.

- [ ] **Step 3: Implement**

`web/src/components/odontogram/layout.ts`:
```ts
import { CHART_ORDER, toothType, type ToothType } from '@/lib/patients/fdi';

export const TOOTH_W = 40;
export const TOOTH_H = 130;
export const JAW_GAP = 46;
const GAP = 6;
const MIDLINE_GAP = 28;

export const CHART_WIDTH = 16 * TOOTH_W + 14 * GAP + MIDLINE_GAP;
export const CHART_HEIGHT = 2 * TOOTH_H + JAW_GAP;
export const MIDLINE_X = 8 * TOOTH_W + 7 * GAP + MIDLINE_GAP / 2;

export type ToothBox = { fdi: number; jaw: 'upper' | 'lower'; type: ToothType; x: number; y: number };

export function toothLayout(): ToothBox[] {
  const boxes: ToothBox[] = [];
  for (const jaw of ['upper', 'lower'] as const) {
    CHART_ORDER[jaw].forEach((fdi, i) => {
      const x = i < 8 ? i * (TOOTH_W + GAP) : MIDLINE_X + MIDLINE_GAP / 2 + (i - 8) * (TOOTH_W + GAP);
      boxes.push({ fdi, jaw, type: toothType(fdi), x, y: jaw === 'upper' ? 0 : TOOTH_H + JAW_GAP });
    });
  }
  return boxes;
}
```

Geometry check: `MIDLINE_X = 320 + 42 + 14 = 376`; tooth 11 ends at `322 + 40 = 362`; tooth 21
starts at `376 + 14 = 390`; tooth 28 starts at `390 + 7 × 46 = 712` and ends at `752 = CHART_WIDTH`.

`web/src/components/odontogram/shapes.ts`:
```ts
import type { ToothType } from '@/lib/patients/fdi';

type Shape = { crown: string; roots: string };

// Upper-jaw frame: roots point up (y 0–80), crown below (y 80–130), width 40.
const CROWNS: Record<ToothType, string> = {
  incisor: 'M10 80 L30 80 Q33 105 28 126 Q20 131 12 126 Q7 105 10 80 Z',
  canine: 'M9 80 L31 80 Q34 102 20 130 Q6 102 9 80 Z',
  premolar: 'M7 80 L33 80 Q37 100 32 124 Q20 130 8 124 Q3 100 7 80 Z',
  molar: 'M2 80 L38 80 Q42 100 37 124 Q28 130 20 126 Q12 130 3 124 Q-2 100 2 80 Z',
};

const ROOTS: Record<ToothType, { upper: string; lower: string }> = {
  incisor: {
    upper: 'M14 80 L17 8 Q20 2 23 8 L26 80 Z',
    lower: 'M15 80 L18 10 Q20 5 22 10 L25 80 Z',
  },
  canine: {
    upper: 'M14 80 L18 0 Q20 -4 22 0 L26 80 Z',
    lower: 'M14 80 L18 4 Q20 0 22 4 L26 80 Z',
  },
  premolar: {
    upper: 'M13 80 L17 12 Q20 6 23 12 L27 80 Z',
    lower: 'M13 80 L17 10 Q20 4 23 10 L27 80 Z',
  },
  molar: {
    upper: 'M5 80 L8 22 Q10 16 12 22 L16 80 Z M16 80 L19 14 Q21 8 23 14 L25 80 Z M25 80 L29 22 Q31 16 33 22 L36 80 Z',
    lower: 'M6 80 L10 18 Q12 12 14 18 L18 80 Z M22 80 L26 18 Q28 12 30 18 L34 80 Z',
  },
};

export function toothShape(type: ToothType, jaw: 'upper' | 'lower'): Shape {
  return { crown: CROWNS[type], roots: ROOTS[type][jaw] };
}
```

`web/src/components/odontogram/visuals.ts`:
```ts
import type { ToothState } from '@/lib/patients/types';

export type ToothVisual = {
  crownFill: string;
  stroke: string;
  dashed: boolean;
  showRoots: boolean;
  glyph: 'none' | 'cross' | 'fixture';
  fixture?: 'planned' | 'placed' | 'failed';
};

export const COLORS = {
  ink: '#334155',
  muted: '#94a3b8',
  faint: '#f1f5f9',
  planned: '#2563eb',
  restored: '#0369a1',
  failed: '#dc2626',
} as const;

export function toothVisual(status: ToothState): ToothVisual {
  switch (status) {
    case 'present':
      return { crownFill: '#ffffff', stroke: COLORS.ink, dashed: false, showRoots: true, glyph: 'none' };
    case 'missing':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'none' };
    case 'extracted':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'cross' };
    case 'implant_planned':
      return { crownFill: '#ffffff', stroke: COLORS.planned, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'planned' };
    case 'implant_placed':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'restored':
      return { crownFill: '#e0f2fe', stroke: COLORS.restored, dashed: false, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'failed':
      return { crownFill: '#fef2f2', stroke: COLORS.failed, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'failed' };
  }
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/odontogram
git commit -m "feat(odontogram): tooth layout, outlines and status visuals" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Odontogram and legend components

**Files:**
- Create: `web/src/components/odontogram/tooth-graphic.tsx`, `odontogram.tsx`, `legend.tsx`
- Test: `web/src/components/odontogram/odontogram.test.tsx`

**Interfaces:**
- Consumes: Task 4 modules; `STATE_LABELS`, `TOOTH_STATES`, `ToothState`.
- Produces: `<ToothGraphic type jaw status />` (SVG `<g>` in the upper-jaw frame, unflipped);
  `<Odontogram statuses={Partial<Record<number, ToothState>>} selected={number[]}
  onSelect={(fdi: number, additive: boolean) => void} />`; `<Legend />`.
  Each tooth is `role="button"`, `aria-label="Tooth 36, Missing"`, `aria-pressed`,
  `data-tooth`, `data-status`; click/Enter/Space select, Shift/Ctrl/⌘ make it additive.

- [ ] **Step 1: Write the failing tests** — `web/src/components/odontogram/odontogram.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Odontogram } from './odontogram';
import { Legend } from './legend';

describe('<Odontogram>', () => {
  it('renders all 32 teeth as buttons, present by default', () => {
    render(<Odontogram statuses={{}} selected={[]} onSelect={vi.fn()} />);
    const teeth = screen.getAllByRole('button', { name: /^Tooth \d\d, / });
    expect(teeth).toHaveLength(32);
    expect(screen.getByRole('button', { name: 'Tooth 36, Present' })).toBeInTheDocument();
  });

  it('shows each tooth’s status', () => {
    render(<Odontogram statuses={{ 36: 'missing', 46: 'implant_placed' }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tooth 36, Missing' })).toHaveAttribute('data-status', 'missing');
    const implant = screen.getByRole('button', { name: 'Tooth 46, Implant placed' });
    expect(implant.querySelector('[data-glyph="fixture"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Tooth 36, Missing' }).querySelector('[data-glyph="fixture"]')).toBeNull();
  });

  it('marks selected teeth as pressed', () => {
    render(<Odontogram statuses={{}} selected={[36]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tooth 36, Present' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tooth 46, Present' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects with click, shift/ctrl-click (additive) and the keyboard', () => {
    const onSelect = vi.fn();
    render(<Odontogram statuses={{}} selected={[]} onSelect={onSelect} />);
    const tooth = screen.getByRole('button', { name: 'Tooth 36, Present' });
    fireEvent.click(tooth);
    fireEvent.click(tooth, { shiftKey: true });
    fireEvent.click(tooth, { ctrlKey: true });
    fireEvent.keyDown(tooth, { key: 'Enter' });
    fireEvent.keyDown(tooth, { key: ' ', shiftKey: true });
    fireEvent.keyDown(tooth, { key: 'a' });
    expect(onSelect.mock.calls).toEqual([
      [36, false],
      [36, true],
      [36, true],
      [36, false],
      [36, true],
    ]);
  });
});

describe('<Legend>', () => {
  it('explains every status', () => {
    render(<Legend />);
    for (const label of ['Present', 'Missing', 'Extracted', 'Implant planned', 'Implant placed', 'Restored', 'Failed implant']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./odontogram`, `./legend`.

- [ ] **Step 3: Implement**

`web/src/components/odontogram/tooth-graphic.tsx`:
```tsx
import type { ToothType } from '@/lib/patients/fdi';
import type { ToothState } from '@/lib/patients/types';
import { toothShape } from './shapes';
import { COLORS, toothVisual, type ToothVisual } from './visuals';

function Fixture({ kind }: { kind: NonNullable<ToothVisual['fixture']> }) {
  const stroke = kind === 'planned' ? COLORS.planned : kind === 'failed' ? COLORS.failed : '#475569';
  return (
    <g data-glyph="fixture">
      <path
        d="M14 84 L14 22 L20 10 L26 22 L26 84 Z"
        fill={kind === 'planned' ? 'none' : '#cbd5e1'}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={kind === 'planned' ? '3 2' : undefined}
      />
      {[34, 46, 58, 70].map((y) => (
        <path key={y} d={`M12 ${y} L28 ${y - 4}`} stroke={stroke} strokeWidth={1} />
      ))}
      {kind === 'failed' && <path d="M4 20 L36 120 M36 20 L4 120" stroke={COLORS.failed} strokeWidth={3} />}
    </g>
  );
}

/** One tooth in the upper-jaw frame (40 × 130). Callers flip it for the lower jaw. */
export function ToothGraphic({ type, jaw, status }: { type: ToothType; jaw: 'upper' | 'lower'; status: ToothState }) {
  const visual = toothVisual(status);
  const shape = toothShape(type, jaw);
  return (
    <g>
      {visual.showRoots && <path d={shape.roots} fill="#ffffff" stroke={visual.stroke} strokeWidth={1.5} />}
      {visual.glyph === 'fixture' && visual.fixture && <Fixture kind={visual.fixture} />}
      <path
        d={shape.crown}
        fill={visual.crownFill}
        stroke={visual.stroke}
        strokeWidth={1.5}
        strokeDasharray={visual.dashed ? '4 3' : undefined}
      />
      {visual.glyph === 'cross' && <path d="M8 86 L32 124 M32 86 L8 124" stroke="#64748b" strokeWidth={2.5} />}
    </g>
  );
}
```

`web/src/components/odontogram/odontogram.tsx`:
```tsx
'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { STATE_LABELS, type ToothState } from '@/lib/patients/types';
import { CHART_HEIGHT, CHART_WIDTH, MIDLINE_X, TOOTH_H, TOOTH_W, JAW_GAP, toothLayout, type ToothBox } from './layout';
import { ToothGraphic } from './tooth-graphic';

type Props = {
  statuses: Partial<Record<number, ToothState>>;
  selected: readonly number[];
  onSelect: (fdi: number, additive: boolean) => void;
};

const BOXES = toothLayout();

function Tooth({ box, status, selected, onSelect }: { box: ToothBox; status: ToothState; selected: boolean; onSelect: Props['onSelect'] }) {
  const transform =
    box.jaw === 'upper' ? `translate(${box.x} ${box.y})` : `translate(${box.x} ${box.y + TOOTH_H}) scale(1 -1)`;
  const numberY = box.jaw === 'upper' ? TOOTH_H + 18 : box.y - 9;
  const additive = (e: MouseEvent | KeyboardEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}`}
      aria-pressed={selected}
      data-tooth={box.fdi}
      data-status={status}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-blue-600"
      onClick={(e) => onSelect(box.fdi, additive(e))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(box.fdi, additive(e));
        }
      }}
    >
      <rect
        x={box.x - 3}
        y={box.y - 3}
        width={TOOTH_W + 6}
        height={TOOTH_H + 6}
        rx={6}
        fill={selected ? '#dbeafe' : 'transparent'}
        stroke={selected ? '#2563eb' : 'transparent'}
        strokeWidth={2}
      />
      <g transform={transform}>
        <ToothGraphic type={box.type} jaw={box.jaw} status={status} />
      </g>
      <text x={box.x + TOOTH_W / 2} y={numberY} textAnchor="middle" fontSize={13} fill="#334155">
        {box.fdi}
      </text>
    </g>
  );
}

export function Odontogram({ statuses, selected, onSelect }: Props) {
  return (
    <svg
      viewBox={`-6 -6 ${CHART_WIDTH + 12} ${CHART_HEIGHT + 12}`}
      className="h-auto w-full max-w-4xl select-none"
      role="group"
      aria-label="Odontogram"
    >
      <line x1={-4} x2={CHART_WIDTH + 4} y1={TOOTH_H + JAW_GAP / 2} y2={TOOTH_H + JAW_GAP / 2} stroke="#0f172a" strokeWidth={2.5} />
      <line x1={MIDLINE_X} x2={MIDLINE_X} y1={TOOTH_H - 30} y2={TOOTH_H + JAW_GAP + 30} stroke="#0f172a" strokeWidth={2.5} />
      {BOXES.map((box) => (
        <Tooth
          key={box.fdi}
          box={box}
          status={statuses[box.fdi] ?? 'present'}
          selected={selected.includes(box.fdi)}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}
```

`web/src/components/odontogram/legend.tsx`:
```tsx
import { STATE_LABELS, TOOTH_STATES } from '@/lib/patients/types';
import { ToothGraphic } from './tooth-graphic';

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700" aria-label="Legend">
      {TOOTH_STATES.map((state) => (
        <li key={state} className="flex items-center gap-2">
          <svg viewBox="-2 -6 44 140" width={14} height={40} aria-hidden="true">
            <ToothGraphic type="premolar" jaw="upper" status={state} />
          </svg>
          <span>{STATE_LABELS[state]}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/odontogram
git commit -m "feat(odontogram): interactive SVG chart and legend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Patients list, search and new patient

**Files:**
- Create: `web/tests/e2e/patients.ts`, `web/tests/e2e/global-teardown.ts`, `web/tests/e2e/patients.spec.ts`
- Create: `web/src/app/(app)/patients/page.tsx`, `web/src/app/(app)/patients/actions.ts`,
  `web/src/app/(app)/patients/new/page.tsx`, `web/src/app/(app)/patients/new/patient-form.tsx`
- Modify: `web/src/components/nav-items.ts`, `web/src/components/nav-items.test.ts`,
  `web/src/lib/auth/session.ts`, `web/playwright.config.ts`

**Interfaces:**
- Consumes: `patientSchema`, `toPatientRow`, `FormState`, `failed`, `valueOf`, `ageOn`, `Patient`.
- Produces: `requireActiveUser(): Promise<Profile>` (`@/lib/auth/session`); action
  `createPatient(prev: FormState, formData): Promise<FormState>` and
  `updatePatient(prev, formData)` (Task 7 uses it) in `@/app/(app)/patients/actions`;
  `<PatientForm mode="create" | "edit" patient? action />` (Task 7 reuses it);
  E2E helpers `uniqueName(label)`, `createPatientViaUi(page, fields): Promise<string /* id */>`,
  `deleteE2ePatients()`.

- [ ] **Step 1: Add Patients to the nav (test first)** — in `web/src/components/nav-items.test.ts`
  change the two expectations to:

```ts
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual(['Dashboard', 'Patients', 'Admin']);
```
```ts
    expect(visibleNavItems('organizer').map((i) => i.label)).toEqual(['Dashboard', 'Patients']);
```

Run: `npm test -- nav-items` → FAIL. Then in `web/src/components/nav-items.ts` insert after the
Dashboard entry:

```ts
  { href: '/patients', label: 'Patients' },
```

Run: `npm test -- nav-items` → PASS.

- [ ] **Step 2: E2E helpers and teardown**

`web/tests/e2e/patients.ts`:
```ts
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';

export const E2E_PREFIX = 'E2E ';

export function uniqueName(label: string): string {
  return `${E2E_PREFIX}${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export async function createPatientViaUi(
  page: Page,
  fields: { full_name: string; phone?: string; dob?: string; file_no?: string },
): Promise<string> {
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(fields.full_name);
  if (fields.file_no) await page.getByLabel('File number').fill(fields.file_no);
  if (fields.dob) await page.getByLabel('Date of birth').fill(fields.dob);
  if (fields.phone) await page.getByLabel('Phone').fill(fields.phone);
  await page.getByRole('button', { name: 'Save patient' }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: fields.full_name })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** E2E patients are real rows in the dev project; remove them (as postgres) after the run. */
export async function deleteE2ePatients(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query(`delete from public.patients where full_name like $1`, [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}
```

`web/tests/e2e/global-teardown.ts`:
```ts
import '../../scripts/load-env';
import { assertSafeTestTarget } from '../../scripts/test-guard';
import { deleteE2ePatients } from './patients';

export default async function globalTeardown() {
  assertSafeTestTarget();
  await deleteE2ePatients();
}
```

In `web/playwright.config.ts` add below `globalSetup`:
```ts
  globalTeardown: './tests/e2e/global-teardown.ts',
```

- [ ] **Step 3: Write the failing E2E tests** — `web/tests/e2e/patients.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('creates a patient and lands on their chart', async ({ page }) => {
  const name = uniqueName('Amira');
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('link', { name: 'New patient' }).click();
  await createPatientViaUi(page, { full_name: name, dob: '1980-05-20', phone: '0100 555 1234' });
  await expect(page.getByRole('group', { name: 'Odontogram' })).toBeVisible();
  await expect(page.getByTestId('patient-header')).toContainText(/File P\d{5,}/);
});

test('finds patients by name, file number and phone', async ({ page }) => {
  const name = uniqueName('Search');
  const fileNo = `E2E-${Date.now()}`;
  await createPatientViaUi(page, { full_name: name, file_no: fileNo, phone: '+20 122 777 8899' });
  for (const q of [name.slice(4, 14), fileNo.toLowerCase(), '1227778899']) {
    await page.goto(`/patients?q=${encodeURIComponent(q)}`);
    await expect(page.getByTestId(`patient-row-${fileNo}`)).toBeVisible();
  }
  await page.goto('/patients?q=%25_%27');
  await expect(page.getByRole('main')).toContainText('No patients found.');
});

test('invalid DOB keeps input', async ({ page }) => {
  const name = uniqueName('Dob');
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Phone').fill('0100');
  await page.getByLabel('Date of birth').fill('2999-01-01');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter a real date of birth (not in the future, after 1900).');
  await expect(page.getByLabel('Full name')).toHaveValue(name);
  await expect(page.getByLabel('Phone')).toHaveValue('0100');
});

test('duplicate file number', async ({ page }) => {
  const fileNo = `E2E-DUP-${Date.now()}`;
  await createPatientViaUi(page, { full_name: uniqueName('First'), file_no: fileNo });
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(uniqueName('Second'));
  await page.getByLabel('File number').fill(fileNo);
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(`File number ${fileNo} is already used by another patient.`);
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm run test:e2e -- patients.spec.ts`
Expected: FAIL — no "Patients" link / `/patients/new` is 404.

- [ ] **Step 5: `requireActiveUser`** — append to `web/src/lib/auth/session.ts`:

```ts
/** For server actions: actions can be called directly, so don't rely on the layout's check. */
export async function requireActiveUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  return profile;
}
```

- [ ] **Step 6: Patient actions** — `web/src/app/(app)/patients/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { patientSchema, toPatientRow } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { staleMessage } from '@/lib/patients/conflict-server';

const SAVE_FAILED = 'The patient could not be saved. Please try again.';

function saveError(error: { code?: string; message: string }, fileNo: string): string {
  if (error.code === '23505') return `File number ${fileNo} is already used by another patient.`;
  console.error('Patient save failed:', error.message);
  return SAVE_FAILED;
}

export async function createPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = patientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('patients').insert(toPatientRow(parsed.data)).select('id').single();
  if (error) return failed(saveError(error, parsed.data.file_no), formData);
  redirect(`/patients/${data.id}`);
}

export async function updatePatient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const expected = String(formData.get('expected_updated_at') ?? '');
  const parsed = patientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('patients')
    .update(toPatientRow(parsed.data))
    .eq('id', id)
    .eq('updated_at', expected)
    .select('id');
  if (error) return failed(saveError(error, parsed.data.file_no), formData);
  if (!data?.length) return failed(await staleMessage(supabase, 'patients', id), formData);
  revalidatePath(`/patients/${id}`, 'layout');
  return { ok: 'Patient details saved.' };
}

export async function setArchived(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const archived = formData.get('archived') === 'true';
  const supabase = await createClient();
  const { data, error } = await supabase.from('patients').update({ archived }).eq('id', id).select('id');
  if (error || !data?.length) return { error: 'The patient could not be updated. Please try again.' };
  revalidatePath(`/patients/${id}`, 'layout');
  return { ok: archived ? 'Patient archived.' : 'Patient restored.' };
}
```

`web/src/lib/patients/conflict-server.ts`:
```ts
import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { formatConflict } from './conflict';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Who last changed this row, from the audit log — for "changed by … reload" messages. */
export async function staleMessage(supabase: Supabase, table: string, rowId: string): Promise<string> {
  const { data: last } = await supabase
    .from('audit_log')
    .select('at, user_id')
    .eq('table_name', table)
    .eq('row_id', rowId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  let name: string | null = null;
  if (last?.user_id) {
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('user_id', last.user_id).maybeSingle();
    name = profile?.full_name || profile?.email || null;
  }
  return formatConflict(name, last?.at ?? null);
}
```

- [ ] **Step 7: Shared patient form** — `web/src/app/(app)/patients/new/patient-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { Patient } from '@/lib/patients/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  patient?: Patient;
};

export function PatientForm({ action, patient }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Patient) => valueOf(state, key, (patient?.[key] as string | null | undefined) ?? '');
  return (
    <form action={formAction} className="card grid max-w-2xl gap-4 sm:grid-cols-2">
      {patient && (
        <>
          <input type="hidden" name="id" value={patient.id} readOnly />
          <input type="hidden" name="expected_updated_at" value={patient.updated_at} readOnly />
        </>
      )}
      <label className="block sm:col-span-2">
        <span className="label">Full name</span>
        <input className="input" name="full_name" required defaultValue={v('full_name')} />
      </label>
      <label className="block">
        <span className="label">File number</span>
        <input className="input" name="file_no" placeholder={patient ? undefined : 'Assigned automatically'} defaultValue={v('file_no')} />
      </label>
      <label className="block">
        <span className="label">Date of birth</span>
        <input className="input" name="dob" type="date" defaultValue={v('dob')} />
      </label>
      <label className="block">
        <span className="label">Sex</span>
        <select className="input" name="sex" defaultValue={v('sex')}>
          <option value="">—</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
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
        <span className="label">Address</span>
        <input className="input" name="address" defaultValue={v('address')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          Save patient
        </button>
      </div>
    </form>
  );
}
```

Note: the date input deliberately has no `max` so the server's message is what the user sees.

- [ ] **Step 8: New patient page** — `web/src/app/(app)/patients/new/page.tsx`:

```tsx
import { PatientForm } from './patient-form';
import { createPatient } from '../actions';

export default function NewPatientPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New patient</h1>
      <PatientForm action={createPatient} />
    </div>
  );
}
```

- [ ] **Step 9: Patients list** — `web/src/app/(app)/patients/page.tsx`:

```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ageOn } from '@/lib/patients/age';
import type { Patient } from '@/lib/patients/types';

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { q = '', archived } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_patients', { q, include_archived: archived === '1' });
  if (error) throw new Error('Could not load patients');
  const patients = (data ?? []) as Patient[];
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <Link href="/patients/new" className="btn">
          New patient
        </Link>
      </div>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Search patients</span>
          <input className="input" name="q" defaultValue={q} placeholder="Name, file number or phone" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived === '1'} />
          Include archived
        </label>
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {patients.length === 0 ? (
          <p className="text-gray-600">No patients found.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">File</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Age</th>
                <th className="pb-2">Phone</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} data-testid={`patient-row-${p.file_no}`} className="border-t border-gray-200">
                  <td className="py-2 pr-4">{p.file_no}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${p.id}`} className="text-blue-700 hover:underline">
                      {p.full_name}
                    </Link>
                    {p.archived && <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-600">Archived</span>}
                  </td>
                  <td className="py-2 pr-4">{ageOn(p.dob, today) ?? '—'}</td>
                  <td className="py-2">{p.phone || '—'}</td>
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

- [ ] **Step 10: Minimal patient page so a new patient has somewhere to land** — these two
  files are deliberately minimal; Task 7 replaces the layout (header + tabs) and Task 8 replaces
  the page (interactive chart).

`web/src/app/(app)/patients/[id]/layout.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: patient } = await supabase.from('patients').select('full_name, file_no').eq('id', id).maybeSingle();
  if (!patient) notFound();
  return (
    <div className="space-y-6">
      <div data-testid="patient-header">
        <h1 className="text-2xl font-semibold">{patient.full_name}</h1>
        <p className="text-sm text-gray-600">File {patient.file_no}</p>
      </div>
      {children}
    </div>
  );
}
```

`web/src/app/(app)/patients/[id]/page.tsx`:
```tsx
'use client';

import { Odontogram } from '@/components/odontogram/odontogram';

export default function PatientChartPage() {
  return <Odontogram statuses={{}} selected={[]} onSelect={() => {}} />;
}
```

- [ ] **Step 11: Run E2E tests**

Run: `npm run test:e2e -- patients.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 12: Commit**

```bash
git add web
git commit -m "feat(patients): patient list, search and new patient form" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Patient header, tabs and Overview (details, medical history, archive, concurrency)

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/layout.tsx` (replace temporary version)
- Create: `web/src/app/(app)/patients/[id]/patient-tabs.tsx`,
  `web/src/app/(app)/patients/[id]/overview/page.tsx`,
  `web/src/app/(app)/patients/[id]/overview/medical-history-form.tsx`,
  `web/src/app/(app)/patients/[id]/overview/archive-button.tsx`,
  `web/src/app/(app)/patients/[id]/overview/actions.ts`
- Test: `web/tests/e2e/patient-overview.spec.ts`

**Interfaces:**
- Consumes: `PatientForm`, `updatePatient`, `setArchived` (Task 6); `medicalHistorySchema`,
  `medicalAlerts`, `ageOn`, `staleMessage`, `FormState`, `failed`, `checkedOf`, `valueOf`.
- Produces: action `saveMedicalHistory(prev, formData)`; header `data-testid="patient-header"`
  with badges `data-testid="medical-alert"`; tabs nav `aria-label="Patient sections"`.

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/patient-overview.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test('header shows age and medical alerts; tabs are present', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Alerts'), dob: '1970-01-15' });
  const header = page.getByTestId('patient-header');
  await expect(header).toContainText(/Age \d+/);
  await expect(page.getByRole('navigation', { name: 'Patient sections' }).getByRole('link')).toHaveText([
    'Chart', 'Overview', 'Notes', 'History',
  ]);

  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByLabel('Allergies').fill('Penicillin');
  await page.getByLabel('Bisphosphonates').check();
  await page.getByRole('button', { name: 'Save medical history' }).click();
  await expect(page.getByText('Medical history saved.')).toBeVisible();
  await expect(header.getByTestId('medical-alert')).toHaveText(['Allergy: Penicillin', 'Bisphosphonates']);

  await page.goto(`/patients/${id}`);
  await expect(page.getByTestId('patient-header').getByTestId('medical-alert')).toHaveCount(2);
});

test('edits details and archives / restores', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Edit') });
  await page.goto(`/patients/${id}/overview`);
  await page.getByLabel('Phone').fill('0111 222 3333');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByText('Patient details saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Phone')).toHaveValue('0111 222 3333');

  await page.getByRole('button', { name: 'Archive patient' }).click();
  await expect(page.getByTestId('patient-header')).toContainText('Archived');
  await page.getByRole('button', { name: 'Restore patient' }).click();
  await expect(page.getByTestId('patient-header')).not.toContainText('Archived');
});

test('stale save shows who changed it', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(a, { full_name: uniqueName('Conflict') });
  await login(b, TEST_USERS.admin.email);
  await a.goto(`/patients/${id}/overview`);
  await b.goto(`/patients/${id}/overview`);

  await b.getByLabel('Phone').fill('0100 000 0001');
  await b.getByRole('button', { name: 'Save patient' }).click();
  await expect(b.getByText('Patient details saved.')).toBeVisible();

  await a.getByLabel('Phone').fill('0100 000 0002');
  await a.getByRole('button', { name: 'Save patient' }).click();
  await expect(a.getByRole('main').getByRole('alert')).toHaveText(
    /^This record was changed by Test Admin at \d\d:\d\d\. Reload to see it\.$/,
  );
  await expect(a.getByLabel('Phone')).toHaveValue('0100 000 0002');
  await a.close();
  await b.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e -- patient-overview.spec.ts`
Expected: FAIL — no "Age", no tabs, `/overview` is 404.

- [ ] **Step 3: Medical history action** — `web/src/app/(app)/patients/[id]/overview/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { medicalHistorySchema } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { staleMessage } from '@/lib/patients/conflict-server';

export async function saveMedicalHistory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const patientId = String(formData.get('patient_id') ?? '');
  const expected = String(formData.get('expected_updated_at') ?? '');
  const parsed = medicalHistorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('medical_history')
    .update(parsed.data)
    .eq('patient_id', patientId)
    .eq('updated_at', expected)
    .select('patient_id');
  if (error) {
    console.error('Medical history save failed:', error.message);
    return failed('The medical history could not be saved. Please try again.', formData);
  }
  if (!data?.length) return failed(await staleMessage(supabase, 'medical_history', patientId), formData);
  revalidatePath(`/patients/${patientId}`, 'layout');
  return { ok: 'Medical history saved.' };
}
```

- [ ] **Step 4: Full patient layout** — replace `web/src/app/(app)/patients/[id]/layout.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ageOn } from '@/lib/patients/age';
import { medicalAlerts } from '@/lib/patients/alerts';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { PatientTabs } from './patient-tabs';

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: patient }, { data: history }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
  ]);
  if (!patient) notFound();
  const p = patient as Patient;
  const age = ageOn(p.dob, new Date());
  const alerts = medicalAlerts(history as MedicalHistory | null);

  return (
    <div className="space-y-4">
      <header data-testid="patient-header" className="card flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
        <h1 className="text-2xl font-semibold">{p.full_name}</h1>
        <span className="text-sm text-gray-600">File {p.file_no}</span>
        {age !== null && <span className="text-sm text-gray-600">Age {age}</span>}
        {p.sex && <span className="text-sm capitalize text-gray-600">{p.sex}</span>}
        {p.archived && <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700">Archived</span>}
        {alerts.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Medical alerts">
            {alerts.map((alert) => (
              <li key={alert} data-testid="medical-alert" className="rounded bg-red-100 px-2 py-0.5 text-sm font-medium text-red-800">
                {alert}
              </li>
            ))}
          </ul>
        )}
      </header>
      <PatientTabs patientId={p.id} />
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Tabs** — `web/src/app/(app)/patients/[id]/patient-tabs.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function PatientTabs({ patientId }: { patientId: string }) {
  const pathname = usePathname();
  const base = `/patients/${patientId}`;
  const tabs = [
    { href: base, label: 'Chart' },
    { href: `${base}/overview`, label: 'Overview' },
    { href: `${base}/notes`, label: 'Notes' },
    { href: `${base}/history`, label: 'History' },
  ];
  return (
    <nav aria-label="Patient sections" className="flex gap-1 border-b border-gray-200">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Medical history form** — `web/src/app/(app)/patients/[id]/overview/medical-history-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { MedicalHistory } from '@/lib/patients/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { saveMedicalHistory } from './actions';

const FLAGS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'bisphosphonates', label: 'Bisphosphonates' },
  { key: 'anticoagulants', label: 'Anticoagulants' },
  { key: 'radiotherapy_head_neck', label: 'Head/neck radiotherapy' },
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'osteoporosis', label: 'Osteoporosis' },
  { key: 'smoker', label: 'Smoker' },
];

const TEXTS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'other_conditions', label: 'Other conditions' },
  { key: 'notes', label: 'Notes' },
];

export function MedicalHistoryForm({ history }: { history: MedicalHistory }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMedicalHistory, {});
  return (
    <form action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Medical history</h2>
      <input type="hidden" name="patient_id" value={history.patient_id} readOnly />
      <input type="hidden" name="expected_updated_at" value={history.updated_at} readOnly />
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="label">Conditions relevant to implants</legend>
        {FLAGS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={key} defaultChecked={checkedOf(state, key, history[key] as boolean)} />
            {label}
          </label>
        ))}
      </fieldset>
      {TEXTS.map(({ key, label }) => (
        <label key={key} className="block">
          <span className="label">{label}</span>
          <textarea className="input" name={key} rows={2} defaultValue={valueOf(state, key, history[key] as string)} />
        </label>
      ))}
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save medical history
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Archive button** — `web/src/app/(app)/patients/[id]/overview/archive-button.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { setArchived } from '../../actions';

export function ArchiveButton({ patientId, archived }: { patientId: string; archived: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setArchived, {});
  return (
    <form action={action} className="card max-w-2xl space-y-2">
      <h2 className="font-semibold">{archived ? 'Archived patient' : 'Archive'}</h2>
      <p className="text-sm text-gray-600">
        Archived patients are hidden from search but keep their full record. Nothing is deleted.
      </p>
      <input type="hidden" name="id" value={patientId} readOnly />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} readOnly />
      <button className="btn-secondary btn" disabled={pending}>
        {archived ? 'Restore patient' : 'Archive patient'}
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Overview page** — `web/src/app/(app)/patients/[id]/overview/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { PatientForm } from '../../new/patient-form';
import { updatePatient } from '../../actions';
import { MedicalHistoryForm } from './medical-history-form';
import { ArchiveButton } from './archive-button';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: patient }, { data: history }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
  ]);
  if (!patient || !history) notFound();
  const p = patient as Patient;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Details</h2>
        <PatientForm key={p.updated_at} action={updatePatient} patient={p} />
      </section>
      <MedicalHistoryForm key={(history as MedicalHistory).updated_at} history={history as MedicalHistory} />
      <ArchiveButton patientId={p.id} archived={p.archived} />
    </div>
  );
}
```

Note: `key={updated_at}` remounts each form after a successful save so the hidden version
field and defaults reflect the new row; after a failed save the key is unchanged, so the
returned `values` keep the user's input.

- [ ] **Step 9: Run E2E tests**

Run: `npm run test:e2e -- patient-overview.spec.ts patients.spec.ts`
Expected: PASS (3 + 4).

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat(patients): patient header with alerts, tabs and overview editing with conflict detection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Chart tab — interactive odontogram with status panel

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/page.tsx` (replace temporary version)
- Create: `web/src/app/(app)/patients/[id]/chart-panel.tsx`, `web/src/app/(app)/patients/[id]/chart-actions.ts`
- Test: `web/tests/e2e/chart.spec.ts`

**Interfaces:**
- Consumes: `Odontogram`, `Legend`, `toothStatusSchema`, `isManualState`, `MANUAL_STATES`,
  `STATE_LABELS`, `isFdiTooth`, `requireActiveUser`.
- Produces: action `setToothStatus(input: { patientId: string; teeth: number[]; status: string }):
  Promise<{ error?: string }>`; side panel `aria-label="Tooth details"` with buttons
  "Mark present", "Mark missing", "Mark extracted".

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/chart.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('marks a tooth missing and it stays missing', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Chart') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel.getByRole('heading', { name: 'Tooth 36' })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark missing' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();
  await page.goto(`/patients/${id}`);
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();
});

test('bulk-marks several teeth with shift-click', async ({ page }) => {
  await createPatientViaUi(page, { full_name: uniqueName('Bulk') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await page.getByRole('button', { name: 'Tooth 46, Present' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Tooth 18, Present' }).click({ modifiers: ['Control'] });
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel.getByRole('heading', { name: '3 teeth: 18, 36, 46' })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark extracted' }).click();
  for (const tooth of [18, 36, 46]) {
    await expect(page.getByRole('button', { name: `Tooth ${tooth}, Extracted` })).toBeVisible();
  }
});

test('?tooth= pre-selects a tooth', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Deep link') });
  await page.goto(`/patients/${id}?tooth=24`);
  await expect(page.getByRole('button', { name: 'Tooth 24, Present' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Tooth details' }).getByRole('heading', { name: 'Tooth 24' })).toBeVisible();
});

test('implant teeth are locked in the panel', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Locked') });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 46, 'implant_placed')", [id]);
  } finally {
    await pg.end();
  }
  await page.goto(`/patients/${id}?tooth=46`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel).toContainText('Teeth with implant records (46) are changed from the implant workflow, not here.');
  await expect(panel.getByRole('button', { name: /^Mark / })).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e -- chart.spec.ts`
Expected: FAIL — no "Tooth details" panel.

- [ ] **Step 3: Chart action** — `web/src/app/(app)/patients/[id]/chart-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { toothStatusSchema } from '@/lib/patients/schemas';
import { isManualState } from '@/lib/patients/types';

export async function setToothStatus(input: { patientId: string; teeth: number[]; status: string }): Promise<{ error?: string }> {
  await requireActiveUser();
  const parsed = toothStatusSchema.safeParse({ patient_id: input.patientId, teeth: input.teeth, status: input.status });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { patient_id, teeth, status } = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('tooth_status')
    .select('tooth, status')
    .eq('patient_id', patient_id)
    .in('tooth', teeth);
  if (readError) return { error: 'The chart could not be loaded. Please try again.' };

  const currentByTooth = new Map((current ?? []).map((row) => [row.tooth as number, row.status as string]));
  const locked = teeth.filter((t) => !isManualState(currentByTooth.get(t) ?? 'present'));
  if (locked.length) return { error: `Teeth ${locked.join(', ')} have implant records and can't be changed here.` };

  const rows = teeth
    .filter((t) => (currentByTooth.get(t) ?? 'present') !== status)
    .map((tooth) => ({ patient_id, tooth, status }));
  if (rows.length === 0) return {};

  const { data, error } = await supabase.from('tooth_status').upsert(rows, { onConflict: 'patient_id,tooth' }).select('tooth');
  if (error || (data?.length ?? 0) !== rows.length) {
    console.error('Tooth status save failed:', error?.message ?? 'row count mismatch');
    return { error: 'The chart could not be saved. Please try again.' };
  }
  revalidatePath(`/patients/${patient_id}`);
  return {};
}
```

- [ ] **Step 4: Chart panel** — `web/src/app/(app)/patients/[id]/chart-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Odontogram } from '@/components/odontogram/odontogram';
import { Legend } from '@/components/odontogram/legend';
import { MANUAL_STATES, STATE_LABELS, isManualState, type ManualState, type ToothState } from '@/lib/patients/types';
import { setToothStatus } from './chart-actions';

type Props = {
  patientId: string;
  statuses: Partial<Record<number, ToothState>>;
  initialTooth: number | null;
};

export function ChartPanel({ patientId, statuses, initialTooth }: Props) {
  const [selected, setSelected] = useState<number[]>(initialTooth ? [initialTooth] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSelect(fdi: number, additive: boolean) {
    setError(null);
    setSelected((current) => {
      if (additive) {
        return current.includes(fdi) ? current.filter((t) => t !== fdi) : [...current, fdi].sort((a, b) => a - b);
      }
      return current.length === 1 && current[0] === fdi ? [] : [fdi];
    });
  }

  function apply(status: ManualState) {
    startTransition(async () => {
      const result = await setToothStatus({ patientId, teeth: selected, status });
      setError(result.error ?? null);
    });
  }

  const statusOf = (t: number): ToothState => statuses[t] ?? 'present';
  const locked = selected.filter((t) => !isManualState(statusOf(t)));

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="card flex-1 space-y-4">
        <Odontogram statuses={statuses} selected={selected} onSelect={onSelect} />
        <Legend />
      </div>
      <aside className="card w-full space-y-4 xl:w-80" aria-label="Tooth details">
        {selected.length === 0 ? (
          <p className="text-sm text-gray-600">
            Click a tooth to see and change its status. Shift- or Ctrl-click to select several teeth.
          </p>
        ) : (
          <>
            <h2 className="font-semibold">
              {selected.length === 1 ? `Tooth ${selected[0]}` : `${selected.length} teeth: ${selected.join(', ')}`}
            </h2>
            <ul className="space-y-1 text-sm">
              {selected.map((t) => (
                <li key={t}>
                  Tooth {t}: {STATE_LABELS[statusOf(t)]}
                </li>
              ))}
            </ul>
            {locked.length > 0 ? (
              <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                Teeth with implant records ({locked.join(', ')}) are changed from the implant workflow, not here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATES.map((state) => (
                  <button key={state} className="btn-secondary btn" disabled={pending} onClick={() => apply(state)}>
                    Mark {STATE_LABELS[state].toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          </>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Chart page** — replace `web/src/app/(app)/patients/[id]/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { isFdiTooth } from '@/lib/patients/fdi';
import type { ToothState } from '@/lib/patients/types';
import { ChartPanel } from './chart-panel';

export default async function PatientChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tooth?: string }>;
}) {
  const { id } = await params;
  const { tooth } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from('tooth_status').select('tooth, status').eq('patient_id', id);
  if (error) throw new Error('Could not load the chart');
  const statuses: Partial<Record<number, ToothState>> = {};
  for (const row of data ?? []) statuses[row.tooth as number] = row.status as ToothState;
  const initial = Number(tooth);
  return <ChartPanel patientId={id} statuses={statuses} initialTooth={isFdiTooth(initial) ? initial : null} />;
}
```

- [ ] **Step 6: Run E2E tests**

Run: `npm run test:e2e -- chart.spec.ts patients.spec.ts`
Expected: PASS (4 + 4).

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(patients): chart tab with odontogram, multi-select and tooth status panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Notes tab

**Files:**
- Create: `web/src/app/(app)/patients/[id]/notes/page.tsx`, `notes/note-form.tsx`, `notes/actions.ts`
- Test: `web/tests/e2e/notes.spec.ts`

**Interfaces:**
- Consumes: `noteSchema`, `FormState`, `failed`, `valueOf`, `VisitNote`, `formatDate`, `formatDateTime`.
- Produces: action `addNote(prev, formData)`; notes list items `data-testid="visit-note"`;
  tooth chips link to `/patients/[id]?tooth=NN`.

- [ ] **Step 1: Write the failing E2E tests** — `web/tests/e2e/notes.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('adds a note with teeth that link to the chart', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Notes') });
  await page.getByRole('link', { name: 'Notes' }).click();
  await page.getByLabel('Note').fill('Sutures removed, healing well.');
  await page.getByLabel('Teeth (optional)').fill('46, 36 36');
  await page.getByRole('button', { name: 'Add note' }).click();
  const note = page.getByTestId('visit-note').first();
  await expect(note).toContainText('Sutures removed, healing well.');
  await expect(note).toContainText('Test Organizer');
  await expect(note.getByRole('link')).toHaveText(['36', '46']);
  await expect(page.getByLabel('Note')).toHaveValue('');
  await note.getByRole('link', { name: '36' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${id}\\?tooth=36$`));
});

test('invalid tooth in note is rejected and the text is kept', async ({ page }) => {
  await createPatientViaUi(page, { full_name: uniqueName('Bad tooth') });
  await page.getByRole('link', { name: 'Notes' }).click();
  await page.getByLabel('Note').fill('Check 19');
  await page.getByLabel('Teeth (optional)').fill('19');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    '"19" is not a tooth number. Use FDI numbers 11–48 (e.g. 36, 46).',
  );
  await expect(page.getByLabel('Note')).toHaveValue('Check 19');
  await expect(page.getByTestId('visit-note')).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e -- notes.spec.ts`
Expected: FAIL — `/notes` is 404.

- [ ] **Step 3: Implement**

`web/src/app/(app)/patients/[id]/notes/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { noteSchema } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';

export async function addNote(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const patientId = String(formData.get('patient_id') ?? '');
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('visit_notes').insert({ patient_id: patientId, ...parsed.data });
  if (error) {
    console.error('Note save failed:', error.message);
    return failed('The note could not be saved. Please try again.', formData);
  }
  revalidatePath(`/patients/${patientId}/notes`);
  return { ok: 'Note added.' };
}
```

`web/src/app/(app)/patients/[id]/notes/note-form.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { addNote } from './actions';

export function NoteForm({ patientId, today }: { patientId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addNote, {});
  return (
    <form action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Add a note</h2>
      <input type="hidden" name="patient_id" value={patientId} readOnly />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Visit date</span>
          <input className="input" name="visit_date" type="date" defaultValue={valueOf(state, 'visit_date', today)} />
        </label>
        <label className="block">
          <span className="label">Teeth (optional)</span>
          <input className="input" name="teeth" placeholder="e.g. 36, 46" defaultValue={valueOf(state, 'teeth', '')} />
        </label>
      </div>
      <label className="block">
        <span className="label">Note</span>
        <textarea className="input" name="text" rows={4} defaultValue={valueOf(state, 'text', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>
        Add note
      </button>
    </form>
  );
}
```

`web/src/app/(app)/patients/[id]/notes/page.tsx`:
```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime } from '@/lib/format';
import type { VisitNote } from '@/lib/patients/types';
import { NoteForm } from './note-form';

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('visit_notes')
    .select('id, visit_date, text, teeth, created_at, author:profiles(full_name, email)')
    .eq('patient_id', id)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error('Could not load notes');
  const notes = (data ?? []) as unknown as VisitNote[];

  return (
    <div className="space-y-6">
      <NoteForm patientId={id} today={cairoToday()} />
      <section className="space-y-3">
        <h2 className="font-semibold">Notes</h2>
        {notes.length === 0 && <p className="text-sm text-gray-600">No notes yet.</p>}
        <ol className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} data-testid="visit-note" className="card space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-x-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{formatDate(note.visit_date)}</span>
                <span>{note.author?.full_name || note.author?.email || 'Unknown'}</span>
                <span>written {formatDateTime(note.created_at)}</span>
                {note.teeth.length > 0 && (
                  <span className="flex gap-1">
                    {note.teeth.map((t) => (
                      <Link key={t} href={`/patients/${id}?tooth=${t}`} className="rounded bg-blue-50 px-1.5 text-blue-800 hover:underline">
                        {t}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run E2E tests**

Run: `npm run test:e2e -- notes.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(patients): visit notes with tooth links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: History tab

**Files:**
- Create: `web/src/app/(app)/patients/[id]/history/page.tsx`
- Test: `web/tests/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `patient_history()` (Task 2), `describeChange`, `HistoryEntry`, `formatDateTime`.
- Produces: rows `data-testid="history-entry"`.

- [ ] **Step 1: Write the failing E2E test** — `web/tests/e2e/history.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test('history lists chart, details and note changes with who did them', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('History') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await page.getByRole('complementary', { name: 'Tooth details' }).getByRole('button', { name: 'Mark missing' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();

  await page.goto(`/patients/${id}/overview`);
  await page.getByLabel('Phone').fill('0100 123 4567');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByText('Patient details saved.')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  const entries = page.getByTestId('history-entry');
  await expect(entries.nth(0)).toContainText('Patient details changed: phone');
  await expect(entries.nth(1)).toContainText('Tooth 36: Present → Missing');
  await expect(entries.filter({ hasText: 'Patient created' })).toHaveCount(1);
  await expect(entries.first()).toContainText('Test Organizer');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e -- history.spec.ts`
Expected: FAIL — `/history` is 404.

- [ ] **Step 3: Implement** — `web/src/app/(app)/patients/[id]/history/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { describeChange } from '@/lib/patients/history';
import type { HistoryEntry } from '@/lib/patients/types';

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('patient_history', { p_patient: id });
  if (error) throw new Error('Could not load history');
  const entries = (data ?? []) as HistoryEntry[];

  return (
    <section className="card max-w-3xl">
      <h2 className="mb-4 font-semibold">Change history</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-600">No changes recorded.</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <li key={entry.id} data-testid="history-entry" className="flex flex-wrap gap-x-4 py-2 text-sm">
              <time dateTime={entry.at} className="w-40 shrink-0 text-gray-500">
                {formatDateTime(entry.at)}
              </time>
              <span className="w-40 shrink-0 text-gray-700">{entry.actor}</span>
              <span>{describeChange(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(patients): per-patient change history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
