import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { COMPONENT_TYPES, PRODUCT_TYPES, TECHNIQUES } from './types';
import { blankToNull, optionalUuid } from '@/lib/form-values';

const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const pastDate = (message: string) => z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message });
const optionalNumber = (min: number, max: number, message: string) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).min(min, { message }).max(max, { message }).nullable());
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const reorderLevel = z.preprocess(
  (v) => (blankToNull(v) === null ? 0 : Number(v)),
  z.number().int().min(0).max(10000, { message: 'Enter a reorder level between 0 and 10000.' }),
);

export const productSchema = z
  .object({
    type: z.enum(PRODUCT_TYPES, { message: 'Choose the product type.' }),
    brand: z.string().trim().min(1, { message: 'Enter the brand.' }).max(60),
    system: text(60),
    platform: text(40),
    diameter_mm: optionalNumber(2, 9, 'Enter a diameter between 2 and 9 mm.'),
    length_mm: optionalNumber(4, 25, 'Enter a length between 4 and 25 mm.'),
    ref_code: text(60),
    description: text(200),
    reorder_level: reorderLevel,
  })
  .refine((p) => p.type !== 'implant' || (p.diameter_mm !== null && p.length_mm !== null), {
    message: 'Implants need a diameter and a length.',
  });

/** A product switched on from the catalogue library (0128): only its reorder level is edited here. */
export const linkedProductSchema = z.object({ reorder_level: reorderLevel });

export const receiveSchema = z.object({
  product_id: requiredId('Choose a product.'),
  quantity: z.coerce.number().int({ message: 'Enter a whole number.' }).min(1, { message: 'Enter a quantity of at least 1.' }).max(100000),
  lot_no: text(60),
  expiry: z.preprocess(blankToNull, z.string().refine(isRealDate, { message: 'Enter a valid expiry date or leave it empty.' }).nullable()),
  received_on: pastDate('Enter the date received (today or earlier).'),
  notes: text(500),
});

export const adjustSchema = z
  .object({
    stock_lot_id: requiredId('Stock batch not found.'),
    direction: z.enum(['out', 'in']),
    quantity: z.coerce.number().int().min(1, { message: 'Enter a quantity of at least 1.' }).max(100000),
    reason: z.enum(['adjust', 'waste', 'return'], { message: 'Choose adjust, waste or return.' }),
    note: z.string().trim().min(3, { message: 'Explain the change (at least 3 characters).' }).max(500),
  })
  .refine((a) => a.reason === 'adjust' || a.direction === 'out', { message: 'Waste and returns take stock out.' })
  .transform((a) => ({ stock_lot_id: a.stock_lot_id, delta: a.direction === 'out' ? -a.quantity : a.quantity, reason: a.reason, note: a.note }));

export const delegateSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the delegate’s full name (at least 2 characters).' }).max(120),
  phone: text(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .default('')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, { message: 'Enter a valid email address or leave it empty.' }),
  licence_no: text(60),
  notes: text(1000),
  active: checkbox,
});

const technique = z.enum(TECHNIQUES, { message: 'Choose Guided or Free hand.' });

const tooth = z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' });

export const planSchema = z.object({
  patientId: requiredId('Patient not found.'),
  tooth,
  productId: optionalUuid,
  technique,
  notes: text(1000),
});

export const BONE_TYPES = ['D1', 'D2', 'D3', 'D4'] as const;

/**
 * Who placed the implant (0115): a delegate (the default) with a course and a supervisor, or a doctor. With a
 * doctor the course and supervisor are left to the database: a course organizer still needs the course, a clinic
 * (no Teaching) refuses both.
 */
const placedByFields = {
  placedBy: z.enum(['delegate', 'doctor']).default('delegate'),
  placingDelegateId: optionalUuid,
  placingDoctorId: optionalUuid,
  assistingDelegateId: optionalUuid,
  supervisorId: optionalUuid,
  courseId: optionalUuid,
};

type PlacedBy = { placedBy: 'delegate' | 'doctor'; placingDelegateId: string | null; placingDoctorId: string | null; supervisorId: string | null; courseId: string | null };

function checkPlacedBy(p: PlacedBy, ctx: z.RefinementCtx) {
  const need = (ok: unknown, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', message }); };
  if (p.placedBy === 'doctor') {
    need(p.placingDoctorId, 'Choose the doctor who placed the implant.');
    return;
  }
  need(p.placingDelegateId, 'Choose the delegate who placed the implant.');
  need(p.supervisorId, 'Choose a supervisor.');
  need(p.courseId, 'Choose the course.');
}

/** Only the chosen kind of person is sent. */
function onlyChosen<T extends PlacedBy>(p: T): T {
  return p.placedBy === 'doctor' ? { ...p, placingDelegateId: null } : { ...p, placingDoctorId: null };
}

export const placeSchema = z
  .object({
    patientId: requiredId('Patient not found.'),
    tooth,
    productId: requiredId('Choose the implant.'),
    // Whether a batch is needed depends on the plan (Inventory): the database decides.
    lotId: optionalUuid,
    placedOn: pastDate('Enter the placement date (today or earlier).'),
    slotId: optionalUuid,
    ...placedByFields,
    technique,
    graft: text(200),
    notes: text(1000),
  })
  .superRefine(checkPlacedBy)
  .transform(onlyChosen);

/** Correcting a placed implant: the placement's date, people and clinical values (not the implant or batch). */
export const correctPlacementSchema = z
  .object({
    siteId: requiredId('Implant not found.'),
    patientId: requiredId('Patient not found.'),
    placedOn: pastDate('Enter the placement date (today or earlier).'),
    ...placedByFields,
    graft: text(200),
    notes: text(1000),
  })
  .superRefine(checkPlacedBy)
  .transform(onlyChosen);

export const componentSchema = z
  .object({
    siteId: requiredId('Implant not found.'),
    patientId: requiredId('Patient not found.'),
    componentType: z.enum(COMPONENT_TYPES, { message: 'Choose the component.' }),
    fittedOn: pastDate('Enter the date the component was fitted (today or earlier).'),
    productId: optionalUuid,
    lotId: optionalUuid,
    byDelegateId: optionalUuid,
    byOrganizerId: optionalUuid,
    courseId: optionalUuid,
    notes: text(1000),
  })
  .refine((c) => c.byDelegateId !== null || c.byOrganizerId !== null, { message: 'Choose who fitted the component.' });
