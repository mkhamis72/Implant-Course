import { formatDate } from '@/lib/format';
import { featureOn, type Feature } from '@/lib/modules/modules';
import { fmtMm, productLabel } from '@/lib/inventory/labels';
import { badgesFor, componentRole } from '@/lib/inventory/components';
import {
  ANCHORAGE_LABELS, ANGULATION_DIRECTION_LABELS, COMPONENT_LABELS, COMPONENT_ROLE_LABELS, IMPLANT_KIND_LABELS,
  IMPLANT_TYPE_LABELS, SITE_STATE_LABELS,
  type ComponentRole, type ImplantSite, type Product, type SiteComponent,
} from '@/lib/inventory/types';
import { isAnchored, typeLabels } from '@/lib/patients/implant-type';
import { CHART_ORDER } from '@/lib/patients/fdi';
import { RISK_QUESTIONS } from '@/lib/patients/risk-factors';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { GRAFT_MATERIAL_LABELS, GRAFT_PROCEDURE_LABELS, TORQUE_TYPE_LABELS } from '@/lib/implants/surgery';
import {
  MATERIAL_LABELS, RESTORATION_TYPE_LABELS, RETENTION_LABELS, STAGE_LABELS,
  describeTeeth, isCurrent, restorationLabel, restorationSpans, type Restoration,
} from '@/lib/restorations/restorations';
import {
  ARCH_LABELS, CASE_STAGES, CASE_STAGE_LABELS, CASE_STATUS_LABELS, CONFIGURATION_LABELS,
  caseBridges, caseStatus, caseTitle, type FullArchCase,
} from '@/lib/full-arch/cases';
import { fullArchModel } from '@/components/full-arch/model';
import { PASSPORT_LABELS as L, passportNumber, type MedicalLevel } from './labels';

// ── Input ──────────────────────────────────────────────────────────────────────────────────────────────

/** What the passport prints from the medical history (the internal `notes` field is never printed). */
export type PassportMedicalHistory = Omit<MedicalHistory, 'patient_id' | 'notes' | 'updated_at'> & { notes?: string };

/** Everything loadPassportData reads, with the user's own client (RLS applies). */
export type PassportData = {
  /** No contact details: they are never printed. */
  patient: Pick<Patient, 'id' | 'file_no' | 'full_name' | 'dob' | 'sex'>;
  medicalHistory: PassportMedicalHistory | null;
  /** In the shape of ChartData.sites (SITE_SELECT + sortSite + withPlannedProducts). */
  sites: ImplantSite[];
  /** Voided ones already left out. */
  restorations: Restoration[];
  cases: FullArchCase[];
  branding: { name: string; logo: { bytes: Uint8Array; contentType: string } | null };
  /** The company's plan (Profile.features): lot numbers print only with Inventory. */
  features: Feature[];
  /** passport_settings_current() at generation time; stored with the passport. */
  medicalLevel: MedicalLevel;
};

// ── Output ─────────────────────────────────────────────────────────────────────────────────────────────

export type Field = { label: string; value: string };
export type Part = { name: string; fields: Field[] };
/** fullArchModel's output (implants and bridges to draw): no record fields beyond what the drawing needs. */
export type FullArchDrawing = ReturnType<typeof fullArchModel>;

export type ImplantDetail = {
  siteId: string;
  tooth: number;
  title: string;
  fields: Field[];
  /** Null for a planned implant (nothing fitted yet). */
  components: { heading: string; current: { role: string; parts: Part[] }[]; replaced: Part[]; empty: string | null } | null;
};

export type CaseDetail = { title: string; fields: Field[]; stages: Field[]; screws: Part[]; screwsEmpty: string | null };

export type PassportModel = {
  header: { clinicName: string; logo: PassportData['branding']['logo']; title: string; number: string; generatedOn: string };
  patient: { heading: string; fields: Field[] };
  /** Null with the "Nothing medical" setting: no section at all. */
  medical: { heading: string; fields: Field[]; empty: string | null } | null;
  medicalLevel: MedicalLevel;
  overview: { heading: string; counts: Field[]; chart: { drawing: FullArchDrawing; note: string } | null };
  implantsTable: { heading: string; columns: string[]; rows: { siteId: string; cells: string[] }[]; empty: string | null };
  implants: ImplantDetail[];
  restorations: { heading: string; items: { title: string; fields: Field[] }[]; empty: string | null };
  fullArch: { heading: string; cases: CaseDetail[]; empty: string | null };
  footer: { note: string };
};

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

