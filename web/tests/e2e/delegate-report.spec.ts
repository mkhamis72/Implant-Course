import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

test('shows placed and assisted implants with totals, and exports CSV', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const name = uniqueName('Dr Report, Jr.');
  const delegate = await seedDelegate(api, name);
  const helper = await seedDelegate(api, uniqueName('Dr Helper'));
  const stock = await seedImplantStock(api, { brand: uniqueName('Report'), qty: 2, lot: `E2E-R${Date.now()}`, expiry: null });
  await login(page, TEST_USERS.organizer.email);
  const patientName = uniqueName('Report patient');
  const patientId = await createPatientViaUi(page, { full_name: patientName });
  const me = (await api.auth.getUser()).data.user!.id;
  const today = new Date().toISOString().slice(0, 10);
  for (const [tooth, placing, assisting, technique] of [[36, delegate, helper, 'guided'], [46, helper, delegate, 'free_hand']] as const) {
    const { error } = await api.rpc('place_implant_v2', {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today,
      p_placing_delegate: placing, p_assisting_delegate: assisting, p_supervisor: me, p_technique: technique,
    });
    expect(error).toBeNull();
  }

  await page.goto(`/delegates/${delegate}`);
  await expect(page.getByTestId('report-row')).toHaveCount(2);
  await expect(page.getByTestId('report-totals')).toHaveText('Placed 1 · Assisted 1 · Failed 0 · Guided 1 · Free hand 1');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const file = await (await download).path();
  const csv = readFileSync(file!, 'utf8');
  expect(csv.startsWith('﻿Course,Patient,File,Tooth,Role')).toBe(true);
  expect(csv).toContain(patientName);
  expect(csv.split('\r\n')[0]).toContain('Technique');
  expect(csv).toContain('Guided');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
});
