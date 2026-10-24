import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, placeImplant, seedDelegate, seedImplantStock, seedRunningCourse } from './api';

// Full Chromium (new headless) rather than the headless shell: it has the PDF viewer, so a signed PDF can be opened.
test.use({ channel: 'chromium' });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

/** A one-page PDF with a correct cross-reference table. */
function tinyPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 20 50 Td (Signed consent) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

/** A small real JPEG, drawn by the browser (the form decodes photos to shrink them). */
async function tinyJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#336699';
    ctx.fillRect(0, 0, 40, 30);
    return canvas.toDataURL('image/jpeg', 0.8);
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function recordConsent(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Record consent' }) });
  await form.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'English' });
  for (const item of ['treatment', 'research', 'teaching_images', 'follow_up']) {
    await form.getByTestId(`consent-item-${item}`).getByLabel('Yes').check();
  }
  await form.getByLabel(/Signed form/).setInputFiles(file);
  await form.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByTestId('current-consent')).toBeVisible();
}

async function voidCurrent(page: Page) {
  const current = page.getByTestId('current-consent');
  await current.getByRole('button', { name: 'Void' }).click();
  await current.getByLabel('Reason for voiding').fill('Wrong patient');
  await current.getByRole('button', { name: 'Void record' }).click();
  await expect(page.getByText('No current consent record.')).toBeVisible();
}

test('prints the consent form, records signed forms (JPEG and PDF), voids them, the research page warns, and admins manage the form', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Consent');
  const stock = await seedImplantStock(api, { brand, qty: 1, lot: `E2E-CN${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Consent'));
  const courseName = uniqueName('Consent course');
  const course = await seedRunningCourse(api, courseName);
  const me = (await api.auth.getUser()).data.user!.id;

  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Consent patient');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const placed = await placeImplant(api, {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
    p_placing_delegate: delegate, p_supervisor: me, p_technique: 'guided', p_course: course,
  });
  expect(placed.error).toBeNull();

  // 1. Print the prefilled form in English, then pick the patient's course; Arabic prints right to left.
  await page.goto(`/patients/${patientId}/consent`);
  await expect(page.getByTestId('no-consent-badge')).toBeVisible();
  await page.getByRole('link', { name: 'Print the form in English' }).click();
  await expect(page).toHaveURL(/\/consent\/print\?lang=en/);
  const doc = page.getByTestId('consent-document');
  await expect(doc).toContainText(`Patient name: ${name}`);
  await expect(doc).toContainText('Course: __________');
  await expect(doc).toContainText(/Form version v\d+ · effective/);
  await page.getByRole('combobox', { name: 'Course' }).selectOption({ label: courseName });
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(doc).toContainText(`Course: ${courseName}`);
  await page.goto(`/patients/${patientId}/consent/print?lang=ar&course=${course}`);
  await expect(doc).toHaveAttribute('dir', 'rtl');
  await expect(doc).toContainText(name);

  // 2–3. Record a consent with a photo: the badge goes, and the signed form is served as a JPEG.
  await page.goto(`/patients/${patientId}/consent`);
  await recordConsent(page, { name: 'signed.jpg', mimeType: 'image/jpeg', buffer: await tinyJpeg(page) });
  await page.reload();
  await expect(page.getByTestId('no-consent-badge')).toHaveCount(0);
  const jpegHref = await page.getByTestId('current-consent').getByRole('link', { name: /View signed form/ }).getAttribute('href');
  const jpeg = await page.request.get(jpegHref!);
  expect(jpeg.status()).toBe(200);
  expect(jpeg.headers()['content-type']).toBe('image/jpeg');

  // 4. Void it: the badge returns.
  await voidCurrent(page);
  await page.reload();
  await expect(page.getByTestId('no-consent-badge')).toBeVisible();

  // A signed PDF opens in the browser's PDF viewer (not blocked by the page's security headers).
  await recordConsent(page, { name: 'signed.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
  const pdfHref = await page.getByTestId('current-consent').getByRole('link', { name: /View signed form/ }).getAttribute('href');
  const viewer = await page.context().newPage();
  const blocked: string[] = [];
  viewer.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text()); });
  const response = await viewer.goto(pdfHref!);
  expect(response!.status()).toBe(200);
  expect(response!.headers()['content-type']).toBe('application/pdf');
  // Chrome's viewer runs in an extension frame; a thumbnail per page appears only once the document has loaded.
  await expect.poll(() => viewer.frames().some((f) => f.url().startsWith('chrome-extension://'))).toBe(true);
  const pdfViewer = viewer.frames().find((f) => f.url().startsWith('chrome-extension://'))!;
  await expect(pdfViewer.locator('viewer-thumbnail')).toHaveCount(1);
  expect(blocked).toEqual([]);
  await viewer.close();
  await voidCurrent(page);

  // Organizers can't open the consent settings.
  await page.goto('/admin/settings/consent');
  await expect(page).not.toHaveURL(/\/admin\/settings\/consent/);

  // 5. The research page warns that this patient has no research consent on file.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  try {
    await login(adminPage, TEST_USERS.admin.email);
    await adminPage.goto(`/statistics?brand=${encodeURIComponent(brand)}`);
    await expect(adminPage.getByText('⚠ 1 of 1 patients have no research consent on file (1 not recorded, 0 refused)')).toBeVisible();

    // Admin → Settings → Consent: the signed version is locked; the blank form prints in Arabic.
    await adminPage.goto('/admin/settings');
    await adminPage.getByRole('link', { name: 'Consent form settings' }).click();
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Consent form' })).toBeVisible();
    const current = adminPage.locator('details').filter({ has: adminPage.locator('summary', { hasText: 'Current' }) });
    await current.locator('summary').click();
    await expect(current.getByRole('textbox', { name: 'Label' })).toBeDisabled();
    await expect(current.getByText("This form version has been signed by patients and can't be changed. Add a new version instead.")).toBeVisible();
    await adminPage.getByRole('link', { name: 'Print a blank form in Arabic' }).click();
    const blank = adminPage.getByTestId('consent-document');
    await expect(blank).toHaveAttribute('dir', 'rtl');
    await expect(blank).toContainText('__________');
  } finally {
    await adminCtx.close();
  }
});

