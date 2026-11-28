import { describe, it, expect } from 'vitest';
import { passportModel, type Field, type PassportData } from './model';
import { formatDate } from '@/lib/format';
import { PASSPORT_LABELS as L, passportFileName, passportNumber } from './labels';
import type { ImplantSite, Product, SiteComponent } from '@/lib/inventory/types';
import type { Restoration } from '@/lib/restorations/restorations';
import type { FullArchCase } from '@/lib/full-arch/cases';
import type { MedicalHistory } from '@/lib/patients/types';

const NR = 'Not recorded';

const product = (o: Partial<Product> = {}): Product => ({
  id: 'p-impl', type: 'implant', category: 'surgical', brand: 'Oxy', system: 'PSK-MDK · PSK Micro', platform: '',
  diameter_mm: 4, length_mm: 10, ref_code: 'OXY-4010', description: '', reorder_level: 0, active: true, is_sample: false,
  connection: 'Conical', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '',
  driver_ref: '', torque_ncm: null, implant_kind: 'conventional', ...o,
});

const comp = (o: Partial<SiteComponent> = {}): SiteComponent => ({
  id: 'c', component_type: 'healing_abutment', fitted_on: '2026-10-01', removed_on: null, notes: '', product: null,
  lot: null, fitted_by_delegate: null, fitted_by_organizer: null, course_id: null, voided_at: null, voided_reason: '',
  torque_ncm: null, holds_component_id: null, holds_restoration_id: null, replaced_by: null, screw_size: null, stock_lot_id: null, ...o,
});

const site = (o: Partial<ImplantSite> = {}): ImplantSite => ({
  id: 's', tooth: 36, state: 'placed', technique: null, impression_type: null, impression_taken_on: null,
  placed_on: '2026-09-01', implant_type: 'conventional', angulation_deg: null, angulation_direction: null, anchorage: null,
  entry_point: '', trajectory: '', planned_product: null, planned_product_id: null, case_id: null, stock_lot_id: null,
  torque_ncm: null, isq: null, bone_type: null, graft: '', notes: '', product: product(), lot: null,
  placing_delegate_id: null, placing_doctor_id: null, doctor: null, assisting_delegate_id: null, supervisor_id: null,
  course_id: null, placing: null, assisting: null, supervisor: null, components: [], followups: [], surgery: null,
  grafts: [], updated_at: '2026-09-01T10:00:00Z', failed_on: null, failure_type: null, failure_reason: null,
  failure_notes: '', complications: [], slot: null, created_at: '2026-08-01T10:00:00Z', ...o,
});

const resto = (o: Partial<Restoration> = {}): Restoration => ({
  id: 'r', stage: 'final', type: 'single_crown', teeth: [36], fitted_on: '2026-10-20', retention: 'screw',
  material: 'zirconia', delegate_id: null, supervisor_id: null, course_id: null, notes: '', ended_on: null,
  end_kind: null, end_reason: null, updated_at: '', case_id: null, site_ids: ['s'], problems: [], ...o,
});

const kase = (o: Partial<FullArchCase> = {}): FullArchCase => ({
  id: 'k1', arch: 'upper', configuration: 'all_on_4', name: '', notes: '', closed_at: null, close_reason: null,
  updated_at: '', stages: [], ...o,
});

const history = (o: Partial<MedicalHistory> = {}): MedicalHistory => ({
  patient_id: 'pt', allergies: '', medications: '', smoking: null, cigarettes_per_day: null, diabetes_status: null,
  hba1c: null, hba1c_date: null, bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
  other_conditions: '', notes: '', updated_at: '', ...o,
});

const data = (o: Partial<PassportData> = {}): PassportData => ({
  patient: { id: 'pt', file_no: 'P00123', full_name: 'Sara Ali', dob: null, sex: null },
  medicalHistory: null,
  sites: [],
  restorations: [],
  cases: [],
  branding: { name: 'Kaleidoscope', logo: null },
  features: ['inventory', 'statistics', 'teaching'],
  medicalLevel: 'allergies_medications',
  ...o,
});

const value = (fields: Field[] | undefined, label: string) => fields?.find((f) => f.label === label)?.value;
const labelsOf = (fields: Field[] | undefined) => (fields ?? []).map((f) => f.label);