const NR = L.notRecorded;
const text = (v: string | null | undefined) => (v && v.trim() ? v : NR);
const date = (v: string | null | undefined) => (v ? formatDate(v) : NR);
const num = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? NR : `${v}${unit}`);
const ncm = (v: number | null | undefined) => num(v, ` ${L.ncm}`);

const ARCH_INDEX = new Map<number, number>([...CHART_ORDER.upper, ...CHART_ORDER.lower].map((t, i) => [t, i]));
const archIndex = (tooth: number) => ARCH_INDEX.get(tooth) ?? 99;

/** A timestamp's date in Cairo ("YYYY-MM-DD"); a plain date is kept as it is. */
const cairoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
function cairoDate(at: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : cairoDay.format(new Date(at));
}

const isPlacedState = (s: ImplantSite) => s.state === 'placed' || s.state === 'restored' || s.state === 'failed';

/** The implant product: the placed one, else (planned) the planned one. */
const siteProduct = (s: ImplantSite): Product | null => s.product ?? s.planned_product ?? null;

function sizeOf(p: Product | null): string {
  if (!p || p.diameter_mm === null || p.length_mm === null) return NR;
  return `Ø${fmtMm(p.diameter_mm, 1)} × ${fmtMm(p.length_mm, 0)} ${L.mm}`;
}

/** The implant's type: recorded at placement, else (planned) the planned product's kind. */
function typeOf(s: ImplantSite): string {
  if (s.implant_type) return IMPLANT_TYPE_LABELS[s.implant_type];
  const p = siteProduct(s);
  return p ? IMPLANT_KIND_LABELS[p.implant_kind] : NR;
}

function angleOf(s: ImplantSite): string {
  if (s.angulation_deg === null) return NR;
  const dir = s.angulation_direction ? ` ${ANGULATION_DIRECTION_LABELS[s.angulation_direction].toLowerCase()}` : '';
  return `${s.angulation_deg}°${dir}`;
}

function driverOf(p: Product | null): string {
  if (!p) return NR;
  return text([p.driver_interface, p.driver_size, p.driver_ref].filter((v) => v && v.trim()).join(' · '));
}

// ── Sections ───────────────────────────────────────────────────────────────────────────────────────────

function medicalSection(h: PassportMedicalHistory | null, level: MedicalLevel): PassportModel['medical'] {
  if (level === 'none') return null;
  const section = (fields: Field[]) => ({ heading: L.medicalHeading, fields, empty: fields.length ? null : L.noneRecorded });
  if (!h) return section([]);
  const fields: Field[] = [
    { label: L.allergies, value: text(h.allergies) },
    { label: L.medications, value: text(h.medications) },
  ];
  let anything = !!(h.allergies?.trim() || h.medications?.trim());
  if (level === 'full') {
    for (const q of RISK_QUESTIONS) {
      const answer = h[q.key];
      if (answer !== null && answer !== undefined) anything = true;
      fields.push({ label: q.label, value: answer ? (q.options.find((o) => o.value === answer)?.label ?? NR) : NR });
      if (q.key === 'diabetes_status' && answer === 'yes') {
        fields.push({ label: L.hba1c, value: h.hba1c === null ? NR : `${h.hba1c}%${h.hba1c_date ? ` (${formatDate(h.hba1c_date)})` : ''}` });
      }
      if (q.key === 'smoking' && answer === 'current') fields.push({ label: L.cigarettesPerDay, value: num(h.cigarettes_per_day) });
    }
    fields.push({ label: L.otherConditions, value: text(h.other_conditions) });
    if (h.other_conditions?.trim()) anything = true;
  }
  return section(anything ? fields : []);
}

const isScrewRole = (c: SiteComponent) => {
  const role = componentRole(c.component_type);
  return role === 'abutment_screw' || role === 'prosthetic_screw';
};

