import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, deleteE2ePatients, uniqueName } from './patients';
import { apiAs, seedChair, seedImplantStock } from './api';
import { ACADEMY, withPg } from './companies';

// Academy switched to a Clinic company (kind 'clinic', a clinic plan) by SQL; restored afterwards.
// The company is read per request, so a SQL change shows on the next page load.

const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';
const PLAN_NAME = `E2E Clinic ${Date.now()}`;
const TEACHING = /courses|delegates|supervisor|lecture|workshop/i;

test.describe.configure({ mode: 'serial' });

const doctor = uniqueName('Dr Clinic');
// The clinic day the booking went to: made by the database, unless today already had one (`dayExisted`).
let daySession = '';
let dayExisted = false;
let brand = '';
let chair = '';
let defaultItem = '';
const templateName = uniqueName('Default clinic day');
// Academy's own default templates for the 'surgery' scope, put back as default after the run.
let priorDefaults: string[] = [];

async function restore() {
  await withPg(async (pg) => {
    await pg.query(`update public.companies set kind = 'course_organizer', plan_id = $2 where id = $1`, [ACADEMY, FULL_PLAN]);
    await pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]);
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  // Seed while academy is still a course organizer on Full.
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  brand = uniqueName('ClinicBrand');
  await seedImplantStock(api, { brand, qty: 2, lot: `E2E-CL${Date.now()}`, expiry: '2031-12-31' });
  chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const d = await admin.from('doctors').insert({ name: doctor });
  expect(d.error).toBeNull();
  priorDefaults = await withPg(async (pg) =>
    (await pg.query("select id from public.checklist_templates where applies_to = 'surgery' and is_default")).rows.map((r) => r.id as string));
  defaultItem = uniqueName('Clinic room ready');
  const t = await api.rpc('save_template', {
    p_template: null, p_name: templateName, p_applies_to: 'surgery', p_is_default: true, p_items: [defaultItem],
  });
  expect(t.error).toBeNull();
  await withPg(async (pg) => {
    await pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]);
    const { rows } = await pg.query(
      `insert into public.plans (name, kind, modules) values ($1, 'clinic', '{inventory,statistics}') returning id`,
      [PLAN_NAME],
    );
    await pg.query(`update public.companies set kind = 'clinic', plan_id = $2 where id = $1`, [ACADEMY, rows[0].id]);
  });
});

test.afterAll(async () => {
  // Dependency order; every failure is logged, none is swallowed. The seeded chair and stock are deactivated, and the
  // E2E patients and templates deleted, by the global teardown (patients.ts); doctors are not covered, so they go here.
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`clinic.spec cleanup failed (${what}):`, e);
    }
  };
  await step('restore company', restore);
  await step('patients, implants, slots', deleteE2ePatients);
  await withPg(async (pg) => {
    await step('clinic day', async () => {
      // Only when nothing else is booked on it (the patients' bookings went with them).
      if (!daySession || dayExisted) return;
      const { rows } = await pg.query('select 1 from public.surgery_slots where session_id = $1 limit 1', [daySession]);
      if (rows.length) return;
      await pg.query('delete from public.checklists where session_id = $1', [daySession]);
      await pg.query('delete from public.sessions where id = $1 and course_id is null', [daySession]);
    });
    await step('template', async () => {
      await pg.query('delete from public.checklist_templates where name = $1', [templateName]);
      if (priorDefaults.length) await pg.query('update public.checklist_templates set is_default = true where id = any($1)', [priorDefaults]);
    });
    await step('doctor', async () => {
      try {
        await pg.query('delete from public.doctors where name = $1', [doctor]);
      } catch {
        await pg.query('update public.doctors set active = false where name = $1', [doctor]);
      }
    });
  });
});

test('a clinic sees nothing about teaching', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.admin.email);
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Patients' }).first()).toBeVisible();
  await expect(nav).not.toContainText(TEACHING);

  await page.goto('/admin/doctors');
  await expect(page.getByRole('heading', { name: 'Doctors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Doctors', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Supervisors' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Lecturers' })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(TEACHING);

  await page.goto('/patients');
  await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(TEACHING);

  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Clinic form patient') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await expect(page.getByRole('combobox', { name: 'Placed by' })).toBeVisible();
  await expect(panel).not.toContainText(TEACHING);
  expect(patientId).toBeTruthy();

  await page.goto('/schedule');
  await expect(page.getByRole('link', { name: 'Book surgery' })).toBeVisible();
  await expect(page.getByText('Add clinic day')).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(TEACHING);

  const redirects: Record<string, string> = {
    '/courses': '/', '/delegates': '/', '/admin/supervisors': '/admin/users', '/admin/lecturers': '/admin/users', '/statistics/courses': '/statistics',
  };
  for (const [path, to] of Object.entries(redirects)) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`${to}$`));
    expect(new URL(page.url()).pathname, path).not.toBe('/login');
  }

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  await expect(page.getByText('Courses and delegates')).toHaveCount(0);
});

