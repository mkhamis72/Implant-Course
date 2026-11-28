import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, placeImplant, seedDelegate, seedImplantStock, seedRunningCourse } from './api';

const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const TEETH = [15, 12, 22, 25];
const TILTED = [15, 25];
const ARCH = [15, 14, 13, 12, 11, 21, 22, 23, 24, 25];

test('Statistics: zygomatic vs tilted, the Full arch tab and the full_arch_cases export', async ({ page, browser }) => {
  test.slow(); // the export route compiles exceljs in dev
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('FA stats');
  const stock = await seedImplantStock(api, { brand, qty: 5, lot: `E2E-FS${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr FA stats'));
  const course = await seedRunningCourse(api, uniqueName('FA stats course'));
  const me = (await api.auth.getUser()).data.user!.id;
  const place = async (patient: string, tooth: number) => {
    const { data, error } = await placeImplant(api, {
      p_patient: patient, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: cairoToday(),
      p_placing_delegate: delegate, p_supervisor: me, p_course: course,
    });
    expect(error).toBeNull();
    return data as string;
  };
  const geometry = async (site: string, type: string, angle: number | null, direction: string | null, anchorage: string | null) => {
    const { error } = await api.rpc('set_implant_geometry', {
      p_site: site, p_type: type, p_angulation: angle, p_direction: direction, p_anchorage: anchorage, p_entry: '', p_trajectory: '',
    });
    expect(error).toBeNull();
  };

  await login(page, TEST_USERS.organizer.email);
  // An All-on-4: two tilted (15, 25) and two straight implants, one case, a final bridge over all four.
  const arch = await createPatientViaUi(page, { full_name: uniqueName('FA stats arch') });
  const sites: string[] = [];
  for (const tooth of TEETH) {
    const site = await place(arch, tooth);
    sites.push(site);
    await geometry(site, TILTED.includes(tooth) ? 'tilted' : 'conventional', TILTED.includes(tooth) ? 30 : null, TILTED.includes(tooth) ? 'distal' : null, null);
  }
  const kase = await api.rpc('create_full_arch_case', {
    p_patient: arch, p_arch: 'upper', p_configuration: 'all_on_4', p_name: '', p_notes: '', p_sites: sites,
  });
  expect(kase.error).toBeNull();
  const bridge = await api.rpc('add_restoration', {
    p_patient: arch, p_stage: 'final', p_type: 'full_arch', p_sites: sites, p_teeth: ARCH, p_fitted_on: cairoToday(),
    p_retention: 'screw', p_material: null, p_delegate: delegate, p_supervisor: null, p_course: course, p_remake_reason: null, p_notes: null,
  });
  expect(bridge.error).toBeNull();
  // A zygomatic implant on another patient.
  const zygPatient = await createPatientViaUi(page, { full_name: uniqueName('FA stats zyg') });
  await geometry(await place(zygPatient, 14), 'zygomatic', null, null, 'zygoma');

  // The test organizer has no Research view: the admin reads Statistics.
  const adminCtx = await browser.newContext({ acceptDownloads: true });
  const adminPage = await adminCtx.newPage();
  try {
    await login(adminPage, TEST_USERS.admin.email);
    const q = `course=all&brand=${encodeURIComponent(brand)}`;

    // Results: Zygomatic vs tilted (All-on-4).
    await adminPage.goto(`/statistics?${q}&compare=zyg_vs_tilted`);
    const compare = adminPage.getByRole('region', { name: 'Compare groups' });
    await expect(compare.getByRole('cell', { name: /^Zygomatic/ })).toBeVisible();
    await expect(compare.getByRole('cell', { name: /^Tilted in All-on-4/ })).toBeVisible();

    // Full arch tab: the All-on-4 reached the final bridge, and its curves link opens Compare by case type.
    await adminPage.goto(`/statistics/full-arch?${q}`);
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Full arch' })).toBeVisible();
    await expect(adminPage.getByRole('navigation', { name: 'Statistics sections' }).getByRole('link', { name: 'Full arch' }))
      .toHaveAttribute('aria-current', 'page');
    const table = adminPage.getByRole('table', { name: 'Case types side by side' });
    const reached = table.getByRole('row').filter({ hasText: 'Reached the final bridge' });
    const ao4 = await table.getByRole('columnheader').allTextContents();
    await expect(reached.getByRole('cell').nth(ao4.indexOf('All-on-4'))).toHaveText('1 of 1');
    await expect(adminPage.getByRole('table', { name: 'Cases' })).toContainText('Completed');
    await adminPage.getByRole('link', { name: 'Implant survival curves' }).click();
    await expect(adminPage).toHaveURL(/\/statistics\?.*compare=case_type/);
    await expect(adminPage.getByRole('combobox', { name: 'Compare by' })).toHaveValue('case_type');
    await expect(adminPage.getByRole('combobox', { name: 'Compare by' }).locator('option:checked')).toHaveText('Full-arch case type');

    // Explore loads the implant types only for a Full arch variable: picking one in the browser reloads the page with them.
    await adminPage.goto(`/statistics/explore?${q}`);
    await adminPage.getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
    await adminPage.getByRole('combobox', { name: 'Compare by' }).selectOption('implant_type');
    await expect(adminPage).toHaveURL(/f=implant_type/);
    const byGroup = adminPage.getByRole('table', { name: 'Statistics by group' });
    await expect(byGroup.getByRole('cell', { name: /^Tilted/ })).toBeVisible();
    await expect(byGroup.getByRole('cell', { name: /^Zygomatic/ })).toBeVisible();

    // Export: a full_arch_cases sheet with the case's A- code; the implants carry type and case.
    await adminPage.goto(`/statistics?${q}`);
    await adminPage.getByRole('form', { name: 'Export' }).getByLabel(/Excel/).check();
    const [download] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.getByRole('form', { name: 'Export' }).getByRole('button', { name: 'Export' }).click(),
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await download.path())!);
    const rows = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
      return ws.getSheetValues().slice(2).filter(Boolean).map((r) => Object.fromEntries(header.map((h, i) => [h, (r as unknown[])[i + 1] ?? null])));
    };
    const cases = rows('full_arch_cases');
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ configuration: 'all_on_4', status: 'completed', implants_placed: 4, final_bridge_on: cairoToday() });
    expect(String(cases[0].case_code)).toMatch(/^A-[A-HJ-NP-Z2-9]{6}$/);
    expect(Object.keys(cases[0])).not.toContain('sites');
    expect(Object.keys(cases[0])).not.toContain('bridges');
    const implants = rows('implants');
    expect(implants).toHaveLength(5);
    expect(implants.filter((r) => r.case_code === cases[0].case_code)).toHaveLength(4);
    expect(implants.filter((r) => r.implant_type === 'tilted')).toHaveLength(2);
    expect(implants.filter((r) => r.implant_type === 'zygomatic' && r.anchorage === 'zygoma')).toHaveLength(1);
  } finally {
    await adminCtx.close();
  }
});
