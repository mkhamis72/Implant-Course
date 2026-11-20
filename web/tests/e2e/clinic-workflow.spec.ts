import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { choosePatient, login } from './helpers';
import { mailedLink } from './logins';
import { createPatientViaUi, deleteE2ePatients, uniqueName } from './patients';
import { apiAs, seedChair, seedImplantStock } from './api';
import { ACADEMY, withPg } from './companies';
import { nodeAuth } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';

// The clinic workflow end to end: a surgery booked straight from Schedule, Doctor logins, the clinic consent form.
// Academy is switched to a Clinic company by SQL (as clinic.spec.ts does) and restored afterwards.

const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';
const PLAN_NAME = `E2E Clinic Flow ${Date.now()}`;
const emailOff = process.env.EMAIL_ENABLED === 'false';
const PASSWORD = 'Doctor-password-123';

test.describe.configure({ mode: 'serial' });

const bookedDoctor = uniqueName('Dr Booked');
const loginName = uniqueName('Dr Login');
const loginEmail = `icm-doctor-${Date.now()}@example.com`;
const consentLabel = `E2E c${Date.now().toString(36)}`.slice(0, 20);
let chair = '';
let brand = '';
let hadClinicDay = false;
let loginUserId = '';

async function restore() {
  await withPg(async (pg) => {
    await pg.query(`update public.companies set kind = 'course_organizer', plan_id = $2 where id = $1`, [ACADEMY, FULL_PLAN]);
    await pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]);
  });
}

const todayClinicDays = (pg: { query: (q: string, v: unknown[]) => Promise<{ rows: { id: string }[] }> }) =>
  pg.query(
    `select id from public.sessions where company_id = $1 and type = 'surgery' and course_id is null and title = 'Clinic day'
     and date = (now() at time zone 'Africa/Cairo')::date`,
    [ACADEMY],
  );

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  brand = uniqueName('FlowBrand');
  await seedImplantStock(api, { brand, qty: 2, lot: `E2E-CF${Date.now()}`, expiry: '2031-12-31' });
  chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const d = await admin.from('doctors').insert({ name: bookedDoctor });
  expect(d.error).toBeNull();
  hadClinicDay = await withPg(async (pg) => (await todayClinicDays(pg)).rows.length > 0);
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
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`clinic-workflow.spec cleanup failed (${what}):`, e);
    }
  };
  await step('restore company', restore);
  await step('patients, implants, slots', deleteE2ePatients);
  await step('hidden clinic day', () =>
    withPg(async (pg) => {
      // Only a day this run made, and only when nothing else is booked on it.
      if (hadClinicDay) return;
      for (const { id } of (await todayClinicDays(pg)).rows) {
        const { rows } = await pg.query('select 1 from public.surgery_slots where session_id = $1 limit 1', [id]);
        if (rows.length) continue;
        await pg.query('delete from public.checklists where session_id = $1', [id]);
        await pg.query('delete from public.sessions where id = $1 and course_id is null', [id]);
      }
    }));
  await step('doctor login', async () => {
    const { rows } = await withPg((pg) => pg.query('select user_id from public.doctors where name = $1', [loginName]));
    const id = loginUserId || (rows[0]?.user_id as string | undefined) || '';
    await withPg((pg) => pg.query('delete from public.doctors where name = $1', [loginName]));
    if (id) await (await nodeAuth()).admin.deleteUser(ACADEMY_COMPANY_ID, id);
  });
  await step('doctors', () =>
    withPg(async (pg) => {
      try {
        await pg.query('delete from public.doctors where name = $1', [bookedDoctor]);
      } catch {
        await pg.query('update public.doctors set active = false where name = $1', [bookedDoctor]);
      }
    }));
  await step('consent version', () => withPg((pg) => pg.query('delete from public.consent_form_versions where label = $1', [consentLabel])));
});