/** A screw's fields: screwdriver and recommended torque from the product when it has them, else from the size. */
function screwFields(c: SiteComponent, lotsOn: boolean): Field[] {
  const p = c.product;
  const z = c.screw_size;
  const productDriver = !!p && [p.driver_interface, p.driver_size, p.driver_ref].some((v) => v && v.trim());
  const driver = productDriver
    ? driverOf(p)
    : z ? text([z.driver_interface, z.driver_size, z.driver_ref].filter((v) => v && v.trim()).join(' · ')) : NR;
  const torque = p?.torque_ncm != null ? p.torque_ncm : z?.torque_ncm;
  const fields: Field[] = [
    { label: L.product, value: p ? productLabel(p) : NR },
    { label: L.refCode, value: text(p?.ref_code) },
    { label: L.screwSize, value: text(z?.label) },
    { label: L.driver, value: driver },
    { label: L.recommendedTorque, value: ncm(torque) },
    { label: L.actualTorque, value: ncm(c.torque_ncm) },
    { label: L.fittedOn, value: date(c.fitted_on) },
  ];
  if (lotsOn) fields.push({ label: L.lot, value: text(c.lot?.lot_no) });
  return fields;
}

function partFields(c: SiteComponent, lotsOn: boolean): Field[] {
  if (isScrewRole(c)) return screwFields(c, lotsOn);
  const p = c.product;
  const fields: Field[] = [
    { label: L.product, value: p ? productLabel(p) : NR },
    { label: L.refCode, value: text(p?.ref_code) },
    { label: L.connection, value: text(p?.connection) },
    { label: L.gingivalHeight, value: p?.gingival_height_mm == null ? NR : `${fmtMm(p.gingival_height_mm, 0)} ${L.mm}` },
    { label: L.componentAngle, value: num(p?.angle_deg, '°') },
    { label: L.material, value: text(p?.material) },
    { label: L.driver, value: driverOf(p) },
    { label: L.recommendedTorque, value: ncm(p?.torque_ncm) },
    { label: L.actualTorque, value: ncm(c.torque_ncm) },
    { label: L.fittedOn, value: date(c.fitted_on) },
  ];
  if (lotsOn) fields.push({ label: L.lot, value: text(c.lot?.lot_no) });
  return fields;
}

/** Roles printed (scan bodies, impression copings and old crown records are not parts of the implant). */
const PART_ROLES: ComponentRole[] = ['healing', 'abutment', 'cap', 'abutment_screw', 'prosthetic_screw'];

function componentsSection(s: ImplantSite, lotsOn: boolean): ImplantDetail['components'] {
  if (!isPlacedState(s)) return null;
  const live = s.components.filter((c) => !c.voided_at && PART_ROLES.includes(componentRole(c.component_type)));
  const current = PART_ROLES.flatMap((role) => {
    const parts = live
      .filter((c) => c.removed_on === null && componentRole(c.component_type) === role)
      .map((c) => ({ name: COMPONENT_LABELS[c.component_type], fields: partFields(c, lotsOn) }));
    return parts.length ? [{ role: COMPONENT_ROLE_LABELS[role], parts }] : [];
  });
  const replaced = live.filter((c) => c.removed_on !== null).map((c) => ({
    name: COMPONENT_LABELS[c.component_type],
    fields: [
      { label: L.product, value: c.product ? productLabel(c.product) : NR },
      { label: L.actualTorque, value: ncm(c.torque_ncm) },
      { label: L.fittedOn, value: date(c.fitted_on) },
      { label: L.replacedOn, value: date(c.removed_on) },
    ],
  }));
  return {
    heading: L.componentsHeading, current, replaced,
    empty: current.length || replaced.length ? null : L.noneRecorded,
  };
}

