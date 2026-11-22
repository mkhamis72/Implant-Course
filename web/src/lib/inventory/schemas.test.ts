import { describe, it, expect } from 'vitest';
import { adjustSchema, componentSchema, correctPlacementSchema, delegateSchema, geometrySchema, placeSchema, productSchema, receiveSchema, linkedProductSchema } from './schemas';

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('productSchema', () => {
  it('requires sizes for implants and coerces form strings', () => {
    expect(productSchema.parse({ type: 'implant', brand: ' MIS ', diameter_mm: '3.75', length_mm: '11.5', reorder_level: '2' })).toMatchObject({
      brand: 'MIS', diameter_mm: 3.75, length_mm: 11.5, reorder_level: 2,
    });
    expect(err(productSchema.safeParse({ type: 'implant', brand: 'MIS' }))).toBe('Implants need a diameter and a length.');
    expect(productSchema.parse({ type: 'ti_base', brand: 'MIS', diameter_mm: '' })).toMatchObject({ diameter_mm: null });
  });
});

describe('productSchema implant kind and length', () => {
  const implant = { type: 'implant', brand: 'MIS', diameter_mm: '4', length_mm: '50' };
  it('takes lengths up to 60 mm and refuses beyond', () => {
    expect(productSchema.parse(implant).length_mm).toBe(50);
    expect(productSchema.parse({ ...implant, length_mm: '60' }).length_mm).toBe(60);
    expect(err(productSchema.safeParse({ ...implant, length_mm: '61' }))).toBe('Enter a length between 4 and 60 mm.');
    expect(err(productSchema.safeParse({ ...implant, length_mm: '3' }))).toBe('Enter a length between 4 and 60 mm.');
  });
  it('defaults the kind to conventional and checks it', () => {
    expect(productSchema.parse(implant).implant_kind).toBe('conventional');
    expect(productSchema.parse({ ...implant, implant_kind: 'zygomatic' }).implant_kind).toBe('zygomatic');
    expect(err(productSchema.safeParse({ ...implant, implant_kind: 'x' }))).toBe('Choose the implant kind.');
  });
});

describe('geometrySchema', () => {
  const ok = { siteId: id, patientId: id, type: 'conventional' };
  const msg = (extra: Record<string, string>) => err(geometrySchema.safeParse({ ...ok, ...extra }));
  it('accepts a conventional implant with nothing else, as nulls', () => {
    expect(geometrySchema.parse(ok)).toMatchObject({ type: 'conventional', angulation: null, direction: null, anchorage: null, entryPoint: '', trajectory: '' });
  });
  it('accepts a zygomatic implant with all fields', () => {
    expect(
      geometrySchema.parse({ ...ok, type: 'zygomatic', angulation: '45', direction: 'distal', anchorage: 'zygoma', entryPoint: ' a ', trajectory: 'b' }),
    ).toMatchObject({ type: 'zygomatic', angulation: 45, direction: 'distal', anchorage: 'zygoma', entryPoint: 'a', trajectory: 'b' });
  });
  it('mirrors the database messages', () => {
    expect(msg({ type: '' })).toBe('Choose the implant type.');
    expect(msg({ type: 'x' })).toBe('Choose the implant type.');
    expect(msg({ type: 'tilted' })).toBe('Enter the angle of the tilted implant.');
    expect(msg({ type: 'tilted', angulation: '61' })).toBe('Enter an angle between 0 and 60°.');
    expect(msg({ angulation: '-1' })).toBe('Enter an angle between 0 and 60°.');
    expect(msg({ angulation: 'abc' })).toBe('Enter an angle between 0 and 60°.');
    expect(geometrySchema.parse({ ...ok, type: 'tilted', angulation: '0' }).angulation).toBe(0);
    expect(msg({ angulation: '10', direction: 'up' })).toBe('Choose the direction of the angle.');
    expect(msg({ type: 'tilted', angulation: '10', anchorage: 'zygoma' })).toBe('Anchorage is only recorded for zygomatic and pterygoid implants.');
    expect(msg({ entryPoint: 'x' })).toBe('Anchorage is only recorded for zygomatic and pterygoid implants.');
    expect(msg({ type: 'pterygoid', anchorage: 'bone' })).toBe('Choose the anchorage.');
    expect(msg({ type: 'zygomatic', entryPoint: 'x'.repeat(201) })).toBe('Keep the entry point and trajectory to 200 characters each.');
    expect(geometrySchema.safeParse({ ...ok, type: 'zygomatic', trajectory: 'x'.repeat(200) }).success).toBe(true);
    expect(err(geometrySchema.safeParse({ ...ok, siteId: '' }))).toBe('Implant not found.');
  });
});

