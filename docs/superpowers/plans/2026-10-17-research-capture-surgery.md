# Research Readiness Part 1 (Surgery Data Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record patient risk factors as yes / no / not assessed, and give every placed implant a structured "Surgical details" record (timing, site, flap, healing, closure, grafting) plus zero or more graft records, with a completeness badge.

**Architecture:** Two additive migrations: `0043` adds tri-state columns to `medical_history` (with a release-window sync trigger from the old booleans); `0044` adds `implant_surgery` (1:1 with `implant_sites`) and `implant_grafts` (1:n), written only through `require_perm('patients','edit')` definer functions, audited and shown in History. Pure rules live in `src/lib/implants/surgery.ts` and `src/lib/patients/risk-factors.ts`; the chart's implant panel gets a collapsible Surgical details block; `place_implant_v2` and `correct_placement` are untouched.

**Tech Stack:** Next.js 15 App Router (server actions), React 19, Tailwind v4, Zod v4, Supabase Postgres (plpgsql, RLS), Vitest (unit, component, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-research-capture-surgery-design.md`

## Global Constraints

- Run every command from `web/`. Windows + Git Bash: write files containing `\` with the Write/Edit tools; files are CRLF in git.
- An empty value always means "not recorded / not assessed", never "no". Never default a new column to a "no" value.
- Existing data: `true` → `yes` (smoker → `current`); `false` → empty (not assessed).
- Migrations are additive and backward-compatible: old boolean columns stay; a later PR drops them and the sync trigger. Never edit a migration after `npm run test:db` has applied it; dry-run each new migration in a rolled-back transaction first.
- Every public `security definer` function: `set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, business errors via `app_private.fail('…')`, `revoke execute … from public, anon; grant execute … to authenticated;`.
- New tables get no privileges by default (0019): grant `select` to `authenticated` only; no table write grants.
- Dates: Cairo dates — `public.cairo_today()` in SQL, `todayIso()` in TS.
- Styling: named tokens (`text-muted`, `text-warn`, `border-line`, `badge-ok`, `badge-warn`, `.btn`, `.btn-secondary`, `.input`, `.label`); tables use `className="table"` with `data-label` on every `<td>`.
- No Prettier. Match surrounding code style (single quotes, 2-space indent, long lines OK).
- Ranges: HbA1c 4.0–20.0 %; cigarettes per day 1–100; keratinized mucosa 0–15 mm; graft product ≤ 120 chars; graft notes ≤ 500 chars.
- Completeness counts exactly 9 surgical fields: placement timing, extraction date, soft-tissue phenotype, keratinized mucosa, flap, torque type, healing, primary closure, grafting performed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feat/research-capture-surgery` (create it from `master` before Task 1).

## Review Focus

1. **Stale edit of surgical details** — two organizers edit the same implant's details; the second save must be refused with "These surgical details were changed by someone else. Reload to see them." (pinned in Task 4 DB test and Task 6 action passes `expectedUpdatedAt` from the row it rendered).
2. **Old app version writing medical history during the release window** — an untick/tick of an old checkbox must land in the new column, and an unrelated save must not clobber a tri-state value already set by the new app (Task 1 trigger test; restore-safety via `coalesce` on insert).
3. **Viewer / delegate / Schedule-only user** — must not read surgical details or grafts and must not write medical-history columns (Task 1 and Task 4 DB tests).
4. **Simultaneous graft submitted with a stale date** — a date typed while "Staged" was selected, then switched to "Simultaneous", must be stored as null (Task 6 action test and Task 4 DB test).
5. **Implant placed, then placement date corrected earlier than the extraction date** — `correct_placement` still works (not blocked); the surgical details form then refuses re-saving until the extraction date is fixed, with a clear message (Task 4 DB test).

---

### Task 1: Migration 0043 — tri-state medical history columns

**Files:**
- Create: `web/supabase/migrations/0043_medical_history_tristate.sql`
- Test: `web/tests/db/research-capture.test.ts`

**Interfaces:**
- Produces (DB): `medical_history` columns `smoking text` (`never`/`former`/`current`), `cigarettes_per_day int`, `diabetes_status`, `bisphosphonates_status`, `anticoagulants_status`, `radiotherapy_status`, `osteoporosis_status`, `periodontitis_history`, `bruxism`, `previous_implant_failure` (all `text`, `yes`/`no`), `hba1c numeric(3,1)`, `hba1c_date date`. All nullable. Updatable by `authenticated` through column grants.

- [ ] **Step 1: Create the branch**

```bash
cd web && git checkout master && git pull && git checkout -b feat/research-capture-surgery
```

- [ ] **Step 2: Write the failing DB tests**

Create `web/tests/db/research-capture.test.ts`:

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makePatient } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const history = async (c: Client, patient: string) =>
  (await c.query(
    `select smoking, cigarettes_per_day, diabetes_status, bisphosphonates_status, anticoagulants_status, radiotherapy_status,
            osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure, hba1c::float as hba1c, hba1c_date::text
     from public.medical_history where patient_id = $1`,
    [patient],
  )).rows[0];

describe('medical history: tri-state risk factors', () => {
  it('a new patient starts with every risk factor not assessed', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate New');
      expect(await history(c, p)).toEqual({
        smoking: null, cigarettes_per_day: null, diabetes_status: null, bisphosphonates_status: null, anticoagulants_status: null,
        radiotherapy_status: null, osteoporosis_status: null, periodontitis_history: null, bruxism: null,
        previous_implant_failure: null, hba1c: null, hba1c_date: null,
      });
    });
  });

  it('an organizer with Edit on Patients saves the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Save');
      await c.query(
        `update public.medical_history set smoking = 'current', cigarettes_per_day = 10, diabetes_status = 'yes',
           hba1c = 7.2, hba1c_date = '2026-01-10', bruxism = 'no' where patient_id = $1`,
        [p],
      );
      expect(await history(c, p)).toMatchObject({
        smoking: 'current', cigarettes_per_day: 10, diabetes_status: 'yes', hba1c: 7.2, hba1c_date: '2026-01-10', bruxism: 'no',
      });
    });
  });

  it('refuses unknown values, cigarettes without current smoking, an HbA1c without its date, and a future HbA1c date', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Checks');
      const set = (sql: string) => c.query(`update public.medical_history set ${sql} where patient_id = $1`, [p]);
      await refused(c, () => set(`diabetes_status = 'maybe'`), /check/);
      await refused(c, () => set(`smoking = 'sometimes'`), /check/);
      await refused(c, () => set(`smoking = 'former', cigarettes_per_day = 5`), /check/);
      await refused(c, () => set(`smoking = 'current', cigarettes_per_day = 0`), /check/);
      await refused(c, () => set(`hba1c = 6.5`), /check/);
      await refused(c, () => set(`hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 3.9, hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 6.5, hba1c_date = '2999-01-01'`), /HbA1c date/);
    });
  });

  it('a viewer (View on Patients) and a delegate cannot change the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Viewer');
      await actAs(c, users.viewer);
      const viewer = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(viewer.rowCount).toBe(0);
      await actAs(c, users.delegate);
      const delegate = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(delegate.rowCount).toBe(0);
      await asPostgres(c);
      expect((await history(c, p)).bruxism).toBeNull();
    });
  });

  it('release window: an old-version boolean write reaches the new column; other saves leave it alone', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Sync');
      const set = (sql: string) => c.query(`update public.medical_history set ${sql} where patient_id = $1`, [p]);
      await set('smoker = true, diabetes = true, bisphosphonates = true, anticoagulants = true, radiotherapy_head_neck = true, osteoporosis = true');
      expect(await history(c, p)).toMatchObject({
        smoking: 'current', diabetes_status: 'yes', bisphosphonates_status: 'yes', anticoagulants_status: 'yes',
        radiotherapy_status: 'yes', osteoporosis_status: 'yes',
      });
      await set('smoker = false, diabetes = false');
      expect(await history(c, p)).toMatchObject({ smoking: 'never', diabetes_status: 'no' });
      // The new app sets a value; an old-version save that doesn't change the boolean leaves it.
      await set(`smoking = 'former'`);
      await set(`smoker = false, notes = 'old version save'`);
      expect((await history(c, p)).smoking).toBe('former');
    });
  });

  it('restore safety: inserting a row with a stale boolean keeps its tri-state value', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Restore');
      await asPostgres(c);
      await c.query('delete from public.medical_history where patient_id = $1', [p]);
      await c.query(
        `insert into public.medical_history (patient_id, smoker, smoking, diabetes, diabetes_status) values ($1, true, 'never', true, null)`,
        [p],
      );
      expect(await history(c, p)).toMatchObject({ smoking: 'never', diabetes_status: 'yes' });
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run db:status` (start the stack with `npm run db:start` if it is down), then `npm run test:db -- research-capture`
Expected: FAIL — `column "smoking" does not exist`.

- [ ] **Step 4: Write the migration**

Create `web/supabase/migrations/0043_medical_history_tristate.sql`:

```sql
-- Research readiness, part 1: risk factors are yes / no / not assessed (null). The old booleans defaulted to
-- false, so "never asked" looked like "no": true becomes yes (smoker: current), false becomes not assessed.
-- The booleans stay for the release window (the previous app version still writes them); a trigger copies
-- those writes across. A later migration drops the booleans and the trigger.
alter table public.medical_history
  add column smoking text check (smoking in ('never', 'former', 'current')),
  add column cigarettes_per_day int check (cigarettes_per_day between 1 and 100),
  add column diabetes_status text check (diabetes_status in ('yes', 'no')),
  add column hba1c numeric(3, 1) check (hba1c between 4 and 20),
  add column hba1c_date date,
  add column bisphosphonates_status text check (bisphosphonates_status in ('yes', 'no')),
  add column anticoagulants_status text check (anticoagulants_status in ('yes', 'no')),
  add column radiotherapy_status text check (radiotherapy_status in ('yes', 'no')),
  add column osteoporosis_status text check (osteoporosis_status in ('yes', 'no')),
  add column periodontitis_history text check (periodontitis_history in ('yes', 'no')),
  add column bruxism text check (bruxism in ('yes', 'no')),
  add column previous_implant_failure text check (previous_implant_failure in ('yes', 'no')),
  add constraint medical_history_cigarettes_need_current check (cigarettes_per_day is null or smoking = 'current'),
  add constraint medical_history_hba1c_with_date check ((hba1c is null) = (hba1c_date is null));

update public.medical_history set
  smoking = case when smoker then 'current' end,
  diabetes_status = case when diabetes then 'yes' end,
  bisphosphonates_status = case when bisphosphonates then 'yes' end,
  anticoagulants_status = case when anticoagulants then 'yes' end,
  radiotherapy_status = case when radiotherapy_head_neck then 'yes' end,
  osteoporosis_status = case when osteoporosis then 'yes' end;

-- Release window: the previous version writes the booleans. On insert only a true counts (and a value already
-- present wins, so restoring a dump keeps the tri-state answers); on update only a changed boolean counts.
-- Also refuses a future HbA1c date (a check constraint can't use cairo_today()).
create function app_private.medical_history_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.hba1c_date is not null and new.hba1c_date > public.cairo_today() then
    perform app_private.fail('The HbA1c date can''t be in the future.');
  end if;
  if tg_op = 'INSERT' then
    if new.smoker then new.smoking := coalesce(new.smoking, 'current'); end if;
    if new.diabetes then new.diabetes_status := coalesce(new.diabetes_status, 'yes'); end if;
    if new.bisphosphonates then new.bisphosphonates_status := coalesce(new.bisphosphonates_status, 'yes'); end if;
    if new.anticoagulants then new.anticoagulants_status := coalesce(new.anticoagulants_status, 'yes'); end if;
    if new.radiotherapy_head_neck then new.radiotherapy_status := coalesce(new.radiotherapy_status, 'yes'); end if;
    if new.osteoporosis then new.osteoporosis_status := coalesce(new.osteoporosis_status, 'yes'); end if;
    return new;
  end if;
  if new.smoker is distinct from old.smoker then
    new.smoking := case when new.smoker then 'current' else 'never' end;
  end if;
  if new.diabetes is distinct from old.diabetes then
    new.diabetes_status := case when new.diabetes then 'yes' else 'no' end;
  end if;
  if new.bisphosphonates is distinct from old.bisphosphonates then
    new.bisphosphonates_status := case when new.bisphosphonates then 'yes' else 'no' end;
  end if;
  if new.anticoagulants is distinct from old.anticoagulants then
    new.anticoagulants_status := case when new.anticoagulants then 'yes' else 'no' end;
  end if;
  if new.radiotherapy_head_neck is distinct from old.radiotherapy_head_neck then
    new.radiotherapy_status := case when new.radiotherapy_head_neck then 'yes' else 'no' end;
  end if;
  if new.osteoporosis is distinct from old.osteoporosis then
    new.osteoporosis_status := case when new.osteoporosis then 'yes' else 'no' end;
  end if;
  return new;
end $$;

create trigger medical_history_sync before insert or update on public.medical_history
  for each row execute function app_private.medical_history_sync();

grant update (smoking, cigarettes_per_day, diabetes_status, hba1c, hba1c_date, bisphosphonates_status, anticoagulants_status,
  radiotherapy_status, osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure)
  on public.medical_history to authenticated;
```

- [ ] **Step 5: Dry-run the migration in a rolled-back transaction**

Write `<your scratchpad>/dry-run.ts` (absolute path to `web/scripts/db` in the import):

```ts
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from 'D:/Claude/Claude Code/Implant Course/web/scripts/db';

const [file, ...checks] = process.argv.slice(2);
const c = new Client(pgConfig());
await c.connect();
try {
  await c.query('begin');
  await c.query(readFileSync(file, 'utf8'));
  for (const sql of checks) console.log(sql, '→', (await c.query(sql)).rows);
  console.log('OK: migration applies');
} finally {
  await c.query('rollback');
  await c.end();
}
```

Run (from `web/`):
```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<your scratchpad>/dry-run.ts" supabase/migrations/0043_medical_history_tristate.sql \
  "select count(*) filter (where smoker) as smokers, count(*) filter (where smoking = 'current') as current, count(*) filter (where not smoker and smoking is not null) as wrong from public.medical_history"
```
Expected: `OK: migration applies`; `smokers` equals `current`; `wrong` is `0`. (This is the only check of the backfill: it runs once, so a DB test can't cover it.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:db -- research-capture`
Expected: PASS (6 tests). Then `npm run test:db -- permissions patients` — PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0043_medical_history_tristate.sql tests/db/research-capture.test.ts
git commit -m "feat(db): tri-state medical history risk factors (0043)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Risk-factor rules in TypeScript (schema, types, alerts, history labels)

**Files:**
- Create: `web/src/lib/patients/risk-factors.ts`, `web/src/lib/patients/risk-factors.test.ts`
- Modify: `web/src/lib/patients/types.ts` (type `MedicalHistory`), `web/src/lib/patients/schemas.ts` (`medicalHistorySchema`), `web/src/lib/patients/alerts.ts`, `web/src/lib/patients/history.ts` (`FIELD_LABELS`, `changedFields`)
- Test: `web/src/lib/patients/schemas.test.ts`, `web/src/lib/patients/alerts.test.ts`, `web/src/lib/patients/history.test.ts`

**Interfaces:**
- Consumes: Task 1 column names.
- Produces:
  - `risk-factors.ts`: `YES_NO = ['yes','no'] as const`, `type YesNo`, `SMOKING = ['never','former','current'] as const`, `type Smoking`, `RISK_QUESTIONS: { key: RiskKey; label: string; options: { value: string; label: string }[] }[]` (9 entries, in display order), `type RiskKey`, `notAssessedCount(h: Pick<MedicalHistory, RiskKey>): number`.
  - `MedicalHistory` type: drops the six booleans; adds `smoking: Smoking | null; cigarettes_per_day: number | null; diabetes_status: YesNo | null; hba1c: number | null; hba1c_date: string | null; bisphosphonates_status, anticoagulants_status, radiotherapy_status, osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure: YesNo | null`.
  - `medicalHistorySchema` parses form strings ('' = null) into exactly those column names plus `allergies`, `medications`, `other_conditions`, `notes`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/patients/risk-factors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RISK_QUESTIONS, notAssessedCount } from './risk-factors';

const blank = {
  smoking: null, diabetes_status: null, bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
} as const;

describe('risk factors', () => {
  it('asks nine questions, smoking first with its own options', () => {
    expect(RISK_QUESTIONS).toHaveLength(9);
    expect(RISK_QUESTIONS[0]).toMatchObject({ key: 'smoking', label: 'Smoking' });
    expect(RISK_QUESTIONS[0].options.map((o) => o.label)).toEqual(['Never', 'Former', 'Current', 'Not assessed']);
    expect(RISK_QUESTIONS[1].options.map((o) => [o.value, o.label])).toEqual([['yes', 'Yes'], ['no', 'No'], ['', 'Not assessed']]);
  });
  it('counts the questions not assessed; a "no" counts as assessed', () => {
    expect(notAssessedCount(blank)).toBe(9);
    expect(notAssessedCount({ ...blank, smoking: 'never', bruxism: 'no', diabetes_status: 'yes' })).toBe(6);
  });
});
```

In `web/src/lib/patients/schemas.test.ts`, replace the `describe('medicalHistorySchema', …)` block with:

```ts
describe('medicalHistorySchema', () => {
  const valid = { allergies: ' Latex ', smoking: 'current', cigarettes_per_day: '10', diabetes_status: 'yes', hba1c: '7.2', hba1c_date: '2026-01-10' };
  it('reads radios ("" = not assessed) and numbers', () => {
    expect(medicalHistorySchema.parse({ ...valid, bruxism: '', osteoporosis_status: 'no' })).toMatchObject({
      allergies: 'Latex', smoking: 'current', cigarettes_per_day: 10, diabetes_status: 'yes', hba1c: 7.2, hba1c_date: '2026-01-10',
      bruxism: null, osteoporosis_status: 'no', periodontitis_history: null,
    });
  });
  it('writes only the new columns, never the old booleans', () => {
    const keys = Object.keys(medicalHistorySchema.parse({}));
    expect(keys).not.toContain('smoker');
    expect(keys).not.toContain('diabetes');
    expect(keys).toContain('smoking');
  });
  it('refuses cigarettes without current smoking, half an HbA1c, out-of-range values and a future date', () => {
    expect(firstError(medicalHistorySchema.safeParse({ smoking: 'former', cigarettes_per_day: '5' }))).toBe(
      'Cigarettes per day only applies to a current smoker.',
    );
    expect(firstError(medicalHistorySchema.safeParse({ hba1c: '6.5' }))).toBe('Enter the HbA1c value and the date it was measured.');
    expect(firstError(medicalHistorySchema.safeParse({ hba1c: '25', hba1c_date: '2026-01-10' }))).toBe('Enter an HbA1c between 4 and 20 %.');
    expect(firstError(medicalHistorySchema.safeParse({ smoking: 'current', cigarettes_per_day: '0' }))).toBe(
      'Enter cigarettes per day as a whole number from 1 to 100.',
    );
    expect(firstError(medicalHistorySchema.safeParse({ hba1c: '6.5', hba1c_date: '2999-01-01' }))).toBe(
      'Enter the HbA1c date (today or earlier).',
    );
    expect(firstError(medicalHistorySchema.safeParse({ diabetes_status: 'maybe' }))).toBe('Choose yes, no or not assessed.');
  });
});
```

Replace `web/src/lib/patients/alerts.test.ts` `none` constant and the "most serious first" test with:

```ts
const none = {
  allergies: '', bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  diabetes_status: null, osteoporosis_status: null, smoking: null,
} as const;
```
```ts
  it('lists alerts most serious first, only for yes answers and current smokers', () => {
    expect(
      medicalAlerts({ ...none, allergies: 'Penicillin', smoking: 'current', bisphosphonates_status: 'yes', diabetes_status: 'yes' }),
    ).toEqual(['Allergy: Penicillin', 'Bisphosphonates', 'Diabetes', 'Smoker']);
    expect(medicalAlerts({ ...none, smoking: 'former', diabetes_status: 'no', osteoporosis_status: 'no' })).toEqual([]);
  });
```

In `web/src/lib/patients/history.test.ts` add (inside the existing top-level `describe`, or a new one):

```ts
describe('describeChange: tri-state medical history', () => {
  it('names the new risk-factor fields once, even when the old boolean changed with them', () => {
    expect(describeChange({
      id: 1, at: '2026-10-17T10:00:00Z', table_name: 'medical_history', action: 'UPDATE', actor: 'A',
      before: { smoker: false, smoking: null, bruxism: null, hba1c: null },
      after: { smoker: true, smoking: 'current', bruxism: 'no', hba1c: 6.5 },
    })).toBe('Medical history changed: smoking, HbA1c, bruxism');
  });
});
```
(`describeChange` is already imported at the top of the file.) Also update the existing expectation at `history.test.ts:21` from `'Medical history changed: diabetes, smoker'` to `'Medical history changed: diabetes, smoking'` (the old `smoker` key is relabelled "smoking" so a release-window change reads the same as a new one).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- risk-factors schemas alerts history`
Expected: FAIL — `Cannot find module './risk-factors'` and schema/alert assertion failures.

- [ ] **Step 3: Implement**

Create `web/src/lib/patients/risk-factors.ts`:

```ts
import type { MedicalHistory } from './types';

export const YES_NO = ['yes', 'no'] as const;
export type YesNo = (typeof YES_NO)[number];
export const SMOKING = ['never', 'former', 'current'] as const;
export type Smoking = (typeof SMOKING)[number];

export type RiskKey =
  | 'smoking' | 'diabetes_status' | 'bisphosphonates_status' | 'anticoagulants_status' | 'radiotherapy_status'
  | 'osteoporosis_status' | 'periodontitis_history' | 'bruxism' | 'previous_implant_failure';

type Option = { value: string; label: string };
const NOT_ASSESSED: Option = { value: '', label: 'Not assessed' };
const YES_NO_OPTIONS: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, NOT_ASSESSED];

/** The risk-factor questions on the medical history, in display order. An empty answer means not assessed. */
export const RISK_QUESTIONS: { key: RiskKey; label: string; options: Option[] }[] = [
  { key: 'smoking', label: 'Smoking', options: [
    { value: 'never', label: 'Never' }, { value: 'former', label: 'Former' }, { value: 'current', label: 'Current' }, NOT_ASSESSED,
  ] },
  { key: 'diabetes_status', label: 'Diabetes', options: YES_NO_OPTIONS },
  { key: 'bisphosphonates_status', label: 'Bisphosphonates', options: YES_NO_OPTIONS },
  { key: 'anticoagulants_status', label: 'Anticoagulants', options: YES_NO_OPTIONS },
  { key: 'radiotherapy_status', label: 'Head/neck radiotherapy', options: YES_NO_OPTIONS },
  { key: 'osteoporosis_status', label: 'Osteoporosis', options: YES_NO_OPTIONS },
  { key: 'periodontitis_history', label: 'Periodontitis history', options: YES_NO_OPTIONS },
  { key: 'bruxism', label: 'Bruxism / parafunction', options: YES_NO_OPTIONS },
  { key: 'previous_implant_failure', label: 'Previous implant failure', options: YES_NO_OPTIONS },
];

export function notAssessedCount(h: Pick<MedicalHistory, RiskKey>): number {
  return RISK_QUESTIONS.filter((q) => h[q.key] === null || h[q.key] === undefined).length;
}
```

In `web/src/lib/patients/types.ts`, add `import type { Smoking, YesNo } from './risk-factors';` at the top and replace the `MedicalHistory` type with:

```ts
export type MedicalHistory = {
  patient_id: string;
  allergies: string;
  medications: string;
  smoking: Smoking | null;
  cigarettes_per_day: number | null;
  diabetes_status: YesNo | null;
  hba1c: number | null;
  hba1c_date: string | null;
  bisphosphonates_status: YesNo | null;
  anticoagulants_status: YesNo | null;
  radiotherapy_status: YesNo | null;
  osteoporosis_status: YesNo | null;
  periodontitis_history: YesNo | null;
  bruxism: YesNo | null;
  previous_implant_failure: YesNo | null;
  other_conditions: string;
  notes: string;
  updated_at: string;
};
```

In `web/src/lib/patients/schemas.ts`, add `import { SMOKING, YES_NO } from './risk-factors';`, delete the `checkbox` constant, and replace `medicalHistorySchema` with:

```ts
const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const yesNo = z.preprocess(blankToNull, z.enum(YES_NO, { message: 'Choose yes, no or not assessed.' }).nullable());
const number = (message: string, check: (n: number) => boolean) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).refine(check, { message }).nullable());

export const medicalHistorySchema = z
  .object({
    allergies: text(1000),
    medications: text(1000),
    smoking: z.preprocess(blankToNull, z.enum(SMOKING, { message: 'Choose never, former, current or not assessed.' }).nullable()),
    cigarettes_per_day: number('Enter cigarettes per day as a whole number from 1 to 100.', (n) => Number.isInteger(n) && n >= 1 && n <= 100),
    diabetes_status: yesNo,
    hba1c: number('Enter an HbA1c between 4 and 20 %.', (n) => n >= 4 && n <= 20),
    hba1c_date: z.preprocess(
      blankToNull,
      z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the HbA1c date (today or earlier).' }).nullable(),
    ),
    bisphosphonates_status: yesNo,
    anticoagulants_status: yesNo,
    radiotherapy_status: yesNo,
    osteoporosis_status: yesNo,
    periodontitis_history: yesNo,
    bruxism: yesNo,
    previous_implant_failure: yesNo,
    other_conditions: text(1000),
    notes: text(2000),
  })
  .superRefine((h, ctx) => {
    if (h.cigarettes_per_day !== null && h.smoking !== 'current') {
      ctx.addIssue({ code: 'custom', path: ['cigarettes_per_day'], message: 'Cigarettes per day only applies to a current smoker.' });
    }
    if ((h.hba1c === null) !== (h.hba1c_date === null)) {
      ctx.addIssue({ code: 'custom', path: ['hba1c'], message: 'Enter the HbA1c value and the date it was measured.' });
    }
  });
```

Replace `web/src/lib/patients/alerts.ts` `AlertInput` and the six boolean checks:

```ts
type AlertInput = Pick<
  MedicalHistory,
  'allergies' | 'bisphosphonates_status' | 'anticoagulants_status' | 'radiotherapy_status' | 'diabetes_status' | 'osteoporosis_status' | 'smoking'
>;
```
```ts
  if (h.bisphosphonates_status === 'yes') alerts.push('Bisphosphonates');
  if (h.anticoagulants_status === 'yes') alerts.push('Anticoagulants');
  if (h.radiotherapy_status === 'yes') alerts.push('Head/neck radiotherapy');
  if (h.diabetes_status === 'yes') alerts.push('Diabetes');
  if (h.osteoporosis_status === 'yes') alerts.push('Osteoporosis');
  if (h.smoking === 'current') alerts.push('Smoker');
```

In `web/src/lib/patients/history.ts`, extend `FIELD_LABELS` (keep the old keys — release-window audit rows still contain them):

```ts
const FIELD_LABELS: Record<string, string> = {
  full_name: 'name', file_no: 'file number', dob: 'date of birth', sex: 'sex', phone: 'phone', email: 'email',
  address: 'address', allergies: 'allergies', medications: 'medications', diabetes: 'diabetes', smoker: 'smoking',
  bisphosphonates: 'bisphosphonates', anticoagulants: 'anticoagulants', radiotherapy_head_neck: 'head/neck radiotherapy',
  osteoporosis: 'osteoporosis', other_conditions: 'other conditions', notes: 'notes',
  smoking: 'smoking', cigarettes_per_day: 'cigarettes per day', diabetes_status: 'diabetes', hba1c: 'HbA1c', hba1c_date: 'HbA1c date',
  bisphosphonates_status: 'bisphosphonates', anticoagulants_status: 'anticoagulants', radiotherapy_status: 'head/neck radiotherapy',
  osteoporosis_status: 'osteoporosis', periodontitis_history: 'periodontitis history', bruxism: 'bruxism',
  previous_implant_failure: 'previous implant failure',
};
```

and make `changedFields` return each label once:

```ts
  return [...new Set(
    Object.keys(labels)
      .filter((key) => key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => labels[key]),
  )];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- risk-factors schemas alerts history` → PASS. Then `npx tsc --noEmit` — expected errors only in `overview/medical-history-form.tsx` (fixed in Task 3). Note them and continue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/patients
git commit -m "feat(patients): tri-state risk-factor schema, alerts and history labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Medical history form with Yes / No / Not assessed

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/overview/medical-history-form.tsx`
- Create: `web/src/app/(app)/patients/[id]/overview/medical-history-form.test.tsx`
- Modify: `web/tests/e2e/patient-overview.spec.ts` (the two tests that tick checkboxes)
- Modify: `web/tests/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `RISK_QUESTIONS`, `notAssessedCount` (Task 2); `saveMedicalHistory` (unchanged server action in `overview/actions.ts`, which updates with `medicalHistorySchema` → only the new columns); `valueOf`, `FormState` from `@/lib/patients/form-state`.
- Produces: each risk question is `role="radiogroup"` named by its label (e.g. "Bisphosphonates"), with radios labelled "Yes" / "No" / "Not assessed" (smoking: "Never" / "Former" / "Current" / "Not assessed"); "Cigarettes per day", "HbA1c (%)", "HbA1c date" inputs; a line "N of 9 not assessed".

- [ ] **Step 1: Write the failing component test**

Create `web/src/app/(app)/patients/[id]/overview/medical-history-form.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MedicalHistory } from '@/lib/patients/types';

vi.mock('./actions', () => ({ saveMedicalHistory: vi.fn() }));
import { MedicalHistoryForm } from './medical-history-form';

const history: MedicalHistory = {
  patient_id: 'p1', allergies: '', medications: '', smoking: null, cigarettes_per_day: null, diabetes_status: 'yes',
  hba1c: null, hba1c_date: null, bisphosphonates_status: 'no', anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
  other_conditions: '', notes: '', updated_at: '2026-10-17T10:00:00Z',
};

describe('<MedicalHistoryForm>', () => {
  it('shows each risk factor as Yes / No / Not assessed, pre-selecting the saved answer', () => {
    render(<MedicalHistoryForm history={history} />);
    expect(within(screen.getByRole('radiogroup', { name: 'Diabetes' })).getByLabelText('Yes')).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Bisphosphonates' })).getByLabelText('No')).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Bruxism / parafunction' })).getByLabelText('Not assessed')).toBeChecked();
    expect(screen.getByText('7 of 9 not assessed')).toBeInTheDocument();
  });

  it('asks cigarettes per day only for a current smoker', () => {
    render(<MedicalHistoryForm history={history} />);
    expect(screen.queryByLabelText('Cigarettes per day')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Smoking' })).getByLabelText('Current'));
    expect(screen.getByLabelText('Cigarettes per day')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Smoking' })).getByLabelText('Former'));
    expect(screen.queryByLabelText('Cigarettes per day')).not.toBeInTheDocument();
  });

  it('has HbA1c value and date fields', () => {
    render(<MedicalHistoryForm history={{ ...history, hba1c: 7.1, hba1c_date: '2026-09-01' }} />);
    expect(screen.getByLabelText('HbA1c (%)')).toHaveValue('7.1');
    expect(screen.getByLabelText('HbA1c date')).toHaveValue('2026-09-01');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- medical-history-form`
Expected: FAIL — no radiogroup named "Diabetes".

- [ ] **Step 3: Rewrite the form**

Replace `web/src/app/(app)/patients/[id]/overview/medical-history-form.tsx` with:

```tsx
'use client';

import { useActionState, useState } from 'react';
import type { MedicalHistory } from '@/lib/patients/types';
import { RISK_QUESTIONS, notAssessedCount } from '@/lib/patients/risk-factors';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { saveMedicalHistory } from './actions';

const TEXTS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'other_conditions', label: 'Other conditions' },
  { key: 'notes', label: 'Notes' },
];

const str = (v: string | number | null) => (v === null ? '' : String(v));

export function MedicalHistoryForm({ history }: { history: MedicalHistory }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMedicalHistory, {});
  // React resets the form after each action and radios fall back to their initial choice; remounting on every
  // result rebuilds them from the submitted (or saved) values. See schedule/_talks/talk-form.tsx.
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setAttempt(attempt + 1);
  }
  return (
    <form key={attempt} action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Medical history</h2>
      <input type="hidden" name="patient_id" value={history.patient_id} readOnly />
      <input type="hidden" name="expected_updated_at" value={history.updated_at} readOnly />
      <RiskFactors history={history} state={state} />
      {TEXTS.map(({ key, label }) => (
        <label key={key} className="block">
          <span className="label">{label}</span>
          <textarea className="input" name={key} rows={2} defaultValue={valueOf(state, key, history[key] as string)} />
        </label>
      ))}
      <p className="text-sm text-muted">{notAssessedCount(history)} of {RISK_QUESTIONS.length} not assessed</p>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save medical history
      </button>
    </form>
  );
}

function RiskFactors({ history, state }: { history: MedicalHistory; state: FormState }) {
  const [smoking, setSmoking] = useState(valueOf(state, 'smoking', history.smoking));
  return (
    <div className="space-y-3">
      <p className="label">Conditions relevant to implants</p>
      {RISK_QUESTIONS.map((q) => {
        const current = valueOf(state, q.key, history[q.key]);
        return (
          <div key={q.key} role="radiogroup" aria-label={q.label} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-sm font-medium sm:w-52">{q.label}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {q.options.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio" name={q.key} value={o.value} defaultChecked={current === o.value}
                    onChange={q.key === 'smoking' ? () => setSmoking(o.value) : undefined}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {smoking === 'current' && (
        <label className="block max-w-48">
          <span className="label">Cigarettes per day</span>
          <input className="input" name="cigarettes_per_day" inputMode="numeric"
            defaultValue={valueOf(state, 'cigarettes_per_day', str(history.cigarettes_per_day))} />
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">HbA1c (%)</span>
          <input className="input" name="hba1c" inputMode="decimal" defaultValue={valueOf(state, 'hba1c', str(history.hba1c))} />
        </label>
        <label className="block">
          <span className="label">HbA1c date</span>
          <input className="input" type="date" name="hba1c_date" defaultValue={valueOf(state, 'hba1c_date', history.hba1c_date)} />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the component test and typecheck**

Run: `npm test -- medical-history-form` → PASS. `npx tsc --noEmit` → no errors. `npm run lint` → clean.

- [ ] **Step 5: Update the E2E specs**

In `web/tests/e2e/patient-overview.spec.ts`:
- test "header shows age and medical alerts…": replace `await page.getByLabel('Bisphosphonates').check();` with
  ```ts
  await page.getByRole('radiogroup', { name: 'Bisphosphonates' }).getByLabel('Yes', { exact: true }).check();
  ```
- test "edits details and archives / restores": replace `await page.getByLabel('Diabetes').check();` with
  ```ts
  await page.getByRole('radiogroup', { name: 'Diabetes' }).getByLabel('Yes', { exact: true }).check();
  ```
  replace `await page.getByLabel('Smoker').check();` with
  ```ts
  await page.getByRole('radiogroup', { name: 'Smoking' }).getByLabel('Current').check();
  await page.getByLabel('Cigarettes per day').fill('10');
  ```
  and replace `await expect(page.getByLabel('Smoker')).toBeChecked();` with
  ```ts
  await expect(page.getByRole('radiogroup', { name: 'Smoking' }).getByLabel('Current')).toBeChecked();
  await expect(page.getByLabel('Cigarettes per day')).toHaveValue('10');
  await expect(page.getByRole('radiogroup', { name: 'Bruxism / parafunction' }).getByLabel('Not assessed')).toBeChecked();
  ```

In `web/tests/e2e/mobile.spec.ts` add:

```ts
test('the medical history risk factors fit a phone screen', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Phone history') });
  await page.goto(`/patients/${id}/overview`);
  await expect(page.getByRole('radiogroup', { name: 'Previous implant failure' })).toBeVisible();
  await expectNoSideways(page);
});
```
and change its import to `import { createPatientViaUi, uniqueName } from './patients';`.

- [ ] **Step 6: Run the E2E specs**

Run (nothing else on :3000, stack running): `npx playwright test patient-overview --project=chromium` → PASS; `npx playwright test mobile --project=phone` → PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/patients/[id]/overview" tests/e2e/patient-overview.spec.ts tests/e2e/mobile.spec.ts
git commit -m "feat(patients): medical history asks yes / no / not assessed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration 0044 — surgical details and grafts

**Files:**
- Create: `web/supabase/migrations/0044_implant_surgery.sql`
- Modify: `web/tests/db/research-capture.test.ts` (append), `web/tests/db/permissions.test.ts` (nothing to allow-list — confirm it stays green)

**Interfaces:**
- Consumes: `implant_sites` (`state`, `placed_on`), `app_private.require_perm`, `app_private.fail`, `app_private.audit_row`, `app_private.set_updated_at`, `public.is_active_user`, `public.can`.
- Produces (DB):
  - `public.save_implant_surgery(p_site uuid, p_extraction_date date, p_placement_timing text, p_soft_tissue_phenotype text, p_keratinized_mucosa_mm numeric, p_flap text, p_torque_type text, p_healing text, p_primary_closure text, p_grafting_performed text, p_expected_updated_at timestamptz) returns void`
  - `public.add_implant_graft(p_site uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text) returns uuid`
  - `public.update_implant_graft(p_graft uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text) returns void`
  - `public.delete_implant_graft(p_graft uuid) returns void`
  - Tables `implant_surgery` (PK `site_id`), `implant_grafts`; both in `patient_history` and readable through `audit_log_area_read` with Patients view.
  - Error messages (exact): `'Surgical details can only be recorded for a placed implant.'`, `'The extraction date can''t be after the placement date (%s).'`, `'An immediate placement is on the extraction day. Change the timing or the extraction date.'`, `'This implant has grafts recorded. Delete them before setting Grafting performed to No.'`, `'These surgical details were changed by someone else. Reload to see them.'`, `'Grafting performed is set to No for this implant. Change it to Yes before adding a graft.'`, `'Choose the graft procedure.'`, `'Choose simultaneous or staged.'`, `'A staged graft needs its date, before the placement date (%s).'`, `'Graft not found.'`.

- [ ] **Step 1: Write the failing DB tests**

Append to `web/tests/db/research-capture.test.ts` (and extend the fixtures import to `import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';`):

