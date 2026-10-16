# Research Readiness Part 2a (Follow-up Visits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn follow-ups into research-grade visits: a fixed schedule per implant with calculated status (upcoming / due / overdue / missed / done / did not attend / not needed), structured findings with four-site probing and ISQ, a recall list and a dashboard tile.

**Architecture:** Migration `0045` extends `implant_followups` (visit key, attendance, findings) and adds `record_visit` plus the schedule `visit_schedule`; migration `0046` adds the security-invoker readers `implant_visits(patient)` and `recall_list()` (the single source of visit status) and makes the "last follow-up" report readers skip not-attended rows. TypeScript renders what the database calculates: rules in `src/lib/visits/`, a Visits block and Record visit form on the chart, a Next visit column, a recall page and a dashboard card.

**Tech Stack:** Next.js 15 App Router (server actions), React 19, Tailwind v4, Zod v4, Supabase Postgres (plpgsql, RLS), Vitest (unit, component, DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-research-followups-complications-design.md` (section "2a — Visits").

## Global Constraints

- **Prerequisite:** research part 1 (`feat/research-capture-surgery`, migrations 0043–0044) is merged to `master`. Branch `feat/research-visits` from `master` after that. If `web/supabase/migrations/0044_implant_surgery.sql` is not on `master`, stop.
- Run every command from `web/`. Windows + Git Bash: write files containing `\` with the Write/Edit tools; files are CRLF in git. No Prettier; match surrounding style.
- Empty means not assessed / not recorded, never "no". A missed visit (window passed, nothing recorded) is distinct from "did not attend" (recorded) and from a negative finding.
- Schedule (days after placement → target, window): `early_review` "Early review (suture removal)" 10, 7–21; `osseointegration` "Osseointegration check" 90, 70–112; `month_6` "6-month review" 182, 152–212; `month_12` "12-month review" 365, 305–425; `year_N` (N ≥ 2) "Year-N review" 365×N, 365×N ± 60. Annual rows are generated up to N = floor((days since placement + 60) / 365) + 1.
- Status is calculated in SQL only (`implant_visits`); TypeScript never recomputes it.
- Findings ranges: pain 0–10 whole; probing 0–15 mm (one decimal); ISQ 0–100; text fields ≤ 1000; yes/no fields `yes`/`no`; prosthesis `stable`/`loose`/`not_restored`.
- Public `security definer` functions: `set search_path = ''`, first line `perform app_private.require_perm('patients', 'edit');`, errors via `app_private.fail(...)`, `revoke execute … from public, anon; grant execute … to authenticated;`. **`app_private` functions may be called only from definer functions** — `authenticated` has no usage on `app_private`, so a security-invoker function that calls one fails with "permission denied for schema app_private". Invoker readers call only `public` functions.
- Migrations are additive and never edited once `npm run test:db` has applied them. Dry-run each in a rolled-back transaction first: the script must be a `.mts` file in your scratchpad using `file:///` imports, e.g. `import { pgConfig } from 'file:///D:/Claude/Claude Code/Implant Course/web/scripts/db.ts';`, run with `NODE_PATH=node_modules npx tsx --env-file=.env.local <script> <migration> [check SQL…]`. If a defect appears after a migration was applied, stop and report — don't edit or revert it yourself.
- Styling: named tokens and shared classes (`badge`, `badge-ok|warn|bad|accent`, `.btn`, `.btn-secondary`, `.input`, `.label`, `.card`, `.table` with `data-label` on every `<td>`).
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.

## Review Focus

1. **Switching attendance to "Did not attend" after typing findings** — the typed findings and outcome must not be sent (Task 3 schema test; Task 1 DB refuses findings when not attended).
2. **Probing entered without ticking bleeding** — that site's bleeding is stored as "no"; a site with no probing depth stores bleeding as not assessed (Task 3 test).
3. **The same scheduled visit recorded from two tabs** — the second save is refused with "… is already recorded for this implant. Remove it first to record it again." (Task 1 DB test).
4. **A Schedule-only user calling `implant_visits`** — gets no rows (not every visit "missed" because follow-ups are hidden from them) (Task 2 DB test).
5. **A "did not attend" visit after an attended one** — course/delegate/my reports keep showing the last real outcome, and the Implants tab "Last follow-up" shows "Did not attend" rather than a blank (Task 2 DB test; Task 4 label helper test).

---

### Task 1: Migration 0045 — visit records and `record_visit`

**Files:**
- Create: `web/supabase/migrations/0045_visit_records.sql`
- Create: `web/tests/db/visits.test.ts`

**Interfaces:**
- Produces (DB): `implant_followups` columns `visit_key`, `attendance`, `pain_score`, `patient_concerns`, `swelling`, `suppuration`, `plaque`, `mobility`, `probing_mesial|buccal|distal|lingual`, `bop_mesial|buccal|distal|lingual`, `isq`, `prosthesis_status`, `radiograph_taken`, `recommended_treatment`; `outcome` nullable.
- `public.visit_schedule(p_through int) returns table (visit_key text, label text, target_day int, window_start int, window_end int)` (immutable, invoker, granted to authenticated).
- `public.record_visit(p_site uuid, p_date date, p_visit_key text, p_check_type text, p_attendance text, p_outcome public.followup_outcome, p_findings jsonb, p_notes text) returns uuid`.
- Findings JSON keys (exact): `pain_score`, `patient_concerns`, `swelling`, `suppuration`, `plaque`, `mobility`, `probing_mesial`, `probing_buccal`, `probing_distal`, `probing_lingual`, `bop_mesial`, `bop_buccal`, `bop_distal`, `bop_lingual`, `isq`, `prosthesis_status`, `radiograph_taken`, `recommended_treatment`.
- Error messages (exact): `'Visits are recorded for placed implants.'`, `'Enter the visit date (today or earlier).'`, `'A visit cannot be before the implant was placed.'`, `'Unknown visit.'`, `'%s is already recorded for this implant. Remove it first to record it again.'` (label), `'Enter what the visit was for (e.g. pain review).'`, `'Choose whether the patient attended.'`, `'Say why the visit was not needed.'`, `'Choose the outcome.'`, `'An outcome is recorded only when the patient attended.'`, `'Findings are recorded only when the patient attended.'`, `'Unknown finding: %s.'`, `'Enter a pain score from 0 to 10.'`, `'Enter probing depths from 0 to 15 mm.'`, `'Enter an ISQ from 0 to 100.'`, `'Choose %s from the list.'`.

- [ ] **Step 1: Create the branch**

```bash
cd web && git checkout master && git pull && git log --oneline -1 -- supabase/migrations/0044_implant_surgery.sql && git checkout -b feat/research-visits
```
Expected: the `git log` line prints a commit (part 1 is merged). If it prints nothing, stop.

- [ ] **Step 2: Write the failing DB tests**

Create `web/tests/db/visits.test.ts`:

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

/** A placed implant `daysAgo` days before the Cairo today (default 30). */
export async function placedSite(c: Client, daysAgo = 30, name = 'Zz Visit Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'VIS');
  const delegate = await makeDelegate(c, 'Zz Visit Delegate');
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}

type Visit = Partial<{ date: string; key: string | null; check: string; attendance: string | null; outcome: string | null;
  findings: Record<string, unknown>; notes: string }>;
const today = async (c: Client) => (await c.query('select public.cairo_today()::text as d')).rows[0].d as string;
export async function recordVisit(c: Client, site: string, v: Visit = {}) {
  const { rows } = await c.query(
    `select public.record_visit(p_site => $1, p_date => $2::date, p_visit_key => $3, p_check_type => $4,
       p_attendance => $5, p_outcome => $6::public.followup_outcome, p_findings => $7::jsonb, p_notes => $8) as id`,
    [site, v.date ?? (await today(c)), v.key === undefined ? 'early_review' : v.key, v.check ?? '',
     v.attendance === undefined ? 'attended' : v.attendance, v.outcome === undefined ? 'ok' : v.outcome,
     JSON.stringify(v.findings ?? {}), v.notes ?? ''],
  );
  return rows[0].id as string;
}
const row = async (c: Client, id: string) =>
  (await c.query(
    `select visit_key, check_type, attendance, outcome, pain_score, patient_concerns, swelling, mobility,
            probing_mesial::float as pm, probing_buccal::float as pb, bop_buccal, bop_mesial, isq::float as isq,
            prosthesis_status, radiograph_taken, recommended_treatment, notes
     from public.implant_followups where id = $1`, [id])).rows[0];

describe('record_visit', () => {
  it('records an attended scheduled visit with findings; the check name is the schedule label', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const id = await recordVisit(c, site, {
        findings: { pain_score: 2, patient_concerns: ' tender ', swelling: 'no', mobility: 'no', probing_mesial: 3, probing_buccal: 4.5,
          bop_buccal: 'yes', bop_mesial: 'no', isq: 72, prosthesis_status: 'not_restored', radiograph_taken: 'yes', recommended_treatment: 'OHI' },
      });
      expect(await row(c, id)).toMatchObject({
        visit_key: 'early_review', check_type: 'Early review (suture removal)', attendance: 'attended', outcome: 'ok', pain_score: 2,
        patient_concerns: 'tender', swelling: 'no', mobility: 'no', pm: 3, pb: 4.5, bop_buccal: 'yes', bop_mesial: 'no', isq: 72,
        prosthesis_status: 'not_restored', radiograph_taken: 'yes', recommended_treatment: 'OHI',
      });
    });
  });

  it('records did-not-attend and not-needed visits without outcome or findings; not needed needs a reason', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 200);
      const dna = await recordVisit(c, site, { key: 'early_review', attendance: 'did_not_attend', outcome: null });
      expect(await row(c, dna)).toMatchObject({ attendance: 'did_not_attend', outcome: null, pain_score: null, swelling: null });
      await refused(c, () => recordVisit(c, site, { key: 'osseointegration', attendance: 'not_needed', outcome: null }), /Say why the visit was not needed/);
      const nn = await recordVisit(c, site, { key: 'osseointegration', attendance: 'not_needed', outcome: null, notes: 'Seen at private clinic' });
      expect(await row(c, nn)).toMatchObject({ attendance: 'not_needed', notes: 'Seen at private clinic' });
    });
  });

  it('records unscheduled visits with a check name and a year-N label for annual visits', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 800);
      const u = await recordVisit(c, site, { key: null, check: 'Pain review' });
      expect((await row(c, u)).check_type).toBe('Pain review');
      await refused(c, () => recordVisit(c, site, { key: null, check: '  ' }), /Enter what the visit was for/);
      const y = await recordVisit(c, site, { key: 'year_2' });
      expect((await row(c, y)).check_type).toBe('Year-2 review');
    });
  });

  it('refuses bad dates, unknown visits, duplicates, missing attendance or outcome, and findings when not attended', async () => {
    await withTx(async (c) => {
      const { site, placedOn } = await placedSite(c);
      const dayBefore = (await c.query('select ($1::date - 1)::text as d', [placedOn])).rows[0].d;
      await refused(c, () => recordVisit(c, site, { date: dayBefore }), /cannot be before the implant was placed/);
      await refused(c, () => recordVisit(c, site, { date: '2999-01-01' }), /today or earlier/);
      await refused(c, () => recordVisit(c, site, { key: 'month_9' }), /Unknown visit/);
      await refused(c, () => recordVisit(c, site, { attendance: null }), /Choose whether the patient attended/);
      await refused(c, () => recordVisit(c, site, { attendance: 'maybe' }), /Choose whether the patient attended/);
      await refused(c, () => recordVisit(c, site, { outcome: null }), /Choose the outcome/);
      await refused(c, () => recordVisit(c, site, { attendance: 'did_not_attend', outcome: 'ok' }), /outcome is recorded only when the patient attended/);
      await refused(c, () => recordVisit(c, site, { attendance: 'did_not_attend', outcome: null, findings: { pain_score: 3 } }), /Findings are recorded only when the patient attended/);
      await recordVisit(c, site);
      await refused(c, () => recordVisit(c, site), /Early review \(suture removal\) is already recorded for this implant/);
    });
  });

  it('refuses out-of-range, malformed and unknown findings', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const bad = (findings: Record<string, unknown>) => recordVisit(c, site, { findings });
      await refused(c, () => bad({ pain_score: 11 }), /Enter a pain score from 0 to 10/);
      await refused(c, () => bad({ pain_score: 2.5 }), /Enter a pain score from 0 to 10/);
      await refused(c, () => bad({ probing_mesial: 'deep' }), /Enter probing depths from 0 to 15 mm/);
      await refused(c, () => bad({ probing_lingual: 16 }), /Enter probing depths from 0 to 15 mm/);
      await refused(c, () => bad({ isq: 101 }), /Enter an ISQ from 0 to 100/);
      await refused(c, () => bad({ swelling: 'maybe' }), /Choose swelling from the list/);
      await refused(c, () => bad({ prosthesis_status: 'wobbly' }), /Choose the prosthesis status from the list/);
      await refused(c, () => bad({ colour: 'pink' }), /Unknown finding: colour/);
    });
  });

  it('a voided visit can be recorded again; a failed outcome fails the implant and the tooth', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      const first = await recordVisit(c, site);
      await c.query(`select public.void_followup($1, 'Wrong patient')`, [first]);
      await recordVisit(c, site, { outcome: 'failed' });
      expect((await c.query('select state from public.implant_sites where id = $1', [site])).rows[0].state).toBe('failed');
      expect((await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [patient])).rows[0].status).toBe('failed');
    });
  });

  it('needs Edit on Patients; record_followup still works for the previous app version', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await actAs(c, users.viewer);
      await refused(c, () => recordVisit(c, site), /permission to edit Patients/);
      await actAs(c, users.organizer);
      await c.query(`select public.record_followup($1, public.cairo_today(), '3-month', 'ok', '')`, [site]);
      const { rows } = await c.query('select visit_key, attendance, outcome from public.implant_followups where site_id = $1', [site]);
      expect(rows).toEqual([{ visit_key: null, attendance: null, outcome: 'ok' }]);
    });
  });

  it('visit_schedule lists the fixed visits and the annual ones up to the given year', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query('select visit_key, label, target_day, window_start, window_end from public.visit_schedule(3)');
      expect(rows).toEqual([
        { visit_key: 'early_review', label: 'Early review (suture removal)', target_day: 10, window_start: 7, window_end: 21 },
        { visit_key: 'osseointegration', label: 'Osseointegration check', target_day: 90, window_start: 70, window_end: 112 },
        { visit_key: 'month_6', label: '6-month review', target_day: 182, window_start: 152, window_end: 212 },
        { visit_key: 'month_12', label: '12-month review', target_day: 365, window_start: 305, window_end: 425 },
        { visit_key: 'year_2', label: 'Year-2 review', target_day: 730, window_start: 670, window_end: 790 },
        { visit_key: 'year_3', label: 'Year-3 review', target_day: 1095, window_start: 1035, window_end: 1155 },
      ]);
      expect((await c.query('select count(*)::int as n from public.visit_schedule(1)')).rows[0].n).toBe(4);
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run db:status` (start with `npm run db:start` if down), then `npm run test:db -- visits`
Expected: FAIL — `function public.record_visit(...) does not exist`.

- [ ] **Step 4: Write the migration**

Create `web/supabase/migrations/0045_visit_records.sql`:

```sql
-- Research readiness, part 2a: a follow-up becomes a visit — scheduled (visit_key) or unscheduled — with
-- attendance and structured findings. Empty means not assessed. Existing rows stay as unscheduled visits
-- (visit_key and attendance null). record_followup stays for the previous app version; a later PR drops it.
alter table public.implant_followups
  add column visit_key text check (visit_key ~ '^(early_review|osseointegration|month_6|month_12|year_([2-9]|[1-9][0-9]))$'),
  add column attendance text check (attendance in ('attended', 'did_not_attend', 'not_needed')),
  add column pain_score int check (pain_score between 0 and 10),
  add column patient_concerns text not null default '' check (length(patient_concerns) <= 1000),
  add column swelling text check (swelling in ('yes', 'no')),
  add column suppuration text check (suppuration in ('yes', 'no')),
  add column plaque text check (plaque in ('yes', 'no')),
  add column mobility text check (mobility in ('yes', 'no')),
  add column probing_mesial numeric(3, 1) check (probing_mesial between 0 and 15),
  add column probing_buccal numeric(3, 1) check (probing_buccal between 0 and 15),
  add column probing_distal numeric(3, 1) check (probing_distal between 0 and 15),
  add column probing_lingual numeric(3, 1) check (probing_lingual between 0 and 15),
  add column bop_mesial text check (bop_mesial in ('yes', 'no')),
  add column bop_buccal text check (bop_buccal in ('yes', 'no')),
  add column bop_distal text check (bop_distal in ('yes', 'no')),
  add column bop_lingual text check (bop_lingual in ('yes', 'no')),
  add column isq numeric(4, 1) check (isq between 0 and 100),
  add column prosthesis_status text check (prosthesis_status in ('stable', 'loose', 'not_restored')),
  add column radiograph_taken text check (radiograph_taken in ('yes', 'no')),
  add column recommended_treatment text not null default '' check (length(recommended_treatment) <= 1000);

-- A not-attended visit has no outcome. (The previous app version may briefly show it blank.)
alter table public.implant_followups alter column outcome drop not null;

create unique index implant_followups_one_visit on public.implant_followups (site_id, visit_key)
  where voided_at is null and visit_key is not null;

-- The fixed visit schedule, in days after placement. p_through = the last annual (year-N) visit to list.
create function public.visit_schedule(p_through int)
returns table (visit_key text, label text, target_day int, window_start int, window_end int)
language sql immutable set search_path = '' as $$
  select * from (values
    ('early_review', 'Early review (suture removal)', 10, 7, 21),
    ('osseointegration', 'Osseointegration check', 90, 70, 112),
    ('month_6', '6-month review', 182, 152, 212),
    ('month_12', '12-month review', 365, 305, 425)
  ) v (visit_key, label, target_day, window_start, window_end)
  union all
  select 'year_' || n, 'Year-' || n || ' review', 365 * n, 365 * n - 60, 365 * n + 60
  from generate_series(2, p_through) n;
$$;
revoke execute on function public.visit_schedule(int) from public, anon;
grant execute on function public.visit_schedule(int) to authenticated;

-- Finding readers for record_visit (called only from that definer function). Empty or missing = not assessed.
create function app_private.finding_number(p jsonb, k text, lo numeric, hi numeric, whole boolean, message text)
returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]+(\.[0-9]+)?$' then perform app_private.fail(message); end if;
  if v::numeric < lo or v::numeric > hi or (whole and v::numeric <> trunc(v::numeric)) then
    perform app_private.fail(message);
  end if;
  return v::numeric;
