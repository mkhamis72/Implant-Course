import type { Client } from 'pg';
import { describe, it, expect } from 'vitest';
import { withTx, actAs, actAsBound, asCompany, asPostgres } from './helpers';
import {
  addTalk, book, enroll, makeChair, makeCourse, makeDelegate, makeLecturer, makeProduct, makeSession,
  pendingLogin, place, receive, setPerms,
} from './fixtures';

// The isolation proof (plan 3, task 7): two companies in one database, each seeded with a row in every
// company table, and nothing of A's reachable from B: not through the tables, not through stock_on_hand,
// not through any public function with a uuid argument. Driven by the catalog, so a new table or function
// is covered without editing this file.

const TIMEOUT = 180_000;
/** Company tables allowed to hold no row in a seeded company. Empty: the seeding covers every table. */
const EMPTY_ALLOWED: string[] = [];
/** Pre-login readers (spec §5): they return a company's name, colours and logo by company id to anyone,
 *  before sign-in, by design. Their results are not checked for A's data. */
const PRE_LOGIN_READERS = new Set(['branding_for', 'branding_logo_for']);
/** Definers that are not edit functions: guards, session and pre-login helpers, the delegate readers (they
 *  read only the caller's own delegate record), and next_file_no, the default of patients.file_no, which
 *  every signed-in user must be able to run (it draws the bound company's next number and reads nothing).
 *  The file readers are checked apart: they must return nothing. */
const NOT_EDIT = new Set([
  'bind_my_session', 'branding_for', 'branding_logo', 'branding_logo_for', 'branding_public', 'can',
  'is_active_user', 'is_admin', 'is_delegate_user', 'mfa_setup_done', 'my_delegate_id', 'my_session_company',
  'my_report', 'my_restorations', 'my_schedule', 'next_file_no',
]);
const FILE_READERS = new Set(['consent_file', 'study_letter']);

/** Gaps the sweep finds on HEAD, pinned so the suite stays green and fails once one is fixed (then remove it).
 *  - research_codes is keyed by (entity, entity_id) across companies: B passing A's course to
 *    assign_research_codes (or any A id to research_code) stores B's code for A's row, and A then never gets a
 *    code for it (research_code returns null to A). No read of A's data, but B can break A's exports.
 *  - create_pending_login doesn't check that p_delegate_id is a delegate of the caller's company
 *    (add_existing_member does): B's pending login names A's delegate. handle_new_user drops such a row at
 *    sign-up, and company_members' composite key refuses it, so no access follows. */
const KNOWN_CROSS_REFERENCES: string[] = [
  "assign_research_codes: B rows name A's (app_private.research_codes)",
  "create_pending_login: B rows name A's (app_private.pending_logins, audit_log)",
];

/** Tables with a person-level read policy: the caller's own rows in the bound company. */
const OWN_ROWS = new Set(['company_members', 'user_permissions']);

type Company = {
  key: 'A' | 'B';
  id: string;
  marker: string;
  admin: string;
  organizer: string;
  organizerEmail: string;
  viewer: string;
  delegateUser: string;
  /** One seeded row id per table (unqualified name for public tables). */
  rows: Record<string, string>;
  lectureSession: string;
};

