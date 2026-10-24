import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, seedRunningCourse } from './api';

/** A one-page PDF with a correct xref table: the smallest file a viewer opens. */
function tinyPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('an admin records a study with a course and an approval letter, then exports for it', async ({ browser }) => {
  test.slow(); // the export route compiles exceljs in dev
  const api = await apiAs(TEST_USERS.organizer.email);
  const courseName = uniqueName('Study course');
  await seedRunningCourse(api, courseName);
  const title = uniqueName('Study');
  const notes = `Private note ${Date.now()}`;
  const brand = uniqueName('Study brand'); // no implants: the study only labels the file

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await login(page, TEST_USERS.admin.email);
    await page.goto('/statistics');
    await page.getByRole('link', { name: 'Studies' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Studies' })).toBeVisible();

    await page.getByRole('button', { name: 'Add study' }).click();
    const form = page.getByRole('form', { name: 'Add study' });
    await form.getByRole('textbox', { name: /Title/ }).fill(title);
    await form.getByRole('textbox', { name: 'Ethics committee' }).fill('Cairo University REC');
    await form.getByRole('textbox', { name: 'Approval number' }).fill('REC-2026-17');
    await form.getByRole('textbox', { name: 'Protocol version' }).fill('2.1');
    await form.getByRole('textbox', { name: 'Notes' }).fill(notes);
    await form.getByRole('checkbox', { name: courseName }).check();
    await form.getByLabel(/Approval letter/).setInputFiles({ name: 'approval.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
    await form.getByRole('button', { name: 'Save study' }).click();

    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(card).toContainText(courseName);
    await expect(card).toContainText('REC-2026-17');

    // The letter opens inline as the PDF that was uploaded.
    const href = await card.getByRole('link', { name: /Approval letter/ }).getAttribute('href');
    const letter = await page.request.get(href!);
    expect(letter.status()).toBe(200);
    expect(letter.headers()['content-type']).toBe('application/pdf');
    expect(letter.headers()['content-disposition']).toBe('inline');
    expect((await letter.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Export for the study: the about sheet names it (never the notes).
    await page.goto(`/statistics?brand=${encodeURIComponent(brand)}`);
    const exportForm = page.getByRole('form', { name: 'Export' });
    await exportForm.getByRole('combobox', { name: 'Study' }).selectOption({ label: title });
    await exportForm.getByLabel(/Excel/).check();
    const [download] = await Promise.all([page.waitForEvent('download'), exportForm.getByRole('button', { name: 'Export' }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await download.path())!);
    const about = wb.getWorksheet('about')!.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1).map(String));
    expect(about).toContainEqual(['Study', title]);
    expect(about).toContainEqual(['Ethics committee', 'Cairo University REC']);
    expect(about).toContainEqual(['Approval number', 'REC-2026-17']);
    expect(about).toContainEqual(['Protocol version', '2.1']);
    const texts: string[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.text ?? c.value ?? ''))));
    expect(texts.join('\n')).not.toContain(notes);

    // Recent exports names the study by title; once exported it can no longer be deleted.
    await page.goto(`/statistics?brand=${encodeURIComponent(brand)}`);
    await expect(page.getByRole('region', { name: 'Recent exports' }).locator('tbody tr').filter({ hasText: brand }).first()).toContainText(`study ${title}`);
    await page.goto('/statistics/studies');
    const exported = page.locator('article').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(exported).toContainText('Named on an export');
    await expect(exported.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
