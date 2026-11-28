import { describe, it, expect } from 'vitest';
import { groupScrewSizes, screwDriverLine, screwSizeSchema, systemKey, type ScrewSize } from './screw-sizes';

const size = (o: Partial<ScrewSize> = {}): ScrewSize => ({
  id: 's1', brand: 'Oxy', system: 'PSK', kind: 'abutment_screw', label: 'M1.6 x 5',
  driver_interface: 'Hex', driver_size: '1.25', driver_ref: 'SD-1', torque_ncm: 25, active: true, ...o,
});
const bare = { driver_interface: '', driver_size: '', driver_ref: '' };

describe('screwDriverLine', () => {
  it('lists the screwdriver, ref and torque', () => {
    expect(screwDriverLine(size())).toBe('Screwdriver Hex 1.25 · ref SD-1 · Recommended torque 25 Ncm');
  });
  it('leaves out empty parts', () => {
    expect(screwDriverLine(size({ ...bare }))).toBe('Recommended torque 25 Ncm');
    expect(screwDriverLine(size({ ...bare, driver_interface: 'Torx', torque_ncm: null }))).toBe('Screwdriver Torx');
    expect(screwDriverLine(size({ ...bare, torque_ncm: null }))).toBe('');
  });
  it('keeps a torque of 0', () => {
    expect(screwDriverLine(size({ ...bare, torque_ncm: 0 }))).toBe('Recommended torque 0 Ncm');
  });
});

describe('screwSizeSchema', () => {
  const base = {
    id: '', system: systemKey('Oxy', 'PSK'), kind: 'prosthetic_screw', label: ' M2 x 6 ',
    driver_interface: ' Hex ', driver_size: '', driver_ref: '', torque: '15.04',
  };
  it('parses and trims', () => {
    expect(screwSizeSchema.parse(base)).toMatchObject({
      brand: 'Oxy', system: 'PSK', kind: 'prosthetic_screw', label: 'M2 x 6', driver_interface: 'Hex', torque: 15,
    });
  });
  it('an empty torque is null; 0 and 150 are allowed', () => {
    expect(screwSizeSchema.parse({ ...base, torque: '' }).torque).toBeNull();
    expect(screwSizeSchema.parse({ ...base, torque: '0' }).torque).toBe(0);
    expect(screwSizeSchema.parse({ ...base, torque: '150' }).torque).toBe(150);
  });
  it('refuses torque out of 0-150 or not a number', () => {
    for (const torque of ['151', '-1', 'abc']) {
      expect(screwSizeSchema.safeParse({ ...base, torque }).error?.issues[0].message).toBe('Torque must be between 0 and 150 Ncm.');
    }
  });
  it('bounds the label and the driver fields', () => {
    expect(screwSizeSchema.safeParse({ ...base, label: '  ' }).error?.issues[0].message).toBe('Enter the screw size.');
    expect(screwSizeSchema.safeParse({ ...base, label: 'x'.repeat(41) }).success).toBe(false);
    expect(screwSizeSchema.safeParse({ ...base, label: 'x'.repeat(40) }).success).toBe(true);
    expect(screwSizeSchema.safeParse({ ...base, driver_interface: 'x'.repeat(61) }).success).toBe(false);
    expect(screwSizeSchema.safeParse({ ...base, driver_size: 'x'.repeat(31) }).success).toBe(false);
    expect(screwSizeSchema.safeParse({ ...base, driver_ref: 'x'.repeat(61) }).success).toBe(false);
  });
  it('needs a system and a known kind', () => {
    expect(screwSizeSchema.safeParse({ ...base, system: '' }).error?.issues[0].message).toBe('Choose the implant system.');
    expect(screwSizeSchema.safeParse({ ...base, kind: 'cover_screw' }).success).toBe(false);
  });
});

describe('groupScrewSizes', () => {
  it('groups by brand and system, abutment screws first', () => {
    const groups = groupScrewSizes([
      size({ id: '1', kind: 'prosthetic_screw', label: 'B' }),
      size({ id: '2', system: 'MDK' }),
      size({ id: '3', label: 'A' }),
      size({ id: '4', brand: 'Acme', system: 'Z' }),
    ]);
    expect(groups.map((g) => `${g.brand}/${g.system}`)).toEqual(['Acme/Z', 'Oxy/MDK', 'Oxy/PSK']);
    expect(groups[2].sizes.map((s) => s.id)).toEqual(['3', '1']);
  });
});