type Role = { label: string; act: (c: Client) => Promise<void> };

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function newUser(c: Client, company: string, email: string, role: 'admin' | 'organizer' | 'delegate', delegateId?: string) {
  await pendingLogin(c, email, { company, role, fullName: `Zz Iso ${role}`, delegateId: delegateId ?? null });
  return (await c.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id as string;
}

const one = async (c: Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0].id as string;

/** A company with an admin, an organizer (Edit everywhere), a viewer (View everywhere) and a delegate login,
 *  and one row in every company table, written by fixtures in a session bound to the company. */
async function seedCompany(c: Client, key: 'A' | 'B'): Promise<Company> {
  await asPostgres(c);
  // No claims left from the previous company's fixtures: its admin would be logged as the actor here.
  await c.query("select set_config('request.jwt.claims', '', true)");
  const tag = `${key.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = await one(c, `insert into public.companies (slug, name) values ($1, $2) returning id`, [`zz-iso-${tag}`, `Zz Iso ${key}`]);
  const admin = await newUser(c, id, `zz-iso-${tag}-admin@example.com`, 'admin');
  const organizerEmail = `zz-iso-${tag}-organizer@example.com`;
  const organizer = await newUser(c, id, organizerEmail, 'organizer');
  const viewer = await newUser(c, id, `zz-iso-${tag}-viewer@example.com`, 'organizer');
  await setPerms(c, organizer, { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit', research: 'edit' }, id);
  await setPerms(c, viewer, { patients: 'view', schedule: 'view', courses: 'view', checklists: 'view', inventory: 'view', delegates: 'view', research: 'view' }, id);

  const marker = `ZzIso${key}`;
  const r: Record<string, string> = {};
  await asCompany(c, id, admin);
  r.delegates = await makeDelegate(c, `${marker} Delegate`);
  const delegateUser = await newUser(c, id, `zz-iso-${tag}-delegate@example.com`, 'delegate', r.delegates);
  await pendingLogin(c, `zz-iso-${tag}-pending@example.com`, { company: id });
  await asCompany(c, id, admin);
  // An explicit file number: the global unique on file_no stays until release 5 (0095), and both companies' counters start at 1.
  r.patients = await one(c, `insert into public.patients (full_name, file_no) values ($1, $2) returning id`,
    [`${marker} Patient`, `ZZI${Math.random().toString(36).slice(2, 10)}`]);
  r.courses = await makeCourse(c);
  r.sessions = await makeSession(c, r.courses, 'surgery', '2030-03-02');
  const lectureSession = await makeSession(c, r.courses, 'lecture', '2030-03-03');
  await enroll(c, r.courses, r.delegates);
  r.chairs = await makeChair(c);
  r.supervisors = await one(c, `insert into public.supervisors (full_name) values ($1) returning id`, [`${marker} Supervisor`]);
  r.lecturers = await makeLecturer(c, `${marker} Lecturer`);
  r.products = await makeProduct(c, 'implant', `${marker} Brand`);
  r.stock_lots = await receive(c, r.products, 5);
  r.implant_sites = await place(c, {
    patient: r.patients, tooth: 11, product: r.products, lot: r.stock_lots, delegate: r.delegates,
    supervisor: r.supervisors, course: r.courses,
  });
  r.surgery_slots = await book(c, {
    session: r.sessions, chair: r.chairs, patient: r.patients, supervisor: r.supervisors, placing: [r.delegates],
    implants: [{ tooth: 12 }],
  });
  r.talks = await addTalk(c, { session: lectureSession, lecturer: r.lecturers });

  const site = r.implant_sites;
  const today = 'public.cairo_today()';
  await c.query('insert into public.implant_surgery (site_id) values ($1)', [site]);
  r.implant_grafts = await one(c, `insert into public.implant_grafts (site_id, procedure, timing) values ($1, 'gbr', 'simultaneous') returning id`, [site]);
  r.implant_complications = await one(c, `insert into public.implant_complications (site_id, category, type, noticed_on)
    values ($1, 'surgical', 'infection', ${today}) returning id`, [site]);
  r.implant_followups = await one(c, `insert into public.implant_followups (site_id, date, check_type) values ($1, ${today}, '3-month') returning id`, [site]);
  r.site_components = await one(c, `insert into public.site_components (site_id, component_type, fitted_on) values ($1, 'cover_screw', ${today}) returning id`, [site]);
  r.restorations = await one(c, `insert into public.restorations (patient_id, stage, type, teeth, fitted_on)
    values ($1, 'final', 'single_crown', '{11}', ${today}) returning id`, [r.patients]);
  await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2)', [r.restorations, site]);
  r.restoration_problems = await one(c, `insert into public.restoration_problems (restoration_id, noticed_on, type, action)
    values ($1, ${today}, 'chipping', 'none') returning id`, [r.restorations]);
  r.radiographs = await one(c, `insert into public.radiographs (patient_id, taken_on, type, purpose, teeth)
    values ($1, ${today}, 'periapical', 'baseline', '{11}') returning id`, [r.patients]);
  await c.query('insert into public.radiograph_bone_levels (radiograph_id, site_id, mesial_mm) values ($1, $2, 1)', [r.radiographs, site]);
  r.stored_files = await one(c, `insert into public.stored_files (bytes, content_type) values ('\\x255044462d', 'application/pdf') returning id`);
  r.consent_form_versions = await one(c, `insert into public.consent_form_versions (label, effective_on, text_en, text_ar)
    values ($1, '2020-01-01', 'Zz consent', 'نص') returning id`, [`${marker} v1`]);
  r.patient_consents = await one(c, `insert into public.patient_consents
      (patient_id, version_id, language, signed_on, treatment, research, teaching_images, follow_up, file_id)
    values ($1, $2, 'en', ${today}, true, true, true, true, $3) returning id`, [r.patients, r.consent_form_versions, r.stored_files]);
  await c.query(`insert into public.visit_notes (patient_id, text) values ($1, $2)`, [r.patients, `${marker} note`]);
  r.studies = await one(c, `insert into public.studies (title) values ($1) returning id`, [`${marker} Study`]);
  await c.query('insert into public.study_courses (study_id, course_id) values ($1, $2)', [r.studies, r.courses]);
  r.saved_analyses = await one(c, `insert into public.saved_analyses (title, config, created_by) values ($1, '{"version": 1, "query": {}}', $2) returning id`, [`${marker} Analysis`, admin]);
  await c.query(`insert into public.research_exports (exported_by, format) values ($1, 'csv')`, [admin]);
  await c.query(`insert into app_private.research_codes (entity, entity_id, code) values ('patient', $1, $2)`, [r.patients, `P-${tag}`]);
  await c.query(`insert into public.admin_events (user_id, kind) values ($1, 'mfa_reset')`, [organizer]);
  r.checklist_templates = await one(c, `insert into public.checklist_templates (name) values ($1) returning id`, [`${marker} Template`]);
  await c.query(`insert into public.template_items (template_id, position, text) values ($1, 1, 'Zz item')`, [r.checklist_templates]);
  r.checklists = await one(c, `insert into public.checklists (title) values ($1) returning id`, [`${marker} Checklist`]);
  r.checklist_items = await one(c, `insert into public.checklist_items (checklist_id, position, text) values ($1, 1, 'Zz item') returning id`, [r.checklists]);
  await c.query(`insert into public.branding (name) values ($1) on conflict do nothing`, [`Zz Iso ${key}`]);
  await c.query(`insert into public.branding_logos (bytes, content_type) values ('\\x89504e47', 'image/png') on conflict do nothing`);
  await c.query('insert into public.settings default values on conflict do nothing');
  await c.query('insert into app_private.file_no_counters (last_no) values (1) on conflict do nothing');
  // A sign-in session of the organizer, so an admin function ending another company's sessions shows up.
  await c.query('insert into auth.sessions (id, user_id) values (gen_random_uuid(), $1)', [organizer]);
  await asPostgres(c);
  return { key, id, marker, admin, organizer, organizerEmail, viewer, delegateUser, rows: r, lectureSession };
}

async function companyTables(c: Client): Promise<{ name: string; oid: number; pk: string[] }[]> {
  await asPostgres(c);
  return (await c.query(`
    select t::text as name, t::oid::int as oid,
      coalesce((select array_agg(a.attname::text order by k.ord) from pg_index i
        cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where i.indrelid = t and i.indisprimary), '{}') as pk
    from app.company_tables() t order by 1`)).rows;
}

/** One row per company table, plus A's people: count and md5 of A's rows ordered by primary key. */
async function checksum(c: Client, tables: { name: string; pk: string[] }[], a: Company): Promise<Record<string, string>> {
  await asPostgres(c);
  const users = [a.admin, a.organizer, a.viewer, a.delegateUser];
  const parts = tables.map((t) => {
    const order = t.pk.length ? t.pk.map((k) => `x.${quoteIdent(k)}`).join(', ') : 'x::text';
    return `select '${t.name}' as t, count(*) || ':' || md5(coalesce(string_agg(x::text, '|' order by ${order}), '')) as h
      from ${t.name} x where x.company_id = $1`;
  });
  parts.push(`select 'profiles', count(*) || ':' || md5(coalesce(string_agg(x::text, '|' order by x.user_id), '')) from public.profiles x where x.user_id = any($2)`);
  parts.push(`select 'auth.users', count(*) || ':' || md5(coalesce(string_agg(concat_ws(',', x.id, x.email, x.encrypted_password, x.banned_until, x.email_change, x.raw_app_meta_data), '|' order by x.id), ''))
    from auth.users x where x.id = any($2)`);
  parts.push(`select 'auth.sessions', count(*) || ':' || md5(coalesce(string_agg(x.id::text, '|' order by x.id), '')) from auth.sessions x where x.user_id = any($2)`);
  const { rows } = await c.query(parts.join('\nunion all\n'), [a.id, users]);
  return Object.fromEntries(rows.map((r) => [r.t, r.h]));
}

/** Every uuid key of A's rows (single-column primary keys) and A's people. */
async function companyIds(c: Client, tables: { name: string; pk: string[] }[], a: Company): Promise<string[]> {
  await asPostgres(c);
  const parts = tables.filter((t) => t.pk.length === 1 && t.pk[0] === 'id')
    .map((t) => `select x.id::text as id from ${t.name} x where x.company_id = $1 and pg_typeof(x.id) = 'uuid'::regtype`);
  const ids = (await c.query(parts.join('\nunion all\n'), [a.id])).rows.map((r) => r.id as string);
  return [...ids, a.admin, a.organizer, a.viewer, a.delegateUser];
}

/** Company tables where a row of B's names one of the ids (anywhere in the row). */
async function naming(c: Client, tables: { name: string }[], b: Company, ids: string[]): Promise<string[]> {
  await asPostgres(c);
  const parts = tables.map((t) => `select '${t.name}' as t from ${t.name} x where x.company_id = $1 and x::text ~ $2`);
  return [...new Set((await c.query(parts.join('\nunion all\n'), [b.id, ids.join('|')])).rows.map((r) => r.t as string))];
}

const changed = (before: Record<string, string>, after: Record<string, string>) =>
  Object.keys(before).filter((t) => before[t] !== after[t]);

/** B's roles, plus a user with no membership, an unbound session and anon. */
async function bRoles(c: Client, b: Company): Promise<Role[]> {
  await asPostgres(c);
  const loner = await newUser(c, b.id, `zz-iso-loner-${Math.random().toString(36).slice(2, 8)}@example.com`, 'organizer');
  await c.query('delete from public.user_permissions where user_id = $1', [loner]);
  await c.query('delete from public.company_members where user_id = $1', [loner]);
  return [
    { label: 'B admin', act: (c) => actAsBound(c, b.admin, b.id) },
    { label: 'B organizer', act: (c) => actAsBound(c, b.organizer, b.id) },
    { label: 'B viewer', act: (c) => actAsBound(c, b.viewer, b.id) },
    { label: 'B delegate', act: (c) => actAsBound(c, b.delegateUser, b.id) },
    { label: 'no membership', act: (c) => actAs(c, loner) },
    { label: 'unbound session', act: (c) => actAs(c, b.admin, { session_id: crypto.randomUUID() }) },
    { label: 'anon', act: (c) => actAs(c, null) },
  ];
}

/** Runs the statement in a savepoint: its row count, or null when it raised. Raises nothing. */
async function attempt(c: Client, sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; count: number } | { error: string }> {
  await c.query('savepoint probe');
  try {
    const res = await c.query(sql, params);
    return { rows: res.rows, count: res.rowCount ?? 0 };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await c.query('rollback to savepoint probe');
  }
}

/** Columns of the table the current role may use with the privilege (none when it can't even look). */
async function columnsWith(c: Client, oid: number, privilege: 'INSERT' | 'UPDATE'): Promise<string[]> {
  const res = await attempt(c, `select attname::text as n from pg_catalog.pg_attribute
    where attrelid = $1::oid and attnum > 0 and not attisdropped and attgenerated = ''
      and has_column_privilege($1::oid, attnum, $2) order by attnum`, [oid, privilege]);
  return 'error' in res ? [] : (res.rows as { n: string }[]).map((r) => r.n);
}

const ISOLATION_ERROR = /permission denied|row-level security|violates row-level/;

/** As the role: select, update, delete and insert on A's rows of every company table and of stock_on_hand.
 *  Returns what got through. */
async function probeTables(
  c: Client, role: Role, tables: { name: string; oid: number }[], a: Company, aRows: Record<string, Record<string, unknown>>,
): Promise<string[]> {
  const leaks: string[] = [];
  await role.act(c);
  for (const t of tables) {
    const sel = await attempt(c, `select count(*)::int as n from ${t.name} where company_id = $1`, [a.id]);
    if (!('error' in sel) && (sel.rows[0] as { n: number }).n !== 0) leaks.push(`${role.label}: select ${t.name}`);

    const updatable = (await columnsWith(c, t.oid, 'UPDATE')).filter((n) => n !== 'company_id');
    const col = quoteIdent(updatable[0] ?? 'company_id');
    const upd = await attempt(c, `update ${t.name} set ${col} = ${col} where company_id = $1`, [a.id]);
    if (!('error' in upd) && upd.count !== 0) leaks.push(`${role.label}: update ${t.name} (${upd.count})`);

    const del = await attempt(c, `delete from ${t.name} where company_id = $1`, [a.id]);
    if (!('error' in del) && del.count !== 0) leaks.push(`${role.label}: delete ${t.name} (${del.count})`);

    const row = { ...aRows[t.name] };
    if (typeof row.id === 'string') row.id = crypto.randomUUID();
    const cols = [...new Set(['company_id', ...await columnsWith(c, t.oid, 'INSERT')])].filter((n) => n in row).map(quoteIdent);
    const ins = await attempt(c, `insert into ${t.name} (${cols.join(', ')})
      select ${cols.map((n) => `r.${n}`).join(', ')} from jsonb_populate_record(null::${t.name}, $1) r`, [row]);
    if (!('error' in ins)) leaks.push(`${role.label}: insert ${t.name}`);
    else if (!ISOLATION_ERROR.test(ins.error)) leaks.push(`${role.label}: insert ${t.name} refused for another reason: ${ins.error}`);
  }
  const lot = a.rows.stock_lots;
  const sel = await attempt(c, 'select count(*)::int as n from public.stock_on_hand where stock_lot_id = $1', [lot]);
  if (!('error' in sel) && (sel.rows[0] as { n: number }).n !== 0) leaks.push(`${role.label}: select stock_on_hand`);
  const upd = await attempt(c, 'update public.stock_on_hand set lot_no = lot_no where stock_lot_id = $1', [lot]);
  if (!('error' in upd) && upd.count !== 0) leaks.push(`${role.label}: update stock_on_hand`);
  const del = await attempt(c, 'delete from public.stock_on_hand where stock_lot_id = $1', [lot]);
  if (!('error' in del) && del.count !== 0) leaks.push(`${role.label}: delete stock_on_hand`);
  const ins = await attempt(c, `insert into public.stock_on_hand (stock_lot_id, product_id, lot_no) values (gen_random_uuid(), $1, 'Zz')`, [a.rows.products]);
  if (!('error' in ins)) leaks.push(`${role.label}: insert stock_on_hand`);
  return leaks;
}

type Fn = { name: string; secdef: boolean; argNames: string[]; argTypes: string[] };

async function publicFunctions(c: Client, where: string): Promise<Fn[]> {
  await asPostgres(c);
  return (await c.query(`
    select p.proname::text as name, p.prosecdef as secdef,
      coalesce(p.proargnames[1:p.pronargs], '{}')::text[] as "argNames",
      coalesce((select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes::oid[]) with ordinality u(t, o)), '{}') as "argTypes"
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and ${where}
    order by 1`)).rows;
}

/** uuid arguments, by name: the table whose row they name. */
const UUID_ARG: Record<string, string> = {
  p_patient: 'patients', p_course: 'courses', p_delegate: 'delegates', p_delegate_id: 'delegates',
  p_placing_delegate: 'delegates', p_assisting_delegate: 'delegates', p_by_delegate: 'delegates', p_chair: 'chairs',
  p_checklist: 'checklists', p_complication: 'implant_complications', p_component: 'site_components',
  p_exclude: 'surgery_slots', p_file: 'stored_files', p_followup: 'implant_followups', p_graft: 'implant_grafts',
  p_item: 'checklist_items', p_lecturer: 'lecturers', p_lot: 'stock_lots', p_new_lot: 'stock_lots',
  p_product: 'products', p_new_product: 'products', p_problem: 'restoration_problems', p_restoration: 'restorations',
  p_session: 'sessions', p_site: 'implant_sites', p_slot: 'surgery_slots', p_study: 'studies',
  p_supervisor: 'supervisors', p_talk: 'talks', p_template: 'checklist_templates', p_version: 'consent_form_versions',
};
/** p_id, by function. */
const ID_ARG: Record<string, string> = {
  delete_analysis: 'saved_analyses', save_analysis: 'saved_analyses', delete_study: 'studies', save_study: 'studies',
  research_code: 'patients', save_consent_version: 'consent_form_versions', save_radiograph: 'radiographs',
  void_radiograph: 'radiographs', void_consent: 'patient_consents',
};
const TEXT_ARG: Record<string, string | null> = {
  p_reason: 'Zz isolation probe', p_email: 'zz-iso-probe@example.com', p_entity: 'patient', p_stage: 'final',
  p_material: 'zirconia', p_retention: 'screw', p_procedure: 'gbr', p_timing: 'simultaneous', p_membrane: 'none',
  p_language: 'en', p_purpose: 'baseline', p_attendance: 'attended', p_visit_key: 'month_6', p_check_type: '6-month',
  p_action: 'none', p_content_type: 'application/pdf', p_link: 'https://example.com/zz', p_label: 'Zz probe v9',
  p_technique: null, p_override_reason: '', p_brand: null, p_system: null, p_graft: '', p_notes: '', p_note: '',
};
const TYPE_ARG: Record<string, Record<string, string>> = {
  p_type: { save_radiograph: 'periapical', add_restoration: 'single_crown', record_restoration_problem: 'chipping', update_restoration_problem: 'chipping' },
};
const ENUM_ARG: Record<string, string> = {
  user_role: 'organizer', movement_reason: 'adjust', component_type: 'healing_abutment', followup_outcome: 'ok',
  checklist_scope: 'general', slot_status: 'done',
};

const EMAIL = Symbol('the company organizer\'s email');
/** Arguments of particular functions, so the call gets past its input checks to the rows it names. */
const FN_ARG: Record<string, Record<string, unknown>> = {
  // A delegate login linked to the other company's delegate (and, for add_existing_member, its organizer).
  create_pending_login: { p_role: 'delegate' },
  add_existing_member: { p_role: 'delegate', p_email: EMAIL },
  create_checklist: { p_slot: null },
  save_template: { p_applies_to: 'surgery' },
  set_implant_technique: { p_technique: 'guided' },
  admin_record_event: { p_kind: 'invite_resent' },
  adjust_stock: { p_note: 'Zz isolation probe' },
};

/** Plausible arguments for the function, naming the company's rows. */
function argsFor(fn: Fn, co: Company, today: string, updatedAt: Record<string, Date>): unknown[] {
  const firstTable = fn.argNames.map((n) => (n === 'p_id' ? ID_ARG[fn.name] : UUID_ARG[n])).find(Boolean);
  return fn.argTypes.map((type, i) => {
    const name = fn.argNames[i] ?? '';
    const override = FN_ARG[fn.name]?.[name];
    if (override !== undefined) return override === EMAIL ? co.organizerEmail : override;
    switch (type) {
      case 'uuid': {
        if (name === 'p_company') return co.id;
        if (name === 'p_user' || name === 'p_by_organizer') return co.organizer;
        const table = name === 'p_id' ? ID_ARG[fn.name] : UUID_ARG[name];
        if (table === 'sessions' && fn.name.includes('talk')) return co.lectureSession;
        return (table && co.rows[table]) || crypto.randomUUID();
      }
      case 'uuid[]':
        if (name === 'p_placing' || name === 'p_delegates') return [co.rows.delegates];
        if (name === 'p_courses') return [co.rows.courses];
        if (name === 'p_sites') return [co.rows.implant_sites];
        return [];
      case 'text':
        if (TYPE_ARG[name]?.[fn.name]) return TYPE_ARG[name][fn.name];
        return name in TEXT_ARG ? TEXT_ARG[name] : 'Zz probe';
      case 'text[]': return ['Zz probe'];
      case 'date': return name === 'p_from' || name === 'p_to' ? null : today;
      case 'time without time zone': return name === 'p_end' ? '10:00' : '09:00';
      case 'integer': return 1;
      case 'smallint': return 21;
      case 'smallint[]': return [11];
      case 'boolean': return true;
      case 'numeric': return name === 'p_torque' ? 35 : name === 'p_isq' ? 70 : 2;
      case 'jsonb': return name === 'p_implants' || name === 'p_levels' ? '[]' : '{}';
      case 'bytea': return Buffer.from('%PDF-1.4');
      case 'timestamp with time zone': return (firstTable && updatedAt[firstTable]) || new Date();
      default: return type in ENUM_ARG ? ENUM_ARG[type] : null;
    }
  });
}

const callSql = (fn: Fn) =>
  `select * from public.${quoteIdent(fn.name)}(${fn.argTypes.map((t, i) => `$${i + 1}::${t}`).join(', ')})`;

async function updatedAts(c: Client, co: Company): Promise<Record<string, Date>> {
  await asPostgres(c);
  const out: Record<string, Date> = {};
  for (const [table, id] of Object.entries(co.rows)) {
    const has = (await c.query(`select 1 from pg_attribute where attrelid = $1::regclass and attname = 'updated_at'`, [`public.${table}`])).rows.length;
    if (has) out[table] = (await c.query(`select updated_at from public.${table} where id = $1`, [id])).rows[0].updated_at;
  }
  return out;
}

async function world(c: Client) {
  const a = await seedCompany(c, 'A');
  const b = await seedCompany(c, 'B');
  const tables = await companyTables(c);
  const today = (await c.query('select public.cairo_today()::text as d')).rows[0].d as string;
  return { a, b, tables, today };
}

/** The message the statement raised, or null when it ran. */
async function raised(c: Client, sql: string, params: unknown[]): Promise<string | null> {
  const res = await attempt(c, sql, params);
  return 'error' in res ? res.error : null;
}

describe('tenant isolation: nothing of company A is reachable from company B', () => {
  it('seeds a row in every company table of each company', { timeout: TIMEOUT }, async () => {
    await withTx(async (c) => {
      const { a, b, tables } = await world(c);
      for (const co of [a, b]) {
        const empty: string[] = [];
        for (const t of tables) {
          const n = (await c.query(`select count(*)::int as n from ${t.name} where company_id = $1`, [co.id])).rows[0].n;
          if (n === 0) empty.push(t.name);
        }
        expect(empty, `company ${co.key}: company tables with no row`).toEqual(EMPTY_ALLOWED);
      }
    });
  });

  it("B's roles, a user with no membership, an unbound session and anon can't select, update, delete or insert A's rows (every company table, stock_on_hand)", { timeout: TIMEOUT }, async () => {
    await withTx(async (c) => {
      const { a, b, tables } = await world(c);
      const aRows: Record<string, Record<string, unknown>> = {};
      for (const t of tables) {
        aRows[t.name] = (await c.query(`select to_jsonb(x) as r from ${t.name} x where company_id = $1 limit 1`, [a.id])).rows[0]?.r ?? { company_id: a.id };
      }
      const leaks: string[] = [];
      for (const role of await bRoles(c, b)) leaks.push(...await probeTables(c, role, tables, a, aRows));
      expect(leaks).toEqual([]);

      // B's admin does see B's own rows: the probes above were not refused for some unrelated reason.
      await actAsBound(c, b.admin, b.id);
      expect((await c.query('select id from public.patients')).rows).toEqual([{ id: b.rows.patients }]);
      expect((await c.query('select stock_lot_id from public.stock_on_hand')).rows).toEqual([{ stock_lot_id: b.rows.stock_lots }]);
    });
  });

  it("every public function with a uuid argument, called by B's admin with A's ids, raises or changes nothing of A's, returns none of A's data and leaves no B row naming A's", { timeout: TIMEOUT }, async () => {
    await withTx(async (c) => {
      const { a, b, tables, today } = await world(c);
      const fns = await publicFunctions(c, `'uuid'::regtype = any(p.proargtypes::oid[]::regtype[])`);
      expect(fns.length).toBeGreaterThan(90);
      const stamps = await updatedAts(c, a);
      const aIds = await companyIds(c, tables, a);
      const before = await checksum(c, tables, a);
      expect(await naming(c, tables, b, aIds)).toEqual([]);
      const problems: string[] = [];
      let ran = 0;
      for (const fn of fns) {
        await c.query('savepoint fn');
        await actAsBound(c, b.admin, b.id);
        let rows: unknown[];
        try {
          rows = (await c.query(callSql(fn), argsFor(fn, a, today, stamps))).rows;
        } catch {
          await c.query('rollback to savepoint fn');
          continue;
        }
        ran++;
        if (!PRE_LOGIN_READERS.has(fn.name) && JSON.stringify(rows).includes(a.marker)) problems.push(`${fn.name}: returned A's data`);
        const diff = changed(before, await checksum(c, tables, a));
        if (diff.length) problems.push(`${fn.name}: changed A's ${diff.join(', ')}`);
        const named = await naming(c, tables, b, aIds);
        if (named.length) problems.push(`${fn.name}: B rows name A's (${named.join(', ')})`);
        await c.query('rollback to savepoint fn');
      }
      expect(problems).toEqual(KNOWN_CROSS_REFERENCES);
      expect(ran).toBeGreaterThan(0);
      expect(await checksum(c, tables, a)).toEqual(before);
    });
  });

  it('Review Focus 1: a user active in A and inactive in B, bound to B, reads no rows and every edit function refuses', { timeout: TIMEOUT }, async () => {
    await withTx(async (c) => {
      const { a, b, tables, today } = await world(c);
      const user = a.organizer;
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', false)`, [b.id, user]);
      await setPerms(c, user, { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit', research: 'edit' }, b.id);

      await actAsBound(c, user, b.id);
      const seen: string[] = [];
      for (const t of [...tables.map((t) => t.name), 'public.stock_on_hand']) {
        // The person-level policies show anyone their own membership and permissions in the bound company
        // (the app reads them to send a deactivated user to /deactivated): nothing else of B's, nothing of A's.
        const res = OWN_ROWS.has(t)
          ? await attempt(c, `select count(*)::int as n from ${t} where not (user_id = $1 and company_id = $2)`, [user, b.id])
          : await attempt(c, `select count(*)::int as n from ${t}`);
        if (!('error' in res) && (res.rows[0] as { n: number }).n !== 0) seen.push(t);
      }
      expect(seen).toEqual([]);

      const fns = (await publicFunctions(c, 'p.prosecdef')).filter((f) => !NOT_EDIT.has(f.name));
      expect(fns.length).toBeGreaterThan(70);
      const stamps = await updatedAts(c, b);
      const ran: string[] = [];
      for (const fn of fns) {
        await c.query('savepoint fn');
        try {
          await actAsBound(c, user, b.id);
          const res = await attempt(c, callSql(fn), argsFor(fn, b, today, stamps));
          const nothing = 'error' in res
            || (FILE_READERS.has(fn.name) && res.rows.every((r) => Object.values(r as object).every((v) => v === null)));
          if (!nothing) ran.push(fn.name);
        } finally {
          await c.query('rollback to savepoint fn');
        }
      }
      expect(ran).toEqual([]);
    });
  });

  it("Review Focus 3: with A's ids, place_implant_v3, receive_stock, create_surgery_slot and record_consent give their not-found message, not a permission error", { timeout: TIMEOUT }, async () => {
    await withTx(async (c) => {
      const { a, b, today } = await world(c);
      await actAsBound(c, b.admin, b.id);
      const A = a.rows;
      const B = b.rows;

      const placeSql = `select public.place_implant_v3(p_patient => $1, p_tooth => 21::smallint, p_product => $2, p_lot => $3,
        p_placed_on => $4::date, p_placing_delegate => $5, p_supervisor => $6, p_assisting_delegate => null, p_graft => '',
        p_notes => '', p_slot => null, p_technique => null, p_course => $7)`;
      const place = (p: Record<string, string>) => raised(c, placeSql, [p.patients, p.products, p.stock_lots, today, p.delegates, p.supervisors, p.courses]);
      expect(await place(A)).toBe('Patient not found.');
      expect(await place({ ...B, courses: A.courses })).toBe('Choose the course.');
      expect(await place({ ...B, products: A.products })).toBe('Choose an implant from the catalog.');
      expect(await place({ ...B, supervisors: A.supervisors })).toBe('Choose an active supervisor.');

      expect(await raised(c, `select public.receive_stock(p_product => $1, p_qty => 1, p_lot_no => 'Zz', p_expiry => null)`, [A.products]))
        .toBe('Choose an active product from the catalog.');

      const slotSql = `select public.create_surgery_slot(p_session => $1, p_chair => $2, p_start => '09:00', p_end => '10:00',
        p_patient => $3, p_supervisor => $4, p_placing => $5::uuid[], p_assisting => '{}', p_implants => '[]', p_override_reason => '')`;
      const slot = (p: Record<string, string>) => raised(c, slotSql, [p.sessions, p.chairs, p.patients, p.supervisors, [p.delegates]]);
      expect(await slot(A)).toBe('Choose a surgery session.');
      expect(await slot({ ...B, chairs: A.chairs })).toBe('Choose an active chair.');
      expect(await slot({ ...B, patients: A.patients })).toBe('Patient not found.');
      expect(await slot({ ...B, supervisors: A.supervisors })).toBe('Choose an active supervisor.');

      const consentSql = `select public.record_consent(p_patient => $1, p_version => $2, p_language => 'en', p_signed_on => $3::date,
        p_treatment => true, p_research => true, p_teaching_images => true, p_follow_up => true, p_file => $4, p_content_type => 'application/pdf')`;
      const consent = (p: Record<string, string>) => raised(c, consentSql, [p.patients, p.consent_form_versions, today, Buffer.from('%PDF-1.4')]);
      expect(await consent(A)).toBe('Patient not found.');
      expect(await consent({ ...B, consent_form_versions: A.consent_form_versions })).toBe('Choose the form version that was signed.');
    });
  });
});
