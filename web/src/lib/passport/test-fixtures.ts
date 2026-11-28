// Passport test data: the "large patient" of Review Focus 2 (16 implants with components and replaced parts,
// two full-arch cases, Arabic name and lab) and the "nothing recorded" patient of Review Focus 4.
// Used by the document tests and the visual check; never imported by the app.
import { crc32, deflateSync } from 'node:zlib';
import type { ImplantSite, Product, SiteComponent } from '@/lib/inventory/types';
import type { ImplantGraft } from '@/lib/implants/surgery';
import type { Restoration } from '@/lib/restorations/restorations';
import type { FullArchCase } from '@/lib/full-arch/cases';
import type { MedicalHistory } from '@/lib/patients/types';
import type { PassportData } from './model';

export const product = (o: Partial<Product> = {}): Product => ({
  id: 'p-impl', type: 'implant', category: 'surgical', brand: 'Oxy', system: 'PSK-MDK · PSK Micro', platform: '',
  diameter_mm: 4, length_mm: 10, ref_code: 'OXY-4010', description: '', reorder_level: 0, active: true, is_sample: false,
  connection: 'Conical', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '',
  driver_ref: '', torque_ncm: null, implant_kind: 'conventional', ...o,
});

export const comp = (o: Partial<SiteComponent> = {}): SiteComponent => ({
  id: 'c', component_type: 'healing_abutment', fitted_on: '2026-10-01', removed_on: null, notes: '', product: null,
  lot: null, fitted_by_delegate: null, fitted_by_organizer: null, course_id: null, voided_at: null, voided_reason: '',
  torque_ncm: null, holds_component_id: null, holds_restoration_id: null, replaced_by: null, screw_size: null, stock_lot_id: null, ...o,
});

export const site = (o: Partial<ImplantSite> = {}): ImplantSite => ({
  id: 's', tooth: 36, state: 'placed', technique: null, impression_type: null, impression_taken_on: null,
  placed_on: '2026-09-01', implant_type: 'conventional', angulation_deg: null, angulation_direction: null, anchorage: null,
  entry_point: '', trajectory: '', planned_product: null, planned_product_id: null, case_id: null, stock_lot_id: null,
  torque_ncm: null, isq: null, bone_type: null, graft: '', notes: '', product: product(), lot: null,
  placing_delegate_id: null, placing_doctor_id: null, doctor: null, assisting_delegate_id: null, supervisor_id: null,
  course_id: null, placing: null, assisting: null, supervisor: null, components: [], followups: [], surgery: null,
  grafts: [], updated_at: '2026-09-01T10:00:00Z', failed_on: null, failure_type: null, failure_reason: null,
  failure_notes: '', complications: [], slot: null, created_at: '2026-08-01T10:00:00Z', ...o,
});

export const resto = (o: Partial<Restoration> = {}): Restoration => ({
  id: 'r', stage: 'final', type: 'single_crown', teeth: [36], fitted_on: '2026-10-20', retention: 'screw',
  material: 'zirconia', delegate_id: null, supervisor_id: null, course_id: null, notes: '', ended_on: null,
  end_kind: null, end_reason: null, updated_at: '', case_id: null, site_ids: ['s'], problems: [], ...o,
});

export const kase = (o: Partial<FullArchCase> = {}): FullArchCase => ({
  id: 'k1', arch: 'upper', configuration: 'all_on_4', name: '', notes: '', closed_at: null, close_reason: null,
  updated_at: '', stages: [], ...o,
});

export const history = (o: Partial<MedicalHistory> = {}): MedicalHistory => ({
  patient_id: 'pt', allergies: '', medications: '', smoking: null, cigarettes_per_day: null, diabetes_status: null,
  hba1c: null, hba1c_date: null, bisphosphonates_status: null, anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
  other_conditions: '', notes: '', updated_at: '', ...o,
});

const graft = (o: Partial<ImplantGraft>): ImplantGraft => ({
  id: 'g', site_id: 's', procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: null, product: '',
  membrane: null, notes: '', created_at: '2026-09-01T10:00:00Z', ...o,
} as ImplantGraft);

export const ARABIC_NAME = 'سارة محمود حسن علي';
export const ARABIC_LAB = 'معمل النيل للأسنان';

/** A patient with nothing recorded: no medical history, implants, restorations or cases. */
export function emptyPassportData(o: Partial<PassportData> = {}): PassportData {
  return {
    patient: { id: 'pt', file_no: 'P00007', full_name: 'Omar Fathy', dob: null, sex: null },
    medicalHistory: null,
    sites: [],
    restorations: [],
    cases: [],
    branding: { name: 'Kaleidoscope Dental Academy', logo: null },
    features: ['inventory', 'statistics', 'teaching'],
    medicalLevel: 'allergies_medications',
    ...o,
  };
}