describe('labels', () => {
  it('holds the exact copy of the plan', () => {
    expect(L.title).toBe('Implant Passport');
    expect(L.notRecorded).toBe('Not recorded');
    expect(L.noneRecorded).toBe('None recorded');
    expect(L.chartNote).toBe('Schematic drawing — not a substitute for CBCT or 3D planning.');
    expect(L.footer).toBe(
      "This passport summarises the clinic's records on the date shown. It is not a manufacturer warranty or guarantee. Values not recorded are shown as 'Not recorded'.",
    );
    expect(L.staleNote).toBe('Records changed since this version');
    expect(L.tooLarge).toBe('The passport is too large to store.');
    expect([L.medicalLevelAllergiesMedications, L.medicalLevelFull, L.medicalLevelNone])
      .toEqual(['Allergies and medications only', 'Full medical summary', 'Nothing medical']);
    expect(passportNumber('P00123', 3)).toBe('P00123-3');
    expect(passportFileName('P00123', '2026-11-28')).toBe('Implant passport P00123 2026-11-28.pdf');
  });
});

describe('passportModel: header, patient, footer', () => {
  it('prints the clinic, title, passport number and the Cairo generation date', () => {
    const logo = 'data:image/png;base64,AQI=';
    const m = passportModel(data({ branding: { name: 'Kaleidoscope', logo } }), '2026-11-23T22:30:00Z', 3);
    expect(m.header.clinicName).toBe('Kaleidoscope');
    expect(m.header.logo).toBe(logo);
    expect(m.header.title).toBe('Implant Passport');
    expect(m.header.number).toBe('P00123-3');
    // 22:30 UTC on the 23rd is already the 24th in Cairo.
    expect(m.header.generatedOn).toBe('24 Nov 2026');
    expect(m.footer.note).toBe(L.footer);
  });

  it('prints name, file number, date of birth or Not recorded, and sex only when recorded', () => {
    const none = passportModel(data(), '2026-11-24', 1);
    expect(value(none.patient.fields, L.name)).toBe('Sara Ali');
    expect(value(none.patient.fields, L.fileNo)).toBe('P00123');
    expect(value(none.patient.fields, L.dob)).toBe(NR);
    expect(labelsOf(none.patient.fields)).not.toContain(L.sex);
    const full = passportModel(data({ patient: { id: 'pt', file_no: 'P1', full_name: 'X', dob: '1980-05-02', sex: 'female' } }), '2026-11-24', 1);
    expect(value(full.patient.fields, L.dob)).toBe('02 May 1980');
    expect(value(full.patient.fields, L.sex)).toBe('Female');
  });

  it('never prints contact details', () => {
    const withContacts = { ...data().patient, phone: '0100', email: 'a@b.c', address: 'Cairo' } as PassportData['patient'];
    const m = passportModel(data({ patient: withContacts }), '2026-11-24', 1);
    const text = JSON.stringify(m);
    expect(text).not.toContain('0100');
    expect(text).not.toContain('a@b.c');
    expect(text).not.toContain('Cairo');
  });

  it('passes Arabic text through unchanged', () => {
    const name = 'سارة علي حسن';
    const m = passportModel(data({
      patient: { id: 'pt', file_no: 'P1', full_name: name, dob: null, sex: null },
      branding: { name: 'عيادة النيل', logo: null },
      medicalHistory: history({ allergies: 'حساسية من البنسلين', medications: 'أسبرين ٨١ مجم' }),
      sites: [site({ doctor: { name: 'د. حسن' }, product: product({ brand: 'أوكسي' }) })],
    }), '2026-11-24', 1);
    expect(value(m.patient.fields, L.name)).toBe(name);
    expect(m.header.clinicName).toBe('عيادة النيل');
    expect(value(m.medical?.fields, L.allergies)).toBe('حساسية من البنسلين');
    expect(value(m.medical?.fields, L.medications)).toBe('أسبرين ٨١ مجم');
    expect(value(m.implants[0].fields, L.placedBy)).toBe('د. حسن');
    expect(m.implantsTable.rows[0].cells[2]).toBe('أوكسي PSK-MDK · PSK Micro');
  });
});

