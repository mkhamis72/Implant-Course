import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);

test('Explore compares the jaws for implant failure, switches views, and restores the analysis from the address', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Exp');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-EX${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Exp'));
  const me = (await api.auth.getUser()).data.user!.id;

  await login(page, TEST_USERS.organizer.email);
  for (const tooth of [16, 36]) {
    const patientId = await createPatientViaUi(page, { full_name: uniqueName('Explore patient') });
    const placed = await placeImplant(api, {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: me,
    });
    expect(placed.error).toBeNull();
    if (tooth === 36) {
      const failed = await api.rpc('record_visit', {
        p_site: placed.data, p_date: today(), p_visit_key: null, p_check_type: 'Review', p_attendance: 'attended',
        p_outcome: 'failed', p_findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' }, p_notes: '',
      });
      expect(failed.error).toBeNull();
    }
  }

  const adminCtx = await browser.newContext({ acceptDownloads: true });
  const admin = await adminCtx.newPage();
  const csp: string[] = [];
  admin.on('console', (m) => { if (m.text().includes('Content Security Policy')) csp.push(m.text()); });
  try {
    await login(admin, TEST_USERS.admin.email);
    await admin.goto(`/statistics/explore?course=all&brand=${encodeURIComponent(brand)}`);
    await expect(admin.getByRole('heading', { level: 1, name: 'Explore clinical data' })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Smoking → Marginal bone change' })).toBeVisible();

    await admin.getByRole('combobox', { name: 'Compare by' }).selectOption('jaw');
    await admin.getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
    await expect(admin.getByRole('tab')).toHaveText(['Stacked bars', 'Grouped bars', 'Table']);
    await expect(admin.getByText('Implant failure: 0 of 1 implants (Maxilla) vs 1 of 1 implants (Mandible).')).toBeVisible();
    await expect(admin.getByRole('img', { name: /Stacked bars of Implant failure by Jaw/ })).toBeVisible();

    await admin.getByRole('tab', { name: 'Table' }).click();
    const table = admin.getByRole('table', { name: 'Statistics by group' });
    await expect(table.getByRole('cell', { name: 'Maxilla', exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Mandible', exact: true })).toBeVisible();

    // Apply on the research filters (a server GET) keeps the analysis chosen in the browser.
    await admin.getByRole('button', { name: 'Apply' }).click();
    await expect(admin).toHaveURL(/f=jaw/);
    await expect(admin.getByRole('combobox', { name: 'Outcome' })).toHaveValue('failed');

    await admin.reload();
    await expect(admin.getByRole('combobox', { name: 'Compare by' })).toHaveValue('jaw');
    await expect(admin.getByRole('combobox', { name: 'Outcome' })).toHaveValue('failed');
    await expect(admin.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');

    // Save the analysis, reopen it from the list, print it, download its data, then delete it.
    const title = uniqueName('Jaw failure');
    await admin.getByRole('textbox', { name: 'Title' }).fill(title);
    await admin.getByRole('button', { name: 'Save analysis' }).click();
    const saved = admin.getByRole('link', { name: title });
    await expect(saved).toBeVisible();
    await admin.goto(`/statistics/explore?course=all&brand=${encodeURIComponent(brand)}`);
    await admin.getByRole('link', { name: title }).click();
    await expect(admin.getByRole('combobox', { name: 'Compare by' })).toHaveValue('jaw');

    await admin.getByRole('tab', { name: 'Stacked bars' }).click();
    await admin.getByRole('link', { name: 'Print report' }).click();
    await expect(admin.getByRole('heading', { level: 1 })).toContainText('Implant failure by Jaw');
    await expect(admin.getByText(/An association does not show that one thing causes another/)).toBeVisible();
    await expect(admin.getByRole('img', { name: /Stacked bars of Implant failure by Jaw/ })).toBeVisible();
    await admin.getByRole('link', { name: 'Back to Explore' }).click();

    const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: 'Download data (CSV)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^explore-failed-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await download.path())!, 'utf8').replace(/^\uFEFF/, '');
    expect(text.startsWith('implant_code,patient_code,group,value')).toBe(true);
    expect(text).toContain('Mandible');

    const item = admin.getByRole('listitem').filter({ hasText: title });
    await item.getByRole('button', { name: 'Delete' }).click();
    await item.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(admin.getByRole('link', { name: title })).toHaveCount(0);

    expect(csp).toEqual([]);
  } finally {
    await adminCtx.close();
  }
});