```ts
async function placedSite(c: Client, placedOn = '2026-03-10') {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Surgery Patient');
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'SURG');
  const delegate = await makeDelegate(c, 'Zz Surgery Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site };
}

type Surgery = Partial<{
  extraction: string | null; timing: string | null; phenotype: string | null; km: number | null; flap: string | null;
  torqueType: string | null; healing: string | null; closure: string | null; grafting: string | null; expected: string | null;
}>;
const saveSurgery = (c: Client, site: string, s: Surgery = {}) =>
  c.query(
    `select public.save_implant_surgery(p_site => $1, p_extraction_date => $2::date, p_placement_timing => $3,
       p_soft_tissue_phenotype => $4, p_keratinized_mucosa_mm => $5, p_flap => $6, p_torque_type => $7, p_healing => $8,
       p_primary_closure => $9, p_grafting_performed => $10, p_expected_updated_at => $11::timestamptz)`,
    [site, s.extraction ?? null, s.timing ?? null, s.phenotype ?? null, s.km ?? null, s.flap ?? null, s.torqueType ?? null,
     s.healing ?? null, s.closure ?? null, s.grafting ?? null, s.expected ?? null],
  );
const surgeryRow = async (c: Client, site: string) =>
  (await c.query(
    `select extraction_date::text, placement_timing, soft_tissue_phenotype, keratinized_mucosa_mm::float as km, flap, torque_type,
            healing, primary_closure, grafting_performed, updated_at::text as updated_at
     from public.implant_surgery where site_id = $1`, // text keeps the microseconds a JS Date would drop
    [site],
  )).rows[0];

type Graft = Partial<{ procedure: string | null; timing: string | null; performedOn: string | null; material: string | null;
  product: string; membrane: string | null; notes: string }>;
const graftArgs = (g: Graft) => [g.procedure === undefined ? 'gbr' : g.procedure, g.timing === undefined ? 'simultaneous' : g.timing,
  g.performedOn ?? null, g.material ?? null, g.product ?? '', g.membrane ?? null, g.notes ?? ''];
const addGraft = async (c: Client, site: string, g: Graft = {}) =>
  (await c.query(
    `select public.add_implant_graft(p_site => $1, p_procedure => $2, p_timing => $3, p_performed_on => $4::date,
       p_material => $5, p_product => $6, p_membrane => $7, p_notes => $8) as id`,
    [site, ...graftArgs(g)],
  )).rows[0].id as string;
const updateGraft = (c: Client, graft: string, g: Graft = {}) =>
  c.query(
    `select public.update_implant_graft(p_graft => $1, p_procedure => $2, p_timing => $3, p_performed_on => $4::date,
       p_material => $5, p_product => $6, p_membrane => $7, p_notes => $8)`,
    [graft, ...graftArgs(g)],
  );

describe('surgical details', () => {
  it('creates the record, then updates it with the version it read', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await saveSurgery(c, site, {
        extraction: '2025-10-01', timing: 'delayed', phenotype: 'thick', km: 3.5, flap: 'crestal', torqueType: 'peak',
        healing: 'submerged', closure: 'yes', grafting: 'no',
      });
      const first = await surgeryRow(c, site);
      expect(first).toMatchObject({
        extraction_date: '2025-10-01', placement_timing: 'delayed', soft_tissue_phenotype: 'thick', km: 3.5, flap: 'crestal',
        torque_type: 'peak', healing: 'submerged', primary_closure: 'yes', grafting_performed: 'no',
      });
      await saveSurgery(c, site, { timing: 'delayed', flap: 'flapless', expected: first.updated_at });
      expect(await surgeryRow(c, site)).toMatchObject({ flap: 'flapless', extraction_date: null, grafting_performed: null });
    });
  });

  it('refuses a stale version, and a version sent for a record that does not exist yet', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await refused(c, () => saveSurgery(c, site, { flap: 'crestal', expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
      await saveSurgery(c, site, { flap: 'crestal' });
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless' }), /changed by someone else/);
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless', expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
    });
  });

  it('refuses a planned site, an extraction after placement, and an immediate placement on another day', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c, '2026-03-10');
      await asPostgres(c);
      const planned = (await c.query(`insert into public.implant_sites (patient_id, tooth, state) values ($1, 11, 'planned') returning id`, [patient])).rows[0].id;
      await actAs(c, users.organizer);
      await refused(c, () => saveSurgery(c, planned, { flap: 'crestal' }), /only be recorded for a placed implant/);
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-11' }), /can't be after the placement date \(2026-03-10\)/);
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-01', timing: 'immediate' }), /immediate placement is on the extraction day/);
      await saveSurgery(c, site, { extraction: '2026-03-10', timing: 'immediate' });
      // Other timing/day mismatches are only warned about in the form.
      const { site: other } = await placedSite(c, '2026-03-10');
      await saveSurgery(c, other, { extraction: '2026-03-01', timing: 'delayed' });
    });
  });

  it('accepts a failed implant', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'failed' where id = $1`, [site]);
      await actAs(c, users.organizer);
      await saveSurgery(c, site, { healing: 'transmucosal' });
      expect((await surgeryRow(c, site)).healing).toBe('transmucosal');
    });
  });

  it('a placement date corrected before the extraction date blocks re-saving until the extraction date is fixed', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      await saveSurgery(c, site, { extraction: '2026-03-05', timing: 'delayed' });
      await c.query(
        `select public.correct_placement(p_site => $1, p_placed_on => '2026-03-01', p_placing_delegate => placing_delegate_id,
           p_assisting_delegate => null, p_supervisor => supervisor_id, p_torque => null, p_isq => null, p_bone_type => null,
           p_graft => '', p_notes => '') from public.implant_sites where id = $1`,
        [site],
      );
      const expected = (await surgeryRow(c, site)).updated_at;
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-05', timing: 'delayed', expected }), /\(2026-03-01\)/);
      await saveSurgery(c, site, { extraction: '2026-02-01', timing: 'delayed', expected });
    });
  });
});