function implantFields(s: ImplantSite, lotsOn: boolean): Field[] {
  const p = siteProduct(s);
  const fields: Field[] = [
    { label: L.product, value: p ? productLabel(p) : NR },
    { label: L.refCode, value: text(p?.ref_code) },
    { label: L.implantKind, value: typeOf(s) },
  ];
  if (!isPlacedState(s)) {
    fields.push({ label: L.status, value: SITE_STATE_LABELS[s.state] });
    return fields;
  }
  fields.push({ label: L.angle, value: angleOf(s) });
  if (isAnchored(s.implant_type)) {
    fields.push(
      { label: L.anchorage, value: s.anchorage ? ANCHORAGE_LABELS[s.anchorage] : NR },
      { label: L.entryPoint, value: text(s.entry_point) },
      { label: L.trajectory, value: text(s.trajectory) },
    );
  }
  if (s.planned_product && s.planned_product.id !== s.product?.id) {
    fields.push({ label: L.planned, value: productLabel(s.planned_product) });
  }
  fields.push(
    { label: L.placedOn, value: date(s.placed_on) },
    { label: L.placedBy, value: text(s.doctor?.name || s.placing?.full_name) },
  );
  if (lotsOn) fields.push({ label: L.lot, value: text(s.lot?.lot_no) });
  const torqueType = s.surgery?.torque_type ? ` (${TORQUE_TYPE_LABELS[s.surgery.torque_type]})` : '';
  fields.push(
    { label: L.insertionTorque, value: s.torque_ncm === null ? NR : `${s.torque_ncm} ${L.ncm}${torqueType}` },
    { label: L.isq, value: num(s.isq) },
    {
      label: L.grafts,
      value: s.grafts.length
        ? s.grafts.map((g) => `${GRAFT_PROCEDURE_LABELS[g.procedure]}${g.material ? ` (${GRAFT_MATERIAL_LABELS[g.material]})` : ''}`).join('; ')
        : L.noneRecorded,
    },
    { label: L.status, value: SITE_STATE_LABELS[s.state] },
  );
  if (s.state === 'failed') fields.push({ label: L.failedOn, value: date(s.failed_on) });
  return fields;
}

function restorationStatus(r: Restoration): string {
  if (isCurrent(r)) return L.statusCurrent;
  return `${r.end_kind === 'remade' ? L.statusRemade : L.statusReplaced} ${L.on} ${formatDate(r.ended_on!)}`;
}

function restorationsSection(restorations: Restoration[], sites: ImplantSite[]): PassportModel['restorations'] {
  const toothOf = new Map(sites.map((s) => [s.id, s.tooth]));
  const items = [...restorations]
    .sort((a, b) => b.fitted_on.localeCompare(a.fitted_on))
    .map((r) => ({
      title: restorationLabel(r),
      fields: [
        { label: L.colType, value: RESTORATION_TYPE_LABELS[r.type] },
        { label: L.restorationStage, value: STAGE_LABELS[r.stage] },
        { label: L.teethCovered, value: text(describeTeeth(r.teeth)) },
        {
          label: L.supportingImplants,
          value: text(r.site_ids.map((id) => toothOf.get(id)).filter((t): t is number => t !== undefined)
            .sort((a, b) => archIndex(a) - archIndex(b)).join(', ')),
        },
        { label: L.material, value: r.material ? MATERIAL_LABELS[r.material] : NR },
        { label: L.retention, value: r.retention ? RETENTION_LABELS[r.retention] : NR },
        { label: L.fittedOn, value: date(r.fitted_on) },
        { label: L.status, value: restorationStatus(r) },
      ],
    }));
  return { heading: L.restorationsHeading, items, empty: items.length ? null : L.noneRecorded };
}

function caseSection(c: FullArchCase, sites: ImplantSite[], restorations: Restoration[], lotsOn: boolean): CaseDetail {
  const caseSites = sites.filter((s) => s.case_id === c.id).sort((a, b) => archIndex(a.tooth) - archIndex(b.tooth));
  const bridges = caseBridges(c, sites, restorations);
  let finalBridge: string = NR;
  if (bridges.deliveredOn) finalBridge = formatDate(bridges.deliveredOn);
  else if (bridges.finals.length) {
    finalBridge = `${formatDate(bridges.finals[0].fitted_on)} · ${L.covers} ${bridges.coveredTeeth.join(', ')} ${L.of} ${bridges.neededTeeth.join(', ')}`;
  }
  const stages = CASE_STAGES.map((stage) => {
    const row = c.stages.find((s) => s.stage === stage);
    if (!row) return { label: CASE_STAGE_LABELS[stage], value: NR };
    const extra: string[] = [];
    if (stage === 'lab_design') extra.push(`${L.lab}: ${text(row.lab)}`);
    if (stage === 'try_in') extra.push(`${L.passiveFit}: ${row.passive_fit === null ? NR : row.passive_fit ? L.yes : L.no}`);
    return { label: CASE_STAGE_LABELS[stage], value: [formatDate(row.done_on), ...extra].join(' · ') };
  });
  const screws = caseSites.flatMap((s) => s.components
    .filter((x) => !x.voided_at && x.removed_on === null && componentRole(x.component_type) === 'prosthetic_screw')
    .map((x) => ({
      name: `${s.tooth} · ${COMPONENT_LABELS[x.component_type]}`,
      fields: screwFields(x, lotsOn),
    })));
  return {
    title: caseTitle(c),
    fields: [
      { label: L.arch, value: ARCH_LABELS[c.arch] },
      { label: L.configuration, value: CONFIGURATION_LABELS[c.configuration] },
      { label: L.status, value: CASE_STATUS_LABELS[caseStatus(c, sites, restorations)] },
      { label: L.caseImplants, value: text(caseSites.map((s) => s.tooth).join(', ')) },
      { label: L.temporaryBridge, value: date(bridges.temporary?.fitted_on) },
      { label: L.finalBridge, value: finalBridge },
    ],
    stages,
    screws,
    screwsEmpty: screws.length ? null : L.noneRecorded,
  };
}

