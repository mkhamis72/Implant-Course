import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { ACADEMY, withPg } from './companies';

// Statistics switched off by the company's plan (academy runs on an E2E plan with Inventory only).
// The plan is read per request, so a SQL change shows on the next page load.

const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';
const PLAN_NAME = 'E2E Basic';

test.describe.configure({ mode: 'serial' });

async function setPlan(planId: string) {
  await withPg((pg) => pg.query('update public.companies set plan_id = $2 where id = $1', [ACADEMY, planId]));
}

test.beforeAll(async () => {
  await withPg(async (pg) => {
    await pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]);
    const { rows } = await pg.query(
      `insert into public.plans (name, kind, modules) values ($1, 'course_organizer', '{inventory}') returning id`,
      [PLAN_NAME],
    );
    await pg.query('update public.companies set plan_id = $2 where id = $1', [ACADEMY, rows[0].id]);
  });
});

test.afterAll(async () => {
  try {
    await setPlan(FULL_PLAN);
  } finally {
    await withPg((pg) => pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]));
  }
});

test('Statistics disappears for the admin, data kept', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Statistics' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Checklists' }).first()).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Inventory' }).first()).toBeVisible();
  await page.goto('/statistics');
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  await expect(page.getByText('Not in your plan – contact us')).toBeVisible();
});

test('an organizer keeps their Statistics permission', async ({ page }) => {
  const stored = () => withPg(async (pg) =>
    (await pg.query(
      `select up.level from public.user_permissions up join public.profiles p on p.user_id = up.user_id
       where lower(p.email) = $1 and up.area = 'research'`,
      [TEST_USERS.organizer.email],
    )).rows[0]?.level as string | undefined);
  // Global setup gives the organizer no Statistics row: give them View (the only level), as an admin once did.
  await withPg((pg) => pg.query(
    `insert into public.user_permissions (company_id, user_id, area, level)
     select $2::uuid, user_id, 'research', 'view' from public.profiles where lower(email) = $1
     on conflict (company_id, user_id, area) do update set level = 'view'`,
    [TEST_USERS.organizer.email, ACADEMY],
  ));
  try {
    expect(await stored()).toBe('view');
    await login(page, TEST_USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByTestId(`user-row-${TEST_USERS.organizer.email}`);
    await row.getByText('Permissions', { exact: true }).click();
    await expect(row.getByRole('group', { name: 'Statistics' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Save permissions' }).click();
    await expect(row.getByText('Permissions saved.')).toBeVisible();
    expect(await stored()).toBe('view');
  } finally {
    await withPg((pg) => pg.query(
      `delete from public.user_permissions where area = 'research'
       and user_id in (select user_id from public.profiles where lower(email) = $1)`,
      [TEST_USERS.organizer.email],
    ));
  }
});

test('back on Full, everything returns', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await setPlan(FULL_PLAN);
  await page.reload();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Statistics' }).first()).toBeVisible();
  await page.goto('/statistics');
  await expect(page).toHaveURL(/\/statistics/);
});