describe('passportModel: nothing recorded (Review Focus 4)', () => {
  it('fills every section with None recorded', () => {
    const m = passportModel(data(), '2026-11-24', 1);
    expect(m.medical).toEqual({ heading: L.medicalHeading, fields: [], empty: L.noneRecorded });
    expect(m.overview.counts.every((f) => f.value === '0')).toBe(true);
    expect(m.overview.chart).toBeNull();
    expect(m.implantsTable.rows).toEqual([]);
    expect(m.implantsTable.empty).toBe(L.noneRecorded);
    expect(m.implants).toEqual([]);
    expect(m.restorations.items).toEqual([]);
    expect(m.restorations.empty).toBe(L.noneRecorded);
    expect(m.fullArch.cases).toEqual([]);
    expect(m.fullArch.empty).toBe(L.noneRecorded);
    expect(m.footer.note).toBe(L.footer);
  });
});

describe('passportModel: medical section per level (Review Focus 5)', () => {
  const h = history({
    allergies: 'Penicillin', medications: '', diabetes_status: 'yes', hba1c: 6.8, hba1c_date: '2026-10-01',
    smoking: 'current', cigarettes_per_day: 10, bisphosphonates_status: 'no', other_conditions: 'Hypertension',
    notes: 'Prefers morning visits',
  });

  it('allergies and medications only: those two, Not recorded when empty', () => {
    const m = passportModel(data({ medicalHistory: h, medicalLevel: 'allergies_medications' }), '2026-11-24', 1);
    expect(m.medicalLevel).toBe('allergies_medications');
    expect(m.medical?.fields).toEqual([
      { label: L.allergies, value: 'Penicillin' },
      { label: L.medications, value: NR },
    ]);
    expect(m.medical?.empty).toBeNull();
  });

  it('full: the recorded medical history, Yes/No answers, Not recorded for unanswered, never the notes', () => {
    const m = passportModel(data({ medicalHistory: h, medicalLevel: 'full' }), '2026-11-24', 1);
    const f = m.medical!.fields;
    expect(value(f, L.allergies)).toBe('Penicillin');
    expect(value(f, 'Diabetes')).toBe('Yes');
    expect(value(f, L.hba1c)).toBe('6.8% (01 Oct 2026)');
    expect(value(f, 'Smoking')).toBe('Current');
    expect(value(f, L.cigarettesPerDay)).toBe('10');
    expect(value(f, 'Bisphosphonates')).toBe('No');
    expect(value(f, 'Anticoagulants')).toBe(NR);
    expect(value(f, L.otherConditions)).toBe('Hypertension');
    expect(JSON.stringify(m)).not.toContain('Prefers morning visits');
  });

  it('full with no diabetes or smoking leaves out HbA1c and cigarettes', () => {
    const m = passportModel(data({ medicalHistory: history({ diabetes_status: 'no', smoking: 'never' }), medicalLevel: 'full' }), '2026-11-24', 1);
    expect(labelsOf(m.medical?.fields)).not.toContain(L.hba1c);
    expect(labelsOf(m.medical?.fields)).not.toContain(L.cigarettesPerDay);
  });

  it('nothing medical: no section at all', () => {
    const m = passportModel(data({ medicalHistory: h, medicalLevel: 'none' }), '2026-11-24', 1);
    expect(m.medical).toBeNull();
    expect(JSON.stringify(m)).not.toContain('Penicillin');
  });
});

describe('passportModel: lot numbers follow the plan (Review Focus 5)', () => {
  const s = site({
    lot: { lot_no: 'LOT-IMPL-1', expiry: null },
    components: [comp({ id: 'h', lot: { lot_no: 'LOT-HA-1' } })],
  });

  it('prints lots with Inventory on, Not recorded when missing', () => {
    // Arch order: 46 comes before 36.
    const m = passportModel(data({ sites: [s, site({ id: 's2', tooth: 46 })] }), '2026-11-24', 1);
    expect(m.implants.map((i) => i.tooth)).toEqual([46, 36]);
    expect(value(m.implants[1].fields, L.lot)).toBe('LOT-IMPL-1');
    expect(value(m.implants[1].components!.current[0].parts[0].fields, L.lot)).toBe('LOT-HA-1');
    expect(value(m.implants[0].fields, L.lot)).toBe(NR);
  });

  it('prints no lot anywhere with Inventory off', () => {
    const m = passportModel(data({ sites: [s], features: ['teaching'] }), '2026-11-24', 1);
    expect(labelsOf(m.implants[0].fields)).not.toContain(L.lot);
    expect(JSON.stringify(m)).not.toContain('LOT-');
  });
});

