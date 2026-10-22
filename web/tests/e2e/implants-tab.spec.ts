import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

test('lists the patient’s implants with who placed them, linking back to the chart', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Tab'), qty: 1, lot: `E2E-T${Date.now()}`, expiry: null });
  const delegateName = uniqueName('Dr Tab');
  const delegate = await seedDelegate(api, delegateName);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Tab patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await placeImplant(api, {
    p_patient: patientId, p_tooth: 45, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();

  await page.getByRole('link', { name: 'Implants' }).click();
  const row = page.getByTestId('implant-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('45');
  await expect(row).toContainText('Placed');
  await expect(row).toContainText(delegateName);
  await row.getByRole('link', { name: '45' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 45, Implant placed' })).toHaveAttribute('aria-pressed', 'true');
});
