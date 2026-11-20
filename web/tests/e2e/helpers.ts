import { expect, type Page } from '@playwright/test';
import { TEST_PASSWORD } from '../support/test-users';

export async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

export async function expectDashboard(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** Brand, then size (E2E products have the single line "E2E" and no type, so those fill in themselves). */
export async function chooseImplant(page: Page, brand: string, size: string) {
  await page.getByRole('combobox', { name: 'Implant brand' }).selectOption({ label: brand });
  const sizes = page.getByRole('combobox', { name: 'Implant size' });
  const value = await sizes.locator('option', { hasText: size }).getAttribute('value');
  await sizes.selectOption(value!);
}

/** The booking form's patient picker: search by file number, choose that exact file, wait for its card. */
export async function choosePatient(page: Page, fileNo: string) {
  await page.getByRole('combobox', { name: 'Patient' }).fill(fileNo);
  // The match line starts with the file number; another file number may contain this one.
  const escaped = fileNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option').filter({ has: page.getByText(new RegExp(`^${escaped}( ·|$)`)) }).click();
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
}