describe('receiveSchema', () => {
  it('validates quantity and optional dates', () => {
    expect(receiveSchema.parse({ product_id: id, quantity: '5', lot_no: ' A1 ', expiry: '', received_on: '2026-01-10' })).toEqual({
      product_id: id, quantity: 5, lot_no: 'A1', expiry: null, received_on: '2026-01-10', notes: '',
    });
    expect(err(receiveSchema.safeParse({ product_id: id, quantity: '0', received_on: '2026-01-10' }))).toBe('Enter a quantity of at least 1.');
    expect(err(receiveSchema.safeParse({ product_id: '', quantity: '1', received_on: '2026-01-10' }))).toBe('Choose a product.');
  });
});

describe('adjustSchema', () => {
  it('turns direction + quantity into a signed delta', () => {
    expect(adjustSchema.parse({ stock_lot_id: id, direction: 'out', quantity: '2', reason: 'waste', note: 'Dropped' })).toEqual({
      stock_lot_id: id, delta: -2, reason: 'waste', note: 'Dropped',
    });
  });
  it('refuses waste going in and a missing reason', () => {
    expect(err(adjustSchema.safeParse({ stock_lot_id: id, direction: 'in', quantity: '1', reason: 'return', note: 'xxx' }))).toBe(
      'Waste and returns take stock out.',
    );
    expect(err(adjustSchema.safeParse({ stock_lot_id: id, direction: 'out', quantity: '1', reason: 'adjust', note: ' ' }))).toBe(
      'Explain the change (at least 3 characters).',
    );
  });
});

describe('delegateSchema', () => {
  it('normalizes and validates', () => {
    expect(delegateSchema.parse({ full_name: ' Dr Karim ', email: ' K@X.COM ', active: 'on' })).toMatchObject({
      full_name: 'Dr Karim', email: 'k@x.com', active: true,
    });
    expect(err(delegateSchema.safeParse({ full_name: 'K' }))).toBe('Enter the delegate’s full name (at least 2 characters).');
  });
});

describe('placeSchema / componentSchema', () => {
  const place = { patientId: id, tooth: 36, productId: id, lotId: id, placedOn: '2026-01-10', placingDelegateId: id, supervisorId: id, courseId: id, technique: 'guided' };
  it('accepts a complete placement and optional fields as null', () => {
    expect(placeSchema.parse({ ...place, assistingDelegateId: '' })).toMatchObject({ assistingDelegateId: null });
  });
  it('leaves the batch to the database', () => {
    const { lotId: _lot, ...noLot } = place;
    expect(placeSchema.parse(noLot)).toMatchObject({ lotId: null });
    expect(placeSchema.parse({ ...place, lotId: '' })).toMatchObject({ lotId: null });
  });
  it('requires the course', () => {
    expect(err(placeSchema.safeParse({ ...place, courseId: '' }))).toBe('Choose the course.');
  });
  it('names the first missing piece', () => {
    expect(err(placeSchema.safeParse({ ...place, placingDelegateId: '' }))).toBe('Choose the delegate who placed the implant.');
    expect(err(placeSchema.safeParse({ ...place, technique: '' }))).toBe('Choose Guided or Free hand.');
  });
  it('placed by a doctor: needs the doctor, no delegate, and leaves course and supervisor to the database', () => {
    const byDoctor = { ...place, placedBy: 'doctor', placingDelegateId: '', supervisorId: '', courseId: '', placingDoctorId: id };
    expect(placeSchema.parse(byDoctor)).toMatchObject({ placingDoctorId: id, placingDelegateId: null, supervisorId: null, courseId: null });
    expect(err(placeSchema.safeParse({ ...byDoctor, placingDoctorId: '' }))).toBe('Choose the doctor who placed the implant.');
    // Delegate (the default) ignores a stray doctor.
    expect(placeSchema.parse({ ...place, placingDoctorId: id })).toMatchObject({ placingDoctorId: null, placingDelegateId: id });
  });
  it('correcting by a doctor works the same way', () => {
    const fix = { siteId: id, patientId: id, placedOn: '2026-01-10', placedBy: 'doctor', placingDoctorId: id, placingDelegateId: '', supervisorId: '', courseId: '' };
    expect(correctPlacementSchema.parse(fix)).toMatchObject({ placingDoctorId: id, placingDelegateId: null });
    expect(err(correctPlacementSchema.safeParse({ ...fix, placingDoctorId: '' }))).toBe('Choose the doctor who placed the implant.');
  });
  it('components are accepted without a batch (the database decides), and need someone who fitted them', () => {
    const c = { siteId: id, patientId: id, componentType: 'ti_base', fittedOn: '2026-01-10', byDelegateId: id };
    expect(componentSchema.safeParse({ ...c, productId: id, lotId: '' }).success).toBe(true);
    expect(err(componentSchema.safeParse({ ...c, byDelegateId: '', byOrganizerId: '' }))).toBe('Choose who fitted the component.');
    expect(componentSchema.parse({ ...c, componentType: 'final_restoration' })).toMatchObject({ productId: null, lotId: null });
  });
});