describe('grafts', () => {
  it('adds, updates and deletes grafts; a simultaneous graft stores no date', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      const id = await addGraft(c, site, { procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-03-01', material: 'xenograft', product: 'Bio-Oss 0.5 g', membrane: 'resorbable' });
      const row = async () => (await c.query('select procedure, timing, performed_on::text, material, product, membrane from public.implant_grafts where id = $1', [id])).rows[0];
      expect(await row()).toEqual({ procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft', product: 'Bio-Oss 0.5 g', membrane: 'resorbable' });
      await updateGraft(c, id, { procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01', material: 'combination' });
      expect(await row()).toMatchObject({ procedure: 'sinus_lateral', timing: 'staged', performed_on: '2025-12-01', material: 'combination', membrane: null });
      await c.query('select public.delete_implant_graft($1)', [id]);
      expect(await row()).toBeUndefined();
      await refused(c, () => c.query('select public.delete_implant_graft($1)', [id]), /Graft not found/);
    });
  });

  it('a staged graft needs a date before placement; procedure and timing are required', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      await refused(c, () => addGraft(c, site, { timing: 'staged' }), /staged graft needs its date, before the placement date \(2026-03-10\)/);
      await refused(c, () => addGraft(c, site, { timing: 'staged', performedOn: '2026-03-10' }), /staged graft needs its date/);
      await refused(c, () => addGraft(c, site, { procedure: null }), /Choose the graft procedure/);
      await refused(c, () => addGraft(c, site, { timing: null }), /Choose simultaneous or staged/);
      await refused(c, () => addGraft(c, site, { procedure: 'magic' }), /check/);
    });
  });

  it('"Grafting performed: no" and grafts exclude each other', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await addGraft(c, site);
      await refused(c, () => saveSurgery(c, site, { grafting: 'no' }), /Delete them before setting Grafting performed to No/);
      const { site: other } = await placedSite(c);
      await saveSurgery(c, other, { grafting: 'no' });
      await refused(c, () => addGraft(c, other), /Change it to Yes before adding a graft/);
    });
  });

  // A placed site can't be deleted in a test (stock_movements is append-only and references it), so check the FKs.
  it('surgical details and grafts are deleted with their implant site', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select conrelid::regclass::text as tbl, confdeltype from pg_constraint
        where contype = 'f' and confrelid = 'public.implant_sites'::regclass
          and conrelid in ('public.implant_surgery'::regclass, 'public.implant_grafts'::regclass) order by 1`);
      expect(rows).toEqual([{ tbl: 'implant_grafts', confdeltype: 'c' }, { tbl: 'implant_surgery', confdeltype: 'c' }]);
    });
  });
});

describe('surgical details: access and history', () => {
  it('needs Edit on Patients to write; View on Patients to read; delegates read nothing', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await saveSurgery(c, site, { flap: 'crestal' });
      const graft = await addGraft(c, site);
      await actAs(c, users.viewer);
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless' }), /permission to edit Patients/);
      await refused(c, () => addGraft(c, site), /permission to edit Patients/);
      await refused(c, () => c.query('select public.delete_implant_graft($1)', [graft]), /permission to edit Patients/);
      expect((await c.query('select count(*)::int as n from public.implant_surgery where site_id = $1', [site])).rows[0].n).toBe(1);
      await refused(c, () => c.query(`update public.implant_surgery set flap = 'other' where site_id = $1`, [site]), /permission denied/);
      await refused(c, () => c.query(`delete from public.implant_grafts where id = $1`, [graft]), /permission denied/);

      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect((await c.query('select count(*)::int as n from public.implant_surgery where site_id = $1', [site])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.implant_grafts where site_id = $1', [site])).rows[0].n).toBe(0);

      await actAs(c, users.delegate);
      expect((await c.query('select count(*)::int as n from public.implant_surgery')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.implant_grafts')).rows[0].n).toBe(0);
    });
  });

  it('surgery and graft changes appear in the patient History', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await saveSurgery(c, site, { flap: 'crestal' });
      await addGraft(c, site);
      const { rows } = await c.query('select table_name, action from public.patient_history($1)', [patient]);
      expect(rows).toEqual(expect.arrayContaining([
        { table_name: 'implant_surgery', action: 'INSERT' },
        { table_name: 'implant_grafts', action: 'INSERT' },
      ]));
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:db -- research-capture`
Expected: the medical-history tests PASS; the new ones FAIL — `function public.save_implant_surgery(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `web/supabase/migrations/0044_implant_surgery.sql`:

```sql
-- Research readiness, part 1: surgical details of a placed implant (one row per implant) and its grafts (any
-- number). Placement itself (place_implant_v2) is unchanged: details are added then or later. An empty value
-- means not recorded. Writes go only through the definer functions below.
create table public.implant_surgery (
  site_id uuid primary key references public.implant_sites (id) on delete cascade,
  extraction_date date,
  placement_timing text check (placement_timing in ('immediate', 'early_soft_tissue', 'early_partial_bone', 'delayed')),
  soft_tissue_phenotype text check (soft_tissue_phenotype in ('thin', 'thick')),
  keratinized_mucosa_mm numeric(3, 1) check (keratinized_mucosa_mm between 0 and 15),
  flap text check (flap in ('flapless', 'crestal', 'crestal_releasing', 'papilla_sparing', 'other')),
  torque_type text check (torque_type in ('peak', 'final')),
  healing text check (healing in ('submerged', 'transmucosal', 'immediate_provisional')),
  primary_closure text check (primary_closure in ('yes', 'no')),
  grafting_performed text check (grafting_performed in ('yes', 'no')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);

create table public.implant_grafts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  procedure text not null check (procedure in ('socket_preservation', 'gbr', 'horizontal_augmentation', 'vertical_augmentation',
    'sinus_crestal', 'sinus_lateral', 'ridge_split', 'other')),
  timing text not null check (timing in ('simultaneous', 'staged')),
  performed_on date,
  material text check (material in ('autogenous', 'allograft', 'xenograft', 'alloplast', 'combination', 'none')),
  product text not null default '' check (length(product) <= 120),
  membrane text check (membrane in ('none', 'resorbable', 'non_resorbable')),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_grafts_staged_date check ((timing = 'staged') = (performed_on is not null))
);
create index implant_grafts_site_idx on public.implant_grafts (site_id);

create trigger implant_surgery_set_updated_at before update on public.implant_surgery
  for each row execute function app_private.set_updated_at();
create trigger implant_grafts_set_updated_at before update on public.implant_grafts
  for each row execute function app_private.set_updated_at();
create trigger implant_surgery_audit after insert or update or delete on public.implant_surgery
  for each row execute function app_private.audit_row('site_id');
create trigger implant_grafts_audit after insert or update or delete on public.implant_grafts
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_surgery, public.implant_grafts from public, anon, authenticated;
grant select on public.implant_surgery, public.implant_grafts to authenticated;
alter table public.implant_surgery enable row level security;
alter table public.implant_grafts enable row level security;
create policy implant_surgery_select on public.implant_surgery for select to authenticated using (public.is_active_user());
create policy implant_grafts_select on public.implant_grafts for select to authenticated using (public.is_active_user());
create policy implant_surgery_area_read on public.implant_surgery as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));
create policy implant_grafts_area_read on public.implant_grafts as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- The site must be placed (placed, restored or failed); returns it locked. Lock order: site, then its details.
create function app_private.lock_placed_site(p_site uuid) returns public.implant_sites
language plpgsql set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Surgical details can only be recorded for a placed implant.');
  end if;
  return v_site;
