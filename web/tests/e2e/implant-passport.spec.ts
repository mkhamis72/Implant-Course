import { test, expect, type Browser, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { apiAs } from './api';
import { createPatientViaUi, uniqueName } from './patients';

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}

const versions = (page: Page) => page.getByTestId('passport-version');

async function generate(page: Page, version: number) {
  await page.getByRole('button', { name: 'Generate new passport' }).click();
  await expect(page.getByText(`Passport version ${version} generated.`)).toBeVisible({ timeout: 30_000 });
  // Server-derived: the refreshed list shows the stored version on top.
  await expect(versions(page)).toHaveCount(version);
}

test('implant passport: generate, download, versions, View-only and the medical setting', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const admin = await apiAs(TEST_USERS.admin.email);
  try {
    await login(page, TEST_USERS.organizer.email);
    const patientId = await createPatientViaUi(page, { full_name: uniqueName('Passport') });
    const fileNo = (await page.getByTestId('patient-header').getByText(/^File /).textContent())!.replace(/^File /, '').trim();

    // The patient's tabs lead to the passport page.
    await page.getByRole('navigation', { name: 'Patient sections' }).getByRole('link', { name: 'Implant passport' }).click();
    await expect(page).toHaveURL(`/patients/${patientId}/passport`);
    await expect(page.getByText('No passport generated yet.')).toBeVisible();

    await generate(page, 1);
    const first = versions(page).first();
    await expect(first).toContainText(`${fileNo}-1`);
    await expect(first).toContainText('Test Organizer');
    await expect(first).toContainText('Allergies and medications only');
    await expect(first).toContainText('Not downloaded yet');

    // Download: the stored PDF as an attachment.
    const link = first.getByRole('link', { name: `Download passport ${fileNo}-1` });
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe(`Implant passport ${fileNo}-1.pdf`);
    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['cache-control']).toContain('no-store');
    expect((await res.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await page.reload();
    await expect(versions(page).first()).toContainText('Downloaded 2 times, last by Test Organizer');

    await generate(page, 2);
    await expect(versions(page).first()).toContainText(`${fileNo}-2`);
    await expect(versions(page).nth(1)).toContainText(`${fileNo}-1`);

    // View on Patients: download, no Generate.
    const viewer = await signedIn(browser, TEST_USERS.viewer.email);
    await viewer.goto(`/patients/${patientId}/passport`);
    await expect(versions(viewer)).toHaveCount(2);
    await expect(viewer.getByRole('link', { name: `Download passport ${fileNo}-2` })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Generate new passport' })).toHaveCount(0);
    // …and the generate route refuses a View-only user as well.
    const refused = await viewer.evaluate(async (url) => (await fetch(url, { method: 'POST' })).status,
      `/patients/${patientId}/passport/generate`);
    expect(refused).toBe(403);
    await viewer.context().close();

    // The admin chooses Nothing medical: the next version is made with it, the stored ones keep theirs.
    const adminPage = await signedIn(browser, TEST_USERS.admin.email);
    await adminPage.goto('/admin/settings');
    const medical = adminPage.getByRole('radiogroup', { name: 'Medical content' });
    await medical.getByRole('radio', { name: 'Nothing medical' }).check();
    await adminPage.getByRole('button', { name: 'Save passport settings' }).click();
    await expect(adminPage.getByText('Passport settings saved.')).toBeVisible();
    await adminPage.reload();
    await expect(adminPage.getByRole('radiogroup', { name: 'Medical content' }).getByRole('radio', { name: 'Nothing medical' })).toBeChecked();
    await adminPage.context().close();

    await page.reload();
    await generate(page, 3);
    await expect(versions(page).first()).toContainText(`${fileNo}-3`);
    await expect(versions(page).first()).toContainText('Nothing medical');
    await expect(versions(page).nth(1)).toContainText('Allergies and medications only');

    // A change to the record marks the latest version stale.
    await expect(page.getByText('Records changed since this version')).toHaveCount(0);
    const api = await apiAs(TEST_USERS.organizer.email);
    const { error } = await api.from('patients').update({ dob: '1970-01-15' }).eq('id', patientId);
    expect(error).toBeNull();
    await page.reload();
    await expect(versions(page).first()).toContainText('Records changed since this version');
  } finally {
    // The company default for the other specs.
    const { error } = await admin.rpc('set_passport_settings', { p_medical: 'allergies_medications' });
    expect(error).toBeNull();
  }
});
