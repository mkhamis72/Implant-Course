import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);

test('a visit dated before placement is listed on the data-quality page and flagged on the patient', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('DQ'), qty: 1, lot: `E2E-DQ${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr DQ'));
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Quality patient');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const me = (await api.auth.getUser()).data.user!.id;
  const placed = await placeImplant(api, {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
    p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(placed.error).toBeNull();

  // The app refuses such a date, so plant it directly.
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query(
      `insert into public.implant_followups (site_id, date, check_type, outcome)
       select id, placed_on - 30, 'Legacy check', 'ok' from public.implant_sites where patient_id = $1 and tooth = 36`,
      [patientId],
    );
  } finally {
    await pg.end();
  }

  await page.goto('/patients/data-quality');
  const row = page.getByTestId('data-quality-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('36');

  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('link', { name: 'Date problem' }).first()).toBeVisible();
});