end $$;

create function public.save_implant_surgery(
  p_site uuid, p_extraction_date date, p_placement_timing text, p_soft_tissue_phenotype text, p_keratinized_mucosa_mm numeric,
  p_flap text, p_torque_type text, p_healing text, p_primary_closure text, p_grafting_performed text,
  p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_row public.implant_surgery;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_placed_site(p_site);
  if p_extraction_date is not null and p_extraction_date > v_site.placed_on then
    perform app_private.fail(format('The extraction date can''t be after the placement date (%s).', v_site.placed_on));
  end if;
  if p_placement_timing = 'immediate' and p_extraction_date is not null and p_extraction_date <> v_site.placed_on then
    perform app_private.fail('An immediate placement is on the extraction day. Change the timing or the extraction date.');
  end if;
  if p_grafting_performed = 'no' and exists (select 1 from public.implant_grafts where site_id = p_site) then
    perform app_private.fail('This implant has grafts recorded. Delete them before setting Grafting performed to No.');
  end if;

  select * into v_row from public.implant_surgery where site_id = p_site for update;
  if found then
    if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    update public.implant_surgery
    set extraction_date = p_extraction_date, placement_timing = p_placement_timing, soft_tissue_phenotype = p_soft_tissue_phenotype,
        keratinized_mucosa_mm = p_keratinized_mucosa_mm, flap = p_flap, torque_type = p_torque_type, healing = p_healing,
        primary_closure = p_primary_closure, grafting_performed = p_grafting_performed
    where site_id = p_site;
  else
    if p_expected_updated_at is not null then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    insert into public.implant_surgery (site_id, extraction_date, placement_timing, soft_tissue_phenotype, keratinized_mucosa_mm,
      flap, torque_type, healing, primary_closure, grafting_performed)
    values (p_site, p_extraction_date, p_placement_timing, p_soft_tissue_phenotype, p_keratinized_mucosa_mm,
      p_flap, p_torque_type, p_healing, p_primary_closure, p_grafting_performed);
  end if;
end $$;

-- Shared checks for adding or changing a graft on a locked, placed site.
create function app_private.check_graft(v_site public.implant_sites, p_procedure text, p_timing text, p_performed_on date)
returns void
language plpgsql set search_path = '' as $$
begin
  if p_procedure is null then perform app_private.fail('Choose the graft procedure.'); end if;
  if p_timing is null then perform app_private.fail('Choose simultaneous or staged.'); end if;
  if p_timing = 'staged' and (p_performed_on is null or p_performed_on >= v_site.placed_on) then
    perform app_private.fail(format('A staged graft needs its date, before the placement date (%s).', v_site.placed_on));
  end if;
end $$;

create function public.add_implant_graft(
  p_site uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_placed_site(p_site);
  if exists (select 1 from public.implant_surgery where site_id = p_site and grafting_performed = 'no') then
    perform app_private.fail('Grafting performed is set to No for this implant. Change it to Yes before adding a graft.');
  end if;
  perform app_private.check_graft(v_site, p_procedure, p_timing, p_performed_on);
  insert into public.implant_grafts (site_id, procedure, timing, performed_on, material, product, membrane, notes)
  values (p_site, p_procedure, p_timing, case when p_timing = 'staged' then p_performed_on end, p_material,
    coalesce(trim(p_product), ''), p_membrane, coalesce(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.update_implant_graft(
  p_graft uuid, p_procedure text, p_timing text, p_performed_on date, p_material text, p_product text, p_membrane text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site_id uuid;
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  select site_id into v_site_id from public.implant_grafts where id = p_graft;
  if not found then perform app_private.fail('Graft not found.'); end if;
  v_site := app_private.lock_placed_site(v_site_id);
  perform app_private.check_graft(v_site, p_procedure, p_timing, p_performed_on);
  update public.implant_grafts
  set procedure = p_procedure, timing = p_timing, performed_on = case when p_timing = 'staged' then p_performed_on end,
      material = p_material, product = coalesce(trim(p_product), ''), membrane = p_membrane, notes = coalesce(trim(p_notes), '')
  where id = p_graft;
end $$;

create function public.delete_implant_graft(p_graft uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  select site_id into v_site_id from public.implant_grafts where id = p_graft;
  if not found then perform app_private.fail('Graft not found.'); end if;
  perform app_private.lock_placed_site(v_site_id);
  delete from public.implant_grafts where id = p_graft;
end $$;

revoke execute on function public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz) to authenticated;
revoke execute on function public.add_implant_graft(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.add_implant_graft(uuid, text, text, date, text, text, text, text) to authenticated;
revoke execute on function public.update_implant_graft(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.update_implant_graft(uuid, text, text, date, text, text, text, text) to authenticated;
revoke execute on function public.delete_implant_graft(uuid) from public, anon;
grant execute on function public.delete_implant_graft(uuid) to authenticated;
revoke execute on function app_private.lock_placed_site(uuid) from public;
revoke execute on function app_private.check_graft(public.implant_sites, text, text, date) from public;

-- History tab (latest definition in 0020) and the audit-log read rule (latest in 0036) cover the new tables.
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
     or (a.table_name in ('site_components', 'implant_followups', 'implant_surgery', 'implant_grafts')
         and coalesce(a.after ->> 'site_id', a.before ->> 'site_id') in
             (select s.id::text from public.implant_sites s where s.patient_id = p_patient))
  order by a.id desc
  limit 500;
$$;

drop policy audit_log_area_read on public.audit_log;
create policy audit_log_area_read on public.audit_log as restrictive for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.can('patients', 'view'))
        and table_name in ('patients', 'medical_history', 'tooth_status', 'visit_notes',
                           'implant_sites', 'site_components', 'implant_followups', 'implant_surgery', 'implant_grafts'))
  );
```

Before writing this, open `web/supabase/migrations/0036_audit_log_area_read.sql` and confirm the policy text still matches what is replaced above (only the two table names are added). Also confirm the `app_private` functions in your database: `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'app_private' and proname in ('set_updated_at','audit_row','require_perm','fail')` returns all four.

- [ ] **Step 4: Dry-run the migration in a rolled-back transaction**

Use the dry-run script from Task 1 Step 5. If it is missing from your scratchpad, recreate it with exactly that code. 0043 is already applied by now, so dry-run only 0044:
```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<your scratchpad>/dry-run.ts" supabase/migrations/0044_implant_surgery.sql \
  "select count(*) as n from public.implant_surgery"
```
Expected: `OK: migration applies`, `n` = 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:db -- research-capture permissions audit corrections patient-functions`
Expected: PASS. If `permissions.test.ts` "every public security-definer function checks a permission" fails, a new public function is missing `require_perm(` — fix the migration *only if it hasn't been applied*; otherwise add a new migration.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0044_implant_surgery.sql tests/db/research-capture.test.ts
git commit -m "feat(db): surgical details and grafts for placed implants (0044)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Surgical-details rules in TypeScript

**Files:**
- Create: `web/src/lib/implants/surgery.ts`, `web/src/lib/implants/surgery.test.ts`

**Interfaces:**
- Consumes: `isRealDate`, `todayIso` (`@/lib/dates`), `formatDate` (`@/lib/format`), `YES_NO`, `YesNo` (`@/lib/patients/risk-factors`).
- Produces (all exported from `@/lib/implants/surgery`):
  - Value lists + types + label maps: `PLACEMENT_TIMINGS`/`PlacementTiming`/`PLACEMENT_TIMING_LABELS`/`PLACEMENT_TIMING_HELP`; `PHENOTYPES`/`Phenotype`/`PHENOTYPE_LABELS`; `FLAPS`/`Flap`/`FLAP_LABELS`; `TORQUE_TYPES`/`TorqueType`/`TORQUE_TYPE_LABELS`; `HEALINGS`/`Healing`/`HEALING_LABELS`; `YES_NO_LABELS`; `GRAFT_PROCEDURES`/`GraftProcedure`/`GRAFT_PROCEDURE_LABELS`; `GRAFT_TIMINGS`/`GraftTiming`/`GRAFT_TIMING_LABELS`; `GRAFT_MATERIALS`/`GraftMaterial`/`GRAFT_MATERIAL_LABELS`; `MEMBRANES`/`Membrane`/`MEMBRANE_LABELS`.
  - `type ImplantSurgery`, `type ImplantGraft` (row shapes below).
  - `SURGERY_FIELD_LABELS: Record<SurgeryField, string>`, `SURGERY_TOTAL = 9`.
  - `daysSinceExtraction(extraction: string | null, placedOn: string | null): number | null`
  - `timingWarning(timing: PlacementTiming | null, days: number | null): string | null`
  - `surgeryCompleteness(s: ImplantSurgery | null): { recorded: number; total: number }`
  - `describeSurgery(s: ImplantSurgery | null, placedOn: string | null): string[]`
  - `describeGraft(g: ImplantGraft): string`
  - `surgerySchema`, `graftSchema` (Zod; output keys listed in the code).

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/implants/surgery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  daysSinceExtraction, describeGraft, describeSurgery, graftSchema, surgeryCompleteness, surgerySchema, timingWarning,
  type ImplantGraft, type ImplantSurgery,
} from './surgery';

const empty: ImplantSurgery = {
  site_id: 's1', extraction_date: null, placement_timing: null, soft_tissue_phenotype: null, keratinized_mucosa_mm: null, flap: null,
  torque_type: null, healing: null, primary_closure: null, grafting_performed: null, updated_at: '2026-10-17T10:00:00Z',
};
const full: ImplantSurgery = {
  ...empty, extraction_date: '2026-03-10', placement_timing: 'immediate', soft_tissue_phenotype: 'thick', keratinized_mucosa_mm: 0,
  flap: 'flapless', torque_type: 'peak', healing: 'submerged', primary_closure: 'yes', grafting_performed: 'no',
};
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

describe('days and timing', () => {
  it('counts days from extraction to placement', () => {
    expect(daysSinceExtraction('2026-03-01', '2026-03-10')).toBe(9);
    expect(daysSinceExtraction('2026-03-10', '2026-03-10')).toBe(0);
    expect(daysSinceExtraction(null, '2026-03-10')).toBeNull();
    expect(daysSinceExtraction('2026-03-01', null)).toBeNull();
  });
  it('warns only outside the usual range for the chosen timing', () => {
    expect(timingWarning('early_soft_tissue', 28)).toBeNull();
    expect(timingWarning('early_soft_tissue', 56)).toBeNull();
    expect(timingWarning('early_soft_tissue', 203)).toBe(
      'Early placement with soft-tissue healing usually means 4–8 weeks after extraction; this is 29 weeks.',
    );
    expect(timingWarning('early_partial_bone', 84)).toBeNull();
    expect(timingWarning('early_partial_bone', 113)).toBe(
      'Early placement with partial bone healing usually means 12–16 weeks after extraction; this is 16 weeks.',
    );
    expect(timingWarning('delayed', 113)).toBeNull();
    expect(timingWarning('delayed', 10)).toBe('Delayed placement usually means more than 16 weeks after extraction; this is 10 days.');
    expect(timingWarning('immediate', 0)).toBeNull();
    expect(timingWarning('immediate', 1)).toBe('An immediate placement is on the extraction day; this is 1 day after it.');
    expect(timingWarning(null, 50)).toBeNull();
    expect(timingWarning('delayed', null)).toBeNull();
  });
});

describe('completeness and summaries', () => {
  it('counts the nine fields; zero mm counts as recorded', () => {
    expect(surgeryCompleteness(null)).toEqual({ recorded: 0, total: 9 });
    expect(surgeryCompleteness(empty)).toEqual({ recorded: 0, total: 9 });
    expect(surgeryCompleteness({ ...empty, keratinized_mucosa_mm: 0, flap: 'crestal' })).toEqual({ recorded: 2, total: 9 });
    expect(surgeryCompleteness(full)).toEqual({ recorded: 9, total: 9 });
  });
  it('describes the recorded values in words', () => {
    expect(describeSurgery(full, '2026-03-10')).toEqual([
      'Immediate', '0 days after extraction', 'Thick phenotype', 'Keratinized mucosa 0 mm', 'Flapless', 'Peak torque',
      'Submerged (cover screw)', 'Primary closure', 'No grafting',
    ]);
    expect(describeSurgery({ ...empty, extraction_date: '2026-03-09', primary_closure: 'no', grafting_performed: 'yes' }, '2026-03-10'))
      .toEqual(['1 day after extraction', 'No primary closure', 'Grafted']);
    expect(describeSurgery(null, '2026-03-10')).toEqual([]);
  });
  it('describes a graft', () => {
    const g: ImplantGraft = {
      id: 'g1', site_id: 's1', procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft',
      product: 'Bio-Oss 0.5 g', membrane: 'resorbable', notes: '', created_at: '2026-10-17T10:00:00Z',
    };
    expect(describeGraft(g)).toBe('GBR · Xenograft · Resorbable membrane · Simultaneous · Bio-Oss 0.5 g');
    expect(describeGraft({ ...g, timing: 'staged', performed_on: '2026-01-05', material: null, membrane: null, product: '' }))
      .toMatch(/^GBR · Staged \(.+\)$/);
  });
});

describe('schemas', () => {
  it('parses the surgical details form ("" = not recorded)', () => {
    expect(surgerySchema.parse({
      ...ids, expectedUpdatedAt: '', extractionDate: '2026-03-01', placementTiming: 'delayed', softTissuePhenotype: '',
      keratinizedMucosaMm: '2.5', flap: 'crestal', torqueType: '', healing: 'transmucosal', primaryClosure: 'no', graftingPerformed: '',
    })).toEqual({
      ...ids, expectedUpdatedAt: null, extractionDate: '2026-03-01', placementTiming: 'delayed', softTissuePhenotype: null,
      keratinizedMucosaMm: 2.5, flap: 'crestal', torqueType: null, healing: 'transmucosal', primaryClosure: 'no', graftingPerformed: null,
    });
  });
  it('refuses out-of-range mucosa, a future extraction date and unknown values', () => {
    expect(firstError(surgerySchema.safeParse({ ...ids, keratinizedMucosaMm: '16' }))).toBe('Enter the keratinized mucosa width from 0 to 15 mm.');
    expect(firstError(surgerySchema.safeParse({ ...ids, extractionDate: '2999-01-01' }))).toBe('Enter a real extraction date (today or earlier).');
    expect(firstError(surgerySchema.safeParse({ ...ids, flap: 'zigzag' }))).toBe('Choose the flap from the list.');
  });
  it('parses a graft; a staged graft needs a date; a simultaneous graft drops any date', () => {
    expect(graftSchema.parse({
      ...ids, graftId: '', procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-01-01', material: 'xenograft', product: ' Bio-Oss ',
      membrane: '', notes: '',
    })).toEqual({
      ...ids, graftId: null, procedure: 'gbr', timing: 'simultaneous', performedOn: null, material: 'xenograft', product: 'Bio-Oss',
      membrane: null, notes: '',
    });
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: 'staged', performedOn: '' }))).toBe(
      'Enter the date of the staged graft.',
    );
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: '', timing: 'staged' }))).toBe('Choose the graft procedure.');
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: '' }))).toBe('Choose simultaneous or staged.');
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: 'simultaneous', product: 'x'.repeat(121) }))).toBe(
      'Keep the product under 120 characters.',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- implants/surgery`
Expected: FAIL — `Cannot find module './surgery'`.

- [ ] **Step 3: Implement**

Create `web/src/lib/implants/surgery.ts`:

```ts
import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { YES_NO, type YesNo } from '@/lib/patients/risk-factors';

export const PLACEMENT_TIMINGS = ['immediate', 'early_soft_tissue', 'early_partial_bone', 'delayed'] as const;
export type PlacementTiming = (typeof PLACEMENT_TIMINGS)[number];
export const PLACEMENT_TIMING_LABELS: Record<PlacementTiming, string> = {
  immediate: 'Immediate (at extraction)',
  early_soft_tissue: 'Early, soft-tissue healing (~4–8 weeks)',
  early_partial_bone: 'Early, partial bone healing (~12–16 weeks)',
  delayed: 'Delayed (healed ridge)',
};
/** ITI placement types 1–4, shown beside the choice. */
export const PLACEMENT_TIMING_HELP: Record<PlacementTiming, string> = {
  immediate: 'Type 1: placed the same day as the extraction.',
  early_soft_tissue: 'Type 2: socket covered by soft tissue, usually 4–8 weeks after extraction.',
  early_partial_bone: 'Type 3: partial bone fill of the socket, usually 12–16 weeks after extraction.',
  delayed: 'Type 4: fully healed ridge, usually more than 16 weeks after extraction.',
};
const TIMING_SHORT: Record<PlacementTiming, string> = {
  immediate: 'Immediate', early_soft_tissue: 'Early (soft tissue)', early_partial_bone: 'Early (partial bone)', delayed: 'Delayed',
};
const TIMING_SENTENCE: Record<Exclude<PlacementTiming, 'immediate'>, [string, string]> = {
  early_soft_tissue: ['Early placement with soft-tissue healing', '4–8 weeks'],
  early_partial_bone: ['Early placement with partial bone healing', '12–16 weeks'],
  delayed: ['Delayed placement', 'more than 16 weeks'],
};
/** Usual days from extraction; outside them the form warns but never blocks. */
const USUAL_DAYS: Record<PlacementTiming, [number, number]> = {
  immediate: [0, 0], early_soft_tissue: [28, 56], early_partial_bone: [84, 112], delayed: [113, Infinity],
};

export const PHENOTYPES = ['thin', 'thick'] as const;
export type Phenotype = (typeof PHENOTYPES)[number];
export const PHENOTYPE_LABELS: Record<Phenotype, string> = { thin: 'Thin', thick: 'Thick' };

export const FLAPS = ['flapless', 'crestal', 'crestal_releasing', 'papilla_sparing', 'other'] as const;
export type Flap = (typeof FLAPS)[number];
export const FLAP_LABELS: Record<Flap, string> = {
  flapless: 'Flapless', crestal: 'Crestal incision', crestal_releasing: 'Crestal + releasing incisions',
  papilla_sparing: 'Papilla-sparing', other: 'Other flap',
};

export const TORQUE_TYPES = ['peak', 'final'] as const;
export type TorqueType = (typeof TORQUE_TYPES)[number];
export const TORQUE_TYPE_LABELS: Record<TorqueType, string> = { peak: 'Peak', final: 'Final' };

export const HEALINGS = ['submerged', 'transmucosal', 'immediate_provisional'] as const;
export type Healing = (typeof HEALINGS)[number];
export const HEALING_LABELS: Record<Healing, string> = {
  submerged: 'Submerged (cover screw)', transmucosal: 'Transmucosal (healing abutment)', immediate_provisional: 'Immediate provisional',
};

export const YES_NO_LABELS: Record<YesNo, string> = { yes: 'Yes', no: 'No' };

export const GRAFT_PROCEDURES = [
  'socket_preservation', 'gbr', 'horizontal_augmentation', 'vertical_augmentation', 'sinus_crestal', 'sinus_lateral', 'ridge_split', 'other',
] as const;
export type GraftProcedure = (typeof GRAFT_PROCEDURES)[number];
export const GRAFT_PROCEDURE_LABELS: Record<GraftProcedure, string> = {
  socket_preservation: 'Socket preservation', gbr: 'GBR', horizontal_augmentation: 'Horizontal augmentation',
  vertical_augmentation: 'Vertical augmentation', sinus_crestal: 'Sinus lift, crestal', sinus_lateral: 'Sinus lift, lateral window',
  ridge_split: 'Ridge split', other: 'Other procedure',
};

export const GRAFT_TIMINGS = ['simultaneous', 'staged'] as const;
export type GraftTiming = (typeof GRAFT_TIMINGS)[number];
export const GRAFT_TIMING_LABELS: Record<GraftTiming, string> = { simultaneous: 'Simultaneous', staged: 'Staged (before placement)' };

export const GRAFT_MATERIALS = ['autogenous', 'allograft', 'xenograft', 'alloplast', 'combination', 'none'] as const;
export type GraftMaterial = (typeof GRAFT_MATERIALS)[number];
export const GRAFT_MATERIAL_LABELS: Record<GraftMaterial, string> = {
  autogenous: 'Autogenous', allograft: 'Allograft', xenograft: 'Xenograft', alloplast: 'Alloplast', combination: 'Combination',
  none: 'No graft material',
};

export const MEMBRANES = ['none', 'resorbable', 'non_resorbable'] as const;
export type Membrane = (typeof MEMBRANES)[number];
export const MEMBRANE_LABELS: Record<Membrane, string> = {
  none: 'No membrane', resorbable: 'Resorbable membrane', non_resorbable: 'Non-resorbable membrane',
};

export type ImplantSurgery = {
  site_id: string;
  extraction_date: string | null;
  placement_timing: PlacementTiming | null;
  soft_tissue_phenotype: Phenotype | null;
  keratinized_mucosa_mm: number | null;
  flap: Flap | null;
  torque_type: TorqueType | null;
  healing: Healing | null;
  primary_closure: YesNo | null;
  grafting_performed: YesNo | null;
  updated_at: string;
};

export type ImplantGraft = {
  id: string;
  site_id: string;
  procedure: GraftProcedure;
  timing: GraftTiming;
  performed_on: string | null;
  material: GraftMaterial | null;
  product: string;
  membrane: Membrane | null;
  notes: string;
  created_at: string;
};

export const SURGERY_FIELD_LABELS = {
  placement_timing: 'placement timing', extraction_date: 'extraction date', soft_tissue_phenotype: 'phenotype',
  keratinized_mucosa_mm: 'keratinized mucosa', flap: 'flap', torque_type: 'torque type', healing: 'healing',
  primary_closure: 'primary closure', grafting_performed: 'grafting performed',
} as const;
type SurgeryField = keyof typeof SURGERY_FIELD_LABELS;
const SURGERY_FIELDS = Object.keys(SURGERY_FIELD_LABELS) as SurgeryField[];
export const SURGERY_TOTAL = SURGERY_FIELDS.length;

export function daysSinceExtraction(extraction: string | null, placedOn: string | null): number | null {
  if (!extraction || !placedOn) return null;
  return Math.round((Date.parse(`${placedOn}T00:00:00Z`) - Date.parse(`${extraction}T00:00:00Z`)) / 86_400_000);
}

const span = (days: number) => (days < 14 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${Math.round(days / 7)} weeks`);

export function timingWarning(timing: PlacementTiming | null, days: number | null): string | null {
  if (!timing || days === null) return null;
  const [min, max] = USUAL_DAYS[timing];
  if (days >= min && days <= max) return null;
  if (timing === 'immediate') return `An immediate placement is on the extraction day; this is ${span(days)} after it.`;
  const [what, range] = TIMING_SENTENCE[timing];
  return `${what} usually means ${range} after extraction; this is ${span(days)}.`;
}

export function surgeryCompleteness(s: ImplantSurgery | null): { recorded: number; total: number } {
  const recorded = s ? SURGERY_FIELDS.filter((f) => s[f] !== null && s[f] !== undefined).length : 0;
  return { recorded, total: SURGERY_TOTAL };
}

export function describeSurgery(s: ImplantSurgery | null, placedOn: string | null): string[] {
  if (!s) return [];
  const days = daysSinceExtraction(s.extraction_date, placedOn);
  return [
    s.placement_timing ? TIMING_SHORT[s.placement_timing] : null,
    days !== null ? `${days} ${days === 1 ? 'day' : 'days'} after extraction` : null,
    s.soft_tissue_phenotype ? `${PHENOTYPE_LABELS[s.soft_tissue_phenotype]} phenotype` : null,
    s.keratinized_mucosa_mm !== null ? `Keratinized mucosa ${s.keratinized_mucosa_mm} mm` : null,
    s.flap ? FLAP_LABELS[s.flap] : null,
    s.torque_type ? `${TORQUE_TYPE_LABELS[s.torque_type]} torque` : null,
    s.healing ? HEALING_LABELS[s.healing] : null,
    s.primary_closure ? (s.primary_closure === 'yes' ? 'Primary closure' : 'No primary closure') : null,
    s.grafting_performed ? (s.grafting_performed === 'yes' ? 'Grafted' : 'No grafting') : null,
  ].filter((x): x is string => x !== null);
}

export function describeGraft(g: ImplantGraft): string {
  return [
    GRAFT_PROCEDURE_LABELS[g.procedure],
    g.material ? GRAFT_MATERIAL_LABELS[g.material] : null,
    g.membrane ? MEMBRANE_LABELS[g.membrane] : null,
    g.timing === 'staged' && g.performed_on ? `Staged (${formatDate(g.performed_on)})` : 'Simultaneous',
    g.product || null,
  ].filter(Boolean).join(' · ');
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(blankToNull, z.enum(values, { message }).nullable());
const optionalPastDate = (message: string) =>
  z.preprocess(blankToNull, z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message }).nullable());
const id = (message: string) => z.string({ message }).uuid({ message });
const KM = 'Enter the keratinized mucosa width from 0 to 15 mm.';

export const surgerySchema = z.object({
  siteId: id('Implant not found.'),
  patientId: id('Patient not found.'),
  expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
  extractionDate: optionalPastDate('Enter a real extraction date (today or earlier).'),
  placementTiming: optionalEnum(PLACEMENT_TIMINGS, 'Choose the placement timing from the list.'),
  softTissuePhenotype: optionalEnum(PHENOTYPES, 'Choose thin or thick.'),
  keratinizedMucosaMm: z.preprocess(
    (v) => (blankToNull(v) === null ? null : Number(v)),
    z.number({ message: KM }).min(0, { message: KM }).max(15, { message: KM }).nullable(),
  ),
  flap: optionalEnum(FLAPS, 'Choose the flap from the list.'),
  torqueType: optionalEnum(TORQUE_TYPES, 'Choose peak or final.'),
  healing: optionalEnum(HEALINGS, 'Choose the healing from the list.'),
  primaryClosure: optionalEnum(YES_NO, 'Choose yes or no.'),
  graftingPerformed: optionalEnum(YES_NO, 'Choose yes or no.'),
});

export const graftSchema = z
  .object({
    graftId: z.preprocess(blankToNull, z.string().uuid().nullable()),
    siteId: id('Implant not found.'),
    patientId: id('Patient not found.'),
    procedure: z.enum(GRAFT_PROCEDURES, { message: 'Choose the graft procedure.' }),
    timing: z.enum(GRAFT_TIMINGS, { message: 'Choose simultaneous or staged.' }),
    performedOn: optionalPastDate('Enter the date of the staged graft.'),
    material: optionalEnum(GRAFT_MATERIALS, 'Choose the graft material from the list.'),
    product: z.string().trim().max(120, { message: 'Keep the product under 120 characters.' }).default(''),
    membrane: optionalEnum(MEMBRANES, 'Choose the membrane from the list.'),
    notes: z.string().trim().max(500, { message: 'Keep the notes under 500 characters.' }).default(''),
  })
  .superRefine((g, ctx) => {
    if (g.timing === 'staged' && !g.performedOn) {
      ctx.addIssue({ code: 'custom', path: ['performedOn'], message: 'Enter the date of the staged graft.' });
    }
  })
  .transform((g) => ({ ...g, performedOn: g.timing === 'staged' ? g.performedOn : null }));
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- implants/surgery` → PASS. `npx tsc --noEmit` → clean (apart from nothing new). `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/implants
git commit -m "feat(implants): surgical details and graft rules, labels and schemas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Load and save surgical details (site data, server actions, history text)

**Files:**
- Create: `web/src/app/(app)/patients/[id]/surgery-actions.ts`, `web/src/app/(app)/patients/[id]/surgery-actions.test.ts`
- Modify: `web/src/lib/inventory/types.ts` (`ImplantSite`), `web/src/app/(app)/patients/[id]/chart-data.ts` (`SITE_SELECT`, `sortSite`), `web/src/lib/patients/history.ts` (`describeChange`)
- Test: `web/src/lib/patients/history.test.ts`

**Interfaces:**
- Consumes: `surgerySchema`, `graftSchema`, `ImplantSurgery`, `ImplantGraft`, `SURGERY_FIELD_LABELS`, `GRAFT_PROCEDURE_LABELS` (Task 5); DB functions from Task 4.
- Produces:
  - `ImplantSite` gains `surgery: ImplantSurgery | null; grafts: ImplantGraft[]` (grafts sorted by `created_at`).
  - Server actions (`'use server'`, each returns `Promise<{ error?: string }>`): `saveSurgery(input: Record<string, unknown>)`, `saveGraft(input: Record<string, unknown>)` (adds when `graftId` is empty, otherwise updates), `deleteGraft(input: { patientId: string; graftId: string })`.
  - History lines: `Surgical details recorded`, `Surgical details changed: <fields>`, `Graft added: <procedure>`, `Graft changed: <procedure>`, `Graft deleted: <procedure>`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/(app)/patients/[id]/surgery-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('surgery actions', () => {
  it('saves surgical details with the version the form was rendered from', async () => {
    expect(await saveSurgery({ ...ids, expectedUpdatedAt: '2026-10-17T10:00:00.123456+00:00', flap: 'crestal', keratinizedMucosaMm: '2' })).toEqual({});
    expect(rpc).toHaveBeenCalledWith('save_implant_surgery', {
      p_site: ids.siteId, p_extraction_date: null, p_placement_timing: null, p_soft_tissue_phenotype: null, p_keratinized_mucosa_mm: 2,
      p_flap: 'crestal', p_torque_type: null, p_healing: null, p_primary_closure: null, p_grafting_performed: null,
      p_expected_updated_at: '2026-10-17T10:00:00.123456+00:00',
    });
  });

  it('shows a database business error verbatim and never calls the database for an invalid form', async () => {
    rpc.mockResolvedValue({ error: { message: 'These surgical details were changed by someone else. Reload to see them.', hint: 'user' } });
    expect(await saveSurgery({ ...ids })).toEqual({ error: 'These surgical details were changed by someone else. Reload to see them.' });
    rpc.mockClear();
    expect(await saveSurgery({ ...ids, keratinizedMucosaMm: '99' })).toEqual({ error: 'Enter the keratinized mucosa width from 0 to 15 mm.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('adds a new graft, dropping a date left over from "staged"', async () => {
    await saveGraft({ ...ids, graftId: '', procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-01-01', material: 'xenograft', product: '', membrane: '', notes: '' });
    expect(rpc).toHaveBeenCalledWith('add_implant_graft', {
      p_site: ids.siteId, p_procedure: 'gbr', p_timing: 'simultaneous', p_performed_on: null, p_material: 'xenograft',
      p_product: '', p_membrane: null, p_notes: '',
    });
  });

  it('updates an existing graft and deletes one', async () => {
    const graftId = '00000000-0000-4000-8000-000000000009';
    await saveGraft({ ...ids, graftId, procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01' });
    expect(rpc).toHaveBeenCalledWith('update_implant_graft', {
      p_graft: graftId, p_procedure: 'sinus_lateral', p_timing: 'staged', p_performed_on: '2025-12-01', p_material: null,
      p_product: '', p_membrane: null, p_notes: '',
    });
    await deleteGraft({ patientId: ids.patientId, graftId });
    expect(rpc).toHaveBeenLastCalledWith('delete_implant_graft', { p_graft: graftId });
  });
});
```

Add to `web/src/lib/patients/history.test.ts`:

```ts
describe('describeChange: surgical details and grafts', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A' };
  it('describes surgical details', () => {
    expect(describeChange({ ...base, table_name: 'implant_surgery', action: 'INSERT', before: null, after: { flap: 'crestal' } }))
      .toBe('Surgical details recorded');
    expect(describeChange({
      ...base, table_name: 'implant_surgery', action: 'UPDATE',
      before: { flap: 'crestal', healing: null, updated_at: 'a' }, after: { flap: 'flapless', healing: 'submerged', updated_at: 'b' },
    })).toBe('Surgical details changed: flap, healing');
  });
  it('describes grafts', () => {
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'INSERT', before: null, after: { procedure: 'gbr' } }))
      .toBe('Graft added: GBR');
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'UPDATE', before: { procedure: 'gbr' }, after: { procedure: 'sinus_lateral' } }))
      .toBe('Graft changed: Sinus lift, lateral window');
    expect(describeChange({ ...base, table_name: 'implant_grafts', action: 'DELETE', before: { procedure: 'ridge_split' }, after: null }))
      .toBe('Graft deleted: Ridge split');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- surgery-actions history`
Expected: FAIL — module `./surgery-actions` not found; history returns `implant_surgery insert`.

- [ ] **Step 3: Implement**

Create `web/src/app/(app)/patients/[id]/surgery-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { graftSchema, surgerySchema } from '@/lib/implants/surgery';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function saveSurgery(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = surgerySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  return run(s.patientId, 'save_implant_surgery', {
    p_site: s.siteId,
    p_extraction_date: s.extractionDate,
    p_placement_timing: s.placementTiming,
    p_soft_tissue_phenotype: s.softTissuePhenotype,
    p_keratinized_mucosa_mm: s.keratinizedMucosaMm,
    p_flap: s.flap,
    p_torque_type: s.torqueType,
    p_healing: s.healing,
    p_primary_closure: s.primaryClosure,
    p_grafting_performed: s.graftingPerformed,
    p_expected_updated_at: s.expectedUpdatedAt,
  });
}

export async function saveGraft(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = graftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const g = parsed.data;
  const fields = {
    p_procedure: g.procedure, p_timing: g.timing, p_performed_on: g.performedOn, p_material: g.material,
    p_product: g.product, p_membrane: g.membrane, p_notes: g.notes,
  };
  return g.graftId
    ? run(g.patientId, 'update_implant_graft', { p_graft: g.graftId, ...fields })
    : run(g.patientId, 'add_implant_graft', { p_site: g.siteId, ...fields });
}

export async function deleteGraft(input: { patientId: string; graftId: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'delete_implant_graft', { p_graft: input.graftId });
}
```

In `web/src/lib/inventory/types.ts`, add `import type { ImplantGraft, ImplantSurgery } from '@/lib/implants/surgery';` and add to `ImplantSite` (after `followups`):

```ts
  surgery: ImplantSurgery | null;
  grafts: ImplantGraft[];
```

In `web/src/app/(app)/patients/[id]/chart-data.ts`, add a line to `SITE_SELECT` before `slot:`:

```ts
  surgery:implant_surgery(*),
  grafts:implant_grafts(*),
```

and replace `sortSite` with (PostgREST returns the one-to-one `surgery` as an object; the array case is defensive):

```ts
export function sortSite(site: ImplantSite): ImplantSite {
  const surgery = site.surgery as ImplantSite['surgery'] | ImplantSite['surgery'][] | undefined;
  return {
    ...site,
    components: [...site.components].sort((a, b) => (a.fitted_on < b.fitted_on ? -1 : a.fitted_on > b.fitted_on ? 1 : 0)),
    followups: [...site.followups].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    surgery: Array.isArray(surgery) ? surgery[0] ?? null : surgery ?? null,
    grafts: [...(site.grafts ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
  };
}
```

In `web/src/lib/patients/history.ts`, add `import { GRAFT_PROCEDURE_LABELS, SURGERY_FIELD_LABELS, type GraftProcedure } from '@/lib/implants/surgery';` and two cases before `default:`:

```ts
    case 'implant_surgery': {
      if (e.action === 'INSERT') return 'Surgical details recorded';
      if (e.action === 'DELETE') return 'Surgical details deleted';
      const changed = changedFields(e.before, e.after, SURGERY_FIELD_LABELS);
      return changed.length ? `Surgical details changed: ${changed.join(', ')}` : 'Surgical details saved (no changes)';
    }
    case 'implant_grafts': {
      const procedure = (e.after ?? e.before)?.procedure as GraftProcedure;
      const label = GRAFT_PROCEDURE_LABELS[procedure] ?? String(procedure);
      if (e.action === 'INSERT') return `Graft added: ${label}`;
      if (e.action === 'DELETE') return `Graft deleted: ${label}`;
      return `Graft changed: ${label}`;
    }
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- surgery-actions history chart-panel implant-forms corrections components` → PASS. `npx tsc --noEmit` → clean. If an existing test fixture typed as `ImplantSite` (without `as unknown as`) now fails typecheck, add `surgery: null, grafts: []` to it.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/patients/[id]/surgery-actions.ts" "src/app/(app)/patients/[id]/surgery-actions.test.ts" "src/app/(app)/patients/[id]/chart-data.ts" src/lib/inventory/types.ts src/lib/patients/history.ts src/lib/patients/history.test.ts
git commit -m "feat(implants): load and save surgical details and grafts; History lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Surgical details block on the chart

**Files:**
- Create: `web/src/app/(app)/patients/[id]/surgical-details.tsx`, `web/src/app/(app)/patients/[id]/surgical-details.test.tsx`
- Modify: `web/src/app/(app)/patients/[id]/implant-forms.tsx` (export `Field`, `Footer`, `useSubmit`; `PlaceForm` gets `onPlaced`; remove the Graft input), `web/src/app/(app)/patients/[id]/implant-section.tsx` (`SiteDetails` renders the block; old graft label; `justPlaced`), `web/src/app/(app)/patients/[id]/corrections.tsx` (remove the Graft input)
- Test: `web/src/app/(app)/patients/[id]/implant-forms.test.tsx`, `web/src/app/(app)/patients/[id]/corrections.test.tsx`

**Interfaces:**
- Consumes: `saveSurgery`, `saveGraft`, `deleteGraft` (Task 6); everything from `@/lib/implants/surgery` (Task 5); `ImplantSite.surgery` / `.grafts` (Task 6).
- Produces: `SurgicalDetails({ site, patientId, editable, startOpen }: { site: ImplantSite; patientId: string; editable: boolean; startOpen?: boolean })` — a `<details data-testid="surgical-details">` whose summary reads "Surgical details" + badge "N of 9 recorded"; buttons "Edit surgical details", "Save surgical details", "Add graft", "Save graft", per-graft "Edit graft" / "Delete graft" → "Confirm delete". Form controls are labelled: "Placement timing", "Extraction date", "Soft-tissue phenotype", "Keratinized mucosa (mm)", "Flap", "Torque measured as", "Healing", "Primary closure", "Grafting performed"; graft form: "Procedure", "Graft timing", "Graft date", "Material", "Product", "Membrane", "Graft notes".

- [ ] **Step 1: Write the failing component tests**

Create `web/src/app/(app)/patients/[id]/surgical-details.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ImplantSite } from '@/lib/inventory/types';
import type { ImplantGraft, ImplantSurgery } from '@/lib/implants/surgery';

vi.mock('./surgery-actions', () => ({ saveSurgery: vi.fn(), saveGraft: vi.fn(), deleteGraft: vi.fn() }));
import { SurgicalDetails } from './surgical-details';
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

const surgery: ImplantSurgery = {
  site_id: 's1', extraction_date: null, placement_timing: 'delayed', soft_tissue_phenotype: null, keratinized_mucosa_mm: null,
  flap: 'crestal', torque_type: null, healing: null, primary_closure: null, grafting_performed: 'yes', updated_at: '2026-10-17T10:00:00.5+00:00',
};
const graft: ImplantGraft = {
  id: 'g1', site_id: 's1', procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft', product: '',
  membrane: 'resorbable', notes: '', created_at: '2026-10-17T10:00:00Z',
};
const site = (over: Partial<ImplantSite> = {}) =>
  ({ id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10', surgery, grafts: [], ...over }) as unknown as ImplantSite;

beforeEach(() => {
  vi.mocked(saveSurgery).mockReset().mockResolvedValue({});
  vi.mocked(saveGraft).mockReset().mockResolvedValue({});
  vi.mocked(deleteGraft).mockReset().mockResolvedValue({});
});

describe('<SurgicalDetails>', () => {
  it('shows completeness, the recorded values and the missing-graft warning', () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    const box = screen.getByTestId('surgical-details');
    expect(within(box).getByText('3 of 9 recorded')).toHaveClass('badge-warn');
    expect(box).toHaveTextContent('Delayed · Crestal incision · Grafted');
    expect(box).toHaveTextContent('Grafting is marked as performed, but no graft is recorded.');
  });

  it('shows a complete record with an ok badge and nothing to edit for viewers', () => {
    const full = { ...surgery, extraction_date: '2025-10-01', soft_tissue_phenotype: 'thick', keratinized_mucosa_mm: 2, torque_type: 'peak',
      healing: 'submerged', primary_closure: 'yes' } as ImplantSurgery;
    render(<SurgicalDetails site={site({ surgery: full, grafts: [graft] })} patientId="pt" editable={false} />);
    expect(screen.getByText('9 of 9 recorded')).toHaveClass('badge-ok');
    expect(screen.getByText('GBR · Xenograft · Resorbable membrane · Simultaneous')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit surgical details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add graft' })).not.toBeInTheDocument();
  });

  it('opens with a prompt right after placement, and shows "Nothing recorded yet" with no record', () => {
    render(<SurgicalDetails site={site({ surgery: null })} patientId="pt" editable startOpen />);
    expect(screen.getByTestId('surgical-details')).toHaveAttribute('open');
    expect(screen.getByText('Add surgical details now or later.')).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('0 of 9 recorded')).toBeInTheDocument();
  });

  it('edits the details, warns about an unusual timing, and sends the version it was rendered from', async () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit surgical details' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Placement timing' }), { target: { value: 'early_soft_tissue' } });
    fireEvent.change(screen.getByLabelText('Extraction date'), { target: { value: '2025-08-20' } });
    expect(screen.getByText(/usually means 4–8 weeks after extraction; this is 29 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/Type 2: socket covered by soft tissue/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keratinized mucosa (mm)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save surgical details' }));
    expect(vi.mocked(saveSurgery)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', expectedUpdatedAt: '2026-10-17T10:00:00.5+00:00', extractionDate: '2025-08-20',
      placementTiming: 'early_soft_tissue', softTissuePhenotype: '', keratinizedMucosaMm: '3', flap: 'crestal', torqueType: '',
      healing: '', primaryClosure: '', graftingPerformed: 'yes',
    });
    expect(await screen.findByRole('button', { name: 'Edit surgical details' })).toBeInTheDocument();
  });

  it('keeps the form and shows the error when saving fails', async () => {
    vi.mocked(saveSurgery).mockResolvedValue({ error: 'These surgical details were changed by someone else. Reload to see them.' });
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit surgical details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save surgical details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else');
    expect(screen.getByRole('button', { name: 'Save surgical details' })).toBeInTheDocument();
  });

  it('adds a graft; the date only shows for a staged graft', async () => {
    render(<SurgicalDetails site={site()} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Add graft' }));
    expect(screen.queryByLabelText('Graft date')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Procedure' }), { target: { value: 'sinus_lateral' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Graft timing' }), { target: { value: 'staged' } });
    fireEvent.change(screen.getByLabelText('Graft date'), { target: { value: '2025-12-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Material' }), { target: { value: 'combination' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save graft' }));
    expect(vi.mocked(saveGraft)).toHaveBeenCalledWith({
      graftId: '', siteId: 's1', patientId: 'pt', procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01',
      material: 'combination', product: '', membrane: '', notes: '',
    });
  });

  it('deletes a graft only after confirming; no Add graft when grafting is "no"', async () => {
    const { unmount } = render(<SurgicalDetails site={site({ grafts: [graft] })} patientId="pt" editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete graft' }));
    expect(vi.mocked(deleteGraft)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(vi.mocked(deleteGraft)).toHaveBeenCalledWith({ patientId: 'pt', graftId: 'g1' });
    unmount();
    render(<SurgicalDetails site={site({ surgery: { ...surgery, grafting_performed: 'no' } })} patientId="pt" editable />);
    expect(screen.queryByRole('button', { name: 'Add graft' })).not.toBeInTheDocument();
  });
});
```

In `web/src/app/(app)/patients/[id]/implant-forms.test.tsx`, add:

```tsx
describe('<PlaceForm> graft', () => {
  it('no longer asks for a free-text graft (grafts go in Surgical details)', () => {
    render(<PlaceForm patientId="pt" tooth={36} data={data} onDone={() => {}} plannedProductId={null} />);
    expect(screen.queryByLabelText('Graft (optional)')).not.toBeInTheDocument();
  });
});
```

In `web/src/app/(app)/patients/[id]/corrections.test.tsx`, change the fixture to `graft: 'Bio-Oss old note'`, update the expected `correctPlacement` call to `graft: 'Bio-Oss old note'`, and add before the click: `expect(within(box).queryByLabelText('Graft')).not.toBeInTheDocument();`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- surgical-details implant-forms corrections`
Expected: FAIL — `./surgical-details` missing; the Graft inputs still present.

- [ ] **Step 3: Export the shared form helpers and remove the Graft inputs**

In `web/src/app/(app)/patients/[id]/implant-forms.tsx`:
- change `function useSubmit(` → `export function useSubmit(`, `function Field(` → `export function Field(`, `function Footer(` → `export function Footer(`.
- In `PlaceForm`, add an optional prop `onPlaced?: () => void` to its props type (`Base & { plannedProductId: …; onPlaced?: () => void }`) and destructure it; change `useSubmit(placeImplant, onDone)` to `useSubmit(placeImplant, () => { onPlaced?.(); onDone(); })`.
- Delete the `<Field label="Graft (optional)">…</Field>` block. Keep `graft: ''` in the state (the action still sends an empty graft to `place_implant_v2`).

In `web/src/app/(app)/patients/[id]/corrections.tsx`, delete the `<label className="block"><span className="label">Graft</span>…</label>` block. Keep `graft: site.graft ?? ''` in the state so the old note passes through unchanged.

- [ ] **Step 4: Write the Surgical details component**

Create `web/src/app/(app)/patients/[id]/surgical-details.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import {
  FLAPS, FLAP_LABELS, GRAFT_MATERIALS, GRAFT_MATERIAL_LABELS, GRAFT_PROCEDURES, GRAFT_PROCEDURE_LABELS, GRAFT_TIMINGS,
  GRAFT_TIMING_LABELS, HEALINGS, HEALING_LABELS, MEMBRANES, MEMBRANE_LABELS, PHENOTYPES, PHENOTYPE_LABELS, PLACEMENT_TIMINGS,
  PLACEMENT_TIMING_HELP, PLACEMENT_TIMING_LABELS, TORQUE_TYPES, TORQUE_TYPE_LABELS, YES_NO_LABELS,
  daysSinceExtraction, describeGraft, describeSurgery, surgeryCompleteness, timingWarning,
  type ImplantGraft, type PlacementTiming,
} from '@/lib/implants/surgery';
import { YES_NO } from '@/lib/patients/risk-factors';
import { Field, Footer, useSubmit } from './implant-forms';
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

type Props = { site: ImplantSite; patientId: string; editable: boolean; startOpen?: boolean };

function Choice<T extends string>({ label, value, onChange, values, labels }: {
  label: string; value: string; onChange: (v: string) => void; values: readonly T[]; labels: Record<T, string>;
}) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— not recorded</option>
        {values.map((v) => <option key={v} value={v}>{labels[v]}</option>)}
      </select>
    </Field>
  );
}

export function SurgicalDetails({ site, patientId, editable, startOpen = false }: Props) {
  const [editing, setEditing] = useState(false);
  const { recorded, total } = surgeryCompleteness(site.surgery);
  const parts = describeSurgery(site.surgery, site.placed_on);
  const grafts = site.grafts ?? [];
  const missingGraft = site.surgery?.grafting_performed === 'yes' && grafts.length === 0;
  return (
    <details open={startOpen} data-testid="surgical-details" className="rounded-lg border border-line px-3 py-2.5">
      <summary className="cursor-pointer font-medium">
        Surgical details{' '}
        <span className={recorded === total ? 'badge badge-ok' : 'badge badge-warn'}>{recorded} of {total} recorded</span>
      </summary>
      <div className="mt-2 space-y-3">
        {startOpen && <p className="text-muted">Add surgical details now or later.</p>}
        {editing ? (
          <SurgeryForm site={site} patientId={patientId} onDone={() => setEditing(false)} />
        ) : (
          <>
            {parts.length > 0 ? <p>{parts.join(' · ')}</p> : <p className="text-muted">Nothing recorded yet.</p>}
            {editable && (
              <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>Edit surgical details</button>
            )}
          </>
        )}
        {missingGraft && <p className="text-warn">Grafting is marked as performed, but no graft is recorded. Add it below.</p>}
        <Grafts site={site} patientId={patientId} grafts={grafts}
          editable={editable} canAdd={editable && site.surgery?.grafting_performed !== 'no'} />
      </div>
    </details>
  );
}

function SurgeryForm({ site, patientId, onDone }: { site: ImplantSite; patientId: string; onDone: () => void }) {
  const s = site.surgery;
  const [v, setV] = useState({
    extractionDate: s?.extraction_date ?? '', placementTiming: s?.placement_timing ?? '', softTissuePhenotype: s?.soft_tissue_phenotype ?? '',
    keratinizedMucosaMm: s?.keratinized_mucosa_mm === null || s?.keratinized_mucosa_mm === undefined ? '' : String(s.keratinized_mucosa_mm),
    flap: s?.flap ?? '', torqueType: s?.torque_type ?? '', healing: s?.healing ?? '', primaryClosure: s?.primary_closure ?? '',
    graftingPerformed: s?.grafting_performed ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveSurgery, onDone);
  const timing = (v.placementTiming || null) as PlacementTiming | null;
  const warning = timingWarning(timing, daysSinceExtraction(v.extractionDate || null, site.placed_on));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ siteId: site.id, patientId, expectedUpdatedAt: s?.updated_at ?? '', ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice label="Placement timing" value={v.placementTiming} onChange={set('placementTiming')} values={PLACEMENT_TIMINGS} labels={PLACEMENT_TIMING_LABELS} />
        <Field label="Extraction date">
          <input className="input" type="date" value={v.extractionDate} onChange={(e) => set('extractionDate')(e.target.value)} />
        </Field>
      </div>
      {timing && <p className="text-sm text-muted">{PLACEMENT_TIMING_HELP[timing]}</p>}
      {warning && <p className="text-sm text-warn">{warning}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice label="Soft-tissue phenotype" value={v.softTissuePhenotype} onChange={set('softTissuePhenotype')} values={PHENOTYPES} labels={PHENOTYPE_LABELS} />
        <Field label="Keratinized mucosa (mm)">
          <input className="input" inputMode="decimal" value={v.keratinizedMucosaMm} onChange={(e) => set('keratinizedMucosaMm')(e.target.value)} />
        </Field>
        <Choice label="Flap" value={v.flap} onChange={set('flap')} values={FLAPS} labels={FLAP_LABELS} />
        <Choice label="Torque measured as" value={v.torqueType} onChange={set('torqueType')} values={TORQUE_TYPES} labels={TORQUE_TYPE_LABELS} />
        <Choice label="Healing" value={v.healing} onChange={set('healing')} values={HEALINGS} labels={HEALING_LABELS} />
        <Choice label="Primary closure" value={v.primaryClosure} onChange={set('primaryClosure')} values={YES_NO} labels={YES_NO_LABELS} />
        <Choice label="Grafting performed" value={v.graftingPerformed} onChange={set('graftingPerformed')} values={YES_NO} labels={YES_NO_LABELS} />
      </div>
      <Footer error={error} pending={pending} saveLabel="Save surgical details" onCancel={onDone} />
    </form>
  );
}

function Grafts({ site, patientId, grafts, editable, canAdd }: {
  site: ImplantSite; patientId: string; grafts: ImplantGraft[]; editable: boolean; canAdd: boolean;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="space-y-2">
      <h5 className="font-medium">Grafts</h5>
      {grafts.length === 0 && editing !== 'new' && <p className="text-muted">No graft recorded.</p>}
      <ul className="space-y-1" data-testid="grafts">
        {grafts.map((g) => (
          <li key={g.id}>
            {editing === g.id ? (
              <GraftForm site={site} patientId={patientId} graft={g} onDone={() => setEditing(null)} />
            ) : (
              <GraftRow graft={g} patientId={patientId} editable={editable} onEdit={() => setEditing(g.id)} />
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' && <GraftForm site={site} patientId={patientId} graft={null} onDone={() => setEditing(null)} />}
      {canAdd && editing === null && (
        <button type="button" className="btn-secondary btn" onClick={() => setEditing('new')}>Add graft</button>
      )}
    </div>
  );
}

function GraftRow({ graft, patientId, editable, onEdit }: { graft: ImplantGraft; patientId: string; editable: boolean; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteGraft({ patientId, graftId: graft.id });
      if (result.error) setError(result.error);
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{describeGraft(graft)}</span>
      {graft.notes && <span className="text-muted">— {graft.notes}</span>}
      {editable && !confirming && (
        <>
          <button type="button" className="btn-secondary btn" onClick={onEdit}>Edit graft</button>
          <button type="button" className="btn-secondary btn" onClick={() => setConfirming(true)}>Delete graft</button>
        </>
      )}
      {editable && confirming && (
        <>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Confirm delete</button>
          <button type="button" className="btn-secondary btn" onClick={() => setConfirming(false)}>Keep</button>
        </>
      )}
      {error && <p role="alert" className="w-full text-bad">{error}</p>}
    </div>
  );
}

function GraftForm({ site, patientId, graft, onDone }: { site: ImplantSite; patientId: string; graft: ImplantGraft | null; onDone: () => void }) {
  const [v, setV] = useState({
    procedure: graft?.procedure ?? '', timing: graft?.timing ?? '', performedOn: graft?.performed_on ?? '',
    material: graft?.material ?? '', product: graft?.product ?? '', membrane: graft?.membrane ?? '', notes: graft?.notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveGraft, onDone);
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ graftId: graft?.id ?? '', siteId: site.id, patientId, ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Procedure" required>
          <select className="input" aria-required="true" value={v.procedure} onChange={(e) => set('procedure')(e.target.value)}>
            <option value="">Choose…</option>
            {GRAFT_PROCEDURES.map((p) => <option key={p} value={p}>{GRAFT_PROCEDURE_LABELS[p]}</option>)}
          </select>
        </Field>
        <Field label="Graft timing" required>
          <select className="input" aria-required="true" value={v.timing} onChange={(e) => set('timing')(e.target.value)}>
            <option value="">Choose…</option>
            {GRAFT_TIMINGS.map((t) => <option key={t} value={t}>{GRAFT_TIMING_LABELS[t]}</option>)}
          </select>
        </Field>
        {v.timing === 'staged' && (
          <Field label="Graft date" required>
            <input className="input" type="date" aria-required="true" value={v.performedOn} onChange={(e) => set('performedOn')(e.target.value)} />
          </Field>
        )}
        <Choice label="Material" value={v.material} onChange={set('material')} values={GRAFT_MATERIALS} labels={GRAFT_MATERIAL_LABELS} />
        <Field label="Product">
          <input className="input" value={v.product} maxLength={120} onChange={(e) => set('product')(e.target.value)} />
        </Field>
        <Choice label="Membrane" value={v.membrane} onChange={set('membrane')} values={MEMBRANES} labels={MEMBRANE_LABELS} />
      </div>
      <Field label="Graft notes">
        <input className="input" value={v.notes} maxLength={500} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save graft" onCancel={onDone} />
    </form>
  );
}
```

- [ ] **Step 5: Wire it into the implant panel**

In `web/src/app/(app)/patients/[id]/implant-section.tsx`:
- add `import { SurgicalDetails } from './surgical-details';`
- in `SiteDetails`, change its signature to `function SiteDetails({ site, patientId, data, justPlaced = false }: { site: ImplantSite; patientId: string; data: ChartData; justPlaced?: boolean })`
- change the facts entry `site.graft ? \`Graft: ${site.graft}\` : null,` to `site.graft ? \`Graft (old note): ${site.graft}\` : null,`
- directly after the closing `</div>` of the `rounded-lg border border-line bg-sunken` facts box, add:
  ```tsx
      {site.state !== 'removed' && (
        <SurgicalDetails site={site} patientId={patientId} editable={data.editable} startOpen={justPlaced} />
      )}
  ```
- in `ImplantSection`, add `const [justPlaced, setJustPlaced] = useState(false);`, pass `justPlaced={justPlaced}` to the active-site `<SiteDetails site={site} … />` (not to the "earlier implants" list), and pass `onPlaced={() => setJustPlaced(true)}` to `<PlaceForm … />`.

- [ ] **Step 6: Run the component tests, typecheck and lint**

Run: `npm test -- surgical-details implant-forms corrections chart-panel` → PASS. `npx tsc --noEmit` → clean. `npm run lint` → clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/patients/[id]"
git commit -m "feat(implants): Surgical details block with grafts on the chart; graft text box retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Implants tab completeness column, E2E and release check

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/implants/page.tsx`
- Create: `web/tests/e2e/surgical-details.spec.ts`
- Modify: `CLAUDE.md` (one bullet under Architecture)

**Interfaces:**
- Consumes: `surgeryCompleteness` (Task 5), `SITE_SELECT`/`sortSite` with `surgery` (Task 6), the chart block (Task 7), `place_implant` legacy RPC (as `corrections.spec.ts` uses), E2E helpers `apiAs`, `seedImplantStock`, `seedDelegate`, `createPatientViaUi`, `uniqueName`, `login`.
- Produces: a "Details" column (`data-testid="details-completeness"`) showing `N/9` for placed, restored and failed implants, `—` otherwise.

- [ ] **Step 1: Write the failing E2E spec**

Create `web/tests/e2e/surgical-details.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Surg'), qty: 1, lot: `E2E-S${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Surg'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Surgery patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { patientId };
}

test('records surgical details and a graft; Implants tab and History follow', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  const box = panel.getByTestId('surgical-details');
  await box.locator('summary').click();
  await expect(box.getByText('0 of 9 recorded')).toBeVisible();

  await box.getByRole('button', { name: 'Edit surgical details' }).click();
  await box.getByRole('combobox', { name: 'Placement timing' }).selectOption('delayed');
  await box.getByLabel('Extraction date').fill('2025-01-15');
  await box.getByRole('combobox', { name: 'Soft-tissue phenotype' }).selectOption('thick');
  await box.getByLabel('Keratinized mucosa (mm)').fill('3');
  await box.getByRole('combobox', { name: 'Flap' }).selectOption('crestal');
  await box.getByRole('combobox', { name: 'Torque measured as' }).selectOption('peak');
  await box.getByRole('combobox', { name: 'Healing' }).selectOption('submerged');
  await box.getByRole('combobox', { name: 'Primary closure' }).selectOption('yes');
  await box.getByRole('combobox', { name: 'Grafting performed' }).selectOption('yes');
  await box.getByRole('button', { name: 'Save surgical details' }).click();
  await expect(box.getByText('9 of 9 recorded')).toBeVisible();
  await expect(box).toContainText('Grafting is marked as performed, but no graft is recorded.');

  await box.getByRole('button', { name: 'Add graft' }).click();
  await box.getByRole('combobox', { name: 'Procedure' }).selectOption('gbr');
  await box.getByRole('combobox', { name: 'Graft timing' }).selectOption('simultaneous');
  await box.getByRole('combobox', { name: 'Material' }).selectOption('xenograft');
  await box.getByRole('combobox', { name: 'Membrane' }).selectOption('resorbable');
  await box.getByRole('button', { name: 'Save graft' }).click();
  await expect(box.getByTestId('grafts')).toContainText('GBR · Xenograft · Resorbable membrane · Simultaneous');
  await expect(box).not.toContainText('no graft is recorded');

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('details-completeness')).toHaveText('9/9');

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText('Surgical details recorded')).toBeVisible();
  await expect(page.getByText('Graft added: GBR')).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test surgical-details --project=chromium`
Expected: FAIL at the Implants tab — no `details-completeness` cell. (If it fails earlier, fix Task 7 before continuing.)

- [ ] **Step 3: Add the Details column**

In `web/src/app/(app)/patients/[id]/implants/page.tsx`:
- add `import { surgeryCompleteness } from '@/lib/implants/surgery';`
- add `<th>Details</th>` after `<th>Last follow-up</th>`
- inside the row map, add `const details = surgeryCompleteness(s.surgery);` and, after the Last follow-up `<td>`, add:
  ```tsx
                  <td data-label="Details" data-testid="details-completeness">
                    {s.state === 'placed' || s.state === 'restored' || s.state === 'failed' ? `${details.recorded}/${details.total}` : '—'}
                  </td>
  ```

- [ ] **Step 4: Run the E2E specs touched by this feature**

Check free memory and that nothing else listens on :3000 (CLAUDE.md Gotchas), then:
Run: `npx playwright test surgical-details implants implants-tab corrections chart patient-overview history --project=chromium`
Expected: PASS. Then `npx playwright test mobile --project=phone` → PASS.

- [ ] **Step 5: Document the feature in CLAUDE.md**

In the root `CLAUDE.md`, under **Architecture**, after the "Placement and course reports (0035)" bullet group, add:

```markdown
- **Research capture (0043–0044).** Medical-history risk factors are yes / no / not assessed (`null`): `smoking`, `diabetes_status`, `*_status`, `periodontitis_history`, `bruxism`, `previous_implant_failure`, plus `hba1c`/`hba1c_date`, `cigarettes_per_day` (`src/lib/patients/risk-factors.ts`). The old booleans and the `medical_history_sync` trigger stay until a follow-up PR drops them; the app writes only the new columns. Placed implants have one `implant_surgery` row (timing, extraction date, phenotype, mucosa, flap, torque type, healing, closure, grafting performed) and any number of `implant_grafts`, written through `save_implant_surgery` (optimistic on `updated_at`) / `add|update|delete_implant_graft`; rules and labels in `src/lib/implants/surgery.ts`, UI in `patients/[id]/surgical-details.tsx`. An empty value means not recorded — never treat it as "no". Roadmap of later research parts: `docs/superpowers/specs/2026-10-17-research-capture-surgery-design.md`.
```

- [ ] **Step 6: Full verification**

Run: `./scripts/ship.sh verify surgical-details patient-overview implants implants-tab corrections chart history`
Expected: tsc, lint, unit, `test:db` and the named E2E specs all pass. If anything fails, fix it and rerun before committing.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/patients/[id]/implants/page.tsx" tests/e2e/surgical-details.spec.ts ../CLAUDE.md
git commit -m "feat(implants): surgical-details completeness on the Implants tab; E2E; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Hand off**

Do not push or merge. Report to the owner: the branch name, the verify output, and the follow-up PR still owed after this one deploys (drop `medical_history.smoker/diabetes/bisphosphonates/anticoagulants/radiotherapy_head_neck/osteoporosis`, the `medical_history_sync` trigger and function — keeping the HbA1c future-date check by moving it into a new trigger — and the old `FIELD_LABELS` keys). The owner runs `./scripts/ship.sh ship`.