test('book surgery directly', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.admin.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Flow patient') });
  const fileNo = await withPg(async (pg) => (await pg.query('select file_no from public.patients where id = $1', [patientId])).rows[0].file_no as string);

  await page.goto('/schedule');
  await page.getByRole('link', { name: 'Book surgery' }).click();
  await expect(page.getByLabel('Date')).not.toHaveValue('');
  await page.getByRole('combobox', { name: 'Where' }).selectOption({ label: 'GA in hospital' });
  await page.getByRole('combobox', { name: 'Chair' }).selectOption({ label: chair });
  await page.getByRole('combobox', { name: 'Doctor' }).selectOption({ label: bookedDoctor });
  await page.getByLabel('Start', { exact: true }).fill('10:00');
  await page.getByLabel('End', { exact: true }).fill('11:00');
  await choosePatient(page, fileNo);
  await page.getByLabel('Tooth 1').fill('36');
  const sizeValue = await page.getByRole('combobox', { name: 'Implant 1' }).locator('option', { hasText: brand }).first().getAttribute('value');
  await page.getByRole('combobox', { name: 'Implant 1' }).selectOption(sizeValue!);
  await page.getByRole('combobox', { name: 'Technique 1' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);
  const card = page.getByTestId(`booking-${fileNo}`);
  await expect(card).toContainText(`Doctor: ${bookedDoctor}`);
  await expect(card).toContainText('Where: GA in hospital');
  expect(await withPg(async (pg) => (await todayClinicDays(pg)).rows.length)).toBe(1);
});

test('a Doctor login is linked to a doctor and places as that doctor', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/users');
  const form = page.getByTestId('invite-form');
  await form.getByLabel('Full name').fill(loginName);
  await form.getByLabel('Email').fill(loginEmail);
  await form.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Doctor' });
  await expect(form.getByRole('combobox', { name: 'Doctor' })).toHaveValue('new');
  await form.getByRole('button', { name: emailOff ? 'Create login' : 'Send invite' }).click();

  const theirs = await browser.newContext();
  try {
    const theirPage = await theirs.newPage();
    let password = PASSWORD;
    if (emailOff) {
      password = (await form.getByTestId('temporary-password').locator('code').textContent())!;
    } else {
      await expect(form.getByText(`Invitation sent to ${loginEmail}.`)).toBeVisible();
      await theirPage.goto(await mailedLink(loginEmail, 'You have been invited'));
      await theirPage.getByLabel('New password').fill(PASSWORD);
      await theirPage.getByLabel('Confirm password').fill(PASSWORD);
      await theirPage.getByRole('button', { name: 'Save password' }).click();
      await expect(theirPage).toHaveURL(/\/login\?notice=invite_accepted$/);
    }

    // The Doctors list shows the new doctor with its login.
    await expect
      .poll(async () => {
        await page.goto('/admin/doctors');
        return page.getByText(`Login: ${loginName} (${loginEmail})`).count();
      }, { timeout: 20_000 })
      .toBe(1);
    const row = await withPg(async (pg) => (await pg.query('select id, user_id from public.doctors where name = $1', [loginName])).rows[0]);
    expect(row?.user_id).toBeTruthy();
    loginUserId = row.user_id as string;

    // Signed in as that doctor, the place-implant form starts on them.
    const patientId = await createPatientViaUi(page, { full_name: uniqueName('Flow login patient') });
    await login(theirPage, loginEmail, password);
    await theirPage.goto(`/patients/${patientId}`);
    await theirPage.getByRole('button', { name: 'Tooth 36, Present' }).click();
    const panel = theirPage.getByRole('complementary', { name: 'Tooth details' });
    await panel.getByRole('button', { name: 'Place implant' }).click();
    const placedBy = theirPage.getByRole('combobox', { name: 'Placed by' });
    await expect(placedBy).toBeVisible();
    await expect(placedBy.locator('option:checked')).toHaveText(loginName);
  } finally {
    await theirs.close();
  }
});

test('clinic consent form from the template', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings/consent');
  await page.getByRole('link', { name: 'New version from the clinic template' }).click();
  await expect(page).toHaveURL(/template=clinic/);
  const add = page.getByRole('region', { name: 'Add a new version' });
  await expect(add.getByText(/review/i).first()).toBeVisible();
  await expect(add.getByLabel('English text')).toHaveValue(/clinic's dentists/);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  await add.getByLabel('Label').fill(consentLabel);
  await add.getByLabel('Effective from').fill(today);
  await add.getByRole('button', { name: 'Add version' }).click();
  // Saved from the template: back on the plain page (no template prefill), the new version listed.
  await expect(page).not.toHaveURL(/template=clinic/);
  await expect(page.getByRole('region', { name: 'Versions' }).locator('summary', { hasText: consentLabel })).toBeVisible();

  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Flow consent patient') });
  await page.goto(`/patients/${patientId}/consent`);
  await expect(page.getByText("Treatment by the clinic's dentists").first()).toBeVisible();
});
