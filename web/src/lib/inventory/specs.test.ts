import { describe, it, expect } from 'vitest';
import { productSpecs, specsLine } from './specs';
import type { Product } from './types';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p', type: 'abutment_straight', category: 'prosthetic', brand: 'Oxy', system: '', platform: '', diameter_mm: null, length_mm: null,
  ref_code: '', description: '', reorder_level: 0, active: true, is_sample: false,
  connection: '', gingival_height_mm: null, angle_deg: null, material: '', driver_interface: '', driver_size: '', driver_ref: '', torque_ncm: null,
  ...over,
});

describe('productSpecs', () => {
  it('lists only the filled specs, formatted', () => {
    expect(productSpecs(product())).toEqual([]);
    expect(
      productSpecs(product({
        connection: 'Conical', gingival_height_mm: 3, angle_deg: 17.5, material: 'Titanium',
        driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'ABC', torque_ncm: 25,
      })),
    ).toEqual([
      { label: 'Connection', value: 'Conical' },
      { label: 'Gingival height', value: '3.0 mm' },
      { label: 'Angle', value: '17.5°' },
      { label: 'Material', value: 'Titanium' },
      { label: 'Screwdriver', value: 'Hex 1.25 mm · ref ABC' },
      { label: 'Recommended torque', value: '25 Ncm' },
    ]);
  });
  it('formats numbers without trailing zeros and the driver from what is given', () => {
    expect(productSpecs(product({ angle_deg: 17 }))).toEqual([{ label: 'Angle', value: '17°' }]);
    expect(productSpecs(product({ torque_ncm: 32.5 }))).toEqual([{ label: 'Recommended torque', value: '32.5 Ncm' }]);
    expect(productSpecs(product({ driver_interface: 'Hex' }))).toEqual([{ label: 'Screwdriver', value: 'Hex' }]);
    expect(productSpecs(product({ driver_ref: 'ABC' }))).toEqual([{ label: 'Screwdriver', value: 'ref ABC' }]);
  });
});

describe('specsLine', () => {
  it('joins the specs and is empty with none', () => {
    expect(specsLine(product())).toBe('');
    expect(specsLine(product({ driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'ABC', torque_ncm: 25 }))).toBe(
      'Screwdriver: Hex 1.25 mm · ref ABC · Recommended torque: 25 Ncm',
    );
  });
});
