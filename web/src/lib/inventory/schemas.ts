import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { COMPONENT_TYPES, FOLLOWUP_OUTCOMES, PRODUCT_TYPES, TECHNIQUES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const pastDate = (message: string) => z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message });
const optionalNumber = (min: number, max: number, message: string) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).min(min, { message }).max(max, { message }).nullable());
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

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
    reorder_level: z.preprocess((v) => (blankToNull(v) === null ? 0 : Number(v)), z.number().int().min(0).max(10000, { message: 'Enter a reorder level between 0 and 10000.' })),
  })
  .refine((p) => p.type !== 'implant' || (p.diameter_mm !== null && p.length_mm !== null), {
    message: 'Implants need a diameter and a length.',
  });

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
  productId: optionalId,
  technique,
  notes: text(1000),
});

export const placeSchema = z.object({
  patientId: requiredId('Patient not found.'),
  tooth,
  productId: requiredId('Choose the implant.'),
  lotId: requiredId('Choose a stock batch.'),
  placedOn: pastDate('Enter the placement date (today or earlier).'),
  placingDelegateId: requiredId('Choose the delegate who placed the implant.'),
  slotId: optionalId,
  assistingDelegateId: optionalId,
  supervisorId: requiredId('Choose a supervisor.'),
  technique,
  torque: optionalNumber(0, 150, 'Enter an insertion torque between 0 and 150 Ncm.'),
  graft: text(200),
  notes: text(1000),
});

export const componentSchema = z
  .object({
    siteId: requiredId('Implant not found.'),
    patientId: requiredId('Patient not found.'),
    componentType: z.enum(COMPONENT_TYPES, { message: 'Choose the component.' }),
    fittedOn: pastDate('Enter the date the component was fitted (today or earlier).'),
    productId: optionalId,
    lotId: optionalId,
    byDelegateId: optionalId,
    byOrganizerId: optionalId,
    notes: text(1000),
  })
  .refine((c) => c.productId === null || c.lotId !== null, { message: 'Choose the stock batch used.' })
  .refine((c) => c.byDelegateId !== null || c.byOrganizerId !== null, { message: 'Choose who fitted the component.' });

export const followupSchema = z.object({
  siteId: requiredId('Implant not found.'),
  patientId: requiredId('Patient not found.'),
  date: pastDate('Enter the follow-up date (today or earlier).'),
  checkType: z.string().trim().min(1, { message: 'Enter the check (e.g. 3-month).' }).max(60),
  outcome: z.enum(FOLLOWUP_OUTCOMES, { message: 'Choose the outcome.' }),
  notes: text(1000),
});