describe('passportModel: implants', () => {
  it('lists implants in arch order (upper 18→28, then lower 48→38); cancelled ones left out', () => {
    const sites = [
      site({ id: 'a', tooth: 36 }), site({ id: 'b', tooth: 21 }), site({ id: 'c', tooth: 46 }),
      site({ id: 'd', tooth: 14 }), site({ id: 'e', tooth: 31 }), site({ id: 'x', tooth: 11, state: 'removed' }),
    ];
    const m = passportModel(data({ sites }), '2026-11-24', 1);
    expect(m.implantsTable.rows.map((r) => r.cells[0])).toEqual(['14', '21', '46', '31', '36']);
    expect(m.implants.map((i) => i.tooth)).toEqual([14, 21, 46, 31, 36]);
    expect(m.implantsTable.columns).toEqual([L.colTooth, L.colType, L.colProduct, L.colSize, L.colConnection, L.colPlaced, L.colStatus]);
  });

  it('table row: type, brand and system, size, connection, placed date, status', () => {
    const m = passportModel(data({ sites: [site({ implant_type: 'tilted', product: product({ connection: '' }) })] }), '2026-11-24', 1);
    expect(m.implantsTable.rows[0].cells).toEqual(['36', 'Tilted', 'Oxy PSK-MDK · PSK Micro', 'Ø4.0 × 10 mm', NR, formatDate('2026-09-01'), 'Placed']);
  });

  it('a planned implant shows its planned product and kind, Not placed, and no placement fields', () => {
    const planned = product({ id: 'p-zyg', implant_kind: 'zygomatic', diameter_mm: 4.2, length_mm: 45 });
    const m = passportModel(data({
      sites: [site({ state: 'planned', placed_on: null, implant_type: null, product: planned, planned_product: planned, planned_product_id: 'p-zyg' })],
    }), '2026-11-24', 1);
    expect(m.implantsTable.rows[0].cells).toEqual(['36', 'Zygomatic', 'Oxy PSK-MDK · PSK Micro', 'Ø4.2 × 45 mm', 'Conical', L.notPlaced, 'Planned']);
    const f = m.implants[0].fields;
    expect(labelsOf(f)).not.toContain(L.placedBy);
    expect(labelsOf(f)).not.toContain(L.insertionTorque);
    expect(labelsOf(f)).not.toContain(L.planned);
    expect(m.implants[0].components).toBeNull();
  });

  it('shows Planned: … only when the placed product differs from the plan', () => {
    const plan = product({ id: 'p-plan', diameter_mm: 3.5, length_mm: 11.5 });
    const differs = passportModel(data({ sites: [site({ planned_product: plan, planned_product_id: 'p-plan' })] }), '2026-11-24', 1);
    expect(value(differs.implants[0].fields, L.planned)).toBe('Oxy PSK-MDK · PSK Micro Ø3.5 × 11.5 mm');
    const same = passportModel(data({ sites: [site({ planned_product: product(), planned_product_id: 'p-impl' })] }), '2026-11-24', 1);
    expect(labelsOf(same.implants[0].fields)).not.toContain(L.planned);
  });

  it('detail fields of a placed implant, Not recorded when empty', () => {
    const m = passportModel(data({ sites: [site()] }), '2026-11-24', 1);
    const f = m.implants[0].fields;
    expect(m.implants[0].title).toBe('Implant 36');
    expect(value(f, L.product)).toBe('Oxy PSK-MDK · PSK Micro Ø4.0 × 10 mm');
    expect(value(f, L.refCode)).toBe('OXY-4010');
    expect(value(f, L.implantKind)).toBe('Conventional');
    expect(value(f, L.angle)).toBe(NR);
    expect(value(f, L.placedOn)).toBe(formatDate('2026-09-01'));
    expect(value(f, L.placedBy)).toBe(NR);
    expect(value(f, L.insertionTorque)).toBe(NR);
    expect(value(f, L.isq)).toBe(NR);
    expect(value(f, L.grafts)).toBe(L.noneRecorded);
    expect(value(f, L.status)).toBe('Placed');
    // Anchorage, entry point and trajectory are recorded only for zygomatic and pterygoid implants.
    expect(labelsOf(f)).not.toContain(L.anchorage);
  });

  it('detail fields with everything recorded', () => {
    const m = passportModel(data({
      sites: [site({
        tooth: 16, implant_type: 'zygomatic', angulation_deg: 45, angulation_direction: 'distal', anchorage: 'zygoma',
        entry_point: 'Palatal of 16', trajectory: '', torque_ncm: 45, isq: 72,
        surgery: { torque_type: 'peak' } as ImplantSite['surgery'],
        placing: { full_name: 'Delegate Dina' },
        grafts: [{ id: 'g', site_id: 's', procedure: 'sinus_lateral', timing: 'simultaneous', performed_on: null, material: 'xenograft', product: '', membrane: null, notes: '', created_at: '' }],
      })],
    }), '2026-11-24', 1);
    const f = m.implants[0].fields;
    expect(value(f, L.implantKind)).toBe('Zygomatic');
    expect(value(f, L.angle)).toBe('45° distal');
    expect(value(f, L.anchorage)).toBe('Zygoma');
    expect(value(f, L.entryPoint)).toBe('Palatal of 16');
    expect(value(f, L.trajectory)).toBe(NR);
    expect(value(f, L.insertionTorque)).toBe('45 Ncm (Peak)');
    expect(value(f, L.isq)).toBe('72');
    expect(value(f, L.placedBy)).toBe('Delegate Dina');
    expect(value(f, L.grafts)).toBe('Sinus lift, lateral window (Xenograft)');
  });

  it('placed by: the doctor first, then the delegate; supervisors never', () => {
    const m = passportModel(data({
      sites: [site({ doctor: { name: 'Dr Hany' }, placing: { full_name: 'Delegate Dina' }, supervisor: { full_name: 'Prof Super' } })],
    }), '2026-11-24', 1);
    expect(value(m.implants[0].fields, L.placedBy)).toBe('Dr Hany');
    expect(JSON.stringify(m)).not.toContain('Prof Super');
  });

  it('a failed implant shows its failure date', () => {
    const m = passportModel(data({ sites: [site({ state: 'failed', failed_on: '2026-10-10' })] }), '2026-11-24', 1);
    expect(value(m.implants[0].fields, L.status)).toBe('Failed');
    expect(value(m.implants[0].fields, L.failedOn)).toBe('10 Oct 2026');
  });
});