// ── Parts ──────────────────────────────────────────────────────────────────────────────────────────────

const part = (type: Product['type'], o: Partial<Product>): Product => product({
  id: `p-${type}-${o.ref_code ?? ''}`, type, category: 'prosthetic', diameter_mm: null, length_mm: null, implant_kind: 'conventional',
  driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'OXY-DRV125', ...o,
});

const HEALING = part('healing_abutment', { system: 'PSK-MDK', ref_code: 'OXY-HA45', gingival_height_mm: 4, material: 'Titanium' });
const MUA = part('multi_unit', { system: 'PSK-MDK', ref_code: 'OXY-MUA30', gingival_height_mm: 3, angle_deg: 30, material: 'Titanium', torque_ncm: 30 });
const MUA0 = part('multi_unit', { system: 'PSK-MDK', ref_code: 'OXY-MUA00', gingival_height_mm: 2, angle_deg: 0, material: 'Titanium', torque_ncm: 30 });
const ABUT = part('abutment_angled', { system: 'PSK-MDK', ref_code: 'OXY-AB15', gingival_height_mm: 2, angle_deg: 15, material: 'Titanium', torque_ncm: 25 });
const AB_SCREW = part('abutment_screw', { system: 'PSK-MDK', ref_code: 'OXY-AS20', material: 'Titanium alloy', torque_ncm: 25 });
const PR_SCREW = part('prosthetic_screw', { system: 'MUA', ref_code: 'OXY-PS14', material: 'Titanium alloy', driver_interface: 'Square', driver_size: '1.2 mm', driver_ref: 'OXY-SQ12', torque_ncm: 15 });
const CAP = part('healing_cap', { system: 'MUA', ref_code: 'OXY-HC48', material: 'PEEK' });

const IMPLANT = product();
const IMPLANT_L = product({ id: 'p-impl-l', diameter_mm: 4.5, length_mm: 13, ref_code: 'OXY-4513' });
const ZYGO = product({ id: 'p-zygo', system: 'Zygoma ZG', diameter_mm: 4.2, length_mm: 45, ref_code: 'OXY-ZG4245', implant_kind: 'zygomatic' });
const PTERY = product({ id: 'p-ptery', system: 'PSK-MDK', diameter_mm: 4, length_mm: 18, ref_code: 'OXY-4018', implant_kind: 'pterygoid' });

let n = 0;
const id = (prefix: string) => `${prefix}${++n}`;

/** A full-arch implant: healing replaced by a multi-unit abutment, a healing cap replaced, a prosthetic screw. */
function caseParts(tooth: number, mua: Product): SiteComponent[] {
  return [
    comp({ id: id('c'), component_type: 'healing_abutment', product: HEALING, fitted_on: '2026-06-02', removed_on: '2026-06-02', lot: { lot_no: `L-HA-${tooth}` } }),
    comp({ id: id('c'), component_type: 'multi_unit', product: mua, fitted_on: '2026-06-02', torque_ncm: 30, lot: { lot_no: `L-MUA-${tooth}` } }),
    comp({ id: id('c'), component_type: 'healing_cap', product: CAP, fitted_on: '2026-06-02', removed_on: '2026-06-03' }),
    comp({ id: id('c'), component_type: 'temporary_cylinder_screw', product: PR_SCREW, fitted_on: '2026-06-03', removed_on: '2026-09-10', torque_ncm: 15 }),
    comp({ id: id('c'), component_type: 'prosthetic_screw', product: PR_SCREW, fitted_on: '2026-09-10', torque_ncm: 15, lot: { lot_no: `L-PS-${tooth}` } }),
  ];
}

/** A single implant: healing abutment replaced, abutment with its screw, crown screw. */
function singleParts(tooth: number): SiteComponent[] {
  return [
    comp({ id: id('c'), component_type: 'cover_screw', fitted_on: '2026-03-10', removed_on: '2026-06-01' }),
    comp({ id: id('c'), component_type: 'healing_abutment', product: HEALING, fitted_on: '2026-06-01', removed_on: '2026-07-01', lot: { lot_no: `L-HA-${tooth}` } }),
    comp({ id: id('c'), component_type: 'abutment', product: ABUT, fitted_on: '2026-07-01', torque_ncm: 25, lot: { lot_no: `L-AB-${tooth}` } }),
    comp({ id: id('c'), component_type: 'abutment_screw', product: AB_SCREW, fitted_on: '2026-07-01', torque_ncm: 25 }),
    comp({ id: id('c'), component_type: 'prosthetic_screw', product: PR_SCREW, fitted_on: '2026-07-20', torque_ncm: 15 }),
  ];
}

