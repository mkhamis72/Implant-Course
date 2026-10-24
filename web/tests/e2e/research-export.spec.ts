import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, seedRunningCourse, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);
const EXCLUDED_HEADERS = ['dob', 'notes', 'full_name', 'phone', 'file_no', 'link'];

async function downloadExport(page: Page, brand: string, label: RegExp, extra = ''): Promise<string> {
  await page.goto(`/statistics?course=all&brand=${encodeURIComponent(brand)}${extra}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Statistics & data analysis' })).toBeVisible();
  await page.getByRole('form', { name: 'Export' }).getByLabel(label).check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('form', { name: 'Export' }).getByRole('button', { name: 'Export' }).click(),
  ]);
  return (await download.path())!;
}

test('an admin exports anonymised research data as Excel and CSV, and the export log records both', async ({ page, browser }) => {
  test.slow(); // three downloads; the first compiles the export route (exceljs) in dev, ~25 s
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Exp');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-EX${Date.now()}`, expiry: null });
  const delegateName = uniqueName('Dr Exp');
  const delegate = await seedDelegate(api, delegateName);
  const me = (await api.auth.getUser()).data.user!.id;
  const course = await seedRunningCourse(api, uniqueName('Exp course'));

  await login(page, TEST_USERS.organizer.email);
  const identifiers: string[] = [course, delegate, me];
  for (const tooth of [36, 46]) {
    const name = uniqueName('Export patient');
    const stamp = `${Date.now()}${tooth}`;
    const phone = `01${stamp.slice(-9)}`;
    const fileNo = `FN${stamp}`;
    const patientId = await createPatientViaUi(page, { full_name: name, phone, file_no: fileNo, dob: '1980-05-05' });
    identifiers.push(name, phone, fileNo, patientId);
    const placed = await placeImplant(api, {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: me, p_course: course,
    });
    expect(placed.error).toBeNull();
  }

  const adminCtx = await browser.newContext({ acceptDownloads: true });
  const adminPage = await adminCtx.newPage();
  try {
    await login(adminPage, TEST_USERS.admin.email);

    // Excel
    const xlsxPath = await downloadExport(adminPage, brand, /Excel/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ['implants', 'patients', 'visits', 'radiographs', 'complications', 'restorations', 'restoration_problems', 'grafts', 'data_dictionary', 'about']) {
      expect(names).toContain(n);
    }
    const implants = wb.getWorksheet('implants')!;
    expect(implants.rowCount).toBe(3); // header + 2 implants
    expect(wb.getWorksheet('patients')!.rowCount).toBe(3); // header + 2 patients
    for (const ws of wb.worksheets.filter((w) => !['data_dictionary', 'about'].includes(w.name))) {
      const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
      for (const h of EXCLUDED_HEADERS) expect(headers, `${ws.name}.${h}`).not.toContain(h);
    }
    const texts: string[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.text ?? c.value ?? ''))));
    expect(texts.filter((t) => /^I-[A-HJ-NP-Z2-9]{6}$/.test(t)).length).toBeGreaterThanOrEqual(2);
    expect(texts.filter((t) => /^P-[A-HJ-NP-Z2-9]{6}$/.test(t)).length).toBeGreaterThanOrEqual(2);
    const xlsxAll = texts.join('\n');
    for (const id of identifiers) expect(xlsxAll).not.toContain(id);

    // Excel filtered by course and delegate: the about sheet names them by study code, never by id or name.
    const filteredPath = await downloadExport(adminPage, brand, /Excel/, `&course=${course}&delegate=${delegate}`);
    const filtered = new ExcelJS.Workbook();
    await filtered.xlsx.readFile(filteredPath);
    expect(filtered.getWorksheet('implants')!.rowCount).toBe(3);
    const filteredTexts: string[] = [];
    for (const ws of filtered.worksheets) ws.eachRow((row) => row.eachCell((c) => filteredTexts.push(String(c.text ?? c.value ?? ''))));
    const filteredAll = filteredTexts.join('\n');
    expect(filteredAll).toMatch(/C-[A-HJ-NP-Z2-9]{6}/);
    expect(filteredAll).toMatch(/D-[A-HJ-NP-Z2-9]{6}/);
    for (const id of identifiers) expect(filteredAll).not.toContain(id);

    // CSV zip
    const zipPath = await downloadExport(adminPage, brand, /CSV/);
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const entries = Object.keys(files);
    for (const n of ['implants', 'patients', 'visits', 'radiographs', 'complications', 'restorations', 'restoration_problems', 'grafts', 'data_dictionary']) {
      expect(entries).toContain(`${n}.csv`);
    }
    expect(entries).toContain('README.txt');
    expect(entries).toContain('analysis.R');
    const implantCsv = strFromU8(files['implants.csv']).replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(implantCsv).toHaveLength(3);
    expect(strFromU8(files['patients.csv']).replace(/^﻿/, '').trim().split(/\r?\n/)).toHaveLength(3);
    for (const n of entries.filter((e) => e.endsWith('.csv') && e !== 'data_dictionary.csv')) {
      const headers = strFromU8(files[n]).replace(/^﻿/, '').split(/\r?\n/)[0].split(',');
      for (const h of EXCLUDED_HEADERS) expect(headers, `${n}.${h}`).not.toContain(h);
    }
    const csvAll = entries.map((e) => strFromU8(files[e])).join('\n');
    expect(csvAll).toMatch(/P-[A-HJ-NP-Z2-9]{6}/);
    for (const id of identifiers) expect(csvAll).not.toContain(id);

    // Export log
    await adminPage.goto("/statistics/exports");
    const logRows = adminPage.getByRole('region', { name: 'Recent exports' }).locator('tbody tr').filter({ hasText: brand });
    await expect(logRows).toHaveCount(3);
    await expect(logRows.filter({ hasText: delegateName })).toHaveCount(1);
    await expect(adminPage.getByRole('region', { name: 'Recent exports' })).not.toContainText(delegate);
  } finally {
    await adminCtx.close();
  }
});