describe('passportModel: components and screws', () => {
  const abutment = product({
    id: 'p-mua', type: 'multi_unit', diameter_mm: null, length_mm: null, ref_code: 'MUA-30', connection: 'Conical',
    gingival_height_mm: 2.5, angle_deg: 30, material: 'Titanium', driver_interface: 'Hex', driver_size: '1.25 mm',
    driver_ref: 'DRV-125', torque_ncm: 25, description: 'MUA 30°',
  });
  const screw = product({ id: 'p-ps', type: 'prosthetic_screw', diameter_mm: null, length_mm: null, ref_code: 'PS-1', torque_ncm: 15, description: 'Screw' });
  const s = site({
    components: [
      comp({ id: 'old-ha', component_type: 'healing_abutment', fitted_on: '2026-09-01', removed_on: '2026-10-01', replaced_by: 'mua' }),
      comp({ id: 'voided', component_type: 'healing_abutment', fitted_on: '2026-09-02', voided_at: '2026-09-03' }),
      comp({ id: 'mua', component_type: 'multi_unit', fitted_on: '2026-10-01', product: abutment, torque_ncm: 30 }),
      comp({ id: 'ps', component_type: 'prosthetic_screw', fitted_on: '2026-10-20', product: screw, torque_ncm: 15, holds_component_id: 'mua' }),
      comp({ id: 'sb', component_type: 'scan_body', fitted_on: '2026-10-05', removed_on: '2026-10-05' }),
    ],
  });

  it('groups the current parts by role, with specs, screwdriver and both torques', () => {
    const m = passportModel(data({ sites: [s] }), '2026-11-24', 1);
    const c = m.implants[0].components!;
    expect(c.heading).toBe(L.componentsHeading);
    expect(c.current.map((g) => g.role)).toEqual(['Abutment', 'Prosthetic screw']);
    const part = c.current[0].parts[0];
    expect(part.name).toBe('Multi-unit abutment');
    expect(value(part.fields, L.product)).toBe('Oxy PSK-MDK · PSK Micro · MUA 30°');
    expect(value(part.fields, L.refCode)).toBe('MUA-30');
    expect(value(part.fields, L.connection)).toBe('Conical');
    expect(value(part.fields, L.gingivalHeight)).toBe('2.5 mm');
    expect(value(part.fields, L.componentAngle)).toBe('30°');
    expect(value(part.fields, L.material)).toBe('Titanium');
    expect(value(part.fields, L.driver)).toBe('Hex · 1.25 mm · DRV-125');
    expect(value(part.fields, L.recommendedTorque)).toBe('25 Ncm');
    expect(value(part.fields, L.actualTorque)).toBe('30 Ncm');
    expect(value(part.fields, L.fittedOn)).toBe('01 Oct 2026');
    const ps = c.current[1].parts[0];
    expect(value(ps.fields, L.driver)).toBe(NR);
    expect(value(ps.fields, L.screwSize)).toBe(NR);
  });

  const size = { label: 'M1.4 × 5', driver_interface: 'Torx', driver_size: 'T6', driver_ref: 'TX-6', torque_ncm: 20 };

  it('an abutment screw prints the screw field list in order, with product driver over the size', () => {
    const drv = product({ type: 'abutment_screw', diameter_mm: null, length_mm: null, ref_code: 'AS-1', driver_interface: 'Hex', torque_ncm: 25 });
    const m = passportModel(data({ sites: [site({ components: [comp({ component_type: 'abutment_screw', product: drv, screw_size: size, torque_ncm: 24, fitted_on: '2026-10-01' })] })] }), '2026-11-24', 1);
    const f = m.implants[0].components!.current[0].parts[0].fields;
    expect(labelsOf(f)).toEqual([L.product, L.refCode, L.screwSize, L.driver, L.recommendedTorque, L.actualTorque, L.fittedOn, L.lot]);
    expect(value(f, L.screwSize)).toBe('M1.4 × 5');
    expect(value(f, L.driver)).toBe('Hex');
    expect(value(f, L.recommendedTorque)).toBe('25 Ncm');
  });

  it('a prosthetic screw without a product prints the size screwdriver and torque; Lot follows when Inventory is on', () => {
    const m = passportModel(data({ sites: [site({ components: [comp({ component_type: 'prosthetic_screw', screw_size: size })] })] }), '2026-11-24', 1);
    const f = m.implants[0].components!.current[0].parts[0].fields;
    expect(value(f, L.product)).toBe(NR);
    expect(value(f, L.driver)).toBe('Torx · T6 · TX-6');
    expect(value(f, L.recommendedTorque)).toBe('20 Ncm');
  });

  it('an abutment keeps its full list', () => {
    const m = passportModel(data({ sites: [s] }), '2026-11-24', 1);
    const f = m.implants[0].components!.current[0].parts[0].fields;
    expect(labelsOf(f)).toEqual([L.product, L.refCode, L.connection, L.gingivalHeight, L.componentAngle, L.material, L.driver, L.recommendedTorque, L.actualTorque, L.fittedOn, L.lot]);
  });

  it('a part fitted without a product prints Not recorded for its specs', () => {
    const m = passportModel(data({ sites: [site({ components: [comp({ component_type: 'cover_screw' })] })] }), '2026-11-24', 1);
    const part = m.implants[0].components!.current[0].parts[0];
    expect(part.name).toBe('Cover screw');
    expect(value(part.fields, L.product)).toBe(NR);
    expect(value(part.fields, L.recommendedTorque)).toBe(NR);
  });

  it('lists replaced parts with their dates; voided and scan / impression parts are left out', () => {
    const m = passportModel(data({ sites: [s] }), '2026-11-24', 1);
    const replaced = m.implants[0].components!.replaced;
    expect(replaced).toHaveLength(1);
    expect(replaced[0].name).toBe('Healing abutment');
    expect(value(replaced[0].fields, L.fittedOn)).toBe(formatDate('2026-09-01'));
    expect(value(replaced[0].fields, L.replacedOn)).toBe('01 Oct 2026');
    expect(value(replaced[0].fields, L.actualTorque)).toBe(NR);
    expect(JSON.stringify(m)).not.toContain('Scan body');
  });

  it('a placed implant with no parts says None recorded', () => {
    const m = passportModel(data({ sites: [site()] }), '2026-11-24', 1);
    expect(m.implants[0].components).toEqual({ heading: L.componentsHeading, current: [], replaced: [], empty: L.noneRecorded });
  });
});