// ── The model ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The printable passport: every section, in print order, with "Not recorded" / "None recorded" filled in.
 * `generatedAt` is the generation time (a timestamp, printed as its Cairo date; a plain date is kept).
 */
export function passportModel(data: PassportData, generatedAt: string, version: number): PassportModel {
  const lotsOn = featureOn(data.features, 'inventory');
  // Cancelled plans are not part of the record the patient carries.
  const sites = data.sites
    .filter((s) => s.state !== 'removed')
    .sort((a, b) => archIndex(a.tooth) - archIndex(b.tooth) || a.created_at.localeCompare(b.created_at));
  const { patient, restorations, cases } = data;

  const patientFields: Field[] = [
    { label: L.name, value: patient.full_name },
    { label: L.fileNo, value: patient.file_no },
    { label: L.dob, value: date(patient.dob) },
  ];
  if (patient.sex) patientFields.push({ label: L.sex, value: patient.sex === 'female' ? L.female : L.male });

  const count = (state: ImplantSite['state']) => String(sites.filter((s) => s.state === state).length);

  return {
    header: {
      clinicName: data.branding.name,
      logo: data.branding.logo,
      title: L.title,
      number: passportNumber(patient.file_no, version),
      generatedOn: formatDate(cairoDate(generatedAt)),
    },
    patient: { heading: L.patientHeading, fields: patientFields },
    medical: medicalSection(data.medicalHistory, data.medicalLevel),
    medicalLevel: data.medicalLevel,
    overview: {
      heading: L.overviewHeading,
      counts: [
        { label: L.implantsPlanned, value: count('planned') },
        { label: L.implantsPlaced, value: count('placed') },
        { label: L.implantsRestored, value: count('restored') },
        { label: L.implantsFailed, value: count('failed') },
        { label: L.restorationsCurrent, value: String(restorations.filter(isCurrent).length) },
        { label: L.restorationsTotal, value: String(restorations.length) },
        { label: L.fullArchCases, value: String(cases.length) },
      ],
      chart: sites.length
        ? {
          drawing: fullArchModel({ sites, spans: restorationSpans(restorations, sites), badges: badgesFor(sites), types: typeLabels(sites) }),
          note: L.chartNote,
        }
        : null,
    },
    implantsTable: {
      heading: L.implantsHeading,
      columns: [L.colTooth, L.colType, L.colProduct, L.colSize, L.colConnection, L.colPlaced, L.colStatus],
      rows: sites.map((s) => {
        const p = siteProduct(s);
        return {
          siteId: s.id,
          cells: [
            String(s.tooth),
            typeOf(s),
            p ? text([p.brand, p.system].filter(Boolean).join(' ')) : NR,
            sizeOf(p),
            text(p?.connection),
            isPlacedState(s) ? date(s.placed_on) : L.notPlaced,
            SITE_STATE_LABELS[s.state],
          ],
        };
      }),
      empty: sites.length ? null : L.noneRecorded,
    },
    implants: sites.map((s) => ({
      siteId: s.id,
      tooth: s.tooth,
      title: `${L.implantOnTooth} ${s.tooth}`,
      fields: implantFields(s, lotsOn),
      components: componentsSection(s, lotsOn),
    })),
    restorations: restorationsSection(restorations, sites),
    fullArch: {
      heading: L.fullArchHeading,
      cases: cases.map((c) => caseSection(c, sites, restorations, lotsOn)),
      empty: cases.length ? null : L.noneRecorded,
    },
    footer: { note: L.footer },
  };
}
