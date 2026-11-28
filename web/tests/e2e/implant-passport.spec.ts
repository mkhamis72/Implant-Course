import { readFile, writeFile } from 'node:fs/promises';
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

const generations = (page: Page) => page.getByTestId('passport-generation');

/** Clicks Generate: the PDF is built in the browser and downloaded; returns its bytes and suggested name. */
async function generate(page: Page): Promise<{ bytes: Buffer; name: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Generate passport' }).click(),
  ]);
  const path = await download.path();
  return { bytes: await readFile(path), name: download.suggestedFilename() };
}

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('implant passport: a View-only user builds it in the browser; the log and the medical setting', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const admin = await apiAs(TEST_USERS.admin.email);
  try {
    await login(page, TEST_USERS.organizer.email);
    // An Arabic name: shaped by the browser-side layout (checked visually in the task report).
    const patientId = await createPatientViaUi(page, { full_name: `${uniqueName('Passport')} حسن علي` });
    const fileNo = (await page.getByTestId('patient-header').getByText(/^File /).textContent())!.replace(/^File /, '').trim();

    // The patient's tabs lead to the passport page.
    await page.getByRole('navigation', { name: 'Patient sections' }).getByRole('link', { name: 'Implant passport' }).click();
    await expect(page).toHaveURL(`/patients/${patientId}/passport`);
    await expect(page.getByText('No passport generated yet.')).toBeVisible();

    // View on Patients is enough to generate.
    const viewer = await signedIn(browser, TEST_USERS.viewer.email);
    const errors: string[] = [];
    viewer.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await viewer.goto(`/patients/${patientId}/passport`);
    const first = await generate(viewer);
    expect(first.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(first.name).toBe(`Implant passport ${fileNo} ${cairoToday()}.pdf`);
    // Kept for a visual check when asked (PASSPORT_PDF_OUT=<file>).
    if (process.env.PASSPORT_PDF_OUT) await writeFile(process.env.PASSPORT_PDF_OUT, first.bytes);
    // Server-derived: the refreshed list shows the one generation.
    await expect(generations(viewer)).toHaveCount(1);
    await expect(generations(viewer).first()).toContainText('Test Viewer');
    await expect(generations(viewer).first()).toContainText('Allergies and medications only');
    await expect(viewer.getByRole('button', { name: 'Generate passport' })).toBeEnabled();
    expect(errors.filter((e) => /Content Security Policy|Refused/i.test(e))).toEqual([]);

    // A cross-site request for the data is refused.
    const crossSite = await viewer.request.get(`/patients/${patientId}/passport/data`, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status()).toBe(403);

    // The admin chooses Nothing medical: the next passport is made with it, the log keeps the older one's.
    const adminPage = await signedIn(browser, TEST_USERS.admin.email);
    await adminPage.goto('/admin/settings');
    const medical = adminPage.getByRole('radiogroup', { name: 'Medical content' });
    await medical.getByRole('radio', { name: 'Nothing medical' }).check();
    await adminPage.getByRole('button', { name: 'Save passport settings' }).click();
    await expect(adminPage.getByText('Passport settings saved.')).toBeVisible();
    await adminPage.context().close();

    await viewer.reload();
    const second = await generate(viewer);
    expect(second.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(generations(viewer)).toHaveCount(2);
    await expect(generations(viewer).first()).toContainText('Nothing medical');
    await expect(generations(viewer).nth(1)).toContainText('Allergies and medications only');

    // A change to the record marks the latest passport.
    await expect(viewer.getByText('Records changed since this version')).toHaveCount(0);
    const api = await apiAs(TEST_USERS.organizer.email);
    const { error } = await api.from('patients').update({ dob: '1970-01-15' }).eq('id', patientId);
    expect(error).toBeNull();
    await viewer.reload();
    await expect(generations(viewer).first()).toContainText('Records changed since this version');
    await viewer.context().close();
  } finally {
    // The company default for the other specs.
    const { error } = await admin.rpc('set_passport_settings', { p_medical: 'allergies_medications' });
    expect(error).toBeNull();
  }
});