describe('passportModel: restorations', () => {
  it('prints type, stage, teeth, supporting implants (arch order), material, retention, fitted date and status', () => {
    const sites = [site({ id: 's25', tooth: 25 }), site({ id: 's15', tooth: 15 }), site({ id: 's36', tooth: 36 })];
    const restorations = [
      resto({ id: 'r1', type: 'bridge', teeth: [15, 14, 13, 12, 11, 21, 22, 23, 24, 25], site_ids: ['s25', 's15'], fitted_on: '2026-10-01' }),
      resto({ id: 'r2', stage: 'temporary', teeth: [36], site_ids: ['s36'], fitted_on: '2026-09-10', ended_on: '2026-10-20', end_kind: 'replaced', retention: null, material: null }),
      resto({ id: 'r3', teeth: [36], site_ids: ['s36'], fitted_on: '2026-10-20' }),
    ];
    const m = passportModel(data({ sites, restorations }), '2026-11-24', 1);
    expect(m.restorations.empty).toBeNull();
    const titles = m.restorations.items.map((r) => r.title);
    expect(titles).toEqual(['Single crown 36 (final)', 'Bridge 15–25 (final)', 'Single crown 36 (temporary)']);
    const bridge = m.restorations.items[1].fields;
    expect(value(bridge, L.restorationStage)).toBe('Final');
    expect(value(bridge, L.teethCovered)).toBe('15–25');
    expect(value(bridge, L.supportingImplants)).toBe('15, 25');
    expect(value(bridge, L.material)).toBe('Zirconia');
    expect(value(bridge, L.retention)).toBe('Screw-retained');
    expect(value(bridge, L.fittedOn)).toBe('01 Oct 2026');
    expect(value(bridge, L.status)).toBe('Current');
    const temp = m.restorations.items[2].fields;
    expect(value(temp, L.status)).toBe('Replaced on 20 Oct 2026');
    expect(value(temp, L.material)).toBe(NR);
    expect(value(temp, L.retention)).toBe(NR);
  });

  it('a remade final says Remade', () => {
    const m = passportModel(data({ sites: [site()], restorations: [resto({ ended_on: '2026-11-01', end_kind: 'remade' })] }), '2026-11-24', 1);
    expect(value(m.restorations.items[0].fields, L.status)).toBe('Remade on 01 Nov 2026');
  });
});

