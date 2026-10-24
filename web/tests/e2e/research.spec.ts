import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);

test('the research page counts placed implants, drills down, compares by technique, offers the R script, and refuses an organizer without Research', async ({ page, browser }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Res');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-RS${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Res'));
  const me = (await api.auth.getUser()).data.user!.id;

  await login(page, TEST_USERS.organizer.email);
  const names: string[] = [];
  for (const [tooth, technique] of [[36, 'guided'], [46, 'free_hand']] as const) {
    const name = uniqueName('Research patient');
    names.push(name);
    const patientId = await createPatientViaUi(page, { full_name: name });
    const placed = await placeImplant(api, {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: me, p_technique: technique,
    });
    expect(placed.error).toBeNull();
    if (technique === 'guided') {
      // One lost implant, so the technique comparison has a failure and a log-rank p-value.
      const failed = await api.rpc('record_visit', {
        p_site: placed.data, p_date: today(), p_visit_key: null, p_check_type: '3-month', p_attendance: 'attended',
        p_outcome: 'failed', p_findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' }, p_notes: '',
      });
      expect(failed.error).toBeNull();
    }
  }

  // The test organizer has no Research permission: no Statistics in the menu, and the page refuses.
  await expect(page.getByRole('link', { name: 'Statistics' })).toHaveCount(0);
  await page.goto('/statistics');
  await expect(page).not.toHaveURL(/\/statistics/);
  await expect(page.getByRole('heading', { level: 1, name: 'Statistics & data analysis' })).toHaveCount(0);

  const adminCtx = await browser.newContext({ acceptDownloads: true });
  const adminPage = await adminCtx.newPage();
  try {
    await login(adminPage, TEST_USERS.admin.email);
    // The old Patients → Research address redirects to the Statistics module, keeping the filters.
    await adminPage.goto(`/patients/research?course=all&brand=${encodeURIComponent(brand)}`);
    await expect(adminPage).toHaveURL(/\/statistics\?course=all&brand=/);
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Statistics & data analysis' })).toBeVisible();
    const tile = adminPage.locator('a[href*="list=implants"]').first();
    await expect(tile).toHaveText('2');

    await tile.click();
    await expect(adminPage).toHaveURL(/\/statistics\/drilldown\?list=implants/);
    for (const name of names) await expect(adminPage.getByText(name).first()).toBeVisible();

    // Compare by technique: two groups of one implant each and one failure, so a p-value, the thin-data warning and the clustering note.
    await adminPage.goto(`/statistics?brand=${encodeURIComponent(brand)}&compare=technique`);
    const compare = adminPage.getByRole('region', { name: 'Compare groups' });
    await expect(compare.getByRole('cell', { name: /^Guided/ })).toBeVisible();
    await expect(compare.getByRole('cell', { name: /^Free hand/ })).toBeVisible();
    await expect(compare).toContainText('Log-rank test');
    await expect(compare).toContainText(/Log-rank test on 2 implants, 1 failure: p [=<] 0\.\d{3}/);
    await expect(compare).toContainText('Not enough data — interpret with caution (n = 2, 1 failure)');
    await expect(compare).toContainText('Use the R script for patient-clustered models.');

    // The R script downloads on its own.
    const [download] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.getByRole('link', { name: 'Download R script' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('analysis.R');
    const script = readFileSync((await download.path())!, 'utf8');
    expect(script).toContain('library(survival)');
    expect(script).toContain('coxph(');
  } finally {
    await adminCtx.close();
  }
});