end $$;

create function app_private.finding_choice(p jsonb, k text, allowed text[], label text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(p ->> k), '');
begin
  if v is not null and not (v = any (allowed)) then
    perform app_private.fail(format('Choose %s from the list.', label));
  end if;
  return v;
end $$;

revoke execute on function app_private.finding_number(jsonb, text, numeric, numeric, boolean, text) from public;
revoke execute on function app_private.finding_choice(jsonb, text, text[], text) from public;

create function public.record_visit(
  p_site uuid, p_date date, p_visit_key text, p_check_type text, p_attendance text,
  p_outcome public.followup_outcome, p_findings jsonb, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_f jsonb := coalesce(p_findings, '{}'::jsonb);
  v_label text;
  v_unknown text;
  v_id uuid;
  c_keys constant text[] := array['pain_score', 'patient_concerns', 'swelling', 'suppuration', 'plaque', 'mobility',
    'probing_mesial', 'probing_buccal', 'probing_distal', 'probing_lingual', 'bop_mesial', 'bop_buccal', 'bop_distal',
    'bop_lingual', 'isq', 'prosthesis_status', 'radiograph_taken', 'recommended_treatment'];
  c_yes_no constant text[] := array['yes', 'no'];
  c_probing constant text := 'Enter probing depths from 0 to 15 mm.';
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Visits are recorded for placed implants.');
  end if;
  if p_date is null or p_date > public.cairo_today() then
    perform app_private.fail('Enter the visit date (today or earlier).');
  end if;
  if p_date < v_site.placed_on then
    perform app_private.fail('A visit cannot be before the implant was placed.');
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    perform app_private.fail('Unknown finding: (not an object).');
  end if;
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(v_f) k where not (k = any (c_keys));
  if v_unknown is not null then
    perform app_private.fail(format('Unknown finding: %s.', v_unknown));
  end if;

  if p_visit_key is not null then
    select s.label into v_label from public.visit_schedule(99) s where s.visit_key = p_visit_key;
    if v_label is null then
      perform app_private.fail('Unknown visit.');
    end if;
    if exists (select 1 from public.implant_followups
               where site_id = p_site and visit_key = p_visit_key and voided_at is null) then
      perform app_private.fail(format('%s is already recorded for this implant. Remove it first to record it again.', v_label));
    end if;
  elsif length(trim(coalesce(p_check_type, ''))) = 0 then
    perform app_private.fail('Enter what the visit was for (e.g. pain review).');
  end if;

  if p_attendance is null or p_attendance not in ('attended', 'did_not_attend', 'not_needed') then
    perform app_private.fail('Choose whether the patient attended.');
  end if;
  if p_attendance = 'not_needed' and length(trim(coalesce(p_notes, ''))) = 0 then
    perform app_private.fail('Say why the visit was not needed.');
  end if;
  if p_attendance = 'attended' and p_outcome is null then
    perform app_private.fail('Choose the outcome.');
  end if;
  if p_attendance <> 'attended' then
    if p_outcome is not null then
      perform app_private.fail('An outcome is recorded only when the patient attended.');
    end if;
    if exists (select 1 from jsonb_each_text(v_f) e where nullif(trim(e.value), '') is not null) then
      perform app_private.fail('Findings are recorded only when the patient attended.');
    end if;
  end if;

  insert into public.implant_followups (
    site_id, date, check_type, outcome, notes, visit_key, attendance, pain_score, patient_concerns,
    swelling, suppuration, plaque, mobility, probing_mesial, probing_buccal, probing_distal, probing_lingual,
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment
  ) values (
    p_site, p_date, coalesce(v_label, trim(p_check_type)), p_outcome, coalesce(trim(p_notes), ''), p_visit_key, p_attendance,
    app_private.finding_number(v_f, 'pain_score', 0, 10, true, 'Enter a pain score from 0 to 10.')::int,
    coalesce(trim(v_f ->> 'patient_concerns'), ''),
    app_private.finding_choice(v_f, 'swelling', c_yes_no, 'swelling'),
    app_private.finding_choice(v_f, 'suppuration', c_yes_no, 'suppuration'),
    app_private.finding_choice(v_f, 'plaque', c_yes_no, 'plaque'),
    app_private.finding_choice(v_f, 'mobility', c_yes_no, 'mobility'),
    app_private.finding_number(v_f, 'probing_mesial', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_buccal', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_distal', 0, 15, false, c_probing),
    app_private.finding_number(v_f, 'probing_lingual', 0, 15, false, c_probing),
    app_private.finding_choice(v_f, 'bop_mesial', c_yes_no, 'bleeding (mesial)'),
    app_private.finding_choice(v_f, 'bop_buccal', c_yes_no, 'bleeding (buccal)'),
    app_private.finding_choice(v_f, 'bop_distal', c_yes_no, 'bleeding (distal)'),
    app_private.finding_choice(v_f, 'bop_lingual', c_yes_no, 'bleeding (lingual)'),
    app_private.finding_number(v_f, 'isq', 0, 100, false, 'Enter an ISQ from 0 to 100.'),
    app_private.finding_choice(v_f, 'prosthesis_status', array['stable', 'loose', 'not_restored'], 'the prosthesis status'),
    app_private.finding_choice(v_f, 'radiograph_taken', c_yes_no, 'whether a radiograph was taken'),
    coalesce(trim(v_f ->> 'recommended_treatment'), '')
  ) returning id into v_id;

  if p_outcome = 'failed' and v_site.state <> 'failed' then
    update public.implant_sites set state = 'failed' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
  return v_id;
end $$;

revoke execute on function public.record_visit(uuid, date, text, text, text, public.followup_outcome, jsonb, text) from public, anon;
grant execute on function public.record_visit(uuid, date, text, text, text, public.followup_outcome, jsonb, text) to authenticated;
```

Before writing it, confirm in `0030_permissions.sql` (`record_followup`, latest definition) that the failed-outcome block above matches its behaviour, and confirm `app_private.set_tooth(uuid, smallint, public.tooth_state)` exists.

- [ ] **Step 5: Dry-run the migration**

Write the dry-run script (see Global Constraints) and run:
```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<scratchpad>/dry-run.mts" supabase/migrations/0045_visit_records.sql \
  "select count(*) as n from public.visit_schedule(2)" \
  "select count(*) filter (where outcome is null) as null_outcomes from public.implant_followups"
```
Expected: `OK: migration applies`, `n` = 5, `null_outcomes` = 0.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:db -- visits permissions corrections implants`
Expected: PASS. `permissions.test.ts` must stay green without allow-list changes (record_visit calls `require_perm`; visit_schedule is not a definer).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0045_visit_records.sql tests/db/visits.test.ts
git commit -m "feat(db): visit records with attendance and findings; record_visit (0045)"
```

---

### Task 2: Migration 0046 — visit status, recall list, report readers

**Files:**
- Create: `web/supabase/migrations/0046_visit_status.sql`
- Modify: `web/tests/db/visits.test.ts` (append)

**Interfaces:**
- Consumes: `public.visit_schedule(int)`, the new follow-up columns (Task 1); `placedSite`, `recordVisit` helpers in `visits.test.ts`.
- Produces (DB):
  - `public.implant_visits(p_patient uuid) returns table (site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_start date, window_end date, status text, followup_id uuid)` — security invoker; scheduled visits only (unscheduled visits come from `implant_followups` rows with `visit_key is null`); ordered by tooth, target date. Status values: `upcoming`, `due`, `overdue`, `missed`, `done`, `did_not_attend`, `not_needed`.
  - `public.recall_list() returns table (patient_id uuid, full_name text, phone text, site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_end date, status text)`.
  - `course_report`, `my_report`, `delegate_report`: same signatures; `last_outcome` now skips rows with a null outcome.

- [ ] **Step 1: Write the failing DB tests**

Append to `web/tests/db/visits.test.ts` (add `setPerms` to the fixtures import):

```ts
const visits = async (c: Client, patient: string) =>
  (await c.query('select visit_key, status, followup_id from public.implant_visits($1)', [patient])).rows as
    { visit_key: string; status: string; followup_id: string | null }[];
const statusOf = async (c: Client, patient: string, key: string) => (await visits(c, patient)).find((v) => v.visit_key === key)?.status;

describe('implant_visits', () => {
  it.each([
    [6, 'upcoming'], [7, 'due'], [10, 'due'], [11, 'overdue'], [21, 'overdue'], [22, 'missed'],
  ])('early review %i days after placement is %s', async (days, status) => {
    await withTx(async (c) => {
      const { patient } = await placedSite(c, days);
      expect(await statusOf(c, patient, 'early_review')).toBe(status);
    });
  });

  it('lists the fixed visits for a new implant and annual visits as time passes', async () => {
    await withTx(async (c) => {
      const fresh = await placedSite(c, 0, 'Zz Visit Fresh');
      expect((await visits(c, fresh.patient)).map((v) => v.visit_key)).toEqual(['early_review', 'osseointegration', 'month_6', 'month_12']);
      const old = await placedSite(c, 700, 'Zz Visit Old');
      const keys = (await visits(c, old.patient)).map((v) => v.visit_key);
      expect(keys).toContain('year_2');
      expect(keys).toContain('year_3');
      expect(keys).not.toContain('year_4');
      expect(await statusOf(c, old.patient, 'year_2')).toBe('due'); // window 670–790, target 730
      expect(await statusOf(c, old.patient, 'year_3')).toBe('upcoming');
    });
  });

  it('takes done / did not attend / not needed from the record; a voided record no longer counts', async () => {
    await withTx(async (c) => {
      const { patient, site } = await placedSite(c, 200);
      const done = await recordVisit(c, site, { key: 'early_review' });
      await recordVisit(c, site, { key: 'osseointegration', attendance: 'did_not_attend', outcome: null });
      await recordVisit(c, site, { key: 'month_6', attendance: 'not_needed', outcome: null, notes: 'Moved away' });
      const v = await visits(c, patient);
      expect(v.find((x) => x.visit_key === 'early_review')).toMatchObject({ status: 'done', followup_id: done });
      expect(await statusOf(c, patient, 'osseointegration')).toBe('did_not_attend');
      expect(await statusOf(c, patient, 'month_6')).toBe('not_needed');
      await c.query(`select public.void_followup($1, 'Entered on the wrong tooth')`, [done]);
      expect(await statusOf(c, patient, 'early_review')).toBe('missed');
    });
  });

  it('expects no further visits for a failed implant, but keeps the visits already recorded', async () => {
    await withTx(async (c) => {
      const { patient, site } = await placedSite(c, 200);
      await recordVisit(c, site, { key: 'early_review' });
      await recordVisit(c, site, { key: null, check: 'Mobile implant', outcome: 'failed' });
      expect(await visits(c, patient)).toEqual([expect.objectContaining({ visit_key: 'early_review', status: 'done' })]);
    });
  });

  it('a Schedule-only user and a delegate get no visit statuses', async () => {
    await withTx(async (c) => {
      const { patient } = await placedSite(c, 30);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect(await visits(c, patient)).toEqual([]);
      await actAs(c, users.delegate);
      expect(await visits(c, patient)).toEqual([]);
    });
  });
});

describe('recall_list', () => {
  const recall = async (c: Client, patient: string) =>
    (await c.query('select visit_key, status, phone from public.recall_list() where patient_id = $1', [patient])).rows;

  it('lists due and overdue visits, and visits missed in the last 60 days', async () => {
    await withTx(async (c) => {
      const overdue = await placedSite(c, 11, 'Zz Recall Overdue');
      expect(await recall(c, overdue.patient)).toEqual([{ visit_key: 'early_review', status: 'overdue', phone: '' }]);
      const missedRecently = await placedSite(c, 30, 'Zz Recall Missed');
      expect(await recall(c, missedRecently.patient)).toEqual([{ visit_key: 'early_review', status: 'missed', phone: '' }]);
      const later = await placedSite(c, 200, 'Zz Recall Later');
      // Early review closed 179 days ago and osseointegration 88 days ago (beyond 60); the 6-month review is overdue.
      expect(await recall(c, later.patient)).toEqual([{ visit_key: 'month_6', status: 'overdue', phone: '' }]);
    });
  });

  it('leaves out recorded visits, failed implants and archived patients', async () => {
    await withTx(async (c) => {
      const recorded = await placedSite(c, 11, 'Zz Recall Recorded');
      await recordVisit(c, recorded.site, { key: 'early_review' });
      expect(await recall(c, recorded.patient)).toEqual([]);
      const failed = await placedSite(c, 11, 'Zz Recall Failed');
      await recordVisit(c, failed.site, { key: null, check: 'Lost', outcome: 'failed' });
      expect(await recall(c, failed.patient)).toEqual([]);
      const archived = await placedSite(c, 11, 'Zz Recall Archived');
      await c.query('update public.patients set archived = true where id = $1', [archived.patient]);
      expect(await recall(c, archived.patient)).toEqual([]);
    });
  });
});

describe('last follow-up in reports', () => {
  it('delegate_report keeps the last real outcome after a did-not-attend visit', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 200);
      await recordVisit(c, site, { key: 'early_review', outcome: 'integrated' });
      await recordVisit(c, site, { key: 'osseointegration', attendance: 'did_not_attend', outcome: null });
      const delegate = (await c.query('select placing_delegate_id as d from public.implant_sites where id = $1', [site])).rows[0].d;
      const { rows } = await c.query('select last_outcome from public.delegate_report($1) where site_id = $2', [delegate, site]);
      expect(rows).toEqual([{ last_outcome: 'integrated' }]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:db -- visits`
Expected: Task 1's tests PASS; the new ones FAIL — `function public.implant_visits(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `web/supabase/migrations/0046_visit_status.sql`:

```sql
-- Research readiness, part 2a: visit status per implant and the recall list, calculated here only (the app
-- renders it). Security invoker, so RLS applies; both need View on Patients (the status depends on follow-ups,
-- which Schedule-only users can't read, and the recall list shows phone numbers). They call only public
-- functions: authenticated has no usage on app_private.
create function public.implant_visits(p_patient uuid)
returns table (site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_start date,
  window_end date, status text, followup_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.tooth::smallint, v.visit_key, v.label,
         s.placed_on + v.target_day, s.placed_on + v.window_start, s.placed_on + v.window_end,
         case
           when f.id is not null then
             case f.attendance when 'did_not_attend' then 'did_not_attend' when 'not_needed' then 'not_needed' else 'done' end
           when public.cairo_today() < s.placed_on + v.window_start then 'upcoming'
           when public.cairo_today() <= s.placed_on + v.target_day then 'due'
           when public.cairo_today() <= s.placed_on + v.window_end then 'overdue'
           else 'missed'
         end,
         f.id
  from public.implant_sites s
  cross join lateral public.visit_schedule(((public.cairo_today() - s.placed_on) + 60) / 365 + 1) v
  left join public.implant_followups f
    on f.site_id = s.id and f.visit_key = v.visit_key and f.voided_at is null
  where s.patient_id = p_patient
    and s.placed_on is not null
    and (select public.can('patients', 'view'))
    -- A failed (or removed) implant expects nothing more; what was recorded still shows.
    and (s.state in ('placed', 'restored') or f.id is not null)
  order by s.tooth, s.placed_on + v.target_day;
$$;

create function public.recall_list()
returns table (patient_id uuid, full_name text, phone text, site_id uuid, tooth smallint, visit_key text, label text,
  target_date date, window_end date, status text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.phone, v.site_id, v.tooth, v.visit_key, v.label, v.target_date, v.window_end, v.status
  from public.patients p
  cross join lateral public.implant_visits(p.id) v
  where not p.archived
    and exists (select 1 from public.implant_sites s where s.patient_id = p.id and s.state in ('placed', 'restored'))
    and (v.status in ('due', 'overdue') or (v.status = 'missed' and v.window_end >= public.cairo_today() - 60))
  order by v.target_date, p.full_name, v.tooth;
$$;

revoke execute on function public.implant_visits(uuid) from public, anon;
grant execute on function public.implant_visits(uuid) to authenticated;
revoke execute on function public.recall_list() from public, anon;
grant execute on function public.recall_list() to authenticated;
```

Then append the three report readers, each copied **verbatim** from its latest definition with exactly one change — in the `last_outcome` subquery, `where f.site_id = s.id and f.voided_at is null` becomes `where f.site_id = s.id and f.voided_at is null and f.outcome is not null` — written as `create or replace function` (same signature, so grants are kept; do not repeat revoke/grant):
- `course_report(p_course uuid)` — latest in `0035_course_report.sql` (the `create function public.course_report` block),
- `my_report()` — latest in `0030_permissions.sql` (the `create function public.my_report` block),
- `delegate_report(p_delegate uuid)` — latest in `0027_technique_booking_edit_delete.sql` (the `create function public.delegate_report` block after `drop function`).

Before copying, confirm with `grep -n "function public.course_report\|function public.my_report\|function public.delegate_report" supabase/migrations/*.sql` that no later migration redefines them. Precede the three with this comment:

```sql
-- "Last follow-up" in reports: a did-not-attend or not-needed visit has no outcome, so skip it rather than
-- showing a blank over the last real outcome. Latest definitions: 0035, 0030, 0027; only the subquery changes.
```

- [ ] **Step 4: Dry-run the migration**

```bash
NODE_PATH=node_modules npx tsx --env-file=.env.local "<scratchpad>/dry-run.mts" supabase/migrations/0046_visit_status.sql \
  "select count(*) as n from public.recall_list()"
```
Expected: `OK: migration applies`. Also, in the same dry-run, confirm the readers run as `authenticated` (set `request.jwt.claims` to the organizer test user and `set local role authenticated` before the check query, as `tests/db/helpers.ts` `actAs` does) with no "permission denied for schema app_private".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:db -- visits course-report delegates delegate-access permissions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0046_visit_status.sql tests/db/visits.test.ts
git commit -m "feat(db): visit status per implant, recall list; reports skip not-attended visits (0046)"
```

---

### Task 3: Visit rules in TypeScript

**Files:**
- Create: `web/src/lib/visits/visits.ts`, `web/src/lib/visits/visits.test.ts`

**Interfaces:**
- Consumes: `FOLLOWUP_OUTCOMES`, `OUTCOME_LABELS`, `FollowupOutcome` (`@/lib/inventory/types`); `YES_NO`, `YesNo` (`@/lib/patients/risk-factors`); `isRealDate`, `todayIso` (`@/lib/dates`).
- Produces (exported from `@/lib/visits/visits`):
  - `VISIT_STATUSES`, `type VisitStatus`, `VISIT_STATUS_LABELS`, `VISIT_STATUS_BADGE` (class names); `ATTENDANCE`, `type Attendance`, `ATTENDANCE_LABELS`; `PROSTHESIS_STATUSES`, `type ProsthesisStatus`, `PROSTHESIS_LABELS`; `PROBING_SITES` (`[{ key: 'mesial', short: 'M', label: 'mesial' }, …]`).
  - `type VisitRow` (one `implant_visits` row).
  - `type VisitFindings` (the follow-up finding columns).
  - `visitResult(f: { outcome: FollowupOutcome | null; attendance: Attendance | null }): string`
  - `nextVisit(rows: VisitRow[], siteId: string): VisitRow | null`
  - `recordableVisits(rows: VisitRow[], siteId: string): VisitRow[]`
  - `prepickVisit(rows: VisitRow[], siteId: string): string` (a visit key, or `''` for unscheduled)
  - `summarizeFindings(f: VisitFindings): string`
  - `visitSchema` (Zod; output keys listed in the code) and `toFindings(v): Record<string, string | number>`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/visits/visits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nextVisit, prepickVisit, recordableVisits, summarizeFindings, toFindings, visitResult, visitSchema,
  type VisitFindings, type VisitRow,
} from './visits';

const row = (visit_key: string, status: VisitRow['status'], target_date: string, over: Partial<VisitRow> = {}): VisitRow => ({
  site_id: 's1', tooth: 36, visit_key, label: visit_key, target_date, window_start: target_date, window_end: target_date,
  status, followup_id: null, ...over,
});
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
const noFindings: VisitFindings = {
  pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
  probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null,
  bop_mesial: null, bop_buccal: null, bop_distal: null, bop_lingual: null, isq: null, prosthesis_status: null,
  radiograph_taken: null, recommended_treatment: '',
};

describe('visit helpers', () => {
  const rows = [
    row('early_review', 'missed', '2026-01-11'),
    row('osseointegration', 'overdue', '2026-03-31'),
    row('month_6', 'upcoming', '2026-07-01'),
    row('month_12', 'upcoming', '2026-12-31'),
    row('early_review', 'due', '2026-05-01', { site_id: 's2' }),
  ];
  it('the next visit is the earliest due or overdue one, else the earliest upcoming', () => {
    expect(nextVisit(rows, 's1')?.visit_key).toBe('osseointegration');
    expect(nextVisit([row('month_6', 'upcoming', '2026-07-01'), row('month_12', 'upcoming', '2026-12-31')], 's1')?.visit_key).toBe('month_6');
    expect(nextVisit([row('early_review', 'done', '2026-01-11')], 's1')).toBeNull();
  });
  it('pre-picks the earliest due, overdue or missed visit, then the earliest upcoming, else unscheduled', () => {
    expect(prepickVisit(rows, 's1')).toBe('early_review');
    expect(prepickVisit([row('month_6', 'upcoming', '2026-07-01')], 's1')).toBe('month_6');
    expect(prepickVisit([row('early_review', 'done', '2026-01-11')], 's1')).toBe('');
  });
  it('offers only visits not yet recorded, for that implant', () => {
    expect(recordableVisits([...rows, row('x', 'done', '2026-01-01', { followup_id: 'f9' })], 's1').map((r) => r.visit_key))
      .toEqual(['early_review', 'osseointegration', 'month_6', 'month_12']);
  });
  it('labels a visit by its outcome, or by attendance when there is none', () => {
    expect(visitResult({ outcome: 'integrated', attendance: 'attended' })).toBe('Integrated');
    expect(visitResult({ outcome: null, attendance: 'did_not_attend' })).toBe('Did not attend');
    expect(visitResult({ outcome: 'ok', attendance: null })).toBe('OK');
    expect(visitResult({ outcome: null, attendance: null })).toBe('');
  });
  it('summarizes recorded findings only', () => {
    expect(summarizeFindings(noFindings)).toBe('');
    expect(summarizeFindings({
      ...noFindings, pain_score: 2, probing_mesial: 3, probing_buccal: 4.5, probing_distal: null, probing_lingual: 2,
      bop_buccal: 'yes', bop_mesial: 'no', isq: 72, mobility: 'no', suppuration: 'yes',
    })).toBe('Pain 2/10 · PD M 3 · B 4.5 · L 2 mm · BOP B · ISQ 72 · Suppuration · No mobility');
  });
});

describe('visitSchema', () => {
  const attended = { ...ids, date: '2026-05-01', visitKey: 'early_review', checkType: '', attendance: 'attended', outcome: 'ok' };
  it('parses an attended visit; blank = not assessed', () => {
    expect(visitSchema.parse({ ...attended, painScore: '2', swelling: '', probingMesial: '3', bopMesial: 'yes', isq: '' })).toMatchObject({
      ...attended, painScore: 2, swelling: null, probingMesial: 3, bopMesial: 'yes', isq: null,
    });
  });
  it('stores bleeding as "no" for a probed site without a tick, and not assessed for an unprobed site', () => {
    const v = visitSchema.parse({ ...attended, probingMesial: '3', bopMesial: '', bopBuccal: '' });
    expect(v.bopMesial).toBe('no');
    expect(v.bopBuccal).toBeNull();
  });
  it('drops findings and outcome when the patient did not attend', () => {
    const v = visitSchema.parse({ ...attended, attendance: 'did_not_attend', painScore: '4', probingMesial: '5', bopMesial: 'yes', swelling: 'yes' });
    expect(v).toMatchObject({ outcome: null, painScore: null, probingMesial: null, bopMesial: null, swelling: null });
    expect(toFindings(v)).toEqual({});
  });
  it('refuses missing outcome, missing reason, missing check name, ranges and a future date', () => {
    expect(firstError(visitSchema.safeParse({ ...attended, outcome: '' }))).toBe('Choose the outcome.');
    expect(firstError(visitSchema.safeParse({ ...attended, attendance: 'not_needed', outcome: '' }))).toBe('Say why the visit was not needed.');
    expect(firstError(visitSchema.safeParse({ ...attended, visitKey: '', checkType: '' }))).toBe('Enter what the visit was for (e.g. pain review).');
    expect(firstError(visitSchema.safeParse({ ...attended, painScore: '11' }))).toBe('Enter a pain score from 0 to 10.');
    expect(firstError(visitSchema.safeParse({ ...attended, painScore: '2.5' }))).toBe('Enter a pain score from 0 to 10.');
    expect(firstError(visitSchema.safeParse({ ...attended, probingDistal: '16' }))).toBe('Enter probing depths from 0 to 15 mm.');
    expect(firstError(visitSchema.safeParse({ ...attended, isq: '101' }))).toBe('Enter an ISQ from 0 to 100.');
    expect(firstError(visitSchema.safeParse({ ...attended, date: '2999-01-01' }))).toBe('Enter the visit date (today or earlier).');
    expect(firstError(visitSchema.safeParse({ ...attended, attendance: '' }))).toBe('Choose whether the patient attended.');
  });
  it('turns the form into the database findings object, leaving out what was not assessed', () => {
    const v = visitSchema.parse({ ...attended, painScore: '0', patientConcerns: ' sore ', probingBuccal: '4', bopBuccal: 'yes', prosthesisStatus: 'stable' });
    expect(toFindings(v)).toEqual({ pain_score: 0, patient_concerns: 'sore', probing_buccal: 4, bop_buccal: 'yes', prosthesis_status: 'stable' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- visits/visits`
Expected: FAIL — `Cannot find module './visits'`.

- [ ] **Step 3: Implement**

Create `web/src/lib/visits/visits.ts`:

```ts
import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { FOLLOWUP_OUTCOMES, OUTCOME_LABELS, type FollowupOutcome } from '@/lib/inventory/types';
import { YES_NO, type YesNo } from '@/lib/patients/risk-factors';

export const VISIT_STATUSES = ['upcoming', 'due', 'overdue', 'missed', 'done', 'did_not_attend', 'not_needed'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  upcoming: 'Upcoming', due: 'Due', overdue: 'Overdue', missed: 'Missed', done: 'Done',
  did_not_attend: 'Did not attend', not_needed: 'Not needed',
};
export const VISIT_STATUS_BADGE: Record<VisitStatus, string> = {
  upcoming: 'badge', due: 'badge badge-accent', overdue: 'badge badge-warn', missed: 'badge badge-bad',
  done: 'badge badge-ok', did_not_attend: 'badge badge-warn', not_needed: 'badge',
};

export const ATTENDANCE = ['attended', 'did_not_attend', 'not_needed'] as const;
export type Attendance = (typeof ATTENDANCE)[number];
export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  attended: 'Attended', did_not_attend: 'Did not attend', not_needed: 'Not needed',
};

export const PROSTHESIS_STATUSES = ['stable', 'loose', 'not_restored'] as const;
export type ProsthesisStatus = (typeof PROSTHESIS_STATUSES)[number];
export const PROSTHESIS_LABELS: Record<ProsthesisStatus, string> = { stable: 'Stable', loose: 'Loose', not_restored: 'Not restored yet' };

/** The four probing sites, with their column names (database) and field names (form). */
export const PROBING_SITES = [
  { key: 'mesial', short: 'M', label: 'mesial', depth: 'probing_mesial', bop: 'bop_mesial', depthField: 'probingMesial', bopField: 'bopMesial' },
  { key: 'buccal', short: 'B', label: 'buccal', depth: 'probing_buccal', bop: 'bop_buccal', depthField: 'probingBuccal', bopField: 'bopBuccal' },
  { key: 'distal', short: 'D', label: 'distal', depth: 'probing_distal', bop: 'bop_distal', depthField: 'probingDistal', bopField: 'bopDistal' },
  { key: 'lingual', short: 'L', label: 'lingual', depth: 'probing_lingual', bop: 'bop_lingual', depthField: 'probingLingual', bopField: 'bopLingual' },
] as const;

/** One row of implant_visits (0046). Status is calculated in the database only. */
export type VisitRow = {
  site_id: string;
  tooth: number;
  visit_key: string;
  label: string;
  target_date: string;
  window_start: string;
  window_end: string;
  status: VisitStatus;
  followup_id: string | null;
};

export type VisitFindings = {
  pain_score: number | null;
  patient_concerns: string;
  swelling: YesNo | null;
  suppuration: YesNo | null;
  plaque: YesNo | null;
  mobility: YesNo | null;
  probing_mesial: number | null;
  probing_buccal: number | null;
  probing_distal: number | null;
  probing_lingual: number | null;
  bop_mesial: YesNo | null;
  bop_buccal: YesNo | null;
  bop_distal: YesNo | null;
  bop_lingual: YesNo | null;
  isq: number | null;
  prosthesis_status: ProsthesisStatus | null;
  radiograph_taken: YesNo | null;
  recommended_treatment: string;
};

export function visitResult(f: { outcome: FollowupOutcome | null; attendance: Attendance | null }): string {
  if (f.outcome) return OUTCOME_LABELS[f.outcome];
  return f.attendance ? ATTENDANCE_LABELS[f.attendance] : '';
}

const byTarget = (a: VisitRow, b: VisitRow) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : 0);

export function nextVisit(rows: VisitRow[], siteId: string): VisitRow | null {
  const mine = rows.filter((r) => r.site_id === siteId).sort(byTarget);
  return mine.find((r) => r.status === 'due' || r.status === 'overdue') ?? mine.find((r) => r.status === 'upcoming') ?? null;
}

export function recordableVisits(rows: VisitRow[], siteId: string): VisitRow[] {
  return rows.filter((r) => r.site_id === siteId && r.followup_id === null).sort(byTarget);
}

export function prepickVisit(rows: VisitRow[], siteId: string): string {
  const open = recordableVisits(rows, siteId);
  return (open.find((r) => r.status === 'due' || r.status === 'overdue' || r.status === 'missed') ?? open.find((r) => r.status === 'upcoming'))
    ?.visit_key ?? '';
}

export function summarizeFindings(f: VisitFindings): string {
  const depths = PROBING_SITES.filter((s) => f[s.depth] !== null).map((s) => `${s.short} ${f[s.depth]}`);
  const bleeding = PROBING_SITES.filter((s) => f[s.bop] === 'yes').map((s) => s.short);
  return [
    f.pain_score !== null ? `Pain ${f.pain_score}/10` : null,
    depths.length ? `PD ${depths.join(' · ')} mm` : null,
    bleeding.length ? `BOP ${bleeding.join(', ')}` : null,
    f.isq !== null ? `ISQ ${f.isq}` : null,
    f.swelling === 'yes' ? 'Swelling' : null,
    f.suppuration === 'yes' ? 'Suppuration' : null,
    f.plaque === 'yes' ? 'Plaque' : null,
    f.mobility ? (f.mobility === 'yes' ? 'Mobile' : 'No mobility') : null,
    f.prosthesis_status ? PROSTHESIS_LABELS[f.prosthesis_status] : null,
  ].filter((x): x is string => x !== null).join(' · ');
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const number = (message: string, check: (n: number) => boolean) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).refine(check, { message }).nullable());
const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(blankToNull, z.enum(values, { message }).nullable());
const yesNo = choice(YES_NO, 'Choose yes or no.');
const text = (max: number) => z.string().trim().max(max, { message: `Keep it under ${max} characters.` }).default('');
const PROBING = 'Enter probing depths from 0 to 15 mm.';
const depth = number(PROBING, (n) => n >= 0 && n <= 15);
const VISIT_KEY = /^(early_review|osseointegration|month_6|month_12|year_([2-9]|[1-9][0-9]))$/;

export const visitSchema = z
  .object({
    siteId: z.string().uuid({ message: 'Implant not found.' }),
    patientId: z.string().uuid({ message: 'Patient not found.' }),
    date: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the visit date (today or earlier).' }),
    visitKey: z.preprocess(blankToNull, z.string().regex(VISIT_KEY, { message: 'Choose the visit.' }).nullable()),
    checkType: z.string().trim().max(60, { message: 'Keep the visit name under 60 characters.' }).default(''),
    attendance: z.enum(ATTENDANCE, { message: 'Choose whether the patient attended.' }),
    outcome: choice(FOLLOWUP_OUTCOMES, 'Choose the outcome.'),
    painScore: number('Enter a pain score from 0 to 10.', (n) => Number.isInteger(n) && n >= 0 && n <= 10),
    patientConcerns: text(1000),
    swelling: yesNo,
    suppuration: yesNo,
    plaque: yesNo,
    mobility: yesNo,
    probingMesial: depth,
    probingBuccal: depth,
    probingDistal: depth,
    probingLingual: depth,
    bopMesial: yesNo,
    bopBuccal: yesNo,
    bopDistal: yesNo,
    bopLingual: yesNo,
    isq: number('Enter an ISQ from 0 to 100.', (n) => n >= 0 && n <= 100),
    prosthesisStatus: choice(PROSTHESIS_STATUSES, 'Choose the prosthesis status from the list.'),
    radiographTaken: yesNo,
    recommendedTreatment: text(1000),
    notes: text(1000),
  })
  .superRefine((v, ctx) => {
    if (!v.visitKey && !v.checkType) {
      ctx.addIssue({ code: 'custom', path: ['checkType'], message: 'Enter what the visit was for (e.g. pain review).' });
    }
    if (v.attendance === 'attended' && !v.outcome) ctx.addIssue({ code: 'custom', path: ['outcome'], message: 'Choose the outcome.' });
    if (v.attendance === 'not_needed' && !v.notes) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Say why the visit was not needed.' });
    }
  })
  .transform((v) => {
    if (v.attendance !== 'attended') {
      // Values typed before switching to "did not attend" / "not needed" are not findings.
      return {
        ...v, outcome: null, painScore: null, patientConcerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
        probingMesial: null, probingBuccal: null, probingDistal: null, probingLingual: null,
        bopMesial: null, bopBuccal: null, bopDistal: null, bopLingual: null,
        isq: null, prosthesisStatus: null, radiographTaken: null, recommendedTreatment: '',
      };
    }
    // An untick on a probed site means no bleeding; an unprobed site's bleeding is not assessed.
    const bop = (b: YesNo | null, d: number | null): YesNo | null => b ?? (d !== null ? 'no' : null);
    return {
      ...v,
      bopMesial: bop(v.bopMesial, v.probingMesial),
      bopBuccal: bop(v.bopBuccal, v.probingBuccal),
      bopDistal: bop(v.bopDistal, v.probingDistal),
      bopLingual: bop(v.bopLingual, v.probingLingual),
    };
  });

export type VisitInput = z.output<typeof visitSchema>;

/** The findings object record_visit expects: snake_case keys, nothing that was not assessed. */
export function toFindings(v: VisitInput): Record<string, string | number> {
  const all: Record<string, string | number | null> = {
    pain_score: v.painScore, patient_concerns: v.patientConcerns, swelling: v.swelling, suppuration: v.suppuration,
    plaque: v.plaque, mobility: v.mobility, probing_mesial: v.probingMesial, probing_buccal: v.probingBuccal,
    probing_distal: v.probingDistal, probing_lingual: v.probingLingual, bop_mesial: v.bopMesial, bop_buccal: v.bopBuccal,
    bop_distal: v.bopDistal, bop_lingual: v.bopLingual, isq: v.isq, prosthesis_status: v.prosthesisStatus,
    radiograph_taken: v.radiographTaken, recommended_treatment: v.recommendedTreatment,
  };
  return Object.fromEntries(Object.entries(all).filter(([, x]) => x !== null && x !== '')) as Record<string, string | number>;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- visits/visits` → PASS. `npx tsc --noEmit` → clean. `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/visits
git commit -m "feat(visits): visit status labels, findings schema and helpers"
```

---

### Task 4: Visit data on the chart and the `recordVisit` action

**Files:**
- Create: `web/src/app/(app)/patients/[id]/visit-actions.ts`, `web/src/app/(app)/patients/[id]/visit-actions.test.ts`
- Modify: `web/src/lib/inventory/types.ts` (`Followup`, `ChartData`), `web/src/app/(app)/patients/[id]/chart-data.ts` (`SITE_SELECT`, `loadChartData`), `web/src/lib/patients/history.ts` (`implant_followups` case), `web/src/app/(app)/patients/[id]/corrections.tsx` (latest follow-up label), `web/src/app/(app)/patients/[id]/implants/page.tsx` (Last follow-up label)
- Test: `web/src/lib/patients/history.test.ts`

**Interfaces:**
- Consumes: `visitSchema`, `toFindings`, `visitResult`, `VisitRow`, `VisitFindings`, `Attendance` (Task 3); DB `record_visit`, `implant_visits` (Tasks 1–2).
- Produces:
  - `Followup` type: `outcome: FollowupOutcome | null`, plus `visit_key: string | null; attendance: Attendance | null` and every `VisitFindings` field.
  - `ChartData.visits: VisitRow[]` (from `implant_visits(patient)`).
  - Server action `recordVisit(input: Record<string, unknown>): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/(app)/patients/[id]/visit-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { recordVisit } from './visit-actions';

const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('recordVisit', () => {
  it('sends the visit with its findings object', async () => {
    expect(await recordVisit({
      ...ids, date: '2026-05-01', visitKey: 'early_review', checkType: '', attendance: 'attended', outcome: 'ok',
      painScore: '1', probingMesial: '3', bopMesial: '', notes: '',
    })).toEqual({});
    expect(rpc).toHaveBeenCalledWith('record_visit', {
      p_site: ids.siteId, p_date: '2026-05-01', p_visit_key: 'early_review', p_check_type: '', p_attendance: 'attended',
      p_outcome: 'ok', p_findings: { pain_score: 1, probing_mesial: 3, bop_mesial: 'no' }, p_notes: '',
    });
  });

  it('sends no findings for a missed appointment, and shows business errors verbatim', async () => {
    rpc.mockResolvedValue({ error: { message: 'Early review (suture removal) is already recorded for this implant. Remove it first to record it again.', hint: 'user' } });
    const result = await recordVisit({ ...ids, date: '2026-05-01', visitKey: 'early_review', attendance: 'did_not_attend', painScore: '5' });
    expect(result.error).toMatch(/already recorded/);
    expect(rpc).toHaveBeenCalledWith('record_visit', expect.objectContaining({ p_outcome: null, p_findings: {} }));
  });

  it('never calls the database for an invalid form', async () => {
    expect(await recordVisit({ ...ids, date: '2026-05-01', visitKey: 'early_review', attendance: 'attended', outcome: '' }))
      .toEqual({ error: 'Choose the outcome.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

In `web/src/lib/patients/history.test.ts` add:

```ts
describe('describeChange: visits', () => {
  const base = { id: 1, at: '2026-10-17T10:00:00Z', actor: 'A', before: null };
  it('names the result of a scheduled visit, or the attendance when there is no outcome', () => {
    expect(describeChange({ ...base, table_name: 'implant_followups', action: 'INSERT',
      after: { check_type: '6-month review', outcome: null, attendance: 'did_not_attend' } }))
      .toBe('Follow-up (6-month review): Did not attend');
    expect(describeChange({ ...base, table_name: 'implant_followups', action: 'INSERT',
      after: { check_type: 'Early review (suture removal)', outcome: 'ok', attendance: 'attended' } }))
      .toBe('Follow-up (Early review (suture removal)): OK');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- visit-actions history`
Expected: FAIL — `./visit-actions` not found; history prints `null` for the missing outcome.

- [ ] **Step 3: Implement**

Create `web/src/app/(app)/patients/[id]/visit-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { toFindings, visitSchema } from '@/lib/visits/visits';

export async function recordVisit(input: Record<string, unknown>): Promise<{ error?: string }> {
  await requirePermission('patients', 'edit');
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_visit', {
    p_site: v.siteId,
    p_date: v.date,
    p_visit_key: v.visitKey,
    p_check_type: v.checkType,
    p_attendance: v.attendance,
    p_outcome: v.outcome,
    p_findings: toFindings(v),
    p_notes: v.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${v.patientId}`, 'layout');
  return {};
}
```

In `web/src/lib/inventory/types.ts`: add `import type { Attendance, VisitFindings, VisitRow } from '@/lib/visits/visits';` and replace the `Followup` type with:

```ts
export type Followup = VisitFindings & {
  id: string;
  date: string;
  check_type: string;
  outcome: FollowupOutcome | null;
  notes: string;
  voided_at: string | null;
  voided_reason: string;
  visit_key: string | null;
  attendance: Attendance | null;
};
```
and add `visits: VisitRow[];` to `ChartData` (after `sites`).

In `web/src/app/(app)/patients/[id]/chart-data.ts`, replace the `followups:` line of `SITE_SELECT` with:

```ts
  followups:implant_followups(
    id, date, check_type, outcome, notes, voided_at, voided_reason, visit_key, attendance, pain_score, patient_concerns,
    swelling, suppuration, plaque, mobility, probing_mesial, probing_buccal, probing_distal, probing_lingual,
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment
  ),
```
In `loadChartData`, add `supabase.rpc('implant_visits', { p_patient: patientId })` as an eighth entry of the `Promise.all` (name it `visits`), include it in the error loop, and return `visits: (visits.data ?? []) as VisitRow[]` (import `VisitRow` from `@/lib/visits/visits`).

In `web/src/lib/patients/history.ts`, in `case 'implant_followups'`, replace the line computing `outcome` with:

```ts
      const outcome = visitResult({ outcome: (row?.outcome ?? null) as FollowupOutcome | null, attendance: (row?.attendance ?? null) as Attendance | null });
```
(import `visitResult`, `type Attendance` from `@/lib/visits/visits`).

In `web/src/app/(app)/patients/[id]/corrections.tsx`, replace `{OUTCOME_LABELS[latest.outcome]}` with `{visitResult(latest)}` (import from `@/lib/visits/visits`; drop `OUTCOME_LABELS` from the imports if now unused).

In `web/src/app/(app)/patients/[id]/implants/page.tsx`, replace `` `${OUTCOME_LABELS[last.outcome]} (${last.check_type})` `` with `` `${visitResult(last)} (${last.check_type})` `` (import `visitResult`; drop `OUTCOME_LABELS` if unused).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- visit-actions history corrections chart-panel components implant-forms surgical-details` → PASS. `npx tsc --noEmit` → clean (fixtures typed as `ChartData` without `as unknown as` may need `visits: []`; add it where tsc asks).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/patients/[id]" src/lib/inventory/types.ts src/lib/patients/history.ts src/lib/patients/history.test.ts
git commit -m "feat(visits): load visit status on the chart; recordVisit action; visit results in History"
```

---

### Task 5: Visits block and Record visit form

**Files:**
- Create: `web/src/app/(app)/patients/[id]/visits.tsx`, `web/src/app/(app)/patients/[id]/visits.test.tsx`
- Modify: `web/src/app/(app)/patients/[id]/implant-section.tsx` (follow-ups list → `<Visits>`; `ACTION_LABELS.followup`; `FollowupForm` → `RecordVisitForm`), `web/src/app/(app)/patients/[id]/implant-forms.tsx` (delete `FollowupForm` and the `recordFollowup` import), `web/src/app/(app)/patients/[id]/implant-actions.ts` (delete `recordFollowup`), `web/src/lib/inventory/schemas.ts` (delete `followupSchema`), test mocks that list `recordFollowup`, `web/tests/e2e/implants.spec.ts` (failed follow-up test)

**Interfaces:**
- Consumes: `recordVisit` (Task 4), `ChartData.visits`, everything from `@/lib/visits/visits` (Task 3), `Field`, `Footer`, `useSubmit` (exported from `implant-forms.tsx` in part 1).
- Produces: `Visits({ site, visits }: { site: ImplantSite; visits: VisitRow[] })` — a section with `data-testid="visit-schedule"` (one `<li data-testid="visit-row">` per expected visit: label, target date, status badge) and `data-testid="visit-records"` (every follow-up row, voided ones struck through); `RecordVisitForm({ patientId, site, data, onDone })` with controls labelled "Visit", "Visit for" (unscheduled only), "Date", radiogroup "Attendance" (Attended / Did not attend / Not needed), "Outcome", "Pain (0–10)", "Swelling", "Suppuration", "Plaque", "Mobility", inputs "Probing depth mesial|buccal|distal|lingual", checkboxes "Bleeding mesial|buccal|distal|lingual", "ISQ", "Prosthesis", "Radiograph taken", "Recommended treatment", "Notes" (label "Reason" when not needed), button "Save visit". The panel button reads "Record visit".

- [ ] **Step 1: Write the failing component tests**

Create `web/src/app/(app)/patients/[id]/visits.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import type { VisitRow } from '@/lib/visits/visits';

vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));
vi.mock('./implant-actions', () => ({
  fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn(),
}));
import { RecordVisitForm, Visits } from './visits';
import { recordVisit } from './visit-actions';

const visits: VisitRow[] = [
  { site_id: 's1', tooth: 36, visit_key: 'early_review', label: 'Early review (suture removal)', target_date: '2026-03-20',
    window_start: '2026-03-17', window_end: '2026-03-31', status: 'missed', followup_id: null },
  { site_id: 's1', tooth: 36, visit_key: 'osseointegration', label: 'Osseointegration check', target_date: '2026-06-08',
    window_start: '2026-05-19', window_end: '2026-06-30', status: 'due', followup_id: null },
  { site_id: 's1', tooth: 36, visit_key: 'month_6', label: '6-month review', target_date: '2026-09-08',
    window_start: '2026-08-09', window_end: '2026-10-08', status: 'upcoming', followup_id: null },
];
const oldFollowup = {
  id: 'f1', date: '2026-03-25', check_type: '2-week', outcome: 'ok', notes: '', voided_at: null, voided_reason: '',
  visit_key: null, attendance: null, pain_score: null, patient_concerns: '', swelling: null, suppuration: null, plaque: null,
  mobility: null, probing_mesial: null, probing_buccal: null, probing_distal: null, probing_lingual: null, bop_mesial: null,
  bop_buccal: null, bop_distal: null, bop_lingual: null, isq: null, prosthesis_status: null, radiograph_taken: null, recommended_treatment: '',
};
const site = { id: 's1', tooth: 36, state: 'placed', placed_on: '2026-03-10', followups: [oldFollowup] } as unknown as ImplantSite;
const data = { today: '2026-06-01', visits, editable: true } as unknown as ChartData;

beforeEach(() => vi.mocked(recordVisit).mockReset().mockResolvedValue({}));

describe('<Visits>', () => {
  it('lists each expected visit with its status, and every visit record', () => {
    render(<Visits site={site} visits={visits} />);
    const rows = within(screen.getByTestId('visit-schedule')).getAllByTestId('visit-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Early review \(suture removal\).*Missed/),
      expect.stringMatching(/Osseointegration check.*Due/),
      expect.stringMatching(/6-month review.*Upcoming/),
    ]);
    expect(within(rows[0]).getByText('Missed')).toHaveClass('badge-bad');
    expect(screen.getByTestId('visit-records')).toHaveTextContent('2-week · OK');
  });
});

describe('<RecordVisitForm>', () => {
  it('pre-picks the earliest missed or due visit and records an attended visit with probing and bleeding', async () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Visit' })).toHaveValue('early_review');
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('Pain (0–10)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Probing depth buccal'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Bleeding buccal'));
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    expect(vi.mocked(recordVisit)).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 's1', patientId: 'pt', date: '2026-06-01', visitKey: 'early_review', attendance: 'attended', outcome: 'ok',
      painScore: '1', probingBuccal: '4', bopBuccal: 'yes', probingMesial: '', bopMesial: '',
    }));
  });

  it('hides findings when the patient did not attend, and asks for a reason when not needed', () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    const attendance = screen.getByRole('radiogroup', { name: 'Attendance' });
    fireEvent.click(within(attendance).getByLabelText('Did not attend'));
    expect(screen.queryByLabelText('Probing depth mesial')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Outcome' })).not.toBeInTheDocument();
    fireEvent.click(within(attendance).getByLabelText('Not needed'));
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
  });

  it('asks what an unscheduled visit was for', () => {
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    expect(screen.queryByLabelText('Visit for')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Visit' }), { target: { value: '' } });
    expect(screen.getByLabelText('Visit for')).toBeInTheDocument();
  });

  it('keeps the form and shows the error when saving fails', async () => {
    vi.mocked(recordVisit).mockResolvedValue({ error: 'Choose the outcome.' });
    render(<RecordVisitForm patientId="pt" site={site} data={data} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the outcome.');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- patients/\\[id\\]/visits`
Expected: FAIL — `./visits` not found.

- [ ] **Step 3: Write the component**

Create `web/src/app/(app)/patients/[id]/visits.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { FOLLOWUP_OUTCOMES, OUTCOME_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { YES_NO } from '@/lib/patients/risk-factors';
import {
  ATTENDANCE, ATTENDANCE_LABELS, PROBING_SITES, PROSTHESIS_LABELS, PROSTHESIS_STATUSES, VISIT_STATUS_BADGE, VISIT_STATUS_LABELS,
  prepickVisit, recordableVisits, summarizeFindings, visitResult, type VisitRow,
} from '@/lib/visits/visits';
import { Field, Footer, useSubmit } from './implant-forms';
import { recordVisit } from './visit-actions';

const YES_NO_LABELS = { yes: 'Yes', no: 'No' } as const;

export function Visits({ site, visits }: { site: ImplantSite; visits: VisitRow[] }) {
  const schedule = visits.filter((v) => v.site_id === site.id);
  return (
    <div className="space-y-3">
      {schedule.length > 0 && (
        <div>
          <h4 className="font-medium">Visits</h4>
          <ol data-testid="visit-schedule" className="space-y-1">
            {schedule.map((v) => (
              <li key={v.visit_key} data-testid="visit-row" className="flex flex-wrap items-center gap-x-2">
                <span>{v.label}</span>
                <span className="text-muted">{formatDate(v.target_date)}</span>
                <span className={VISIT_STATUS_BADGE[v.status]}>{VISIT_STATUS_LABELS[v.status]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {site.followups.length > 0 && (
        <div>
          <h4 className="font-medium">Visit records</h4>
          <ul data-testid="visit-records">
            {site.followups.map((f) => {
              const findings = summarizeFindings(f);
              return (
                <li key={f.id} className={f.voided_at ? 'text-muted line-through' : ''}>
                  {formatDate(f.date)} · {f.check_type} · {visitResult(f)}
                  {findings ? ` — ${findings}` : ''}
                  {f.notes ? ` — ${f.notes}` : ''}
                  {f.voided_at ? ` — removed: ${f.voided_reason}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const BLANK = {
  painScore: '', patientConcerns: '', swelling: '', suppuration: '', plaque: '', mobility: '',
  probingMesial: '', probingBuccal: '', probingDistal: '', probingLingual: '',
  bopMesial: '', bopBuccal: '', bopDistal: '', bopLingual: '',
  isq: '', prosthesisStatus: '', radiographTaken: '', recommendedTreatment: '',
};

export function RecordVisitForm({ patientId, site, data, onDone }: {
  patientId: string; site: ImplantSite; data: ChartData; onDone: () => void;
}) {
  const options = recordableVisits(data.visits, site.id);
  const [v, setV] = useState({
    visitKey: prepickVisit(data.visits, site.id), checkType: '', date: data.today, attendance: 'attended', outcome: '', notes: '', ...BLANK,
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(recordVisit, onDone);
  const attended = v.attendance === 'attended';
  const yesNo = (key: 'swelling' | 'suppuration' | 'plaque' | 'mobility' | 'radiographTaken', label: string) => (
    <Field label={label}>
      <select className="input" value={v[key]} onChange={(e) => set(key)(e.target.value)}>
        <option value="">—</option>
        {YES_NO.map((o) => <option key={o} value={o}>{YES_NO_LABELS[o]}</option>)}
      </select>
    </Field>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visit">
          <select className="input" value={v.visitKey} onChange={(e) => set('visitKey')(e.target.value)}>
            {options.map((o) => (
              <option key={o.visit_key} value={o.visit_key}>
                {o.label} · {formatDate(o.target_date)} · {VISIT_STATUS_LABELS[o.status]}
              </option>
            ))}
            <option value="">Unscheduled visit</option>
          </select>
        </Field>
        {v.visitKey === '' && (
          <Field label="Visit for">
            <input className="input" value={v.checkType} maxLength={60} onChange={(e) => set('checkType')(e.target.value)} />
          </Field>
        )}
        <Field label="Date">
          <input className="input" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} />
        </Field>
      </div>
      <div role="radiogroup" aria-label="Attendance" className="flex flex-wrap gap-x-4 gap-y-1">
        {ATTENDANCE.map((a) => (
          <label key={a} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name={`attendance-${site.id}`} value={a} checked={v.attendance === a} onChange={() => set('attendance')(a)} />
            {ATTENDANCE_LABELS[a]}
          </label>
        ))}
      </div>
      {attended && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Outcome">
              <select className="input" value={v.outcome} onChange={(e) => set('outcome')(e.target.value)}>
                <option value="">Choose…</option>
                {FOLLOWUP_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
              </select>
            </Field>
            <Field label="Pain (0–10)">
              <input className="input" inputMode="numeric" value={v.painScore} onChange={(e) => set('painScore')(e.target.value)} />
            </Field>
            {yesNo('swelling', 'Swelling')}
            {yesNo('suppuration', 'Suppuration')}
            {yesNo('plaque', 'Plaque')}
            {yesNo('mobility', 'Mobility')}
          </div>
          <fieldset>
            <legend className="label">Probing depth (mm) and bleeding</legend>
            <div className="grid grid-cols-4 gap-2">
              {PROBING_SITES.map((s) => {
                const depthKey = s.depthField;
                const bopKey = s.bopField;
                return (
                  <div key={s.key} className="space-y-1 text-center">
                    <span className="text-sm font-medium" aria-hidden="true">{s.short}</span>
                    <input className="input text-center" inputMode="decimal" aria-label={`Probing depth ${s.label}`}
                      value={v[depthKey]} onChange={(e) => set(depthKey)(e.target.value)} />
                    <label className="flex items-center justify-center gap-1 text-xs">
                      <input type="checkbox" aria-label={`Bleeding ${s.label}`} checked={v[bopKey] === 'yes'}
                        onChange={(e) => set(bopKey)(e.target.checked ? 'yes' : '')} />
                      <span aria-hidden="true">BOP</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ISQ">
              <input className="input" inputMode="decimal" value={v.isq} onChange={(e) => set('isq')(e.target.value)} />
            </Field>
            <Field label="Prosthesis">
              <select className="input" value={v.prosthesisStatus} onChange={(e) => set('prosthesisStatus')(e.target.value)}>
                <option value="">—</option>
                {PROSTHESIS_STATUSES.map((p) => <option key={p} value={p}>{PROSTHESIS_LABELS[p]}</option>)}
              </select>
            </Field>
            {yesNo('radiographTaken', 'Radiograph taken')}
            <Field label="Patient concerns">
              <input className="input" value={v.patientConcerns} maxLength={1000} onChange={(e) => set('patientConcerns')(e.target.value)} />
            </Field>
          </div>
          <Field label="Recommended treatment">
            <input className="input" value={v.recommendedTreatment} maxLength={1000} onChange={(e) => set('recommendedTreatment')(e.target.value)} />
          </Field>
        </>
      )}
      <Field label={v.attendance === 'not_needed' ? 'Reason' : 'Notes'}>
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save visit" onCancel={onDone} />
    </form>
  );
}
```

- [ ] **Step 4: Wire it in and retire the old follow-up form**

In `web/src/app/(app)/patients/[id]/implant-section.tsx`:
- import `{ RecordVisitForm, Visits } from './visits'`; remove `FollowupForm` from the `./implant-forms` import.
- `ACTION_LABELS.followup` becomes `'Record visit'`.
- in `SiteDetails`, replace the whole `{site.followups.length > 0 && ( … Follow-ups … )}` block with `<Visits site={site} visits={data.visits} />`. Also remove `OUTCOME_LABELS` from the imports if unused.
- replace `{mode === 'followup' && site && <FollowupForm … />}` with `{mode === 'followup' && site && <RecordVisitForm patientId={patientId} site={site} data={data} onDone={done} />}`.

Delete `FollowupForm` and the `recordFollowup` import from `implant-forms.tsx` (and `FOLLOWUP_OUTCOMES`/`OUTCOME_LABELS` imports there if now unused); delete `recordFollowup` and the `followupSchema` import from `implant-actions.ts`; delete `followupSchema` from `src/lib/inventory/schemas.ts` (and any test of it); remove `recordFollowup: vi.fn(),` from the `vi.mock('./implant-actions', …)` lists in `chart-panel.test.tsx`, `implant-forms.test.tsx` and `surgical-details.test.tsx`, and add `vi.mock('./visit-actions', () => ({ recordVisit: vi.fn() }));` to `chart-panel.test.tsx` if it renders `ImplantSection`. Fixtures of `ChartData` used by `ImplantSection` need `visits: []`.

In `web/tests/e2e/implants.spec.ts`, replace the body steps of `test('a failed follow-up marks the tooth as a failed implant', …)` from the `Add follow-up` click through the `Save follow-up` click with:

```ts
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
  await panel(page).getByLabel('Notes').fill('Mobile, removed');
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `npm test -- visits chart-panel implant-forms surgical-details corrections schemas` → PASS. `npx tsc --noEmit` → clean. `npm run lint` → clean. Then (nothing on :3000) `npx playwright test implants --project=chromium` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/patients/[id]" src/lib/inventory/schemas.ts tests/e2e/implants.spec.ts
git commit -m "feat(visits): Visits block and Record visit form with four-site probing; retire the old follow-up form"
```

---

### Task 6: Next visit column, recall list page and dashboard card

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/implants/page.tsx` (Next visit column), `web/src/app/(app)/patients/page.tsx` (link), `web/src/app/(app)/page.tsx` (Recall card)
- Create: `web/src/app/(app)/patients/recall/page.tsx`, `web/src/lib/visits/recall.ts`, `web/src/lib/visits/recall.test.ts`

**Interfaces:**
- Consumes: `nextVisit`, `VISIT_STATUS_LABELS`, `VISIT_STATUS_BADGE`, `VisitRow` (Task 3); DB `implant_visits`, `recall_list` (Task 2); `PageSearchParams` (`src/lib/search-params.ts`, as the patients page uses it).
- Produces: `RECALL_STATUSES = ['overdue', 'due', 'missed'] as const`, `type RecallRow`, `parseRecallStatuses(values: string[]): RecallStatus[]` (unknown values dropped; empty = all three), `recallCounts(rows: RecallRow[]): { overdue: number; due: number; missed: number }`. Page `/patients/recall` (title "Recall list", rows `data-testid="recall-row"`); Implants tab cell `data-testid="next-visit"`; dashboard card titled "Recall" with `data-testid="dash-recall"`.

- [ ] **Step 1: Write the failing unit tests**

Create `web/src/lib/visits/recall.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRecallStatuses, recallCounts, type RecallRow } from './recall';

const r = (status: RecallRow['status']): RecallRow => ({
  patient_id: 'p', full_name: 'A', phone: '', site_id: 's', tooth: 36, visit_key: 'k', label: 'L',
  target_date: '2026-01-01', window_end: '2026-01-10', status,
});

describe('recall helpers', () => {
  it('reads the status filter; none or only unknown values = all three', () => {
    expect(parseRecallStatuses([])).toEqual(['overdue', 'due', 'missed']);
    expect(parseRecallStatuses(['due', 'bogus'])).toEqual(['due']);
    expect(parseRecallStatuses(['bogus'])).toEqual(['overdue', 'due', 'missed']);
  });
  it('counts rows by status', () => {
    expect(recallCounts([r('overdue'), r('overdue'), r('due'), r('missed')])).toEqual({ overdue: 2, due: 1, missed: 1 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- visits/recall` → FAIL (module missing).

- [ ] **Step 3: Implement the helpers**

Create `web/src/lib/visits/recall.ts`:

```ts
export const RECALL_STATUSES = ['overdue', 'due', 'missed'] as const;
export type RecallStatus = (typeof RECALL_STATUSES)[number];

/** One row of recall_list (0046). */
export type RecallRow = {
  patient_id: string;
  full_name: string;
  phone: string;
  site_id: string;
  tooth: number;
  visit_key: string;
  label: string;
  target_date: string;
  window_end: string;
  status: RecallStatus;
};

export function parseRecallStatuses(values: string[]): RecallStatus[] {
  const picked = RECALL_STATUSES.filter((s) => values.includes(s));
  return picked.length ? picked : [...RECALL_STATUSES];
}

export function recallCounts(rows: RecallRow[]): Record<RecallStatus, number> {
  return { overdue: rows.filter((x) => x.status === 'overdue').length, due: rows.filter((x) => x.status === 'due').length,
    missed: rows.filter((x) => x.status === 'missed').length };
}
```

Run: `npm test -- visits/recall` → PASS.

- [ ] **Step 4: Recall list page**

Create `web/src/app/(app)/patients/recall/page.tsx` (the repeated `status` param arrives as a string or an array, which `asList` handles):

```tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import type { PageSearchParams } from '@/lib/search-params';
import { RECALL_STATUSES, parseRecallStatuses, type RecallRow } from '@/lib/visits/recall';
import { VISIT_STATUS_BADGE, VISIT_STATUS_LABELS } from '@/lib/visits/visits';

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export default async function RecallPage({ searchParams }: { searchParams: PageSearchParams }) {
  await requirePermission('patients');
  const sp = await searchParams;
  const statuses = parseRecallStatuses(asList(sp.status));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recall_list');
  if (error) throw new Error('Could not load the recall list');
  const rows = ((data ?? []) as RecallRow[]).filter((r) => statuses.includes(r.status));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Recall list</h1>
          <p className="text-muted">Follow-up visits that are due, overdue, or missed in the last 60 days.</p>
        </div>
        <Link href="/patients" className="btn-secondary btn">Patients</Link>
      </div>
      <form className="card flex flex-wrap items-end gap-2">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="label">Show</legend>
          {RECALL_STATUSES.map((s) => (
            <label key={s}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="status" value={s} defaultChecked={statuses.includes(s)} />
              {s === 'missed' ? 'Missed (60 days)' : VISIT_STATUS_LABELS[s]}
            </label>
          ))}
        </fieldset>
        <button className="btn-secondary btn">Apply</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted">Nobody to recall.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Phone</th><th>Tooth</th><th>Visit</th><th>Target</th><th>Window closes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.site_id}-${r.visit_key}`} data-testid="recall-row">
                  <td data-label="Patient">
                    <Link href={`/patients/${r.patient_id}?tooth=${r.tooth}`} className="text-accent hover:underline">{r.full_name}</Link>
                  </td>
                  <td data-label="Phone">{r.phone || '—'}</td>
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Visit">{r.label}</td>
                  <td data-label="Target">{formatDate(r.target_date)}</td>
                  <td data-label="Window closes">{formatDate(r.window_end)}</td>
                  <td data-label="Status"><span className={VISIT_STATUS_BADGE[r.status]}>{VISIT_STATUS_LABELS[r.status]}</span></td>
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

In `web/src/app/(app)/patients/page.tsx`, inside the `page-header`, wrap the header actions so the link always shows:

```tsx
        <div className="flex flex-wrap gap-2">
          <Link href="/patients/recall" className="btn-secondary btn">Recall list</Link>
          {editable && (
            <Link href="/patients/new" className="btn">
              New patient
            </Link>
          )}
        </div>
```
(replacing the existing `{editable && (<Link href="/patients/new" …>)}` there).

- [ ] **Step 5: Next visit column**

In `web/src/app/(app)/patients/[id]/implants/page.tsx`:
- fetch visits alongside the sites: `const visitsRes = await supabase.rpc('implant_visits', { p_patient: id });` (throw `new Error('Could not load implants')` on error), `const visits = (visitsRes.data ?? []) as VisitRow[];`
- add `<th>Next visit</th>` after `<th>Last follow-up</th>`, and in the row:

```tsx
                  <td data-label="Next visit" data-testid="next-visit">
                    {(() => {
                      const next = nextVisit(visits, s.id);
                      return next ? `${next.label} · ${formatDate(next.target_date)} · ${VISIT_STATUS_LABELS[next.status]}` : '—';
                    })()}
                  </td>
```
(import `nextVisit`, `VISIT_STATUS_LABELS`, `type VisitRow` from `@/lib/visits/visits`).

- [ ] **Step 6: Dashboard card**

In `web/src/app/(app)/page.tsx`: add `show.patients ? supabase.rpc('recall_list') : Promise.resolve({ data: [], error: null })` as a sixth entry of the `Promise.all` (name it `recall`), compute `const recallRows = (recall.data ?? []) as RecallRow[]; const due = recallCounts(recallRows);`, and add this card after the stock-shortage card:

```tsx
        {show.patients && (
        <Card title="Recall" failed={Boolean(recall.error)} count={due.overdue} tone="warn">
          <p data-testid="dash-recall" className="text-sm">
            {due.overdue} overdue · {due.due} due{due.missed ? ` · ${due.missed} missed recently` : ''}
          </p>
          <Link href="/patients/recall" className="text-sm text-accent hover:underline">Open the recall list</Link>
        </Card>
        )}
```
(import `recallCounts`, `type RecallRow` from `@/lib/visits/recall`).

- [ ] **Step 7: Typecheck, lint, unit tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test -- visits` → clean / PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/patients" "src/app/(app)/page.tsx" src/lib/visits
git commit -m "feat(visits): Next visit column, recall list page and dashboard card"
```

---

### Task 7: End-to-end tests, docs and verification

**Files:**
- Create: `web/tests/e2e/visits.spec.ts`
- Modify: `web/tests/e2e/mobile.spec.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: the UI from Tasks 5–6; E2E helpers `apiAs`, `seedImplantStock`, `seedDelegate` (`tests/e2e/api.ts`), `createPatientViaUi`, `uniqueName` (`tests/e2e/patients.ts`), `login` (`tests/e2e/helpers.ts`); `place_implant_v2` RPC.

- [ ] **Step 1: Write the E2E spec**

Create `web/tests/e2e/visits.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function placedImplant(page: Page, placedDaysAgo: number) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Visit'), qty: 1, lot: `E2E-V${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Visit'));
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Visit patient');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: daysAgo(placedDaysAgo),
    p_placing_delegate: delegate, p_supervisor: me, p_technique: 'guided',
  });
  expect(error).toBeNull();
  return { patientId, name };
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Tooth details' });

test('records the early review with probing and bleeding; the schedule and Implants tab follow', async ({ page }) => {
  const { patientId } = await placedImplant(page, 8);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const schedule = panel(page).getByTestId('visit-schedule');
  await expect(schedule.getByTestId('visit-row').first()).toContainText('Due');
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await expect(panel(page).getByRole('combobox', { name: 'Visit' })).toHaveValue('early_review');
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('ok');
  await panel(page).getByLabel('Probing depth mesial').fill('3');
  await panel(page).getByLabel('Probing depth buccal').fill('4');
  await panel(page).getByLabel('Bleeding buccal').check();
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
  await expect(schedule.getByTestId('visit-row').first()).toContainText('Done');
  await expect(panel(page).getByTestId('visit-records')).toContainText('PD M 3 · B 4 mm · BOP B');

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('next-visit')).toContainText('Osseointegration check');
});

test('a missed visit shows on the chart, the recall list and the dashboard', async ({ page }) => {
  const { patientId, name } = await placedImplant(page, 120);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const rows = panel(page).getByTestId('visit-schedule').getByTestId('visit-row');
  await expect(rows.nth(0)).toContainText('Missed');
  await expect(rows.nth(1)).toContainText('Missed');

  await page.goto('/patients/recall');
  // The early review closed 99 days ago (beyond 60); the osseointegration check closed 8 days ago.
  const mine = page.getByTestId('recall-row').filter({ hasText: name });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Osseointegration check');
  await expect(mine).toContainText('Missed');

  await page.goto('/');
  await expect(page.getByTestId('dash-recall')).toContainText(/missed recently/);
});
```

Before running, check `place_implant_v2`'s required arguments in `supabase/migrations/0035_course_report.sql` and adjust the call if needed.

- [ ] **Step 2: Phone check**

Add to `web/tests/e2e/mobile.spec.ts` (imports `apiAs`, `seedDelegate`, `seedImplantStock` from `./api`):

```ts
test('the visit form and its probing grid fit a phone screen', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Phone visit'), qty: 1, lot: `E2E-PV${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Phone'));
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Phone visit') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: id, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me, p_technique: 'guided',
  });
  expect(error).toBeNull();
  await page.goto(`/patients/${id}?tooth=36`);
  await page.getByRole('button', { name: 'Record visit' }).click();
  await expect(page.getByLabel('Probing depth lingual')).toBeVisible();
  await expectNoSideways(page);
});
```

- [ ] **Step 3: Run the E2E specs**

Check free memory and that nothing listens on :3000. Run: `npx playwright test visits implants implants-tab corrections history dashboard --project=chromium` → PASS; `npx playwright test mobile --project=phone` → PASS.

- [ ] **Step 4: Document in CLAUDE.md**

In the root `CLAUDE.md`, under **Architecture**, after the "Research capture (0043–0044)" bullet, add:

```markdown
- **Follow-up visits (0045–0046).** `implant_followups` rows are visits: scheduled (`visit_key`: `early_review`, `osseointegration`, `month_6`, `month_12`, `year_N`) or unscheduled (null), with `attendance` and findings (pain, swelling/suppuration/plaque/mobility, four-site probing and bleeding, ISQ, prosthesis, radiograph). Recorded only through `record_visit` (findings as one jsonb, validated in SQL; not editable — void and re-record). The schedule is `visit_schedule()`; status (upcoming / due / overdue / missed / done / did not attend / not needed) is calculated only in SQL by `implant_visits(patient)` and `recall_list()` (security invoker, View on Patients) — never recompute it in TS. Rules in `src/lib/visits/`, UI in `patients/[id]/visits.tsx`, recall page `/patients/recall`. `record_followup` stays for the release window only. `app_private` functions can't be called from security-invoker functions (no schema usage for `authenticated`).
```

- [ ] **Step 5: Full verification**

Run: `./scripts/ship.sh verify visits implants implants-tab corrections history dashboard`
Expected: tsc, lint, unit, `test:db` and the named E2E specs pass. If it refuses because the tree isn't committed, commit first and rerun.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/visits.spec.ts tests/e2e/mobile.spec.ts ../CLAUDE.md
git commit -m "test(visits): E2E for recording visits and the recall list; docs"
```

- [ ] **Step 7: Hand off**

Do not push or merge. Report the branch, the verify output, and the follow-up owed after this deploys: drop `record_followup` (spec, "Follow-up PR"). The owner runs `./scripts/ship.sh ship`.