describe('passportModel: overview', () => {
  it('counts implants by status, restorations and cases, and gives the full-arch drawing', () => {
    const sites = [
      site({ id: 'a', tooth: 15, state: 'planned', placed_on: null }), site({ id: 'b', tooth: 25 }),
      site({ id: 'c', tooth: 36, state: 'restored' }), site({ id: 'd', tooth: 46, state: 'failed' }),
      site({ id: 'e', tooth: 11, state: 'removed' }),
    ];
    const restorations = [resto({ site_ids: ['c'] }), resto({ id: 'r0', ended_on: '2026-10-01', end_kind: 'replaced', site_ids: ['c'] })];
    const m = passportModel(data({ sites, restorations, cases: [kase()] }), '2026-11-24', 1);
    expect(m.overview.counts).toEqual([
      { label: L.implantsPlanned, value: '1' }, { label: L.implantsPlaced, value: '1' },
      { label: L.implantsRestored, value: '1' }, { label: L.implantsFailed, value: '1' },
      { label: L.restorationsCurrent, value: '1' }, { label: L.restorationsTotal, value: '2' },
      { label: L.fullArchCases, value: '1' },
    ]);
    const chart = m.overview.chart!;
    expect(chart.note).toBe(L.chartNote);
    // fullArchModel's output: drawn in chart order, cancelled plans left out, the one current restoration as a bridge.
    expect(chart.drawing.implants.map((i) => [i.siteId, i.planned, i.failed])).toEqual([
      ['a', true, false], ['b', false, false], ['d', false, true], ['c', false, false],
    ]);
    expect(chart.drawing.bridges).toHaveLength(1);
    expect(chart.drawing.bridges[0].implantTeeth).toEqual([36]);
  });
});


