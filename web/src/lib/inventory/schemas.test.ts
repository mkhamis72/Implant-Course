import { describe, it, expect } from 'vitest';
import { adjustSchema, componentSchema, delegateSchema, placeSchema, productSchema, receiveSchema } from './schemas';

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
  const place = { patientId: id, tooth: 36, productId: id, lotId: id, placedOn: '2026-01-10', placingDelegateId: id, supervisorId: id, technique: 'guided' };
  it('accepts a complete placement and optional fields as null', () => {
    expect(placeSchema.parse({ ...place, assistingDelegateId: '', torque: '' })).toMatchObject({ assistingDelegateId: null, torque: null });
  });
  it('names the first missing piece', () => {
    expect(err(placeSchema.safeParse({ ...place, lotId: '' }))).toBe('Choose a stock batch.');
    expect(err(placeSchema.safeParse({ ...place, placingDelegateId: '' }))).toBe('Choose the delegate who placed the implant.');
    expect(err(placeSchema.safeParse({ ...place, torque: '200' }))).toBe('Enter an insertion torque between 0 and 150 Ncm.');
    expect(err(placeSchema.safeParse({ ...place, technique: '' }))).toBe('Choose Guided or Free hand.');
  });
  it('components need a batch when a product is chosen, and someone who fitted them', () => {
    const c = { siteId: id, patientId: id, componentType: 'ti_base', fittedOn: '2026-01-10', byDelegateId: id };
    expect(componentSchema.safeParse({ ...c, productId: id, lotId: '' }).success).toBe(false);
    expect(err(componentSchema.safeParse({ ...c, byDelegateId: '', byOrganizerId: '' }))).toBe('Choose who fitted the component.');
    expect(componentSchema.parse({ ...c, componentType: 'final_restoration' })).toMatchObject({ productId: null, lotId: null });
  });
});

describe('placeSchema ISQ and bone type', () => {
  const ok = {
    patientId: id, tooth: '36', productId: id, lotId: id, placedOn: '2020-01-01', placingDelegateId: id, supervisorId: id, technique: 'guided',
  };
  it('accepts blanks as not recorded', () => {
    expect(placeSchema.parse({ ...ok, isq: '', boneType: '' })).toMatchObject({ isq: null, boneType: null });
  });
  it('accepts valid values and refuses others', () => {
    expect(placeSchema.parse({ ...ok, isq: '72.5', boneType: 'D2' })).toMatchObject({ isq: 72.5, boneType: 'D2' });
    expect(err(placeSchema.safeParse({ ...ok, isq: '101' }))).toBe('Enter an ISQ between 0 and 100.');
    expect(err(placeSchema.safeParse({ ...ok, boneType: 'D5' }))).toBe('Choose a bone type from D1 to D4.');
  });
});