/** Review Focus 2: 16 implants with 4–6 components each (incl. replaced ones), 2 full-arch cases, Arabic text. */
export function largePassportData(o: Partial<PassportData> = {}): PassportData {
  n = 0;
  const doctor = { name: 'Dr. Hassan Mostafa' };
  const upperCase = 'k-upper';
  const lowerCase = 'k-lower';
  const upper: ImplantSite[] = [
    site({ id: 'u18', tooth: 18, implant_type: 'pterygoid', product: PTERY, angulation_deg: 45, angulation_direction: 'distal', anchorage: 'pterygoid_plate', entry_point: 'Tuberosity', trajectory: 'Towards the pterygoid plate', torque_ncm: 50, isq: 70, case_id: upperCase, components: caseParts(18, MUA) }),
    site({ id: 'u16', tooth: 16, implant_type: 'zygomatic', product: ZYGO, angulation_deg: 45, angulation_direction: 'distal', anchorage: 'zygoma', entry_point: 'Palatal of 16', trajectory: 'Extra-sinus', torque_ncm: 45, isq: 72, case_id: upperCase, components: caseParts(16, MUA) }),
    site({ id: 'u12', tooth: 12, product: IMPLANT, torque_ncm: 40, isq: 68, case_id: upperCase, components: caseParts(12, MUA0), grafts: [graft({ procedure: 'socket_preservation', material: 'xenograft' })] }),
    site({ id: 'u22', tooth: 22, product: IMPLANT, torque_ncm: 40, isq: 69, case_id: upperCase, components: caseParts(22, MUA0) }),
    site({ id: 'u26', tooth: 26, implant_type: 'zygomatic', product: ZYGO, angulation_deg: 50, angulation_direction: 'distal', anchorage: 'zygoma', entry_point: 'Palatal of 26', trajectory: 'Extra-sinus', torque_ncm: 45, isq: 71, case_id: upperCase, components: caseParts(26, MUA) }),
    site({ id: 'u28', tooth: 28, implant_type: 'pterygoid', product: PTERY, angulation_deg: 45, angulation_direction: 'distal', anchorage: 'pterygoid_plate', entry_point: 'Tuberosity', trajectory: '', torque_ncm: 50, isq: 68, case_id: upperCase, components: caseParts(28, MUA) }),
  ].map((s) => ({ ...s, placed_on: '2026-06-01', doctor, lot: { lot_no: `L-IMP-${s.tooth}`, expiry: null } }));
  const lower: ImplantSite[] = [
    site({ id: 'l45', tooth: 45, implant_type: 'tilted', product: IMPLANT_L, angulation_deg: 30, angulation_direction: 'distal', torque_ncm: 45, isq: 74, case_id: lowerCase, components: caseParts(45, MUA) }),
    site({ id: 'l42', tooth: 42, product: IMPLANT, torque_ncm: 40, isq: 70, case_id: lowerCase, components: caseParts(42, MUA0) }),
    site({ id: 'l32', tooth: 32, product: IMPLANT, torque_ncm: 40, isq: 71, case_id: lowerCase, components: caseParts(32, MUA0) }),
    site({ id: 'l35', tooth: 35, implant_type: 'tilted', product: IMPLANT_L, angulation_deg: 30, angulation_direction: 'distal', torque_ncm: 45, isq: 73, case_id: lowerCase, components: caseParts(35, MUA) }),
  ].map((s) => ({ ...s, placed_on: '2026-06-01', placing: { full_name: 'Dr. Mona Adel' }, lot: { lot_no: `L-IMP-${s.tooth}`, expiry: null } }));
  const singles: ImplantSite[] = [
    site({ id: 's36', tooth: 36, state: 'restored', product: IMPLANT_L, placed_on: '2026-03-10', torque_ncm: 35, isq: 66, doctor, components: singleParts(36), surgery: { torque_type: 'peak' } as ImplantSite['surgery'], grafts: [graft({ procedure: 'gbr', material: 'combination' })] }),
    site({ id: 's37', tooth: 37, state: 'restored', product: IMPLANT_L, placed_on: '2026-03-10', torque_ncm: 35, isq: null, doctor, components: singleParts(37) }),
    site({ id: 's46', tooth: 46, state: 'restored', product: IMPLANT, planned_product: IMPLANT_L, placed_on: '2026-03-12', torque_ncm: null, isq: 64, doctor, components: singleParts(46) }),
    site({ id: 's47', tooth: 47, state: 'placed', product: IMPLANT, placed_on: '2026-10-02', torque_ncm: 30, isq: 60, doctor, components: singleParts(47).slice(0, 2) }),
    site({ id: 's38', tooth: 38, state: 'planned', product: null, planned_product: IMPLANT, placed_on: null }),
    site({ id: 's48', tooth: 48, state: 'failed', product: IMPLANT, placed_on: '2026-03-12', failed_on: '2026-05-01', torque_ncm: 20, doctor, components: [comp({ id: id('c'), component_type: 'healing_abutment', product: HEALING, fitted_on: '2026-03-12', removed_on: '2026-05-01' }), comp({ id: id('c'), component_type: 'cover_screw', fitted_on: '2026-03-12', removed_on: '2026-03-12' }), comp({ id: id('c'), component_type: 'healing_abutment', product: HEALING, fitted_on: '2026-03-12', removed_on: '2026-05-01' }), comp({ id: id('c'), component_type: 'healing_cap', product: CAP, fitted_on: '2026-03-12', removed_on: '2026-05-01' })] }),
  ];
  const sites = [...upper, ...lower, ...singles];
  const restorations: Restoration[] = [
    resto({ id: 'r-u-t', stage: 'temporary', type: 'full_arch', teeth: [18, 28], site_ids: upper.map((s) => s.id), fitted_on: '2026-06-03', case_id: upperCase, material: 'pmma_acrylic', ended_on: '2026-09-10', end_kind: 'replaced' }),
    resto({ id: 'r-u-f', stage: 'final', type: 'full_arch', teeth: [17, 27], site_ids: upper.map((s) => s.id), fitted_on: '2026-09-10', case_id: upperCase, material: 'zirconia' }),
    resto({ id: 'r-l-t', stage: 'temporary', type: 'full_arch', teeth: [35, 45], site_ids: lower.map((s) => s.id), fitted_on: '2026-06-03', case_id: lowerCase, material: 'pmma_acrylic' }),
    resto({ id: 'r36', type: 'bridge', teeth: [36, 37], site_ids: ['s36', 's37'], fitted_on: '2026-07-20', material: 'metal_ceramic', retention: 'screw', ended_on: '2026-10-01', end_kind: 'remade' }),
    resto({ id: 'r36b', type: 'bridge', teeth: [36, 37], site_ids: ['s36', 's37'], fitted_on: '2026-10-01', material: 'zirconia', retention: 'screw' }),
    resto({ id: 'r46', type: 'single_crown', teeth: [46], site_ids: ['s46'], fitted_on: '2026-07-22', material: 'lithium_disilicate', retention: 'cement' }),
  ];
  const cases: FullArchCase[] = [
    kase({
      id: upperCase, arch: 'upper', configuration: 'all_on_6', name: 'Zygomatic quad with pterygoids', stages: [
        { stage: 'scan', done_on: '2026-08-01', lab: null, passive_fit: null, occlusion: null, notes: '' },
        { stage: 'lab_design', done_on: '2026-08-15', lab: ARABIC_LAB, passive_fit: null, occlusion: null, notes: '' },
        { stage: 'try_in', done_on: '2026-08-30', lab: null, passive_fit: true, occlusion: null, notes: '' },
      ],
    }),
    kase({
      id: lowerCase, arch: 'lower', configuration: 'all_on_4', name: '', stages: [
        { stage: 'scan', done_on: '2026-10-01', lab: null, passive_fit: null, occlusion: null, notes: '' },
        { stage: 'lab_design', done_on: '2026-10-20', lab: 'Cairo Dental Lab', passive_fit: null, occlusion: null, notes: '' },
      ],
    }),
  ];
  return {
    patient: { id: 'pt', file_no: 'P00123', full_name: ARABIC_NAME, dob: '1962-04-17', sex: 'female' },
    medicalHistory: history({
      allergies: 'Penicillin (rash); latex', medications: 'Metformin 500 mg twice daily; أسبرين ٨١ مجم', diabetes_status: 'yes',
      hba1c: 6.8, hba1c_date: '2026-05-10', smoking: 'former', other_conditions: 'Controlled hypertension',
    } as Partial<MedicalHistory>),
    sites,
    restorations,
    cases,
    branding: { name: 'Kaleidoscope Dental Academy', logo: `data:image/png;base64,${Buffer.from(logoPng()).toString('base64')}` },
    features: ['inventory', 'statistics', 'teaching'],
    medicalLevel: 'full',
    ...o,
  };
}

// ── A small PNG logo (a teal ring), built here so the fixture needs no binary file ─────────────────────

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function logoPng(size = 96): Uint8Array {
  const rows: Buffer[] = [];
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5);
      const on = (d < c - 2 && d > c - 14) || (Math.abs(x - c) < 6 && d < c - 20);
      const [r, g, b] = on ? [15, 118, 110] : [255, 255, 255];
      row.writeUInt8(r, 1 + x * 3);
      row.writeUInt8(g, 2 + x * 3);
      row.writeUInt8(b, 3 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}