describe('passportModel: full-arch cases', () => {
  const four = [15, 12, 22, 25].map((tooth) => site({
    id: `s${tooth}`, tooth, case_id: 'k1',
    components: [comp({ id: `ps${tooth}`, component_type: 'prosthetic_screw', torque_ncm: 15, product: product({ type: 'prosthetic_screw', ref_code: `PS-${tooth}`, torque_ncm: 15, driver_interface: 'Hex' }) })],
  }));

  it('prints arch, configuration, status, implants, bridge deliveries, stages and the prosthetic screws', () => {
    const restorations = [
      resto({ id: 't', stage: 'temporary', type: 'full_arch', teeth: [15, 25], site_ids: four.map((s) => s.id), fitted_on: '2026-09-05', case_id: 'k1', ended_on: '2026-11-01', end_kind: 'replaced' }),
      resto({ id: 'f', stage: 'final', type: 'full_arch', teeth: [15, 25], site_ids: four.map((s) => s.id), fitted_on: '2026-11-01', case_id: 'k1' }),
    ];
    const k = kase({
      name: 'Upper fixed', stages: [
        { stage: 'scan', done_on: '2026-09-20', lab: null, passive_fit: null, occlusion: null, notes: '' },
        { stage: 'lab_design', done_on: '2026-10-01', lab: 'Nile Lab', passive_fit: null, occlusion: null, notes: '' },
        { stage: 'try_in', done_on: '2026-10-15', lab: null, passive_fit: true, occlusion: null, notes: '' },
      ],
    });
    const m = passportModel(data({ sites: four, restorations, cases: [k] }), '2026-11-24', 1);
    expect(m.fullArch.empty).toBeNull();
    const c = m.fullArch.cases[0];
    expect(c.title).toBe('Upper arch · Upper fixed');
    expect(value(c.fields, L.arch)).toBe('Upper arch');
    expect(value(c.fields, L.configuration)).toBe('All-on-4');
    expect(value(c.fields, L.status)).toBe('Completed');
    expect(value(c.fields, L.caseImplants)).toBe('15, 12, 22, 25');
    expect(value(c.fields, L.temporaryBridge)).toBe(formatDate('2026-09-05'));
    expect(value(c.fields, L.finalBridge)).toBe('01 Nov 2026');
    expect(c.stages).toEqual([
      { label: 'Scan / impression', value: formatDate('2026-09-20') },
      { label: 'Lab and design approved', value: '01 Oct 2026 · Lab: Nile Lab' },
      { label: 'Try-in', value: '15 Oct 2026 · Passive fit: Yes' },
    ]);
    expect(c.screws.map((p) => p.name)).toEqual(['15 · Prosthetic screw', '12 · Prosthetic screw', '22 · Prosthetic screw', '25 · Prosthetic screw']);
    expect(value(c.screws[0].fields, L.refCode)).toBe('PS-15');
    expect(labelsOf(c.screws[0].fields)).toEqual([L.product, L.refCode, L.screwSize, L.driver, L.recommendedTorque, L.actualTorque, L.fittedOn, L.lot]);
    expect(value(c.screws[0].fields, L.screwSize)).toBe(NR);
    expect(value(c.screws[0].fields, L.driver)).toBe('Hex');
    expect(value(c.screws[0].fields, L.actualTorque)).toBe('15 Ncm');
    expect(c.screwsEmpty).toBeNull();
  });

  it('a planned case: stages and bridges Not recorded, no screws', () => {
    const planned = [site({ id: 'p1', tooth: 45, state: 'planned', placed_on: null, case_id: 'k2' })];
    const m = passportModel(data({ sites: planned, cases: [kase({ id: 'k2', arch: 'lower', configuration: 'all_on_6' })] }), '2026-11-24', 1);
    const c = m.fullArch.cases[0];
    expect(c.title).toBe('Lower arch · All-on-6');
    expect(value(c.fields, L.status)).toBe('Planned');
    expect(value(c.fields, L.temporaryBridge)).toBe(NR);
    expect(value(c.fields, L.finalBridge)).toBe(NR);
    expect(c.stages.map((s) => s.value)).toEqual([NR, NR, NR]);
    expect(c.screws).toEqual([]);
    expect(c.screwsEmpty).toBe(L.noneRecorded);
  });

  it('a final that leaves implants out shows what it covers', () => {
    const restorations = [resto({ id: 'f', type: 'bridge', teeth: [15, 14, 13, 12], site_ids: ['s15', 's12'], fitted_on: '2026-11-01', case_id: 'k1' })];
    const m = passportModel(data({ sites: four, restorations, cases: [kase()] }), '2026-11-24', 1);
    expect(value(m.fullArch.cases[0].fields, L.finalBridge)).toBe('01 Nov 2026 · covers 15, 12 of 15, 12, 22, 25');
  });
});