test('clinic booking to placement', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.organizer.email);

  const name = uniqueName('Clinic patient');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const fileNo = await withPg(async (pg) => (await pg.query('select file_no from public.patients where id = $1', [patientId])).rows[0].file_no as string);

  dayExisted = await withPg(async (pg) =>
    (await pg.query(
      `select 1 from public.sessions where company_id = $1 and type = 'surgery' and course_id is null
       and date = (now() at time zone 'Africa/Cairo')::date`,
      [ACADEMY],
    )).rows.length > 0);

  // Booked directly from the Schedule page, on its day (today): no surgery day to add first.
  await page.goto('/schedule');
  await page.getByRole('link', { name: 'Book surgery' }).click();
  await expect(page.getByLabel('Date')).not.toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Surgery session' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Where' }).selectOption({ label: 'GA in hospital' });
  await page.getByRole('combobox', { name: 'Chair' }).selectOption({ label: chair });
  await page.getByRole('combobox', { name: 'Doctor' }).selectOption({ label: doctor });
  await page.getByLabel('Start', { exact: true }).fill('10:00');
  await page.getByLabel('End', { exact: true }).fill('11:00');
  await page.getByLabel('Patient (file number)').fill(fileNo);
  await page.getByLabel('Tooth 1').fill('36');
  const sizeValue = await page.getByRole('combobox', { name: 'Implant 1' }).locator('option', { hasText: brand }).first().getAttribute('value');
  await page.getByRole('combobox', { name: 'Implant 1' }).selectOption(sizeValue!);
  await page.getByRole('combobox', { name: 'Technique 1' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);
  const card = page.getByTestId(`booking-${fileNo}`);
  await expect(card).toContainText(`Doctor: ${doctor}`);
  await expect(card).toContainText('Where: GA in hospital');
  daySession = await withPg(async (pg) =>
    (await pg.query('select s.session_id from public.surgery_slots s join public.patients p on p.id = s.patient_id where p.file_no = $1', [fileNo])).rows[0].session_id as string);

  // Editing keeps Where unless it is changed.
  await card.getByRole('link', { name: 'Edit booking' }).click();
  await expect(page.getByRole('combobox', { name: 'Where' })).toHaveValue('hospital_ga');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);
  await expect(page.getByTestId(`booking-${fileNo}`)).toContainText('Where: GA in hospital');

  await page.goto(`/patients/${patientId}?tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel).toContainText('Booked: ');
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await expect(page.getByTestId('booked-people')).toHaveText(new RegExp(`Placed by ${doctor}`));
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  await page.goto(`/patients/${patientId}?tooth=36`);
  await expect(page.getByRole('complementary', { name: 'Tooth details' }).getByTestId('site-details')).toContainText(`Placed by ${doctor}`);
  await page.goto('/schedule');
  await expect(page.getByTestId(`booking-${fileNo}`)).toContainText('Completed');
});

test('checklist on a clinic day', async ({ page }) => {
  test.setTimeout(180_000);
  expect(daySession, 'the clinic booking test ran first').toBeTruthy();
  test.skip(dayExisted, 'today already had a clinic day, made before this run’s default checklist');
  const { id, title } = await withPg(async (pg) =>
    (await pg.query(
      `select c.id, s.title from public.checklists c join public.sessions s on s.id = c.session_id
       join public.checklist_items i on i.checklist_id = c.id where s.id = $1 and i.text = $2 limit 1`,
      [daySession, defaultItem],
    )).rows[0] ?? {}) as { id?: string; title?: string };
  expect(id, 'the default checklist attached to the clinic day').toBeTruthy();
  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/checklists/${id}`);
  await expect(page.getByRole('checkbox', { name: defaultItem })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Session · ${title}`) })).toHaveAttribute('href', /^\/schedule\?date=\d{4}-\d{2}-\d{2}$/);
});