describe('product specs and screw holders', () => {
  const base = { type: 'abutment_straight', brand: 'Oxy' };
  it('accepts the spec fields and refuses out-of-range numbers', () => {
    expect(productSchema.parse({ ...base, gingival_height_mm: '3', angle_deg: '17.5', torque_ncm: '25', connection: 'Conical' })).toMatchObject({
      gingival_height_mm: 3, angle_deg: 17.5, torque_ncm: 25, connection: 'Conical', material: '',
    });
    expect(productSchema.parse({ ...base, angle_deg: '' })).toMatchObject({ angle_deg: null });
    expect(err(productSchema.safeParse({ ...base, gingival_height_mm: '11' }))).toBe('Enter a gingival height between 0 and 10 mm.');
    expect(err(productSchema.safeParse({ ...base, angle_deg: '46' }))).toBe('Enter an angle between 0 and 45°.');
    expect(err(productSchema.safeParse({ ...base, torque_ncm: '151' }))).toBe('Enter a torque between 0 and 150 Ncm.');
  });
  const c = { siteId: id, patientId: id, componentType: 'ti_base', fittedOn: '2026-01-10', byDelegateId: id };
  it('takes a torque', () => {
    expect(componentSchema.parse({ ...c, torque: '25' })).toMatchObject({ torque: 25 });
    expect(componentSchema.parse(c)).toMatchObject({ torque: null, holdsComponentId: null, holdsRestorationId: null });
    expect(err(componentSchema.safeParse({ ...c, torque: '200' }))).toBe('Enter a torque between 0 and 150 Ncm.');
  });
  it('screws need something to hold', () => {
    const msg = 'Choose what this screw holds.';
    expect(err(componentSchema.safeParse({ ...c, componentType: 'prosthetic_screw' }))).toBe(msg);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'temporary_cylinder_screw' }))).toBe(msg);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'abutment_screw' }))).toBe(msg);
    expect(componentSchema.safeParse({ ...c, componentType: 'prosthetic_screw', holdsRestorationId: id }).success).toBe(true);
    expect(componentSchema.safeParse({ ...c, componentType: 'prosthetic_screw', holdsComponentId: id }).success).toBe(true);
    expect(componentSchema.safeParse({ ...c, componentType: 'abutment_screw', holdsComponentId: id }).success).toBe(true);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'abutment_screw', holdsRestorationId: id }))).toBe(msg);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'prosthetic_screw', holdsComponentId: id, holdsRestorationId: id }))).toBe(msg);
  });
  it('a cap sits on the abutment', () => {
    const msg = 'Choose the abutment this cap sits on.';
    expect(err(componentSchema.safeParse({ ...c, componentType: 'healing_cap' }))).toBe(msg);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'healing_cap', holdsRestorationId: id }))).toBe(msg);
    expect(err(componentSchema.safeParse({ ...c, componentType: 'healing_cap', holdsComponentId: id, holdsRestorationId: id }))).toBe(msg);
    expect(componentSchema.safeParse({ ...c, componentType: 'healing_cap', holdsComponentId: id }).success).toBe(true);
  });
  it('refuses a screwdriver size over 30 characters', () => {
    expect(productSchema.safeParse({ ...base, driver_size: 'x'.repeat(30) }).success).toBe(true);
    expect(productSchema.safeParse({ ...base, driver_size: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('linkedProductSchema (0128)', () => {
  it('reads only the reorder level of a product from the catalogue library', () => {
    expect(linkedProductSchema.parse({ reorder_level: '5', brand: '' })).toEqual({ reorder_level: 5 });
    expect(linkedProductSchema.parse({ reorder_level: '' })).toEqual({ reorder_level: 0 });
    expect(linkedProductSchema.safeParse({ reorder_level: '20000' }).success).toBe(false);
  });
});
