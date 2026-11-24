/**
 * Every English word the Implant Passport prints, in one place so an Arabic passport can be added later.
 * Enum values (implant types, component roles, restoration kinds …) take their labels from the modules that own them;
 * this file holds the passport's own headings, field names and copy. The copy marked "exact" is fixed by the plan.
 */
export const PASSPORT_LABELS = {
  // Exact copy (plan, Global Constraints).
  title: 'Implant Passport',
  notRecorded: 'Not recorded',
  noneRecorded: 'None recorded',
  chartNote: 'Schematic drawing — not a substitute for CBCT or 3D planning.',
  footer:
    "This passport summarises the clinic's records on the date shown. It is not a manufacturer warranty or guarantee. Values not recorded are shown as 'Not recorded'.",
  staleNote: 'Records changed since this version',
  tooLarge: 'The passport is too large to store.',
  // Exact copy: Admin → Settings → Implant passport (medical content).
  medicalLevelAllergiesMedications: 'Allergies and medications only',
  medicalLevelFull: 'Full medical summary',
  medicalLevelNone: 'Nothing medical',

  // Header.
  passportNumber: 'Passport number',
  generatedOn: 'Generated on',
  page: 'Page',
  of: 'of',
  on: 'on',

  // Patient.
  patientHeading: 'Patient',
  name: 'Name',
  fileNo: 'File number',
  dob: 'Date of birth',
  sex: 'Sex',
  female: 'Female',
  male: 'Male',

  // Medical.
  medicalHeading: 'Medical alerts',
  allergies: 'Allergies',
  medications: 'Medications',
  otherConditions: 'Other conditions',
  hba1c: 'HbA1c',
  cigarettesPerDay: 'Cigarettes per day',
  yes: 'Yes',
  no: 'No',

  // Overview.
  overviewHeading: 'Overview',
  implantsPlanned: 'Implants planned',
  implantsPlaced: 'Implants placed',
  implantsRestored: 'Implants restored',
  implantsFailed: 'Implants failed',
  restorationsCurrent: 'Restorations in place',
  restorationsTotal: 'Restorations recorded',
  fullArchCases: 'Full-arch cases',

  // Implants table.
  implantsHeading: 'Implants',
  colTooth: 'Tooth',
  colType: 'Type',
  colProduct: 'Brand and system',
  colSize: 'Diameter × length',
  colConnection: 'Connection',
  colPlaced: 'Placed',
  colStatus: 'Status',
  notPlaced: 'Not placed',

  // Per implant.
  implantDetailsHeading: 'Implant details',
  implantOnTooth: 'Implant',
  product: 'Product',
  refCode: 'Ref code',
  implantKind: 'Implant type',
  angle: 'Angle and direction',
  anchorage: 'Anchorage',
  entryPoint: 'Entry point',
  trajectory: 'Trajectory',
  planned: 'Planned',
  placedOn: 'Placed on',
  placedBy: 'Placed by',
  lot: 'Lot number',
  insertionTorque: 'Insertion torque',
  isq: 'ISQ',
  grafts: 'Grafts',
  status: 'Status',
  failedOn: 'Failed on',

  // Components.
  componentsHeading: 'Components and screws',
  currentParts: 'Current parts',
  replacedParts: 'Replaced parts',
  connection: 'Connection',
  gingivalHeight: 'Gingival height',
  componentAngle: 'Angle',
  material: 'Material',
  driver: 'Screwdriver',
  recommendedTorque: 'Recommended torque',
  actualTorque: 'Actual torque',
  fittedOn: 'Fitted on',
  replacedOn: 'Replaced on',

  // Restorations.
  restorationsHeading: 'Restorations',
  restorationStage: 'Temporary / final',
  teethCovered: 'Teeth covered',
  supportingImplants: 'Supporting implants',
  retention: 'Retention',
  statusCurrent: 'Current',
  statusReplaced: 'Replaced',
  statusRemade: 'Remade',

  // Full-arch cases.
  fullArchHeading: 'Full-arch cases',
  arch: 'Arch',
  configuration: 'Configuration',
  caseImplants: 'Implants',
  temporaryBridge: 'Temporary bridge delivered',
  finalBridge: 'Final bridge delivered',
  covers: 'covers',
  stages: 'Stages',
  lab: 'Lab',
  passiveFit: 'Passive fit',
  prostheticScrews: 'Prosthetic screws',

  // Units.
  ncm: 'Ncm',
  mm: 'mm',
} as const;

export type PassportLabel = keyof typeof PASSPORT_LABELS;

/** The medical content a passport prints (passport_settings.medical, patient_passports.medical_level; 0145). */
export const MEDICAL_LEVELS = ['allergies_medications', 'full', 'none'] as const;
export type MedicalLevel = (typeof MEDICAL_LEVELS)[number];
export const MEDICAL_LEVEL_LABELS: Record<MedicalLevel, string> = {
  allergies_medications: PASSPORT_LABELS.medicalLevelAllergiesMedications,
  full: PASSPORT_LABELS.medicalLevelFull,
  none: PASSPORT_LABELS.medicalLevelNone,
};

/** "P00123-3": the patient's file number and the passport's version (exact copy). */
export function passportNumber(fileNo: string, version: number): string {
  return `${fileNo}-${version}`;
}

/** Exact copy: `Implant passport <file_no>-<version>.pdf`. */
export function passportFileName(fileNo: string, version: number): string {
  return `Implant passport ${passportNumber(fileNo, version)}.pdf`;
}
